package main

import (
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
