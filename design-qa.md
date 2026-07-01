# Design QA: New Scan Home

Source visual truth: `/Users/michael/Downloads/stitch/screen.png`
Implementation screenshot: `.impeccable/qa/new-scan-implementation.png`
Viewport: `1600x1280`
State: default New Scan home screen at `/`

## Evidence

- Full-view comparison completed against the supplied reference image.
- Implementation was recaptured after the last layout fixes at the same `1600x1280` viewport.
- Focus regions checked: top telemetry bar, left rail, New Scan header, config summary chip, Seeds panel, Game panel, Nonce Range panel, Target panel, orange scan CTA, and bottom status strip.

## Findings

- Passed: screen structure, full-bleed grid shell, panel placement, dense mono typography, high-contrast operator-console styling, and orange/blue/green signal colors match the requested direction.
- Passed: CTA now remains on one line and mirrors the large orange command block in the reference.
- Passed: config chip now reads `SCAN_V1` with the expected nonce and target summary.
- Non-blocking polish: the left-rail brand mark uses the closest available Tabler icon rather than the bespoke stacked logo from the mock. This preserves the existing icon-library rule and does not change layout or workflow fidelity.

## Patches Made During QA

- Set the config summary label to `SCAN_V1`.
- Kept the CTA title on one line with compact subtext beneath it.
- Matched the visual active preset to `1M` while preserving the functional evaluated nonce count.
- Tightened panel header spacing to better align with the reference.

final result: passed
