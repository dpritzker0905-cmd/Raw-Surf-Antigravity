# 2026-10-21: calm wash hold, owner A/B (light/beach calm seas at close zoom)

Session opened 2026-10-21T04:36Z, started by the session that owns the shared notes folder `local_7a9eef66`, with the brief:
build an owner A/B for the light/beach calm-sea wash fade at close zoom that PR #425 measured, then make the colour checker
model it. Branch `claude/calm-wash-hold` on dev `448deb35c`. Client only. **No served number changes** (no SCOREBOARD row):
every height, rating and glyph the backend serves is untouched. It is a visual change: it ships ON in the draft PR with a kill
switch, and waits for the owner's pick. Entry written 2026-10-21T07:17Z.

## 1. What changed

- `frontend/src/components/map/marineCalmWashHold.js` (new): `blendHeightAlpha(blendEngaged, themeVal, surfModeVal, win)`
  returns the regional pass's `u_heightAlphaEnabled`. Dark (themeVal 0): `blendEngaged ? 1 : 0`, as before. Light and beach on
  the honest wash: 0, so calm regional cells keep the zoom opacity over the coarse base. Rating-band frames (surfMode 1): today's
  fade in every theme. Telemetry `window.__RAW_GPU__.calmWashHold = { on, held }`, written only when the engine has built
  `__RAW_GPU__` (never created: PR #425's harness trap).
- **Kill** `window.__RAW_DISABLE_CALM_WASH_HOLD__ = true`: today's uniform in every theme (`blendEngaged ? 1 : 0`); only a strict
  `true` kills.
- `WebGLMarineEngine.js`: one line changed (the `u_heightAlphaEnabled` uniform at the old `:1676` now calls the helper) and the
  import appended to the `measureMarineMaskPaint` import line. The file stays at 3205 lines (LOC baseline 3207). The import
  first sat on the `readMarineSurfMode` line, where open draft #428 appends its own import; moved in `dae233ce8` so the two PRs
  do not conflict (#420's engine hunks are elsewhere too).
- `marineCalmWashHold.test.js`: 11 tests. Dark is today's uniform in every state with and without the kill; the kill is today's in
  every theme; the only states that differ from today are light and beach on an engaged honest blend; rating keeps the fade;
  telemetry never creates `__RAW_GPU__`; source pins: the engine's single regional call site, the coarse base pass still `0.0`,
  and the shader's `smoothstep(u_heightAlphaLo, u_heightAlphaHi, displayHeight)` unchanged. 11/11 pass (dot-free checkout).

## 2. Measured (real engine, offline)

Build `e5cb31612` (dev `448deb35c` + the hold; the PR head differs by the import line only). `serve_synthetic.py --dynamic 1
--vortex-peak 11` (port 4151) + `serve_spa.js` (3151), headless system Chrome on the AMD Radeon 890M (ANGLE D3D11), valid
2026-10-21T06:00Z. No request reached the live backend. Variants from ONE build: `today` = the kill set, `v2` = the default (the
hold), `nb` = `__RAW_DISABLE_BLEND_BOTH__` (the causal control). Two paired frames per view (crests on / off). Fitted by PR #425's
`wash_alpha.py` against dev's tables (light `v2@16`, beach `v1`). Every frame's engine read-back: BLEND BOTH engaged in `today`
and `v2`, regional `u_opacity` 0.738 (z 7.4) / 0.77 (z 10), coarse base `washEff` 0.531 / 0.194, `hold` telemetry
`{on: false}` under the kill and `{on: true, held: true}` by default (light/beach).

| theme | view (z, sea p50) | today fitted | today law | **hold fitted** | hold law | per-pixel vs nb, today → hold |
|---|---|---|---|---|---|---|
| light | coast, Ilhabela (10, 0.57 m) | 0.40 | 0.40 | **0.83** | 0.815 | (grids differ) → 0.811 |
| light | coast, Ilhabela (7.4, 0.57 m) | 0.64 | 0.65 | **0.87** | 0.877 | (grids differ) → 0.867 |
| light | open sea (10, 0.5 m) | 0.37 | 0.36 | **0.82** | 0.815 | (grids differ) → 0.819 |
| light | open sea (7.4, 0.5 m) | 0.62 | 0.62 | **0.88** | 0.877 | (grids differ) → 0.879 |
| light | open sea (10, 1.0 m) | 0.68 | 0.68 | **0.82** | 0.815 | (grids differ) → 0.816 |
| light | open sea (10 / 7.4, 1.4 m) | 0.81 / 0.88 | 0.81 / 0.88 | **0.81 / 0.88** | 0.815 / 0.877 | → 0.807 / 0.875 |
| light | storm, Manzanillo (10 / 7.4, 5.9 / 6.0 m) | 0.82 / 0.88 | same | **0.82 / 0.88** | same | → 0.819 / 0.891 |
| beach | coast, Ilhabela (10, 0.55 m) | 0.31 | 0.39 | **0.79** | 0.815 | 0.385 → 0.815 |
| beach | coast, Ilhabela (7.4, 0.55 m) | 0.63 | 0.64 | **0.86** | 0.877 | 0.633 → 0.874 |
| beach | open sea (10, 0.47 m) | 0.33 | 0.33 | **0.82** | 0.815 | 0.335 → 0.816 |
| beach | open sea (7.4, 0.47 m) | 0.60 | 0.60 | **0.87** | 0.877 | 0.606 → 0.877 |
| beach | open sea (10, 1.0 m) | 0.68 | 0.67 | **0.83** | 0.815 | 0.673 → 0.815 |
| beach | open sea (10 / 7.4, 1.4 m) | 0.81 / 0.88 | 0.81 / 0.88 | **0.81 / 0.88** | 0.815 / 0.877 | 0.815 / 0.876 → 0.815 / 0.876 |
| beach | storm, Manzanillo (10 / 7.4, 5.9 / 6.1 m) | 0.81 / 0.88 | same | **0.81 / 0.88** | same | 0.819 / 0.890 → same |

Laws (a = `heatmapZoomOpacity`, w = `washEff`): today `1 - (1 - a * smoothstep(0.05, 1.4, h)) * (1 - w)`; hold
`1 - (1 - a)(1 - w)` at every height. Median residual of each variant to its own law: 0.05-0.42 dE00 on the open sea and the
storm; the beach coast at z 10 fits less tightly (hold 1.09, today 2.08), and its model-free per-pixel alphas agree with the laws.
`nb` fits `heatmapZoomOpacity` in every view (0.72-0.79), as in #425.

**Controls.**
- **Dark is byte-identical:** `today` vs `v2` crest-free frames, same resident grid (13 / 9 / 13 / 13 columns, same bounds), at
  open sea 0.5 m z 7.4 and z 10 and the storm z 7.4 and z 10: max |diff| 0, 0.00% of pixels (`cmp_wash_frames.py`).
- **Storms do not move:** beach's storm views, same grid in both variants: max |diff| 0 (every sea pixel is above 1.4 m, where the
  fade never applied). Light's storm grids differed run to run (9 vs 13 columns); both fit the same alpha.
- **Null:** frame 00 vs 01 inside every variant and view: max |diff| 0 (the crest-free wash is static).
- **Causal:** `nb` (no coarse base, no fade) = `heatmapZoomOpacity`; the hold sits above it by exactly the base's share.

## 3. The colour checker's view (wave-lib's composite, both laws; not yet the committed checker)

Legend stops 0 m vs 0.6 m (light v2@16 0-0.61 m, beach v1 0-0.6 m), as composited over the measured water:

| theme | measure | world (both) | z 7.4 today → hold | z 10 today → hold |
|---|---|---|---|---|
| light | dE00 normal | 12.7 | 8.0 → 15.9 | 3.8 → 15.1 |
| light | dE00 weakest colour-blind | 10.0 | 6.1 → 10.5 | 0.7 → 10.5 |
| light | 0.5 m sea vs bare water, dE00 | 19.5 | 18.6 → 26.5 | 9.9 → 24.7 |
| beach | dE00 normal | 14.5 | 10.8 → 21.7 | 6.2 → 19.6 |
| beach | dE00 weakest colour-blind | 13.6 | 8.9 → 20.8 | 1.3 → 18.8 |
| beach | APCA \|Lc\| between the stops | 19.5 | 13.2 → 24.9 | 0 → 23.6 |
| beach | 0.5 m sea vs bare water, dE00 | 16.3 | 15.6 → 22.2 | 8.8 → 20.5 |

Light's APCA |Lc| between calm stops is 0 in both states: its calm colours sit at the water's lightness and differ in hue, which
APCA does not measure, so dE00 is light's wash measure. With the hold the weakest light pair moves to 6.1-10 m (9.2 deutan, z 7.4).

## 4. Owner page

https://claude.ai/artifact/82nAECDYzRBGAMgRcRgjrm (private to the owner): light and beach, today | hold, at coast z 10 and
z 7.4 (Ilhabela, 0.55 m), open sea 0.5 m at z 10 and z 7.4, 1.0 m at z 10, and the storm at z 10 and z 7.4, as drawn and crest-free,
with each frame's fitted alpha, the tables above and what stays the same. The owner replies `hold` or `today`.

## 5. Owed (ledgered as commitments)

1. **The owner's pick** (due 2026-10-24). Hold: a DECISIONS entry, hosted CI green, the PR marked ready. Today: close the PR (the
   kill is the whole of today's behaviour, so nothing else moves).
2. **wave-lib ALPHAS per height** (brief item 2), modelling the picked state: world 0.65 / regional 0.70 kept; the blend states
   regionalOut z 5.5 {0.70, 0.504}, coastal7 {0.738, 0.531}, coastal z 10 {0.77, 0.194} with `composite()` taking a(h). Under
   today a(h) is #425's law; under the hold it is the constant `1 - (1 - main)(1 - base)` (0.851 / 0.877 / 0.815) in light and
   beach. Blocked on the pick and on #416 (open, still edits `wave-lib.mjs`; #419 no longer does). #425 §4 holds the two-edit
   patch; `calm-legend.mjs` (scratch, below) already runs both laws through `composite()`.
3. When #425 merges: fold the `today` lever, the `hold` telemetry field and the `calmCoast` / `calmCoastC` views into
   `scn_wash_alpha.js` (and the two MODEL_VIEW keys into `wash_alpha.py`), so this A/B reproduces from the tree.

## 6. Instruments and reproduction

- PR #425's `scn_wash_alpha.js`, `wash_alpha.py`, `wash-lut.mjs` (from `origin/claude/agitated-euler-a13131`), run from the
  dot-free checkout `C:/Users/David/App/rs-calmwash` with these scratch additions (not committed; item 5.3): LEVERS
  `today: { __RAW_DISABLE_CALM_WASH_HOLD__: true }`, telemetry `hold: g.calmWashHold || null`, VIEWS
  `calmCoast: [-45.3, -23.85, 7.4], calmCoastC: [-45.3, -23.85, 10]` (synthetic swell 1.1 - 0.6 cos(lat) = 0.55 m there).
- Scratch: `cmp_wash_frames.py` (pixel identity of two variants' crest-free frames, grid-gated, with the frame-to-frame null),
  `calm-legend.mjs` (§3), `compose_calm_page.py` (crops to the fitter's map area, lossless WebP).
- Runs: `rs-calmwash-ab-calm` (VIEWS calm05,calm08,calm10,calm14,calm05c,calm10c,calm14c), `-storm` (coastal,close),
  `-dark` (THEMES=dark, calm05,calm05c,coastal,close), `-coast` (calmCoast,calmCoastC); `FRAMES=2`, `VARIANTS=today,v2,nb`
  (dark: today,v2). Fits `rs-calmwash-fit-{calm,storm,coast}.json`; every number above is in
  `docs/weather-program/evidence/calm-wash-hold-2026-10-21.json`.
- Windows traps: `npm run build` fails under cmd (`NODE_OPTIONS=... craco build` is POSIX syntax): run
  `NODE_OPTIONS=--openssl-legacy-provider npx craco build` from Git Bash. `serve_synthetic.py` needs the backend venv
  (`backend/.venv/Scripts/python.exe` in the main checkout); neither system Python has `dotenv`.
