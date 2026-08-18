package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
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

func makeUploadRequest(t *testing.T, fields map[string]string, fileField, fileName string, fileContent []byte) *http.Request {
	t.Helper()
	// Determine MIME type based on file extension
	mimeType := "application/octet-stream"
	if strings.HasSuffix(fileName, ".jpg") || strings.HasSuffix(fileName, ".jpeg") {
		mimeType = "image/jpeg"
	} else if strings.HasSuffix(fileName, ".png") {
		mimeType = "image/png"
	} else if strings.HasSuffix(fileName, ".webp") {
		mimeType = "image/webp"
	} else if strings.HasSuffix(fileName, ".webm") {
		mimeType = "audio/webm"
	} else if strings.HasSuffix(fileName, ".ogg") {
		mimeType = "audio/ogg"
	} else if strings.HasSuffix(fileName, ".mp3") {
		mimeType = "audio/mpeg"
	}
	return makeUploadRequestWithContentType(t, fields, fileField, fileName, fileContent, mimeType)
}

// makeUploadRequestWithContentType is makeUploadRequest but with an explicit
// Content-Type for the file part instead of one derived from fileName's
// extension -- needed to exercise a MIME type that carries a codecs=
// parameter (e.g. "audio/webm;codecs=opus", what a real browser's
// MediaRecorder.mimeType actually produces), which no fileName extension
// maps to.
func makeUploadRequestWithContentType(t *testing.T, fields map[string]string, fileField, fileName string, fileContent []byte, contentType string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for k, v := range fields {
		if err := writer.WriteField(k, v); err != nil {
			t.Fatalf("WriteField: %v", err)
		}
	}
	if fileField != "" {
		header := make(textproto.MIMEHeader)
		header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, fileField, fileName))
		header.Set("Content-Type", contentType)
		part, err := writer.CreatePart(header)
		if err != nil {
			t.Fatalf("CreatePart: %v", err)
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

func TestMediaUploadHandlerAcceptsVoiceMimeTypeWithCodecsParam(t *testing.T) {
	GEWISSecret = "testsecret"
	chat := NewChat()
	store := newTestMediaStore(t)
	tok := makeToken(t, GEWISSecret, 1337, "Ada", "Lovelace", time.Minute)

	// Chrome/Edge's MediaRecorder.mimeType after start() is exactly this --
	// a codecs= parameter riding along with the base type -- and that full
	// string lands on the multipart part's Content-Type verbatim (see
	// SegmentSuggestion.vue's blob construction). Before the C1 fix, the
	// handler's exact-match lookup never found this in allowedVoiceMimeTypes
	// and every real voice submission 400ed.
	req := makeUploadRequestWithContentType(t, map[string]string{
		"token":   tok,
		"purpose": MediaPurposeSegmentSuggestion,
		"kind":    MediaKindVoice,
	}, "file", "voice-memo.webm", []byte("fake-opus-bytes"), "audio/webm;codecs=opus")

	rec := httptest.NewRecorder()
	mediaUploadHandler(chat, store, rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var got MediaItem
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.MimeType != "audio/webm" {
		t.Fatalf("expected the codecs param stripped down to the base type audio/webm, got %q", got.MimeType)
	}
}

func TestMediaUploadHandlerAcceptsIOSSafariVoiceMimeType(t *testing.T) {
	GEWISSecret = "testsecret"
	chat := NewChat()
	store := newTestMediaStore(t)
	tok := makeToken(t, GEWISSecret, 1337, "Ada", "Lovelace", time.Minute)

	// iOS Safari's MediaRecorder emits audio/mp4, which wasn't in the
	// allow-list at all (params or not) before the C1 fix.
	req := makeUploadRequestWithContentType(t, map[string]string{
		"token":   tok,
		"purpose": MediaPurposeSegmentSuggestion,
		"kind":    MediaKindVoice,
	}, "file", "voice-memo.mp4", []byte("fake-aac-bytes"), "audio/mp4")

	rec := httptest.NewRecorder()
	mediaUploadHandler(chat, store, rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var got MediaItem
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.MimeType != "audio/mp4" {
		t.Fatalf("expected mime type audio/mp4, got %q", got.MimeType)
	}
}

func TestMediaUploadHandlerRejectsMalformedContentType(t *testing.T) {
	GEWISSecret = "testsecret"
	chat := NewChat()
	store := newTestMediaStore(t)
	tok := makeToken(t, GEWISSecret, 1337, "Ada", "Lovelace", time.Minute)

	// A Content-Type mime.ParseMediaType itself can't parse (as opposed to
	// one it parses fine but that simply isn't on the allow-list) must
	// still come back as a clean 400, not a panic or 500.
	req := makeUploadRequestWithContentType(t, map[string]string{
		"token":   tok,
		"purpose": MediaPurposeSegmentSuggestion,
		"kind":    MediaKindPhoto,
	}, "file", "photo.jpg", []byte("bytes"), "image/jpeg/extra")

	rec := httptest.NewRecorder()
	mediaUploadHandler(chat, store, rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for a malformed content type, got %d", rec.Code)
	}
	if len(store.List()) != 0 {
		t.Fatalf("expected nothing to be stored")
	}
}

func TestMediaUploadHandlerAcceptsVideoMimeTypes(t *testing.T) {
	// mp4 nearly everywhere, quicktime (.mov) from iOS's own camera/gallery
	// picker, webm from some Android camera apps.
	for _, mimeType := range []string{"video/mp4", "video/quicktime", "video/webm"} {
		t.Run(mimeType, func(t *testing.T) {
			GEWISSecret = "testsecret"
			chat := NewChat()
			store := newTestMediaStore(t)
			tok := makeToken(t, GEWISSecret, 1337, "Ada", "Lovelace", time.Minute)

			req := makeUploadRequestWithContentType(t, map[string]string{
				"token":   tok,
				"purpose": MediaPurposeSegmentSuggestion,
				"kind":    MediaKindVideo,
			}, "file", "clip.mp4", []byte("fake-video-bytes"), mimeType)

			rec := httptest.NewRecorder()
			mediaUploadHandler(chat, store, rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
			}
			var got MediaItem
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if got.MimeType != mimeType {
				t.Fatalf("expected mime type %q, got %q", mimeType, got.MimeType)
			}
		})
	}
}

func TestMediaUploadHandlerRejectsVideoForChatAttachment(t *testing.T) {
	GEWISSecret = "testsecret"
	chat := NewChat()
	store := newTestMediaStore(t)
	tok := makeToken(t, GEWISSecret, 1337, "Ada", "Lovelace", time.Minute)

	// Video is only offered as a segment suggestion -- a chat_attachment
	// carrying kind=video must be rejected server-side, not just omitted
	// from the chat UI's file picker.
	req := makeUploadRequestWithContentType(t, map[string]string{
		"token":   tok,
		"purpose": MediaPurposeChatAttachment,
		"kind":    MediaKindVideo,
	}, "file", "clip.mp4", []byte("fake-video-bytes"), "video/mp4")

	rec := httptest.NewRecorder()
	mediaUploadHandler(chat, store, rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 rejecting video for chat_attachment, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(store.List()) != 0 {
		t.Fatalf("expected nothing to be stored")
	}
}

func TestMediaUploadHandlerRejectsOversizedVideo(t *testing.T) {
	GEWISSecret = "testsecret"
	chat := NewChat()
	store := newTestMediaStore(t)
	tok := makeToken(t, GEWISSecret, 1337, "Ada", "Lovelace", time.Minute)

	// Distinct from TestMediaUploadHandlerRejectsOversizedFile (photo's own
	// cap) -- video's 50MB cap is a different constant, and the generic
	// maxUploadBytes reader must be sized to let a request this size
	// through far enough to hit video's own kind-specific check.
	tooBig := bytes.Repeat([]byte("x"), maxVideoBytes+1)
	req := makeUploadRequestWithContentType(t, map[string]string{
		"token":   tok,
		"purpose": MediaPurposeSegmentSuggestion,
		"kind":    MediaKindVideo,
	}, "file", "clip.mp4", tooBig, "video/mp4")

	rec := httptest.NewRecorder()
	mediaUploadHandler(chat, store, rec, req)

	if rec.Code != http.StatusBadRequest && rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected a 4xx rejection for an oversized video, got %d", rec.Code)
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

	// Drain the initial presence message that arrives when the radio connects
	if _, err := readJSONWithDeadline[PresenceMessage](t, radio, time.Second); err != nil {
		t.Fatalf("expected initial presence message: %v", err)
	}

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

	// Drain the initial presence message that arrives when the radio connects
	if _, err := readJSONWithDeadline[PresenceMessage](t, radio, time.Second); err != nil {
		t.Fatalf("expected initial presence message: %v", err)
	}

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

func TestMediaWipeHandlerBroadcastsOnlyForDeletedSegmentSuggestions(t *testing.T) {
	GEWISSecret = "testsecret"
	RADIOChatKey = "correct-key"
	chat := NewChat()
	store := newTestMediaStore(t)
	must(t, store.Add(MediaItem{ID: "seg1", Purpose: MediaPurposeSegmentSuggestion, CreatedAt: time.Now()}, []byte("1")))
	must(t, store.Add(MediaItem{ID: "seg2", Purpose: MediaPurposeSegmentSuggestion, CreatedAt: time.Now()}, []byte("2")))
	must(t, store.Add(MediaItem{ID: "chat1", Purpose: MediaPurposeChatAttachment, CreatedAt: time.Now()}, []byte("3")))

	_, wsBase := startTestServer(t, chat)
	radioTok := makeToken(t, GEWISSecret, 9, "Staff", "Member", time.Minute)
	radio := dialAndHandshake(t, wsBase, "radio", radioTok, RADIOChatKey)
	defer radio.Close()

	// Drain the initial presence message that arrives when the radio connects
	if _, err := readJSONWithDeadline[PresenceMessage](t, radio, time.Second); err != nil {
		t.Fatalf("expected initial presence message: %v", err)
	}

	tok := makeToken(t, GEWISSecret, 1, "A", "B", time.Minute)
	// Request to wipe seg1, seg2, and chat1 (a chat_attachment)
	body, _ := json.Marshal(mediaIDRequest{Token: tok, RadioKey: "correct-key", IDs: []string{"seg1", "seg2", "chat1"}})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/media/wipe", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	mediaWipeHandler(chat, store, rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Read the first broadcast - should be for seg1
	broadcast1, err := readJSONWithDeadline[MediaBroadcast](t, radio, time.Second)
	if err != nil {
		t.Fatalf("expected first broadcast, got: %v", err)
	}
	if broadcast1.Event != "deleted" || broadcast1.ID != "seg1" {
		t.Fatalf("expected first broadcast for seg1, got %+v", broadcast1)
	}

	// Read the second broadcast - should be for seg2
	broadcast2, err := readJSONWithDeadline[MediaBroadcast](t, radio, time.Second)
	if err != nil {
		t.Fatalf("expected second broadcast, got: %v", err)
	}
	if broadcast2.Event != "deleted" || broadcast2.ID != "seg2" {
		t.Fatalf("expected second broadcast for seg2, got %+v", broadcast2)
	}

	// Verify chat1 was not deleted and no broadcast was sent for it
	if _, ok := store.Get("chat1"); !ok {
		t.Fatalf("expected chat1 (a chat_attachment) to survive even though it was in the wipe request")
	}

	// Try to read a third message - should timeout (no broadcast for chat1)
	_, err = readJSONWithDeadline[MediaBroadcast](t, radio, 100*time.Millisecond)
	if err == nil {
		t.Fatalf("expected no third broadcast for the protected chat_attachment, but got one")
	}
}
