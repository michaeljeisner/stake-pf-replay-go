# Codebase Roadmap

This file consolidates the forward-looking plans spread across the docs folder.

## Current Product Baseline

Stake PF Replay Desktop is first a local, deterministic replay and analysis app:

- Replay Stake Originals outcomes from an unhashed server seed, client seed, and nonce range.
- Keep the replay engine deterministic, auditable, and fast enough for large scans.
- Store scan runs and hits in SQLite so users can review and export results later.
- Use Wails IPC for desktop operations and a localhost live HTTP API for external ingest.

The replay work remains governed by:

- [PRD.md](./PRD.md) for product scope and milestone sequencing.
- [stakeDocs.md](./stakeDocs.md) for provably fair RNG behavior.
- [design-constraints.md](./design-constraints.md) for UI/backend constraints.

## Near-Term Direction

The next practical direction is to harden the desktop app around three workflows:

1. Replay scans: keep improving supported games, scan performance, result persistence, export, and verification.
2. Live Pump dashboard: make the live ingest path accurate enough for real cadence analysis by ingesting every heartbeat, not only high-multiplier bet rows.
3. Desktop polish: keep Wails app configuration, platform behavior, logging, and release checks production-ready.

The live dashboard is intentionally narrow: Pump / Expert, tier-threshold cadence analysis, start/stop decision support, and clear connection health.

## Productization Track

The larger plan is not to copy the bot2love extension into the repo. Treat it as a reference for endpoint shapes and workflows, then reimplement cleanly in Go and the Wails frontend.

Planned modules:

- `backend/internal/accountconnect/`: local account records, OS secret storage, persistent browser-profile management, and connection checks.
- `backend/internal/stakeclient/`: typed Stake API facade for GraphQL account calls and casino REST endpoints. Its default transport must use the connected browser profile, not a detached Go HTTP client.
- `backend/internal/botengine/`: sandboxed strategy runtime with hard timeouts and no network or filesystem access.
- `internal/livestore/`: the unified ledger for externally ingested bets, app-placed bets, synced history, strategy versions, and optional raw request/response records.
- Frontend Bot Studio: strategy editor, start/stop controls, safety limits, live feed, and analysis views.

Phases:

1. Account Connector: create/select Stake accounts, store API keys in OS secret storage, open a persistent embedded browser profile per account, and run a three-part connection check before any betting feature is enabled.
2. Core Betting + Ledger: implement Dice and Limbo first through the connected request facade, persist every request/result into `livestore`, and expose enough UI to prove account connection, balance reads, bet placement, and ledger replay.
3. Active-State Games: add Mines, HiLo, and Blackjack after the ledger/recovery model is proven. These require active-bet recovery before starting, strict one-in-flight request handling, and safe cashout/stop behavior.
4. Real Bot Studio: add sandboxed scripting, safety rails, strategy versioning, and reproducible sessions.
5. History Sync + Analysis Fusion: sync historical Stake bets into the local database and run existing replay/analysis tools over the real ledger.

## Authentication Approach

The product must follow the same high-level pattern that makes Antebot durable: account identity and Cloudflare/browser trust are separate gates.

- Gate 1, Stake account identity: the user supplies a Stake API key or other user-authorized account credential.
- Gate 2, Cloudflare/browser trust: the user logs in normally through an embedded browser profile that can execute Stake/Cloudflare browser flows and persist browser session state.

The recommended desktop account model is:

- Store a Stake account record locally with mirror, profile id, preferred currency, label, and timestamps.
- Store API keys in OS-level secret storage, not plaintext SQLite.
- Use a persistent embedded browser profile per account so user login/session state survives restarts.
- Run an account connection check that verifies mirror reachability, Cloudflare/session health via normal user login, and credentials through a harmless account call.

The browser profile is the source of truth for Cloudflare/session state. The primary request path should execute Stake requests from that embedded browser context, then pass structured results to Go through a narrow bridge. A direct Go HTTP client populated from cookies is acceptable only as a fallback transport after the connection manager proves it works for the current profile; it must never be the only supported auth path.

Required account connection states:

- `not_configured`: no account record or missing API key.
- `needs_login`: API key exists, but the browser profile is not logged in or lacks usable session state.
- `checking`: mirror, browser session, and credentials are being verified.
- `connected`: all checks passed and betting calls may run.
- `needs_browser_repair`: Cloudflare/session check failed; open the embedded browser for the user to complete login/challenge normally.
- `credential_failed`: API key/account credential check failed; prompt the user to update credentials.

Manual `cf_clearance` / user-agent entry can exist as advanced support tooling, but it must be treated as an escape hatch. Normal users should connect by opening the embedded casino browser, logging in, and letting the app reuse that persistent browser profile.

## Core Betting Plan

Core betting should not start with every documented endpoint. The first working slice is:

1. Account connector passes all connection checks.
2. `UserBalances` succeeds through the connected request facade.
3. Dice bet succeeds with idempotent local ledger recording.
4. Limbo bet succeeds with the same ledger path.
5. Startup recovery confirms there are no active games before automated sessions begin.

Only after that should active-state games be added:

- Mines requires checking/resuming active games and safe cashout before starting a new session.
- HiLo requires active-bet recovery, round-action validation, and explicit cashout handling.
- Blackjack requires validating server-provided available actions before every next-action request.

All betting requests must be serialized per account. `parallelCasinoBet` is a recoverable sequencing error, not a signal to blindly retry in a tight loop.

## Scripting Direction

The scripting docs describe a bot2love-compatible model, but the future implementation should be safer than the extension:

- Compile scripts once and execute callbacks repeatedly.
- Expose controlled globals and helper functions only.
- Block network, filesystem, DOM, and host runtime access.
- Add CPU/time limits, script size limits, parameter validation, and graceful error handling.
- Update statistics only after completed bets, especially for multi-round games.

## Important Constraints

- Do not log unhashed server seeds; hashes are acceptable for comparison and audit.
- Treat tier hits in the live dashboard as threshold buckets, for example `roundResult >= 1066.73`, never float equality.
- Current streaks must be based on continuous heartbeat rounds and latest observed nonce, not sparse high-multiplier bet rows.
- Keep automation/betting functionality behind explicit user controls and strong safety limits.
- Undocumented Stake endpoints and third-party extension behavior carry ToS, breakage, and licensing risk; reimplement from observed behavior instead of copying extension code.
- Do not implement automated Cloudflare bypasses or headless login automation. The supported flow is user-driven login in a real embedded browser profile and reuse of that session.
