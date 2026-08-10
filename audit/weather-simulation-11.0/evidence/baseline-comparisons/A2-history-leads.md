# A2 — History Forensics Leads (Agent A, commit half)

Read-only audit. Every claim below is backed by a git command whose output I ran in this session.
Repo `C:/Users/dprit/Raw-Surf`, branch `dev`.

> **⚠️ HEAD MOVED SINCE THE BRIEF WAS WRITTEN.** The brief states HEAD `3d3ccdc2`. Actual
> `git rev-parse HEAD` at audit time = **`9f4f85708e765741d51ac2812de5a36373ac514b`**
> (`9f4f8570`, 2026-08-09, `docs(handoff): the tide A/B produced its first TRUSTWORTHY verdict…`),
> a docs-only commit that landed on top of `3d3ccdc2`. Working tree clean.
> The ledger's `seq 1` is therefore `9f4f8570`, and `3d3ccdc2` is `seq 2`. The 100-commit window
> is `9f4f8570` … `6b34fef7` inclusive.

---

## Lead 1 — Do `b5bbaa7d` and `f5f6a3d` exist? Are they "known-good baselines"?

**Both EXIST. CONFIRMED.**

```
$ git cat-file -t b5bbaa7d   -> commit
$ git rev-parse b5bbaa7d     -> b5bbaa7d275027d55c2e8eca7c769a4c7e33fc4e
$ git cat-file -t f5f6a3d    -> commit
$ git rev-parse f5f6a3d      -> f5f6a3d1146631530e78d5e91d53e1837269138e
```

`f5f6a3d` resolves as an unambiguous **7-char prefix** of `f5f6a3d1146631530e78d5e91d53e1837269138e`
(no other object shares it — `rev-parse` did not error with `ambiguous argument`).

### `b5bbaa7d` — 2026-05-27, dpritzker0905-cmd
**Subject:** `v3.13.7: World-wrap seam fix — 3-copy rendering + stripe reduction`
**Changed:** `frontend/src/components/map/WebGLMarineEngine.js` only — **1 file, +17 / −5**.

What it did (from its own body):
- Root cause recorded: the marine engine drew particles **once with no world-copy offset**, while
  the wind engine drew 3 copies at `[-360, 0, +360]`. At the antimeridian the single-copy marine
  particles appeared on one side only → a visible seam split.
- Fix 1: added a `u_lng_offset` uniform to `DRAW_VS`, matching the wind engine.
- Fix 2: draw loop renders 3 world copies at zoom < 3.5 (`worldOffsets = [0.0, -360.0, 360.0]`).
- Fix 3: **removed** the `wrappedLng` normalization that forced all particles into a single
  `[-180,180] → [0,1]` x range.
- Rider: particle rotation jitter widened ±30° → ±45° to break horizontal stripe artifacts.

### `f5f6a3d` — 2026-05-26, dpritzker0905-cmd
**Subject:** `fix: correct wind/wave zoom advection containment cache bug and remove redundant setInterval tile polling`
**Changed:** 2 files, +17 / −16 —
`frontend/src/components/map/marineController.js` (+20/−4),
`frontend/src/components/map/useOpenMeteoTileUrls.js` (+13/−1... net −12).
**Empty commit body** (no rationale recorded beyond the subject).

### Are they plausibly "known-good baselines"? — **CONTRADICTED as stated.**

Neither commit is marked, tagged, or described anywhere as a baseline. Concretely:

1. **Neither is tagged.** `git tag --points-at` yields nothing for either (no tags exist on them).
2. **They are 2.5 months upstream of HEAD** (2026-05-26/27 vs 2026-08-09) and predate essentially
   the entire current forecast chain: `surf_point.resolve_surf_geometry`, `surf_rating.py`,
   `science_registry.py`, the shore-normal asset, `manifest_view.py`, and the whole
   `MASTER-AUDIT-{4..11}` arc all postdate them.
3. **`b5bbaa7d` is itself a bug-fix on a renderer that has been rewritten since** — the file it
   touches, `WebGLMarineEngine.js`, is 3,204 lines at HEAD and was refactored at `dbeb8456`
   (2026-07-29, "lift the marine engine's pure decision layer out, 3845 → 3207").
4. **They are single-concern render/cache fixes, not stable points.** `f5f6a3d` has *no commit body
   at all*, so there is no recorded verification behind it.

**Verdict:** they are real commits with real, specific content. Calling either a *known-good
baseline* for the weather simulation is an unsupported claim — there is no artifact in this repo
that designates them as such. If a comparison against them is wanted, it must be justified on the
specific behavior being compared (world-wrap draw copies for `b5bbaa7d`; the advection containment
cache + tile polling for `f5f6a3d`), not on a general "good state" premise.

---

## Lead 2 — When was a "Field Composition Engine" introduced? Does the name exist today?

**CONFIRMED: introduced `b5fad579`, 2026-05-27. The name EXISTS in code at HEAD.**

```
$ git log --diff-filter=A -- frontend/src/engine/FieldCompositionEngine.js
b5fad579 2026-05-27 FCE Phase 1-3: Physics simulation engine activation
```
`b5fad579` is a 17-file, +2,507/−1,222 commit that also added `SimulationLoop.js` (339 lines),
`useRenderPlanBridge.js`, `useSimulationField.js`, and touched `engine-bootstrap.js`.

**In the tree at HEAD:**
- `frontend/src/engine/FieldCompositionEngine.js:2` — `* FieldCompositionEngine.js — The FCE Core` (250 LOC)
- `frontend/src/engine/SimulationLoop.js:25` — `import { composeRenderPlan } from './FieldCompositionEngine';`
- `frontend/src/components/map/MapWebGL.js:294` — `// FCE: Field Composition Engine — Single Source of Truth`
- `frontend/src/components/map/TruthOverlayGpuTab.js:93` — UI label `Field Composition Engine (FCE)`
- `frontend/system-brain/audit_report.md:115` — prose claim about "1,681 live vectors … via the FCE"

**Reachability chain at HEAD (measured by import grep, not assumed):**
`engine-bootstrap.js` → `SimulationLoop.startSimulation/stopSimulation` → `composeRenderPlan`
(FieldCompositionEngine) and `ParticleSystem` (particle-system.js);
`RenderPlanDispatcher.js:22` and `SimulationHealthMonitor.js:20` both `import { onRenderPlan } from './SimulationLoop'`.
So the FCE is **imported and reachable**, not dead code.

**⚠️ But the "Single Source of Truth" comment is contradicted by the repo's own current audit.**
`MASTER_WEATHER_SIMULATION_REPORT_11.0.md:244` records invariant 14 ("No bypass around the Field
Composition Engine") as **Superseded**: *"the direct React→engine path is declared authoritative;
FCE composes diagnostics at 4 Hz; its upload gates are fail-closed with zero production setters"*,
and line 779 flags *"three stale 'single source of truth' comments"* as needing correction.
So: **name present, module reachable, but its documented authority is stale — the live
composition choke is `decideMarineCommit`, not the FCE.** (Classification: CONFIRMED for
existence/reachability; the authority claim is STALE per the repo's own report — I did not
independently re-execute that measurement.)

Earlier history touching the string (`git log --all -S "Field Composition Engine"`):
`b5fad579` (add) → `538a0f63` → `bcccceb3` → `bb48b233` → `f7b6a7aa` → `55c6a671` → `d43eedc1`
→ `512b1cb6` (2026-08-09, the Report 11.0 doc).

---

## Lead 3 — RK4 particle integration: present? where? when introduced?

**CONFIRMED: present and reachable. Introduced `42435c41`, 2026-05-17.**

```
$ git show -s --format="%H %ad %s" --date=short 42435c41
42435c41648328850c9f159310f3f5ac2b4f89db 2026-05-17
feat: GPU Engine Architecture v2 — RK4 particles, fixed timestep, texture pooling, tile streaming
```

The *file* that carries it, `frontend/src/engine/particle-system.js`, was added one day earlier at
`e3b980c4` (2026-05-16, "Integration wiring + engine expansion pack (v3.10.0)"); `42435c41` is the
commit whose subject introduces RK4 as an architecture.

**At HEAD (302 LOC):**
- `frontend/src/engine/particle-system.js:5` — `*   - RK4 particle advection (4th-order Runge-Kutta)`
- `frontend/src/engine/particle-system.js:110` — `* 4th-order Runge-Kutta integration for particle advection.`
- `frontend/src/engine-brain/wind-advection-model.js:87` — a second Runge-Kutta implementation
  (`* Runge-Kutta 4th order advection (higher accuracy for longer timesteps)`) — **a second copy of
  the same idea in a different module tree (`engine-brain/` vs `engine/`).**

**Consumers (import grep):**
- `frontend/src/engine/FieldEvolutionEngine.js:23` — `import { rk4Advect, sampleField } from './particle-system';`
- `frontend/src/engine/SimulationLoop.js:23` — `import { ParticleSystem, TRAIL_LENGTH } from './particle-system';`

**⚠️ Not the same thing as the GPU particle advection.** The WebGL engines advect particles in
shaders (`WebGLMarineEngine.js` / `WebGLWindEngine.js`) — `HANDOFF_REPORT.md:95` describes
`WebGLMarineEngine.js` as "GPU framebuffers for particle RK4 advection". So there are at minimum
**two RK4-labelled advection paths** (CPU `particle-system.js` under SimulationLoop, and the GL
draw path), plus the `engine-brain` copy. **BLOCKED:** I did not verify whether the GL shader
integrator is genuinely RK4 or whether that is a doc claim — verifying it requires reading the
shader source and is Agent B's surface.

---

## Lead 4 — OceanMask: introduced when, current authority?

**CONFIRMED: introduced `74fa33ef`, 2026-05-18.**

```
$ git log --diff-filter=A -- frontend/src/components/map/OceanMask.js
74fa33ef 2026-05-18 v83: Add OceanMask coastline clipping for marine layers,
                    reduce raster-fade-duration to 0ms for instant tile swaps
```

**Current state at HEAD:** present, **905 LOC**, and its size is *baselined* in the LOC ratchet —
`.github/loc-baseline.json:16` carries `"frontend/src/components/map/OceanMask.js": 905`, i.e. it is
a **grandfathered shrink-only** file over the 800-line ceiling.

**Authority (measured by import grep):** exactly **one** production importer —
`frontend/src/components/map/MapWebGL.js:12` — `import { OceanMask } from './OceanMask';`
plus one test importer (`OceanMask.bufferColor.test.js:9`, `resolveBufferColor`).
So it is a MapWebGL-owned render component: coastline clipping / land-mask layer insertion into
MapLibre. It is **not** part of the backend forecast chain.

**⚠️ Do not confuse it with the backend's ocean masking.** A separate, unrelated `ocean_mask`
concept lives in the Python pipeline — `backend/services/weather_pipeline/bathymetry.py:214-221`
(`ocean_mask = sub > 0`, used to derive a land/ocean centroid offset) and the
`"bilinear_ocean_masked"` interpolation method emitted by `sampler.py:333` /
`point_resolution.py:411`. Different subsystem, different authority, same word.

**Open debt carried in-repo (not re-verified by me — these are prior-audit records, classified
STALE-unless-rechecked):** `ANTIGRAVITY_AUDIT_FINDINGS_2026-06-23.md:19` records a regression where
the recolor fast path called `setPaintProperty(MASK_BUFFER, 'fill-color', …)` on a **line** layer
(silently swallowed by try/catch); `ANTIGRAVITY_AUDIT_FINDINGS_2026-06-23_v2.md:17` records it as
**corrected** to `'line-color'` at `49dc3fd6`. The hide-vs-remove churn item
(`.agents/CLAUDE_CODE_HANDOFF.md:387`) is still listed as open.

**No commit in the latest 100 touches `OceanMask.js`.**

---

## Lead 5 — When did legacy + replacement renderers begin coexisting?

**CONFIRMED. All five named modules EXIST AT HEAD SIMULTANEOUSLY, and four of the five are
imported by the same file (`MapWebGL.js`).**

`git log --diff-filter=A` per file (first appearance):

| module | introduced | commit | LOC @HEAD | imported at HEAD by |
|---|---|---|---|---|
| `map/MapWebGL.js` | 2026-05-10 | `cde0ab28` Finalize MapWebGL upgrade | 1,097 | `components/MapPage.js:3` |
| `map/WeatherEngine.js` | 2026-05-14 | `41bc83b8` decouple weather fetches from map lifecycle | 1,116 | `MapWebGL.js:13` (`useWeatherEngine`) |
| `map/GPUMarineLayer.js` | **2026-05-15** | `e92aca76` **v3.1: Visual separation — split wind/marine into independent render systems** | 573 | `MapWebGL.js:7` (`MarineParticleCanvas`) |
| `map/WebGLWindEngine.js` + `WebGLWindLayer.js` | 2026-05-16 | `0105a9d7` v3.8: WebGL particle engine | 1,093 / — | `MapWebGL.js:10` |
| `map/WebGLMarineEngine.js` + `WebGLMarineLayer.js` | **2026-05-20** | `8dd9abe3` **reactivate high-performance WebGL wind and marine wave crest layers** | 3,204 / 1,221 | `MapWebGL.js:11` |
| `engine/FieldCompositionEngine.js` + `SimulationLoop.js` | 2026-05-27 | `b5fad579` FCE Phase 1-3 | 250 / 391 | `SimulationLoop.js:25`, `engine-bootstrap.js:30` |

**`git log --diff-filter=D` for `GPUMarineLayer.js` and `WeatherEngine.js` returns NOTHING — neither
was ever deleted.**

**Answer:** coexistence began in a **10-day window, 2026-05-10 → 2026-05-20**:
- **2026-05-15 (`e92aca76`)** is when a *second* marine render system first stood beside the
  existing `MapWebGL` + `WeatherEngine` pair ("split wind/marine into independent render systems").
- **2026-05-20 (`8dd9abe3`)** is the decisive date for the *legacy-vs-replacement marine* pair:
  `WebGLMarineEngine`/`WebGLMarineLayer` landed **while `GPUMarineLayer.js` remained in the tree and
  imported**. That pair has now coexisted for **81 days** and both are still wired into `MapWebGL.js`
  today (lines 7 and 11).
- **2026-05-27 (`b5fad579`)** adds a *third* composition tier (FCE/SimulationLoop) whose declared
  "single source of truth" authority the repo's own Report 11.0 now marks Superseded (see Lead 2).

**⚠️ The consequence I did NOT measure:** whether `MarineParticleCanvas` (GPUMarineLayer) actually
renders at runtime alongside `WebGLMarineLayer`, or is gated off. That is a runtime question and
belongs to Agent B — the import is present, but presence of an import is not proof of an active
draw path. Classified **HYPOTHESIS** for "two marine renderers draw concurrently";
**CONFIRMED** for "two marine render modules coexist and are both imported by MapWebGL".

---

## Lead 6 — Commits (in the latest 100) that changed coordinate / projection / time / unit handling

**Units — the largest cluster, and one of them moved a displayed number:**

| commit | seq | what changed | evidence |
|---|---|---|---|
| `5e920a5d` | 39 | **`forecastHelpers.mToFt` used a drifted local `3.281` instead of canonical `M_TO_FT = 3.28084`** (+0.0049%, ~1 in 20,500). Now imports the shared constant; the card compiler stops receiving an injected converter and imports `formatHeightFromMeters`; `heightUnit` threaded into `compileForecastCards` and `spotGlyphAriaLabel`. | `forecastHelpers.js` `export var mToFt = (m) => m != null ? (m * M_TO_FT).toFixed(1) : null;` |
| `4a36ede7` | 64 | rain legend label `'Rain / Snow (in/h)'` → `'(mm/h)'` — the stops were always mm; the label was a 25.4× misread. | `MapWeatherControls.js:181-184` |
| `668548be` | 21 | **Radar three-way unit mismatch PINNED, NOT FIXED**: raster is RainViewer scheme-7 dBZ; legend label says dBZ; legend stops `['0','.1','.3','.5','2+']` are rain-rate shaped; infobox prints model `mm/h`. Author refused to invent dBZ thresholds. | `radarLegendUnits.proof.test.js` |
| `6568d94b` | 46 | wind legend derived from the shipped `DARK_WIND_RAMP` (13 Beaufort stops → 75 kn) instead of a byte-exact copy of the retired 8-stop 0–50 kn ramp. Calm read as hurricane. | `WindColorRamp.windLegendGradientCSS/windLegendStops` |
| `ae0c03d5` | 82 | knots↔m/s constant **spelling** removed from a docstring (the parity guard reads docstrings, not `#` comments). | `grid_resolver_surf.py` `_make_nearest_sampler` docstring |
| `11fcebdf` | 49 | wind residual kept **knots end-to-end** (`point.speed` passed unconverted to `compare_wind_to_model`); recorded trap = a stray m/s conversion. | `buoy_calibration.calibrate_spots` |
| `b5afda92` | 93 | energy↔height dimension: `SHELF_KF_FLOOR = 0.316 = sqrt(1−0.90)`; primary source says **93%** ⇒ `sqrt(0.07)=0.265`. Value **unchanged**; the discrepancy is now registered. | `surf_transform.py` + `science_registry.py` |
| `da130c41` | 23 | `_height_exposure_factor` gains `sqrt(exposure)` behind `SURF_EXPOSURE_RECONCILED` so `height² == exposure` is an identity. **Ships OFF.** | `surf_transform.py:367-375` |

**Time / forecast-axis:**

| commit | seq | what changed |
|---|---|---|
| `8b20f2c3` | 31 | Extracted 8 bare cross-fall cutover literals (120/168/228/240) into `modelHorizons.js`. Values unchanged. Records that ICON's `216` is a **tail length, not an hour** (`120+216=336`). |
| `a71b45d3` | 29 | Two inline copies of the nearest-index search removed from `useOpenMeteoTileUrls.js` → `closestAxisIndex`; adds `isBeyondAxis` / `axisHorizonHours`. Proves the axis **saturates**: hour 300 on a 168 h axis returns index 168. |
| `f0c29ebb` | 27 | `describeStaleHour` renders the saturation to the user; **refuses** on bootstrap placeholder axes (gated on `LIVE_FETCHED_MODELS`). |
| `363f1cd2` | 34 | `describeLayerSubstitution` reads the *rendered slot URL* rather than any of four independently drifted horizon copies. |
| `3eeda053` | 83 | Point-resolver selection key `(time_diff, area)` → `(time_diff, resolution, area)`. **Time stays primary.** Kill `POINT_RES_TIEBREAK=0`. |
| `7312412b` | 71 | `run_time` / `upstream_provider` / `source_dataset` / `estimate_basis` restored to every `grid_series` frame + a `run_census` (`mixed_runs`) — adjacent scrubber hours could silently mix model runs. |
| `5e181f69` | 90 | `merge_pending` cap evicted the **furthest-future** targets — `out[-max_entries:]` after an ascending sort — so every row was evicted as its target hour arrived. Now keep-earliest; cap 10,000→30,000. |
| `926d6b22` | 69 | `/admin/system/api-metrics` window disclosed as `cumulative_since` with `requested_hours_ignored: true`. |

**Coordinate / projection / geometry:**

| commit | seq | what changed |
|---|---|---|
| `7dea8ff7` | 86 | `_make_nearest_sampler` numpy argmin; **antimeridian wrap preserved** (`dlng = np.where(dlng > 180, 360 - dlng, dlng)`), ties keep the first minimum (matching the old strict `<` scan). Differential-tested vs a verbatim copy of the old closure. |
| `4d82a13c` | 80 | New `land_present` asset section `[lat, lng, shoreline_km, break_depth|null]`; `land_present_at()` matches within `MATCH_RADIUS_KM` via haversine; promotes `coastal` only — `shore_normal_src` stays `'none'`. Kill `SURF_COASTAL_FROM_LAND_BIT=0`. |
| `5bb49478` | 81 | Four new 0.25° region bounding boxes (`west/south/east/north`), deliberately edge-abutting at 31.0 N, 37.5 N, −6.0 E. |
| `e8f04cc1` | 33 | **Leaflet `{lat,lng}` vs API `{latitude,longitude}`** — the land-override call site sent the wrong keys → permanent 422. `spotMovePayload` accepts either; uses `??` so 0.0 latitude is not read as absent. |
| `47d249bb` | 70 | `parseWindGrid`/`parseMarineGrid` now bounds-check `offset + rows*cols` against array length — an out-of-bounds read coerced `undefined → 0` and parsed a truncated array into a flat-calm grid. |
| `fa0ec8b1` | 38 | Corrects the record on the reference **population** geometry: the grid lane's reference is a fixed 2.0° lattice cell, the spot lane's is one spot (1.484 m vs 2.164 m at Pipeline) — zoom-invariant, and **refuted as the cause of E#1 by sign**. |
| `b20dba2a` | 3 | Pins that the nearshore decay (`landCount 1→0.65, 2→0.45, 3+→0.35`) exists in **one lane only** — up to 2.86× on the displayed height depending on which lane answered. **Not fixed.** |

---

## Lead 7 — Bugs fixed and later REINTRODUCED (revert / re-fix pairs)

**CONFIRMED — four genuine reintroductions, all inside the audited window:**

### 7a. The Promise-as-geojson ALL-WATER world mask — fixed 2026-07-16, reintroduced, re-fixed `843f6e59` (seq 73)
`git log -S "bridgeToCoarseGlobalIfHeld"` shows the class was fixed at the *bridge* call site during
the 2026-07-16 zoom-out arc (`8625841b` "…all-water-mask root…", `ef0389f7` "attribution correction —
… the poisoned result was the root"). `843f6e59`'s own diff says a **third call site** passed
`getSharedLandGeoJSON()` — a Promise even on cache hit — as `setWaveData`'s geojson:
```
- engine.setWaveData(gl, _wg, getSharedLandGeoJSON());
+ engine.setWaveData(gl, _wg, null);
```
The re-fix is **structural**, not local: `export function asLandGeoJSON(x) { return (x && Array.isArray(x.features)) ? x : null; }`
is now applied inside `setWaveData`, so a fourth call site cannot reintroduce it.

### 7b. Truncation hiding a red verdict — fixed in CI at `822a0785` (seq 55), recommitted by hand the same day, re-fixed at `f9066b8d` (seq 26)
`822a0785` fixed `tail -40` cutting the failing exemplar out of the calibration-census log
(`echo "── the lines the tail can cut ──"; grep -E "OUT OF RANGE|^ORDERING|^BOUNDS |^VERDICT" gonogo.txt`).
`f9066b8d`'s body: *"I ran `loc_ratchet.py 2>&1 | tail -2` and read the `====` separator as success…
That is the EXACT defect I fixed in the calibration census this morning… I fixed it in the workflow
and then committed it against myself four hours later, by hand, on the same day."*
Same class (`8dc9ef20`, seq 99, is a third instance: the `::error::` block was unreachable because
`set -o pipefail` aborted the step before the `if`).

### 7c. An unregistered science switch — `4d82a13c` (seq 80) → fixed `5ee77bcd` (seq 78); repeated at `da130c41` (seq 23) → fixed `588cc850` (seq 8)
The flag-lane-parity guard went red twice in one day for the same omission.
`588cc850`'s body enumerates the damage by SHA: **13 failures across 7 consecutive commits**
(`2067a799, a3b21c71, d0ea7f4d, 20ffd7bb, 2c314ad6, 79d0c322, fd152d6a`), all the same job
(`backend-sim-composition-guards`), all the same assertion. Then `a1971972` (seq 6) had to *correct
the correction*: `588cc850` described `0.55+0.45*exposure` as the **quality** curve when it is the
**height** curve (`surf_transform._height_exposure_factor`). Historic precedent for the class:
`62691c88` (2026-08-01) "nine science switches were undeclared".

### 7d. The stale `"p80 good-day"` description — corrected three separate times
`e3aedb06` (2026-07-30) moved `REF_PERCENTILE 0.80 → 0.50`. Three independent comments kept the old
wording and were corrected in three different commits in this window:
- `46e029f4` (seq 98) — `surf_rating.oversize_thresholds` block comment;
- `822a0785` (seq 55) — `local_size_preview.SANITY_EXEMPLARS` bounds, frozen at
  `SANITY_EXEMPLARS_AUTHORED_PCTL = 0.80` rather than widened;
- `1e37b003` (seq 92) — *"Also corrected the THIRD stale 'p80 good-day' description
  (surf_rating's local-size curve comment)"*.

### Near-misses / adjacent (recorded, weaker class)
- **`2e20122d` (seq 66)** — `disposeEngine` used raw `gl.deleteTexture`, bypassing the one accounting
  choke `safeDeleteTexture`, *"the ONE accounting choke whose own header documents this exact drift
  recurring 'because the fix was applied where the bug was, not where the invariant belongs'."*
- **`13b772bf` (seq 65)** — the one-shot `window.innerWidth < 768` pool sizing was live-caught for
  **marine** on 2026-07-02 and `deviceTier.js` was built to kill it; **`WebGLWindLayer` still had the
  original bug** until this commit. Not a reintroduction — an unmirrored fix.

### Same-session self-retractions (not reintroductions, but retract/re-fix pairs)
- `2067a799` (seq 19, ray cast built, 8/8 controls) → **`a3b21c71` (seq 18) REFUTES it** — the ray
  measures the spot's own shoreline, redundant with the cosine. **Not wired.**
- `20ffd7bb` (seq 16) → **`79d0c322` (seq 14) RETRACTS** the `SURF_TIDE_DEPTH` "0.2%, safe to flip"
  result — the replay never supplied `water_level_m`, so the flag could not act →
  `0f944c83` (seq 12) makes it answerable: **0.00 → 38.10 points**.
- `df7a3d73` (seq 42) asserted the reference-gap explanation for E#1 → **`fa0ec8b1` (seq 38) retracts
  it: the SIGN refutes it** (a larger reference scores *lower*: 33.5 at ref 1.481 vs 21.9 at 2.164,
  so the gap predicts the band reading LOW; the band reads 2.3–2.7× HIGH).

### ⚠️ One mis-citation found
`8301b78e` (seq 60) subject: *"shrink the two ratchet regressions from `086ee773`"*. Its own body and
diff attribute the regressions to the **R11-09 port** (`13b772bf`, `WebGLWindEngine.js` 1,095→1,111)
and the **rain-label fix** (`4a36ede7`, `MapWeatherControls.js` 957→960). `086ee773` touched only
`backend/scripts/sim_health_probe.py` and cannot have grown either frontend file. **The SHA in the
subject is wrong.**

---

## Lead 8 — Tile scrubbing "36 operations reduced"

**NOT FOUND.** No such claim exists in this repository's tree or history.

Searches run (all returned zero relevant hits):
```
git grep -n -i -- "36 operations"                        -> (nothing)
git grep -rn -i -- "operations reduced"                  -> (nothing)
git log --all -i --grep="36 operation"  --oneline        -> (nothing)
git log --all -i --grep="reduced 36"    --oneline        -> (nothing)
git log --all -i --grep="operations reduced" --oneline   -> (nothing)
git log --all -S "36 operations" --oneline               -> (nothing)
git grep -nE "\b36\b *(->|→|to) *[0-9]|[0-9]+ *(->|→) *36\b" -- "*.md" "*.js" "*.py" "*.yml"  -> (nothing)
```
A regex sweep for `36` within 60 chars of `operation(s)/op(s)` across the whole tree returned exactly
one, unrelated match:
`frontend/src/components/map/marineGridSeries.retry.test.js:150` — *"user live wedge: misses 36→52
under the clamp backstop"* — that is a **miss count under a retry clamp**, not a tile-operation
reduction.

I also enumerated every scrub-related commit subject in the entire history
(`git log --all --format=… | grep -iE "scrub"`, 40 results, 2026-06-26 → 2026-08-02). The real
scrub-reduction commits are:
- `cb074b8b` (2026-07-09) `perf(scrub): decimate drag commits to ~11Hz` — the manual-drag jank root;
- `63765848` (2026-07-08) `perf(map): stop spot-ratings churning on every scrub step with the overlay off`;
- `32e7035e` (2026-07-08) `perf(map): memoize static <Map> children so scrub skips their react-map-gl reconcile`;
- `5355e65e` (2026-07-21) `perf(marine): stop marineWindData churning every scrub tick — depend on the effective hour, not the raw slider`;
- `f5f6a3d`  (2026-05-26) `…remove redundant setInterval tile polling` ← the closest tile-operation reduction, and it records **no numbers at all** (empty commit body).

**Conclusion:** "36 operations reduced" does not originate from this repo. **Do not carry it forward
as a measured figure.** If a source produced it, that source needs to be named before the number is
used — the repo's own record for the nearest candidate (`f5f6a3d`) contains no measurement.

---

## Classification summary for this document

| lead | classification |
|---|---|
| 1 both SHAs exist | **CONFIRMED** |
| 1 "known-good baselines" | **CONTRADICTED** (no tag, no designation, 2.5 months pre-chain) |
| 2 FCE introduced `b5fad579` 2026-05-27, name present, reachable | **CONFIRMED** |
| 2 FCE "single source of truth" authority | **STALE** (per Report 11.0 §244/§779; not re-executed by me) |
| 3 RK4 present, introduced `42435c41` 2026-05-17 | **CONFIRMED** |
| 3 GL shader path is genuinely RK4 | **BLOCKED** — needs shader read (Agent B) |
| 4 OceanMask introduced `74fa33ef` 2026-05-18, one prod importer, 905 LOC grandfathered | **CONFIRMED** |
| 5 five renderer modules coexist at HEAD; marine pair since 2026-05-20 | **CONFIRMED** |
| 5 both marine renderers draw concurrently at runtime | **HYPOTHESIS** — import ≠ draw path |
| 6 coordinate/projection/time/unit commits | **CONFIRMED** (all cited file-level) |
| 7 four reintroduction chains + one wrong SHA in a subject | **CONFIRMED** |
| 8 "36 operations reduced" | **NOT REPRODUCIBLE / NOT FOUND** |

## What I could not verify (BLOCKED)

1. **Whether `GPUMarineLayer.MarineParticleCanvas` actually paints at HEAD.** I proved the import
   exists (`MapWebGL.js:7`); proving the draw happens needs a running frontend + GL context.
2. **Whether the GL particle integrator is RK4.** Doc claims say so; I did not read the shader.
3. **Runtime behaviour of anything in Lead 6/7.** Every claim above is a code fact read from a diff.
   Where the commit body reports a measurement (e.g. "band over-reads glyph 2.3–2.7×"), that is the
   author's measurement, quoted as such — I did not re-run it.
4. **The three stale "single source of truth" comments.** Report 11.0 says they exist; I confirmed
   one of them (`MapWebGL.js:294`) and did not enumerate the other two.
