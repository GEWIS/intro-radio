package main

import (
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
	conn *websocket.Conn
	role string
	id   string
}

type IncomingMessage struct {
	Token    string `json:"token"`              // required on every message
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
)

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

	// Read first message as handshake to extract lidnr
	_, data, err := conn.ReadMessage()
	if err != nil {
		_ = conn.Close()
		return
	}
	var first IncomingMessage
	if err := json.Unmarshal(data, &first); err != nil {
		_ = conn.Close()
		return
	}
	claims, err := c.verifyGEWISToken(first.Token)
	if err != nil {
		_ = conn.Close()
		return
	}

	if role == "radio" {
		if RADIOChatKey == "" || first.RadioKey != RADIOChatKey {
			_ = conn.WriteControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(4103, "invalid radio key"),
				time.Now().Add(time.Second),
			)
			_ = conn.Close()
			return
		}
	}

	lid := strconv.Itoa(claims.Lidnr)

	client := &Client{
		conn: conn,
		role: role,
		id:   lid, // stable id = lidnr
	}

	// Register client, replacing any existing session with same lidnr
	c.mutex.Lock()
	if role == "user" {
		if prev, ok := c.users[client.id]; ok && prev != nil && prev.conn != nil {
			_ = prev.conn.WriteControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(4100, "replaced by new connection"),
				time.Now().Add(time.Second),
			)
			_ = prev.conn.Close()
		}
		c.users[client.id] = client
	} else {
		c.radios[client] = struct{}{}
	}
	c.mutex.Unlock()

	log.Info().Str("role", role).Str("id", client.id).Msg("Client connected")

	// Handshake frame should not be broadcast unless it contains data
	if strings.TrimSpace(first.Content) != "" || strings.TrimSpace(first.To) != "" {
		c.dispatch(client, first, claims)
	}

	// Continue with normal loop
	go c.handleClient(client)
}

func (c *Chat) handleClient(client *Client) {
	defer func() {
		c.mutex.Lock()
		if client.role == "user" {
			delete(c.users, client.id)
		} else {
			delete(c.radios, client)
		}
		c.mutex.Unlock()
		_ = client.conn.Close()
		log.Info().Str("role", client.role).Str("id", client.id).Msg("Client disconnected")
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
		claims, err := c.verifyGEWISToken(in.Token) // keep strict auth per message
		if err != nil {
			log.Warn().Err(err).Msg("invalid GEWIS token")
			continue
		}
		c.dispatch(client, in, claims)
	}
}

func (c *Chat) dispatch(client *Client, in IncomingMessage, claims *GEWISClaims) {
	out := OutgoingMessage{
		From:       strconv.Itoa(claims.Lidnr),
		GivenName:  claims.GivenName,
		FamilyName: claims.FamilyName,
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
	data, _ := json.Marshal(msg)
	c.mutex.Lock()
	defer c.mutex.Unlock()
	for r := range c.radios {
		_ = r.conn.WriteMessage(websocket.TextMessage, data)
	}
}

func (c *Chat) forwardToUser(userID string, msg OutgoingMessage) {
	data, _ := json.Marshal(msg)
	c.mutex.Lock()
	defer c.mutex.Unlock()
	if user, ok := c.users[userID]; ok {
		_ = user.conn.WriteMessage(websocket.TextMessage, data)
	}
}

func (c *Chat) verifyGEWISToken(tokenStr string) (*GEWISClaims, error) {
	if tokenStr == "" {
		return nil, errors.New("missing token")
	}
	claims := &GEWISClaims{}
	token, err := jwt.ParseWithClaims(
		tokenStr,
		claims,
		func(t *jwt.Token) (any, error) { return []byte(GEWISSecret), nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS512.Alg()}),
		jwt.WithLeeway(15*time.Second),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}
