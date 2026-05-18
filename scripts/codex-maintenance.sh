#!/usr/bin/env bash
set -euo pipefail

# Codex Cloud maintenance script
# - Refreshes dependencies when container cache is resumed on a different commit

echo "[codex-maintenance] refreshing deps"

# Update Go modules (root + backend)
go mod download
(cd backend && go mod download)

# Ensure tools remain installed (safe to re-run)
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-alpha.89
go install github.com/pressly/goose/v3/cmd/goose@latest
go install github.com/golangci/golangci-lint/cmd/golangci-lint@v1.61.0

# Refresh Node deps using lockfile
npm --prefix frontend ci

# Quick no-op builds to catch type errors early
npm --prefix frontend run build || true
make -C backend tidy || true

echo "[codex-maintenance] done"

