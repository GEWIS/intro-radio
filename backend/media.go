package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// MediaItem is one uploaded photo or voice memo. Purpose discriminates the
// two use cases that share this one storage backbone -- a picture attached
// to an ongoing chat conversation (chat_attachment) versus a standalone
// submission for staff to review later (segment_suggestion). See
// docs/superpowers/specs/2026-08-16-media-attachments-design.md for why
// these need different treatment despite sharing one struct.
type MediaItem struct {
	ID               string    `json:"id"`
	Purpose          string    `json:"purpose"`
	Kind             string    `json:"kind"`
	SenderLidnr      int       `json:"senderLidnr"`
	SenderGivenName  string    `json:"senderGivenName"`
	SenderFamilyName string    `json:"senderFamilyName"`
	Caption          string    `json:"caption,omitempty"`
	MimeType         string    `json:"mimeType"`
	SizeBytes        int64     `json:"sizeBytes"`
	DurationSeconds  float64   `json:"durationSeconds,omitempty"`
	CreatedAt        time.Time `json:"createdAt"`
}

const (
	MediaPurposeChatAttachment    = "chat_attachment"
	MediaPurposeSegmentSuggestion = "segment_suggestion"

	MediaKindPhoto = "photo"
	MediaKindVoice = "voice"
)

// MediaStore holds the metadata index (small, always fully loaded) and
// manages the raw files on disk (one per item, named by id, under
// mediaDir). Mirrors AuditLog/MetricsStore's mutex-guarded,
// file-backed-JSON idiom, split into two files because unlike a text-only
// audit entry, an item here carries a real payload of arbitrary size that
// has no business being re-marshaled as JSON on every read.
type MediaStore struct {
	mutex     sync.Mutex
	items     []MediaItem
	indexPath string
	mediaDir  string
}

func NewMediaStore(indexPath, mediaDir string) *MediaStore {
	return &MediaStore{indexPath: indexPath, mediaDir: mediaDir}
}

// Load reads the metadata index from disk, tolerating a missing file
// exactly like MetricsStore.Load/AuditLog.Load do -- a fresh deploy starts
// with an empty index instead of failing to boot.
func (m *MediaStore) Load() error {
	data, err := os.ReadFile(m.indexPath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("reading media index: %w", err)
	}

	var items []MediaItem
	if err := json.Unmarshal(data, &items); err != nil {
		return fmt.Errorf("parsing media index: %w", err)
	}

	m.mutex.Lock()
	m.items = items
	m.mutex.Unlock()
	return nil
}

// List returns a copy of every item, both purposes, oldest first (append
// order). Callers filter by Purpose themselves -- this store is a dumb
// generic index, not purpose-aware.
func (m *MediaStore) List() []MediaItem {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	out := make([]MediaItem, len(m.items))
	copy(out, m.items)
	return out
}

// Get returns the item with the given id, or ok=false if none exists.
func (m *MediaStore) Get(id string) (MediaItem, bool) {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	for _, item := range m.items {
		if item.ID == id {
			return item, true
		}
	}
	return MediaItem{}, false
}

// Add appends item to the index and writes data to disk as its
// corresponding file. Both happen under the same lock so a concurrent List
// can never observe metadata for a file that isn't there yet.
func (m *MediaStore) Add(item MediaItem, data []byte) error {
	if err := os.MkdirAll(m.mediaDir, 0o755); err != nil {
		return fmt.Errorf("creating media directory: %w", err)
	}
	if err := os.WriteFile(m.filePath(item.ID), data, 0o644); err != nil {
		return fmt.Errorf("writing media file: %w", err)
	}

	m.mutex.Lock()
	m.items = append(m.items, item)
	snapshot := make([]MediaItem, len(m.items))
	copy(snapshot, m.items)
	m.mutex.Unlock()

	return writeJSONFile(m.indexPath, snapshot)
}

// ReadBytes returns the raw file contents for id. Returns an error if id is
// not a known item in the index, preventing path-traversal attacks even if
// the caller hasn't validated id themselves.
func (m *MediaStore) ReadBytes(id string) ([]byte, error) {
	m.mutex.Lock()
	found := false
	for _, item := range m.items {
		if item.ID == id {
			found = true
			break
		}
	}
	m.mutex.Unlock()

	if !found {
		return nil, fmt.Errorf("no media item with id %q", id)
	}

	data, err := os.ReadFile(m.filePath(id))
	if err != nil {
		return nil, fmt.Errorf("reading media file: %w", err)
	}
	return data, nil
}

// Delete removes both the metadata entry and the underlying file for id. A
// missing file is not an error -- the metadata is still removed either way,
// so a prior partial failure can't leave an item permanently stuck.
func (m *MediaStore) Delete(id string) error {
	m.mutex.Lock()
	kept := make([]MediaItem, 0, len(m.items))
	found := false
	for _, item := range m.items {
		if item.ID == id {
			found = true
			continue
		}
		kept = append(kept, item)
	}
	m.items = kept
	snapshot := make([]MediaItem, len(kept))
	copy(snapshot, kept)
	m.mutex.Unlock()

	if !found {
		return fmt.Errorf("no media item with id %q", id)
	}

	if err := os.Remove(m.filePath(id)); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("removing media file: %w", err)
	}
	return writeJSONFile(m.indexPath, snapshot)
}

// DeleteMany deletes every id in ids that actually exists, ignoring ids
// that don't (already gone, or never existed) rather than failing the
// whole batch over one bad id. Returns the ids actually removed.
func (m *MediaStore) DeleteMany(ids []string) []string {
	removed := make([]string, 0, len(ids))
	for _, id := range ids {
		if err := m.Delete(id); err == nil {
			removed = append(removed, id)
		}
	}
	return removed
}

func (m *MediaStore) filePath(id string) string {
	return filepath.Join(m.mediaDir, id)
}

const (
	// chatAttachmentTTL is how long a chat_attachment item survives before
	// the background sweep removes it. There is no delete/download UI for
	// these (see AdminChat.vue), so without this they would accumulate on
	// disk forever with no way to remove them -- segment_suggestion items
	// are never touched by this, since they have a real management UI
	// (the Media tab) and the manual-only retention that implies.
	chatAttachmentTTL = 48 * time.Hour

	// mediaSweepInterval is frequent enough relative to a 48h TTL that an
	// expired item is never more than half an hour late to be cleaned up.
	mediaSweepInterval = 30 * time.Minute
)

// sweepExpiredChatAttachments removes every chat_attachment item whose
// CreatedAt is more than chatAttachmentTTL before now, and returns the ids
// removed. now is an explicit parameter (not time.Now() inline) so tests
// can control it precisely.
func (m *MediaStore) sweepExpiredChatAttachments(now time.Time) []string {
	m.mutex.Lock()
	var expired []string
	for _, item := range m.items {
		if item.Purpose != MediaPurposeChatAttachment {
			continue
		}
		if now.Sub(item.CreatedAt) > chatAttachmentTTL {
			expired = append(expired, item.ID)
		}
	}
	m.mutex.Unlock()

	return m.DeleteMany(expired)
}

// RunSweep ticks every mediaSweepInterval and sweeps expired chat
// attachments each time, blocking until done is closed. Mirrors
// MetricsStore.Run's ticker/select shape.
func (m *MediaStore) RunSweep(done <-chan struct{}) {
	ticker := time.NewTicker(mediaSweepInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			m.sweepExpiredChatAttachments(time.Now())
		case <-done:
			return
		}
	}
}

const (
	maxPhotoBytes = 15 * 1024 * 1024 // 15MB
	maxVoiceBytes = 10 * 1024 * 1024 // 10MB
	// maxUploadBytes bounds the request body http.MaxBytesReader allows
	// before either per-kind check below even runs -- the larger of the two
	// kind-specific caps, so a legitimate large photo isn't rejected by the
	// generic reader before reaching the kind-specific message.
	maxUploadBytes = maxPhotoBytes
)

var allowedPhotoMimeTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/webp": true,
}

var allowedVoiceMimeTypes = map[string]bool{
	"audio/webm": true,
	"audio/ogg":  true,
	"audio/mpeg": true,
}

// MediaBroadcast notifies connected radios that a segment_suggestion item
// was created or deleted, purely so the Media tab knows to refetch its
// list. Follows the same Type-discriminated pattern as PresenceMessage/
// TypingMessage in chat.go: a distinct shape on the same socket, not a
// message belonging to any listener thread, so it is never sent via
// forwardToUser.
type MediaBroadcast struct {
	Type  string `json:"type"` // always "media"
	Event string `json:"event"` // "new" | "deleted"
	ID    string `json:"id"`
	Kind  string `json:"kind,omitempty"` // present on "new"
}

// broadcastMediaEvent mirrors forwardToRadios' loop, defined here rather
// than in chat.go so this feature's code stays in one file -- Go methods
// don't need to live in the same file as their receiver's type definition.
func (c *Chat) broadcastMediaEvent(msg MediaBroadcast) {
	data, _ := json.Marshal(msg)
	c.mutex.Lock()
	defer c.mutex.Unlock()
	for r := range c.radios {
		if err := r.writeMessage(websocket.TextMessage, data); err != nil {
			_ = r.conn.Close()
			delete(c.radios, r)
		}
	}
}

// mediaUploadHandler backs POST /api/v1/media. Auth is the GEWIS token
// only (no radio key) -- both a chat attachment and a segment suggestion
// are listener-submitted, mirroring how the chat WebSocket's role=user
// handshake needs only that same token.
func mediaUploadHandler(chat *Chat, store *MediaStore, w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		http.Error(w, "upload too large or malformed", http.StatusBadRequest)
		return
	}

	claims, err := chat.verifyGEWISTokenHandshake(r.FormValue("token"))
	if err != nil || !lidnrValid(claims) {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	purpose := r.FormValue("purpose")
	kind := r.FormValue("kind")
	if purpose != MediaPurposeChatAttachment && purpose != MediaPurposeSegmentSuggestion {
		http.Error(w, "invalid purpose", http.StatusBadRequest)
		return
	}
	if kind != MediaKindPhoto && kind != MediaKindVoice {
		http.Error(w, "invalid kind", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "missing file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	mimeType := header.Header.Get("Content-Type")
	maxBytes := int64(maxPhotoBytes)
	allowed := allowedPhotoMimeTypes
	if kind == MediaKindVoice {
		maxBytes = maxVoiceBytes
		allowed = allowedVoiceMimeTypes
	}
	if !allowed[mimeType] {
		http.Error(w, fmt.Sprintf("unsupported content type %q for kind %q", mimeType, kind), http.StatusBadRequest)
		return
	}

	data, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "could not read upload", http.StatusBadRequest)
		return
	}
	if int64(len(data)) > maxBytes {
		http.Error(w, fmt.Sprintf("file exceeds the %d byte limit for kind %q", maxBytes, kind), http.StatusBadRequest)
		return
	}

	item := MediaItem{
		ID:               uuid.NewString(),
		Purpose:          purpose,
		Kind:             kind,
		SenderLidnr:      claims.Lidnr,
		SenderGivenName:  claims.GivenName,
		SenderFamilyName: claims.FamilyName,
		Caption:          strings.TrimSpace(r.FormValue("caption")),
		MimeType:         mimeType,
		SizeBytes:        int64(len(data)),
		CreatedAt:        time.Now(),
	}

	if err := store.Add(item, data); err != nil {
		http.Error(w, "could not save upload", http.StatusInternalServerError)
		return
	}

	if purpose == MediaPurposeChatAttachment {
		chat.forwardToRadios(OutgoingMessage{
			From:       strconv.Itoa(item.SenderLidnr), // OutgoingMessage.From is always the lidnr as a string -- see dispatch()'s own `From: client.id`, where client.id is strconv.Itoa(claims.Lidnr)
			GivenName:  item.SenderGivenName,
			FamilyName: item.SenderFamilyName,
			MediaID:    item.ID,
			MediaKind:  item.Kind,
		})
	} else {
		chat.broadcastMediaEvent(MediaBroadcast{Type: "media", Event: "new", ID: item.ID, Kind: item.Kind})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

// MediaIDRequest is the shared {token, radioKey, id} shape for
// download/delete. Mirrors RadioKeyValidateRequest's own {token, radioKey}
// (defined in main.go), extended with the one field each of these needs.
type MediaIDRequest struct {
	Token    string `json:"token"`
	RadioKey string `json:"radioKey"`
	ID       string `json:"id"`
}

// MediaWipeRequest is {token, radioKey, ids} for the bulk-delete endpoint.
// IDs is required and must be non-empty -- the frontend already knows
// exactly which segment_suggestion ids are in view (see dashboard.vue's
// existing day-filtering, mirrored by the new Media tab), so there is no
// ambiguous "ids omitted means everything" case to support here.
type MediaWipeRequest struct {
	Token    string   `json:"token"`
	RadioKey string   `json:"radioKey"`
	IDs      []string `json:"ids"`
}

func decodeAndAuthorize(chat *Chat, w http.ResponseWriter, r *http.Request, req any) bool {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return false
	}
	if err := json.NewDecoder(r.Body).Decode(req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return false
	}
	return true
}

// mediaListHandler backs POST /api/v1/media/list: every segment_suggestion
// item, oldest first (List()'s own order) -- the Media tab groups these by
// day itself (mirroring dashboard.vue's existing pattern), so no server-side
// filtering beyond purpose is needed.
func mediaListHandler(chat *Chat, store *MediaStore, w http.ResponseWriter, r *http.Request) {
	var req RadioKeyValidateRequest
	if !decodeAndAuthorize(chat, w, r, &req) {
		return
	}
	if !chat.VerifyRadioKey(req.Token, req.RadioKey) {
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(RadioKeyValidateResponse{Valid: false})
		return
	}

	all := store.List()
	suggestions := make([]MediaItem, 0, len(all))
	for _, item := range all {
		if item.Purpose == MediaPurposeSegmentSuggestion {
			suggestions = append(suggestions, item)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(suggestions)
}

// mediaDownloadHandler backs POST /api/v1/media/download: streams the raw
// bytes for one item with its stored MimeType, used for both inline
// playback (fetched, wrapped in a Blob/ObjectURL client-side) and the
// explicit download button (same fetch; the button saves the blob it
// already has).
func mediaDownloadHandler(chat *Chat, store *MediaStore, w http.ResponseWriter, r *http.Request) {
	var req MediaIDRequest
	if !decodeAndAuthorize(chat, w, r, &req) {
		return
	}
	if !chat.VerifyRadioKey(req.Token, req.RadioKey) {
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(RadioKeyValidateResponse{Valid: false})
		return
	}

	item, ok := store.Get(req.ID)
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	data, err := store.ReadBytes(req.ID)
	if err != nil {
		http.Error(w, "could not read media file", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", item.MimeType)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename=%q`, req.ID))
	_, _ = w.Write(data)
}

// mediaDeleteHandler backs POST /api/v1/media/delete: removes one item
// (either purpose is allowed here -- unlike wipe, a single explicit delete
// by id is an intentional, individually-reviewed action, so there is no
// need to protect chat_attachment items from it) and tells other connected
// admins to refetch.
func mediaDeleteHandler(chat *Chat, store *MediaStore, w http.ResponseWriter, r *http.Request) {
	var req MediaIDRequest
	if !decodeAndAuthorize(chat, w, r, &req) {
		return
	}
	if !chat.VerifyRadioKey(req.Token, req.RadioKey) {
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(RadioKeyValidateResponse{Valid: false})
		return
	}

	if err := store.Delete(req.ID); err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	chat.broadcastMediaEvent(MediaBroadcast{Type: "media", Event: "deleted", ID: req.ID})

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]bool{"deleted": true})
}

// mediaWipeHandler backs POST /api/v1/media/wipe: bulk-deletes the given
// ids, but silently protects any chat_attachment item among them --
// segment_suggestion's manual-only retention is a deliberate policy choice
// (see the design spec), and a bulk action is exactly the kind of place a
// stray id could slip in by accident.
func mediaWipeHandler(chat *Chat, store *MediaStore, w http.ResponseWriter, r *http.Request) {
	var req MediaWipeRequest
	if !decodeAndAuthorize(chat, w, r, &req) {
		return
	}
	if !chat.VerifyRadioKey(req.Token, req.RadioKey) {
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(RadioKeyValidateResponse{Valid: false})
		return
	}
	if len(req.IDs) == 0 {
		http.Error(w, "ids must be non-empty", http.StatusBadRequest)
		return
	}

	suggestionIDs := make([]string, 0, len(req.IDs))
	for _, id := range req.IDs {
		if item, ok := store.Get(id); ok && item.Purpose == MediaPurposeSegmentSuggestion {
			suggestionIDs = append(suggestionIDs, id)
		}
	}

	removed := store.DeleteMany(suggestionIDs)
	for _, id := range removed {
		chat.broadcastMediaEvent(MediaBroadcast{Type: "media", Event: "deleted", ID: id})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string][]string{"deleted": removed})
}
