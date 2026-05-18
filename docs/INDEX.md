# Documentation Index

> **Stake PF Replay Desktop** - Complete documentation catalog

## Quick Navigation

| Document | Purpose | Audience |
|----------|---------|----------|
| [AGENTS.md](./AGENTS.md) | Development guidelines, build commands, coding standards | Developers, AI Agents |
| [PRD.md](./PRD.md) | Product requirements and specifications | Product, Engineering |
| [ROADMAP.md](./ROADMAP.md) | Consolidated forward plan for replay, live dashboard, Stake connector, and bot studio work | Product, Engineering |
| [design-constraints.md](./design-constraints.md) | **CANONICAL** backend constraints (CI-enforced) | Engineering, Frontend |
| [api/README.md](./api/README.md) | Stake API documentation master index | Engineering |

---

## Core Documentation

### Development & Guidelines

| File | Description |
|------|-------------|
| **[AGENTS.md](./AGENTS.md)** | Repository guidelines for developers and AI agents. Covers project structure, build commands (`wails dev`, `make -C backend dev`), coding style, testing, commit conventions, and security tips. **Start here.** |
| **[codex-cloud-env.md](./codex-cloud-env.md)** | Codex Cloud agent environment setup. Linux build dependencies, agent commands, caching strategies, and troubleshooting. |
| **[ngrok.md](./ngrok.md)** | Guide for exposing local services via ngrok tunnels. Multi-tunnel configuration, cross-OS notes, and security checklist. |

### Product & Architecture

| File | Description |
|------|-------------|
| **[PRD.md](./PRD.md)** | Product Requirements Document. High-level overview, user stories, non-functional requirements, API specifications, game verification, scanning performance targets, and milestones. |
| **[ROADMAP.md](./ROADMAP.md)** | Consolidated forward plan. Summarizes current replay work, live Pump dashboard requirements, Stake connector/productization phases, authentication approach, and scripting direction. |
| **[stakeDocs.md](./stakeDocs.md)** | Stake.com provably fair specification. RNG implementation details, server/client seeds, nonce handling, bytes-to-floats conversion, game event translation, and Fisher-Yates shuffle algorithm. **Foundational reference for backend game implementations.** |

### Design Constraints (CI-Enforced)

| File | Description |
|------|-------------|
| **[design-constraints.md](./design-constraints.md)** | **CANONICAL SOURCE OF TRUTH** for all design decisions. Latency budgets, pagination rules, consistency model, loading patterns, error taxonomy, realtime semantics, and optimistic UI eligibility. **Violations block PRs.** |
| **[generated/ui-implications.md](./generated/ui-implications.md)** | Translation of backend constraints into prescriptive UI patterns. Resource-specific guidance, loading pattern matrix, error handling, and prohibited patterns. Auto-generated from constraints. |
| **[generated/backend-inventory.json](./generated/backend-inventory.json)** | Machine-readable endpoint catalog (30 endpoints). Latency budgets, pagination rules, rate limits, consistency model. Used by the CI validator script. |

### Configuration

| File | Description |
|------|-------------|
| **[CONFIGURATION_SUMMARY.md](./CONFIGURATION_SUMMARY.md)** | Quick reference for Wails application configuration. Window settings, platform options, security features. |
| **[APPLICATION_OPTIONS_REVIEW.md](./APPLICATION_OPTIONS_REVIEW.md)** | Detailed implementation review of all Wails configuration options. Windows/macOS/Linux platform specifics, testing recommendations. |

### Live Dashboard

| File | Description |
|------|-------------|
| **[live-dashboard-strategy-spec.md](./live-dashboard-strategy-spec.md)** | Business logic and UX specification for the live Pump cadence monitoring dashboard. Tier semantics, expected gaps, heartbeat requirements, analytics, and UI requirements. |
| **[antebot-script.js](./antebot-script.js)** | Working example script for Pump game cadence monitoring. Sends heartbeat and bet payloads to live ingest endpoint. Implementation reference for the live dashboard spec. |

---

## Stake API Documentation

Comprehensive reverse-engineered documentation of the Stake.com casino API, extracted from the bot2love browser extension.

| File | Description |
|------|-------------|
| **[api/README.md](./api/README.md)** | Master index and implementation roadmap. Quick reference table of all endpoints, architecture overview (GraphQL vs REST), key insights, and development phases. |
| **[api/graphql-operations.md](./api/graphql-operations.md)** | GraphQL operations for account management. `RotateSeedPair`, `CreateVaultDeposit`, `UserBalances` with full query strings and response structures. |
| **[api/game-endpoints.md](./api/game-endpoints.md)** | REST API endpoints for casino games. Dice, Limbo, HiLo, Mines, Keno, Baccarat, Blackjack with request/response TypeScript interfaces. |
| **[api/extended-game-endpoints.md](./api/extended-game-endpoints.md)** | Placeholder for endpoint docs that were referenced but not yet extracted: Plinko, Wheel, Roulette, Dragon Tower, Video Poker, Blue Samurai, and related games. |
| **[api/authentication-and-utilities.md](./api/authentication-and-utilities.md)** | Authentication mechanisms, session management, error handling patterns, retry logic, and utility functions. |

---

## Scripting Engine Documentation

Specifications for implementing a user-scriptable betting automation engine, extracted from bot2love extension analysis.

| File | Description |
|------|-------------|
| **[scripting/scripting-model.md](./scripting/scripting-model.md)** | Complete scripting engine specification. 70+ global variables, available functions, execution lifecycle, game-specific configuration, example scripts, and Go implementation notes. |
| **[scripting/statistics-and-state.md](./scripting/statistics-and-state.md)** | Statistics tracking and state management. Profit/loss calculation, chart data structures, bet result processing, state machine, and SQLite schema recommendations. |

---

## Document Relationships

```
AGENTS.md (Developer Guidelines)
    └── codex-cloud-env.md (Agent-specific setup)
    └── ngrok.md (Tunneling procedures)

PRD.md (Product Requirements)
    └── ROADMAP.md (Consolidated forward plan)
    └── stakeDocs.md (Platform specification)
    └── live-dashboard-strategy-spec.md (Feature spec)
        └── antebot-script.js (Implementation example)

design-constraints.md (CANONICAL CONSTRAINTS)
    └── generated/backend-inventory.json (Machine-readable)
    └── generated/ui-implications.md (UI translation)

api/README.md (Stake API Index)
    ├── api/graphql-operations.md
    ├── api/game-endpoints.md
    ├── api/extended-game-endpoints.md
    └── api/authentication-and-utilities.md

scripting/scripting-model.md
    └── scripting/statistics-and-state.md

archive/README.md
    └── archive/cursor_gambling_project_productization.md (source transcript summarized in ROADMAP.md)
```

---

## Maintenance Notes

### Recently Added / Organized
- `ROADMAP.md` - Consolidated forward plan from PRD, live dashboard spec, API docs, scripting docs, and archived productization notes
- `archive/*` - Long exploratory material moved out of the active docs surface
- `api/*` - Stake API documentation from bot2love analysis
- `scripting/*` - Scripting engine specifications

### Deleted (Superseded)
- `GEMINI.md` - Replaced by AGENTS.md
- `WARP.md` - Replaced by AGENTS.md
- `.pr-body.md` - Merged PR artifact

### CI Integration
- `scripts/verify-design-constraints.mjs` validates frontend against `design-constraints.md`
- Run `npm run verify:constraints` before PRs

---

*Last updated: May 2026*
