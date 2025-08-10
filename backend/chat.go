package main

import (
	"encoding/json"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
)

type Client struct {
	conn *websocket.Conn
	role string
	id   string
}

type Message struct {
	From    string `json:"from"`
	To      string `json:"to,omitempty"`
	Content string `json:"content"`
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

	client := &Client{
		conn: conn,
		role: role,
		id:   r.RemoteAddr,
	}

	c.mutex.Lock()
	if role == "user" {
		c.users[client.id] = client
	} else {
		c.radios[client] = struct{}{}
	}
	c.mutex.Unlock()

	log.Info().Str("role", role).Str("id", client.id).Msg("Client connected")
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
		client.conn.Close()
		log.Info().Str("role", client.role).Str("id", client.id).Msg("Client disconnected")
	}()

	for {
		_, data, err := client.conn.ReadMessage()
		if err != nil {
			return
		}

		var msg Message
		if err := json.Unmarshal(data, &msg); err != nil {
			log.Warn().Err(err).Msg("invalid message")
			continue
		}
		msg.From = client.id

		if client.role == "user" {
			c.forwardToRadios(msg)
		} else {
			if msg.To == "" {
				continue
			}
			c.forwardToUser(msg.To, msg)
		}
	}
}

func (c *Chat) forwardToRadios(msg Message) {
	data, _ := json.Marshal(msg)
	c.mutex.Lock()
	defer c.mutex.Unlock()
	for r := range c.radios {
		_ = r.conn.WriteMessage(websocket.TextMessage, data)
	}
}

func (c *Chat) forwardToUser(userID string, msg Message) {
	data, _ := json.Marshal(msg)
	c.mutex.Lock()
	defer c.mutex.Unlock()
	if user, ok := c.users[userID]; ok {
		_ = user.conn.WriteMessage(websocket.TextMessage, data)
	}
}
