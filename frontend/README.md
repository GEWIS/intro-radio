# Intro Radio Frontend

[![Lint and build](https://github.com/GEWIS/radioweb/actions/workflows/lint-and-build.yml/badge.svg)](https://github.com/GEWIS/radioweb/actions/workflows/lint-and-build.yml)
[![Docker Build](https://github.com/GEWIS/radioweb/actions/workflows/docker-build.yml/badge.svg)](https://github.com/GEWIS/radioweb/actions/workflows/docker-build.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

This is the web frontend for Intro Radio, the GEWIS live stream during the introduction week. It is a Vue 3 + Vuetify single-page app that plays the Icecast/HLS stream, and, for admins, provides a backoffice chat to talk with listeners.

The chat is a WebSocket connection (`/ws?role=user` and `/ws?role=radio`) that nginx proxies to a separate backend service, alongside an `/api/` proxy for the same backend. This repository only contains the frontend; the chat/API backend lives in its own repository.

## Prerequisites

- Node.js 22.x
- Yarn via [Corepack](https://yarnpkg.com/getting-started/install) (this repo uses `nodeLinker: node-modules`, see `.yarnrc.yml`)

## Install

```bash
yarn install
```

## Development

```bash
yarn dev
```

### Production build

```bash
yarn build
```

Outputs to `dist/` for deployment.

### Preview build

```bash
yarn preview
```

## Lint and format

```bash
yarn lint       # check
yarn lint:fix    # check and fix
yarn format      # format with Prettier
```

## Docker

Two images are built from this repository, matching the `Docker Build` workflow:

- **App** -- built from the root `Dockerfile`. Builds the Vue app with Yarn and serves the static `dist/` output through nginx.

  ```bash
  docker build -t radioweb-app .
  ```

- **Nginx proxy** -- built from `nginx/Dockerfile`. Reverse-proxies `/` to the app, and `/ws` and `/api/` to the backend service (see `nginx/default.conf`).

  ```bash
  docker build -t radioweb-nginx ./nginx
  ```

## License

AGPL-3.0. See [LICENSE](LICENSE) for the full text.
