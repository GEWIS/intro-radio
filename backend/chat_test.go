package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
)

// --- helpers ---

func startTestServer(t *testing.T, chat *Chat) (*httptest.Server, string) {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", chat.HandleWS)
	srv := httptest.NewServer(mux)
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	return srv, wsURL
}

func makeToken(t *testing.T, secret string, lidnr int, given, family string, ttl time.Duration) string {
	t.Helper()
	claims := GEWISClaims{
		Lidnr:      lidnr,
		GivenName:  given,
		FamilyName: family,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	j := jwt.NewWithClaims(jwt.SigningMethodHS512, claims)
	s, err := j.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return s
}

func dialAndHandshake(t *testing.T, wsBase string, role string, token string, radioKey string) *websocket.Conn {
	t.Helper()
	u, _ := url.Parse(wsBase)
	q := u.Query()
	q.Set("role", role)
	u.RawQuery = q.Encode()

	c, resp, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		if resp != nil {
			t.Fatalf("dial failed: %v, status=%d", err, resp.StatusCode)
		}
		t.Fatalf("dial failed: %v", err)
	}

	// First frame is the handshake message the server expects
	if role == "radio" {
		if err := c.WriteJSON(IncomingMessage{Token: token, RadioKey: radioKey}); err != nil {
			t.Fatalf("write radio handshake: %v", err)
		}
	} else {
		if err := c.WriteJSON(IncomingMessage{Token: token}); err != nil {
			t.Fatalf("write handshake: %v", err)
		}
	}
	return c
}

func readJSONWithDeadline[T any](t *testing.T, c *websocket.Conn, d time.Duration) (T, error) {
	t.Helper()
	var zero T
	_ = c.SetReadDeadline(time.Now().Add(d))
	_, data, err := c.ReadMessage()
	if err != nil {
		return zero, err
	}
	var v T
	if err := json.Unmarshal(data, &v); err != nil {
		return zero, err
	}
	return v, nil
}

// --- tests ---

func TestUserToRadioForwarding(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "ChangeMe"
	chat := NewChat()

	srv, wsBase := startTestServer(t, chat)
	defer srv.Close()

	userTok := makeToken(t, GEWISSecret, 12345, "Alice", "User", time.Minute)
	radioTok := makeToken(t, GEWISSecret, 99999, "Bob", "Radio", time.Minute)

	radio := dialAndHandshake(t, wsBase, "radio", radioTok, RADIOChatKey)
	defer radio.Close()

	// radio's own connect fires a presence broadcast (naming just itself);
	// drain it before the chat-forwarding assertion below, since that's not
	// what this test is checking.
	if _, err := readJSONWithDeadline[PresenceMessage](t, radio, 2*time.Second); err != nil {
		t.Fatalf("radio read initial presence: %v", err)
	}

	user := dialAndHandshake(t, wsBase, "user", userTok, "")
	defer user.Close()

	// Send from user -> expect radio to receive
	msg := IncomingMessage{Token: userTok, Content: "hi radio"}
	if err := user.WriteJSON(msg); err != nil {
		t.Fatalf("user write: %v", err)
	}

	out, err := readJSONWithDeadline[OutgoingMessage](t, radio, 2*time.Second)
	if err != nil {
		t.Fatalf("radio read: %v", err)
	}
	if out.From != "12345" || out.Content != "hi radio" || out.GivenName != "Alice" || out.FamilyName != "User" {
		t.Fatalf("unexpected message: %+v", out)
	}
}

func TestRadioToUserForwarding(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "ChangeMe"
	chat := NewChat()

	srv, wsBase := startTestServer(t, chat)
	defer srv.Close()

	userTok := makeToken(t, GEWISSecret, 22222, "Carol", "User", time.Minute)
	radioTok := makeToken(t, GEWISSecret, 33333, "Dave", "Radio", time.Minute)
	otherRadioTok := makeToken(t, GEWISSecret, 44444, "Erin", "Radio", time.Minute)

	user := dialAndHandshake(t, wsBase, "user", userTok, "")
	defer user.Close()

	radio := dialAndHandshake(t, wsBase, "radio", radioTok, RADIOChatKey)
	defer radio.Close()

	// radio's own connect fires a presence broadcast naming just itself.
	if _, err := readJSONWithDeadline[PresenceMessage](t, radio, 2*time.Second); err != nil {
		t.Fatalf("radio read initial presence: %v", err)
	}

	otherRadio := dialAndHandshake(t, wsBase, "radio", otherRadioTok, RADIOChatKey)
	defer otherRadio.Close()

	// otherRadio connecting triggers an updated (2-admin) broadcast to both
	// radios; drain radio's copy and otherRadio's own-connect copy so the
	// chat-forwarding assertions below read the actual chat messages, not
	// these presence updates.
	if _, err := readJSONWithDeadline[PresenceMessage](t, radio, 2*time.Second); err != nil {
		t.Fatalf("radio read updated presence: %v", err)
	}
	if _, err := readJSONWithDeadline[PresenceMessage](t, otherRadio, 2*time.Second); err != nil {
		t.Fatalf("otherRadio read initial presence: %v", err)
	}

	// Give the server a moment to finish registering all three connections;
	// otherwise the mirror below can race the otherRadio handshake and never
	// see it in c.radios.
	time.Sleep(100 * time.Millisecond)

	// Send from radio to user 22222
	msg := IncomingMessage{Token: radioTok, To: "22222", Content: "hello user"}
	if err := radio.WriteJSON(msg); err != nil {
		t.Fatalf("radio write: %v", err)
	}

	// The listener must only ever see the generic "radio" identity -- never
	// the replying staff member's real lidnr or name.
	out, err := readJSONWithDeadline[OutgoingMessage](t, user, 2*time.Second)
	if err != nil {
		t.Fatalf("user read: %v", err)
	}
	if out.From != "radio" || out.To != "22222" || out.Content != "hello user" {
		t.Fatalf("unexpected message to listener: %+v", out)
	}
	if out.GivenName != "" || out.FamilyName != "" {
		t.Fatalf("listener-bound message leaked staff identity: %+v", out)
	}

	// The mirrored copy to other radios keeps the real identity so
	// colleagues can tell who answered.
	mirrored, err := readJSONWithDeadline[OutgoingMessage](t, otherRadio, 2*time.Second)
	if err != nil {
		t.Fatalf("other radio read: %v", err)
	}
	if mirrored.From != "33333" || mirrored.To != "22222" || mirrored.Content != "hello user" {
		t.Fatalf("unexpected mirrored message: %+v", mirrored)
	}
	if mirrored.GivenName != "Dave" || mirrored.FamilyName != "Radio" {
		t.Fatalf("mirrored message missing staff identity: %+v", mirrored)
	}
}

func TestReconnectKicksOldWith4100(t *testing.T) {
	GEWISSecret = "testsecret"
	chat := NewChat()

	srv, wsBase := startTestServer(t, chat)
	defer srv.Close()

	tok := makeToken(t, GEWISSecret, 77777, "Eve", "User", time.Minute)

	// First connection for lidnr 77777
	c1 := dialAndHandshake(t, wsBase, "user", tok, "")
	defer c1.Close()

	// Start a waiter that expects the close from server with code 4100
	errCh := make(chan error, 1)
	go func() {
		_, _, err := c1.ReadMessage()
		errCh <- err
	}()

	// Second connection with the same lidnr triggers kick of c1
	c2 := dialAndHandshake(t, wsBase, "user", tok, "")
	defer c2.Close()

	select {
	case err := <-errCh:
		if err == nil {
			t.Fatal("expected close error on first connection")
		}
		if !websocket.IsCloseError(err, 4100) {
			// Some stacks surface 1006 if the TCP closes fast. Allow both but prefer 4100.
			if !(websocket.IsUnexpectedCloseError(err, 4100) && strings.Contains(err.Error(), "1006")) {
				t.Fatalf("expected close code 4100, got: %v", err)
			}
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for first connection to be closed")
	}
}

func TestCheckOriginAllowlist(t *testing.T) {
	GEWISSecret = "testsecret"
	chat := NewChat()

	srv, wsBase := startTestServer(t, chat)
	defer srv.Close()

	u, _ := url.Parse(wsBase)
	q := u.Query()
	q.Set("role", "user")
	u.RawQuery = q.Encode()

	tests := []struct {
		name      string
		origin    string
		wantAllow bool
	}{
		{"evil origin rejected", "https://evil.example.com", false},
		{"production origin accepted", "https://radio.gewis.nl", true},
		{"local dev origin accepted", "http://localhost:3000", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			header := http.Header{"Origin": []string{tt.origin}}
			c, resp, err := websocket.DefaultDialer.Dial(u.String(), header)

			if tt.wantAllow {
				if err != nil {
					t.Fatalf("expected upgrade to succeed for origin %q, got err=%v", tt.origin, err)
				}
				defer c.Close()
				return
			}

			if err == nil {
				c.Close()
				t.Fatalf("expected upgrade to fail for origin %q, but it succeeded", tt.origin)
			}
			if resp == nil || resp.StatusCode != http.StatusForbidden {
				t.Fatalf("expected 403 for origin %q, got resp=%+v err=%v", tt.origin, resp, err)
			}
		})
	}
}

func TestInvalidRoleRejected(t *testing.T) {
	GEWISSecret = "testsecret"
	chat := NewChat()

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", chat.HandleWS)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	// Try to dial with role=foo, expect HTTP 400 on upgrade
	u, _ := url.Parse("ws" + strings.TrimPrefix(srv.URL, "http") + "/ws")
	q := u.Query()
	q.Set("role", "foo")
	u.RawQuery = q.Encode()

	_, resp, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err == nil {
		t.Fatal("expected dial error for invalid role")
	}
	if resp == nil || resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got: %+v, err=%v", resp, err)
	}
}

func TestInvalidTokenHandshakeCloses(t *testing.T) {
	GEWISSecret = "testsecret"
	chat := NewChat()

	srv, wsBase := startTestServer(t, chat)
	defer srv.Close()

	// Dial as user and send a bad token in the handshake frame
	u, _ := url.Parse(wsBase)
	q := u.Query()
	q.Set("role", "user")
	u.RawQuery = q.Encode()

	c, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer c.Close()

	_ = c.WriteJSON(IncomingMessage{Token: "definitely-not-a-jwt"})

	// Server should close immediately
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, _, rerr := c.ReadMessage()
	if rerr == nil {
		t.Fatal("expected close after invalid token")
	}
}

func TestHandshakeReadDeadlineFires(t *testing.T) {
	GEWISSecret = "testsecret"
	chat := NewChat()
	// Set once, before the server (and any connection goroutines) start, so
	// there's no concurrent access to this field.
	chat.handshakeTimeout = 200 * time.Millisecond

	srv, wsBase := startTestServer(t, chat)
	defer srv.Close()

	u, _ := url.Parse(wsBase)
	q := u.Query()
	q.Set("role", "user")
	u.RawQuery = q.Encode()

	c, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer c.Close()

	// Deliberately never send the handshake frame. The server should give up
	// waiting and close the connection rather than hold it open forever.
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, _, rerr := c.ReadMessage()
	if rerr == nil {
		t.Fatal("expected connection to be closed after handshake timeout")
	}
}

func TestOversizedMessageRejected(t *testing.T) {
	GEWISSecret = "testsecret"
	chat := NewChat()

	srv, wsBase := startTestServer(t, chat)
	defer srv.Close()

	u, _ := url.Parse(wsBase)
	q := u.Query()
	q.Set("role", "user")
	u.RawQuery = q.Encode()

	c, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer c.Close()

	// Handshake frame that exceeds the server's read limit should get the
	// connection closed rather than accepted.
	oversized := IncomingMessage{
		Token:   makeToken(t, GEWISSecret, 12345, "Alice", "User", time.Minute),
		Content: strings.Repeat("a", maxMessageBytes+1),
	}
	if err := c.WriteJSON(oversized); err != nil {
		t.Fatalf("write oversized message: %v", err)
	}

	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, _, rerr := c.ReadMessage()
	if rerr == nil {
		t.Fatal("expected connection to be closed after oversized message")
	}
}

func TestInvalidLidnrRejected(t *testing.T) {
	GEWISSecret = "testsecret"
	chat := NewChat()

	srv, wsBase := startTestServer(t, chat)
	defer srv.Close()

	// lidnr of 0 must be rejected at handshake.
	tok := makeToken(t, GEWISSecret, 0, "Nobody", "User", time.Minute)
	c := dialAndHandshake(t, wsBase, "user", tok, "")
	defer c.Close()

	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, _, err := c.ReadMessage()
	if err == nil {
		t.Fatal("expected close after invalid lidnr")
	}
	if !websocket.IsCloseError(err, 4101) {
		if !(websocket.IsUnexpectedCloseError(err, 4101) && strings.Contains(err.Error(), "1006")) {
			t.Fatalf("expected close code 4101, got: %v", err)
		}
	}
}

func TestInvalidRadioKeyRejected(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "ChangeMe"
	chat := NewChat()

	srv, wsBase := startTestServer(t, chat)
	defer srv.Close()

	radioTok := makeToken(t, GEWISSecret, 44444, "Jack", "Radio", time.Minute)
	c := dialAndHandshake(t, wsBase, "radio", radioTok, "wrong-key")
	defer c.Close()

	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, _, err := c.ReadMessage()
	if err == nil {
		t.Fatal("expected close after invalid radio key")
	}
	if !websocket.IsCloseError(err, 4103) {
		if !(websocket.IsUnexpectedCloseError(err, 4103) && strings.Contains(err.Error(), "1006")) {
			t.Fatalf("expected close code 4103, got: %v", err)
		}
	}
}

func TestMalformedJSONHandshakeCloses(t *testing.T) {
	GEWISSecret = "testsecret"
	chat := NewChat()

	srv, wsBase := startTestServer(t, chat)
	defer srv.Close()

	u, _ := url.Parse(wsBase)
	q := u.Query()
	q.Set("role", "user")
	u.RawQuery = q.Encode()

	c, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer c.Close()

	// Not valid JSON at all.
	if err := c.WriteMessage(websocket.TextMessage, []byte("not json")); err != nil {
		t.Fatalf("write malformed handshake: %v", err)
	}

	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, _, rerr := c.ReadMessage()
	if rerr == nil {
		t.Fatal("expected close after malformed JSON handshake")
	}
}

func TestPresenceBroadcastOnConnectAndDisconnect(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "ChangeMe"
	chat := NewChat()

	srv, wsBase := startTestServer(t, chat)
	defer srv.Close()

	radio1Tok := makeToken(t, GEWISSecret, 11111, "Alice", "Admin", time.Minute)
	radio2Tok := makeToken(t, GEWISSecret, 22222, "Bob", "Admin", time.Minute)

	radio1 := dialAndHandshake(t, wsBase, "radio", radio1Tok, RADIOChatKey)
	defer radio1.Close()

	// radio1's own connect triggers a presence broadcast naming just itself.
	presence1, err := readJSONWithDeadline[PresenceMessage](t, radio1, 2*time.Second)
	if err != nil {
		t.Fatalf("radio1 read initial presence: %v", err)
	}
	if presence1.Type != "presence" || len(presence1.Admins) != 1 || presence1.Admins[0].ID != "11111" {
		t.Fatalf("unexpected initial presence: %+v", presence1)
	}

	radio2 := dialAndHandshake(t, wsBase, "radio", radio2Tok, RADIOChatKey)
	defer radio2.Close()

	// Both radios should now see an updated list of 2.
	presence1b, err := readJSONWithDeadline[PresenceMessage](t, radio1, 2*time.Second)
	if err != nil {
		t.Fatalf("radio1 read updated presence: %v", err)
	}
	if len(presence1b.Admins) != 2 {
		t.Fatalf("expected radio1 to see 2 admins, got: %+v", presence1b)
	}

	presence2, err := readJSONWithDeadline[PresenceMessage](t, radio2, 2*time.Second)
	if err != nil {
		t.Fatalf("radio2 read initial presence: %v", err)
	}
	if len(presence2.Admins) != 2 {
		t.Fatalf("expected radio2 to see 2 admins, got: %+v", presence2)
	}

	radio2.Close()

	// radio1 should see the list shrink back to 1 once radio2 disconnects.
	presence1c, err := readJSONWithDeadline[PresenceMessage](t, radio1, 2*time.Second)
	if err != nil {
		t.Fatalf("radio1 read presence after radio2 disconnect: %v", err)
	}
	if len(presence1c.Admins) != 1 || presence1c.Admins[0].ID != "11111" {
		t.Fatalf("expected radio1 to see just itself after radio2 disconnected, got: %+v", presence1c)
	}
}

func TestShutdownClosesConnectedClients(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "ChangeMe"
	chat := NewChat()

	srv, wsBase := startTestServer(t, chat)
	defer srv.Close()

	userTok := makeToken(t, GEWISSecret, 11111, "Hank", "User", time.Minute)
	radioTok := makeToken(t, GEWISSecret, 22222, "Ivy", "Radio", time.Minute)

	user := dialAndHandshake(t, wsBase, "user", userTok, "")
	defer user.Close()
	radio := dialAndHandshake(t, wsBase, "radio", radioTok, RADIOChatKey)
	defer radio.Close()

	// Drain radio's own-connect presence broadcast so the close-frame
	// assertion below observes the actual shutdown close, not this
	// unrelated message.
	if _, err := readJSONWithDeadline[PresenceMessage](t, radio, 2*time.Second); err != nil {
		t.Fatalf("radio read initial presence: %v", err)
	}

	// Give the server a moment to finish registering both connections
	// before triggering shutdown.
	time.Sleep(100 * time.Millisecond)

	chat.Shutdown()

	for name, c := range map[string]*websocket.Conn{"user": user, "radio": radio} {
		_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, _, err := c.ReadMessage()
		if err == nil {
			t.Fatalf("%s: expected connection to be closed after Shutdown", name)
		}
		if !websocket.IsCloseError(err, websocket.CloseGoingAway) {
			if !(websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway) && strings.Contains(err.Error(), "1006")) {
				t.Fatalf("%s: expected close code %d, got: %v", name, websocket.CloseGoingAway, err)
			}
		}
	}
}

// Optional: ensure goroutines have time to settle to reduce flakiness on CI
func TestMain(m *testing.M) {
	m.Run()
	// small wait for stray goroutines using httptest servers
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	<-ctx.Done()
}
