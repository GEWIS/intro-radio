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
	agenda := NewAgenda(filepath.Join(t.TempDir(), "agenda.json"))

	ts := httptest.NewUnstartedServer(newMux(chat, agenda))
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

func TestRadioKeyValidateHandler(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "correct-key"
	chat := NewChat()

	validTok := makeToken(t, GEWISSecret, 12345, "Alice", "User", time.Minute)
	zeroLidnrTok := makeToken(t, GEWISSecret, 0, "Nobody", "User", time.Minute)

	tests := []struct {
		name       string
		token      string
		radioKey   string
		wantStatus int
		wantValid  bool
	}{
		{"valid token and key", validTok, "correct-key", http.StatusOK, true},
		{"wrong key", validTok, "wrong-key", http.StatusUnauthorized, false},
		{"malformed token", "definitely-not-a-jwt", "correct-key", http.StatusUnauthorized, false},
		{"lidnr zero rejected", zeroLidnrTok, "correct-key", http.StatusUnauthorized, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, err := json.Marshal(RadioKeyValidateRequest{Token: tt.token, RadioKey: tt.radioKey})
			if err != nil {
				t.Fatalf("marshal request: %v", err)
			}
			req := httptest.NewRequest(http.MethodPost, "/api/v1/radio-key/validate", strings.NewReader(string(body)))
			rec := httptest.NewRecorder()

			radioKeyValidateHandler(chat, rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("expected status %d, got %d (body=%s)", tt.wantStatus, rec.Code, rec.Body.String())
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
				t.Fatalf("expected application/json content type, got %q", ct)
			}
			var got RadioKeyValidateResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			if got.Valid != tt.wantValid {
				t.Fatalf("expected valid=%v, got %v", tt.wantValid, got.Valid)
			}
		})
	}
}

func TestRadioKeyValidateHandlerWrongMethod(t *testing.T) {
	chat := NewChat()

	for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodDelete} {
		req := httptest.NewRequest(method, "/api/v1/radio-key/validate", nil)
		rec := httptest.NewRecorder()

		radioKeyValidateHandler(chat, rec, req)

		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s: expected status 405, got %d", method, rec.Code)
		}
	}
}

func TestRadioKeyValidateHandlerMalformedJSON(t *testing.T) {
	chat := NewChat()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/radio-key/validate", strings.NewReader("not json"))
	rec := httptest.NewRecorder()

	radioKeyValidateHandler(chat, rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", rec.Code)
	}
}

func TestRadioKeyValidateRouteRegistered(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "correct-key"
	chat := NewChat()
	agenda := NewAgenda(filepath.Join(t.TempDir(), "agenda.json"))
	mux := newMux(chat, agenda)

	tok := makeToken(t, GEWISSecret, 12345, "Alice", "User", time.Minute)
	body, err := json.Marshal(RadioKeyValidateRequest{Token: tok, RadioKey: "correct-key"})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/radio-key/validate", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	var got RadioKeyValidateResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if !got.Valid {
		t.Fatalf("expected valid=true, got %+v", got)
	}
}

func TestAgendaHandlerGet(t *testing.T) {
	agenda := NewAgenda(filepath.Join(t.TempDir(), "agenda.json"))
	if err := agenda.Load(); err != nil {
		t.Fatalf("Load: %v", err)
	}
	chat := NewChat()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/agenda", nil)
	rec := httptest.NewRecorder()

	agendaHandler(chat, agenda, rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	var got []AgendaEvent
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if len(got) != len(defaultAgendaEvents()) {
		t.Fatalf("expected the seeded default list, got %d events", len(got))
	}
}

func TestAgendaHandlerPut(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "correct-key"
	chat := NewChat()
	agenda := NewAgenda(filepath.Join(t.TempDir(), "agenda.json"))
	if err := agenda.Load(); err != nil {
		t.Fatalf("Load: %v", err)
	}

	validTok := makeToken(t, GEWISSecret, 12345, "Alice", "User", time.Minute)
	newEvent := AgendaEvent{Title: "New Event", Subtitle: "sub", Icon: "mdi-star", IconColor: "blue", Color: "#FFFFFF", ColorDark: "#000000", Date: "2026-01-01", Time: "9:00 - 10:00"}

	tests := []struct {
		name       string
		token      string
		radioKey   string
		events     []AgendaEvent
		wantStatus int
	}{
		{"valid token and key", validTok, "correct-key", []AgendaEvent{newEvent}, http.StatusOK},
		{"wrong key", validTok, "wrong-key", []AgendaEvent{newEvent}, http.StatusUnauthorized},
		{"invalid event", validTok, "correct-key", []AgendaEvent{{Title: ""}}, http.StatusBadRequest},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, err := json.Marshal(AgendaPutRequest{Token: tt.token, RadioKey: tt.radioKey, Events: tt.events})
			if err != nil {
				t.Fatalf("marshal request: %v", err)
			}
			req := httptest.NewRequest(http.MethodPut, "/api/v1/agenda", strings.NewReader(string(body)))
			rec := httptest.NewRecorder()

			agendaHandler(chat, agenda, rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("expected status %d, got %d (body=%s)", tt.wantStatus, rec.Code, rec.Body.String())
			}
		})
	}
}

func TestAgendaHandlerPutRejectsWithoutMutatingState(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "correct-key"
	chat := NewChat()
	agenda := NewAgenda(filepath.Join(t.TempDir(), "agenda.json"))
	if err := agenda.Load(); err != nil {
		t.Fatalf("Load: %v", err)
	}
	before := agenda.List()

	validTok := makeToken(t, GEWISSecret, 12345, "Alice", "User", time.Minute)
	body, err := json.Marshal(AgendaPutRequest{Token: validTok, RadioKey: "correct-key", Events: []AgendaEvent{{Title: ""}}})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	req := httptest.NewRequest(http.MethodPut, "/api/v1/agenda", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()

	agendaHandler(chat, agenda, rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", rec.Code)
	}
	after := agenda.List()
	if len(after) != len(before) || after[0].Title != before[0].Title {
		t.Fatalf("expected agenda state unchanged after a rejected PUT, before=%+v after=%+v", before, after)
	}
}

// TestAgendaHandlerPutWriteFailureReturns500 covers the other half of the
// split Replace() makes between bad input and a broken filesystem: a
// read-only agenda directory is a server fault, so it must not come back as
// a 400 telling the admin their perfectly valid event was rejected, and the
// response must not echo the agenda file's path back to them.
func TestAgendaHandlerPutWriteFailureReturns500(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "correct-key"
	chat := NewChat()

	dir := t.TempDir()
	agenda := NewAgenda(filepath.Join(dir, "agenda.json"))
	if err := agenda.Load(); err != nil {
		t.Fatalf("Load: %v", err)
	}
	makeDirUnwritable(t, dir)

	validTok := makeToken(t, GEWISSecret, 12345, "Alice", "User", time.Minute)
	valid := AgendaEvent{Title: "New Event", Subtitle: "sub", Icon: "mdi-star", IconColor: "blue", Color: "#FFFFFF", ColorDark: "#000000", Date: "2026-01-01", Time: "9:00 - 10:00"}
	body, err := json.Marshal(AgendaPutRequest{Token: validTok, RadioKey: "correct-key", Events: []AgendaEvent{valid}})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	req := httptest.NewRequest(http.MethodPut, "/api/v1/agenda", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()

	agendaHandler(chat, agenda, rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected status 500, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), dir) {
		t.Fatalf("expected the response body not to leak the agenda file's path, got %q", rec.Body.String())
	}
}

func TestAgendaHandlerWrongMethod(t *testing.T) {
	chat := NewChat()
	agenda := NewAgenda(filepath.Join(t.TempDir(), "agenda.json"))

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/agenda", nil)
	rec := httptest.NewRecorder()

	agendaHandler(chat, agenda, rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected status 405, got %d", rec.Code)
	}
}

func TestAgendaHandlerMalformedJSON(t *testing.T) {
	chat := NewChat()
	agenda := NewAgenda(filepath.Join(t.TempDir(), "agenda.json"))

	req := httptest.NewRequest(http.MethodPut, "/api/v1/agenda", strings.NewReader("not json"))
	rec := httptest.NewRecorder()

	agendaHandler(chat, agenda, rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", rec.Code)
	}
}

func TestNewMuxRoutesRegistered(t *testing.T) {
	chat := NewChat()
	agenda := NewAgenda(filepath.Join(t.TempDir(), "agenda.json"))
	mux := newMux(chat, agenda)

	for _, path := range []string{"/api/v1/health", "/api/v1/token", "/api/v1/radio", "/api/v1/agenda"} {
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
