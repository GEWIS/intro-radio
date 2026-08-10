package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

type RadioInfo struct {
	VideoURL        string `json:"videoUrl"`
	AudioURL        string `json:"audioUrl"`
	AudioMountPoint string `json:"audioMountPoint"`
	StartTime       string `json:"startTime"`
}

type RadioKeyValidateRequest struct {
	Token    string `json:"token"`
	RadioKey string `json:"radioKey"`
}

type RadioKeyValidateResponse struct {
	Valid bool `json:"valid"`
}

type AgendaPutRequest struct {
	Token    string        `json:"token"`
	RadioKey string        `json:"radioKey"`
	Events   []AgendaEvent `json:"events"`
}

var (
	port            = String("PORT", ":8080")
	videoURL        = String("RADIO_VIDEO_URL", "https://hd-auth.skylinewebcams.com/live.m3u8?a=2j5v70ov5ng6jq544ji0u6kjh3")
	audioURL        = String("RADIO_AUDIO_URL", "https://bata-radio.snt.utwente.nl")
	audioMountPoint = String("RADIO_AUDIO_MOUNT_POINT", "/high")
	radioStartTime  = String("RADIO_START_TIME", "2025-08-18T07:00:00Z")
	token           = String("RADIO_GEWIS_TOKEN", "gewis-radio")
	logLevel        = String("LOG_LEVEL", "trace")
)

// HTTP server timeouts. These only govern the plain HTTP request/response
// cycle: once a request is upgraded to a WebSocket, net/http hijacks the
// connection and stops applying ReadTimeout/WriteTimeout/IdleTimeout to it
// entirely (see net/http's conn.serve, which returns without further
// deadline management once the connection is hijacked). Long-lived /ws
// connections are therefore unaffected by these values; they rely on the
// handshake, pong-wait, and per-write deadlines managed in chat.go instead.
const (
	readHeaderTimeout = 10 * time.Second
	readTimeout       = 30 * time.Second
	writeTimeout      = 30 * time.Second
	idleTimeout       = 120 * time.Second
	shutdownTimeout   = 10 * time.Second
)

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}

func tokenHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(token)
}

func radioHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(RadioInfo{
		VideoURL:        videoURL,
		AudioURL:        audioURL,
		AudioMountPoint: audioMountPoint,
		StartTime:       radioStartTime,
	})
}

// radioKeyValidateHandler backs POST /api/v1/radio-key/validate. It gives
// the frontend's backoffice a real yes/no answer for a candidate radio key
// instead of the timing heuristic it previously relied on (open a WS,
// guess valid if the server hasn't closed it after 200ms). chat is threaded
// through explicitly (see newMux) rather than read from a package-level
// global, matching how HandleWS already carries its own Chat receiver.
//
// Success and failure both report Content-Type: application/json so
// callers can always decode a RadioKeyValidateResponse; the 401 case
// intentionally collapses "bad token", "bad lidnr", and "bad key" into the
// same {"valid":false} response so a caller can't use this endpoint as an
// oracle to work out which part of a guess was wrong.
func radioKeyValidateHandler(chat *Chat, w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req RadioKeyValidateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if !chat.VerifyRadioKey(req.Token, req.RadioKey) {
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(RadioKeyValidateResponse{Valid: false})
		return
	}
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(RadioKeyValidateResponse{Valid: true})
}

// agendaHandler backs both GET and PUT /api/v1/agenda. GET is public (the
// schedule is shown to every visitor on the landing page); PUT is gated by
// the same {token, radioKey} check radioKeyValidateHandler uses, reusing
// chat.VerifyRadioKey rather than duplicating it. The whole list is read
// and replaced in one shot -- see agenda.go's Agenda.Replace doc comment
// for why per-event IDs aren't needed at this scale.
func agendaHandler(chat *Chat, agenda *Agenda, w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		w.Header().Set("Content-Type", "application/json")
		// Admin edits must show up on the very next GET; without this, a
		// browser or intermediary cache could keep serving a stale
		// schedule after a PUT.
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(agenda.List())
	case http.MethodPut:
		var req AgendaPutRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if !chat.VerifyRadioKey(req.Token, req.RadioKey) {
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(RadioKeyValidateResponse{Valid: false})
			return
		}
		if err := agenda.Replace(req.Events); err != nil {
			// Only rejected input earns a 400 with its own message. A
			// write failure is our problem, not the caller's, and its
			// error text names the agenda file's path -- so that goes to
			// the log for an operator to act on and comes back as a bare
			// 500.
			var invalid *agendaValidationError
			if errors.As(err, &invalid) {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			log.Error().Err(err).Msg("could not persist the agenda")
			http.Error(w, "the server could not persist the agenda", http.StatusInternalServerError)
			return
		}
		_ = json.NewEncoder(w).Encode(agenda.List())
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// newMux wires up all HTTP and WebSocket routes on a fresh ServeMux, rather
// than registering on http.DefaultServeMux, so it can be constructed
// independently in tests.
func newMux(chat *Chat, agenda *Agenda) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", chat.HandleWS)
	mux.HandleFunc("/api/v1/health", healthHandler)
	mux.HandleFunc("/api/v1/token", tokenHandler)
	mux.HandleFunc("/api/v1/radio", radioHandler)
	mux.HandleFunc("/api/v1/radio-key/validate", func(w http.ResponseWriter, r *http.Request) {
		radioKeyValidateHandler(chat, w, r)
	})
	mux.HandleFunc("/api/v1/agenda", func(w http.ResponseWriter, r *http.Request) {
		agendaHandler(chat, agenda, w, r)
	})
	return mux
}

// newHTTPServer builds the *http.Server with explicit timeouts. See the
// const block above for why these are safe for long-lived /ws connections.
func newHTTPServer(addr string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
	}
}

func main() {
	chat := NewChat()

	// Set the log level before loading the agenda, so the agenda's own
	// startup logging below actually honours LOG_LEVEL.
	l, err := zerolog.ParseLevel(logLevel)
	if err != nil {
		log.Fatal().Err(err).Msg("could not parse level")
	}
	zerolog.SetGlobalLevel(l)

	agenda := NewAgenda(agendaFile)
	if err := agenda.Load(); err != nil {
		log.Fatal().Err(err).Msg("could not load agenda")
	}
	// Log where the agenda actually came from, not just that it loaded: an
	// AGENDA_FILE left at its relative default lands inside the container's
	// ephemeral filesystem, which silently discards every edit on redeploy.
	// That is invisible until someone notices their changes are gone, so
	// make the resolved path and event count a first-deploy log line.
	// filepath.Abs resolves the relative default against the working
	// directory (WORKDIR /data in the container) so the logged path is the
	// one that actually matters, not the literal env var value.
	resolvedPath := agendaFile
	if abs, err := filepath.Abs(agendaFile); err == nil {
		resolvedPath = abs
	}
	log.Info().Str("path", resolvedPath).Int("events", len(agenda.List())).Msg("agenda loaded")

	srv := newHTTPServer(port, newMux(chat, agenda))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serveErr := make(chan error, 1)
	go func() {
		log.Info().Str("port", port).Msg("Starting server")
		serveErr <- srv.ListenAndServe()
	}()

	select {
	case err := <-serveErr:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal().Err(err).Msg("server failed")
		}
	case <-ctx.Done():
		log.Info().Msg("shutdown signal received, shutting down gracefully")

		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Warn().Err(err).Msg("graceful shutdown did not complete cleanly")
		}

		// srv.Shutdown stops the listener and waits for in-flight plain
		// HTTP requests, but it does not touch hijacked connections (our
		// /ws clients) -- close those explicitly so deploys don't just
		// vanish on connected clients.
		chat.Shutdown()
	}
}
