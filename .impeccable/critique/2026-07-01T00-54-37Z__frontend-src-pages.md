---
target: frontend/src/pages/
total_score: 20
p0_count: 2
p1_count: 2
timestamp: 2026-07-01T00-54-37Z
slug: frontend-src-pages
---
Method: dual-agent (A: AssessmentA_DesignReview · B: AssessmentB_DetectorEvidence)

# Critique: `frontend/src/pages/` (8 pages, 5 representative routes)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | LiveStreamDetail's telemetry/live pulse is solid, but CommandRail's Speed/Pattern/Ledger/Warnings/Help buttons have no `onClick` — dead affordances in the flagship screen. |
| 2 | Match System / Real World | 3 | ScanPage's nav labels the script feature "Tune"; the page itself is titled "Script Engine." Same feature, two names. |
| 3 | User Control and Freedom | 2 | Starting a real-money live betting session is gated by a native `window.confirm()` (ScriptPage.tsx:303-306) — punts the operator into an unstyled OS dialog at the single highest-stakes moment in the app. |
| 4 | Consistency and Standards | 1 | Four incompatible visual systems across 8 pages. Root cause dragging every other score down. |
| 5 | Error Prevention | 2 | KenoB2B has zod validation; ScanPage relies on generic try/catch + toast, no inline field errors. |
| 6 | Recognition Rather Than Recall | 3 | Config summary bars on both scan forms are a genuinely good recognition pattern. |
| 7 | Flexibility and Efficiency | 2 | Layout's shared rail supports Alt+1..6 across 6 destinations; ScanPage renders its own 4-item rail with no hotkeys, hiding 2 destinations (Keno B2B, Live). |
| 8 | Aesthetic and Minimalist Design | 1 | Confirmed live in-browser: KenoB2B fired 41 anti-pattern hits on one route — cyan neon text, colored glow, gradient backgrounds, a 40-div decorative pattern — directly contradicting DESIGN.md's own "decoration is forbidden" rule. |
| 9 | Error Recovery | 2 | Sonner's default `richColors` renders light-pink/white error toasts — confirmed live on `/settings` — colliding with every dark surface in the app at the exact moment trust is most fragile. |
| 10 | Help and Documentation | 1 | No help affordance works anywhere; empty-state copy assumes domain knowledge ("Point Antebot to the ingest URL...") with zero glossary for a first-time operator. |
| **Total** | | **20/40** | Below average — systemic consistency failure, not a polish gap. |

## Anti-Patterns Verdict

Yes, this reads as AI-generated — unevenly, which is itself the tell.

**LLM assessment (Assessment A):** Not one AI-slop app — five pages of a legacy, internally-coherent design system, one page (ScanPage) built after DESIGN.md existed but ignoring its tokens, one page (KenoB2BScanPage) that is a textbook AI-slop artifact (5-color rainbow section coding, 4-up identical hero-metric card grid distinguished only by rotating hues, purely decorative 40-div opacity grid, gradient-filled cards), and one page (LiveStreamDetail) that is genuinely clean and matches DESIGN.md exactly. Most damning: shared chrome across 5 of 8 pages still displays "WEN?" branding — a different product name than "Stake PF Replay" — two product identities ship in the same build.

**Deterministic scan (Assessment B):** 9 CLI findings across two scans, zero false positives (all verified against live source):
- `ai-color-palette` (warning) — KenoB2BScanPage.tsx:269, purple stat card beside blue and cyan cards
- `design-system-color` (advisory x5) — ScanPage.tsx:283 (undocumented rgba grid-line), globals.css:560/561/576/577 (win/loss flash colors not in DESIGN.md)
- `design-system-font` (warning x3) — index.html:11 imports DM Sans, Syncopate, Material Symbols Outlined, none declared in DESIGN.md typography

Browser injection (live, script-confirmed) across 5 routes: `/` (ScanPage) fired only 4 minor hits (full-bleed, bypasses shared chrome). `/keno-b2b`, `/runs`, `/live`, `/settings` each fired 13-41 hits, dominated by `ai-color-palette` (cyan neon), `dark-glow` (#1ac6ff), `gpt-thin-border-wide-shadow` — all traced to MiniNavRail.tsx's `text-primary glow-sm`/`shadow-glow`, driven by globals.css's `--primary: 195 100% 50%` (pre-DESIGN.md "Electric Blue" token). Also caught two real `low-contrast` failures: white text on #00bfff measuring 2.0:1 and 1.6:1 against a 4.5:1 requirement.

**Convergence:** both assessments independently flagged the same root cause — a pre-DESIGN.md "Electric Blue / WEN?" shell live on 5 of 8 pages — without seeing each other's output.

**Detector gap:** CLI color check under-reports — caught only 1 of ScanPage's many off-system hex literals (#39414d, #080909, #8b95a5, #f4f4f1, #21e679 went unflagged), likely doesn't parse Tailwind arbitrary values like `border-[#hex]`, only inline style objects and CSS files. Treat CLI counts as a floor.

## Overall Impression

Two-and-a-half products stitched into one repo. LiveStreamDetail.tsx — the file DESIGN.md itself names as the authoritative reference — is well-executed: zero-radius panels, disciplined mono-for-evidence typography, a real tier-color system. But it's the exception. The other seven pages split between a legacy "WEN?" electric-blue shadcn shell (5 pages, rounded corners, glow effects, wrong product name in the header) and two pages built independently of any shared system (ScanPage with its own ad hoc dark palette, KenoB2BScanPage with a five-hue rainbow that is the single most diagnostic AI-slop artifact in the codebase). DESIGN.md was written after most of this code, and nothing has migrated toward it yet.

## What's Working

1. LiveStreamDetail's tier command columns — five equal-weight vertical columns with a large mono active-gap value and a rotated "STREAK / LAST 20" annotation let an analyst scan five thresholds at once without any card chrome.
2. The Evidence Mono Rule is actually followed where it matters — nonces, gaps, durations stay in JetBrains Mono, labels stay in Inter Tight, inside LiveStreamDetail.
3. Config summary bars on both scan forms (ScanPage, KenoB2B) give a persistent, glanceable readout of current configuration before submit.

## Priority Issues

**[P0] Two conflicting product identities ship in the same build**
- What: Shared Layout.tsx/MiniNavRail.tsx chrome (5 of 8 pages) displays "W?" and "WEN? • Provable Fairness Analysis" branding — a different product name than "Stake PF Replay" per PRODUCT.md/DESIGN.md.
- Why it matters: For a forensic evidence tool whose value proposition is operator trust, an unexplained second product name on most screens raises doubt at exactly the moments (disputes, evidence review) where certainty matters most.
- Fix: Remove "WEN?" branding from Layout.tsx/MiniNavRail.tsx entirely; replace with the "Stake PF Replay" wordmark or LiveStreamDetail's icon-only CommandRail pattern.
- Suggested command: $impeccable harden

**[P0] Four incompatible design systems across 8 pages**
- What: DESIGN.md tokens (LiveStreamDetail only) vs. an ad hoc dark palette (ScanPage) vs. the legacy Electric-Blue shadcn shell with non-zero radius and glow (AccountsPage, LiveStreamsListPage, RunDetailsPage, RunsPage, ScriptPage) vs. a fifth emerald/cyan/amber/purple palette (KenoB2BScanPage). Confirmed live: browser injection found the electric-blue shell firing 13-41 anti-pattern hits per route on everything except the two full-bleed pages.
- Why it matters: DESIGN.md explicitly names the Electric-Blue shell as the anti-reference to avoid — yet it's the majority shell by page count.
- Fix: Migrate the 5 shadcn-shell pages off --primary: 195 100% 50% / rounded --radius / glow effects onto command-black/operator-orange/tier-color tokens and the zero-radius rule. Rebuild KenoB2BScanPage's palette down to tier colors + operator-orange only. Align ScanPage's hex literals to canonical tokens.
- Suggested command: $impeccable harden then $impeccable adapt

**[P1] Decorative elements that violate DESIGN.md's own anti-decoration rule**
- What: KenoB2BScanPage's 40-div opacity-5 decorative grid (lines 386-392) and gradient hero header; ScanPage's decorative CSS dot-grid background.
- Why it matters: These are the clearest AI-slop tells in the codebase and directly contradict DESIGN.md's own text.
- Fix: Delete both decorative layers outright; use the grid-line border topology already established in LiveStreamDetail if visual interest is needed.
- Suggested command: $impeccable distill

**[P1] Real-money action confirmed via native browser dialog**
- What: window.confirm(...) gates starting a live betting session (ScriptPage.tsx:303-306).
- Why it matters: The single highest-stakes action in the app is handled by an unstyled OS popup completely outside the product's visual and emotional language.
- Fix: Replace with an in-app modal styled to command-black/tier-red, showing exact stake parameters being confirmed.
- Suggested command: $impeccable harden

**[P2] Unstyled error toasts clash with the dark theme app-wide**
- What: sonner-toaster.tsx uses <Toaster richColors closeButton /> with no theme override — default light-pink/white error toasts confirmed live on /settings.
- Why it matters: Every error visually contradicts the black-grid aesthetic on every page.
- Fix: Pass Sonner theme tokens mapping success/error/info to live-green/tier-red/operator-orange.
- Suggested command: $impeccable colorize

## Persona Red Flags

**Analyst doing rapid seed lookups** (lives on / and /runs): ScanPage's nav rail hides Keno B2B and Live. Crossing from ScanPage's orange to RunsPage's blue-glow chrome reads as leaving the app entirely.

**First-time support operator investigating a dispute** (lands cold on /live/:id or /runs/:id): sees "WEN?" branding immediately after being told they're using "Stake PF Replay." Empty-state copy assumes domain knowledge with no glossary or help link.

**Researcher cross-referencing many nonces** (lives on /keno-b2b): the 4-up result cards force re-learning an arbitrary color-to-meaning mapping every session. Five competing accent hues violate DESIGN.md's own "Signal Rarity Rule."

## Minor Observations

- Icon family inconsistent even on "on-system" pages: LiveStreamDetail correctly uses Material Symbols per DESIGN.md; ScanPage/KenoB2B/the shadcn shell all use @tabler/icons-react, never sanctioned as an alternate.
- RunDetailsPage's "Completed" badge uses electric-blue rather than DESIGN.md's live-green.
- A light/dark ThemeToggle exists on all 5 shadcn-shell pages, but DESIGN.md never authorizes a light mode — unverified visually this session (dev server dropped mid-run).
- Browser evidence caught two real WCAG failures: white text at 2.0:1 and 1.6:1 contrast against #00bfff, both well under the 4.5:1 requirement.
- Detector coverage gap: CLI color check missed most of ScanPage's off-system hex literals — treat findings as a floor.

## Questions to Consider

1. LiveStreamDetail is the named reference — why does the app route users through 5 pages of a "legacy" system before reaching it? Shouldn't the entry point (ScanPage) be the first migration target?
2. Is "WEN?" an unshipped leftover from a prior pivot, or intentional secondary branding?
3. Does DESIGN.md represent a plan with a timeline, or aspirational documentation for a redesign that hasn't started?
