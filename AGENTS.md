# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Stake PF Replay Desktop is a Wails application that bundles a Go replay engine with a React/TypeScript frontend. It provides deterministic stake-originals scans, live bet stream monitoring, and historical run review.

## Architecture

**Two Go modules with `replace` directive:**
- Root module (`github.com/MJE43/stake-pf-replay-go-desktop`) - Wails desktop host, live ingest
- Backend module (`github.com/MJE43/stake-pf-replay-go` in `backend/`) - Replay engine, scan logic, storage

**Key components:**
- `main.go` - Wails app entry, binds both `backend/bindings` and `internal/livehttp` modules
- `backend/bindings/app.go` - Wails-exposed replay engine methods (StartScan, GetRunHits, etc.)
- `internal/livehttp/` - Live ingest HTTP server, Wails bindings for stream management
- `internal/livestore/` - SQLite store for live bet streams
- `frontend/` - React + Vite with Tailwind, shadcn/ui components, react-virtuoso for tables

**Data flow:**
- Scans: Frontend → Wails bindings (`backend/bindings`) → scan engine → SQLite
- Live ingest: External POST `/live/ingest` → `livehttp` server → `livestore` → Wails events → Frontend

## Build & Development Commands

```bash
# Development (hot reload)
wails dev

# Production build
wails build

# Backend only (from backend/ directory)
make -C backend test          # Run Go tests
make -C backend lint          # golangci-lint
make -C backend dev           # fmt, lint, test, build

# Frontend only
npm --prefix frontend install  # Install dependencies
npm --prefix frontend run build # TypeScript check + Vite build
npm --prefix frontend run test  # Vitest
```

## Key Conventions

**Go:**
- Backend game implementations in `backend/internal/games/` (limbo, dice, roulette, pump, plinko)
- HMAC-SHA256 RNG in `backend/internal/engine/rng.go` - server seed treated as ASCII
- Scanner uses worker pool pattern in `backend/internal/scan/scanner.go`

**Frontend:**
- Wails bindings auto-generated in `frontend/wailsjs/`
- UI components in `frontend/src/components/ui/` (shadcn primitives)
- Pages routed via react-router-dom in `frontend/src/App.tsx`
- Live tables use `react-virtuoso` TableVirtuoso for infinite scroll
- TanStack Query for data fetching with Wails binding wrappers

**Live Ingest:**
- HTTP endpoints: POST `/live/ingest`, GET `/live/streams`, GET `/live/streams/:id/bets`, GET `/live/streams/:id/tail`
- Default port 17888 (env: `LIVE_INGEST_PORT`)
- Optional auth token (env: `LIVE_INGEST_TOKEN`)

## Important Patterns

- When Go binding signatures change, regenerate Wails bindings: `wails generate module`
- Live bet tables sort newest first (nonce descending), use `/tail?since_id=X` for streaming updates
- Server seeds are never logged in plaintext - only SHA256 hashes for security
- SQLite for development/desktop; data files in OS-appropriate config directory
