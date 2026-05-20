# docs/AGENTS.md

## Purpose

Root `AGENTS.md` applies repo-wide. This file is only a docs-specific overlay for agents editing content under `docs/`.

Documentation should describe the current Wails v3 desktop app, replay engine, live dashboard, account connector, betting ledger, and scripting direction without duplicating the full repository guide. Keep docs useful for future implementers: concrete, source-aware, and clear about which material is product intent versus implementation reference.

## Source-of-Truth Map

- `docs/ROADMAP.md`: productization direction, module sequencing, authentication approach, betting roadmap, scripting direction, and known boundaries.
- `docs/PRD.md`: product scope, milestone framing, and baseline user workflows.
- `docs/stakeDocs.md`: provably fair RNG behavior and replay correctness references.
- `docs/design-constraints.md`: UI/backend constraints that should shape implementation tradeoffs.
- `docs/live-dashboard-strategy-spec.md`: Pump / Expert live dashboard behavior, cadence analysis, thresholds, and connection-health expectations.
- `docs/api/*`: implementation references for endpoint shapes and request/response behavior. Treat these as references to reimplement cleanly, not source code or canonical third-party contracts.
- `docs/scripting/*`: implementation references for the scripting model and bot studio direction. Use them to design the local sandbox, not to weaken safety constraints.
- `docs/archive/*`: historical context only. Do not treat archived plans as active product requirements unless a current doc or user instruction revives them.

## Documentation Rules

Avoid stale Wails v2 references unless explicitly discussing history or migration notes. Current docs should refer to Wails v3, generated `frontend/bindings`, registered services, and `@wailsio/runtime`.

When documenting replay behavior, keep determinism and auditability central. Do not include plaintext unhashed server seed examples in docs or logs; use hashes or clearly fake placeholders.

When documenting live dashboard behavior, describe tiers as threshold buckets and streak/cadence logic as heartbeat-based. Avoid wording that implies exact float equality or sparse high-multiplier rows are sufficient for current streaks.

When documenting account connection, preserve the two-gate model:

- Stake account identity through a user-authorized account credential.
- Cloudflare/browser trust through user-driven login in a persistent embedded browser profile.

Do not document automated Cloudflare bypasses, headless login automation, or cookie scraping as the normal path. Manual `cf_clearance` / user-agent entry can be mentioned only as advanced support fallback tooling.

## Roadmap and API Documentation Boundaries

The roadmap is preservation-first and Windows-first for the Wails desktop app. Mac and Linux notes are useful where known, but should not obscure the current Windows acceptance path.

New API or betting documentation must mention ToS, breakage, and licensing risk when relying on undocumented Stake behavior or third-party extension observations. Do not present third-party extension behavior as canonical. Phrase it as observed behavior or implementation reference material that must be reimplemented cleanly.

Betting docs should keep Dice and Limbo as the first core betting slice. Active-state games such as Mines, HiLo, and Blackjack need recovery, one-in-flight request handling, and safe cashout/stop behavior before automation.

Scripting docs should keep the future runtime safer than extension-style scripts: compile once, expose controlled globals, block network/filesystem/DOM/host runtime access, enforce CPU/time limits, validate parameters, and update statistics only after completed bets.

## Validation Checklist

Before finishing docs changes, check:

- Root `AGENTS.md` still applies repo-wide and this file remains a docs overlay.
- Current Wails material refers to Wails v3 surfaces, not obsolete active v2 surfaces.
- `docs/ROADMAP.md`, `docs/PRD.md`, `docs/stakeDocs.md`, `docs/design-constraints.md`, and `docs/live-dashboard-strategy-spec.md` are used consistently with their roles.
- API and scripting references are not framed as code to copy.
- `docs/archive/*` is treated as historical context only.
- New API or betting docs mention ToS/breakage risk where undocumented or third-party behavior is involved.
