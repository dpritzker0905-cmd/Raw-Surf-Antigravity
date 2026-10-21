# 2026-10-20: how opaque the light/beach wave wash is really drawn (measurement only)

Session opened 2026-10-20T21:02Z, started by the lead session with the brief: measure whether the light and beach wave-height
wash is drawn more opaque than the colour checkers assume (`frontend/scripts/wind-color/wave-lib.mjs` ALPHAS world 0.65 /
regional 0.70 / coastal 0.77), as #419's dark storm crest session found for dark (fitted 0.84-0.87 where heatmapZoomOpacity
gives 0.68-0.74; #419's ledger line 1549, on its branch). Offline harness only (no live backend). **No served number changes,
no product change** (no SCOREBOARD row): three instruments, this log and an evidence file. Entry written 2026-10-21T00:59Z.

## 1. Verdict

**The model is right when no regional tile is resident, and wrong whenever one is.** The cause is BLEND BOTH (cited in §3):
with a regional tile resident, the engine paints the coarse world wash first (at 0.72 x the zoom opacity, damped to 35%
above z 9.5), then the regional wash over it, and the regional pass fades below 1.4 m. The drawn alpha is then a function of
HEIGHT, not one number per view:

    a(h) = 1 - (1 - a_z * smoothstep(0.05, 1.4, h)) * (1 - washEff),   a_z = heatmapZoomOpacity(z),
    washEff = a_z * 0.72 * (1 - 0.65 * smoothstep(8, 9.5, z))          (0.49 at z 4.6, 0.53 at z 7.4, 0.19 at z 10)

At sea heights of 1.4 m and up that is 0.84 (z 4.6), 0.85 (z 5.5), 0.88 (z 7.4), 0.82 (z 10): MORE opaque than the model. Below
1.4 m it falls: at 0.5 m, 0.61 (z 7.4) and **0.34 (z 10)**: far LESS opaque than the model's 0.77. On a light ground a calm sea
at close zoom is drawn nearly as bare water (sheet in the session notes: `wash-alpha-sheet-2026-10-20.png`).

## 2. Measured (theme x view: model alpha, fitted alpha, residual)

Real engine, offline: PR #419's build (frontend src = `08ff79ec9`; the engine, shader and opacity files are byte-identical to
dev `5fe62b5f2`, which the citations below use) over `serve_synthetic.py --dynamic 1 --vortex-peak 11`, `scn_wash_alpha.js`
(4 paired crest-on / crest-off frames per view at one forecast hour, 2026-10-21T00:00Z, 1280x800, the centre 60% x 70% cropped
as `crest_by_height.py` does), fitted by `wash_alpha.py` against `wash-lut.mjs` (wave-lib's composite before its alpha).
Residual = median CIEDE2000 of the sea pixels to the nearest ramp row. "law" = the formula above with the opacities the engine
itself reported that frame (`window.__RAW_GPU__`), no free parameter. "per-pixel" = model-free: the v2 frame against the
blend-off control (`nb`, same hour, camera and resident grid), a_eff = a_nb <c - w, c_nb - w> / |c_nb - w|^2.

**Bare water, every view (Waves off): light (144, 223, 254), beach (117, 207, 240) at z 2.2 / 4.6 / 5.5 / 7.4 / 10 (84-100% of
the frame) = wave-lib BASEMAP.** The ground is right at every zoom; only the alpha is off.

| state | theme | view (z) | blend | u_opacity / base | sea h p50 | model | **fitted** | resid fitted / model | law | resid law | per-pixel |
|---|---|---|---|---|---|---|---|---|---|---|---|
| fresh load | light | world (2.2) | off | 0.65 | 1.6 m | 0.65 | **0.65** | 0.12 / 0.12 | 0.650 | 0.12 | 0.650 |
| fresh load | light | regional (4.6) | off | 0.682 | 3.4 m | 0.70 | **0.68** | 0.15 / 0.20 | 0.682 | 0.15 | 0.682 |
| fresh load | light | z 5.5 | off | 0.70 | 7.5 m | 0.70 | **0.70** | 0.17 / 0.17 | 0.700 | 0.17 | 0.700 |
| fresh load | light | coastal (7.4) | on | 0.738 / 0.531 | 6.2 m | 0.77 | **0.87** | 0.27 / 0.92 | 0.877 | 0.28 | (grids differ) |
| fresh load | light | close (10) | on | 0.539 / 0.194 * | 6.0 m | 0.77 | **0.62** | 0.23 / 1.41 | 0.628 | 0.24 | (grids differ) |
| fresh load | beach | world (2.2) | off | 0.65 | 1.6 m | 0.65 | **0.65** | 0.18 / 0.18 | 0.650 | 0.18 | 0.650 |
| fresh load | beach | regional (4.6) | off | 0.682 | 3.4 m | 0.70 | **0.68** | 0.24 / 0.85 | 0.682 | 0.20 | 0.682 |
| fresh load | beach | z 5.5 | off | 0.70 | 7.5 m | 0.70 | **0.70** | 0.21 / 0.21 | 0.700 | 0.21 | 0.700 |
| fresh load | beach | coastal (7.4) | on | 0.738 / 0.531 | 6.1 m | 0.77 | **0.88** | 0.31 / 3.54 | 0.877 | 0.20 | 0.887 |
| fresh load | beach | close (10) | on | 0.77 / 0.194 | 6.0 m | 0.77 | **0.82** | 0.32 / 1.64 | 0.815 | 0.51 | 0.818 |
| zoomed out | light | regional (4.6) | on | 0.682 / 0.491 | 3.4 m | 0.70 | **0.84** | 0.19 / 1.11 | 0.838 | 0.19 | 0.838 |
| zoomed out | light | z 5.5 | on | 0.70 / 0.504 | 7.5 m | 0.70 | **0.85** | 0.19 / 1.77 | 0.851 | 0.19 | 0.851 |
| zoomed out | light | coastal (7.4) | on | 0.738 / 0.531 | 6.1 m | 0.77 | **0.88** | 0.15 / 0.91 | 0.877 | 0.14 | 0.891 |
| zoomed out | light | close (10) | on | 0.77 / 0.194 | 5.9 m | 0.77 | **0.81** | 0.38 / 0.49 | 0.815 | 0.43 | 0.821 |
| zoomed out | light / beach | world (2.2) | off | 0.65 | 1.6 m | 0.65 | **0.65** | 0.12 / 0.12, 0.18 / 0.18 | 0.650 | same | 0.650 |
| zoomed out | beach | regional (4.6) | on | 0.682 / 0.491 | 3.4 m | 0.70 | **0.84** | 0.23 / 6.19 | 0.838 | 0.23 | 0.838 |
| zoomed out | beach | z 5.5 | on | 0.70 / 0.504 | 7.5 m | 0.70 | **0.85** | 0.26 / 6.35 | 0.851 | 0.23 | 0.851 |
| zoomed out | beach | coastal (7.4) | on | 0.738 / 0.531 | 6.1 m | 0.77 | **0.88** | 0.31 / 3.54 | 0.877 | 0.20 | 0.887 |
| zoomed out | beach | close (10) | on | 0.77 / 0.194 | 6.0 m | 0.77 | **0.82** | 0.44 / 1.48 | 0.815 | 0.59 | 0.819 |
| calm sea | light | z 7.4, 0.5 / 0.8 / 1.0 / 1.2 / 1.4 m | on | 0.738 / 0.531 | | 0.77 | **0.59 / 0.73 / 0.81 / 0.86 / 0.88** | 0.05-0.13 / 0.44-2.16 | 0.60 / 0.71 / 0.80 / 0.85 / 0.88 | 0.07-0.18 | 0.853 (1.2), 0.875 (1.4) |
| calm sea | light | z 10, 0.5 / 1.0 / 1.4 m | on | 0.77 / 0.194 | | 0.77 | **0.34 / 0.69 / 0.84** | 0.05-0.15 / 0.16-8.08 | 0.34 / 0.67 / 0.81 | 0.05-0.20 | (grids differ) |
| calm sea | beach | z 7.4, 0.5 / 0.8 / 1.0 / 1.2 / 1.4 m | on | 0.738 / 0.531 | | 0.77 | **0.61 / 0.73 / 0.80 / 0.85 / 0.88** | 0.12-0.23 / 0.52-4.88 | 0.61 / 0.72 / 0.80 / 0.85 / 0.88 | 0.05-0.29 | 0.613 (0.5) |
| calm sea | beach | z 10, 0.5 / 1.0 / 1.4 m | on | 0.77 / 0.194 | | 0.77 | **0.34 / 0.67 / 0.81** | 0.10-0.14 / 1.77-6.14 | 0.34 / 0.67 / 0.81 | 0.10-0.19 | 0.341 / 0.670 / 0.810 |

\* A transient: a 2-degree, 29 x 24 grid (56 x 46 degrees) was still resident at z 10, so coarseFade 0.7 dimmed the main pass.
The law still fits it (0.628 vs 0.62).

"Fresh load" = views in the order world, regional, z 5.5, coastal, close: at z 4.6 and 5.5 the 2-degree global grid is
resident (the viewport is wider than the 15-degree regional lane), so BLEND BOTH is off. "Zoomed out" = the same cameras reached
from z 10 down: the regional tile committed up close stays resident, so the blend is on. That is the state #419's (and #416's)
paired clips were shot in, which is why dark fitted 0.84 at z 4.6.

**Controls.**
- Causal: `window.__RAW_DISABLE_BLEND_BOTH__` (variant `nb`, same build, cameras and order) returns the fitted alpha to
  `heatmapZoomOpacity` in every blend view: 0.74 at z 7.4 (0.738), 0.76-0.78 at z 10 (0.77), 0.68 / 0.70 zoomed out (0.682 /
  0.70), and 0.72-0.79 on every calm view (0.738 / 0.77). Without the blend nothing is over-read and nothing fades.
- Palette independence: v1 (`__RAW_DISABLE_WAVE_PALETTE_V2__`) fits the same alphas as v2 in every view (0.65 / 0.68 / 0.70 /
  0.88 / 0.81-0.82): a compositing property, not a palette one.
- Null: views without the blend give per-pixel a_eff = a_nb to three decimals (the v2 and nb frames are pixel-identical there).
- The pairing needs the same resident grid in both runs; it did not always hold (the dynamic lane committed 6, 8, 9 or 13
  column tiles run to run), and those pairs are marked, not used.

Evidence: `docs/weather-program/evidence/wash-alpha-2026-10-20.json` (82 rows: every theme x variant x view, the engine's
reported opacities, fitted / model / law alphas and residuals; and the checker deltas below).

## 3. The cause in the engine (dev `5fe62b5f2`)

- `WebGLMarineEngine.js:973-997`: `blendEngaged` is set whenever the resident grid has REGIONAL bounds and a same-model,
  same-layer coarse base is retained (kill `__RAW_DISABLE_BLEND_BOTH__`).
- `:1082` the base wash factor `_blendBaseWash` 0.72; `:1092` `_washZoomDamp = 1 - 0.65 * smoothstep(8, 9.5, z)`; `:1160`
  `baseWashOpacity = heatmapZoomOpacity(z) * _baseMult * 0.72 * _washZoomDamp` (the 0.35 halo / no-truth damps at `:1248` and
  `:1443` did not engage in these runs: `haloDamp` / `washNoTruthDamp` false).
- `:1380` `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)`; `:1451` PHASE 0 `_drawCoarseBasePass(..., _washOpacityEff, ...)`, which
  (`:3063-3120`) draws the coarse base with `u_heightAlphaEnabled` 0 and `u_opacity` = that wash opacity.
- `:1675-1676` the regional pass's height alpha, lo 0.05 m / hi 1.4 m, enabled exactly when `blendEngaged`; `:1697`
  `heatmapOpacity = heatmapZoomOpacity(z)` (x coarseFade `:1732`), `:1831` its `u_opacity`.
- `WebGLMarineShaders.js:674` `alpha = u_opacity`, `:693` `alpha *= smoothstep(u_heightAlphaLo, u_heightAlphaHi, displayHeight)`,
  `:705` premultiplied `vec4(finalColor * alpha, alpha)`. Two premultiplied layers of one colour over the water compose to
  `1 - (1 - a_main)(1 - a_base)`: the law in §1.
- `marineEngineDecisions.js:48` `heatmapZoomOpacity`: 0.65 at z <= 3, +0.02 per zoom to 0.75 at z 8, 0.80 at z 13. This is what
  wave-lib's ALPHAS mirror; it is the main pass's alpha only.

The shader comment says why the height alpha exists: low surf drew near-black on dark's basemap and read as "the heatmap
cleared", so near-flat regional cells let the vivid coarse base through. On light and beach the base it lets through is itself
damped to 35% above z 9.5 (the Long Beach land-bleed fix, `:1084-1092`), so calm water fades out instead.

## 4. What changes in wave-check.mjs if ALPHAS are corrected

`wave-check.mjs` run twice on the same tree: A = today's ALPHAS; B = world 0.65 and regional 0.70 (fresh load, measured), plus
the three blend states as per-height alphas: regionalOut (z 5.5: main 0.70, base 0.504), coastal7 (z 7.4: 0.738 / 0.531) and
coastal (z 10: 0.77 / 0.194). B used a two-edit scratch patch to wave-lib.mjs, NOT committed: `ALPHAS` read from env
`WAVE_ALPHAS` (a number = one alpha; `{main, base}` = `(h) => 1 - (1 - main * ss(0.05, 1.4, h)) * (1 - base)`), and
`composite()` taking `const A = typeof a === 'function' ? a(h) : a`.

| palette | line | A (model) | B (measured) |
|---|---|---|---|
| light v2 + crest V2 (dev, #421) | crest APCA \|Lc\| body / whitecap front | 40.0 / 40.9 | 38.7 / 40.9 |
| light v2 + crest V2 (dev, #421) | crest dE00 / colour-blind | 32.7 / 24.3 | 32.7 / 24.3 |
| beach v2 (#416 mid wash, warm-polarity crest) | crest APCA \|Lc\| body / front; colour-blind | 34.0 / 22.8; 14.7 | 34.0 / 22.5; 13.5 |
| light v2 | legend neighbours, weakest (colour-blind) / normal | 7.2 (1.22-2.44 m, world) / 10.2 | **0.7** (0-0.61 m, z 10) / 3.8 |
| beach v2 (#416 mid wash) | legend neighbours | 8.9 (0-0.61 m, world) / 10.8 | **4.6** (0-0.61 m, z 10) / 10.3 |
| beach v1 (dev, locked D-035) | legend neighbours | 11.6 ok / 14.5 | **1.3 RED** (0-0.6 m, z 10) / 6.2 |
| beach v1 | no grey (composite C*); land vs sea | 2.5; 7.0 | 0.3 (9.6 m, z 7.4); 2.2 |
| light v1 | crest dE00 / colour-blind; land vs sea | 14.8 / 0.7; 7.3 | 13.4 / 0.2; 4.2 |

- **Crests: no re-solve needed.** The crest sessions' worst cases sit at world zoom (no blend, model right) or at heights where
  the blend's extra opacity moves little: light V2 loses 1.3 |Lc| at 3.0 m, beach's polarity crest keeps |Lc| 34.0. Their engine
  numbers (paired exact wash, `crest_contrast.py` / `crest_by_height.py`) never used ALPHAS. #419's `crest_by_height.py`
  fits one alpha per view, which is right at storm heights (its bins), not on calm water.
- **The legend's calm end is where the model is wrong.** At close zoom 0 m is drawn at alpha 0.19 and 0.61 m at 0.43, so the two
  stops are 0.7 dE00 apart in light v2 (1.3 in dev's beach v1): calm seas are not told apart, and read nearly as bare water.

## 5. Recommendation

1. **wave-lib.mjs ALPHAS should change, as per-height alphas, not bumped scalars.** Keep world 0.65 and regional 0.70 (a fresh
   load, measured exact); add the blend states with the engine's law (regional zoomed out z 5.5 {0.70, 0.504}, z 7.4 {0.738,
   0.531}, coastal z 10 {0.77, 0.194}), with `composite()` taking an alpha per height (the two edits in §4). Land it after #416
   and #419 settle (both edit wave-lib.mjs). It turns wave-check's legend lines RED at the calm end at close zoom in every
   palette: that is the drawn state, so it should land with item 2 decided, not before.
2. **Product question for the owner (not built; owner A/B):** in light and beach at close zoom, calm seas under ~1 m are drawn at
   alpha 0.19-0.43 (0.34 measured at 0.5 m): the wash nearly vanishes on calm days near the coast. A candidate to A/B: BLEND
   BOTH's height alpha for dark only (light/beach draw calm regional cells at the zoom opacity, as the `nb` control did: 0.77 at
   z 10), behind a kill switch. Served numbers are untouched either way; it is a visual change.
3. Harness lesson (mechanized in `scn_wash_alpha.js`, noted in the offline README): never pre-seed `window.__RAW_GPU__`. The
   engine builds it, with `frameTimeHistogram` and friends, only when absent (`WebGLMarineEngine.js:108`); a bare `{}` made its
   render throw and the layer dispose the engine (`:3200` clears `__MARINE_ENGINE__`), which first read as "no engine at
   world zoom". Also: which grid is resident changes run to run (6-29 column tiles; a 2-degree grid lingered at z 10), so read
   each frame's own opacities before interpreting it, and pair a control only on the same grid.

## 6. Instruments (this PR)

- `frontend/scripts/offline-backend/scn_wash_alpha.js`: the scenario (bare water per view; variants v2 / v1 / nb / bw0; fresh,
  zoomed-out and calm views; per-frame engine opacities and grid).
- `frontend/scripts/offline-backend/wash_alpha.py`: the fitter (single alpha per view, the engine law, model-free per-pixel alpha).
- `frontend/scripts/wind-color/wash-lut.mjs`: the wash before its alpha, through wave-lib's own `composite()` (self-checked).
- Frames and fits stay local and untracked (three run folders of PNG frames); the evidence JSON holds every number above.
- Reproduce: `python serve_synthetic.py --dir <fresh dir> --port 4141 --dynamic 1 --vortex-peak 11`, `node serve_spa.js <build>
  3141`, then `AB_BASE=http://127.0.0.1:3141 PORT=4141 OUT=<dir> node scn_wash_alpha.js` (add `VARIANTS=v2,nb
  VIEWS=close,coastal,r55Out,regionalOut,worldOut` for the zoomed-out state, `VIEWS=calm05,calm08,calm10,calm12,calm14,calm05c,
  calm10c,calm14c` for calm seas), `node wash-lut.mjs <lut.json>`, `python wash_alpha.py <dir> <lut.json> [--variants ...
  --views ...] --json out.json`. Node scripts from a checkout path without a dot directory (CRA/playwright resolution).

## 7. 2026-10-21T03:46Z: replicated on a dev build, as served (the lead's request: measure on dev, label each number)

The lead asked for dev's build (f6b80f724: beach on v1, sha-locked by D-035; light on v2 at 16 m since #415). Built dev
**448deb35c** (= 5fe62b5f2 + #424's receipt; contains f6b80f724 and #421), fresh store, valid 2026-10-21T03:00Z, variants `v2`
(the defaults: light v2@16, beach v1) and `nb`; fitted against dev's own tables (`wash-lut.mjs --palettes v2,v1,v2@16`,
`wash_alpha.py --palette-map light/v2=v2@16,light/nb=v2@16,beach/v2=v1,beach/nb=v1`). Same result as §2 within 0.01-0.03:

| build | theme (table) | view (z) | blend | u_opacity / base | sea h p50 | model | **fitted** | resid fitted / model | law | per-pixel |
|---|---|---|---|---|---|---|---|---|---|---|
| dev 448deb35c | light (v2@16) | world (2.2) | off | 0.65 | 1.6 m | 0.65 | **0.64** | 0.12 / 0.13 | 0.650 | 0.650 |
| dev 448deb35c | light (v2@16) | regional (4.6) | off | 0.682 | 3.4 m | 0.70 | **0.68** | 0.15 / 0.21 | 0.682 | 0.682 |
| dev 448deb35c | light (v2@16) | coastal (7.4) | on | 0.738 / 0.531 | 6.2 m | 0.77 | **0.87** | 0.27 / 0.93 | 0.877 | (grids differ) |
| dev 448deb35c | light (v2@16) | close (10) | on | 0.539 / 0.194 * | 6.0 m | 0.77 | **0.62** | 0.23 / 1.41 | 0.628 | (grids differ) |
| dev 448deb35c | light (v2@16) | regional zoomed out (4.6) | on | 0.682 / 0.491 | 3.5 m | 0.70 | **0.84** | 0.18 / 1.11 | 0.838 | 0.838 |
| dev 448deb35c | light (v2@16) | calm 0.5 m (7.4) | on | 0.738 / 0.531 | 0.5 m | 0.77 | **0.62** | 0.04 / 1.83 | 0.621 | (grids differ) |
| dev 448deb35c | light (v2@16) | calm 0.5 m (10) | on | 0.77 / 0.194 | 0.5 m | 0.77 | **0.37** | 0.06 / 7.62 | 0.370 | (grids differ) |
| dev 448deb35c | light (v2@16) | calm 1.4 m (10) | on | 0.77 / 0.194 | 1.4 m | 0.77 | **0.81** | 0.12 / 0.13 | 0.814 | 0.807 |
| dev 448deb35c | beach (v1) | world (2.2) | off | 0.65 | 1.6 m | 0.65 | **0.65** | 0.21 / 0.21 | 0.650 | 0.650 |
| dev 448deb35c | beach (v1) | regional (4.6) | off | 0.682 | 3.9 m | 0.70 | **0.68** | 0.27 / 0.86 | 0.682 | 0.682 |
| dev 448deb35c | beach (v1) | coastal (7.4) | on | 0.738 / 0.531 | 6.2 m | 0.77 | **0.88** | 0.27 / 3.88 | 0.877 | 0.891 |
| dev 448deb35c | beach (v1) | close (10) | on | 0.77 / 0.194 | 6.0 m | 0.77 | **0.81** | 0.31 / 1.61 | 0.815 | 0.820 |
| dev 448deb35c | beach (v1) | regional zoomed out (4.6) | on | 0.682 / 0.491 | 3.9 m | 0.70 | **0.84** | 0.28 / 6.02 | 0.838 | 0.838 |
| dev 448deb35c | beach (v1) | calm 0.5 m (7.4) | on | 0.738 / 0.531 | 0.5 m | 0.77 | **0.60** | 0.19 / 4.10 | 0.604 | 0.606 |
| dev 448deb35c | beach (v1) | calm 0.5 m (10) | on | 0.77 / 0.194 | 0.5 m | 0.77 | **0.33** | 0.04 / 10.42 | 0.325 | 0.335 |
| dev 448deb35c | beach (v1) | calm 1.4 m (10) | on | 0.77 / 0.194 | 1.4 m | 0.77 | **0.81** | 0.26 / 1.66 | 0.814 | 0.815 |

\* The same transient as §2: a 4-column tile held at z 10 with coarseFade 0.7.

- **Control:** `nb` fits heatmapZoomOpacity in all 16 views: 0.64-0.65 / 0.68 / 0.74 / 0.76-0.77 / 0.68 / 0.74 / 0.77 / 0.77.
- **Labels for §2-§5:** §2's table and §4's checker deltas are labelled "PR #419 build 669b5d699 (src 08ff79ec9)". Its engine,
  shader and opacity files are byte-identical to dev, and this replication on dev 448deb35c agrees.
- **Ledger re-chain:** dev took seq 1557 (#421's receipt) while #425 was open, so this branch's finding and pr_open were
  re-appended after it as **1558** and **1559** (`--acted-at` the original times, LESSONS ledger re-forks). The commit message
  of 926181a4b still says "ledger 1557"; the finding is 1558.
- **Dark (the session that started this one) asked why a second dark run fitted 0.71 at the eye:** the same condition. Run 1's
  clips were shot after a coastal view had committed a regional tile (its record: bounds -108..-102, 16..21), so they were
  zoomed out with the tile resident: the law gives 0.838 / 0.858 / 0.877, against 0.84 / 0.86 / 0.87 fitted. Run 2 visited
  only the eye, with the 181 x 83 global grid resident: no blend, 0.71 = heatmapZoomOpacity(6). Answered by message.
