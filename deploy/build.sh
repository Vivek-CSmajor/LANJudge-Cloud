#!/usr/bin/env bash
set -euo pipefail

# Builds CampusCode Cloud end to end, in the order that matters:
#   1. Frontend (client/) — vite.config.js writes its output straight into
#      server/web/dist.
#   2. Backend (server/) — embeds that directory via go:embed (see
#      server/web.go) and will fail to compile if it's missing or empty.
#
# Safe to run repeatedly (e.g. on every deploy): it always rebuilds both
# from a clean frontend output dir.
#
# Usage: deploy/build.sh
# Env:   BINARY_NAME  — output binary name (default: campuscodecloud)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BINARY_NAME="${BINARY_NAME:-campuscodecloud}"

echo "==> [1/2] Building frontend (client/ -> server/web/dist)"
cd "$ROOT_DIR/client"
npm install
npm run build

echo "==> [2/2] Building Go binary (server/$BINARY_NAME)"
cd "$ROOT_DIR/server"
go build -o "$BINARY_NAME" .

echo "==> Done: $ROOT_DIR/server/$BINARY_NAME"
