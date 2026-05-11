# Stake PF Replay Desktop

Stake PF Replay Desktop is a cross-platform Wails application that bundles the high-performance Go replay
engine with a React + TypeScript front-end. It lets you run deterministic stake-originals scans, monitor live
streams of bets, and review historical runs in a single desktop experience.

## Project Overview

- **Backend replay engine** – lives in `backend/` (imported via `replace` in `go.mod`). It exposes the
  deterministic scan logic, run history API, and migration tooling.
- **Desktop host** – the root Go module (`main.go`, `internal/livehttp`) wires the replay bindings into Wails,
  starts an embedded live-ingest HTTP server, and bridges events to the UI.
- **Frontend** – React + Vite located in `frontend/`, implemented with Mantine UI v7, shadcn primitives, and
  Virtuoso for virtualized tables.
- **Live ingest** – `internal/livehttp` persists incoming bets, exposes REST bindings, and emits
  `app.Event.Emit` notifications for the live bet feed.

> **Tip:** Use the `AGENTS.md` contributor guide for detailed conventions and onboarding instructions.

## Key Features

### Scan Workflow
- Configure seeds, nonce range, target conditions, and game-specific parameters via the Scan page
  (`frontend/src/components/ScanForm.tsx`).
- Scans are launched through the Wails binding `StartScan` and persisted in the backend store.
- Run details (`frontend/src/pages/RunDetailsPage.tsx`) display summary cards and the **Hits Table**.
  - Hits load with a paginated API (`GetRunHits`) and now retrieve every page (server-side per-page limit 500).

### Live Streams
- The desktop host exposes a local HTTP ingest endpoint (`POST /live/ingest`) plus REST helpers for listing,
  pagination, tailing, and exporting streams.
- `LiveStreamsListPage.tsx` surfaces streams with search, auto-follow, deletion, and CSV export.
- `LiveStreamDetail.tsx` shows stream metadata and our **Live Bets Table**:
  - Newest bets stay pinned to the top (nonce descending) using `TableVirtuoso` for virtualized infinite scroll.
  - History pages load via `/live/streams/:id/bets` with fallback to `GetBetsPage` Wails binding.
  - Live events trigger `/tail` fetches and buffered prepends, with a “Show new bets” CTA when the user isn’t
    at the top.
  - Min× filter applies server-side and resets pagination appropriately.

### Styling & UI
- Mantine v7 theme overrides live in `frontend/src/theme.ts`.
- Global utility styles defined in `frontend/src/styles/globals.css`.
- Reusable shadcn UI components under `frontend/src/components/ui/` (buttons, inputs, alerts, skeletons,
  etc.).

## Directory Structure

```
.
├── backend/                 # Go replay engine module (apis, store, migrations)
├── internal/livehttp/       # Desktop live ingest module (HTTP server, Wails bindings)
├── frontend/
│   ├── src/
│   │   ├── components/      # Shared components (layout, tables, forms)
│   │   ├── hooks/           # React Query hooks (e.g., useBetsStream)
│   │   ├── lib/             # Client utilities (wails bridge helpers, normalizers)
│   │   ├── pages/           # Routed screens (scan, runs, live streams, details)
│   │   └── styles/          # Global CSS modules
│   └── wailsjs/             # Generated Wails bindings/models
├── internal/livestore/      # SQLite store for live ingest
├── build/, docs/, etc.      # Packaging artefacts & documentation
└── wails.json               # Wails application configuration
```

## Development

1. **Install dependencies**
   ```bash
   # Backend dependencies
   go mod download

   # Frontend dependencies
   npm --prefix frontend install
   ```
2. **Run Wails dev shell**
   ```bash
   wails3 dev
   ```
   This spawns the desktop shell with hot-reload (Vite dev server on port 34115). Use the browser target if
   you want to inspect Go bindings via DevTools.

3. **Run backend in isolation** (optional)
   ```bash
   make -C backend dev       # fmt, lint, test, build
   make -C backend run       # start API server (for standalone testing)
   make -C backend test      # run Go tests
   ```

4. **Frontend lint/build**
   ```bash
   npm --prefix frontend run build
   ```

## Building for Release

Use Wails’ build pipeline to package the desktop app:
```bash
wails3 build            # produces platform-specific binaries under build/
```
On CI you can combine `npm --prefix frontend run build` with `wails3 build` to ensure the bundled frontend is
compiled before packaging.

## Live Ingest Reference

- **POST /live/ingest** – accepts bets from Antebot / external senders (uses optional `X-Ingest-Token`).
- **GET /live/streams** – lists streams with total bet aggregates.
- **GET /live/streams/:id/bets** – paginated history (`nonce_desc`, `min_multiplier` filters supported).
- **GET /live/streams/:id/tail** – fetch bets with `id > since_id` for streaming updates.
- **GET /live/streams/:id/export.csv** – CSV export of all bets for a stream.
- Wails bindings mirror these endpoints (`ListStreams`, `GetStream`, `GetBetsPage`, `Tail`, etc.).

## Testing & QA Checklist

- `make -C backend test` – backend unit/integration tests.
- `npm --prefix frontend run build` – TypeScript type checking + Vite production build.
- Manual QA:
  - Run Scan flow end-to-end, verify Hits table loads >50 hits and CSV export works.
  - Ingest a live stream, observe newest bets at top, scroll for older bets, tweak Min× filter.
  - Confirm auto-follow in Live Streams list and deletion behavior.

## Utilities

- `scripts/wails-dev.sh` – helper script for running `wails3 dev` under a virtual framebuffer (useful on headless/WSL).
- `AGENTS.md` – contributor guide covering structure, commands, conventions, and PR process.
- `docs/ngrok.md` – tunnel the backend/UI/ingest services with ngrok for remote demos and AI agent access.

## Contributing Guidelines

1. Follow Go `gofmt`/`golangci-lint` and front-end formatting (`eslint/prettier` via npm scripts where
   applicable).
2. Add/change bindings through the backend module first; regenerate Wails bindings when Go signatures change.
3. Keep live ingest behavior deterministic: sort by nonce/ID, dedupe per bet ID, and use server-side filters.
4. Include UI states for loading, error, and empty views to maintain UX consistency.

## License

Stake PF Replay Desktop is distributed under the MIT License. See `LICENSE` for details.
