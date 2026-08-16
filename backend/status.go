package main

import (
	"encoding/json"
	"net/http"
	"time"
)

// SystemStatus is a snapshot answer to "is anything actually broken right
// now" -- distinct from LiveStatus (audience-facing listener/chatter
// counts) and from MetricsStore's own periodic history, this is meant for
// a quick operational gut-check: has the process been up, is the
// background sampler still ticking, and can we actually reach Icecast at
// this instant.
type SystemStatus struct {
	UptimeSeconds       int64      `json:"uptimeSeconds"`
	ChatListeners       int        `json:"chatListeners"`
	ChatAdmins          int        `json:"chatAdmins"`
	LastMetricsSampleAt *time.Time `json:"lastMetricsSampleAt"`
	IcecastReachable    bool       `json:"icecastReachable"`
}

// statusHandler backs POST /api/v1/status, gated by the same {token,
// radioKey} check every other backoffice-only endpoint uses.
// IcecastReachable is a live fetch (like liveStatusHandler's listener
// count), not a cached flag -- this endpoint exists specifically to answer
// "right now," not "as of the last periodic sample." LastMetricsSampleAt
// comes for free from metrics.List()'s own last entry rather than tracking
// separate state on MetricsStore for it.
func statusHandler(chat *Chat, metrics *MetricsStore, startedAt time.Time, baseURL, mountPoint string, w http.ResponseWriter, r *http.Request) {
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

	chat.mutex.Lock()
	listeners := len(chat.users)
	admins := len(chat.radios)
	chat.mutex.Unlock()

	var lastSampleAt *time.Time
	if samples := metrics.List(); len(samples) > 0 {
		ts := samples[len(samples)-1].Timestamp
		lastSampleAt = &ts
	}

	_, icecastErr := fetchListenerCount(baseURL, mountPoint)

	status := SystemStatus{
		UptimeSeconds:       int64(time.Since(startedAt).Seconds()),
		ChatListeners:       listeners,
		ChatAdmins:          admins,
		LastMetricsSampleAt: lastSampleAt,
		IcecastReachable:    icecastErr == nil,
	}
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(status)
}
