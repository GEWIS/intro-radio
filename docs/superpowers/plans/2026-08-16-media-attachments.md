# Media Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let listeners attach a picture to an ongoing chat message, and separately submit a standalone photo or voice memo ("segment suggestion") for staff to review in a new per-day backoffice Media tab.

**Architecture:** One new backend file (`backend/media.go`) holding a file-backed `MediaStore` (metadata index as JSON, following `agenda.go`/`metrics.go`/`audit.go`'s existing pattern; raw bytes as individual files on disk) and five new HTTP endpoints. A `Purpose` field (`chat_attachment` | `segment_suggestion`) on every item discriminates the two use cases sharing this one backbone. Chat attachments flow through the existing WebSocket broadcast (`OutgoingMessage`, extended with two optional fields) so they appear inline in `AdminChat.vue`'s per-listener thread; segment suggestions get their own lightweight WebSocket notification purely to tell the new Media tab to refetch, and are never delivered to a specific listener. `chat_attachment` items auto-expire after 48 hours (no management UI exists for them); `segment_suggestion` items are deleted only by explicit staff action (single delete or wipe).

**Tech Stack:** Go stdlib only (`net/http`, `encoding/json`, `os`) on the backend -- no new dependency. Vue 3 + Vuetify on the frontend, using the browser's native `MediaRecorder`/`getUserMedia` APIs for voice memo recording -- no new dependency there either.

**Spec:** [docs/superpowers/specs/2026-08-16-media-attachments-design.md](../specs/2026-08-16-media-attachments-design.md)

## Global Constraints

- No database, no new third-party dependency (backend or frontend) -- matches every prior persistence decision in this codebase.
- Max upload size: 15MB for photos, 10MB for voice memos, enforced via `http.MaxBytesReader`.
- Allowed MIME types: photos -- `image/jpeg`, `image/png`, `image/webp`. Voice -- `audio/webm`, `audio/ogg`, `audio/mpeg`.
- `chat_attachment` items auto-delete after 48 hours (background sweep, no user-facing control). `segment_suggestion` items are never auto-deleted.
- Staff-to-listener media (a radio sending a photo/voice memo *to* a listener) is out of scope.
- Match existing test conventions exactly: Go table-driven tests with `t.TempDir()` (see `metrics_test.go`), Vitest with `mountWithVuetify` + hoisted `vi.mock()` (see `status.vue.spec.ts`).
- Run `go build ./... && go vet ./... && go test ./...` (from `backend/`) and `yarn type-check && yarn lint && yarn test` (from `frontend/`) after every task; both must pass before moving on.

---

## Task 1: MediaStore data model and storage

**Files:**
- Create: `backend/media.go`
- Test: `backend/media_test.go`

**Interfaces:**
- Produces: `MediaItem` struct, `NewMediaStore(indexPath, mediaDir string) *MediaStore`, `(*MediaStore).Load() error`, `(*MediaStore).List() []MediaItem`, `(*MediaStore).Get(id string) (MediaItem, bool)`, `(*MediaStore).Add(item MediaItem, data []byte) error`, `(*MediaStore).ReadBytes(id string) ([]byte, error)`, `(*MediaStore).Delete(id string) error`, `(*MediaStore).DeleteMany(ids []string) []string`, `(*MediaStore).sweepExpiredChatAttachments(now time.Time) []string`, `(*MediaStore).RunSweep(done <-chan struct{})`. Constants `MediaPurposeChatAttachment`, `MediaPurposeSegmentSuggestion`, `MediaKindPhoto`, `MediaKindVoice`.
- Consumes: `writeJSONFile` (already defined in `metrics.go`, same package).

- [ ] **Step 1: Create the branch**

```bash
git checkout -b feat/media-attachments-storage
```

- [ ] **Step 2: Write the failing test for the data model and basic store operations**

Create `backend/media_test.go`:

```go
package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func newTestMediaStore(t *testing.T) *MediaStore {
	t.Helper()
	dir := t.TempDir()
	return NewMediaStore(filepath.Join(dir, "media.json"), filepath.Join(dir, "files"))
}

func TestMediaStoreAddAndGet(t *testing.T) {
	m := newTestMediaStore(t)

	item := MediaItem{
		ID:               "abc123",
		Purpose:          MediaPurposeSegmentSuggestion,
		Kind:             MediaKindPhoto,
		SenderLidnr:      1337,
		SenderGivenName:  "Ada",
		SenderFamilyName: "Lovelace",
		Caption:          "look at this",
		MimeType:         "image/jpeg",
		SizeBytes:        4,
		CreatedAt:        time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
	}
	if err := m.Add(item, []byte("data")); err != nil {
		t.Fatalf("Add: %v", err)
	}

	got, ok := m.Get("abc123")
	if !ok {
		t.Fatalf("expected to find the item")
	}
	if got != item {
		t.Fatalf("got %+v, want %+v", got, item)
	}

	data, err := m.ReadBytes("abc123")
	if err != nil {
		t.Fatalf("ReadBytes: %v", err)
	}
	if string(data) != "data" {
		t.Fatalf("got bytes %q, want %q", data, "data")
	}
}

func TestMediaStoreGetMissingReturnsFalse(t *testing.T) {
	m := newTestMediaStore(t)
	if _, ok := m.Get("does-not-exist"); ok {
		t.Fatalf("expected ok=false for a missing id")
	}
}

func TestMediaStoreListReturnsAllPurposes(t *testing.T) {
	m := newTestMediaStore(t)
	must(t, m.Add(MediaItem{ID: "1", Purpose: MediaPurposeChatAttachment, CreatedAt: time.Now()}, []byte("a")))
	must(t, m.Add(MediaItem{ID: "2", Purpose: MediaPurposeSegmentSuggestion, CreatedAt: time.Now()}, []byte("b")))

	got := m.List()
	if len(got) != 2 {
		t.Fatalf("expected 2 items (both purposes), got %d", len(got))
	}
}

func TestMediaStorePersistenceRoundTrip(t *testing.T) {
	dir := t.TempDir()
	indexPath := filepath.Join(dir, "media.json")
	mediaDir := filepath.Join(dir, "files")
	m := NewMediaStore(indexPath, mediaDir)

	item := MediaItem{ID: "abc", Purpose: MediaPurposeSegmentSuggestion, CreatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	must(t, m.Add(item, []byte("bytes")))

	reloaded := NewMediaStore(indexPath, mediaDir)
	if err := reloaded.Load(); err != nil {
		t.Fatalf("Load: %v", err)
	}

	got, ok := reloaded.Get("abc")
	if !ok {
		t.Fatalf("expected the item to survive reload")
	}
	if !got.CreatedAt.Equal(item.CreatedAt) {
		t.Fatalf("got CreatedAt %v, want %v", got.CreatedAt, item.CreatedAt)
	}

	data, err := reloaded.ReadBytes("abc")
	if err != nil {
		t.Fatalf("ReadBytes after reload: %v", err)
	}
	if string(data) != "bytes" {
		t.Fatalf("got bytes %q, want %q", data, "bytes")
	}
}

func TestMediaStoreLoadToleratesMissingFile(t *testing.T) {
	dir := t.TempDir()
	m := NewMediaStore(filepath.Join(dir, "does-not-exist.json"), filepath.Join(dir, "files"))
	if err := m.Load(); err != nil {
		t.Fatalf("expected a missing file to be tolerated, got: %v", err)
	}
	if got := m.List(); len(got) != 0 {
		t.Fatalf("expected an empty list, got %+v", got)
	}
}

func TestMediaStoreLoadRejectsCorruptFile(t *testing.T) {
	dir := t.TempDir()
	indexPath := filepath.Join(dir, "media.json")
	if err := os.WriteFile(indexPath, []byte("{not json"), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	m := NewMediaStore(indexPath, filepath.Join(dir, "files"))
	if err := m.Load(); err == nil {
		t.Fatalf("expected Load to fail on a corrupt file")
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && go test ./... -run TestMediaStore -v`
Expected: FAIL with "undefined: MediaItem" (or similar -- the type doesn't exist yet)

- [ ] **Step 4: Implement MediaItem, MediaStore, and the basic operations**

Create `backend/media.go`:

```go
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
	mutex    sync.Mutex
	items    []MediaItem
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

// ReadBytes returns the raw file contents for id.
func (m *MediaStore) ReadBytes(id string) ([]byte, error) {
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && go test ./... -run TestMediaStore -v`
Expected: PASS (all `TestMediaStore*` tests)

- [ ] **Step 6: Write the failing test for Delete/DeleteMany and the sweep**

Append to `backend/media_test.go`:

```go
func TestMediaStoreDeleteRemovesMetadataAndFile(t *testing.T) {
	m := newTestMediaStore(t)
	must(t, m.Add(MediaItem{ID: "x", Purpose: MediaPurposeSegmentSuggestion, CreatedAt: time.Now()}, []byte("bytes")))

	if err := m.Delete("x"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, ok := m.Get("x"); ok {
		t.Fatalf("expected the item to be gone")
	}
	if _, err := m.ReadBytes("x"); err == nil {
		t.Fatalf("expected the underlying file to be gone")
	}
}

func TestMediaStoreDeleteUnknownIDReturnsError(t *testing.T) {
	m := newTestMediaStore(t)
	if err := m.Delete("does-not-exist"); err == nil {
		t.Fatalf("expected an error deleting an unknown id")
	}
}

func TestMediaStoreDeleteManySkipsUnknownIDs(t *testing.T) {
	m := newTestMediaStore(t)
	must(t, m.Add(MediaItem{ID: "a", Purpose: MediaPurposeSegmentSuggestion, CreatedAt: time.Now()}, []byte("1")))
	must(t, m.Add(MediaItem{ID: "b", Purpose: MediaPurposeSegmentSuggestion, CreatedAt: time.Now()}, []byte("2")))

	removed := m.DeleteMany([]string{"a", "does-not-exist", "b"})

	if len(removed) != 2 || removed[0] != "a" || removed[1] != "b" {
		t.Fatalf("expected [a b] removed, got %v", removed)
	}
	if len(m.List()) != 0 {
		t.Fatalf("expected the store to be empty")
	}
}

func TestSweepExpiredChatAttachmentsOnlyTouchesChatAttachments(t *testing.T) {
	m := newTestMediaStore(t)
	now := time.Date(2026, 1, 3, 0, 0, 0, 0, time.UTC)

	must(t, m.Add(MediaItem{ID: "old-chat", Purpose: MediaPurposeChatAttachment, CreatedAt: now.Add(-49 * time.Hour)}, []byte("1")))
	must(t, m.Add(MediaItem{ID: "new-chat", Purpose: MediaPurposeChatAttachment, CreatedAt: now.Add(-1 * time.Hour)}, []byte("2")))
	must(t, m.Add(MediaItem{ID: "old-suggestion", Purpose: MediaPurposeSegmentSuggestion, CreatedAt: now.Add(-1000 * time.Hour)}, []byte("3")))

	removed := m.sweepExpiredChatAttachments(now)

	if len(removed) != 1 || removed[0] != "old-chat" {
		t.Fatalf("expected only old-chat removed, got %v", removed)
	}
	if _, ok := m.Get("new-chat"); !ok {
		t.Fatalf("new-chat should survive (under the TTL)")
	}
	if _, ok := m.Get("old-suggestion"); !ok {
		t.Fatalf("old-suggestion should survive regardless of age (manual-only retention)")
	}
}
```

- [ ] **Step 7: Run the test to verify it fails, then implement**

Run: `cd backend && go test ./... -run "TestMediaStoreDelete|TestSweep" -v`
Expected: PASS immediately -- `Delete`/`DeleteMany`/`sweepExpiredChatAttachments` were already written in Step 4. If any fail, fix `media.go` until they pass.

- [ ] **Step 8: Run the full backend suite and commit**

```bash
cd backend && go build ./... && go vet ./... && go test ./...
```

```bash
git add backend/media.go backend/media_test.go
git commit -m "feat: add MediaStore for photo/voice memo storage"
```

---

## Task 2: Upload handler, WebSocket notifications

**Files:**
- Modify: `backend/media.go`
- Modify: `backend/chat.go` (extend `OutgoingMessage`, one new struct + one new method)
- Test: `backend/media_test.go`

**Interfaces:**
- Consumes: `MediaStore` (Task 1), `Chat.verifyGEWISTokenHandshake`, `Chat.forwardToRadios`, `Chat.mutex`/`Chat.radios` (all same-package accessible, unexported).
- Produces: `mediaUploadHandler(chat *Chat, store *MediaStore, w http.ResponseWriter, r *http.Request)`, `MediaBroadcast` struct, `(*Chat).broadcastMediaEvent(msg MediaBroadcast)`.

- [ ] **Step 1: Extend OutgoingMessage in chat.go**

In `backend/chat.go`, find:

```go
type OutgoingMessage struct {
	From       string `json:"from"` // GEWIS mNummer
	GivenName  string `json:"given_name,omitempty"`
	FamilyName string `json:"family_name,omitempty"`
	To         string `json:"to,omitempty"`
	Content    string `json:"content"`
}
```

Replace with:

```go
type OutgoingMessage struct {
	From       string `json:"from"` // GEWIS mNummer
	GivenName  string `json:"given_name,omitempty"`
	FamilyName string `json:"family_name,omitempty"`
	To         string `json:"to,omitempty"`
	Content    string `json:"content"`
	// MediaID/MediaKind are set instead of Content when this message is a
	// chat_attachment (see media.go) -- reusing this struct (rather than a
	// parallel shape) means a media message flows through the exact same
	// forwardToRadios/forwardToOtherRadios/forwardToUser paths a text
	// message does, inheriting the identity handling already enforced
	// there for free. Named with the same snake_case as given_name/
	// family_name above for consistency within this one struct, even
	// though newer REST response structs elsewhere use camelCase.
	MediaID   string `json:"media_id,omitempty"`
	MediaKind string `json:"media_kind,omitempty"`
}
```

This is additive only (new optional fields) -- no existing test should need changes.

- [ ] **Step 2: Run the existing chat tests to confirm nothing broke**

Run: `cd backend && go test ./... -run TestRadio -v`
Expected: PASS (unchanged)

- [ ] **Step 3: Write the failing test for the upload handler**

Append to `backend/media_test.go`:

```go
import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	// ... (keep existing imports: os, path/filepath, testing, time)
)

func makeUploadRequest(t *testing.T, fields map[string]string, fileField, fileName string, fileContent []byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for k, v := range fields {
		if err := writer.WriteField(k, v); err != nil {
			t.Fatalf("WriteField: %v", err)
		}
	}
	if fileField != "" {
		part, err := writer.CreateFormFile(fileField, fileName)
		if err != nil {
			t.Fatalf("CreateFormFile: %v", err)
		}
		if _, err := part.Write(fileContent); err != nil {
			t.Fatalf("Write: %v", err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/media", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req
}

func TestMediaUploadHandlerSuccess(t *testing.T) {
	GEWISSecret = "testsecret"
	chat := NewChat()
	store := newTestMediaStore(t)
	tok := makeToken(t, GEWISSecret, 1337, "Ada", "Lovelace", time.Minute)

	req := makeUploadRequest(t, map[string]string{
		"token":   tok,
		"purpose": MediaPurposeSegmentSuggestion,
		"kind":    MediaKindPhoto,
		"caption": "look at this",
	}, "file", "photo.jpg", []byte("fake-jpeg-bytes"))

	rec := httptest.NewRecorder()
	mediaUploadHandler(chat, store, rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var got MediaItem
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Purpose != MediaPurposeSegmentSuggestion || got.Kind != MediaKindPhoto || got.Caption != "look at this" {
		t.Fatalf("unexpected item: %+v", got)
	}
	if got.SenderLidnr != 1337 || got.SenderGivenName != "Ada" {
		t.Fatalf("expected sender identity from the token, got %+v", got)
	}
	if got.MimeType != "image/jpeg" {
		t.Fatalf("expected the sniffed/declared mime type, got %q", got.MimeType)
	}

	data, err := store.ReadBytes(got.ID)
	if err != nil || string(data) != "fake-jpeg-bytes" {
		t.Fatalf("expected the uploaded bytes to be stored, got %q, err=%v", data, err)
	}
}

func TestMediaUploadHandlerRejectsBadToken(t *testing.T) {
	GEWISSecret = "testsecret"
	chat := NewChat()
	store := newTestMediaStore(t)

	req := makeUploadRequest(t, map[string]string{
		"token":   "not-a-real-token",
		"purpose": MediaPurposeSegmentSuggestion,
		"kind":    MediaKindPhoto,
	}, "file", "photo.jpg", []byte("bytes"))

	rec := httptest.NewRecorder()
	mediaUploadHandler(chat, store, rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestMediaUploadHandlerRejectsOversizedFile(t *testing.T) {
	GEWISSecret = "testsecret"
	chat := NewChat()
	store := newTestMediaStore(t)
	tok := makeToken(t, GEWISSecret, 1337, "Ada", "Lovelace", time.Minute)

	tooBig := bytes.Repeat([]byte("x"), maxPhotoBytes+1)
	req := makeUploadRequest(t, map[string]string{
		"token":   tok,
		"purpose": MediaPurposeSegmentSuggestion,
		"kind":    MediaKindPhoto,
	}, "file", "photo.jpg", tooBig)

	rec := httptest.NewRecorder()
	mediaUploadHandler(chat, store, rec, req)

	if rec.Code != http.StatusBadRequest && rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected a 4xx rejection for an oversized file, got %d", rec.Code)
	}
	if len(store.List()) != 0 {
		t.Fatalf("expected nothing to be stored")
	}
}

func TestMediaUploadHandlerRejectsDisallowedMimeType(t *testing.T) {
	GEWISSecret = "testsecret"
	chat := NewChat()
	store := newTestMediaStore(t)
	tok := makeToken(t, GEWISSecret, 1337, "Ada", "Lovelace", time.Minute)

	req := makeUploadRequest(t, map[string]string{
		"token":   tok,
		"purpose": MediaPurposeSegmentSuggestion,
		"kind":    MediaKindPhoto,
	}, "file", "not-a-photo.exe", []byte("MZ"))

	rec := httptest.NewRecorder()
	mediaUploadHandler(chat, store, rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for a disallowed file type, got %d", rec.Code)
	}
	if len(store.List()) != 0 {
		t.Fatalf("expected nothing to be stored")
	}
}

func TestMediaUploadHandlerChatAttachmentBroadcastsOnlyToRadios(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "correct-key"
	chat := NewChat()
	store := newTestMediaStore(t)
	tok := makeToken(t, GEWISSecret, 1337, "Ada", "Lovelace", time.Minute)

	// startTestServer/dialAndHandshake/readJSONWithDeadline are chat_test.go's
	// existing WebSocket test helpers (same package, reused here rather than
	// redefined) -- a real listening server is required to dial an actual
	// radio connection into chat.radios, which mediaUploadHandler then
	// broadcasts to directly.
	_, wsBase := startTestServer(t, chat)
	radioTok := makeToken(t, GEWISSecret, 9, "Staff", "Member", time.Minute)
	radio := dialAndHandshake(t, wsBase, "radio", radioTok, RADIOChatKey)
	defer radio.Close()

	req := makeUploadRequest(t, map[string]string{
		"token":   tok,
		"purpose": MediaPurposeChatAttachment,
		"kind":    MediaKindPhoto,
	}, "file", "photo.jpg", []byte("bytes"))

	rec := httptest.NewRecorder()
	mediaUploadHandler(chat, store, rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	msg, err := readJSONWithDeadline[OutgoingMessage](t, radio, time.Second)
	if err != nil {
		t.Fatalf("expected a broadcast message, got err: %v", err)
	}
	if msg.MediaKind != MediaKindPhoto || msg.MediaID == "" {
		t.Fatalf("expected a media notification with an id and kind, got %+v", msg)
	}
	if msg.From != "1337" || msg.GivenName != "Ada" {
		t.Fatalf("expected the real sender identity on the radio-facing copy, got %+v", msg)
	}
}
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd backend && go test ./... -run TestMediaUploadHandler -v`
Expected: FAIL with "undefined: mediaUploadHandler"

- [ ] **Step 5: Implement the upload handler and broadcast plumbing**

Append to `backend/media.go`:

```go
import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)
```

(Add `io`, `net/http`, `strings`, and `github.com/google/uuid` to the existing import block; run `cd backend && go get github.com/google/uuid` to add the dependency -- this is the one new dependency this plan introduces, used only for generating item ids, and is a single-purpose, zero-transitive-dependency package consistent with this project's minimal-dependency stance.)

```go
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
```

Add `"strconv"` to `media.go`'s import block (alongside `io`, `net/http`, `strings`, `github.com/google/uuid` from Step 5's import addition above).

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && go test ./... -run TestMediaUploadHandler -v`
Expected: PASS

- [ ] **Step 7: Run the full backend suite and commit**

```bash
cd backend && go build ./... && go vet ./... && go test ./...
```

```bash
git add backend/media.go backend/media_test.go backend/chat.go backend/go.mod backend/go.sum
git commit -m "feat: add the media upload handler and its WebSocket notifications"
```

---

## Task 3: List, download, delete, and wipe handlers

**Files:**
- Modify: `backend/media.go`
- Test: `backend/media_test.go`

**Interfaces:**
- Produces: `mediaListHandler(chat *Chat, store *MediaStore, w, r)`, `mediaDownloadHandler(chat *Chat, store *MediaStore, w, r)`, `mediaDeleteHandler(chat *Chat, store *MediaStore, w, r)`, `mediaWipeHandler(chat *Chat, store *MediaStore, w, r)`.
- Consumes: `RadioKeyValidateRequest`/`RadioKeyValidateResponse` (already defined in `main.go`, same package), `chat.VerifyRadioKey`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/media_test.go`:

```go
type mediaIDRequest struct {
	Token    string   `json:"token"`
	RadioKey string   `json:"radioKey"`
	ID       string   `json:"id,omitempty"`
	IDs      []string `json:"ids,omitempty"`
}

func TestMediaListHandlerReturnsOnlySegmentSuggestions(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "correct-key"
	chat := NewChat()
	store := newTestMediaStore(t)
	must(t, store.Add(MediaItem{ID: "a", Purpose: MediaPurposeSegmentSuggestion, CreatedAt: time.Now()}, []byte("1")))
	must(t, store.Add(MediaItem{ID: "b", Purpose: MediaPurposeChatAttachment, CreatedAt: time.Now()}, []byte("2")))

	tok := makeToken(t, GEWISSecret, 1, "A", "B", time.Minute)
	body, _ := json.Marshal(mediaIDRequest{Token: tok, RadioKey: "correct-key"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/media/list", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	mediaListHandler(chat, store, rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var got []MediaItem
	must(t, json.Unmarshal(rec.Body.Bytes(), &got))
	if len(got) != 1 || got[0].ID != "a" {
		t.Fatalf("expected only the segment_suggestion item, got %+v", got)
	}
}

func TestMediaListHandlerRejectsBadRadioKey(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "correct-key"
	chat := NewChat()
	store := newTestMediaStore(t)
	tok := makeToken(t, GEWISSecret, 1, "A", "B", time.Minute)
	body, _ := json.Marshal(mediaIDRequest{Token: tok, RadioKey: "wrong-key"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/media/list", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	mediaListHandler(chat, store, rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestMediaDownloadHandlerReturnsBytesAndContentType(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "correct-key"
	chat := NewChat()
	store := newTestMediaStore(t)
	must(t, store.Add(MediaItem{ID: "a", Purpose: MediaPurposeSegmentSuggestion, MimeType: "image/jpeg", CreatedAt: time.Now()}, []byte("jpeg-bytes")))

	tok := makeToken(t, GEWISSecret, 1, "A", "B", time.Minute)
	body, _ := json.Marshal(mediaIDRequest{Token: tok, RadioKey: "correct-key", ID: "a"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/media/download", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	mediaDownloadHandler(chat, store, rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if rec.Header().Get("Content-Type") != "image/jpeg" {
		t.Fatalf("expected Content-Type image/jpeg, got %q", rec.Header().Get("Content-Type"))
	}
	if rec.Body.String() != "jpeg-bytes" {
		t.Fatalf("expected the raw bytes back, got %q", rec.Body.String())
	}
}

func TestMediaDownloadHandlerUnknownIDReturns404(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "correct-key"
	chat := NewChat()
	store := newTestMediaStore(t)
	tok := makeToken(t, GEWISSecret, 1, "A", "B", time.Minute)
	body, _ := json.Marshal(mediaIDRequest{Token: tok, RadioKey: "correct-key", ID: "does-not-exist"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/media/download", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	mediaDownloadHandler(chat, store, rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestMediaDeleteHandlerRemovesItemAndBroadcasts(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "correct-key"
	chat := NewChat()
	store := newTestMediaStore(t)
	must(t, store.Add(MediaItem{ID: "a", Purpose: MediaPurposeSegmentSuggestion, CreatedAt: time.Now()}, []byte("1")))

	_, wsBase := startTestServer(t, chat)
	radioTok := makeToken(t, GEWISSecret, 9, "Staff", "Member", time.Minute)
	radio := dialAndHandshake(t, wsBase, "radio", radioTok, RADIOChatKey)
	defer radio.Close()

	tok := makeToken(t, GEWISSecret, 1, "A", "B", time.Minute)
	body, _ := json.Marshal(mediaIDRequest{Token: tok, RadioKey: "correct-key", ID: "a"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/media/delete", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	mediaDeleteHandler(chat, store, rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, ok := store.Get("a"); ok {
		t.Fatalf("expected the item to be deleted")
	}

	got, err := readJSONWithDeadline[MediaBroadcast](t, radio, time.Second)
	if err != nil {
		t.Fatalf("expected a broadcast, got: %v", err)
	}
	if got.Event != "deleted" || got.ID != "a" {
		t.Fatalf("expected a deleted event for id a, got %+v", got)
	}
}

func TestMediaWipeHandlerDeletesOnlyGivenIDsAndNeverChatAttachments(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "correct-key"
	chat := NewChat()
	store := newTestMediaStore(t)
	must(t, store.Add(MediaItem{ID: "a", Purpose: MediaPurposeSegmentSuggestion, CreatedAt: time.Now()}, []byte("1")))
	must(t, store.Add(MediaItem{ID: "b", Purpose: MediaPurposeSegmentSuggestion, CreatedAt: time.Now()}, []byte("2")))
	must(t, store.Add(MediaItem{ID: "c", Purpose: MediaPurposeChatAttachment, CreatedAt: time.Now()}, []byte("3")))

	tok := makeToken(t, GEWISSecret, 1, "A", "B", time.Minute)
	// Ask to wipe a, plus c (a chat_attachment) -- c must survive regardless.
	body, _ := json.Marshal(mediaIDRequest{Token: tok, RadioKey: "correct-key", IDs: []string{"a", "c"}})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/media/wipe", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	mediaWipeHandler(chat, store, rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, ok := store.Get("a"); ok {
		t.Fatalf("expected a to be deleted")
	}
	if _, ok := store.Get("b"); !ok {
		t.Fatalf("expected b to survive (not in the ids list)")
	}
	if _, ok := store.Get("c"); !ok {
		t.Fatalf("expected c (a chat_attachment) to survive even though it was in the ids list")
	}
}

func TestMediaWipeHandlerRejectsEmptyIDs(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "correct-key"
	chat := NewChat()
	store := newTestMediaStore(t)
	tok := makeToken(t, GEWISSecret, 1, "A", "B", time.Minute)
	body, _ := json.Marshal(mediaIDRequest{Token: tok, RadioKey: "correct-key", IDs: []string{}})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/media/wipe", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	mediaWipeHandler(chat, store, rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for an empty ids list, got %d", rec.Code)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && go test ./... -run "TestMediaList|TestMediaDownload|TestMediaDelete|TestMediaWipe" -v`
Expected: FAIL with "undefined: mediaListHandler" (etc.)

- [ ] **Step 3: Implement the four handlers**

Append to `backend/media.go`:

```go
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && go test ./... -run "TestMediaList|TestMediaDownload|TestMediaDelete|TestMediaWipe" -v`
Expected: PASS

- [ ] **Step 5: Run the full backend suite and commit**

```bash
cd backend && go build ./... && go vet ./... && go test ./...
```

```bash
git add backend/media.go backend/media_test.go
git commit -m "feat: add media list, download, delete, and wipe handlers"
```

---

## Task 4: Wire media.go into main.go

**Files:**
- Modify: `backend/main.go`
- Modify: `backend/main_test.go`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `NewMediaStore`, `(*MediaStore).Load`, `(*MediaStore).RunSweep`, `mediaUploadHandler`, `mediaListHandler`, `mediaDownloadHandler`, `mediaDeleteHandler`, `mediaWipeHandler` (all Tasks 1-3).
- Produces: `newMux`'s signature gains one parameter (`media *MediaStore`), inserted right after `auditLog` to match the order every other store already appears in.

- [ ] **Step 1: Add the env vars**

In `backend/main.go`, in the `var (...)` block alongside `metricsFile`/`auditLogFile` (those two are actually declared in `metrics.go`/`audit.go` respectively -- add these two the same way, in `media.go`, right after the `MediaStore` type definition):

```go
var (
	mediaIndexFile = String("MEDIA_FILE", "media.json")
	// Named mediaFilesDir rather than mediaDir specifically to avoid reading
	// as the same identifier as MediaStore's own mediaDir field/parameter
	// (Task 1) -- they're in different scopes so Go has no issue with it,
	// but two same-named things meaning different things in one package is
	// worth avoiding for whoever reads this next.
	mediaFilesDir = String("MEDIA_DIR", "media")
)
```

- [ ] **Step 2: Update newMux's signature and add the five routes**

In `backend/main.go`, find:

```go
func newMux(chat *Chat, agenda *Agenda, metrics *MetricsStore, auditLog *AuditLog, startedAt time.Time) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", chat.HandleWS)
	mux.HandleFunc("/api/v1/health", healthHandler)
	mux.HandleFunc("/api/v1/token", tokenHandler)
	mux.HandleFunc("/api/v1/radio", radioHandler)
	mux.HandleFunc("/api/v1/radio-key/validate", func(w http.ResponseWriter, r *http.Request) {
		radioKeyValidateHandler(chat, auditLog, w, r)
	})
	mux.HandleFunc("/api/v1/agenda", func(w http.ResponseWriter, r *http.Request) {
		agendaHandler(chat, agenda, w, r)
	})
	mux.HandleFunc("/api/v1/metrics", func(w http.ResponseWriter, r *http.Request) {
		metricsHandler(chat, metrics, w, r)
	})
	mux.HandleFunc("/api/v1/audit-log", func(w http.ResponseWriter, r *http.Request) {
		auditLogHandler(chat, auditLog, w, r)
	})
	mux.HandleFunc("/api/v1/live-status", func(w http.ResponseWriter, r *http.Request) {
		liveStatusHandler(chat, audioURL, audioMountPoint, w, r)
	})
	mux.HandleFunc("/api/v1/status", func(w http.ResponseWriter, r *http.Request) {
		statusHandler(chat, metrics, startedAt, audioURL, audioMountPoint, w, r)
	})
	return mux
}
```

Replace with (adds the `media *MediaStore` parameter and five new route registrations):

```go
func newMux(chat *Chat, agenda *Agenda, metrics *MetricsStore, auditLog *AuditLog, media *MediaStore, startedAt time.Time) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", chat.HandleWS)
	mux.HandleFunc("/api/v1/health", healthHandler)
	mux.HandleFunc("/api/v1/token", tokenHandler)
	mux.HandleFunc("/api/v1/radio", radioHandler)
	mux.HandleFunc("/api/v1/radio-key/validate", func(w http.ResponseWriter, r *http.Request) {
		radioKeyValidateHandler(chat, auditLog, w, r)
	})
	mux.HandleFunc("/api/v1/agenda", func(w http.ResponseWriter, r *http.Request) {
		agendaHandler(chat, agenda, w, r)
	})
	mux.HandleFunc("/api/v1/metrics", func(w http.ResponseWriter, r *http.Request) {
		metricsHandler(chat, metrics, w, r)
	})
	mux.HandleFunc("/api/v1/audit-log", func(w http.ResponseWriter, r *http.Request) {
		auditLogHandler(chat, auditLog, w, r)
	})
	mux.HandleFunc("/api/v1/live-status", func(w http.ResponseWriter, r *http.Request) {
		liveStatusHandler(chat, audioURL, audioMountPoint, w, r)
	})
	mux.HandleFunc("/api/v1/status", func(w http.ResponseWriter, r *http.Request) {
		statusHandler(chat, metrics, startedAt, audioURL, audioMountPoint, w, r)
	})
	mux.HandleFunc("/api/v1/media", func(w http.ResponseWriter, r *http.Request) {
		mediaUploadHandler(chat, media, w, r)
	})
	mux.HandleFunc("/api/v1/media/list", func(w http.ResponseWriter, r *http.Request) {
		mediaListHandler(chat, media, w, r)
	})
	mux.HandleFunc("/api/v1/media/download", func(w http.ResponseWriter, r *http.Request) {
		mediaDownloadHandler(chat, media, w, r)
	})
	mux.HandleFunc("/api/v1/media/delete", func(w http.ResponseWriter, r *http.Request) {
		mediaDeleteHandler(chat, media, w, r)
	})
	mux.HandleFunc("/api/v1/media/wipe", func(w http.ResponseWriter, r *http.Request) {
		mediaWipeHandler(chat, media, w, r)
	})
	return mux
}
```

- [ ] **Step 3: Wire startup and shutdown in main()**

In `backend/main.go`'s `main()`, find:

```go
	auditLog := NewAuditLog(auditLogFile)
	if err := auditLog.Load(); err != nil {
		log.Warn().Err(err).Str("path", auditLogFile).Msg("could not load audit log; starting with an empty log")
	}

	srv := newHTTPServer(port, newMux(chat, agenda, metrics, auditLog, startedAt))

	// metricsDone stops MetricsStore.Run's ticker loop; it is closed
	// alongside chat.Shutdown() below so the sampling goroutine doesn't
	// outlive the rest of a graceful shutdown.
	metricsDone := make(chan struct{})
	go metrics.Run(chat, metricsDone)
```

Replace with:

```go
	auditLog := NewAuditLog(auditLogFile)
	if err := auditLog.Load(); err != nil {
		log.Warn().Err(err).Str("path", auditLogFile).Msg("could not load audit log; starting with an empty log")
	}

	// Same reasoning as metrics/audit-log above: a corrupt or missing media
	// index is not worth crash-looping the server over.
	media := NewMediaStore(mediaIndexFile, mediaFilesDir)
	if err := media.Load(); err != nil {
		log.Warn().Err(err).Str("path", mediaIndexFile).Msg("could not load media index; starting with an empty index")
	}

	srv := newHTTPServer(port, newMux(chat, agenda, metrics, auditLog, media, startedAt))

	// metricsDone stops MetricsStore.Run's ticker loop; it is closed
	// alongside chat.Shutdown() below so the sampling goroutine doesn't
	// outlive the rest of a graceful shutdown.
	metricsDone := make(chan struct{})
	go metrics.Run(chat, metricsDone)

	// mediaSweepDone stops MediaStore.RunSweep's ticker loop, same reasoning
	// as metricsDone above.
	mediaSweepDone := make(chan struct{})
	go media.RunSweep(mediaSweepDone)
```

Then find the shutdown block:

```go
		chat.Shutdown()
		close(metricsDone)
	}
}
```

Replace with:

```go
		chat.Shutdown()
		close(metricsDone)
		close(mediaSweepDone)
	}
}
```

- [ ] **Step 4: Update main_test.go's three newMux call sites**

In `backend/main_test.go`, there are three calls of the form `newMux(chat, agenda, metrics, auditLog, time.Now())`. Each needs a `media` store constructed and threaded through. For each call site, immediately before the `newMux(...)` call, add:

```go
	media := NewMediaStore(filepath.Join(t.TempDir(), "media.json"), filepath.Join(t.TempDir(), "media"))
```

(if `t` isn't in scope at that exact line -- check the enclosing function signature; it will be, since these are all inside `func Test...(t *testing.T)`), then change the call itself to:

```go
	newMux(chat, agenda, metrics, auditLog, media, time.Now())
```

Add `"path/filepath"` to `main_test.go`'s imports if it isn't already there.

- [ ] **Step 5: Update .gitignore**

In `.gitignore`, find:

```
agenda.json
metrics.json
audit-log.json
/backend/radiogaga
```

Replace with:

```
agenda.json
metrics.json
audit-log.json
media.json
media/
/backend/radiogaga
```

- [ ] **Step 6: Run the full backend suite**

```bash
cd backend && go build ./... && go vet ./... && go test ./...
```

Expected: PASS. Fix any remaining call sites or import issues Step 4 didn't quite cover -- `go build` will name every one.

- [ ] **Step 7: Commit**

```bash
git add backend/main.go backend/main_test.go .gitignore
git commit -m "feat: wire the media store into main.go"
```

---

## Task 5: Frontend chat store -- media notifications

**Files:**
- Modify: `frontend/src/stores/chat.ts`
- Modify: `frontend/src/stores/__tests__/chat.spec.ts` (already exists)

**Interfaces:**
- Produces: `useChatStore()` gains `mediaEvent: Ref<{ id: string; event: 'new' | 'deleted' } | null>` and the `Outgoing`/`ChatMessage` shape gains optional `media_id`/`media_kind`.
- Consumes: nothing new. The existing file's `onMessageHolder.current` (captured by its own `vi.mock('@/composables/useChatSocket', ...)`) and `incoming()` helper are reused as-is -- do not redefine either.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/stores/__tests__/chat.spec.ts`, inside the existing `describe('useChatStore', ...)` block, using the file's own `onMessageHolder`/`incoming()` (already declared at the top of the file -- do not reintroduce them):

```ts
  it('records a media event and exposes it via mediaEvent', () => {
    const store = useChatStore();
    store.ensureConnected('key-a');

    onMessageHolder.current!({ type: 'media', event: 'new', id: 'abc', kind: 'photo' });

    expect(store.mediaEvent).toEqual({ id: 'abc', event: 'new' });
  });

  it('does not treat a media event as a chat message', () => {
    const store = useChatStore();
    store.ensureConnected('key-a');

    onMessageHolder.current!({ type: 'media', event: 'new', id: 'abc', kind: 'photo' });

    expect(store.users).toHaveLength(0);
    expect(store.totalUnread).toBe(0);
  });

  it('preserves media_id/media_kind on an incoming chat message', () => {
    const store = useChatStore();
    store.ensureConnected('key-a');

    onMessageHolder.current!(incoming({ from: 'u1', content: '', media_id: 'xyz', media_kind: 'photo' }));

    expect(store.chats['u1']?.[0]?.media_id).toBe('xyz');
    expect(store.chats['u1']?.[0]?.media_kind).toBe('photo');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && yarn test chat.spec.ts`
Expected: FAIL (`mediaEvent` is undefined, or the media fields aren't preserved)

- [ ] **Step 3: Implement the store changes**

In `frontend/src/stores/chat.ts`, update the `Outgoing` type:

```ts
type Outgoing = {
  from: string;
  to?: string;
  content: string;
  given_name?: string;
  family_name?: string;
  media_id?: string;
  media_kind?: 'photo' | 'voice';
};
```

Add a new incoming type and guard, near `TypingIncoming`/`isTypingMessage`:

```ts
// The backend's mediaUploadHandler/mediaDeleteHandler/mediaWipeHandler send
// this on the same socket whenever a segment_suggestion item is created or
// removed (see backend/media.go's MediaBroadcast) -- purely a "refetch your
// list" signal for the Media tab, never addressed to a specific listener.
type MediaIncoming = { type: 'media'; event: 'new' | 'deleted'; id: string; kind?: 'photo' | 'voice' };
type Incoming = Outgoing | PresenceIncoming | TypingIncoming | MediaIncoming;

function isMediaMessage(msg: Incoming): msg is MediaIncoming {
  return (msg as MediaIncoming).type === 'media';
}
```

In the store body, add a new ref near `typingUsers`:

```ts
  // The most recent segment_suggestion create/delete notification -- the
  // Media tab watches this to know when to refetch, rather than polling.
  const mediaEvent = ref<{ id: string; event: 'new' | 'deleted' } | null>(null);
```

In the `useChatSocket`'s `onMessage` handler, add a new branch right after the existing `isTypingMessage` branch:

```ts
      if (isMediaMessage(msg)) {
        mediaEvent.value = { id: msg.id, event: msg.event };
        return;
      }
```

And extend `chats.value[chatId].push({ ...msg, ts: Date.now() });` -- no change needed there, since `{ ...msg }` already spreads `media_id`/`media_kind` through if present on an `Outgoing`-shaped message.

Add `mediaEvent` to the store's `return { ... }` block.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && yarn test chat.spec.ts`
Expected: PASS

- [ ] **Step 5: Run the full frontend suite and commit**

```bash
cd frontend && yarn type-check && yarn lint && yarn test
```

```bash
git add frontend/src/stores/chat.ts frontend/src/stores/__tests__/chat.spec.ts
git commit -m "feat: surface segment-suggestion notifications in the chat store"
```

---

## Task 6: Chat picture attachment -- listener side

**Files:**
- Modify: `frontend/src/components/RadioChat.vue`
- Modify: `frontend/src/components/__tests__/RadioChat.vue.spec.ts`

**Interfaces:**
- Consumes: `useGewisAuth().getToken()`, `POST /api/v1/media` (Task 2).
- Produces: no new exports -- purely template/script additions to an existing component.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/__tests__/RadioChat.vue.spec.ts` mounts directly with `mountWithVuetify(RadioChat)` (there is no separate mount helper in this file) and already mocks `@/composables/useChatSocket` (returning `connect`/`disconnect`/`send` mocks plus a captured `onMessageHolder.current`) and `@/composables/useGewisAuth` (`getToken: () => 'tok'`) via hoisted `vi.mock()` calls at the top of the file -- reuse those as-is. Add a new `describe` block after the existing tests, inside the same file (after the closing `});` of the existing `describe('RadioChat', ...)`, or as additional `it()`s inside it -- either is fine, but do not redefine `connectMock`/`onMessageHolder`/etc., which are already declared once at the top of the file):

```ts
describe('RadioChat attachments', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads a selected picture and shows it as a sent attachment', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'abc', purpose: 'chat_attachment', kind: 'photo' }) }),
    );

    const wrapper = mountWithVuetify(RadioChat);
    const fileInput = wrapper.get('input[type="file"]');
    const file = new File(['fake-image-bytes'], 'photo.jpg', { type: 'image/jpeg' });
    Object.defineProperty(fileInput.element, 'files', { value: [file] });
    await fileInput.trigger('change');
    await wrapper.vm.$nextTick();

    expect(fetch).toHaveBeenCalledWith('/api/v1/media', expect.objectContaining({ method: 'POST' }));
    expect(wrapper.find('img').exists()).toBe(true);
  });

  it('does nothing when no file is selected', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const wrapper = mountWithVuetify(RadioChat);
    const fileInput = wrapper.get('input[type="file"]');
    Object.defineProperty(fileInput.element, 'files', { value: [] });
    await fileInput.trigger('change');

    expect(fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && yarn test RadioChat.vue.spec.ts -t "uploads a selected picture"`
Expected: FAIL (no file input exists yet)

- [ ] **Step 3: Implement the attach button and upload**

In `frontend/src/components/RadioChat.vue`, add a hidden file input and an attach button next to the text field, and extend the message type/rendering:

```html
<template>
  <v-card class="pa-4" color="surface-variant" rounded="lg" variant="tonal">
    <div ref="chatBox" style="height: 300px; overflow-y: auto">
      <template v-if="!isClosed">
        <div v-for="(msg, index) in messages" :key="index">
          <strong>{{ msg.from === 'radio' ? 'Radio' : 'You' }}:</strong>
          <img v-if="msg.mediaUrl" :src="msg.mediaUrl" alt="Sent attachment" style="max-width: 200px; display: block" />
          <template v-else>{{ msg.content }}</template>
        </div>
      </template>

      <template v-else>
        <div class="d-flex flex-column align-center justify-center text-center" style="height: 100%">
          <div class="text-h6 mb-1">Whoops, something went wrong!</div>
          <div class="text-body-2">did you log in in another tab?</div>
        </div>
      </template>
    </div>

    <div class="text-caption text-medium-emphasis mt-1" style="height: 1.2em">
      <span v-if="radioTyping">Radio is typing...</span>
    </div>

    <div class="d-flex align-center mt-2">
      <v-text-field
        v-model="input"
        class="mr-2"
        :disabled="isClosed"
        hide-details
        placeholder="Type your message..."
        @input="notifyTyping"
        @keydown.enter="sendMessage"
      />

      <v-btn
        class="mr-2"
        :disabled="isClosed"
        icon="mdi-image-plus"
        variant="text"
        @click="fileInput?.click()"
      />
      <input ref="fileInput" accept="image/jpeg,image/png,image/webp" style="display: none" type="file" @change="onFileSelected" />
    </div>

    <v-btn v-if="!isClosed" block class="mt-2" color="primary" @click="sendMessage">Send</v-btn>
    <v-btn v-else block class="mt-2" color="secondary" @click="connect">Reconnect</v-btn>
  </v-card>
</template>
```

In `<script setup>`, extend the message type and add the upload handler:

```ts
type ChatIncoming = { content: string };
type TypingIncoming = { type: 'typing' };
type Incoming = ChatIncoming | TypingIncoming;
type SentMessage = { from: string; content: string; mediaUrl?: string };

const fileInput = ref<HTMLInputElement | null>(null);
const messages = ref<SentMessage[]>([]);

async function onFileSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const token = getToken();
  if (!token) return;

  const form = new FormData();
  form.append('token', token);
  form.append('purpose', 'chat_attachment');
  form.append('kind', 'photo');
  form.append('file', file);

  const res = await fetch('/api/v1/media', { method: 'POST', body: form });
  if (!res.ok) return;

  messages.value.push({ from: 'you', content: '', mediaUrl: URL.createObjectURL(file) });
  scrollToBottom();
  if (fileInput.value) fileInput.value.value = '';
}
```

`getToken` is already imported from `useGewisAuth()` at the top of this file's existing `<script setup>` block -- no new import needed for that. `messages.value.push({ from: 'radio', content: msg.content })` in the existing `onMessage` handler is unaffected (a chat_attachment is listener-authored only, per the spec's scope, so nothing new needs to be *received* here).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && yarn test RadioChat.vue.spec.ts`
Expected: PASS (all tests in the file, not just the new one)

- [ ] **Step 5: Run the full frontend suite and commit**

```bash
cd frontend && yarn type-check && yarn lint && yarn test
```

```bash
git add frontend/src/components/RadioChat.vue frontend/src/components/__tests__/RadioChat.vue.spec.ts
git commit -m "feat: let listeners attach a picture to a chat message"
```

---

## Task 7: Chat picture attachment -- staff side

**Files:**
- Modify: `frontend/src/components/AdminChat.vue`
- Modify: `frontend/src/components/__tests__/AdminChat.vue.spec.ts`

**Interfaces:**
- Consumes: `useGewisAuth().getToken()`, `POST /api/v1/media/download` (Task 3), `chatStore.chats` messages carrying `media_id`/`media_kind` (Task 5).

- [ ] **Step 1: Write the failing test**

`AdminChat.vue.spec.ts` seeds chat state by calling `onMessageHolder.current!(incoming({...}))` -- the real message flows through the actual (unmocked) `useChatStore`, only its underlying `useChatSocket` is mocked -- not by directly poking `chatStore.chats`. Add this test using that same existing helper and the file's own `incoming()` (both already declared at the top of the file -- reuse them, do not redefine):

```ts
it('renders a chat attachment message as an image instead of text', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['x'], { type: 'image/jpeg' }) }));

  const wrapper = mountAdminChat();
  onMessageHolder.current!(incoming({ from: 'u1', content: '', media_id: 'abc', media_kind: 'photo', given_name: 'Ada', family_name: 'Lovelace' }));
  await wrapper.vm.$nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await wrapper.vm.$nextTick();

  expect(fetch).toHaveBeenCalledWith(
    '/api/v1/media/download',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'tok', radioKey: 'key', id: 'abc' }) }),
  );
  expect(wrapper.find('img').exists()).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && yarn test AdminChat.vue.spec.ts -t "renders a chat attachment"`
Expected: FAIL (no image rendering exists yet)

- [ ] **Step 3: Implement thumbnail rendering**

In `frontend/src/components/AdminChat.vue`'s message-row template, find:

```html
                <!-- Message body -->
                <div class="flex-grow-1">
                  <strong>[{{ messageLabel(m) }}]</strong>
                  <span class="ml-2">{{ m.content }}</span>
                </div>
```

Replace with:

```html
                <!-- Message body -->
                <div class="flex-grow-1">
                  <strong>[{{ messageLabel(m) }}]</strong>
                  <img
                    v-if="m.media_id && mediaUrls[m.media_id]"
                    :src="mediaUrls[m.media_id]"
                    alt="Attachment"
                    class="ml-2"
                    style="max-width: 160px; max-height: 160px; display: inline-block; vertical-align: middle; cursor: pointer"
                    @click="openFullSize(mediaUrls[m.media_id])"
                  />
                  <span v-else-if="m.media_id" class="ml-2 text-medium-emphasis">Loading attachment...</span>
                  <span v-else class="ml-2">{{ m.content }}</span>
                </div>
```

Add a full-size viewer dialog right after the closing `</v-row>` and before `<v-snackbar>`:

```html
    <v-dialog v-model="fullSizeUrl" max-width="90vw">
      <img v-if="typeof fullSizeUrl === 'string'" :src="fullSizeUrl" alt="Attachment" style="max-width: 100%; display: block" />
    </v-dialog>
```

In `<script setup>`, add:

```ts
import { useGewisAuth } from '@/composables/useGewisAuth';

const { getToken } = useGewisAuth();
const mediaUrls = ref<Record<string, string>>({});
const fullSizeUrl = ref<string | false>(false);

function openFullSize(url: string) {
  fullSizeUrl.value = url;
}

async function fetchMediaUrl(mediaId: string) {
  if (mediaUrls.value[mediaId]) return;
  const token = getToken();
  if (!token) return;

  try {
    const res = await fetch('/api/v1/media/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, radioKey: props.radioKey, id: mediaId }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    mediaUrls.value = { ...mediaUrls.value, [mediaId]: URL.createObjectURL(blob) };
  } catch {
    // A failed fetch just leaves "Loading attachment..." on screen -- the
    // next watch trigger (e.g. reselecting the thread) will retry.
  }
}

// Fetches the blob for every media message currently in view, whenever the
// active thread's messages change (new message arrives, or a different
// user is selected).
watch(
  activeMessages,
  (msgs) => {
    for (const m of msgs) {
      if (m.media_id) fetchMediaUrl(m.media_id);
    }
  },
  { immediate: true },
);
```

Also add `media_id?: string; media_kind?: string;` to the file's existing `ChatMessage` type definition.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && yarn test AdminChat.vue.spec.ts`
Expected: PASS (all tests in the file, not just the new one)

- [ ] **Step 5: Run the full frontend suite and commit**

```bash
cd frontend && yarn type-check && yarn lint && yarn test
```

```bash
git add frontend/src/components/AdminChat.vue frontend/src/components/__tests__/AdminChat.vue.spec.ts
git commit -m "feat: render chat picture attachments inline in AdminChat"
```

---

## Task 8: Segment suggestion -- listener side

**Files:**
- Create: `frontend/src/components/SegmentSuggestion.vue`
- Create: `frontend/src/components/__tests__/SegmentSuggestion.vue.spec.ts`
- Modify: `frontend/src/components/Landing.vue`
- Modify: `frontend/src/components/__tests__/Landing.vue.spec.ts`

**Interfaces:**
- Consumes: `useGewisAuth().getToken()`, `POST /api/v1/media` (Task 2).
- Produces: `SegmentSuggestion.vue`, a self-contained component with no props/emits.

- [ ] **Step 1: Write the failing test**

`RequestSong.vue.spec.ts` establishes the expand/collapse pattern this component's card also uses (`[role="button"]` + `aria-expanded`, imports `{ afterEach, describe, expect, it, vi } from 'vitest'` explicitly). Create `frontend/src/components/__tests__/SegmentSuggestion.vue.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountWithVuetify } from '@/test-utils';
import SegmentSuggestion from '../SegmentSuggestion.vue';

function mount() {
  return mountWithVuetify(SegmentSuggestion);
}

describe('SegmentSuggestion', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'abc' }) }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is collapsed by default', () => {
    const wrapper = mount();
    expect(wrapper.text()).not.toContain('Send');
  });

  it('expands to show the photo/voice toggle when clicked', async () => {
    const wrapper = mount();
    await wrapper.get('[role="button"]').trigger('click');
    expect(wrapper.text()).toContain('Photo');
    expect(wrapper.text()).toContain('Voice');
  });

  it('uploads a selected photo with a caption', async () => {
    const wrapper = mount();
    await wrapper.get('[role="button"]').trigger('click');

    await wrapper.get('textarea').setValue('mention this tomorrow');

    const fileInput = wrapper.get('input[type="file"]');
    const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });
    Object.defineProperty(fileInput.element, 'files', { value: [file] });
    await fileInput.trigger('change');

    // The header's role="button" div isn't a <button> tag, and the Photo/Voice
    // toggle renders two <button>s before Send -- find by text rather than
    // position/CSS so this doesn't depend on how many buttons precede it.
    const sendButton = wrapper.findAll('button').find((b) => b.text() === 'Send')!;
    await sendButton.trigger('click');

    expect(fetch).toHaveBeenCalledWith('/api/v1/media', expect.objectContaining({ method: 'POST' }));
    const call = (fetch as any).mock.calls[0][1];
    const form = call.body as FormData;
    expect(form.get('purpose')).toBe('segment_suggestion');
    expect(form.get('kind')).toBe('photo');
    expect(form.get('caption')).toBe('mention this tomorrow');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && yarn test SegmentSuggestion.vue.spec.ts`
Expected: FAIL ("Failed to resolve component" or file-not-found)

- [ ] **Step 3: Implement SegmentSuggestion.vue**

Create `frontend/src/components/SegmentSuggestion.vue`:

```html
<template>
  <v-card class="py-4 my-4 w-100" color="surface-variant" rounded="lg" variant="tonal">
    <div
      :aria-expanded="expanded"
      class="d-flex align-center justify-space-between px-4 py-3 cursor-pointer"
      role="button"
      tabindex="0"
      @click="toggle()"
      @keydown.enter.prevent="toggle()"
      @keydown.space.prevent="toggle()"
    >
      <div class="d-flex align-center">
        <v-icon class="mr-3" icon="mdi-bullhorn-outline" />

        <div>
          <div class="text-subtitle-1 font-weight-medium">Something for tomorrow's show?</div>
          <div class="text-body-2 text-medium-emphasis">Send a photo or voice memo, radio isn't live yet? No problem.</div>
        </div>
      </div>

      <v-icon :class="expanded ? 'rotate-180' : ''" icon="mdi-chevron-down" />
    </div>

    <v-expand-transition>
      <div v-show="expanded">
        <v-card-text>
          <v-btn-toggle v-model="kind" class="mb-4" color="primary" divided mandatory @click.stop>
            <v-btn value="photo">Photo</v-btn>
            <v-btn value="voice">Voice</v-btn>
          </v-btn-toggle>

          <div v-if="kind === 'photo'">
            <input ref="fileInput" accept="image/jpeg,image/png,image/webp" type="file" @change="onFileSelected" />
          </div>

          <div v-else>
            <div v-if="recordingState === 'idle'">
              <v-btn prepend-icon="mdi-microphone" variant="tonal" @click.stop="startRecording">Record</v-btn>
            </div>
            <div v-else-if="recordingState === 'recording'">
              <v-btn color="error" prepend-icon="mdi-stop" variant="tonal" @click.stop="stopRecording">Stop</v-btn>
            </div>
            <div v-else-if="recordingState === 'preview' && recordedUrl">
              <audio :src="recordedUrl" controls />
              <v-btn class="ml-2" variant="text" @click.stop="discardRecording">Re-record</v-btn>
            </div>
          </div>

          <v-textarea
            v-model="caption"
            class="mt-4"
            clearable
            label="Caption (optional)"
            rows="2"
            @click.stop
          />
        </v-card-text>

        <v-card-actions class="w-100 justify-end d-flex">
          <v-btn color="primary" :disabled="!canSend" :loading="sending" @click.stop="send">Send</v-btn>
        </v-card-actions>

        <v-alert v-if="sent" class="mx-4 mb-4" density="compact" type="success">Sent!</v-alert>
      </div>
    </v-expand-transition>
  </v-card>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useGewisAuth } from '@/composables/useGewisAuth';

const { getToken } = useGewisAuth();

const expanded = ref(false);
const kind = ref<'photo' | 'voice'>('photo');
const caption = ref('');
const sending = ref(false);
const sent = ref(false);

const fileInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);

const recordingState = ref<'idle' | 'recording' | 'preview'>('idle');
const recordedBlob = ref<Blob | null>(null);
const recordedUrl = ref<string | null>(null);
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];

function toggle() {
  expanded.value = !expanded.value;
}

function onFileSelected(e: Event) {
  selectedFile.value = (e.target as HTMLInputElement).files?.[0] ?? null;
}

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  recordedChunks = [];
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (e) => recordedChunks.push(e.data);
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
    recordedBlob.value = blob;
    recordedUrl.value = URL.createObjectURL(blob);
    recordingState.value = 'preview';
    stream.getTracks().forEach((t) => t.stop());
  };
  mediaRecorder.start();
  recordingState.value = 'recording';
}

function stopRecording() {
  mediaRecorder?.stop();
}

function discardRecording() {
  if (recordedUrl.value) URL.revokeObjectURL(recordedUrl.value);
  recordedBlob.value = null;
  recordedUrl.value = null;
  recordingState.value = 'idle';
}

const canSend = computed(() => {
  if (kind.value === 'photo') return selectedFile.value !== null;
  return recordedBlob.value !== null;
});

async function send() {
  const token = getToken();
  if (!token || !canSend.value) return;

  sending.value = true;
  try {
    const form = new FormData();
    form.append('token', token);
    form.append('purpose', 'segment_suggestion');
    form.append('kind', kind.value);
    if (caption.value.trim()) form.append('caption', caption.value.trim());

    if (kind.value === 'photo' && selectedFile.value) {
      form.append('file', selectedFile.value);
    } else if (kind.value === 'voice' && recordedBlob.value) {
      form.append('file', recordedBlob.value, 'voice-memo.webm');
    } else {
      return;
    }

    const res = await fetch('/api/v1/media', { method: 'POST', body: form });
    if (!res.ok) return;

    sent.value = true;
    selectedFile.value = null;
    if (fileInput.value) fileInput.value.value = '';
    discardRecording();
    caption.value = '';
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
.rotate-180 {
  transform: rotate(180deg);
  transition: transform 150ms;
}

.expand-transition-enter-active,
.expand-transition-leave-active {
  transition-property: height, transform, opacity !important;
  transform-origin: top center;
}

.expand-transition-enter-from,
.expand-transition-leave-to {
  transform: scale(0.95);
  opacity: 0;
}
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && yarn test SegmentSuggestion.vue.spec.ts`
Expected: PASS. If `MediaRecorder`/`navigator.mediaDevices.getUserMedia` are undefined in the jsdom test environment (they will be -- jsdom doesn't implement them), the voice-recording test paths need `vi.stubGlobal` mocks; the tests written in Step 1 above only exercise the photo path for that reason. Add a voice-path test only if this component's photo-path tests pass first and you want more coverage -- stub `navigator.mediaDevices = { getUserMedia: vi.fn().mockResolvedValue(fakeStreamWithGetTracks) }` and `window.MediaRecorder` as a mock class.

- [ ] **Step 5: Wire into Landing.vue**

In `frontend/src/components/Landing.vue`, find:

```html
    <RequestSong v-if="isStarted" />
```

Replace with:

```html
    <RequestSong v-if="isStarted" />
    <SegmentSuggestion v-if="isStarted" />
```

`frontend/vite.config.mts` configures `unplugin-vue-components` (`import Components from 'unplugin-vue-components/vite'`), which is why `RequestSong` is used in `Landing.vue` with no explicit import -- `SegmentSuggestion` needs none either.

- [ ] **Step 6: Update Landing.vue.spec.ts**

`Landing.vue.spec.ts` stubs every `isStarted`-gated child component via a `CHILD_STUBS` map and explicitly asserts (in `'shows the countdown card and hides every isStarted-gated child before start time'`) that each one doesn't exist before start time, then (in `'shows the audio stream and request-song card once started, before live status is known'`) that it does after. `SegmentSuggestion` needs the same treatment for consistency, even though its absence wouldn't fail either existing test on its own.

Add the import near the file's other component imports:

```ts
import SegmentSuggestion from '@/components/SegmentSuggestion.vue';
```

Add it to `CHILD_STUBS`:

```ts
const CHILD_STUBS = {
  AudioStream: true,
  VideoStream: true,
  UpcomingEvents: true,
  RadioChat: true,
  RequestSong: true,
  SegmentSuggestion: true,
};
```

In `'shows the countdown card and hides every isStarted-gated child before start time'`, add:

```ts
    expect(wrapper.findComponent(SegmentSuggestion).exists()).toBe(false);
```

In `'shows the audio stream and request-song card once started, before live status is known'`, add:

```ts
    expect(wrapper.findComponent(SegmentSuggestion).exists()).toBe(true);
```

- [ ] **Step 7: Run the full frontend suite and commit**

```bash
cd frontend && yarn type-check && yarn lint && yarn test
```

```bash
git add frontend/src/components/SegmentSuggestion.vue frontend/src/components/__tests__/SegmentSuggestion.vue.spec.ts frontend/src/components/Landing.vue frontend/src/components/__tests__/Landing.vue.spec.ts
git commit -m "feat: add the segment suggestion card for photo/voice memo submissions"
```

---

## Task 9: Media tab (backoffice page)

**Files:**
- Create: `frontend/src/pages/backoffice/media.vue`
- Create: `frontend/src/pages/backoffice/__tests__/media.vue.spec.ts`
- Modify: `frontend/src/pages/backoffice/index.vue`, `agenda.vue`, `dashboard.vue`, `status.vue` (nav link additions only)

**Interfaces:**
- Consumes: `POST /api/v1/media/list`, `/download`, `/delete`, `/wipe` (Tasks 2-3), `useChatStore().mediaEvent` (Task 5), `useAdminGate`, `AdminKeyGate`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/backoffice/__tests__/media.vue.spec.ts`, following `status.vue.spec.ts`'s `mountWithVuetify`/hoisted-mock/`vi.stubGlobal('fetch', ...)` pattern (quoted in full in Task 1's own research above), plus the `useChatSocket` mock `dashboard.vue.spec.ts` uses -- needed here too, since `media.vue` also calls `chatStore.ensureConnected(...)`. `dashboard.vue.spec.ts` mocks it with a plain `{ value: false }` object rather than a real `ref()` (unlike `AdminChat.vue.spec.ts`/`RadioChat.vue.spec.ts`), because neither `dashboard.vue` nor `media.vue` render `isClosed`/`connecting` directly in their own templates -- only `AdminChat.vue`'s template does, which is what actually requires a genuine reactive ref:

```ts
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountWithVuetify } from '@/test-utils';
import Media from '../media.vue';

const { ensureTokenMock, validateRadioKeyQuickMock, connectMock } = vi.hoisted(() => ({
  ensureTokenMock: vi.fn(),
  validateRadioKeyQuickMock: vi.fn(),
  connectMock: vi.fn(),
}));

vi.mock('@/composables/useGewisAuth', () => ({
  useGewisAuth: () => ({ ensureToken: ensureTokenMock, getToken: () => 'tok' }),
}));
vi.mock('@/composables/useRadioKeyValidation', () => ({
  validateRadioKeyQuick: validateRadioKeyQuickMock,
}));
vi.mock('@/composables/useChatSocket', () => ({
  useChatSocket: () => ({
    isClosed: { value: false },
    connecting: { value: false },
    connect: connectMock,
    disconnect: vi.fn(),
    send: vi.fn(),
  }),
}));

function suggestion(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'a', purpose: 'segment_suggestion', kind: 'photo', senderLidnr: 1,
    senderGivenName: 'Ada', senderFamilyName: 'Lovelace', caption: 'look at this',
    mimeType: 'image/jpeg', sizeBytes: 4, createdAt: '2026-08-16T10:00:00Z',
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

const routerLinkStub = { props: ['to'], template: '<a :href="to"><slot /></a>' };
function mount(component: typeof Media) {
  return mountWithVuetify(component, { global: { stubs: { RouterLink: routerLinkStub } } });
}

async function mountMedia(items: unknown[] = [suggestion()]) {
  setActivePinia(createPinia());
  localStorage.setItem('RADIO_ADMIN_KEY', 'stored-key');
  validateRadioKeyQuickMock.mockResolvedValue(true);
  ensureTokenMock.mockResolvedValue('a-token');

  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url === '/api/v1/media/list') return Promise.resolve(jsonResponse(items));
    throw new Error(`unexpected fetch: ${url}`);
  }));

  const wrapper = mount(Media);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await wrapper.vm.$nextTick();
  return wrapper;
}

describe('backoffice/media.vue', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows submissions grouped with sender name and caption', async () => {
    const wrapper = await mountMedia();
    expect(wrapper.text()).toContain('Ada Lovelace');
    expect(wrapper.text()).toContain('look at this');
  });

  it('shows an empty state when there are no submissions', async () => {
    const wrapper = await mountMedia([]);
    expect(wrapper.text()).toContain('No submissions');
  });

  it('deletes an item and refetches the list', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/v1/media/list') return Promise.resolve(jsonResponse([suggestion()]));
      if (url === '/api/v1/media/delete') return Promise.resolve(jsonResponse({ deleted: true }));
      throw new Error(`unexpected fetch: ${url}`);
    });
    setActivePinia(createPinia());
    localStorage.setItem('RADIO_ADMIN_KEY', 'stored-key');
    validateRadioKeyQuickMock.mockResolvedValue(true);
    ensureTokenMock.mockResolvedValue('a-token');
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mount(Media);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    await wrapper.get('[aria-label="Delete"]').trigger('click');
    await wrapper.vm.$nextTick();

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/media/delete', expect.objectContaining({ method: 'POST' }));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && yarn test media.vue.spec.ts`
Expected: FAIL (file doesn't exist)

- [ ] **Step 3: Implement media.vue**

Create `frontend/src/pages/backoffice/media.vue`:

```html
<template>
  <v-container class="py-8" fluid>
    <div class="mx-auto" style="max-width: 1000px">
      <div class="mb-6 text-center">
        <h1 class="text-h4 font-weight-bold gloria-hallelujah-regular">Media</h1>
        <div class="text-body-2 text-medium-emphasis mt-2">Segment suggestions from listeners</div>
      </div>

      <div class="d-flex justify-end mb-2 ga-4">
        <router-link to="/backoffice">Back to chat</router-link>
        <router-link to="/backoffice/agenda">Manage agenda</router-link>
        <router-link to="/backoffice/dashboard">Dashboard</router-link>
        <router-link to="/backoffice/status">Status</router-link>
      </div>

      <AdminKeyGate v-if="gate.stage.value !== 'ready'" :gate="gate" />

      <v-alert v-else-if="loadError" class="mb-4" type="error">
        Could not load media from the server.
        <div class="mt-3">
          <v-btn :disabled="loading" :loading="loading" variant="tonal" @click="load">Retry</v-btn>
        </div>
      </v-alert>

      <v-card v-else class="pa-2" color="surface-variant" rounded="lg" variant="tonal">
        <v-skeleton-loader v-if="loading" type="paragraph, image, list-item-three-line@4" />

        <template v-else>
          <v-card-title class="pa-2 d-flex flex-wrap align-center justify-space-between ga-2">
            <span>Submissions</span>

            <div class="d-flex align-center ga-2">
              <v-select
                v-if="availableDays.length > 0"
                v-model="selectedDay"
                density="compact"
                hide-details
                :items="dayOptions"
                style="max-width: 220px"
                variant="outlined"
              />
              <v-btn v-if="visibleItems.length > 0" color="error" size="small" variant="tonal" @click="confirmWipe = true">
                Wipe
              </v-btn>
            </div>
          </v-card-title>

          <v-divider />

          <div class="pa-2">
            <div v-if="visibleItems.length === 0" class="text-body-2 text-medium-emphasis">
              No submissions {{ selectedDay ? 'for this day.' : 'yet.' }}
            </div>

            <div v-else class="d-flex flex-column ga-4">
              <div v-for="item in visibleItems" :key="item.id" class="d-flex align-start ga-3">
                <img
                  v-if="item.kind === 'photo' && mediaUrls[item.id]"
                  :src="mediaUrls[item.id]"
                  alt="Submission"
                  style="max-width: 120px; max-height: 120px; border-radius: 4px"
                />
                <audio v-else-if="item.kind === 'voice' && mediaUrls[item.id]" :src="mediaUrls[item.id]" controls />
                <div v-else class="text-medium-emphasis">Loading...</div>

                <div class="flex-grow-1">
                  <div>
                    <strong>{{ item.senderGivenName }} {{ item.senderFamilyName }}</strong>
                    <span class="text-medium-emphasis ml-1">(m{{ item.senderLidnr }})</span>
                    <span class="text-caption text-medium-emphasis ml-2">{{ formatTimestamp(item.createdAt) }}</span>
                  </div>
                  <div v-if="item.caption" class="text-body-2 mt-1">{{ item.caption }}</div>
                </div>

                <div class="d-flex ga-1">
                  <v-btn aria-label="Download" icon="mdi-download" size="small" variant="text" @click="download(item)" />
                  <v-btn aria-label="Delete" icon="mdi-delete" size="small" variant="text" @click="deleteOne(item.id)" />
                </div>
              </div>
            </div>
          </div>
        </template>
      </v-card>

      <v-dialog v-model="confirmWipe" max-width="400">
        <v-card>
          <v-card-title>Wipe {{ visibleItems.length }} {{ visibleItems.length === 1 ? 'item' : 'items' }}?</v-card-title>
          <v-card-text>This can't be undone. Download anything you want to keep first.</v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" @click="confirmWipe = false">Cancel</v-btn>
            <v-btn color="error" @click="wipe">Wipe</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </div>
  </v-container>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import AdminKeyGate from '@/components/AdminKeyGate.vue';
import { useAdminGate } from '@/composables/useAdminGate';
import { useChatStore } from '@/stores/chat';

type MediaItem = {
  id: string;
  purpose: string;
  kind: 'photo' | 'voice';
  senderLidnr: number;
  senderGivenName: string;
  senderFamilyName: string;
  caption?: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

const gate = useAdminGate();
const chatStore = useChatStore();

const loading = ref(false);
const loadError = ref(false);
const items = ref<MediaItem[]>([]);
const mediaUrls = ref<Record<string, string>>({});
const confirmWipe = ref(false);

// null means "all days" -- same convention as dashboard.vue's own
// selectedDay, deliberately mirrored rather than reinvented.
const selectedDay = ref<string | null>(null);

const availableDays = computed(() => {
  const days = new Set<string>();
  for (const item of items.value) days.add(item.createdAt.slice(0, 10));
  return Array.from(days).toSorted().toReversed();
});

const dayOptions = computed(() => [
  { title: 'All days', value: null },
  ...availableDays.value.map((day) => ({ title: formatDay(day), value: day })),
]);

const visibleItems = computed(() => {
  if (!selectedDay.value) return items.value;
  return items.value.filter((item) => item.createdAt.slice(0, 10) === selectedDay.value);
});

function formatDay(day: string) {
  return new Date(day).toLocaleDateString(['nl-NL'], { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatTimestamp(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString(['nl-NL'])} ${d.toLocaleTimeString(['nl-NL'], { hour: '2-digit', minute: '2-digit' })}`;
}

function authBody(extra: Record<string, unknown> = {}) {
  return JSON.stringify({ token: gate.token.value, radioKey: gate.radioKey.value, ...extra });
}

async function fetchMediaUrl(item: MediaItem) {
  if (mediaUrls.value[item.id]) return;
  try {
    const res = await fetch('/api/v1/media/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: authBody({ id: item.id }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    mediaUrls.value = { ...mediaUrls.value, [item.id]: URL.createObjectURL(blob) };
  } catch {
    // Leaves "Loading..." on screen; the next load() retries.
  }
}

async function load() {
  loading.value = true;
  loadError.value = false;
  try {
    const res = await fetch('/api/v1/media/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: authBody(),
    });
    if (!res.ok) {
      loadError.value = true;
      return;
    }
    items.value = await res.json();
    for (const item of items.value) fetchMediaUrl(item);
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

async function download(item: MediaItem) {
  const url = mediaUrls.value[item.id];
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.download = `${item.kind}-${item.id}`;
  a.click();
}

async function deleteOne(id: string) {
  await fetch('/api/v1/media/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: authBody({ id }),
  });
  await load();
}

async function wipe() {
  confirmWipe.value = false;
  const ids = visibleItems.value.map((item) => item.id);
  if (ids.length === 0) return;
  await fetch('/api/v1/media/wipe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: authBody({ ids }),
  });
  await load();
}

onMounted(() => {
  gate.init();
});

watch(gate.stage, (stage) => {
  if (stage !== 'ready') return;
  load();
  chatStore.ensureConnected(gate.radioKey.value!);
});

// Refetch whenever a segment_suggestion notification arrives over the
// existing WebSocket, rather than polling -- see stores/chat.ts's
// mediaEvent (Task 5 of this plan).
watch(
  () => chatStore.mediaEvent,
  (event) => {
    if (event) load();
  },
);
</script>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && yarn test media.vue.spec.ts`
Expected: PASS

- [ ] **Step 5: Add a "Media" nav link to the other four backoffice pages**

In `frontend/src/pages/backoffice/index.vue`, find the nav row (a `<div class="d-flex justify-end mb-2 ga-4">` or similar containing `<router-link>` entries -- exact classes may differ slightly per page) and add one more link:

```html
<router-link to="/backoffice/media">Media</router-link>
```

Repeat for `agenda.vue`, `dashboard.vue`, and `status.vue` -- each already has its own nav row linking to the other backoffice pages; add the same `Media` link to each, in the same style as that page's existing links (do not restructure the row, just add one more `<router-link>`).

- [ ] **Step 6: Run the full frontend suite and commit**

```bash
cd frontend && yarn type-check && yarn lint && yarn test
```

```bash
git add frontend/src/pages/backoffice/media.vue frontend/src/pages/backoffice/__tests__/media.vue.spec.ts frontend/src/pages/backoffice/index.vue frontend/src/pages/backoffice/agenda.vue frontend/src/pages/backoffice/dashboard.vue frontend/src/pages/backoffice/status.vue
git commit -m "feat: add the backoffice Media tab for reviewing segment suggestions"
```

---

## Final integration check

After all 9 tasks are committed:

- [ ] Run the full backend suite once more from a clean state: `cd backend && go build ./... && go vet ./... && go test ./... -race`
- [ ] Run the full frontend suite once more: `cd frontend && yarn type-check && yarn lint && yarn test`
- [ ] Manually verify in a browser preview: upload a chat picture as a listener, confirm it renders in `AdminChat.vue`; submit a segment suggestion (photo and voice), confirm both show up in the Media tab with working playback, download, delete, and wipe.
