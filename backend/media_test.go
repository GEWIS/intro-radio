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

func TestMediaStoreReadBytesRejectsPathTraversal(t *testing.T) {
	m := newTestMediaStore(t)
	must(t, m.Add(MediaItem{ID: "legitimate", Purpose: MediaPurposeSegmentSuggestion, CreatedAt: time.Now()}, []byte("safe")))

	// Attempt to read a non-existent item with path-traversal characters
	_, err := m.ReadBytes("../../../etc/passwd")
	if err == nil {
		t.Fatalf("expected ReadBytes to reject path-traversal id, but it succeeded")
	}

	// Verify that legitimate reads still work
	data, err := m.ReadBytes("legitimate")
	if err != nil {
		t.Fatalf("ReadBytes legitimate: %v", err)
	}
	if string(data) != "safe" {
		t.Fatalf("got bytes %q, want %q", data, "safe")
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
