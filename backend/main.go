package main

import (
	"encoding/json"
	"github.com/rs/zerolog/log"
	"net/http"
)

type RadioInfo struct {
	VideoURL string `json:"videoUrl"`
	AudioURL string `json:"audioUrl"`
}

func main() {
	port := String("PORT", ":8080")
	videoURL := String("RADIO_VIDEO_URL", "https://example.com/video")
	audioURL := String("RADIO_AUDIO_URL", "https://example.com/audio")

	chat := NewChat()

	http.HandleFunc("/ws", chat.HandleWS)

	http.HandleFunc("/api/v1/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	http.HandleFunc("/api/v1/radio", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(RadioInfo{
			VideoURL: videoURL,
			AudioURL: audioURL,
		})
	})

	log.Info().Str("port", port).Msg("Starting server")
	log.Fatal().Err(http.ListenAndServe(port, nil))
}
