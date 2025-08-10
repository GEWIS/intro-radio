# RadioGaGa

RadioGaGa is a Golang-based backend for a simple Icecast stream frontend, adding basic one-on-one chat functionality between listeners and radio staff.  
Listeners connect as `role=user` and can send messages to all connected radio staff. Staff connect as `role=radio` and can reply directly to specific users.  
In the future, the backend may be extended with more features, but for now it is just for chatting.

> [!WARNING]
> Authentication is not implemented yet, so anyone can connect as either `role=user` or `role=radio`.

## Prerequisites

- Go 1.24 or newer
- Environment variables set in the shell
- An HTTP client or WebSocket-capable frontend to connect to `/ws`

## Configuration

The following environment variables are supported:

| Variable | Type   | Default  | Description                                   |
|----------|--------|----------|-----------------------------------------------|
| `PORT`   | string | `:8080`  | The port on which the WebSocket server runs.  |

## Usage

Start the server:

```bash
go run .
````

Connect clients to the WebSocket endpoint:

```
ws://localhost:8080/ws?role=user
```

or

```
ws://localhost:8080/ws?role=radio
```

### Message format

Messages are JSON objects:

```json
{
  "to": "user-id-if-radio",
  "content": "Hello!"
}
```

* For `role=user`, omit the `to` field to broadcast to all radio staff.
* For `role=radio`, `to` must be the user ID (the server uses their remote address as ID).