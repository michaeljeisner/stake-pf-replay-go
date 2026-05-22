# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**WEN?** is a Wails v3 desktop application that bundles a Go replay/scan engine with a React/TypeScript frontend. It provides deterministic provably-fair game verification, live bet stream monitoring, JS-based bot scripting, and Stake account management.

## Build & Development Commands

```bash
# Development (hot reload via Vite)
task dev                          # or: wails3 dev -config ./build/config.yml -port 9245

# Production build
task build                        # or: task windows:build / darwin:build / linux:build

# Regenerate TypeScript bindings after any Go service method changes
task generate:bindings            # or: wails3 generate bindings -ts -clean

# Backend tests and lint (run from repo root)
make -C backend test              # Run Go tests
make -C backend lint              # golangci-lint
make -C backend dev               # fmt + lint + test + build

# Run a single Go test package
cd backend && go test ./internal/engine/... -run TestRNG

# Frontend
npm --prefix frontend install
npm --prefix frontend run build   # TypeScript check + Vite build
npm --prefix frontend run test    # Vitest
```

## Architecture

### Two Go modules with `replace` directive

| Module | Path | Responsibility |
|---|---|---|
| `github.com/MJE43/stake-pf-replay-go-desktop` | repo root | Wails host, live ingest, auth wrapper |
| `github.com/MJE43/stake-pf-replay-go` | `backend/` | Replay engine, game implementations, scanner, scripting, store |

The root `go.mod` has a `replace` directive pointing the backend module import to `./backend`.

### Four Wails services registered in `main.go`

All four are registered as `application.Service` and communicate with the frontend via auto-generated TypeScript bindings in `frontend/bindings/`.

| Service | Source | Owns |
|---|---|---|
| `App` (appSvc) | `backend/bindings/app.go` | Scan engine, run history, SQLite hits/runs |
| `LiveModule` | `internal/livehttp/module.go` | Live ingest HTTP server, livestore DB, Wails event emission |
| `ScriptModule` | `backend/bindings/script.go` | goja JS VM, session store, ApiBetPlacer |
| `AuthModule` | `backend/bindings/auth.go` | Stake auth/session, keyring, connection checks |

### Data storage

All SQLite, stored in OS config dir under `wen-desktop/` (migrated from `stake-pf-replay-go-desktop/`):

- `auth.db` — Stake accounts and session tokens
- `live_ingest.db` — Live streams, bets, rounds, account ledger
- `script_sessions.db` — Bot scripting session history

### Data flow

**Scans** (provably-fair replay):
```
Frontend → Wails bindings (App) → scan.Scanner (worker pool) → store.DB → SQLite
```

**Live ingest** (Antebot integration):
```
POST /live/ingest → livehttp.Server → livestore.Store → Wails event "live:newrows:{streamID}" → Frontend
```
Default port `17888`; optional bearer token via `LIVE_INGEST_TOKEN` env var.

**Bot scripting**:
```
Frontend → ScriptModule → goja VM (sandboxed JS) → ApiBetPlacer → Stake GraphQL API
                                                                 ↘ LedgerRecorder → LiveModule
```

**Auth**:
```
Frontend → AuthModule → stakeauth.Module → Stake API (GraphQL) + OS keyring
```

### Engine internals (`backend/internal/`)

**RNG** (`engine/rng.go`): HMAC-SHA256 byte generator. Message format: `{clientSeed}:{nonce}:{round}`. Server seed is the HMAC key treated as ASCII. Float generation uses 4 bytes: `sum(byte[i] / 256^(i+1))`.

**Games** (`games/`): limbo, dice, roulette, pump, plinko, crash, keno, mines, hilo, baccarat, blackjack, wheel, chicken, videopoker. Each implements `games.GameSpec` and registers via `games.ListGames()`.

**Scanner** (`scan/scanner.go`): worker pool; `scan.ScanRequest` carries game, seeds, nonce range, target op/value, tolerance, limit, and timeout. Keno B2B scanner (`scan/keno_b2b.go`) handles streak detection separately.

**Scripting** (`scripting/`): goja-based sandboxed JS VM with a 2s init timeout and 1s per-call timeout. `Variables` holds live betting state exposed to scripts. `ApiBetPlacer` (in `backend/bindings/api_placer.go`) has a circuit breaker that halts after 5 consecutive API failures.

### Frontend (`frontend/src/`)

React + Vite, Tailwind CSS, shadcn/ui. Routes (all lazy-loaded):

| Route | Page |
|---|---|
| `/` | ScanPage — seed + nonce input, live scan progress |
| `/keno-b2b` | KenoB2BScanPage — back-to-back streak finder |
| `/runs` | RunsPage — paginated scan history |
| `/runs/:id` | RunDetailsPage — hits table with delta nonce |
| `/live` | LiveStreamsListPage |
| `/live/:id` | LiveStreamDetail — real-time bet table via TailResponse polling |
| `/script` | ScriptPage — bot scripting IDE |
| `/settings` | AccountsPage — Stake auth management |

TanStack Query for data fetching. `react-virtuoso` TableVirtuoso for virtual scrolling in large hit/bet tables. Live tables poll `LiveModule.Tail()` for `id > lastID` after each `live:newrows:{streamID}` event.

## Key Conventions

- **After changing any Go service method signature**: run `task generate:bindings` to regenerate `frontend/bindings/`. Stale bindings cause silent runtime errors.
- **Server seeds are never logged in plaintext** — only SHA-256 hashes. `App.HashServerSeed()` is the canonical hasher.
- **Nonce fields** accept `string | uint64 | float64` at the binding layer (JSON serialization from JS loses uint64 precision) — all three are handled by type-switch in `app.go`.
- **`ScanRequest.TargetOp`** values are strings matching `scan.TargetOp` constants (e.g. `"gte"`, `"lte"`, `"eq"`).
- **Live stream IDs** are UUIDs; always `uuid.Parse()` before passing to store methods.

## CodeGraph

This project has a CodeGraph MCP server (`codegraph_*` tools). Use `codegraph_context` first for any architecture or "how does X work" question, then `codegraph_explore` for source of the surfaced symbols. Prefer `codegraph_search` over grep for finding symbols by name.
