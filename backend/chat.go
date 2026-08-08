package main

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
)

type Client struct {
	conn       *websocket.Conn
	role       string
	id         string // lidnr as string
	givenName  string
	familyName string

	writeMu sync.Mutex
}

func (cl *Client) writeMessage(mt int, data []byte) error {
	cl.writeMu.Lock()
	defer cl.writeMu.Unlock()
	_ = cl.conn.SetWriteDeadline(time.Now().Add(writeWait))
	return cl.conn.WriteMessage(mt, data)
}

func (cl *Client) writeControl(mt int, data []byte, deadline time.Duration) error {
	cl.writeMu.Lock()
	defer cl.writeMu.Unlock()
	return cl.conn.WriteControl(mt, data, time.Now().Add(deadline))
}

const (
	pingPeriod              = 25 * time.Second
	writeWait               = 10 * time.Second
	closeTimeout            = 1 * time.Second
	pongWait                = 60 * time.Second
	maxMessageBytes         = 32 * 1024
	defaultHandshakeTimeout = 10 * time.Second
)

type IncomingMessage struct {
	Token    string `json:"token"`              // ignored after handshake
	To       string `json:"to,omitempty"`       // target user id when role=radio
	Content  string `json:"content"`            // message body
	RadioKey string `json:"radioKey,omitempty"` // required in handshake when role=radio
}

type OutgoingMessage struct {
	From       string `json:"from"` // GEWIS mNummer
	GivenName  string `json:"given_name,omitempty"`
	FamilyName string `json:"family_name,omitempty"`
	To         string `json:"to,omitempty"`
	Content    string `json:"content"`
}

type GEWISClaims struct {
	Lidnr      int    `json:"lidnr"`
	GivenName  string `json:"given_name"`
	FamilyName string `json:"family_name"`
	jwt.RegisteredClaims
}

var (
	GEWISSecret  = String("GEWIS_SECRET", "ChangeMe")
	RADIOChatKey = String("RADIO_CHAT_KEY", "ChangeMe")

	// AllowedOrigins is the set of Origin header values NewChat's upgrader
	// accepts for WebSocket handshakes. It defaults to the production
	// frontend and the local Vite dev server; override with a
	// comma-separated ALLOWED_ORIGINS env var for other environments.
	AllowedOrigins = StringSlice("ALLOWED_ORIGINS", []string{
		"https://radio.gewis.nl",
		"http://localhost:3000",
	})
)

type Chat struct {
	upgrader websocket.Upgrader

	// handshakeTimeout bounds how long HandleWS waits for the handshake
	// frame after a successful upgrade. It lives on the instance (rather
	// than as a package-level constant) so tests can shrink it for a
	// single Chat without racing other connections that read it.
	handshakeTimeout time.Duration

	mutex  sync.Mutex
	users  map[string]*Client   // id -> client
	radios map[*Client]struct{} // radio connections
}

func NewChat() *Chat {
	return &Chat{
		upgrader: websocket.Upgrader{
			CheckOrigin: checkOriginAllowed,
		},
		handshakeTimeout: defaultHandshakeTimeout,
		users:            make(map[string]*Client),
		radios:           make(map[*Client]struct{}),
	}
}

// checkOriginAllowed implements websocket.Upgrader.CheckOrigin against
// AllowedOrigins. Requests with no Origin header (non-browser clients such
// as server-to-server callers or CLI tools) are let through, matching
// gorilla/websocket's own default same-origin check; browsers always send
// Origin on a WebSocket handshake, and that value must match the allowlist
// exactly.
func checkOriginAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	for _, allowed := range AllowedOrigins {
		if origin == allowed {
			return true
		}
	}
	return false
}

func (c *Chat) HandleWS(w http.ResponseWriter, r *http.Request) {
	role := r.URL.Query().Get("role")
	if role != "user" && role != "radio" {
		http.Error(w, "missing ?role=user or ?role=radio", http.StatusBadRequest)
		return
	}

	conn, err := c.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Warn().Err(err).Msg("websocket upgrade failed")
		return
	}

	// Bound the size of any single message (handshake included) to avoid
	// unbounded memory growth from a hostile or buggy client.
	conn.SetReadLimit(maxMessageBytes)

	// Bound how long we wait for the handshake frame so a client that
	// completes the upgrade and then never sends anything can't pin a
	// goroutine and socket forever.
	if err := conn.SetReadDeadline(time.Now().Add(c.handshakeTimeout)); err != nil {
		log.Warn().Err(err).Msg("failed to set handshake read deadline")
		_ = conn.Close()
		return
	}

	// Read first message as handshake
	_, data, err := conn.ReadMessage()
	if err != nil {
		_ = conn.Close()
		return
	}
	var first IncomingMessage
	if err := json.Unmarshal(data, &first); err != nil {
		log.Warn().Err(err).Msg("closing connection: invalid json")
		_ = conn.Close()
		return
	}

	// Handshake token verification: signature and alg only, expiry ignored
	claims, err := c.verifyGEWISTokenHandshake(first.Token)
	if err != nil {
		log.Warn().Err(err).Msg("closing connection: invalid token at handshake")
		_ = conn.Close()
		return
	}

	if claims.Lidnr <= 0 {
		_ = conn.WriteControl(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(4101, "invalid lidnr"),
			time.Now().Add(closeTimeout),
		)
		log.Warn().Int("lidnr", claims.Lidnr).Msg("closing connection: invalid lidnr")
		_ = conn.Close()
		return
	}

	if role == "radio" {
		if subtle.ConstantTimeCompare([]byte(first.RadioKey), []byte(RADIOChatKey)) != 1 {
			_ = conn.WriteControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(4103, "invalid radio key"),
				time.Now().Add(closeTimeout),
			)
			log.Warn().Msg("closing connection: invalid radio key")
			_ = conn.Close()
			return
		}
	}

	lid := strconv.Itoa(claims.Lidnr)
	client := &Client{
		conn:       conn,
		role:       role,
		id:         lid,
		givenName:  claims.GivenName,
		familyName: claims.FamilyName,
	}

	// Read deadlines and pong handling so dead peers are detected
	client.conn.SetReadDeadline(time.Now().Add(pongWait))
	client.conn.SetPongHandler(func(string) error {
		client.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	// Register client, replacing any existing session with same lidnr
	c.mutex.Lock()
	if role == "user" {
		if prev, ok := c.users[client.id]; ok && prev != nil && prev.conn != nil {
			_ = prev.writeControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(4100, "replaced by new connection"),
				closeTimeout,
			)
			log.Warn().Msg("replacing connection: replaced by new connection")
			_ = prev.conn.Close()
		}
		c.users[client.id] = client
	} else {
		c.radios[client] = struct{}{}
	}
	c.mutex.Unlock()

	log.Info().Str("role", role).Str("id", client.id).Msg("client connected")

	// Handshake frame should not be broadcast unless it contains data
	if strings.TrimSpace(first.Content) != "" || strings.TrimSpace(first.To) != "" {
		c.dispatch(client, first)
	}

	// Start ping loop
	go func(cl *Client) {
		ticker := time.NewTicker(pingPeriod)
		defer ticker.Stop()
		for range ticker.C {
			if err := cl.writeControl(websocket.PingMessage, nil, writeWait); err != nil {
				return
			}
		}
	}(client)

	// Continue with normal loop
	go c.handleClient(client)
}

func (c *Chat) handleClient(client *Client) {
	defer func() {
		c.mutex.Lock()
		if client.role == "user" {
			delete(c.users, client.id)
		} else if client.role == "radio" {
			delete(c.radios, client)
		}
		c.mutex.Unlock()
		_ = client.conn.Close()
		log.Info().Str("role", client.role).Str("id", client.id).Msg("client disconnected")
	}()

	for {
		_, data, err := client.conn.ReadMessage()
		if err != nil {
			return
		}
		var in IncomingMessage
		if err := json.Unmarshal(data, &in); err != nil {
			log.Warn().Err(err).Msg("invalid json")
			continue
		}
		// No token checks here by design
		c.dispatch(client, in)
	}
}

func (c *Chat) dispatch(client *Client, in IncomingMessage) {
	out := OutgoingMessage{
		From:       client.id,
		GivenName:  client.givenName,
		FamilyName: client.familyName,
		To:         in.To,
		Content:    in.Content,
	}

	if client.role == "user" {
		// User messages go to all radios
		c.forwardToRadios(out)
		return
	}

	// Radio messages
	if out.To != "" {
		// Send to the targeted user
		c.forwardToUser(out.To, out)
	}

	// Also mirror to other radios so fellow admins see it
	c.forwardToOtherRadios(client, out)
}

// Shutdown closes every currently connected client with a "going away"
// close frame. http.Server.Shutdown does not attempt to close or wait for
// hijacked connections such as WebSockets, so the caller (main) is
// responsible for notifying and closing them; this does that.
func (c *Chat) Shutdown() {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	closeMsg := websocket.FormatCloseMessage(websocket.CloseGoingAway, "server shutting down")
	for _, u := range c.users {
		_ = u.writeControl(websocket.CloseMessage, closeMsg, closeTimeout)
		_ = u.conn.Close()
	}
	for r := range c.radios {
		_ = r.writeControl(websocket.CloseMessage, closeMsg, closeTimeout)
		_ = r.conn.Close()
	}
}

func (c *Chat) forwardToRadios(msg OutgoingMessage) {
	log.Trace().Str("user", msg.From).Msg("forwarding message to radios")
	data, _ := json.Marshal(msg)
	c.mutex.Lock()
	defer c.mutex.Unlock()
	for r := range c.radios {
		log.Trace().Str("radio", r.id).Msg("forwarding message to radio")
		if err := r.writeMessage(websocket.TextMessage, data); err != nil {
			log.Warn().Err(err).Str("radio", r.id).Msg("failed to forward to radio, removing")
			_ = r.conn.Close()
			delete(c.radios, r)
		}
	}
	log.Trace().Str("user", msg.From).Msg("message forwarded to radios")
}

func (c *Chat) forwardToOtherRadios(sender *Client, msg OutgoingMessage) {
	log.Trace().Str("sender", sender.id).Msg("mirroring message to other radios")
	data, _ := json.Marshal(msg)
	c.mutex.Lock()
	defer c.mutex.Unlock()
	for r := range c.radios {
		if r == sender {
			continue
		}
		if err := r.writeMessage(websocket.TextMessage, data); err != nil {
			log.Warn().Err(err).Str("radio", r.id).Msg("failed to mirror to radio, removing")
			_ = r.conn.Close()
			delete(c.radios, r)
		}
	}
}

func (c *Chat) forwardToUser(userID string, msg OutgoingMessage) {
	data, _ := json.Marshal(msg)
	c.mutex.Lock()
	user, ok := c.users[userID]
	c.mutex.Unlock()
	log.Trace().Str("user", userID).Msg("trying to forward message to user")
	if ok {
		err := user.writeMessage(websocket.TextMessage, data)
		if err != nil {
			log.Warn().Err(err).Str("user", userID).Msg("failed to forward message to user")
			c.mutex.Lock()
			_ = user.conn.Close()
			delete(c.users, userID)
			c.mutex.Unlock()
		} else {
			log.Trace().Str("user", userID).Msg("message forwarded to user")
		}
	}
}

// verifyGEWISTokenHandshake verifies signature and algorithm only.
// Expiry is ignored. If present and in the past, it is logged but never rejected.
func (c *Chat) verifyGEWISTokenHandshake(tokenStr string) (*GEWISClaims, error) {
	if tokenStr == "" {
		return nil, errors.New("missing token")
	}
	claims := &GEWISClaims{}
	token, err := jwt.ParseWithClaims(
		tokenStr,
		claims,
		func(t *jwt.Token) (any, error) { return []byte(GEWISSecret), nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS512.Alg()}),
		jwt.WithoutClaimsValidation(), // skip time checks
	)
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, errors.New("invalid token")
	}

	// Optional visibility only
	if claims.ExpiresAt != nil && time.Now().After(claims.ExpiresAt.Time) {
		log.Warn().
			Int("lidnr", claims.Lidnr).
			Time("expired_at", claims.ExpiresAt.Time).
			Msg("GEWIS token expired at handshake, accepting anyway")
	}
	return claims, nil
}
