# 2026-10-20: wave-height palettes with monotonic lightness (light + beach), owner A/B

Session opened 2026-10-20T03:20Z, started by the weather-simulation audit session on its palette audit of the same night
(memory `wave-palette-audit-2026-10-20`: light's calm 0 m and 10 m storm 12.6 dE00 apart, beach's 0.6 m and 2.4 m the same
grey). Branch `claude/determined-shtern-c26caa`, cut from dev `6021c2cc1`. Client only. **No served number changes** (no
SCOREBOARD row): the wash's colours and the legend move; every height, rating and glyph the backend serves is untouched,
and so are dark, the surf-quality mode, the crests and the texture encoding. Draft PR, not merged: the owner picks A or B.

## What changed

- `frontend/src/components/map/marineWavePalette.js`: the table became `WAVE_PALETTES` { v1, A, B }. **A is the default** while the
  owner A/Bs; `window.__RAW_WAVE_PALETTE_V2__ = 'B'` draws B; **`window.__RAW_DISABLE_WAVE_PALETTE_V2__ = true` draws v1 exactly**
  (GLSL, every JS sample 0-11 m and the legend CSS hash to the pre-edit module; pinned in `marineWavePalette.test.js`). The old
  kill (`__RAW_DISABLE_MARINE_WAVE_PALETTE__`, the shader's own ramp) is unchanged. The GLSL is still generated from the table
  (no texture, uniform, draw or per-frame work added) and still called only for `surfMode < 0.5 && theme > 0.5`.
- Each candidate has 7 anchors on the legend's own ticks (0 0.61 1.22 2.44 3.66 6.1 10 m = 0 2 4 8 12 20 33 ft) and an
  ABOVE-CAP colour, drawn from half a texel under the 10 m ceiling (a cell at or above 10 m reads exactly 10.0).
- The legend (`marineWaveLegend`, wired into `MapWeatherControls.js` in all three layouts with no line added): each anchor gets an
  equal share of the bar, so the CSS gradient between stops is linear in height exactly as the GLSL `mix()` is (both encoded
  sRGB), every tick sits on its own colour, none is dropped for crowding, and the last 6% is an arrow (clip-path) in the
  above-cap colour, labelled `33+` (ft) / `10+` (m). Every height layer (waves, swell, swell 2, wind waves) shows the one bar,
  because the GPU draws them with the one colour map. v1 under its kill keeps each scale's own value axis and ticks.

## The domain: the GPU's ceiling is 10 m, not the palette's

The brief asked for ~16 m (live storms reach 12.3 m). The wave texture stores height as `floor(min(1, h / 10) * 255)`
(`WebGLMarineTextureEncoder.js`), decoded `waveData.b * 10.0` by the heatmap and by both crest shaders, so every cell at or
above 10 m reaches the GPU as exactly 10.0: no palette can draw 12 m differently from 10 m. Widening the encoding is a second
visual variable (the crests read the same byte) and must stay byte-identical for dark and the rating texture (a global /16
moves dark's calm-water pixels by up to ~4.7 dE00 through the coarser 8-bit step), so it needs a per-upload scale uniform in
two files that may not grow. This PR caps at the true ceiling and makes it EXPLICIT (the above-cap colour and the arrow) instead
of a silent clamp; the widening is proposed as its own A/B. I asked the lead session which way (one message, recommending this);
no answer had arrived when the PR opened.

## Numbers (wave-check.mjs; the coloraide authority agrees)

Composited over the water the app draws (measured below), at the wash alpha for world 0.65 / regional 0.70 / coastal 0.77.

| | lightness | weakest neighbours, world / regional / coastal (normal + 3 dichromats; target 10) | land vs sea | crest core vs wash (normal / colour-blind) | legend APCA, weakest | above 10 m |
|---|---|---|---|---|---|---|
| light v1 | climbs back 0.61 L (2.4-10 m) | 4.3 / 4.8 / 5.4 | 7.3 | 15.7 / 0.8 | 0 (10 m white on white) | clamps |
| light A | falls at every 0.02 m | 7.2 / 7.8 / 8.6 | 20.0 | 27.8 / 25.1 | 15.3 | 22.6 off the cap |
| light B | falls at every 0.02 m | 7.2 / 7.6 / 8.1 | 21.8 | 24.0 / 15.8 | 15.3 | 10.8 |
| beach v1 | climbs back 1.00 L | 11.6 / 12.3 / 13.1 | 7.0 | 16.2 / 1.0 | 0 (5 m on black) | clamps |
| beach A | falls at every 0.02 m | 5.3 / 5.7 / 6.2 | 20.7 | 6.8 / 1.7 | 16.7 | 24.7 |
| beach B | falls at every 0.02 m | 6.5 / 6.9 / 7.4 | 20.1 | 8.8 / 3.4 | 19.3 | 23.1 |

No grey anywhere on A or B (wash C* >= 19, composite >= 14.8, the above-cap state included); v1 runs to C* 0 (light's white)
and its composites to 2.5 (beach).

## What it costs (for the owner's eye)

1. **The neighbour target of 10 dE00 is not met** by either candidate in either theme. A smooth ramp whose lightness falls at
   every step, drawn at 65% over a pale cyan sea, has about 0.3-0.45 OKLCH L of range for seven steps; the solver's first
   tables reached 12-15 only by zig-zagging chroma (C* 85 -> 14 -> 70 between neighbours), a pulsing ramp, so that was barred.
   Beach v1's 11.6 is bought with a lightness that climbs back by 1.0 L (its 5 m maroon is darker than its 10 m cream).
2. **Beach crests lose contrast at 1.5-4 m** (6.8 / 8.8 dE00 against v1's 16.2): beach's crest colour turns a greyish cyan
   there (orchid-pink blending to turquoise) and a lightness-ordered wash sits at about the same lightness. Light's crests GAIN
   (15.7 -> 27.8 / 24.0, and colour-blind 0.8 -> 25.1 / 15.8). The crest colours are a separate path, not touched here.
3. **The above-cap state draws the grid's own cells** at world and regional zoom (the 2-degree mid tier): a hard-edged block
   at a storm's eye. It is the data's own resolution, made visible by a hard step; at coastal zoom (0.25-degree tiles) it rounds.
4. Light A's calm is a pale cream (APCA 15.3 on the white panel, the floor); the legend's lightest stop is the calm.
5. Flat water under 0.18 m still draws the shader's depth floor (darker than the table's calm): pre-existing, not the palette.

## Instruments

- `frontend/scripts/wind-color/wave-check.mjs` + `wave_cvd_check.py` (the checker, modelled on the wind's), `wave-lib.mjs`
  (the composite model from HEATMAP_FS, the blend, `heatmapZoomOpacity` and DRAW_FS), `wave-solve.mjs` (differential evolution,
  smooth by construction), `wave-polish.mjs` (rounding rises; the above-cap colour against the fixed ramp). APCA agrees with
  Leonardo's wcag3 to 0.03 Lc on two pairs.
- **A model error found and fixed the same session:** the first solves composited over the water in `windFieldLut.test.js`
  ([168, 214, 222] light, [150, 190, 200] beach). The harness read the real basemaps with Waves off: (144, 223, 254) and
  (117, 207, 240), lands (255, 255, 255) and (237, 232, 226). Every table above was re-solved over the measured colours.
- **A second one:** the 0 m stop was first composited through the shader's depth floor, which made the calm pair look 25 dE00
  apart; stops are now composited from the table itself (they were 3 apart).
- `frontend/scripts/offline-backend/scn_wave_palette_ab.js` + `compose_wave_ab.py`: the A/B, one build, offline only
  (synthetic store, `--vortex-peak 11` so the eye crosses 10 m, `--dynamic 1`); no request reached the live box.

## PR, page and ledger

- Draft PR #411 (`claude/wave-palette-v2`), merged with dev `998e9e919` before opening; not merged, owner pick pending.
- The owner's A/B page (private to the owner): https://claude.ai/artifact/UTLpviFjCezB6sHGgmed13 (the side-by-side sheets,
  the two moving clips, the legends on their real panels, the numbers).
- Ledger 1504 (`pr_open`), 1505 (`commitment`: the owner's pick by 2026-10-24, then the loser and the B lever go, the kill stays).
- Local checks on the merged tree: Jest 454/455 suites (the one failure, `netlifyIconStoredTailScope.test.js`, is a Git Bash
  spawn over its 5 s limit on this Windows box; it and `netlify.toml` are identical to dev), ESLint and LOC ratchets clean,
  `wind-color/check.mjs --strict` exit 0, build compiled. Hosted CI is the authority.
- Follow-ups proposed, not built: widen the height encoding to ~16 m (per-upload scale uniform; dark and the rating texture
  byte-identical; its own A/B), and the beach crest colours at 1.5-4 m (their own A/B).

## 2026-10-20T06:40Z: the lead's answer on the domain

The lead session answered after the PR opened: keep the ramp capped at the true 10 m ceiling with the explicit above-cap
state and the 33+ ft / 10+ m arrow (option a, as built). Widening the encoding to 16 m changes what the crests read, so it is
its own PR and A/B after the owner picks A or B here; #411 stays a draft until that pick. (The lead's words, relayed by
session message; not the owner's.)

## 2026-10-20 ~12:30Z: the Jacobian (owner: "What is more state of the art? A or B? Use jacobian lens to help us decide")

`frontend/scripts/wind-color/wave-jacobian.mjs` + `wave_jacobian.py` (evidence `wave-palette-v2-jacobian-2026-10-20.json`): every
lever that moves the on-screen colour, in CAM16-UCS, as composited at world alpha; nuisances in legend steps.

| | heights told apart | even steps | lightness share | colour-blind kept | zoom drift mean/max | swell max |
|---|---|---|---|---|---|---|
| light A | 29.4 | 0.75 | 63% | 78% | 0.31 / 0.66 | 0.29 |
| light B | 27.3 | 0.61 | 72% | 75% | 0.42 / 0.81 | 0.33 |
| beach A | 23.0 | 0.64 | 73% | 76% | 0.30 / 0.67 | 0.36 |
| beach B | 26.4 | 0.58 | 62% | 79% | 0.31 / 0.64 | 0.33 |
| viridis (reversed), either theme | 33 | 0.84 | 60% | 76-77% | 0.32-0.35 / 0.62-0.66 | 0.26 |

Read: **light A** (more heights told apart, the most even steps of the six after viridis, less zoom drift, clearer crests and
above-cap); **beach B, narrowly** (more heights, wider weakest neighbours 6.5 vs 5.3, clearer crests 8.8 vs 6.8, more visible
legend end; A is a little more even). By perceptual uniformity, the literature's first test, A light is closest to viridis and
its family (YlGnBu) beats B's (BuPu: even 0.60 vs 0.37) in this wash. The published maps themselves do not transfer: through the
wash their weakest colour-blind neighbours fall to 3.4-5.6, their pale or black ends vanish on the legend panels (APCA 0), and
magma ends in grey-black (checker run on each). **The largest lever is the engine's, not the palette's:** for every palette the
wash alpha rising 0.65 -> 0.77 with zoom moves one height's colour by up to ~2/3 of a legend step; the swell lighting ~1/3.
The recommendation is mine from these numbers; the pick is the owner's.

## 2026-10-20 12:28Z: ledger re-chained (correction to "Ledger 1504 (`pr_open`), 1505 (`commitment` ...)" above)

Dev's #406 appended ledger lines 1504-1531 in parallel; my two lines were re-appended after them unchanged except for `seq`,
`prev` and `at` (their true times kept in `acted_at`): **1532 (`pr_open`), 1533 (`commitment`)**, and the Jacobian's
`finding` is **1534**. The numbers 1504/1505 above are superseded.

Correction (2026-10-20 12:29Z): the Jacobian section's header above says "~12:30Z"; it was written at 12:23Z (an estimate
that ran ahead of the clock, LESSONS L-P10). Ledger `correction` line names it.

## 2026-10-20 12:55Z: the owner's pick (DECISIONS D-033)

Owner, 12:46Z: "Ship light A and beach B: remove light B and beach A and the B lever, keep the V2 kill, and mark #411 ready."
Built: `WAVE_PALETTES` is now { v1, v2 }, v2 = light's A table and beach's B table with their own above-cap colours (each theme's
tables were solved and polished on their own, so the checker's numbers carry over unchanged: light 7.2/7.8/8.6, beach
6.5/6.9/7.4 weakest neighbours world/regional/coastal). `window.__RAW_WAVE_PALETTE_V2__` is gone (a test pins that it no longer
selects anything); the V2 kill still restores v1 exactly. The A/B harness and the Jacobian now read v1/v2. Re-run on the change:
`marineWavePalette.test.js` 20/20; full frontend Jest 457/458 suites (the one failure is still `netlifyIconStoredTailScope.test.js`,
a Git Bash spawn over 5 s on this machine, identical to dev); ESLint and LOC ratchets clean; wind check `--strict` 0; build compiled.
