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

func TestMetricsStoreAppendCapsAndEvictsOldest(t *testing.T) {
	path := filepath.Join(t.TempDir(), "metrics.json")
	m := NewMetricsStore(path)

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := 0; i < maxMetricSamples+5; i++ {
		m.Append(MetricSample{Timestamp: base.Add(time.Duration(i) * time.Minute), Listeners: i, Chatters: i})
	}

	got := m.List()
	if len(got) != maxMetricSamples {
		t.Fatalf("expected the store to cap at %d samples, got %d", maxMetricSamples, len(got))
	}
	// The oldest 5 appended samples (Listeners 0..4) must have been evicted
	// first, so the oldest surviving sample is the 6th appended.
	if got[0].Listeners != 5 {
		t.Fatalf("expected the oldest samples to be evicted first, got[0].Listeners=%d", got[0].Listeners)
	}
	if got[len(got)-1].Listeners != maxMetricSamples+4 {
		t.Fatalf("expected the newest sample last, got[-1].Listeners=%d", got[len(got)-1].Listeners)
	}
}

func TestMetricsStorePersistenceRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "metrics.json")
	m := NewMetricsStore(path)

	sample := MetricSample{Timestamp: time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC), Listeners: 7, Chatters: 3}
	m.Append(sample)

	reloaded := NewMetricsStore(path)
	if err := reloaded.Load(); err != nil {
		t.Fatalf("Load: %v", err)
	}

	got := reloaded.List()
	if len(got) != 1 {
		t.Fatalf("expected 1 sample after reload, got %d", len(got))
	}
	if !got[0].Timestamp.Equal(sample.Timestamp) || got[0].Listeners != sample.Listeners || got[0].Chatters != sample.Chatters {
		t.Fatalf("expected reloaded sample to match, got %+v want %+v", got[0], sample)
	}
}

func TestMetricsStoreLoadToleratesMissingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "does-not-exist.json")
	m := NewMetricsStore(path)

	if err := m.Load(); err != nil {
		t.Fatalf("expected a missing file to be tolerated, got: %v", err)
	}
	if got := m.List(); len(got) != 0 {
		t.Fatalf("expected an empty series, got %+v", got)
	}
}

func TestMetricsStoreLoadRejectsCorruptFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "metrics.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	m := NewMetricsStore(path)
	if err := m.Load(); err == nil {
		t.Fatalf("expected Load to fail on a corrupt metrics file")
	}
}

func TestMetricsStoreListReturnsOldestFirst(t *testing.T) {
	path := filepath.Join(t.TempDir(), "metrics.json")
	m := NewMetricsStore(path)

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := 0; i < 3; i++ {
		m.Append(MetricSample{Timestamp: base.Add(time.Duration(i) * time.Minute), Listeners: i})
	}

	got := m.List()
	for i := 0; i < len(got)-1; i++ {
		if got[i].Timestamp.After(got[i+1].Timestamp) {
			t.Fatalf("expected oldest-first order, got %+v", got)
		}
	}
}

func TestFetchListenerCount(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		mountPoint string
		wantCount  int
		wantErr    bool
	}{
		{
			name:       "single source object",
			body:       `{"icestats":{"source":{"listenurl":"http://x/high","listeners":4}}}`,
			mountPoint: "/high",
			wantCount:  4,
		},
		{
			name:       "array of sources picks the matching one",
			body:       `{"icestats":{"source":[{"listenurl":"http://x/low","listeners":1},{"listenurl":"http://x/high","listeners":9}]}}`,
			mountPoint: "/high",
			wantCount:  9,
		},
		{
			name:       "no matching source",
			body:       `{"icestats":{"source":{"listenurl":"http://x/low","listeners":1}}}`,
			mountPoint: "/high",
			wantErr:    true,
		},
		{
			name:       "malformed json",
			body:       `not json`,
			mountPoint: "/high",
			wantErr:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(tt.body))
			}))
			defer srv.Close()

			got, err := fetchListenerCount(srv.URL, tt.mountPoint)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected an error, got count=%d", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("fetchListenerCount: %v", err)
			}
			if got != tt.wantCount {
				t.Fatalf("expected %d listeners, got %d", tt.wantCount, got)
			}
		})
	}
}

func TestFetchListenerCountFailsOnRequestError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	if _, err := fetchListenerCount(srv.URL, "/high"); err == nil {
		t.Fatalf("expected an error on a non-200 response")
	}
}

func TestMetricsSampleOnceSkipsOnFetchFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	chat := NewChat()
	store := NewMetricsStore(filepath.Join(t.TempDir(), "metrics.json"))

	store.sampleOnce(chat, srv.URL, "/high")

	if got := store.List(); len(got) != 0 {
		t.Fatalf("expected no sample to be recorded when the listener count can't be determined, got %+v", got)
	}
}

func TestMetricsSampleOnceRecordsListenersAndChatters(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"icestats":{"source":{"listenurl":"http://x/high","listeners":5}}}`))
	}))
	defer srv.Close()

	chat := NewChat()
	// Directly populate a connected user so len(chat.users) > 0 without
	// standing up a real WebSocket connection.
	chat.mutex.Lock()
	chat.users["1"] = &Client{id: "1", role: "user"}
	chat.mutex.Unlock()

	store := NewMetricsStore(filepath.Join(t.TempDir(), "metrics.json"))
	store.sampleOnce(chat, srv.URL, "/high")

	got := store.List()
	if len(got) != 1 {
		t.Fatalf("expected 1 sample, got %d", len(got))
	}
	if got[0].Listeners != 5 || got[0].Chatters != 1 {
		t.Fatalf("expected listeners=5 chatters=1, got %+v", got[0])
	}
}

func TestMetricsSampleOnceIgnoresRadios(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"icestats":{"source":{"listenurl":"http://x/high","listeners":0}}}`))
	}))
	defer srv.Close()

	chat := NewChat()
	chat.mutex.Lock()
	chat.radios[&Client{id: "99", role: "radio"}] = struct{}{}
	chat.mutex.Unlock()

	store := NewMetricsStore(filepath.Join(t.TempDir(), "metrics.json"))
	store.sampleOnce(chat, srv.URL, "/high")

	got := store.List()
	if len(got) != 1 || got[0].Chatters != 0 {
		t.Fatalf("expected radio connections not to count as chatters, got %+v", got)
	}
}

func TestMetricsHandlerAuthAndShape(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "correct-key"
	chat := NewChat()
	store := NewMetricsStore(filepath.Join(t.TempDir(), "metrics.json"))
	sample := MetricSample{Timestamp: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), Listeners: 2, Chatters: 1}
	store.Append(sample)

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
			req := httptest.NewRequest(http.MethodPost, "/api/v1/metrics", strings.NewReader(string(body)))
			rec := httptest.NewRecorder()

			metricsHandler(chat, store, rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("expected status %d, got %d (body=%s)", tt.wantStatus, rec.Code, rec.Body.String())
			}
			if tt.wantStatus != http.StatusOK {
				return
			}
			var got []MetricSample
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			if len(got) != 1 || got[0].Listeners != sample.Listeners || got[0].Chatters != sample.Chatters {
				t.Fatalf("unexpected samples: %+v", got)
			}
		})
	}
}

func TestMetricsHandlerWrongMethod(t *testing.T) {
	chat := NewChat()
	store := NewMetricsStore(filepath.Join(t.TempDir(), "metrics.json"))

	for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodDelete} {
		req := httptest.NewRequest(method, "/api/v1/metrics", nil)
		rec := httptest.NewRecorder()

		metricsHandler(chat, store, rec, req)

		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s: expected status 405, got %d", method, rec.Code)
		}
	}
}

func TestLiveStatusHandlerAuthAndShape(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "correct-key"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"icestats":{"source":{"listenurl":"http://x/high","listeners":6}}}`))
	}))
	defer srv.Close()

	chat := NewChat()
	chat.mutex.Lock()
	chat.users["1"] = &Client{id: "1", role: "user"}
	chat.users["2"] = &Client{id: "2", role: "user"}
	chat.mutex.Unlock()

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
			req := httptest.NewRequest(http.MethodPost, "/api/v1/live-status", strings.NewReader(string(body)))
			rec := httptest.NewRecorder()

			liveStatusHandler(chat, srv.URL, "/high", rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("expected status %d, got %d (body=%s)", tt.wantStatus, rec.Code, rec.Body.String())
			}
			if tt.wantStatus != http.StatusOK {
				return
			}
			var got LiveStatus
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			if got.Listeners == nil || *got.Listeners != 6 || got.Chatters != 2 {
				t.Fatalf("expected listeners=6 chatters=2, got %+v", got)
			}
		})
	}
}

func TestLiveStatusHandlerListenersNullOnFetchFailure(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "correct-key"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	chat := NewChat()
	validTok := makeToken(t, GEWISSecret, 12345, "Alice", "User", time.Minute)
	body, err := json.Marshal(RadioKeyValidateRequest{Token: validTok, RadioKey: "correct-key"})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/live-status", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()

	liveStatusHandler(chat, srv.URL, "/high", rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200 even when the listener fetch fails, got %d", rec.Code)
	}
	var got LiveStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	// A failed fetch means "we don't know," not "zero" -- see LiveStatus's
	// doc comment. A nil Listeners is how that distinction survives JSON
	// encoding (omitted entirely would be indistinguishable from a bug that
	// forgot to set the field at all).
	if got.Listeners != nil {
		t.Fatalf("expected Listeners to be nil on a fetch failure, got %+v", *got.Listeners)
	}
	if got.Chatters != 0 {
		t.Fatalf("expected chatters=0, got %d", got.Chatters)
	}
}

func TestLiveStatusHandlerWrongMethod(t *testing.T) {
	chat := NewChat()

	for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodDelete} {
		req := httptest.NewRequest(method, "/api/v1/live-status", nil)
		rec := httptest.NewRecorder()

		liveStatusHandler(chat, "http://unused", "/high", rec, req)

		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s: expected status 405, got %d", method, rec.Code)
		}
	}
}

func TestMetricsHandlerMalformedJSON(t *testing.T) {
	chat := NewChat()
	store := NewMetricsStore(filepath.Join(t.TempDir(), "metrics.json"))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/metrics", strings.NewReader("not json"))
	rec := httptest.NewRecorder()

	metricsHandler(chat, store, rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", rec.Code)
	}
}
