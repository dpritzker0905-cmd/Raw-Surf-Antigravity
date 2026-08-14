# Verification receipt — rating-palette colour discriminability

Auditor: independent refutation pass, Audit 12.2. HEAD `791fdf78`, branch `dev`.
Default position was REFUTE. Outcome: **CONFIRMED (with two corrections to the claimant's framing).**

## 1. Proof reproduction at HEAD

**Palette — reproduces exactly.** `frontend/src/components/map/surfRating.js:354-357`:
`very_poor #f0476b, poor #f59e2c, poor_fair #f7d038, fair #2fd07a, fair_good #14b8a6,
good #7c3aed, epic #a855f7` (+ `unknown #6b7280`).

**Colour math — independently re-derived, not copied.** Script:
`<scratchpad>/cvd.py` (Vienot/Brettel/Mollon 1999 LMS dichromat projection, sRGB EOTF,
CIE Lab D65, dE76 over all C(7,2)=21 pairs; tritan uses the Brettel plane and is the least
reliable of the three).

| pair | normal | deutan | protan | tritan | claimed |
|---|---|---|---|---|---|
| very_poor / fair | 127.59 | **11.65** | 50.71 | 128.53 | 11.7 deutan ✓ |
| poor / poor_fair | 28.62 | **12.21** | **19.18** | **9.76** | 12.2 / 19.2 / 9.8 ✓ |
| good / epic | **15.20** | 19.43 | 16.45 | 87.82 | 15.2 / 19.4 / 16.4 ✓ |

All six cited dichromat figures reproduce to ±0.1. **Proof stands.**

**One loose figure, not a falsehood.** "down from >73.7 in normal vision" — 73.65 is the
`poor_fair/fair` normal pair, not `very_poor/fair` (which is 127.59). Stated as a floor
(">73.7") it is true, and the true value makes their case *stronger*, not weaker.

## 2. Register coverage — searched by synonym, with positive controls

Both greps run over `audit/weather-simulation-12.0` + `audit/weather-simulation-12.1`,
`--include=*.csv --include=*.md`:

- `colou?r.?blind|colou?r.?vision|deuteran|protan|tritan|dichromat|contrast ratio|WCAG` → **0 rows**
- `RATING_COLOR|getRatingColorSmooth|MapMarkerLayers|rating glyph|palette|swatch|hue` → **0 rows**
- *positive control, same grep/dirs/excludes:* `colorScales|WebGLMarineShaders|WebGLMarineEngine`
  → hits in 7 register files. Search technique verified working.

`STATE_OF_THE_ART_TARGET_CONTRACT.md` A1-A18 / B1-B15 / C1-C8 read in full: **no human-factors
or accessibility row exists.** A13 ("Cursor, infobox, legend and field agree") is a *parity of
values* row, marked MET.

**Nearest miss, read in full and rejected as covering:** `WS-OBJ-204` "Readout legend and unit
truth", Intended Outcome *"The number the colour and the label agree"*, sole task `WS-CAN-0015`
whose 7 enumerated items are: rain unit label, wind legend from the shader ramp, equal-value
ticks, cross-fall slot sampling, one nearshore display policy, ft/m in infobox cards, radar
legend. **Agreement is not discriminability** — a palette can satisfy all of WS-OBJ-204 and still
be indistinguishable. `WS-CAN-0012` is the register's only "Accessibility / correctness" row and
covers device tier / reduced-motion / OOB cull / in-place reseed.

## 3. Not shipped recently, not a symptom

- `git log --oneline -20 -- frontend/src/components/map/surfRating.js` — palette untouched.
- `git log -S "f0476b" -- frontend/src/components/map/` → `9c3a809a`, `806c9445` only (original
  overlay work). Nothing in the last 40 commits.
- **Not** a symptom of QUEUE E#1 (band-vs-glyph): that is a *value* discrepancy (band reads
  2.3-2.7x the glyph). Orthogonal to colour legibility.
- No CVD toggle / pattern / shape channel anywhere: grep
  `highContrast|patternFill|texture.*rating|glyphShape` → none. *Positive control:*
  `prefers-reduced-motion|motion-reduce` is handled in 5 frontend files — the repo does ship
  other accessibility media queries.

## 4. Corrections to the claimant

**(a) They undercounted the non-colour channels — there are three, not two.**
Beyond `spotGlyphAriaLabel` (`MapMarkerLayers.js:24-45`) and the hover/focus card
(`:260-263`), `forecastCardCompiler.js:355-365` pushes a **`label: 'Rating'`** card with
`value: RATING_LABEL[surfRating.level]` — the full word — into `MapForecastOverlay`.
This does not close the gap (all three are per-point and on-demand; none serves an
at-a-glance scan, and none reaches the WebGL band's pixels) but the claim as written
overstates the absence.

**(b) They buried the stronger, vision-independent finding.**
`good/epic = 15.20 in NORMAL vision` — the palette's worst pair is *already* more confusable
than the CVD-collapsed `very_poor/fair` under protan and tritan. And the legend
(`MapWeatherControls.js:266-276`) prints **four words over seven bands**
(`['Poor','Fair','Good','Epic']`), so `very_poor`, `poor_fair` and `fair_good` have **no legend
text at all**. The honest framing is *"the rating palette has never been checked for
discriminability, in any vision model"* — broader and more defensible than "deuteranopia".

**(c) Against the literal 2026-07-14 mandate the glyph arguably passes.** The mandate's own
acceptance test is "rating glyphs need a text/label equivalent", and one exists. The claimant
is applying a stricter reading (visible, at-a-glance, for a sighted CVD user). Real gap, but
this caps severity at Medium, not High.

## 5. Surfaces confirmed colour-only at a glance

- Glyph, Rating mode: `MapMarkerLayers.js:200-223` — pulse ring, halo and 19px core dot all
  `rating.color`; white ring is constant across levels. No shape, size or text varies by level.
- WebGL coastal band: `WebGLMarineShaders.js:236-259` `getRatingColorSmooth` interpolates the
  identical 7 hex anchors. Per-pixel; no text channel exists or can exist.
- Test estate: `MapMarkerLayers.a11y.test.js:42` names the aria-label
  *"the color-independent equivalent"* — the program's entire treatment of "colour alone" is an
  accessible **name**, i.e. the screen-reader population. Zero assertions anywhere on visual
  separation.
