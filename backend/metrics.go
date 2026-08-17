package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// MetricSample is one point-in-time reading of the radio's audience, taken
// by the background sampling loop every metricsSampleInterval.
type MetricSample struct {
	Timestamp time.Time `json:"timestamp"`
	Listeners int       `json:"listeners"`
	Chatters  int       `json:"chatters"`
}

const (
	// metricsSampleInterval is how often the background loop in Run takes
	// a sample. Not env-configurable -- see main.go's constants for the
	// same reasoning: this is an operational tuning knob for this single
	// event, not something a deployment needs to vary.
	metricsSampleInterval = 5 * time.Minute

	// maxMetricSamples caps the store at 7 days of history at 5-minute
	// resolution (7 * 24h / 5m = 2016), so metrics.json can't grow without
	// bound over the lifetime of a long-running deploy.
	maxMetricSamples = 2016

	// statusFetchTimeout bounds the outbound request to Icecast's
	// status-json.xsl so a slow or hung upstream can never stall a sample
	// past the next tick.
	statusFetchTimeout = 5 * time.Second
)

var metricsFile = String("METRICS_FILE", "metrics.json")

// MetricsStore holds a capped, file-backed history of listener/chatter
// samples, mirroring Agenda's disk-backed-JSON idiom (see agenda.go): a
// mutex-guarded in-memory slice, tolerant of a missing file at startup,
// persisted back to disk on every mutation. Unlike Agenda, there is
// nothing to validate and no "replace the whole list" API -- samples are
// only ever appended, and the store trims itself instead of rejecting
// input.
type MetricsStore struct {
	mutex   sync.Mutex
	samples []MetricSample
	path    string
}

func NewMetricsStore(path string) *MetricsStore {
	return &MetricsStore{path: path}
}

// Load reads existing samples from disk, tolerating a missing file exactly
// like Agenda.Load does -- a fresh deploy just starts with an empty series
// instead of failing to boot. A file that exists but fails to parse is
// reported to the caller; unlike the agenda, losing this history is not
// worth crash-looping the whole server over, so main() only warns on that
// error rather than treating it as fatal.
func (m *MetricsStore) Load() error {
	data, err := os.ReadFile(m.path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("reading metrics file: %w", err)
	}

	var samples []MetricSample
	if err := json.Unmarshal(data, &samples); err != nil {
		return fmt.Errorf("parsing metrics file: %w", err)
	}

	m.mutex.Lock()
	m.samples = samples
	m.mutex.Unlock()
	return nil
}

// List returns a copy of the current samples, oldest first -- safe for the
// caller to read or mutate without affecting the store's own state.
func (m *MetricsStore) List() []MetricSample {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	out := make([]MetricSample, len(m.samples))
	copy(out, m.samples)
	return out
}

// Append adds sample to the series, dropping the oldest entries first if
// that would exceed maxMetricSamples, and persists the result to disk. A
// persistence failure is logged and otherwise swallowed, the same
// reasoning as Agenda's seed-write failure: the in-memory series is still
// perfectly serveable, and the sampling loop must keep ticking rather than
// wedging itself over a transient disk hiccup.
func (m *MetricsStore) Append(sample MetricSample) {
	m.mutex.Lock()
	m.samples = append(m.samples, sample)
	if over := len(m.samples) - maxMetricSamples; over > 0 {
		m.samples = m.samples[over:]
	}
	snapshot := make([]MetricSample, len(m.samples))
	copy(snapshot, m.samples)
	m.mutex.Unlock()

	if err := writeJSONFile(m.path, snapshot); err != nil {
		log.Warn().Err(err).Str("path", m.path).
			Msg("could not persist metrics sample; continuing with in-memory history only")
	}
}

// Run ticks every metricsSampleInterval and takes one sample per tick,
// blocking until done is closed. Call it in its own goroutine; main()
// closes done at the same point it calls chat.Shutdown(), so a graceful
// shutdown doesn't leave this goroutine (or its ticker) running past the
// server's own lifetime.
func (m *MetricsStore) Run(chat *Chat, done <-chan struct{}) {
	ticker := time.NewTicker(metricsSampleInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			m.sampleOnce(chat, audioURL, audioMountPoint)
		case <-done:
			return
		}
	}
}

// sampleOnce takes baseURL/mountPoint as explicit parameters (rather than
// reading the audioURL/audioMountPoint package vars directly) so tests can
// point it at an httptest.Server instead of waiting on metricsSampleInterval
// or reaching out to a real Icecast server.
func (m *MetricsStore) sampleOnce(chat *Chat, baseURL, mountPoint string) {
	listeners, err := fetchListenerCount(baseURL, mountPoint)
	if err != nil {
		// A failed fetch, malformed JSON, or no matching source all mean
		// "we don't actually know the listener count right now" -- recording
		// a zero would misrepresent that as "nobody was listening," so the
		// whole sample (including the chatter count) is skipped instead.
		log.Warn().Err(err).Msg("skipping metrics sample: could not determine listener count")
		return
	}

	chat.mutex.Lock()
	chatters := len(chat.users)
	chat.mutex.Unlock()

	m.Append(MetricSample{
		Timestamp: time.Now(),
		Listeners: listeners,
		Chatters:  chatters,
	})
}

// icecastStatus mirrors just the subset of Icecast's status-json.xsl body
// this backend reads.
type icecastStatus struct {
	Icestats struct {
		Source json.RawMessage `json:"source"`
	} `json:"icestats"`
}

// icecastSource mirrors one entry of icestats.source.
type icecastSource struct {
	ListenURL string `json:"listenurl"`
	Listeners int    `json:"listeners"`
}

// fetchListenerCount fetches baseURL's status-json.xsl and returns the
// listener count of whichever source's listenurl ends with mountPoint.
// This replicates AudioStream.vue's findMatchingSource client-side logic
// so the backoffice dashboard and the public listener count displayed to
// visitors agree on what counts as "the mount point's source."
// icestats.source is a single JSON object when only one mount point is
// live on the Icecast server and an array when several are -- that quirk
// is Icecast's, not ours, so both shapes are tried here exactly as
// findMatchingSource does in JavaScript.
// icecastSchemePattern detects a baseURL that already has a scheme, so
// normalizeIcecastBaseURL doesn't double-prefix one. Mirrors
// normalizeIcecastBaseUrl in frontend/src/composables/useIcecastLiveStatus.ts.
var icecastSchemePattern = regexp.MustCompile(`^[a-zA-Z][a-zA-Z\d+\-.]*://`)

// normalizeIcecastBaseURL defaults to https:// when baseURL has no scheme.
// main.go documents RADIO_AUDIO_URL as sometimes being configured that way
// (e.g. "bata-radio.snt.utwente.nl" with no scheme) -- without this, Go's
// http.Client rejects the request outright with "unsupported protocol
// scheme", which the frontend's own normalization (applied before this
// backend code existed) never had to contend with.
func normalizeIcecastBaseURL(baseURL string) string {
	trimmed := strings.TrimRight(baseURL, "/")
	if icecastSchemePattern.MatchString(trimmed) {
		return trimmed
	}
	return "https://" + trimmed
}

func fetchListenerCount(baseURL, mountPoint string) (int, error) {
	client := http.Client{Timeout: statusFetchTimeout}
	resp, err := client.Get(normalizeIcecastBaseURL(baseURL) + "/status-json.xsl")
	if err != nil {
		return 0, fmt.Errorf("fetching status-json.xsl: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("status-json.xsl returned status %d", resp.StatusCode)
	}

	var status icecastStatus
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		return 0, fmt.Errorf("parsing status-json.xsl: %w", err)
	}

	var sources []icecastSource
	if err := json.Unmarshal(status.Icestats.Source, &sources); err != nil {
		var single icecastSource
		if err := json.Unmarshal(status.Icestats.Source, &single); err != nil {
			return 0, fmt.Errorf("parsing icestats.source: %w", err)
		}
		sources = []icecastSource{single}
	}

	for _, s := range sources {
		if strings.HasSuffix(s.ListenURL, mountPoint) {
			return s.Listeners, nil
		}
	}
	return 0, fmt.Errorf("no source found for mount point %q", mountPoint)
}

// LiveStatus is an on-demand snapshot of the radio's audience right now --
// unlike MetricSample (sampled every metricsSampleInterval and stored),
// this always costs a live Icecast round trip and is never persisted.
// Listeners is nullable because a failed Icecast fetch means "unknown," not
// "zero" -- the same reasoning sampleOnce uses to skip a whole sample
// rather than record a misleading zero.
type LiveStatus struct {
	Listeners *int `json:"listeners"`
	Chatters  int  `json:"chatters"`
}

// liveStatusHandler backs POST /api/v1/live-status: same auth shape as
// metricsHandler, but answers "what's happening right now" instead of
// returning stored history -- the dashboard's periodic sample can be up to
// metricsSampleInterval stale, which is fine for a trend chart but not for
// a "how many people are here right now" readout. baseURL/mountPoint are
// explicit parameters for the same reason sampleOnce takes them: tests can
// point this at an httptest.Server instead of a real Icecast.
func liveStatusHandler(chat *Chat, baseURL, mountPoint string, w http.ResponseWriter, r *http.Request) {
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

	chat.mutex.Lock()
	chatters := len(chat.users)
	chat.mutex.Unlock()

	status := LiveStatus{Chatters: chatters}
	if listeners, err := fetchListenerCount(baseURL, mountPoint); err == nil {
		status.Listeners = &listeners
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(status)
}

// metricsHandler backs POST /api/v1/metrics: the backoffice dashboard's
// only way to read the sampled history, gated by the same shared
// {token, radioKey} check as every other backoffice-only endpoint (see
// radioKeyValidateHandler in main.go). Samples come back oldest first,
// matching store.List()'s own ordering, so the dashboard can plot them
// left-to-right with no client-side re-sorting.
func metricsHandler(chat *Chat, store *MetricsStore, w http.ResponseWriter, r *http.Request) {
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
	_ = json.NewEncoder(w).Encode(store.List())
}

// writeJSONFile marshals v as indented JSON and writes it to path via a
// temp-file-plus-rename, the same atomic-write idiom Agenda.Replace uses
// in agenda.go, so a crash or a concurrent read can never observe a
// half-written file. Shared by MetricsStore.Append and AuditLog.Record.
func writeJSONFile(path string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding %s: %w", path, err)
	}

	if dir := filepath.Dir(path); dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("creating directory for %s: %w", path, err)
		}
	}

	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return fmt.Errorf("writing %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		// Best-effort cleanup so a rename failure doesn't leave the .tmp
		// file behind forever. If cleanup itself fails too, that must not
		// mask the rename error we're about to return -- just log it.
		if rmErr := os.Remove(tmp); rmErr != nil {
			log.Warn().Err(rmErr).Str("path", tmp).
				Msg("could not clean up the stray temp file left behind by a failed rename")
		}
		return fmt.Errorf("saving %s: %w", path, err)
	}
	return nil
}
