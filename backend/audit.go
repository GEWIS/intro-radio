package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// AuditEntry records one successful radio-key validation: who validated it
// and when. This is a lightweight "who's had backoffice access" trail, not
// a real audit system -- proportionate to a single-week event with no
// database anywhere in the stack.
type AuditEntry struct {
	Timestamp  time.Time `json:"timestamp"`
	Lidnr      int       `json:"lidnr"`
	GivenName  string    `json:"given_name"`
	FamilyName string    `json:"family_name"`
}

const (
	// maxAuditEntries caps the log so it can't grow without bound over a
	// long-running deploy.
	maxAuditEntries = 1000

	// auditDedupWindow: the frontend re-validates the radio key on every
	// backoffice page load and navigation (see radioKeyValidateHandler in
	// main.go), so logging every single validation would swamp the log
	// with near-duplicate entries for one person's single sitting. One
	// entry per lidnr per window is enough to answer "who had access, and
	// roughly when" without that noise.
	auditDedupWindow = 15 * time.Minute
)

var auditLogFile = String("AUDIT_LOG_FILE", "audit-log.json")

// AuditLog holds a capped, file-backed history of successful radio-key
// validations, mirroring MetricsStore's disk-backed idiom (see
// metrics.go): append-only, self-trimming, tolerant of a missing file at
// startup. Entries are kept oldest-first internally (append order); List()
// reverses that for callers, since "who's used this key" reads naturally
// newest-first.
type AuditLog struct {
	mutex   sync.Mutex
	entries []AuditEntry
	path    string
}

func NewAuditLog(path string) *AuditLog {
	return &AuditLog{path: path}
}

// Load reads existing entries from disk, tolerating a missing file exactly
// like MetricsStore.Load does. A file that exists but fails to parse is
// reported to the caller; main() only warns on that error rather than
// treating it as fatal, since losing this history is not worth
// crash-looping the server over.
func (a *AuditLog) Load() error {
	data, err := os.ReadFile(a.path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("reading audit log file: %w", err)
	}

	var entries []AuditEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		return fmt.Errorf("parsing audit log file: %w", err)
	}

	a.mutex.Lock()
	a.entries = entries
	a.mutex.Unlock()
	return nil
}

// List returns a copy of the current entries, newest first -- the order a
// backoffice "who's been in here" view wants, opposite of MetricsStore's
// oldest-first time series.
func (a *AuditLog) List() []AuditEntry {
	a.mutex.Lock()
	defer a.mutex.Unlock()
	out := make([]AuditEntry, len(a.entries))
	for i, e := range a.entries {
		out[len(a.entries)-1-i] = e
	}
	return out
}

// Record appends a successful validation for lidnr, unless lidnr already
// has an entry within the last auditDedupWindow -- see that const's doc
// comment for why. Entries are appended in chronological order, so the
// most recent entry for any given lidnr is always its *last* occurrence in
// the slice; scanning backwards from the end and stopping at the first
// match is therefore enough to find it, without needing to scan the whole
// history.
func (a *AuditLog) Record(lidnr int, givenName, familyName string) {
	now := time.Now()

	a.mutex.Lock()
	for i := len(a.entries) - 1; i >= 0; i-- {
		if a.entries[i].Lidnr != lidnr {
			continue
		}
		if now.Sub(a.entries[i].Timestamp) < auditDedupWindow {
			a.mutex.Unlock()
			return
		}
		break
	}

	a.entries = append(a.entries, AuditEntry{
		Timestamp:  now,
		Lidnr:      lidnr,
		GivenName:  givenName,
		FamilyName: familyName,
	})
	if over := len(a.entries) - maxAuditEntries; over > 0 {
		a.entries = a.entries[over:]
	}
	snapshot := make([]AuditEntry, len(a.entries))
	copy(snapshot, a.entries)
	a.mutex.Unlock()

	if err := writeJSONFile(a.path, snapshot); err != nil {
		log.Warn().Err(err).Str("path", a.path).
			Msg("could not persist audit log entry; continuing with in-memory history only")
	}
}

// auditLogHandler backs POST /api/v1/audit-log: same auth shape as
// metricsHandler, returning the capped audit trail newest first (see
// AuditLog.List) for a backoffice "who's used this key" view.
func auditLogHandler(chat *Chat, auditLog *AuditLog, w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req RadioKeyValidateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if !chat.VerifyRadioKey(req.Token, req.RadioKey) {
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(RadioKeyValidateResponse{Valid: false})
		return
	}
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(auditLog.List())
}
