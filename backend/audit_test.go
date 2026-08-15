package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestAuditLogRecordDedupsWithinWindow(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit-log.json")
	a := NewAuditLog(path)

	a.Record(12345, "Alice", "User")
	a.Record(12345, "Alice", "User")

	got := a.List()
	if len(got) != 1 {
		t.Fatalf("expected the second call within the dedup window to be skipped, got %d entries", len(got))
	}
}

func TestAuditLogRecordAllowsNewEntryAfterWindow(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit-log.json")
	a := NewAuditLog(path)

	a.mutex.Lock()
	a.entries = append(a.entries, AuditEntry{
		Timestamp:  time.Now().Add(-auditDedupWindow - time.Second),
		Lidnr:      12345,
		GivenName:  "Alice",
		FamilyName: "User",
	})
	a.mutex.Unlock()

	a.Record(12345, "Alice", "User")

	got := a.List()
	if len(got) != 2 {
		t.Fatalf("expected a new entry once the dedup window has passed, got %d entries: %+v", len(got), got)
	}
}

func TestAuditLogRecordTracksDifferentLidnrsIndependently(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit-log.json")
	a := NewAuditLog(path)

	a.Record(1, "A", "One")
	a.Record(2, "B", "Two")
	a.Record(1, "A", "One") // deduped: lidnr 1 was already recorded above
	a.Record(3, "C", "Three")

	got := a.List()
	if len(got) != 3 {
		t.Fatalf("expected 3 distinct lidnrs to each get an entry, got %d: %+v", len(got), got)
	}
}

func TestAuditLogCapsAndEvictsOldest(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit-log.json")
	a := NewAuditLog(path)

	// Each lidnr is distinct so the dedup window never kicks in and every
	// call actually appends.
	for i := 0; i < maxAuditEntries+5; i++ {
		a.Record(i, "Given", "Family")
	}

	got := a.List() // newest first
	if len(got) != maxAuditEntries {
		t.Fatalf("expected the log to cap at %d entries, got %d", maxAuditEntries, len(got))
	}
	if got[0].Lidnr != maxAuditEntries+4 {
		t.Fatalf("expected the newest entry first, got %+v", got[0])
	}
	// The oldest 5 lidnrs (0..4) must have been evicted, leaving lidnr 5 as
	// the oldest surviving entry -- last in the newest-first list.
	if got[len(got)-1].Lidnr != 5 {
		t.Fatalf("expected the oldest entries evicted first, got %+v", got[len(got)-1])
	}
}

func TestAuditLogPersistenceRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit-log.json")
	a := NewAuditLog(path)
	a.Record(12345, "Alice", "User")

	reloaded := NewAuditLog(path)
	if err := reloaded.Load(); err != nil {
		t.Fatalf("Load: %v", err)
	}

	got := reloaded.List()
	if len(got) != 1 || got[0].Lidnr != 12345 || got[0].GivenName != "Alice" || got[0].FamilyName != "User" {
		t.Fatalf("expected reloaded entry to match, got %+v", got)
	}
}

func TestAuditLogLoadToleratesMissingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "does-not-exist.json")
	a := NewAuditLog(path)

	if err := a.Load(); err != nil {
		t.Fatalf("expected a missing file to be tolerated, got: %v", err)
	}
	if got := a.List(); len(got) != 0 {
		t.Fatalf("expected an empty log, got %+v", got)
	}
}

func TestAuditLogLoadRejectsCorruptFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit-log.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	a := NewAuditLog(path)
	if err := a.Load(); err == nil {
		t.Fatalf("expected Load to fail on a corrupt audit log file")
	}
}

func TestAuditLogHandlerAuthAndShape(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "correct-key"
	chat := NewChat()
	auditLog := NewAuditLog(filepath.Join(t.TempDir(), "audit-log.json"))
	auditLog.Record(1, "Alice", "User")
	auditLog.Record(2, "Bob", "Radio")

	validTok := makeToken(t, GEWISSecret, 12345, "Alice", "User", time.Minute)

	tests := []struct {
		name       string
		token      string
		radioKey   string
		wantStatus int
	}{
		{"valid token and key", validTok, "correct-key", http.StatusOK},
		{"wrong key", validTok, "wrong-key", http.StatusUnauthorized},
		{"malformed token", "not-a-jwt", "correct-key", http.StatusUnauthorized},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, err := json.Marshal(RadioKeyValidateRequest{Token: tt.token, RadioKey: tt.radioKey})
			if err != nil {
				t.Fatalf("marshal request: %v", err)
			}
			req := httptest.NewRequest(http.MethodPost, "/api/v1/audit-log", strings.NewReader(string(body)))
			rec := httptest.NewRecorder()

			auditLogHandler(chat, auditLog, rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("expected status %d, got %d (body=%s)", tt.wantStatus, rec.Code, rec.Body.String())
			}
			if tt.wantStatus != http.StatusOK {
				return
			}
			var got []AuditEntry
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			if len(got) != 2 || got[0].Lidnr != 2 || got[1].Lidnr != 1 {
				t.Fatalf("expected newest-first order [2,1], got %+v", got)
			}
		})
	}
}

func TestAuditLogHandlerWrongMethod(t *testing.T) {
	chat := NewChat()
	auditLog := NewAuditLog(filepath.Join(t.TempDir(), "audit-log.json"))

	for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodDelete} {
		req := httptest.NewRequest(method, "/api/v1/audit-log", nil)
		rec := httptest.NewRecorder()

		auditLogHandler(chat, auditLog, rec, req)

		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s: expected status 405, got %d", method, rec.Code)
		}
	}
}

func TestAuditLogHandlerMalformedJSON(t *testing.T) {
	chat := NewChat()
	auditLog := NewAuditLog(filepath.Join(t.TempDir(), "audit-log.json"))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/audit-log", strings.NewReader("not json"))
	rec := httptest.NewRecorder()

	auditLogHandler(chat, auditLog, rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", rec.Code)
	}
}

// TestRadioKeyValidateHandlerRecordsAuditEntry and
// TestRadioKeyValidateHandlerDoesNotRecordOnFailure exercise the wiring
// described in audit.go's doc comment on radioKeyValidateHandler: a
// successful validation must produce exactly one audit entry (via the
// second, deliberate token re-parse), and a failed one must produce none.
func TestRadioKeyValidateHandlerRecordsAuditEntry(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "correct-key"
	chat := NewChat()
	auditLog := NewAuditLog(filepath.Join(t.TempDir(), "audit-log.json"))

	validTok := makeToken(t, GEWISSecret, 12345, "Alice", "User", time.Minute)
	body, err := json.Marshal(RadioKeyValidateRequest{Token: validTok, RadioKey: "correct-key"})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/radio-key/validate", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()

	radioKeyValidateHandler(chat, auditLog, rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
	got := auditLog.List()
	if len(got) != 1 || got[0].Lidnr != 12345 || got[0].GivenName != "Alice" || got[0].FamilyName != "User" {
		t.Fatalf("expected a recorded audit entry for the validated lidnr, got %+v", got)
	}
}

func TestRadioKeyValidateHandlerDoesNotRecordOnFailure(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "correct-key"
	chat := NewChat()
	auditLog := NewAuditLog(filepath.Join(t.TempDir(), "audit-log.json"))

	validTok := makeToken(t, GEWISSecret, 12345, "Alice", "User", time.Minute)
	body, err := json.Marshal(RadioKeyValidateRequest{Token: validTok, RadioKey: "wrong-key"})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/radio-key/validate", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()

	radioKeyValidateHandler(chat, auditLog, rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d", rec.Code)
	}
	if got := auditLog.List(); len(got) != 0 {
		t.Fatalf("expected no audit entry on a failed validation, got %+v", got)
	}
}

func TestRadioKeyValidateHandlerRepeatedValidationsDedup(t *testing.T) {
	// Regression test for the motivating scenario in audit.go's doc
	// comment on auditDedupWindow: the frontend re-validates on every
	// backoffice page load/navigation, so repeated successful validations
	// for the same lidnr in quick succession must still only produce one
	// audit entry.
	GEWISSecret = "testsecret"
	RADIOChatKey = "correct-key"
	chat := NewChat()
	auditLog := NewAuditLog(filepath.Join(t.TempDir(), "audit-log.json"))

	validTok := makeToken(t, GEWISSecret, 12345, "Alice", "User", time.Minute)
	body, err := json.Marshal(RadioKeyValidateRequest{Token: validTok, RadioKey: "correct-key"})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/radio-key/validate", strings.NewReader(string(body)))
		rec := httptest.NewRecorder()
		radioKeyValidateHandler(chat, auditLog, rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("validation %d: expected status 200, got %d", i, rec.Code)
		}
	}

	if got := auditLog.List(); len(got) != 1 {
		t.Fatalf("expected repeated validations within the dedup window to produce exactly 1 entry, got %d: %+v", len(got), got)
	}
}
