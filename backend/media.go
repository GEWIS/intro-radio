package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
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
