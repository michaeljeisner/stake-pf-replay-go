Codex Cloud Environment

What this config enables
- Builds and tests the backend without network during agent runs.
- Installs Wails CLI and Linux build deps so `wails3 build` can run if desired.
- Installs frontend node_modules and performs a Vite build for type checks.

Recommended Codex settings
- Base image: `universal` (default).
- Internet access: enabled for setup, restricted during agent (default is fine).
- Setup script: `scripts/codex-setup.sh`.
- Maintenance script: `scripts/codex-maintenance.sh`.
- Environment variables (optional):
  - `LIVE_INGEST_PORT=17888`
  - `LIVE_INGEST_TOKEN=` (set only when you want auth on local ingest)

Notes for Wails on Linux
- The setup script installs `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, and related packages. These are required to link the Wails desktop binary. If you only need backend + UI type checks in CI, you can skip `wails3 build` during agent runs and rely on `make -C backend dev` and `npm --prefix frontend run build`.

Day-to-day agent commands
- Backend all-in-one: `make -C backend dev` (fmt → lint → test → build)
- Local API: `make -C backend run` (or `run-race`)
- Migrations: `make -C backend migrate`
- Frontend typecheck/build: `npm --prefix frontend run build`
- Desktop app build: `wails3 build` (requires system libs installed by setup)

Caching behavior
- Codex caches the container after running the setup script. The maintenance script refreshes Go modules and Node deps when the cache is resumed on a different commit.

Troubleshooting
- Missing GTK/WebKit dev libs: ensure setup ran on a Linux base with `apt-get`. If your base image differs, add equivalent packages for that distro.
- `golangci-lint` network access: the binary is vendored; installation happens in setup. Lint should run offline during the agent phase.
- Wails v3 frontend bindings: repo includes `frontend/bindings`. If you regenerate them locally, re-run `npm --prefix frontend run build` to ensure tsconfig paths stay valid.

