# HANDOFF — Wave direction + missing-patch forensics (2026-07-03, fresh-context brief)

**Standing order: dev-only. NO pushes to main until the user says otherwise.**
dev HEAD at handoff: see `git log` — last release to main was `984c6745` (now known to contain the
fusion regression + the aggressive seam floor; both corrected on dev after; main is FROZEN anyway —
netlify production is still pinned to a June-4 deploy, user-dashboard unlock pending).

## 0. The two live user symptoms and their verdicts

### Symptom A — "missing wave animations in patches all over" ✅ ROOT CONFIRMED, mitigated, real fix designed
- **Root**: the seam-coherence floor (`0a656c34`, hardened `984c6745`) measured coherence as the bilinear
  `|waveVec|`. The encoder (`WebGLMarineTextureEncoder.js` ~line 497) writes the **zero vector (0.5,0.5)**
  for any cell with no direction — land, `is_valid:false`, cells the `extrapolateOceanData` pass doesn't
  reach. Bilinear samples within one texel of such a cell collapse in magnitude — **on the 10° coarse grid
  that is up to a full cell-width of ocean beside every coastline**: fade from ~30% in, hard cull past
  ~65%. Patches everywhere = every land-adjacent coarse region. The measure cannot distinguish
  "divergent seam" from "next to land".
- **Mitigation (committed on dev)**: nearest-mode `dirCoherenceMin` default back to **0.0**
  (`resolveCoarseCrestControls`); the fade machinery (hard drop <0.5·floor + alpha smoothstep
  [0.5·floor, floor] in both shaders) remains, inert, re-enable via `__RAW_DIR_COHERENCE_MIN__`.
- **Designed real fix (build in fresh context)**: make coherence land-aware at ENCODE time —
  **direction-only dilation**: BFS-fill the DIRECTION of the nearest ocean cell into every
  zero-direction texel (height stays 0, ocean mask still gates drawing, so nothing renders on land).
  Then bilinear |waveVec| collapses ONLY at true direction seams and the fade can default on (0.7).
  Note `extrapolateOceanData` already dilates full data into a limited ring and flips oceanArr=1 — the
  new pass must fill direction WITHOUT touching height/oceanArr. Test: encoder unit test with a
  land-adjacent grid; live: coastal crest coverage at z5–6 + seam fade at divergent boundaries only.
- **Secondary hypothesis (unproven)**: U2 stratified reseeding correlates particle position with the
  index lattice; the sin-based `particleHash(index)` cull could show structured survivor patterns at
  high cull fractions. A/B in seconds: `window.__RAW_STRATIFIED_RESEED__ = 0` + reload. If patches
  persist with floor 0 AND stratified off → new forensics needed.

### Symptom B — "waves still moving the wrong direction" ⚠️ PARTIALLY REAL, PARTIALLY MODEL DIVERGENCE
Four passes of data-side work (full lineage in §2). The decisive late findings:
1. The R_d-gated pass (`03a3d9d7`) **works where DIRPW is block-coherent** — served (20,-110) corrected
   45°→21° (ECMWF ref 18°), 10°N row at parity ≤8°.
2. `(20,-120)`-class cells (the user's water west of −115°): **NOAA's own DIRPW block field is nearly as
   self-canceling as the partitions** (proved twice: gate returned the partition answer byte-identically →
   R_d<0.35; full fusion barely moved it 257→255). open-meteo's *pinned-gfswave point* total says N, but
   the *block* statistics don't support it. ECMWF (best_match, TO≈341) simply disagrees with GFS here.
   **This is model divergence, not a pipeline bug** — our pipeline now faithfully represents GFS.
3. The **fusion (4th pass, `984c6745`) REGRESSED the globe** and is REVERTED on dev: global scan on the
   fusion product = mean 20.1°, 17 cells >60°, 7 >90° (vs 13.2°/11/4 for partition-only; DIRPW's
   total-H² weight ≈ all partitions combined, so its flip-noise polluted previously-good cells, e.g.
   4.7m Southern-Ocean swell dragged 65° off). Reverted `_fetch_common.py` + tests to the `03a3d9d7`
   gate. **The next scheduled forecast-ingest run rebuilds the field with the gate** (best measured
   state). No manual dispatch armed — let the cron do it, then verify (§4).

**Metrics table (global scan vs ECMWF best_match, 339 ocean cells):**
| pipeline pass | mean Δ | >60° | >90° |
|---|---|---|---|
| point-sample DIRPW (pre-vortex-fix) | 41.2° neighbor-delta era | — | many 180° flips |
| partition blend (`87a7d65a`) | **13.2°** | 11 (3.2%) | 4 |
| + R_d gate (`03a3d9d7`) | ~13° + high-coherence cells fixed | ~10 | ~3 |
| full fusion (`984c6745`) — REVERTED | 20.1° | 17 (5.0%) | 7 |

**What remains for Symptom B (fresh context):**
- The ~10 residual >60° cells are all multi-system cancellation zones where GFS's published fields
  (DIRPW peak + 3 partition peaks; GFS does NOT publish true spectral mean MWD) contain no stable
  block direction. Options, in order of preference:
  a) **Render-confidence treatment**: for blocks whose direction estimator is incoherent (export a
     per-cell confidence in the product, or compute R_p at encode), FADE the crest animation there
     (heatmap untouched) — show nothing confidently wrong. Pairs naturally with the land-aware fade.
  b) **Dominant-partition direction** for incoherent blocks (always a REAL system's direction, never a
     cancellation residual) — at (20,-120) that's the windwave (255°), i.e. honest GFS, still "wrong"
     vs ECMWF; consult the user.
  c) Product decision: swell-partition direction for the surf-facing Waves layer (user call, provenance
     implications).
- **The seam look at cell corners** (user sat at the 25°N/−115° 4-cell corner: NE vs SSE vs WSW cells
  side by side): honest 10° discretization under nearest-mode. The land-aware fade (A) softens it;
  U1-style continuous *direction* interpolation is impossible without reintroducing the vortex — the
  designed answer is fade + eventually a finer (5°?) coarse product (cost: ~4× ingest volume).

## 1. What is on dev and what is serving
- Committed tonight (this session): seam fade + U2 stratified reseed + U3 size floor (`0a656c34`),
  device tiering (`475829fe`), WebRTC dev-mock skip (`9c09b8c5`), fusion+fade (`984c6745`), then the
  **corrections**: seam floor default 0 + fusion revert (this commit).
- Serving backend product: fusion run's (run_time 2026-07-02T22:53) — the WORST direction state; it is
  replaced automatically by the next scheduled cron (gate version) — VERIFY headSha of the producing
  run ⊇ the revert commit before judging (queue gotcha: dispatches queued behind a scheduled run get
  cancelled; `gh run cancel` is now allowlisted in `.claude/settings.json` — proven working).
- Render re-pulls L2 every ≤30 min after a run's upload.

## 2. Three-month lineage (why every knob is where it is — do not regress these)
Chronology of the direction/density saga (memory files carry the detail):
- `4b5a45c4` (06-30) density-cliff → tileZoomMin regime; `386ab799` Natural anim defaults (trochoidal on).
- `4520300e`→`efd3624a` (07-01/02): vortex = coarse direction handling → suppress → **nearest-cell mode**
  (current, correct); `27b946e5` block-mean; `87a7d65a` partition blend; `1105f625` per-frame-reinit
  vortex root; **reference parity verified** (open-meteo N-Atl mean 45.9° vs ours 49.4°).
- 07-02 PM: `e4fa0d0c` tileZoomMin 3.0 + tuner LS migration; `da19437b`+`3b3a3690` density (+5% ×2,
  floor 0.128 + band bump 0.0076 z2.7–3.0); `bd43d84d` trochoidal sharp-face orientation fix;
  `d951bd0b` zoomed-out boundary 7.0 (`marineZoomThresholds.js` single source, truth echo
  `__MARINE_ZOOM_THRESHOLDS__`); `5e9564ea` backend suite offline-green; `991bd372` LCP head;
  `e925eb5e` deck.gl removal + 154-commit release to main (NOT live — netlify pinned).
- 07-02 night: `03a3d9d7` R_d gate; `475829fe` deviceTier; `9c09b8c5` WebRTC; `0a656c34` seam cull
  (regression) + U2/U3; `984c6745` fusion (regression) + fade; tonight's corrections.

## 3. Verification toolkit (scratchpad patterns — recreate from these names/descriptions)
- `global_dir_scan.js`: all ocean coarse cells vs open-meteo best_match totals (bulk API, 90 coords/req,
  ~0.8s spacing). THE quality metric. Pass bar after the gate rebuild: mean ≈13°, ≤4 cells >90°.
- `baja_dir_forensic.js`: the 8 Baja-region cells + reference points.
- `block_energy_mean_check.js`: honest 3×3 partition energy-mean over any 10° block.
- Model-pinned discriminator: `marine-api.open-meteo.com/v1/marine?...&models=ncep_gfswave025` — same
  upstream as our fetcher; separates model-divergence from pipeline bugs. Heights matching to the cm
  = same cycle confirmation.
- Live telemetry: `__RAW_GPU__.anim` (dirCoherenceMin/mode/stratifiedReseed/farzoomSizeFloor),
  `__CREST_DIAG__` (particleRes! 296 desktop vs 192 handheld), `__MARINE_ZOOM_THRESHOLDS__`,
  `__MARINE_ZOOMSTATE_REINITS__`, `__MARINE_SHARPEN_DIAG__`, `__MARINE_PIPELINE_TRUTH__.lastEvents`.

## 4. Fresh-context TODO (priority order)
1. **Wait/verify the gate rebuild**: next scheduled forecast-ingest (check producing run's headSha ⊇
   the fusion-revert commit) → re-run global scan (expect ≈13.2°/11/4) → user re-checks Baja
   (east-of-−115 water should read NNE; west of it stays GFS-honest WSW pending the confidence work).
2. **Land-aware coherence** (encoder direction-dilation, §0A) → re-enable seam fade default 0.7 →
   user seam check at the Baja 4-cell corner.
3. **Confidence-faded crests** for incoherent-direction blocks (§0B-a) — kills the last "confidently
   wrong direction" cells honestly.
4. User A/B of U2 if any patchiness remains (`__RAW_STRATIFIED_RESEED__=0`).
5. Netlify production unlock (user dashboard) — three releases stacked; after unlock verify bundle
   markers (`__MARINE_ZOOM_THRESHOLDS__` in MapPage chunk) before any visual judgment.
6. Parked: LCP bundle attribution (CRA sourcemap column-Infinity blocker), NW-Pacific (30,150)-class
   cells (same confidence treatment), stranded-pending organic repro, codebase-memory BM25 mode broken.

## 5. Landmine sheet (traps that burned time tonight — check FIRST)
- **Wedged preview tab**: repeated programmatic nav/reload/toggle churn leaves the map page in a state
  where the marine engine never initializes (engine-empty forever, ZERO console errors, console lines
  ×N from WeatherTelemetry wrapper stacking, `__MARINE_TRANSITIONING__` stuck true). A clean single
  reload on a fresh tab boots in ~10–25s. **Bisect only on clean loads** — this mimicked a shader
  regression convincingly tonight.
- **Mid-boot Waves click double-toggles** (wait for `__MARINE_BOOT_DIAG__`, check its activeLayers
  before clicking).
- **Narrow window ≠ mobile pool anymore** (`deviceTier.js`), but ALWAYS check `__CREST_DIAG__.particleRes`
  before judging density (192 vs 296 halves everything).
- **public/index.html edits need a dev-server RESTART** (template compiled at startup).
- **npm build script** uses bash-style env inline — on Windows run `npx craco build` with `$env:`.
- Producing-run attribution: check the run's headSha that MADE the served product (`run_time` ↔ run
  timeline), not the latest commit.
