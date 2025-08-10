# RadioGaGa

RadioGaGa is a Golang-based backend for a simple Icecast stream frontend, with basic **one-on-one chat** functionality between listeners and radio staff.

Listeners connect as `role=user` and can send messages to all connected radio staff.
Staff connect as `role=radio` and can reply directly to specific users.

The backend enforces authentication via JWT for both roles, and requires a **shared admin key** for `role=radio` connections.

---

## Prerequisites

* Go 1.24 or newer
* Environment variables set in the shell
* A WebSocket-capable frontend or tool (e.g. `wscat`, browser client) to connect to `/ws`

---

## Configuration

| Variable                  | Type   | Default                                                                        | Description                                                           |
|---------------------------|--------|--------------------------------------------------------------------------------|-----------------------------------------------------------------------|
| `PORT`                    | string | `:8080`                                                                        | Port for the WebSocket server.                                        |
| `GEWIS_SECRET`            | string | *(none)*                                                                       | **Required**. HMAC secret for validating JWTs from GEWIS.             |
| `RADIO_ADMIN_KEY`         | string | *(none)*                                                                       | **Required**. Shared key for authenticating `role=radio` connections. |
| `RADIO_VIDEO_URL`         | string | `https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8` | URL pointing to the video stream.                                     |
| `RADIO_AUDIO_URL`         | string | `http://rhm1.de:8000`                                                          | URL pointing to the radio stream.                                     |
| `RADIO_AUDIO_MOUNT_POINT` | string | `/listen.aac`                                                                  | Mount point for the radio stream.                                     |

---

## Authentication

### Users (`role=user`)

* Must connect with a valid JWT signed with `GEWIS_SECRET`.
* The JWT must include:

    * `lidnr` (integer member number)
    * `given_name`
    * `family_name`
* These values are stored server-side and sent with each outgoing message.

### Radio Staff (`role=radio`)

* Must connect with **both**:

    * A valid JWT as above
    * The correct `RADIO_ADMIN_KEY` provided in the handshake message.

If authentication fails, the server closes the connection immediately.

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
     "radioKey": "<RADIO_ADMIN_KEY>"
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

    * `to` is omitted → message goes to all connected radio staff.
* **From radio staff**:

    * `to` must be the target user’s `lidnr`.

### Receiving

```json
{
  "from": "12345",
  "to": "22222",
  "content": "Hi there",
  "givenName": "Alice",
  "familyName": "User"
}
```

* All outgoing messages now include the sender’s **given name** and **family name**.

---

## Session Management

* If the same `lidnr` connects again, the previous connection is closed with **close code 4100**.
* Connections without a valid handshake are closed immediately.
* Each connected user is tracked with:

    * `lidnr`
    * `givenName`
    * `familyName`
    * Last activity timestamp
    * Unread message count (for UI indicators)