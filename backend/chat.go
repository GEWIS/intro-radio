package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
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
	pingPeriod   = 25 * time.Second
	writeWait    = 10 * time.Second
	closeTimeout = 1 * time.Second
	pongWait     = 60 * time.Second
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
	GEWISSecret  = envOr("GEWIS_SECRET", "ChangeMe")
	RADIOChatKey = envOr("RADIO_CHAT_KEY", "ChangeMe")
)

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

type Chat struct {
	upgrader websocket.Upgrader

	mutex  sync.Mutex
	users  map[string]*Client   // id -> client
	radios map[*Client]struct{} // radio connections
}

func NewChat() *Chat {
	return &Chat{
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
		users:  make(map[string]*Client),
		radios: make(map[*Client]struct{}),
	}
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

	if role == "radio" {
		if RADIOChatKey == "" || first.RadioKey != RADIOChatKey {
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
		c.forwardToRadios(out)
		return
	}
	if out.To == "" {
		return
	}
	c.forwardToUser(out.To, out)
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
