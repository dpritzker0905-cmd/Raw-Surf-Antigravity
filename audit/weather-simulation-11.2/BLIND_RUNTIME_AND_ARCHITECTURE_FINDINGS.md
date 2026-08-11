# BLIND RUNTIME AND ARCHITECTURE FINDINGS — Weather Simulation 11.2

**STATUS: LOCKED.** Written before reading Report 11.0, Report 11.1, the Codex audit, project
memory, brain files, handoffs, or any commit message since the 11.1 baseline. Conclusions below
must not be silently rewritten after historical reconciliation; corrections go in
`BLIND_FINDINGS_RECONCILIATION.md`.

| Field | Value |
|---|---|
| Blind pass start | 2026-08-10T23:00:01-04:00 |
| Blind pass lock | 2026-08-10T23:41-04:00 |
| Commit | `e015d90b06bc45189a1c7407854762a1b8c79a63` |
| Branch | `dev` |
| Working tree | clean (0 modified, 0 untracked) |
| App under test | `http://localhost:3007/map` (CRA dev build, craco) |
| Backend under test | `http://127.0.0.1:8000`, health `2.0.0-stage-6f-v1-e015d90b` (**same commit**), `environment: local` |
| Browser | Chromium (in-app Browser pane), viewport 961x910 CSS px |
| Machine | i7-11800H, 63.7 GB RAM, NVIDIA RTX 3060 Laptop + Intel UHD |
| Node / Python | v24.14.1 / 3.14.4 |

---

## 0. BLINDNESS DISCLOSURE (read this before trusting the word "blind")

This pass was **not hermetically blind**, and saying otherwise would be false:

1. **`CLAUDE.md` and the memory router `MEMORY.md` were auto-loaded into my context by the
   harness before the first instruction was read.** Both contain prior conclusions — including
   named defect classes, a "ONE FORECAST COMPOSITION" mandate, a note that `provider:"open-meteo"`
   is a dispatch key, and a claim that a global `grid_series` costs ~170 MB RSS. I could not
   decline that input.
2. **Mitigation applied:** every finding below was reached from a *runtime measurement or a
   source line I read during this pass*, and each carries its own evidence. Where a prior belief
   from the auto-loaded context matched, I re-derived it independently rather than citing it.
3. **Honest residual risk:** F-04 (provider vocabulary) and F-08 (global-extent fetch) are the two
   findings where prior context most plausibly steered my attention. Both are backed by
   first-hand measurement taken this session.
4. I did **not** open `MASTER_WEATHER_SIMULATION_REPORT_11.0.md`, the 11.1 report, the Codex
   audit, any handoff, or any `audit/weather-simulation-11.{0,1}` artifact during this pass.

---

## 1. WHAT THE FEATURE DOES (observed, not documented)

`/map` is behind `ProtectedRoute`; it renders a MapLibre GL map with a WEATHER panel offering
**3 models** (GFS default, EURO, ICON) and **12 layers** (Precip, Radar, Satellite, Wind, Waves,
Swell, Swell 2, Wind Waves, Fog, Pressure, Air Temp, Water Temp), a wave-height unit toggle
(ft/m), a Surf Rating overlay toggle, a legend, and a timeline scrubber (-1d/-1h/Now/+1h/+1d,
play, "Live"). Two diagnostic panels ship in this build: a **DIAGNOSTICS HUD** and a **Marine
Anim Tuner** with 10 live sliders and a "Copy for Claude" button.

The app exposes **68 diagnostic globals** (`__MARINE_*`, `__WEBGL_MARINE_*`,
`__WEATHER_*`, `__MAP_*`). This is a genuine asset and I used it heavily.

---

## 2. FINDINGS

Severity is mine, assigned blind. IDs are `BF-nn`.

### BF-01 — CRITICAL — A fixed coordinate's forecast value changes with which product the client selected, and product selection is driven by zoom/interaction history

**Measured, backend-authoritative** (`/api/weather/grid`, local backend, identical
`model=GFS&domain=marine&layer=waves&valid_time=2026-08-11T03:00:00.000Z`):

| Requested bbox | product_id | resolution | grid | nearest sample to (26.000,-78.000) | distance | period | direction |
|---|---|---|---|---|---|---|---|
| `-180,-80,180,85` | `gfs_marine_waves_global_coarse_...` | **absent from response** | 37x17 = 629 | (30, -80) | **4.472 deg (~497 km)** | **6.8 s** | 110 |
| `-80,24,-76,28` | `viewport_gfs_marine_waves_..._-80.00_24.00_-76.00_28.00` | 0.5 | 9x9 = 81 | (26, -78) | **0.000 deg** | **2.85 s** | 115 |

The same point, same model, same layer, same valid time yields **period 2.85 s or 6.8 s — a 2.4x
difference** depending only on which product is loaded. For a surf product that is a category
difference (short-period wind chop vs groundswell), not an interpolation tolerance.

Client-side confirmation across a scripted zoom sequence at fixed centre (26.0, -78.0):

| step | zoom | product | n | sampled height (m) |
|---|---|---|---|---|
| 1 | 9  | `viewport_..._-80,24,-76,28` | 81 | 0.44 |
| 2 | 6  | `viewport_..._-80,24,-76,28` | 81 | 0.44 |
| 3 | 11 | `gfs_marine_waves_global_coarse` | 629 | 0.44 (stale field, see BF-02) |
| 4 | 9  | `viewport_..._-80,24,-76,28` | 81 | 0.44 |
| later | 9 | `gfs_marine_waves_global_coarse` | 629 | **0.64** |

Sampled **height at the identical coordinate moved 0.44 -> 0.64 m (+45%)** with no user intent,
purely because the client had switched products.

**Why this is Critical:** §26 lists "Zoom or pan changes a fixed coordinate's physical value
beyond tolerance" and "scientific values change because of viewport state" as automatic
certification failures. Both are satisfied.

**Falsification attempted:** *Is this just nearest-neighbour sampling of a legitimately coarse
grid?* Partly — a 10 deg grid genuinely cannot resolve (26,-78), and that alone is defensible.
The defect is not coarseness; it is that (a) the client silently swaps between two products of
wildly different resolution, (b) the swap is **inverted** (see BF-03), (c) neither state is
disclosed, and (d) the coarse product does not even declare `resolution` in its response.

---

### BF-02 — CRITICAL — Zooming IN downgrades the field to a coarser product (inverted resolution ladder)

At zoom 9 the client held the **0.5 deg** viewport product (81 pts). Zooming **in** to zoom 11
switched `__MARINE_PROJECTION_DIAG__` to `gfs_marine_waves_global_coarse` (**10 deg**, 629 pts
for the whole planet). Returning to zoom 9 restored the 0.5 deg product.

Closer inspection => coarser data is the opposite of the expected ladder.

Secondary observation in the same step: at zoom 11, `__MARINE_PROJECTION_DIAG__` reported
`global_coarse / 629 vectors` while `__MARINE_WIND_DATA__` still carried the 81-point viewport
grid (`cols/rows` 13 vs `vectorCount` 629 — mutually inconsistent). **Two runtime instruments
disagreed about the identity and size of "the current field" for the duration of that step.**
My own probe read the wind-data copy, which is why step 3 shows the stale 0.44.

---

### BF-03 — CRITICAL — GFS (the default model) and ICON have **no** regional tile for any marine layer; the whole planet is served at 10 degrees

From `/api/weather/products` (1294 products), grouped by model/domain/layer/tile:

- **GFS** marine `waves`, `swell_1`, `swell_2`, `wind_waves` + `weather/pressure`: **only**
  `global_coarse`, `resolution: 10.0`, provider `open-meteo`.
- **ICON** marine `waves`, `swell_1`, `wind_waves` + `wind/wind`: **only** `global_coarse`,
  `resolution: 10.0`.
- **EURO** (copernicus) is the *only* model with regional tiles: `florida_east_coast` and
  `us_west_coast_socal` at **0.5 deg**.

10 degrees is roughly **1,100 km per cell**. 37x17 = 629 points describe every ocean on Earth.
The default model therefore ships a field whose cell is ~8x wider than the entire viewport at
zoom 9, painted under a 0-20+ ft legend with 87,616 animated particles.

**Falsification attempted:** *Did the client wrongly pick `global_coarse` when
`florida_east_coast` was available?* **REFUTED** — `availableTileIds` lists Florida, but for
`GFS/marine/waves` **zero** Florida products exist (n=112, all `global_coarse`). Tile selection
was correct given availability. The defect is in what is ingested, not in the selector. This
refutation moved the finding from "selector bug" to "coverage gap", which is more serious.

---

### BF-04 — CRITICAL — The Truth Overlay reports `AUTHORITATIVE NATIVE` during a cross-model estimated fallback

Final state after a scripted GFS -> EURO -> GFS -> Wind -> Waves round trip:

```
UI buttons pressed           : GFS + Waves
__MARINE_TRANSITION_STATE__  : displayed {model: GFS}, target {model: GFS}, status "settled"
__MARINE_PROJECTION_DIAG__   : activeModel "EURO"
                               productId  "gfs_marine_waves_global_coarse_...json"
                               provider   "gfs_estimated_fallback"
DIAGNOSTICS HUD (user-visible): "Model / Layer: GFS / waves ... Provider: NOAA
                                 Source: ncep_gfswave025  Class: AUTHORITATIVE NATIVE
                                 TRUTH VIOLATIONS: No Causal Layer Violations Detected"
```

Three authorities disagree on the active model (UI: GFS, coordinator: GFS, projection diag:
EURO), the served product is a **GFS** product, the provider string is
**`gfs_estimated_fallback`** — and the app's own truth instrument renders the green
**`AUTHORITATIVE NATIVE`** badge and declares **no truth violations**.

**Confirmed mechanism, exact line —** `frontend/src/components/map/TruthOverlay.js:418`:

```js
{isEstimated ? 'ESTIMATED FALLBACK' : 'AUTHORITATIVE NATIVE'}
```

The provenance **Class is a pure binary on `isEstimated`**. It carries no term for resolution, no
term for cross-model substitution, and — as observed — did not trip when `provider` was
literally `gfs_estimated_fallback`. A 40x downsample of a 0.25 deg dataset and a cross-model
fallback both render as green "AUTHORITATIVE NATIVE".

The word **NATIVE is factually false** for `gfs_marine_waves_global_coarse`: its own
`source_dataset` is `ncep_gfswave025` (native **0.25 deg**), served at **10 deg**.

---

### BF-05 — HIGH — EURO selection never rendered EURO; the model button commits visually while the field does not follow

Clicking **EURO** set `aria-pressed="true"` immediately. **12 s later** the rendered product was
still `viewport_gfs_marine_waves_...`, `activeModel` still `GFS`, sampled value unchanged. The
run ended with `provider: "gfs_estimated_fallback"`.

This is a **false-ready control**: the selector asserts a model the renderer never adopted, and
the failure to adopt it was resolved by silently substituting GFS data rather than by surfacing
an error. EURO *does* have genuine 0.5 deg Florida data (BF-03), so this is a fallback taken
while better data existed for the region — though not for the Bahamas test centre, which lies
outside the `florida_east_coast` box (-85..-79). That partial-coverage boundary is the likely
trigger and is the right place to look first.

---

### BF-06 — HIGH — `__MARINE_SOURCE_PARITY__.match === true` is vacuous

```json
"heatmap": {"vectorCount": 0, "nonzeroActiveLayer": 0, "provider": "open-meteo", "waveData": true},
"infobox": {"provider": "none", "status": "idle", "timestamp": null},
"match": true, "mismatchReasons": null
```

An empty heatmap view (`vectorCount: 0`) compared against an **idle, never-sampled** infobox
yields **`match: true`**. The check cannot distinguish "agrees" from "nothing was measured", so
it reports PASS by default. At the same instant `__WebGLMarineLayer_DIAG__.infoboxHeatmapParity`
was **`false`**, and the real uploaded grid had **629** vectors — so three instruments reported
0, 629 and "parity true" simultaneously.

A parity gate that passes when both sides are empty is worse than no gate: it manufactures
confidence. This is the instrument the HUD's "No Causal Layer Violations Detected" rests on.

---

### BF-07 — MEDIUM — The client discards `resolution`, the one field that would expose BF-01..BF-03

Backend `/api/weather/grid` returns `resolution: 0.5` for the viewport product (and **omits it
entirely** for `global_coarse`). At the same moment
`__MARINE_PROJECTION_DIAG__.resolution === null`.

The backend also returns a rich `truthTag` (`dataHash`, `boundsHash`, `minSpeed`, `maxSpeed`,
`nonzeroCount`, `invalidCount`, `validZeroCount`, `sourceStage`) — a genuinely good provenance
structure that the client does not surface. No legend, no HUD row, and no guard can currently
react to grid coarseness because the number never arrives.

---

### BF-08 — MEDIUM — Global-extent fetch issued while viewing a 1.2 degree viewport

Cold-start network capture (patched `fetch`, t = ms after the Waves click):

| t (ms) | request | status | ms |
|---|---|---|---|
| 3996 | `grid_series ... bbox=-81.24,24.70,-79.01,26.82 hours=0,3,...,141` | (pending) | — |
| 3997 | `grid_series ... same bbox, hours=144,...,189` | (pending) | — |
| 4902 | `grid_series ... same bbox, hours=0` | 200 | 9424 |
| 4969 | `/api/weather/products` | 200 | **11993** |
| 17167 | `grid ... **bbox=-180,-80,180,85**` | 200 | 6691 |
| 28434 | `grid_series ... same bbox, hours=0` (**repeat**) | (pending) | — |
| 28437 | `grid ... bbox=-82,24,-78,28` | (pending) | — |

A **whole-planet** grid is fetched while the map shows ~1.2 deg. `grid_series hours=0` for the
identical bbox is requested **twice** (t=4902 and t=28434). `/api/weather/products` takes
**12 s** and returns **1294** records.

---

### BF-09 — MEDIUM — Cold start to first field is ~27 s; ~4 s of it is dead time before the first request

HUD transitions after the Waves click: `GFS/none` -> (t=4895 ms) `GFS/waves, Marine, LOADING`
-> (t=26797 ms) `LOADED, Provider NOAA`. **~4.0 s elapse between the click and the first network
request.** Throughout the 22 s LOADING window the HUD already displayed
`Class: AUTHORITATIVE NATIVE` with `Provider: UNKNOWN` — an authority claim asserted before any
provider identity existed.

---

### BF-10 — MEDIUM — The Marine Anim Tuner ships in this build and fully occludes the weather controls

The tuner panel (10 sliders, "Copy for Claude") renders expanded by default at the top-right and
**completely covers the WEATHER panel**. A pointer click aimed at the `Waves` button landed on
the tuner instead; the layer did not activate and `aria-pressed` stayed `false`. The weather
controls are unreachable by pointer until the tuner is collapsed. Whether this panel is
production-gated was **not** determined in the blind pass and is an open question (see §4).

---

### BF-11 — LOW/MEDIUM — Failing social endpoints poll unbounded on the map route

The console carries only 401s, all from **social** endpoints (`stories`, `streak`,
`upcoming sessions`, `feed lineups`) repeating at least 6 cycles while parked on `/map`.
**Zero weather or marine errors were logged** — the weather pipeline is clean. Recorded for
correct attribution: this is auth/session noise on the weather route, not a weather defect.

---

## 3. STRENGTHS (independently observed)

1. **Generation-based transition ownership is real and well-built.**
   `marineTransitionCoordinator.js` implements a monotonic `transitionId`, idempotent
   `beginTransition` on `{model,layer}`, "only the current generation may end the transition",
   and `markDisplayed` for displayed-vs-requested identity. Stale completions are structurally
   no-ops. This is the correct pattern.
2. **Resource cleanup on layer switch is genuine.** Instrumented GL counters went **negative**
   (net -26 textures, -131 buffers) across a Waves->Wind switch, i.e. the engine released more
   than it allocated, including pre-instrumentation objects. No leak on layer toggle.
3. **RAF ownership is stable.** `rafLive` stayed in a 4-5 band across every zoom, model, layer
   and unit transition. No RAF multiplication observed.
4. **Unit toggle is display-only.** ft -> m -> ft left `height`, `period`, `direction`, product
   id and vector count bit-identical. Metamorphic unit invariance **PASSES**.
5. **The diagnostic surface is exceptional** — 68 globals, backend `truthTag` with content
   hashes, hour-parity tracking. The instrumentation to fix BF-01..BF-06 already exists; it is
   under-wired, not absent.
6. **Backend provenance schema is strong**: `provider` vs `upstream_provider` vs `source_dataset`
   vs `upstream_model`, `is_estimated`, `estimate_basis`, `coverage_mode`, `cache_hit`,
   `partial_coverage`, `stale`, `staleReason`, `fallbackReason`, `frame_substituted`.

---

## 4. HYPOTHESES REQUIRING DEEPER INVESTIGATION (not yet claims)

- **H1** — Is the Marine Anim Tuner (and the DIAGNOSTICS HUD) gated out of production builds?
  If not, BF-10 is a shipped-UX defect; if yes, it is dev-only noise.
- **H2** — Does the *infobox / spot* value path use a different, finer forecast chain than the
  painted band? `__WebGLMarineLayer_DIAG__.infoboxHeatmapParity: false` suggests the two can
  diverge. If the point path is fine-resolution while the band is 10 deg, then the band is
  cosmetic and BF-01's user-facing severity changes shape.
- **H3** — What triggers `gfs_estimated_fallback`? Suspected: EURO regional coverage boundary
  (`florida_east_coast` = -85..-79) vs a test centre at -78.1, i.e. requesting outside the only
  EURO tile. Needs a positive control inside the EURO box.
- **H4** — Is `resolution` dropped at the client parse boundary or never read? Determines whether
  BF-07 is a one-line fix.
- **H5** — Does the heap growth observed during zoom changes plateau? Heap moved
  125 -> 170 -> 153 -> 159 -> 258 -> 156 MB with GC clearly dominating; **I do not claim a leak.**
  A soak run is required before any statement.

---

## 5. WHAT THIS BLIND PASS DID **NOT** COVER

Stated plainly so nothing here is mistaken for coverage:

- No Firefox or WebKit run (Chromium only). No cross-browser differential.
- No screen recordings, no Playwright traces, no React Scan / React Profiler capture, no
  DevTools performance trace, no heap snapshot.
- No antimeridian, high-latitude, or polar geography test. Only Florida/Bahamas.
- No synthetic canonical field injection (uniform east, vortex, checkerboard, etc.).
- No failure injection yet (offline, latency, out-of-order, NaN, context loss).
- No mount/unmount lifecycle cycling, therefore no remount resource claim.
- No soak run; no capacity envelope.
- No timeline scrub / forecast-hour testing beyond hour 0.
- Wind, Swell, Swell 2, Wind Waves, Fog, Pressure, Air Temp, Water Temp, Precip, Radar,
  Satellite layers were not individually validated. Only `waves` (and a brief `wind` toggle).
- `is_estimated` was `false` on every product I fetched; I did **not** observe the
  `ESTIMATED FALLBACK` branch render, so BF-04's claim is that the badge stayed green while
  `provider` said fallback — not that `isEstimated` was proven true.

---

## 6. BLIND VERDICT (pre-history)

On this evidence alone the feature is **not** in a state I would certify to advance. The
rendering, transition-ownership and cleanup engineering is genuinely good; what is not sound is
the **truth layer**: the system serves a 10 deg field as `AUTHORITATIVE NATIVE`, swaps products
under the user without disclosure, changes a fixed coordinate's value by 45-140% as a result,
falls back across models while reporting no truth violations, and rests that report on a parity
check that passes when both sides are empty.

The single most important thing I would fix first is **BF-06 + BF-04 together**: the app cannot
be trusted to audit itself while its parity gate passes vacuously and its provenance class is a
one-bit function of `isEstimated`.
