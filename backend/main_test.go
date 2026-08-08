package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestServerTimeoutsDoNotKillWebSocket verifies the assumption behind
// newHTTPServer's timeouts (see the comment above the timeout consts in
// main.go): once a connection is upgraded to a WebSocket, net/http hijacks
// it and stops applying ReadTimeout/WriteTimeout/IdleTimeout. It configures
// timeouts far shorter than the idle period the connection sits through, so
// if that assumption were wrong, this test would fail with the connection
// closed underneath it.
func TestServerTimeoutsDoNotKillWebSocket(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "ChangeMe"
	chat := NewChat()

	ts := httptest.NewUnstartedServer(newMux(chat))
	ts.Config.ReadHeaderTimeout = 50 * time.Millisecond
	ts.Config.ReadTimeout = 50 * time.Millisecond
	ts.Config.WriteTimeout = 50 * time.Millisecond
	ts.Config.IdleTimeout = 50 * time.Millisecond
	ts.Start()
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"

	userTok := makeToken(t, GEWISSecret, 55555, "Frank", "User", time.Minute)
	user := dialAndHandshake(t, wsURL, "user", userTok, "")
	defer user.Close()

	// Sit idle for many multiples of every configured server timeout. This
	// connection (and the read loop handling it server-side) predates the
	// radio connection below, so registration-timing races on the server's
	// client map can't mask a real close here.
	time.Sleep(500 * time.Millisecond)

	radioTok := makeToken(t, GEWISSecret, 66666, "Gina", "Radio", time.Minute)
	radio := dialAndHandshake(t, wsURL, "radio", radioTok, RADIOChatKey)
	defer radio.Close()

	// Target the connection that has been sitting idle since before the
	// sleep. If the server-side deadlines on it had been clobbered by the
	// short http.Server timeouts above, its read loop would already have
	// exited and this delivery would never arrive.
	msg := IncomingMessage{Token: radioTok, To: "55555", Content: "still alive"}
	if err := radio.WriteJSON(msg); err != nil {
		t.Fatalf("radio write: %v", err)
	}

	out, err := readJSONWithDeadline[OutgoingMessage](t, user, 2*time.Second)
	if err != nil {
		t.Fatalf("user read after idle period (connection was killed): %v", err)
	}
	if out.Content != "still alive" {
		t.Fatalf("unexpected message: %+v", out)
	}
}

func TestHealthHandler(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)

	healthHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("expected application/json content type, got %q", ct)
	}
	if body := rec.Body.String(); body != `{"status":"ok"}` {
		t.Fatalf("unexpected body: %q", body)
	}
}

func TestTokenHandler(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/token", nil)

	tokenHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
	var got string
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if got != token {
		t.Fatalf("expected token %q, got %q", token, got)
	}
}

func TestRadioHandler(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/radio", nil)

	radioHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
	var got RadioInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	want := RadioInfo{
		VideoURL:        videoURL,
		AudioURL:        audioURL,
		AudioMountPoint: audioMountPoint,
		StartTime:       radioStartTime,
	}
	if got != want {
		t.Fatalf("expected %+v, got %+v", want, got)
	}
}

func TestNewMuxRoutesRegistered(t *testing.T) {
	chat := NewChat()
	mux := newMux(chat)

	for _, path := range []string{"/api/v1/health", "/api/v1/token", "/api/v1/radio"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: expected status 200, got %d", path, rec.Code)
		}
	}
}

func TestNewHTTPServerTimeouts(t *testing.T) {
	srv := newHTTPServer(":0", http.NewServeMux())

	if srv.ReadHeaderTimeout != readHeaderTimeout {
		t.Fatalf("ReadHeaderTimeout: expected %v, got %v", readHeaderTimeout, srv.ReadHeaderTimeout)
	}
	if srv.ReadTimeout != readTimeout {
		t.Fatalf("ReadTimeout: expected %v, got %v", readTimeout, srv.ReadTimeout)
	}
	if srv.WriteTimeout != writeTimeout {
		t.Fatalf("WriteTimeout: expected %v, got %v", writeTimeout, srv.WriteTimeout)
	}
	if srv.IdleTimeout != idleTimeout {
		t.Fatalf("IdleTimeout: expected %v, got %v", idleTimeout, srv.IdleTimeout)
	}
}
