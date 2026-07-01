# Product

## Register

product

## Users

Seed replayers, data-obsessed gambling analysts, researchers, and support/moderation operators who need deterministic replay, fairness analysis, nonce inspection, and dispute/debug evidence. They work in an operator context: scanning past seed combinations, watching live streams, reading gaps and anomalies, and using proof-oriented tooling to make informed decisions.

## Product Purpose

Stake PF Replay is an operator console for replaying Stake Originals outcomes from known seeds, inspecting live bet streams, and analyzing patterns across nonces and seed histories. It exists to make deterministic fairness investigation fast, auditable, and evidence-backed. The future product direction is a unified platform that can connect directly to the Stake API for betting execution and analysis in one place.

## Brand Personality

Forensic. Electric. Operator-grade.

The product should feel like a deterministic system inspector: dark, high-contrast, grid-based, compact, technical, fast, precise, slightly intimidating, and built for people who need proof rather than decoration. Preserve the visual language established in `frontend/src/pages/LiveStreamDetail.tsx` and the provided Stream Tape reference: command-console density, mono-heavy data, signal-state color, hard panel divisions, and black-grid surfaces.

## Anti-references

Do not make this feel like a generic SaaS admin panel, fintech dashboard, casino or gambling app, playful crypto meme tool, soft rounded consumer app, Discord bot panel, pastel AI startup interface, or friendly CRM.

Avoid large rounded cards, bubbly gradients, emoji-heavy states, friendly onboarding fluff, oversized whitespace, soft shadows, marketing illustrations, casual copy, and anything that makes the product feel toy-like or decorative.

## Design Principles

1. Operator trust over friendliness: make every screen feel precise, inspectable, and built for serious decisions.
2. Evidence first: surface seeds, nonces, gaps, stream tape, status, and provenance clearly enough to support replay, dispute, and debug workflows.
3. Dense but legible: preserve compact terminal energy without sacrificing scanability, hierarchy, or long-session readability.
4. State must be explicit: never rely on color alone; pair signal colors with labels, icons, position, or shape.
5. Future betting flows stay instrumented: if direct API betting is added, execution controls must sit beside analysis, risk, and audit signals.

## Accessibility & Inclusion

Meet WCAG AA minimum for text, controls, dividers, focus states, and state indicators. Support color-blind-safe states by pairing color with labels, icons, shape, position, or pattern for statuses such as online/offline, hot/cold, match/mismatch, and valid/invalid.

The app should be keyboard-first: seed replay, stream navigation, row selection, evidence copy, filters, expand/collapse, refresh, and rotate actions need visible focus states and practical shortcuts. Reduced motion must be respected for live stream updates, ticking numbers, flashing indicators, and animated tape movement. Preserve compact density, and consider a comfortable density mode for long analysis sessions. Keep monospace data readable with adequate contrast, line height, and avoid low-contrast gray for important values.
