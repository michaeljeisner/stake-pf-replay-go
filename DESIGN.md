---
name: "Stake PF Replay"
description: "Forensic operator console for deterministic replay, stream tape analysis, and fairness investigation."
colors:
  command-black: "#0A0A0A"
  panel-black: "#111111"
  panel-raised: "#1c2026"
  badge-surface: "#272a31"
  grid-line: "#414753"
  text-primary: "#e0e2eb"
  text-muted: "#c1c6d5"
  operator-orange: "#e3711f"
  operator-orange-ink: "#321200"
  live-green: "#a3e635"
  tier-red: "#ffb4ab"
  tier-amber: "#ffb68c"
  tier-blue: "#aac7ff"
  tier-blue-soft: "#aec7f7"
  tier-red-wash: "#2a0709"
typography:
  display:
    fontFamily: "Inter Tight, Arial Narrow, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.2em"
  headline:
    fontFamily: "Inter Tight, Arial Narrow, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.1em"
  data:
    fontFamily: "JetBrains Mono, Fira Code, monospace"
    fontSize: "42px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter Tight, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter Tight, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.1em"
rounded:
  none: "0px"
spacing:
  telemetry-x: "32px"
  panel-x: "20px"
  panel-y: "20px"
  rail-width: "80px"
  topbar-height: "56px"
  tier-header-height: "80px"
components:
  button-operator:
    backgroundColor: "{colors.operator-orange}"
    textColor: "{colors.operator-orange-ink}"
    rounded: "{rounded.none}"
    padding: "8px 20px"
  panel-command:
    backgroundColor: "{colors.command-black}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.none}"
    padding: "20px"
  stream-row:
    backgroundColor: "{colors.command-black}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.none}"
    padding: "20px"
---

# Design System: Stake PF Replay

## 1. Overview

**Creative North Star: "The Forensic Trading Desk"**

This design system is an operator console for deterministic fairness analysis: a black-grid command surface where every pixel should feel inspectable, logged, and accountable. The visual center is `frontend/src/pages/LiveStreamDetail.tsx` and the Stream Tape screenshot reference, not the older electric-blue app shell. Future surfaces should inherit the same hard panel divisions, compact telemetry, mono-heavy numbers, and signal-state color language.

The product is for people reading nonces, gaps, stream tape events, seed states, and replay evidence under pressure. It should feel precise, fast, slightly intimidating, and built for proof. Decoration is forbidden unless it carries state, hierarchy, or operator meaning.

The system explicitly rejects the anti-references in `PRODUCT.md`: generic SaaS admin panels, fintech dashboards, casino/gambling app gloss, playful crypto meme tooling, soft rounded consumer apps, Discord bot panels, pastel AI startup interfaces, and friendly CRM patterns.

**Key Characteristics:**
- Full-screen command layout with black surfaces and hard grid lines.
- Dense telemetry first: status, node, nonce, duration, gaps, stream tape.
- Mono numerals for evidence values; condensed sans for labels and headers.
- State color is rare, named, and meaningful: orange for command/action, green for live status, tier colors for thresholds.
- Zero-radius panels, flat surfaces, and border-based depth.

## 2. Colors

The palette is a restrained black command surface with a small set of high-signal colors reserved for status, action, and tier thresholds.

### Primary
- **Command Black** (`command-black`): The root background for live operator surfaces and full-screen shells.
- **Operator Orange** (`operator-orange`): Primary command action, active rail indicator, and system control accent. Use it sparingly; it is an operator command, not decoration.

### Secondary
- **Live Green** (`live-green`): Online/active/live status and stream heartbeat indicators. Always pair it with a text label such as `ONLINE`, `OFFLINE`, or `OPTIMAL`.
- **Tier Red** (`tier-red`), **Tier Amber** (`tier-amber`), **Tier Blue** (`tier-blue`), **Tier Blue Soft** (`tier-blue-soft`): Tier-specific threshold colors for multiplier columns and active gap values.

### Neutral
- **Panel Black** (`panel-black`): Hovered panels, empty-state boxes, and nested data cells.
- **Panel Raised** (`panel-raised`): Skeleton blocks and low-emphasis loading surfaces.
- **Badge Surface** (`badge-surface`): Version badges and small fixed tokens inside the rail.
- **Grid Line** (`grid-line`): Hard dividers, table rows, column boundaries, and rail borders.
- **Text Primary** (`text-primary`): Primary text and values on black.
- **Text Muted** (`text-muted`): Labels, secondary values, table headers, and inactive rail icons.
- **Tier Red Wash** (`tier-red-wash`): Rare danger/critical tier header wash behind the highest threshold.

### Named Rules

**The Black Grid Rule.** Operator screens are built from black planes and hard 1px grid lines. Do not use soft cards to create structure.

**The Signal Rarity Rule.** Orange, green, and tier colors earn attention because they are rare. Do not spread them across inactive states or decorative backgrounds.

**The Label Plus Color Rule.** Never rely on color alone for status. Every status color needs text, icon, position, or shape support.

## 3. Typography

**Display Font:** Inter Tight (with Arial Narrow / sans-serif fallback)  
**Body Font:** Inter Tight (with system-ui fallback)  
**Label/Mono Font:** JetBrains Mono (with Fira Code / monospace fallback)  
**Icon Font:** Material Symbols Outlined for the live command rail and tape controls.

**Character:** Condensed, uppercase, and technical. Inter Tight carries command labels and table headers; JetBrains Mono carries evidence values, nonces, gaps, and timestamps. Typography should feel like an instrument panel, not a brand campaign.

### Hierarchy
- **Display** (700, 20px, 1 line-height, 0.2em tracking): Stream panel titles and major command labels such as `STREAM TAPE`.
- **Headline** (700, 20px, 1.2 line-height, 0.1em tracking): Tier labels and table headers.
- **Data** (700, 42px, 1 line-height, tight tracking): Active gap and primary numeric values.
- **Body** (400, 14px, 1.5 line-height): Supporting copy, error messages, and normal product text outside the dense command surface.
- **Label** (700, 10px, uppercase, 0.1-0.5em tracking): Telemetry labels, rail metadata, and vertical annotations.

### Named Rules

**The Evidence Mono Rule.** Nonces, seed identifiers, timings, gap counts, multipliers, and replay outputs use JetBrains Mono.

**The No-Friendly-Copy Rule.** Labels should be short, operational, and proof-oriented. Prefer `NODE_ID`, `NONCE`, `GAPS`, and `ROTATE SEED` over conversational UI copy.

**The Tracking Ceiling Rule.** Wide tracking is allowed for labels and headers, but keep it functional. Long values and table cells must stay readable before they look stylized.

## 4. Elevation

The live command surface is flat by default. Depth comes from border topology, tonal layering, sticky headers, and active/hover color shifts. Shadows and blur are not part of the authoritative LiveStreamDetail language and should not be introduced for this surface unless a specific interaction requires it.

### Shadow Vocabulary

- **None** (`box-shadow: none`): Default for panels, tables, command rail, telemetry, and tier columns.
- **Focus Ring** (`outline/ring using operator-orange or live-green`): Use for keyboard focus only, not decorative lift.

### Named Rules

**The No Float Rule.** Panels do not hover above the page. They lock into the grid.

**The Border Is Structure Rule.** Use 1px borders and shared edges to establish hierarchy. Do not pair borders with soft shadows.

## 5. Components

### Buttons

- **Shape:** Square command control (0px radius).
- **Primary:** Operator orange background with dark ink text, black border, uppercase 10px bold label, 0.2em tracking, and compact padding (`8px 20px`).
- **Hover / Focus:** Hover may shift to tier amber. Keyboard focus must be high contrast against black and should not remove the native focus affordance.
- **Icon Buttons:** Rail and stream controls are icon-only with accessible labels, muted by default, and brighten on hover. Use Material Symbols or the existing icon family consistently within the surface.

### Chips

- **Style:** Use only when a compact status or version token is necessary. Square or nearly square, bordered, mono label, no pill treatment.
- **State:** Selected/active chips need more than color: position, indicator bar, or explicit text state.

### Cards / Containers

- **Corner Style:** Square (0px radius) for the live command surface.
- **Background:** `command-black` at rest, `panel-black` for hover and nested cells, `panel-raised` for skeletons.
- **Shadow Strategy:** No shadows. Depth is border and grid alignment.
- **Border:** 1px `grid-line` boundaries. Use shared borders between columns, not separated cards.
- **Internal Padding:** Dense and predictable: `20px` inside panels, `32px` horizontal telemetry spacing, `80px` tier headers.

### Inputs / Fields

- **Style:** Dark field surface, 1px grid border, mono values, square corners.
- **Focus:** High-contrast ring or border shift. Focus must remain visible against `command-black`.
- **Error / Disabled:** Pair tier red or muted text with labels/icons; never communicate error or disabled state by color alone.

### Navigation

- **Style:** Fixed 80px left command rail, vertical icon stack, muted inactive icons, orange active state, and a hard left indicator bar.
- **Typography:** Rail badges and version markers use JetBrains Mono.
- **States:** Active navigation combines orange icon color and position/indicator. Inactive remains muted. Hover brightens to primary text without changing layout.

### Stream Tape

- **Character:** A ledger/ticker hybrid. It should feel like evidence flowing through a terminal-grade audit strip.
- **Structure:** Fixed right panel, sticky header, table rows separated by 1px grid lines, mono nonces/results/gaps/times.
- **States:** Live pulse uses green plus the `STREAM TAPE` label. Refresh/filter/fullscreen controls are icon buttons with accessible labels.

### Tier Command Column

- **Character:** Five vertical threshold columns with equal weight and tier-specific active color.
- **Structure:** Fixed header, large active gap value, vertical metadata rail, and compact last-gap boxes.
- **States:** Highest tier may use the red wash header. Hover changes only the panel surface, never the layout.

## 6. Do's and Don'ts

### Do:

- **Do** treat `frontend/src/pages/LiveStreamDetail.tsx` and the Stream Tape screenshot as the authoritative brand reference for live/operator work.
- **Do** preserve the black-grid command layout, zero-radius panels, hard dividers, compact telemetry, and mono-heavy data.
- **Do** use `operator-orange` for primary commands and active rail state, not as general decoration.
- **Do** use green only for live/online/optimal status, and always pair it with explicit status text.
- **Do** keep data tables dense, aligned, and readable for long analysis sessions.
- **Do** provide keyboard-visible focus states and reduced-motion behavior for live updates, pulsing indicators, and ticking values.

### Don't:

- **Don't** drift into a generic SaaS admin panel, fintech dashboard, casino/gambling app, playful crypto meme tool, soft rounded consumer app, Discord bot panel, pastel AI startup interface, or friendly CRM.
- **Don't** use large rounded cards, bubbly gradients, emoji-heavy states, friendly onboarding fluff, oversized whitespace, soft shadows, marketing illustrations, or casual copy.
- **Don't** make color the only state signal. Status must also be readable through labels, icons, position, shape, or pattern.
- **Don't** introduce soft glassmorphism, blur panels, decorative glows, or floating cards into the LiveStreamDetail visual language.
- **Don't** use the older electric-blue shell as the default source of truth for operator surfaces unless a task explicitly targets that shell.
- **Don't** auto-prepend live data in a way that causes scroll jumps; preserve operator control over evidence review.
