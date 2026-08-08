<p align="center">
  <img src="docs/gopher.png" alt="Go gopher mascot" width="160" />
</p>
<p align="center">
  <sub>Gopher artwork by Renee French, CC BY 3.0, via <a href="https://github.com/golang-samples/gopher-vector">golang-samples/gopher-vector</a></sub>
</p>

# Intro Radio

[![Lint and build](https://github.com/GEWIS/intro-radio/actions/workflows/lint-and-build.yml/badge.svg)](https://github.com/GEWIS/intro-radio/actions/workflows/lint-and-build.yml)
[![Docker Build](https://github.com/GEWIS/intro-radio/actions/workflows/docker-build.yml/badge.svg)](https://github.com/GEWIS/intro-radio/actions/workflows/docker-build.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

Intro Radio is GEWIS's live stream (Icecast/HLS audio and video) for the student association's introduction week, with a built-in chat between listeners and radio staff and an admin backoffice for staff to manage those conversations.

This repository is a monorepo combining what used to be two separate projects:

- **`frontend/`** -- the Vue app listeners and staff use to watch/listen and chat (formerly `GEWIS/radioweb`). See [frontend/README.md](frontend/README.md).
- **`backend/`** -- the Go server behind the chat and the stream metadata API (formerly `GEWIS/radiogaga`). See [backend/README.md](backend/README.md).

Both READMEs cover their service in depth (environment variables, message formats, HTTP endpoints); this one focuses on running the whole thing together.

## Repo layout

```
intro-radio/
|-- frontend/     Vue 3 + Vuetify SPA: player UI, listener chat, admin backoffice
|-- backend/      Go WebSocket chat server + JSON stream-metadata API
|-- scripts/      dev.sh (run both services) and dev-token.mjs (auth token helper)
|-- docs/         README assets
`-- .claude/      Claude Code launch config for browser-preview tooling
```

## Local development

### Prerequisites

- Node.js 22.x with Corepack-enabled Yarn (see `frontend/.yarnrc.yml`)
- Go 1.24+ (see `backend/go.mod`)

### Run both services

```bash
./scripts/dev.sh
```

This starts the backend on `http://localhost:8080` and the frontend on `http://localhost:3000` (which proxies `/api/v1` and `/ws` to the backend -- see `frontend/vite.config.mts`), running `yarn install` first if `frontend/node_modules` doesn't exist yet. Output from each service is prefixed with `[backend]` / `[frontend]`. Press Ctrl+C to stop both, and their child processes, cleanly.

To run a single service on its own instead, see [frontend/README.md](frontend/README.md#development) or [backend/README.md](backend/README.md#building-running-and-testing). All backend environment variables have safe local defaults -- `GEWIS_SECRET` and `RADIO_CHAT_KEY` both default to `ChangeMe`.

### Getting a chat auth token

The chat requires an HS512-signed JWT with `lidnr` / `given_name` / `family_name` claims, and there's no local login flow to produce one. `scripts/dev-token.mjs` signs one directly, using the backend's actual default secret (read from `backend/chat.go`, not guessed), and prints ready-to-use URLs:

```bash
node scripts/dev-token.mjs --lidnr 1337 --given-name Ada --family-name Lovelace
```

```
Listener chat:
  http://localhost:3000/?token=eyJhbGciOiJIUzUxMiIs...

Admin / backoffice chat:
  http://localhost:3000/backoffice?token=eyJhbGciOiJIUzUxMiIs...&key=ChangeMe
```

Open either URL once both services are running. `--lidnr`, `--given-name`, and `--family-name` are optional (they default to `1234`, `Test`, and `User`); set `GEWIS_SECRET` / `RADIO_CHAT_KEY` in the environment to override the source-read defaults if you're running the backend with custom secrets.

### Claude Code / agent preview

`.claude/launch.json` wires up `scripts/dev.sh` as a named preview target (`intro-radio`) for Claude Code's browser-preview tooling, so a single `preview_start` call brings up both services and opens a browser tab on the frontend.

## Deployment

Both services build and publish as Docker images via the shared [GEWIS/actions](https://github.com/GEWIS/actions) workflows (see `frontend/Dockerfile` and `backend/Dockerfile`), triggered on pushes and releases.

## License

AGPL-3.0. See [LICENSE](LICENSE).
