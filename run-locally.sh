#!/bin/bash
#
# Run the app locally for development: starts the Express backend (server/index.js)
# and the Vite frontend dev server together, and shuts both down cleanly on Ctrl+C.
#
# Frontend: http://localhost:5173   Backend/API: http://localhost:3001

set -e

cd "$(dirname "$0")"

# 1. Environment file
if [ ! -f .env ]; then
  echo "No .env found — copying from .env.example."
  echo "Edit .env and fill in your Google OAuth credentials before signing in."
  cp .env.example .env
fi

# 2. Dependencies
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

# 3. Start both servers, and make sure Ctrl+C stops both.
pids=()

# Kill a process and all its descendants. `npm run` spawns node/vite as
# grandchildren, so killing just the npm pid would orphan them and leave the
# ports bound.
kill_tree() {
  local pid=$1
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  trap - INT TERM
  echo ""
  echo "Shutting down..."
  for pid in "${pids[@]}"; do
    kill_tree "$pid"
  done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

echo "Starting backend (http://localhost:3001)..."
npm run dev:server &
pids+=($!)

echo "Starting frontend (http://localhost:5173)..."
npm run dev &
pids+=($!)

echo ""
echo "Both running. Open http://localhost:5173 — press Ctrl+C to stop."

# Poll until either process dies, then clean up the other. (Portable: the default
# macOS bash is 3.2, which lacks `wait -n`.)
while true; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo ""
      echo "A process exited — stopping the other."
      cleanup
    fi
  done
  sleep 1
done
