package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/signal"
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

// newMux wires up all HTTP and WebSocket routes on a fresh ServeMux, rather
// than registering on http.DefaultServeMux, so it can be constructed
// independently in tests.
func newMux(chat *Chat) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", chat.HandleWS)
	mux.HandleFunc("/api/v1/health", healthHandler)
	mux.HandleFunc("/api/v1/token", tokenHandler)
	mux.HandleFunc("/api/v1/radio", radioHandler)
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

	l, err := zerolog.ParseLevel(logLevel)
	if err != nil {
		log.Fatal().Err(err).Msg("could not parse level")
	}
	zerolog.SetGlobalLevel(l)

	srv := newHTTPServer(port, newMux(chat))

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
