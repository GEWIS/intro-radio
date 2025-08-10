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
	role string // "user" or "radio"
	id   string // e.g., remote address
}

type Message struct {
	From    string `json:"from"`
	To      string `json:"to,omitempty"`
	Content string `json:"content"`
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

var (
	port = String("PORT", ":8080")

	mutex  sync.Mutex
	users  = make(map[string]*Client) // id → client
	radios = make(map[*Client]bool)
)

func main() {
	http.HandleFunc("/ws", handleWS)
	log.Info().Str("port", port).Msg("Starting server")
	log.Fatal().Err(http.ListenAndServe(port, nil))
}

func handleWS(w http.ResponseWriter, r *http.Request) {
	role := r.URL.Query().Get("role")
	if role != "user" && role != "radio" {
		http.Error(w, "missing ?role=user or ?role=radio", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Warn().Err(err).Msg("websocket upgrade failed")
		return
	}

	client := &Client{
		conn: conn,
		role: role,
		id:   r.RemoteAddr,
	}

	if role == "user" {
		mutex.Lock()
		users[client.id] = client
		mutex.Unlock()
	} else {
		mutex.Lock()
		radios[client] = true
		mutex.Unlock()
	}

	log.Info().Str("role", role).Str("id", client.id).Msg("Client connected")

	go handleClient(client)
}

func handleClient(c *Client) {
	defer func() {
		mutex.Lock()
		if c.role == "user" {
			delete(users, c.id)
		} else {
			delete(radios, c)
		}
		mutex.Unlock()
		c.conn.Close()
		log.Info().Str("role", c.role).Str("id", c.id).Msg("Client disconnected")
	}()

	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			return
		}

		var msg Message
		if err := json.Unmarshal(data, &msg); err != nil {
			log.Warn().Err(err).Msg("Invalid message")
			continue
		}

		msg.From = c.id

		if c.role == "user" {
			// Send to all radios
			forwardToRadios(msg)
		} else {
			// Must specify target user
			if msg.To == "" {
				continue
			}
			forwardToUser(msg.To, msg)
		}
	}
}

func forwardToRadios(msg Message) {
	data, _ := json.Marshal(msg)
	mutex.Lock()
	defer mutex.Unlock()
	for r := range radios {
		r.conn.WriteMessage(websocket.TextMessage, data)
	}
}

func forwardToUser(userID string, msg Message) {
	data, _ := json.Marshal(msg)
	mutex.Lock()
	defer mutex.Unlock()
	if user, ok := users[userID]; ok {
		user.conn.WriteMessage(websocket.TextMessage, data)
	}
}
