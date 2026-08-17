# Media Attachments: Chat Pictures and Segment Suggestions

**Status:** Approved design, ready for implementation planning.

**Origin:** [GEWIS/intro-radio#59](https://github.com/GEWIS/intro-radio/issues/59) and [#60](https://github.com/GEWIS/intro-radio/issues/60) prompted a broader conversation about media in the app; this spec covers the two ideas that came out of it: sending pictures in chat, and a separate way to send the radio something to talk about when it's off air for the day.

## Motivation

Two related but distinct requests:

1. Listeners want to send a picture as part of an ongoing chat conversation with the radio, the same way they'd send a text message.
2. Listeners want a way to send the radio something -- a photo or a voice memo -- when the radio isn't live (e.g. late at night, "people are out partying but still want to reach the radio"), for staff to review and possibly bring up on air the next morning.

These look similar (both involve uploading a photo or audio) but serve different purposes and need different treatment, covered in detail below.

## Two kinds of submission

**Chat picture attachment** (`purpose: chat_attachment`) -- a photo attached to a specific ongoing chat conversation. It is a message. It lives inside that listener's chat thread exactly as ephemerally as the surrounding text: today's chat has no persistence at all (in-memory only, gone on reconnect), and this doesn't change that. No review UI, no listing, no per-item management.

**Segment suggestion** (`purpose: segment_suggestion`) -- a standalone photo or voice memo, submitted independently of any chat conversation, with an optional text caption. This is what shows up in the new backoffice **Media** tab for staff to review, play back, download, or delete. Not tied to a specific chat thread. Not gated on whether the radio is currently live -- "radio is off for the day" is the motivating scenario, not an enforced precondition; this entry point is simply always available whenever the intro week has started, same as the existing chat.

Both share one storage backbone (below), distinguished by the `purpose` field. Staff-to-listener media (replying *with* a photo or voice memo) is explicitly out of scope.

## Why not extend the existing chat protocol directly

The chat WebSocket caps messages at 32KB (`maxMessageBytes` in `backend/chat.go`) and has no persistence of any kind -- messages live in memory and vanish on reconnect. Both properties rule it out as a transport for the actual bytes: photos and voice memos routinely exceed 32KB, and a segment suggestion specifically needs to survive until a staff member reviews it the next morning. The WebSocket channel is still used, but only to notify connected admins that something new has arrived -- the same way it already broadcasts new text messages.

## Data model

Follows the existing file-backed-JSON pattern used throughout this backend (`agenda.go`, `metrics.go`, `audit.go`): no database, a mutex-guarded in-memory index persisted to a JSON file under the `/data` volume, raw bytes as individual files on disk.

```go
type MediaItem struct {
    ID              string    `json:"id"`
    Purpose         string    `json:"purpose"`         // "chat_attachment" | "segment_suggestion"
    Kind            string    `json:"kind"`             // "photo" | "voice"
    SenderLidnr     int       `json:"senderLidnr"`
    SenderGivenName string    `json:"senderGivenName"`
    SenderFamilyName string   `json:"senderFamilyName"`
    Caption         string    `json:"caption,omitempty"` // segment_suggestion only
    MimeType        string    `json:"mimeType"`
    SizeBytes       int64     `json:"sizeBytes"`
    DurationSeconds float64   `json:"durationSeconds,omitempty"` // voice only
    CreatedAt       time.Time `json:"createdAt"`
}
```

- Metadata index: `media.json` (env var `MEDIA_FILE`, matching `AGENDA_FILE`/`METRICS_FILE`/`AUDIT_LOG_FILE`'s naming convention), loaded at startup, tolerant of a missing file, persisted on every mutation via the existing `writeJSONFile` helper (atomic temp-file-plus-rename).
- Raw bytes: `/data/media/<id>` (extension-less; `MimeType` on the metadata record is authoritative for `Content-Type` on download).
- `MediaStore` type: mutex-guarded `[]MediaItem` plus the same `Append`/`List`/`Load` shape `MetricsStore`/`AuditLog` already have. Two new operations beyond those: `Delete(id string) error` (removes both the metadata entry and the on-disk file) and `DeleteMany(ids []string) []string` (same, bulk; returns the ids actually removed, for the wipe handler's response).

No total-item cap and no database -- consistent with every other persistence decision in this codebase. See "Known limitations" for the accepted risk here.

## Retention

- `segment_suggestion` items: **manual only**. Never auto-deleted. Staff explicitly deletes (one at a time) or wipes (bulk) from the Media tab.
- `chat_attachment` items: **automatic, 48-hour TTL**. These have no management UI at all (no delete button, no listing) -- without automatic cleanup they'd accumulate forever with no way to remove them. A background sweep, structurally identical to `MetricsStore.Run`'s ticker, runs periodically (every 30 minutes is frequent enough for a 48h window) and deletes any `chat_attachment` item whose `CreatedAt` is older than 48 hours. It never touches `segment_suggestion` items regardless of age.

## Backend API

All endpoints live in a new `backend/media.go`, following the existing handler shape (explicit dependencies as parameters, not package globals -- see `main.go`'s own comment on `radioKeyValidateHandler` for why).

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/v1/media` | GEWIS token only (no radio key -- mirrors the chat WebSocket's `role=user` handshake) | Listener uploads a file (multipart). Body fields: `token`, `purpose`, `kind`, `caption` (optional), the file itself. Returns the created `MediaItem`. |
| `POST /api/v1/media/list` | `{token, radioKey}` | Staff lists all `segment_suggestion` items, newest first. `chat_attachment` items are never returned here. |
| `POST /api/v1/media/download` | `{token, radioKey, id}` | Streams raw bytes with the stored `MimeType`. Used for both inline playback (fetched, wrapped in a Blob/ObjectURL client-side) and the download button (same fetch; the button just saves the already-fetched blob). |
| `POST /api/v1/media/delete` | `{token, radioKey, id}` | Deletes one item (metadata + file). Broadcasts a WebSocket notification (below) so other connected admins' views stay in sync. |
| `POST /api/v1/media/wipe` | `{token, radioKey, ids}` | Deletes the given `segment_suggestion` items. `ids` omitted or empty deletes *all* `segment_suggestion` items. Broadcasts one notification per deleted id (or a single batch notification -- implementation's call, functionally equivalent). Never touches `chat_attachment` items even if their ids were somehow passed in. |

`wipe` takes an explicit `ids` list rather than a date-range filter: the frontend's Media tab already computes "which items belong to the selected day" for its own display (see below), so it just reuses that computed list rather than teaching the backend date-range logic in a second language.

Upload validation: size capped via `http.MaxBytesReader` (~15MB for photos, ~10MB for voice memos), `Kind`/`MimeType` checked against a small allow-list (photos: JPEG/PNG/WebP; voice: whatever `MediaRecorder` produces in practice, typically WebM/Opus -- confirm exact browser output during implementation and allow-list accordingly). A rejected upload is a 400 with a specific reason, matching this codebase's existing convention of surfacing the backend's actual validation message rather than a generic error (see `agenda.vue`'s save-error handling for precedent).

## WebSocket notification

Rather than a parallel notification format, extend the existing `OutgoingMessage` struct (`backend/chat.go`) with two optional fields:

```go
type OutgoingMessage struct {
    From       string `json:"from"`
    GivenName  string `json:"given_name,omitempty"`
    FamilyName string `json:"family_name,omitempty"`
    To         string `json:"to,omitempty"`
    Content    string `json:"content"`
    MediaID    string `json:"mediaId,omitempty"`
    MediaKind  string `json:"mediaKind,omitempty"`  // "photo" | "voice"
    MediaEvent string `json:"mediaEvent,omitempty"` // "new" | "deleted" -- segment_suggestion notifications only
}
```

A `chat_attachment` upload triggers a call into the *same* `forwardToRadios` broadcast path text messages already use, with `Content` empty and `MediaID`/`MediaKind` populated. This means it automatically inherits the identity handling already in place there (listener identity visible to staff, exactly as it is for text today -- see `backend/chat.go`'s `dispatch()`, which forwards listener-authored messages to radios with the sender's real identity, only sanitizing the reverse direction).

`segment_suggestion` uploads and delete/wipe actions are never part of a chat thread and must never reach `forwardToUser`/any listener-facing path. They get their own minimal notification: reuse the extended `OutgoingMessage` struct with `To` and `Content` both empty, `MediaID` set, and a new `MediaEvent` field (`"new"` | `"deleted"`) so the Media tab knows to refetch its list -- sent only via `forwardToRadios`, never to a specific listener.

## Frontend: listener side

**Chat picture attachment** -- an attach button next to `RadioChat.vue`'s existing text input. Opens a file picker (`accept="image/*"`, plus `capture="environment"` so mobile opens the camera directly rather than a gallery browser). Uploads via `POST /api/v1/media` with `purpose: chat_attachment`, no caption field. The resulting message appears inline in the conversation like any other message, sender's own copy included, with a small upload-progress indicator for slower connections.

**Segment suggestion** -- a new standalone component (`SegmentSuggestion.vue`), an expandable card on the landing page styled and positioned like the existing "Choose your song" card (`RequestSong.vue`): collapsed by default, click to expand, shown whenever `isStarted` (the same gate `RequestSong` already uses) with no dependency on live stream status. Expanded contents: a Photo/Voice toggle; for Photo, a file picker; for Voice, a record button using `MediaRecorder`/`getUserMedia` (tap to start, tap to stop, then a playback preview of the just-recorded clip with Re-record/Send -- so a bad take is never sent irreversibly); an optional caption text field; a Send button. Uploads via `POST /api/v1/media` with `purpose: segment_suggestion`.

## Frontend: staff side

**`AdminChat.vue`**: a `chat_attachment` message (`mediaId`/`mediaKind` present, `content` empty) renders as a thumbnail in that listener's thread instead of text -- click to view full-size. Fetched via `POST /api/v1/media/download`, same auth body every other backoffice fetch already uses. As ephemeral as the rest of the thread: reload the page and it's gone, same as today's text messages.

**New Media tab** (`frontend/src/pages/backoffice/media.vue`, linked from the existing cross-nav row on the other backoffice pages): grouped per day, reusing the day-picker/grouping pattern already built into `dashboard.vue` (`selectedDay`/`availableDays`/`dayOptions`) rather than inventing a second one. Each item shows a thumbnail (photo, click for full-size) or an `<audio controls>` player (voice), its caption if present, sender name + member number + timestamp, and Download/Delete buttons. A "Wipe" action operates on whatever set of items the current day filter resolves to -- including everything, if "All days" is selected -- by collecting those items' ids and calling `POST /api/v1/media/wipe`.

## Known limitations (accepted, not solved by this design)

- No total-disk-quota enforcement. A single week-long, GEWIS-internal event is unlikely to generate enough volume for this to matter in practice; revisit if it ever does.
- No rate-limiting beyond per-file size caps. Senders are identified via GEWIS SSO (not anonymous), which is a real deterrent on its own; add rate-limiting only if abuse actually happens.
- No automated content moderation (e.g. image scanning). Out of scope -- deletion is fast and easy (single-item delete, or wipe) as the mitigation instead.
- MIME-type validation trusts the browser's declared `Content-Type` rather than sniffing file contents. Acceptable for a small trusted audience; content-sniffing (`http.DetectContentType`) is a cheap hardening step to add later if it's ever needed.

## Testing approach

**Backend** (`backend/media_test.go`), following the table-driven conventions already established in `metrics_test.go`/`audit_test.go`:
- `MediaStore`: append/list/delete/wipe, persistence round-trip, tolerates a missing file on load.
- Upload handler: auth gating, size-cap rejection, MIME allow-list rejection, successful upload returns correct metadata with the right `purpose`/`caption`/`kind`.
- List handler: returns `segment_suggestion` items only, never `chat_attachment`.
- Download handler: correct bytes and `Content-Type`, 401 on bad auth, 404 on unknown id.
- Delete/wipe handlers: removes metadata and the underlying file, broadcasts the expected notification, wipe never removes a `chat_attachment` item even if asked to.
- The 48h sweep: removes `chat_attachment` items past the TTL, never removes `segment_suggestion` items regardless of age.

**Frontend** (Vitest, colocated `__tests__`, matching existing convention):
- `RadioChat.vue`: attach-button flow, upload call shape, rendering a sent attachment.
- `SegmentSuggestion.vue`: mode toggle, file-picker flow, mocked `MediaRecorder`/`getUserMedia` record/preview/re-record/send flow, caption field, upload call shape.
- `AdminChat.vue`: rendering an incoming `chat_attachment` message as a thumbnail instead of text.
- `media.vue`: day grouping/filtering (mirroring `dashboard.vue`'s own test conventions), download/delete/wipe actions, empty states.
