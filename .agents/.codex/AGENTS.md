# AGENTS.md

## Project Snapshot

Stake PF Replay Desktop is a Wails v3 desktop app for deterministic Stake Originals replay, live Pump/Expert cadence analysis, account connection work, and controlled betting/session experiments. The app is preservation-first: replay behavior, local storage, auditability, and desktop ergonomics matter more than broad rewrites.

The desktop shell uses Wails v3 APIs such as `application.New`, registered services, generated TypeScript bindings in `frontend/bindings`, and `@wailsio/runtime` on the frontend. Treat generated Wails v2 surfaces as obsolete. Do not add new active code against the old v2 generated or runtime patterns.

## Architecture

This repository has two Go modules:

- Root module, `github.com/MJE43/stake-pf-replay-go-desktop`: Wails desktop host, app startup, v3 service registration, live ingest HTTP server, desktop auth/session integration, and app-owned SQLite stores.
- Backend module, `github.com/MJE43/stake-pf-replay-go` in `backend/`: replay engine, game implementations, scan logic, storage, account/productization modules, and core tests. The root module uses a local `replace` directive for this module.

Core areas to keep straight:

- Replay scans: deterministic scan engine for Stake Originals outcomes from server seed, client seed, and nonce ranges.
- Live Pump/heartbeat ingest: localhost HTTP ingest and live dashboard state, with heartbeat rounds as the cadence source.
- Account connector: local account records, browser-profile session repair, credential checks, and explicit auth states such as `not_configured`, `needs_login`, `checking`, `connected`, `needs_browser_repair`, and `credential_failed`.
- Stake client facade: typed account and casino request surface. The preferred transport is the connected browser profile; direct Go HTTP cookie transport is only a fallback after connection checks.
- App/history ledger: local SQLite ledger for externally ingested bets, app-placed bets, synced history, strategy versions, and optional raw request/response records.
- Scripting and bot safety: sandboxed strategy execution, hard limits, no host filesystem/network/DOM access, and statistics updated only after completed bets.
- Wails desktop shell: window/app lifecycle, asset serving, menu/window actions, service registration, and event emission.

## Primary Workflows

Replay work flows from React through generated Wails bindings into backend scan services and SQLite. Keep the replay engine deterministic, auditable, and fast enough for large scans. Never alter RNG behavior without checking `docs/stakeDocs.md` and adding focused tests.

Live ingest accepts external events over localhost, stores them in `internal/livestore`, and emits updates to the Wails frontend. Live Pump dashboard tiers are threshold buckets, not exact float matches, and current streak/cadence logic must be based on continuous heartbeat rounds and the latest observed nonce.

Account and betting work must stay user-controlled. Betting calls are serialized per account, guarded by explicit safety limits, and disabled unless connection checks pass. Active-state games need recovery and safe stop/cashout behavior before automation.

## Commands

Prefer `npm.cmd` on Windows PowerShell because plain `npm` can be blocked by script execution policy.

```powershell
# Desktop development
wails3 dev

# Desktop production build
wails3 build

# Regenerate Wails v3 bindings
wails3 generate bindings -ts -clean

# Root Go tests
go test ./...

# Backend Go tests
Push-Location backend
go test ./...
Pop-Location

# Frontend checks
npm.cmd --prefix frontend run build
npm.cmd --prefix frontend run test -- --run
```

Run the smallest command set that proves the change, but do not skip code generation or frontend checks when Go service signatures or generated types change.

## Binding and Codegen Rules

Wails service methods and exported Go binding types are part of the frontend contract. When any exported service method, argument type, return type, or event payload shape changes, run:

```powershell
wails3 generate bindings -ts -clean
```

Use generated imports from `frontend/bindings` and runtime imports from `@wailsio/runtime`. Do not use obsolete Wails v2 generated/runtime surfaces as active integration points.

The desktop app embeds frontend build output. If root Go tests or Wails builds fail on missing embedded assets, build the frontend first with `npm.cmd --prefix frontend run build`.

## Data, Security, and Auth Rules

Create the app data directory before opening any SQLite stores. This startup ordering is required before opening auth, script session, live ingest, ledger, or replay databases.

Never log unhashed server seeds. Hashes are acceptable for comparison and audit; plaintext unhashed seeds are not.

Do not implement automated Cloudflare bypasses or headless login automation. The supported repair path is user-driven login in a persistent embedded browser profile, then reuse of that browser session. Manual `cf_clearance` and user-agent entry may exist as advanced fallback support tooling, but it is not the primary auth path.

Treat undocumented Stake endpoints and third-party extension behavior as unstable references, not canonical contracts. New betting/API behavior must call out ToS, breakage, and licensing risk where relevant.

All betting automation must remain behind explicit user controls, per-account request serialization, and hard safety limits. A `parallelCasinoBet` response is a recoverable sequencing error, not permission to retry in a tight loop.

## Frontend Rules

The frontend is React, TypeScript, Vite, Tailwind, shadcn/ui-style primitives, TanStack Query, and virtualized data views where needed. Keep UI changes consistent with the existing desktop-tool style: dense, legible, and workflow-first.

Use generated Wails v3 bindings from `frontend/bindings`. Event and runtime code should use `@wailsio/runtime`. If static generated imports make readiness polling unnecessary, prefer removing fragile polling rather than preserving old compatibility shims.

Live tables generally show newest data first and should support incremental updates without reshuffling unrelated rows. For live cadence analysis, heartbeat coverage matters more than sparse high-multiplier bet rows.

## Testing Expectations

For Markdown-only edits, inspection is enough. For code changes, choose checks based on the touched surface:

- Wails service or binding changes: `wails3 generate bindings -ts -clean`, frontend build/test, and relevant Go tests.
- Root desktop shell changes: `go test ./...`, `npm.cmd --prefix frontend run build`, and `wails3 build` when practical.
- Backend replay or productization changes: `go test ./...` from `backend`, plus root checks if bindings or desktop integration changed.
- Frontend behavior changes: `npm.cmd --prefix frontend run build`, `npm.cmd --prefix frontend run test -- --run`, and browser/dev smoke where user-facing behavior changed.

When a verification command times out once, rerun it with a longer timeout before treating it as a failure.

## Known Follow-Up Boundaries

Windows is the hard acceptance platform for the current Wails v3 desktop path. macOS and Linux settings should be carried forward where direct equivalents exist, but they should not block a Windows-first pass.

Browser-profile-backed Stake transport is the preferred long-term request path. A direct Go HTTP fallback must not become the only supported auth path.

Dice and Limbo are the first core betting targets. Mines, HiLo, and Blackjack require active-state recovery, one-in-flight request handling, and explicit cashout/stop behavior before automation.

History sync and analysis fusion should write into the unified ledger and reuse replay/analysis tools rather than creating a disconnected data path.
