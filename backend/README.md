# RadioGaGa

[![CI](https://github.com/GEWIS/intro-radio/actions/workflows/ci.yml/badge.svg)](https://github.com/GEWIS/intro-radio/actions/workflows/ci.yml)

RadioGaGa is a Golang-based backend for a simple Icecast/HLS stream frontend, with basic **one-on-one chat** functionality between listeners and radio staff.

Listeners connect as `role=user` and can send messages to all connected radio staff.
Staff connect as `role=radio` and can reply directly to specific users, with messages mirrored to other connected staff.

The backend enforces authentication via JWT for both roles, and requires a **shared radio key** for `role=radio` connections.

It is designed to pair with a WebSocket-capable frontend; [GEWIS/radioweb](https://github.com/GEWIS/radioweb) is the companion Vue app that connects to `/ws?role=radio`, consumes `/api/v1/radio`, and speaks the same message shape described below.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Configuration](#configuration)
- [Building, Running and Testing](#building-running-and-testing)
- [Docker](#docker)
- [HTTP API](#http-api)
- [WebSocket Authentication](#websocket-authentication)
- [Connection Flow](#connection-flow)
- [Message Format](#message-format)
- [Session Management](#session-management)

---

## Prerequisites

* Go 1.24 or newer (see `go.mod`)
* Environment variables set in the shell, or a `.env` file in the working directory (loaded automatically via `godotenv`)
* A WebSocket-capable frontend or tool (e.g. `wscat`, browser client) to connect to `/ws`

---

## Configuration

| Variable                  | Default                                                                        | Description                                                                                     |
|----------------------------|---------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| `PORT`                    | `:8080`                                                                        | Address/port the HTTP and WebSocket server listens on.                                          |
| `GEWIS_SECRET`            | `ChangeMe`                                                                     | HMAC secret used to verify the HS512-signed JWT presented at WebSocket handshake.                |
| `RADIO_CHAT_KEY`          | `ChangeMe`                                                                     | Shared key that `role=radio` connections must present as `radioKey` in the handshake.           |
| `ALLOWED_ORIGINS`         | `https://radio.gewis.nl,http://localhost:3000`                                | Comma-separated list of `Origin` header values accepted for WebSocket handshakes.               |
| `RADIO_VIDEO_URL`         | `https://hd-auth.skylinewebcams.com/live.m3u8?a=2j5v70ov5ng6jq544ji0u6kjh3`    | Video stream URL, returned by `GET /api/v1/radio`.                                               |
| `RADIO_AUDIO_URL`         | `bata-radio.snt.utwente.nl`                                                    | Audio/radio stream host, returned by `GET /api/v1/radio`.                                        |
| `RADIO_AUDIO_MOUNT_POINT` | `/high`                                                                        | Mount point for the audio stream, returned by `GET /api/v1/radio`.                                |
| `RADIO_START_TIME`        | `2025-08-18T07:00:00Z`                                                         | Broadcast start time, returned by `GET /api/v1/radio`.                                            |
| `RADIO_GEWIS_TOKEN`       | `gewis-radio`                                                                  | Token value returned by `GET /api/v1/token`.                                                      |
| `LOG_LEVEL`               | `trace`                                                                        | zerolog log level (`trace`, `debug`, `info`, `warn`, `error`, ...).                               |

The defaults for `GEWIS_SECRET` and `RADIO_CHAT_KEY` are placeholder values meant for local development only -- set real values in any production deployment.

---

## Building, Running and Testing

```bash
# Build the binary
go build ./...

# Run the server (reads env vars / .env from the current directory)
go run .

# Run the test suite
go test ./...
```

---

## Docker

The root `Dockerfile` builds a small statically-linked binary and copies it into an `alpine` base image:

```bash
# Build the image
docker build -t radiogaga .

# Run it, passing configuration via environment variables
docker run -p 8080:8080 \
  -e GEWIS_SECRET=your-secret \
  -e RADIO_CHAT_KEY=your-radio-key \
  radiogaga
```

CI builds this image via the `dockerize` job in the root [CI workflow](https://github.com/GEWIS/intro-radio/blob/main/.github/workflows/ci.yml) on every push and PR, and pushes it via the shared `docker-release-ghcr.yml` GEWIS workflow on every release to `main`.

---

## HTTP API

In addition to the WebSocket chat endpoint, the server exposes a few small JSON endpoints:

| Method & Path       | Description                                                                 |
|----------------------|-------------------------------------------------------------------------------|
| `GET /api/v1/health` | Health check. Returns `{"status":"ok"}`.                                     |
| `GET /api/v1/token`  | Returns the configured `RADIO_GEWIS_TOKEN` value as a JSON string.            |
| `GET /api/v1/radio`  | Returns stream metadata: `videoUrl`, `audioUrl`, `audioMountPoint`, `startTime`. |
| `POST /api/v1/radio-key/validate` | Validates a GEWIS JWT + candidate radio key, using the same checks as a `role=radio` WebSocket handshake. Body: `{"token": "...", "radioKey": "..."}`. Returns `200 {"valid":true}` on success or `401 {"valid":false}` on any failure (bad token, bad lidnr, or bad key -- never distinguished, to avoid giving a caller an oracle). `400` on a malformed body, `405` on anything but `POST`. |

---

## WebSocket Authentication

Before any handshake is read, the upgrade request's `Origin` header (when present) is checked against `ALLOWED_ORIGINS` as defense-in-depth; requests from other origins are rejected with `403` before the connection is upgraded. Requests without an `Origin` header (non-browser clients) are not subject to this check.

### Users (`role=user`)

* Must connect with a valid JWT signed with `GEWIS_SECRET` (HS512).
* The JWT must include:

    * `lidnr` (integer member number)
    * `given_name`
    * `family_name`
* These values are stored server-side and sent with each outgoing message.
* Only the token's signature and algorithm are checked at handshake -- an expired token is logged but still accepted.

### Radio Staff (`role=radio`)

* Must connect with **both**:

    * A valid JWT as above
    * The correct `RADIO_CHAT_KEY` provided as `radioKey` in the handshake message.

If authentication fails, or the radio key is wrong, the server closes the connection immediately (with close code `4103` for an invalid radio key).

---

## Connection Flow

1. Connect to:

   ```
   ws://localhost:8080/ws?role=user
   ```

   or:

   ```
   ws://localhost:8080/ws?role=radio
   ```

2. The **first** message sent after connecting must be a JSON handshake:

   #### User handshake

   ```json
   {
     "token": "<JWT>"
   }
   ```

   #### Radio handshake

   ```json
   {
     "token": "<JWT>",
     "radioKey": "<RADIO_CHAT_KEY>"
   }
   ```

3. After a successful handshake, you may send chat messages.

---

## Message Format

### Sending

```json
{
  "to": "22222",
  "content": "Hello!"
}
```

* **From users**:

    * `to` is omitted -> message goes to all connected radio staff.
* **From radio staff**:

    * `to` must be the target user's `lidnr`.
    * If set, the message is also mirrored to other connected radio staff.

### Receiving

```json
{
  "from": "12345",
  "to": "22222",
  "content": "Hi there",
  "given_name": "Alice",
  "family_name": "User"
}
```

* All outgoing messages include the sender's `given_name` and `family_name`.

---

## Session Management

* Each connected user is tracked by `lidnr`, `given_name`, and `family_name`.
* If the same `lidnr` connects again, the previous connection is closed with **close code 4100**.
* Connections without a valid handshake are closed immediately.
* A read deadline is renewed on every pong response, so dead peers are detected and dropped automatically.
