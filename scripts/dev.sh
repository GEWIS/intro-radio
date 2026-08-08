#!/usr/bin/env bash
# Runs the Intro Radio backend and frontend together for local development.
#
# Usage:
#   scripts/dev.sh
#
# Starts:
#   backend/   Go server   -> http://localhost:8080 (env vars: see backend/README.md)
#   frontend/  Vite server -> http://localhost:3000 (proxies /api/v1 and /ws to the backend)
#
# Output from each service is prefixed with [backend] / [frontend]. Ctrl+C
# (or SIGTERM) stops both and their child processes cleanly.
#
# To get an auth token for the chat, run scripts/dev-token.mjs in another
# terminal once both services are up.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

BACKEND_PID=""
FRONTEND_PID=""

# Prefixes each line of stdin with "[label] ".
prefix() {
  local label="$1"
  while IFS= read -r line; do
    printf '[%s] %s\n' "$label" "$line"
  done
}

# Recursively sends $1 (a signal name, e.g. TERM or KILL) to $2 and all of
# its descendant processes. This is needed because `go run` and `yarn`
# both spawn a child process (the compiled binary / vite) that would
# otherwise be left running when only the wrapper's PID is killed.
kill_tree() {
  local sig="$1" pid="$2"
  [ -z "$pid" ] && return 0
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$sig" "$child"
  done
  kill -s "$sig" "$pid" 2>/dev/null || true
}

cleanup() {
  trap - INT TERM EXIT
  echo ""
  echo "[dev] shutting down..."
  kill_tree TERM "$BACKEND_PID"
  kill_tree TERM "$FRONTEND_PID"
  sleep 0.5
  kill_tree KILL "$BACKEND_PID"
  kill_tree KILL "$FRONTEND_PID"
  wait 2>/dev/null
  echo "[dev] done."
  exit 0
}
trap cleanup INT TERM EXIT

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "[dev] frontend/node_modules not found, running yarn install..."
  if ! (cd "$FRONTEND_DIR" && yarn install); then
    echo "[dev] yarn install failed, aborting." >&2
    exit 1
  fi
fi

echo "[dev] starting backend  -> http://localhost:8080"
echo "[dev] starting frontend -> http://localhost:3000"
echo "[dev] Ctrl+C to stop both. Run scripts/dev-token.mjs for a login URL."
echo ""

(cd "$BACKEND_DIR" && go run .) > >(prefix backend) 2>&1 &
BACKEND_PID=$!

(cd "$FRONTEND_DIR" && yarn dev) > >(prefix frontend) 2>&1 &
FRONTEND_PID=$!

wait "$BACKEND_PID" "$FRONTEND_PID"
