#!/usr/bin/env bash
set -euo pipefail

# Codex Cloud setup script
# - Installs system deps required for building Wails (Linux)
# - Installs Go tools used by Makefiles
# - Pre-fetches Go modules and Node deps for offline agent runs
# - Runs minimal builds to warm caches

echo "[codex-setup] starting"

apt_install_if_available() {
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    # Core toolchain + Wails Linux deps. Keep conservative to avoid bloat.
    apt-get install -y --no-install-recommends \
      build-essential pkg-config \
      libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
      ca-certificates git curl
  else
    echo "[codex-setup] apt-get not available; skipping system packages"
  fi
}

install_go_tools() {
  # Respect GOBIN when set
  echo "[codex-setup] installing Go tools"
  go env -w GOINSECURE=\n 2>/dev/null || true
  go env -w GOPRIVATE=\n 2>/dev/null || true
  go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-alpha.89
  go install github.com/pressly/goose/v3/cmd/goose@latest
  go install github.com/golangci/golangci-lint/cmd/golangci-lint@v1.61.0
}

prefetch_go_modules() {
  echo "[codex-setup] go mod download (root)"
  go mod download
  echo "[codex-setup] go mod download (backend)"
  (cd backend && go mod download)
}

install_node_deps() {
  if ! command -v node >/dev/null 2>&1; then
    echo "[codex-setup] Node.js not found; universal image should include Node. Skipping."
  fi
  echo "[codex-setup] npm ci (frontend)"
  npm --prefix frontend ci
}

warm_build_caches() {
  echo "[codex-setup] build frontend (typecheck + Vite build)"
  npm --prefix frontend run build || true
  echo "[codex-setup] backend dev-setup (tools)"
  make -C backend dev-setup
  echo "[codex-setup] backend lint/test quick pass"
  # Lint may be noisy on first run if linters download assets; ignore failure to keep setup resilient.
  make -C backend fmt || true
  make -C backend lint || true
  make -C backend test || true
}

apt_install_if_available
prefetch_go_modules
install_go_tools
install_node_deps
warm_build_caches

echo "[codex-setup] complete"

