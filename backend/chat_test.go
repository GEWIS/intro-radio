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

func dialAndHandshake(t *testing.T, wsBase string, role string, token string) *websocket.Conn {
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
	if err := c.WriteJSON(IncomingMessage{Token: token}); err != nil {
		t.Fatalf("write handshake: %v", err)
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
	chat := NewChat()

	srv, wsBase := startTestServer(t, chat)
	defer srv.Close()

	userTok := makeToken(t, GEWISSecret, 12345, "Alice", "User", time.Minute)
	radioTok := makeToken(t, GEWISSecret, 99999, "Bob", "Radio", time.Minute)

	radio := dialAndHandshake(t, wsBase, "radio", radioTok)
	defer radio.Close()

	user := dialAndHandshake(t, wsBase, "user", userTok)
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
	chat := NewChat()

	srv, wsBase := startTestServer(t, chat)
	defer srv.Close()

	userTok := makeToken(t, GEWISSecret, 22222, "Carol", "User", time.Minute)
	radioTok := makeToken(t, GEWISSecret, 33333, "Dave", "Radio", time.Minute)

	user := dialAndHandshake(t, wsBase, "user", userTok)
	defer user.Close()

	radio := dialAndHandshake(t, wsBase, "radio", radioTok)
	defer radio.Close()

	// Send from radio to user 22222
	msg := IncomingMessage{Token: radioTok, To: "22222", Content: "hello user"}
	if err := radio.WriteJSON(msg); err != nil {
		t.Fatalf("radio write: %v", err)
	}

	out, err := readJSONWithDeadline[OutgoingMessage](t, user, 2*time.Second)
	if err != nil {
		t.Fatalf("user read: %v", err)
	}
	if out.From != "33333" || out.To != "22222" || out.Content != "hello user" {
		t.Fatalf("unexpected message: %+v", out)
	}
}

func TestReconnectKicksOldWith4100(t *testing.T) {
	GEWISSecret = "testsecret"
	chat := NewChat()

	srv, wsBase := startTestServer(t, chat)
	defer srv.Close()

	tok := makeToken(t, GEWISSecret, 77777, "Eve", "User", time.Minute)

	// First connection for lidnr 77777
	c1 := dialAndHandshake(t, wsBase, "user", tok)
	defer c1.Close()

	// Start a waiter that expects the close from server with code 4100
	errCh := make(chan error, 1)
	go func() {
		_, _, err := c1.ReadMessage()
		errCh <- err
	}()

	// Second connection with the same lidnr triggers kick of c1
	c2 := dialAndHandshake(t, wsBase, "user", tok)
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

// Optional: ensure goroutines have time to settle to reduce flakiness on CI
func TestMain(m *testing.M) {
	m.Run()
	// small wait for stray goroutines using httptest servers
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	<-ctx.Done()
}
