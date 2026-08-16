package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestStatusHandlerAuthAndShape(t *testing.T) {
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
	chat.radios[&Client{id: "3", role: "radio"}] = struct{}{}
	chat.mutex.Unlock()

	metrics := NewMetricsStore(filepath.Join(t.TempDir(), "metrics.json"))
	lastSample := time.Now().Add(-2 * time.Minute)
	metrics.Append(MetricSample{Timestamp: lastSample, Listeners: 5, Chatters: 1})

	startedAt := time.Now().Add(-90 * time.Second)
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
			req := httptest.NewRequest(http.MethodPost, "/api/v1/status", strings.NewReader(string(body)))
			rec := httptest.NewRecorder()

			statusHandler(chat, metrics, startedAt, srv.URL, "/high", rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("expected status %d, got %d (body=%s)", tt.wantStatus, rec.Code, rec.Body.String())
			}
			if tt.wantStatus != http.StatusOK {
				return
			}
			var got SystemStatus
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			if got.UptimeSeconds < 89 || got.UptimeSeconds > 120 {
				t.Fatalf("expected uptimeSeconds around 90, got %d", got.UptimeSeconds)
			}
			if got.ChatListeners != 2 {
				t.Fatalf("expected chatListeners=2, got %d", got.ChatListeners)
			}
			if got.ChatAdmins != 1 {
				t.Fatalf("expected chatAdmins=1, got %d", got.ChatAdmins)
			}
			if !got.IcecastReachable {
				t.Fatal("expected icecastReachable=true against a healthy fake Icecast server")
			}
			if got.LastMetricsSampleAt == nil || !got.LastMetricsSampleAt.Equal(lastSample) {
				t.Fatalf("expected lastMetricsSampleAt=%v, got %+v", lastSample, got.LastMetricsSampleAt)
			}
		})
	}
}

func TestStatusHandlerIcecastUnreachable(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "correct-key"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	chat := NewChat()
	metrics := NewMetricsStore(filepath.Join(t.TempDir(), "metrics.json"))
	validTok := makeToken(t, GEWISSecret, 12345, "Alice", "User", time.Minute)
	body, err := json.Marshal(RadioKeyValidateRequest{Token: validTok, RadioKey: "correct-key"})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/status", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()

	statusHandler(chat, metrics, time.Now(), srv.URL, "/high", rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200 even when Icecast is unreachable, got %d", rec.Code)
	}
	var got SystemStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if got.IcecastReachable {
		t.Fatal("expected icecastReachable=false against an unhealthy fake Icecast server")
	}
}

func TestStatusHandlerNoMetricsSamplesYet(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "correct-key"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	chat := NewChat()
	metrics := NewMetricsStore(filepath.Join(t.TempDir(), "metrics.json")) // never Append()ed to
	validTok := makeToken(t, GEWISSecret, 12345, "Alice", "User", time.Minute)
	body, err := json.Marshal(RadioKeyValidateRequest{Token: validTok, RadioKey: "correct-key"})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/status", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()

	statusHandler(chat, metrics, time.Now(), srv.URL, "/high", rec, req)

	var got SystemStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if got.LastMetricsSampleAt != nil {
		t.Fatalf("expected lastMetricsSampleAt=nil with no samples recorded yet, got %+v", got.LastMetricsSampleAt)
	}
}

func TestStatusHandlerWrongMethod(t *testing.T) {
	chat := NewChat()
	metrics := NewMetricsStore(filepath.Join(t.TempDir(), "metrics.json"))

	for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodDelete} {
		req := httptest.NewRequest(method, "/api/v1/status", nil)
		rec := httptest.NewRecorder()

		statusHandler(chat, metrics, time.Now(), "http://example.invalid", "/high", rec, req)

		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s: expected status 405, got %d", method, rec.Code)
		}
	}
}
