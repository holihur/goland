#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root/backend"

export GOLAND_ADDR="${GOLAND_ADDR:-127.0.0.1:8788}"
export GOLAND_DATA_DIR="${GOLAND_DATA_DIR:-$root/.data}"
export GOLAND_WORKSPACE_ROOTS="${GOLAND_WORKSPACE_ROOTS:-$root/.data/workspaces}"
export GOLAND_WEB_DIST="${GOLAND_WEB_DIST:-$root/frontend/dist}"
export GOLAND_DEV_PERMISSIONS="${GOLAND_DEV_PERMISSIONS:-true}"
export GOLAND_GOPLS="${GOLAND_GOPLS:-$root/bin/tools/gopls}"
export GOLAND_TSSERVER="${GOLAND_TSSERVER:-$root/frontend/node_modules/.bin/typescript-language-server}"
export GOLAND_DLV="${GOLAND_DLV:-$root/bin/tools/dlv}"
export GOLAND_JS_DEBUG="${GOLAND_JS_DEBUG:-$root/deploy/js-debug/src/dapDebugServer.js}"
export GOLAND_CHROME="${GOLAND_CHROME:-/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome}"

if [ -n "${GOLAND_E2E_BINARY:-}" ]; then
  exec "$GOLAND_E2E_BINARY"
fi
exec go run ./cmd/server
