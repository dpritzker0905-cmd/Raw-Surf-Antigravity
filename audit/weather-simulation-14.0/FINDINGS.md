# Weather System Forensic Audit 14.0 — Findings

| | |
|---|---|
| **Audit date** | 2026-09-20 (probes 19:26Z – 19:55Z) |
| **Repo** | `dpritzker0905-cmd/Raw-Surf-Antigravity`, branch `dev` |
| **Baseline SHA** | `607af934e74fa87f3b8e58698ef68fdce919ea54` |
| **Backend (live)** | `raw-surf-antigravity.onrender.com` — `/api/health` version `2.0.0-stage-6f-v1-607af934…` = **same SHA**, uptime 17h 06m |
| **Frontend (prod)** | `rawsurf.netlify.app` — `BUILD_VERSION 3bd38a83` (frozen shell, unchanged) |
| **Frontend (live app)** | `dev--rawsurf.netlify.app` — `BUILD_VERSION 607af934` = **same SHA** |
| **Rig used for UI** | local `craco start` :3000 → `__BACKEND_URL__` = production backend (read-only) |
| **Working tree** | 2 modified forecast-cache JSONs + untracked `frontend/scripts/gr-live/` — **not touched** |

Backend, live frontend and local HEAD were all on **one SHA** for the whole window — an unusually clean
baseline. No application code, config, infra or data was modified by this audit.

Status vocabulary: **VERIFIED PASS / VERIFIED FAIL / SUSPECTED / NOT TESTED / BLOCKED**.

---

## 0. Headline

The forecast **science** is in good shape: units, direction convention, period, grid orientation and the
ONE FORECAST COMPOSITION chain all verify against upstream. The defects are in **state coherence,
resolution delivery and transfer cost** — i.e. what the user actually sees and waits for.

Three findings are release-blocking: a timeline that reads "Now" while showing tomorrow, an 8× heatmap
resolution collapse triggered by a 3 km tile-edge overshoot, and ~2.3 MB whole-world grids fetched per
frame while zoomed into one coastline.

---

## 1. VERIFIED FAIL — release-blocking

### F-01 · Timeline desynchronises from the displayed field and cannot be recovered
**Severity P1 · Confidence HIGH · Live-reproduced on HEAD**

At wall-clock `2026-09-20T19:51Z` the forecast wheel read `aria-valuenow="0"`, `aria-valuetext="Now"`,
while the rendered field was:

```
requestedValidTime : 2026-09-21T15:00:00.000Z
selectedValidTime  : 2026-09-21T15:00:00.000Z
product            : gfs_marine_waves_global_mid_20260921T150000Z.json
coverage_status    : full_coverage      staleRejected: false      cacheStatus: idle
```

**The map displayed a forecast ≈20 hours in the future, labelled "Now", with every health indicator green.**

Stable across three reads over 22 s (not a transient). Recovery attempts, all failing to move
`selectedValidTime`:

| action | handle | `selectedValidTime` |
|---|---|---|
| — (initial) | `0` / "Now" | `2026-09-21T15:00Z` |
| ArrowRight ×1 | `1` / "+1 hour" | `2026-09-21T15:00Z` |
| `Home` key | `0` / "Now" | `2026-09-21T15:00Z` |
| "Jump to now" (synthetic click) | `0` / "Now" | `2026-09-21T15:00Z` |
| **"Jump to now" (REAL pointer click, `ref_381`)** | `0` / "Now" | **`2026-09-21T15:00Z`** |

The real-pointer result rules out my synthetic events as the cause of the *broken recovery path*.
`requestedValidTime` is already wrong, so the desync is **upstream of the fetch**: the control resets the
wheel's visual value without resetting the clock that builds the request.

**Caveat, stated honestly:** the state was *entered* during a sequence that included programmatic
`map.jumpTo()` and synthetic `keydown`s. Entry via pure human gestures is **NOT TESTED**. Codex must
confirm the entry path before fixing.

**User impact:** a surfer reads tomorrow-afternoon's surf as current conditions. This is the single
worst outcome available to this product.

### F-02 · A 0.03° tile-edge overshoot collapses the heatmap 8× (0.25° → 2°)
**Severity P1 · Confidence HIGH · Controlled A/B, live**

`florida_east_coast` covers `W-85 S24 E-79 N31`. Fixed zoom 9, varying centre only:

| centre | viewport lon | product | resolution | vectors |
|---|---|---|---|---|
| −81.0 | −81.74 → −80.26 (inside) | `florida_east_coast` | **0.25°** | 289 |
| −79.6 | −80.34 → **−78.86** (0.14° past edge) | `global_mid` | **2°** | 72 |
| −79.1 | −79.84 → −78.36 | `global_mid` | 2° | 80 |

At a **real catalogued spot** — Sebastian Inlet FL (27.86, −80.45), fixed centre, varying zoom:

| zoom | viewport lon | crosses −79? | product | resolution |
|---|---|---|---|---|
| 10 | −80.82 → −80.08 | no | `florida_east_coast` | **0.25°** |
| 9 | −81.19 → −79.71 | no | `florida_east_coast` | **0.25°** |
| **8** | −81.93 → **−78.97** | **yes (0.03°)** | `global_mid` | **2°** |
| 7 | −83.42 → −77.48 | yes | `global_mid` | 2° |

**One zoom-out step at a flagship Florida spot degrades the heatmap 8× because the viewport overshoots
the tile edge by ~3 km.** The selector is all-or-nothing: it will not serve a regional tile that covers
90% of the view.

### F-03 · Whole-world grids fetched per frame while zoomed into one coastline
**Severity P1 · Confidence HIGH · Measured, live**

A 21.1 s timeline scrub advancing 9 forecast hours at zoom 7 over Florida:

| class | requests | bytes | avg latency |
|---|---|---|---|
| `bbox=-180,-80,180,85` (**GLOBAL**) | 6 | **13,783 KB** | 2,863 ms |
| viewport bbox | 6 | 108 KB | 1,711 ms |
| **total** | **12** | **13,890 KB** | |

**99.2% of transferred bytes are whole-world grids** — ~2.3 MB per frame, ~128× the viewport frame
(18 KB), for data almost entirely off-screen.

Corroborated by the backend's own telemetry at `/api/health` over 17 h uptime:

```
GET /api/weather/grid_series  n=139  avg 7614ms  p90 31351ms  39/139 (28%) > 10s
GET /api/weather/products     n=76   avg 6212ms  p90 17877ms  13/76  (17%) > 10s
process memory: rss 1434 MB, peak 1847 MB of 2048 MB cgroup limit = 90.2% peak
```

A 1-CPU box at 90.2% peak memory serving 2.3 MB global grids at p90 31 s is the capacity risk behind the
repeated "melt" incidents recorded in the program notes.

---

## 2. VERIFIED FAIL — important, not blocking

### F-04 · `/capabilities` declares the wrong upstream for EURO marine waves
**Severity P2 · Confidence HIGH**

`__WEATHER_CAPABILITIES__` declares all four EURO marine layers as
`cmems_mod_glo_wav_anfc_0.083deg_PT3H-i`. Measured serving:

| request | `provider` | `upstream_model` |
|---|---|---|
| `EURO/marine/waves` | `open-meteo` | **`ecmwf_wam025`** |
| `EURO/marine/swell_2` | `copernicus` | `cmems_mod_glo_wav_anfc_0.083deg_PT3H-i` |
| `EURO/marine/wind_waves` | `copernicus` | `cmems_mod_glo_wav_anfc_0.083deg_PT3H-i` |

**"EURO" is two upstreams under one label, and the published capability contract names only one.** Any
consumer trusting `/capabilities` for provenance is wrong for `waves`.

### F-05 · EURO carries no model-cycle identity
**Severity P2 · Confidence HIGH · Census over 35,077 live products**

| model | `model_run_time_status: known` | `missing` |
|---|---|---|
| GFS | 9,316 (97.1%) | 280 (2.9%) |
| ICON | 6,884 (92.1%) | 587 (7.9%) |
| **EURO** | **92 (0.5%)** | **17,918 (99.5%)** |

For EURO the app cannot state which model run it is showing; `run_time` is an **ingest** clock, not a
cycle. Confirmed on the freshly-fetched viewport product too, so it is not a backfill artifact.

### F-06 · Served provenance disagrees with the published manifest for the same product
**Severity P2 · Confidence HIGH (discrepancy) / hypothesis labelled (cause)**

For `gfs_marine_waves_florida_east_coast_20260920T180000Z.json`:

| source | `model_run_time` | `ingested_at` |
|---|---|---|
| `/api/weather/products` (manifest, 19:07Z) | `2026-09-20T06:00:00Z` | `2026-09-20T15:39:09Z` |
| `/api/weather/grid` (served, 19:33Z) | **`2026-09-19T12:00:00Z`** | **`2026-09-19T22:54:23Z`** |

~21 h apart, same `product_id`. **Not a request cache** — cache-busted bboxes and a different product
(`global_mid`) return the same old stamps. `/api/weather/point` agrees with `/grid` (so the two serve
paths are mutually consistent) and both disagree with `/products`.

**Values are probably fine** (see P-01): matched-model upstream comparison agrees to median 5.4%.
**Labelled hypothesis:** the restored in-process store keeps provenance from the pre-restart snapshot
while the manifest tracks post-restart ingests. **Not proven** — discriminating test in §5.

### F-07 · The forecast wheel offers 1-hour steps for a 3-hourly field, undisclosed
**Severity P2 · Confidence HIGH**

GFS marine `cadence_hours: 3`. Scrubbing +1 h and +2 h leaves `selectedValidTime` on the 21:00Z frame;
only +3 h advances it. The wheel reports "+1 hour" while the field is unchanged, and
`requestedValidTime` is snapped **before** being recorded, so no diagnostic or UI signal shows the
quantisation. (GFS *wind* genuinely is 1-hourly — the wheel does not adapt to the active layer.)

### F-08 · 41.3% of catalogued surf spots have no high-resolution tile
**Severity P2 · Confidence HIGH**

Union extents of all 14 GFS marine 0.25° regional tiles vs the live `/api/surf-spots` catalogue
(1,773 spots with coordinates):

```
INSIDE a 0.25-deg regional tile : 1041 (58.7%)
OUTSIDE -> 2-deg global fallback:  732 (41.3%)
```

Top uncovered: USA 80, Japan 32, Philippines 27, Morocco 25, Chile 25, Australia 24, Portugal 24,
Brazil 22, Spain 21, Sri Lanka 20, Peru 18, Maldives 17.

Compounded by F-02: the effective high-resolution footprint is narrower still.

### F-09 · Two registered layers have no declared capability; one is declared discontinued
**Severity P3 · Confidence HIGH**

`__LAYER_REGISTRY_DIAG__` registers 12 plugins and the UI offers 12 toggles, including **Air Temp** and
**Water Temp** — neither appears in the 24-row capability matrix. **Satellite** is offered while declared
`upstream: discontinued`, `unsupported_reason: "Satellite IR discontinued Jan 2026."`, `supports_grid: 0`.
Behaviour when selected: **NOT TESTED**.

### F-10 · Two parity flags read `false` in steady state
**Severity P3 · Confidence MEDIUM**

With the waves layer active, healthy and rendering: `__WebGLMarineLayer_DIAG__.infoboxHeatmapParity =
false` and `__FORECAST_TIMELINE_COVERAGE_DIAG__.pointVisualParity = false`. Whether these indicate real
infobox↔heatmap divergence or are simply unwired is **NOT DETERMINED**.

---

## 3. VERIFIED PASS — evidence that specific things are right

### P-01 · Numerical correctness against the actual upstream
`GFS/marine/waves` @ 2026-09-20T18:00Z vs Open-Meteo queried with **`models=ncep_gfswave025`** (matched
product):

| lat | lon | RS ht (m) | OM ht (m) | Δ% | RS dir | OM dir | Δdir | RS per | OM per |
|---|---|---|---|---|---|---|---|---|---|
| 26.000 | −80.000 | 0.226 | 0.220 | +2.5 | 16.7 | 17.0 | −0.3 | 7.4 | 7.5 |
| 26.250 | −79.250 | 0.230 | 0.180 | +27.5 | 28.4 | 22.0 | +6.4 | 7.0 | 6.7 |
| 26.750 | −79.750 | 0.366 | 0.340 | +7.8 | 39.1 | 41.0 | −1.9 | 7.4 | 7.3 |
| 27.000 | −79.000 | 0.377 | 0.320 | +17.8 | 48.5 | 33.0 | +15.5 | 7.3 | 7.3 |
| 27.500 | −80.000 | 0.442 | 0.460 | −3.8 | 56.8 | 52.0 | +4.8 | 7.4 | 7.4 |
| 27.750 | −79.750 | 0.536 | 0.520 | +3.0 | 60.4 | 61.0 | −0.6 | 7.5 | 7.5 |

**median |Δht| 5.4%, mean 9.1%.** Establishes: correct **units** (m, `display_unit_hint: ft`), correct
**direction convention** (no 180° flip, no sign error), correct **period**, correct **latitude ordering /
grid orientation**. Residual spread is consistent with a cycle-age difference, not a transform error.

### P-02 · No silent model substitution
`ICON/marine/swell_2` returns **HTTP 200, `model: "ICON"`, `provider: "none"`, 0 vectors** — an honest
empty. It does **not** substitute GFS. The capability matrix independently declares it unsupported with a
true physical reason ("gwam does not output native secondary swell"), matching the measured **0 products**
in the manifest. Declared = measured.

### P-03 · The grid is genuine native resolution, not fabricated upsampling
Shrinking the requested bbox 32× (2° → 0.0625° span) never changes the delivered spacing: it stays
**0.25°**, and `served_bbox` honestly reports the product's own bounds rather than the request. No
interpolated pseudo-resolution is manufactured. (Consequence: below ~0.25° span the viewport sits inside
one cell — a coverage limit, correctly disclosed, not a fabrication.)

### P-04 · ONE FORECAST COMPOSITION holds where it is mandated
`/api/weather/spot-ratings` publishes breaking and offshore height as **separate fields** —
e.g. Pepper Park `surf_height_m 0.621` vs `offshore_hs_m 0.374` (1.66×). `/api/weather/point` carries the
full geometry chain: `surf_height_m, surf_regime, shelf_depth_m, shore_normal_deg, surf_nearshore,
break_depth_m, geometry_readiness, directional_conflict, reference_size_m, geometry_missing, partitions`.

### P-05 · Audit-13.1's `/conditions/batch` P1 is CLOSED
`backend/routes/surf_data/conditions.py:72-77` now reads
`h_ft = surf_height_m × M_TO_FT` and `swell_height_ft(primary_swell_hs_m)`, with an explicit comment
"rather than inventing a swell measurement from total offshore Hs". Live probe returns
`wave_height_ft` / `swell_height_ft` separately. *(Live values were sampled at a different valid time than
the ratings row, so they corroborate magnitude but are not a numerical confirmation.)*

### P-06 · The island-lane ingest gate is in effect
Newest island-lane (`copernicus` @ 0.0833°) `ingested_at` = **2026-09-19T22:26:23Z**, i.e. **before** the
~02:20Z process restart; newest non-island ingest = `2026-09-20T19:07:12Z` (12 min old). The
`COPERNICUS_ISLAND_INGEST=0` variable set out-of-band on 2026-09-19 **has applied**. The serve-side gate
also holds: Hawaii resolves to `euro_marine_waves_hawaii_*`, Madeira falls back to `global_mid` — neither
serves a 0.0833° island product. **Residual:** 13,600 stale island products (38.8% of the manifest) remain
listed and ship in the 32 MB `/products` payload.

### P-07 · Stale-then-upgrade is honest
First request for an uncached EURO viewport returned a `global_coarse` product with `stale: true`; a
subsequent request returned a freshly-built `viewport_euro_marine_swell_2_*` at 0.25° with `stale: false`.
Degradation is labelled, then upgraded.

### P-08 · The forecast wheel meets the house accessibility pattern
`role="slider"`, `aria-label="Forecast timeline wheel"`, `aria-valuemin/now/max = 0/0/336`,
`aria-valuetext` in words, arrow/Home keyboard handling. Layer toggles carry `aria-pressed`; icon-only
controls carry `aria-label`. *(The wider a11y debt in CLAUDE.md persists — the local build emits
`jsx-a11y` errors for `Auth.js`, `SpotConditions.js`, `SpotHub.js`, `ExploreTrending.js`.)*

---

## 4. BLOCKED — attempted, not obtainable in this environment

### B-01 · Animation and frame rate — BLOCKED, not "passing"
Two independent instruments failed:

- **Pixel capture inside `map.on('render')`** (the correct technique, since the MapLibre context is
  `preserveDrawingBuffer: false`): **0 frames captured in 6 s** across four conditions.
- **My own `requestAnimationFrame`**, with `visibilityState: "visible"`, `hidden: false`,
  `hasFocus: true`: **0 frames in 4,006 ms.**
- The app's own counters confirm the same starvation: `__RAW_GPU__.drawCallsPerFrame = 0`,
  `frameTimeHistogram` all zeros, **zero delta over 4 s**.

The browser pane does not drive a continuous render loop, so **no animation claim — positive or
negative — can be made here.** This independently reconfirms the standing "frame rate is unmeasurable in
the browser pane" limitation. What *is* established: the field **paints** (screenshots render it) and the
engine is initialised with `_startTime`, `speedFactor 0.05`, `particleRes 296`, 87,616 particles with
`renderAccepted: true`.

### B-02 · `dev--rawsurf.netlify.app` UI — BLOCKED by design
The deployed dev app is behind a private-beta access-code gate (`AccessCodeScreen.js`, fail-closed). I did
not enter a code — that is a credential. `localhost`/`127.0.0.1` bypasses the gate **by design**
(`AccessCodeScreen.js:30-33`), so all UI findings were taken on the local build of the **same SHA** against
the **production backend**. Deployed-UI-specific defects are therefore **NOT TESTED**.

### B-03 · Not attempted this pass
Render/Netlify/Supabase dashboard logs (no authorized CLI/integration exercised); mobile and touch
layouts; three-theme verification; radar/satellite/precipitation raster layers; ICON/EURO UI paths;
load/soak testing; cross-feature journeys beyond the weather surfaces.

---

## 5. Discriminating tests the next agent must run

| # | Question | Test |
|---|---|---|
| D-1 | Is F-01 reachable by human gestures alone? | Repro with real pointer drag/click only — no `jumpTo`, no synthetic `KeyboardEvent`. |
| D-2 | Is F-06 stale *labels* or stale *values*? | Instrument the store: log the record identity `/grid` resolves, and diff against the manifest entry for the same `product_id` in one process. |
| D-3 | Does F-03's global fetch serve a real purpose? | Disable the global-bbox request and check what visibly breaks (the wide-zoom base pass is the likely consumer). |
| D-4 | Are F-10's parity flags real or unwired? | `grep` for **writes**, not reads, of `infoboxHeatmapParity` / `pointVisualParity`. |
| D-5 | What does Satellite do when selected? | Toggle it; record whether the UI discloses "discontinued" or shows an empty layer. |

## 6. Reproduction

Backend probes (no auth, read-only) — `evidence/*.py`, run with any Python 3:
`prov.py` (F-05 census) · `cycle.py` (cycle currency) · `subst.py` (P-02) · `res_truth.py` (F-04) ·
`zres2.py` (P-03) · `cachetest.py` (F-06) · `upstream2.py` (P-01) · `cover2.py` (F-08) · `comp2.py` (P-04).

UI: `npm start` in `frontend/` → `localhost:3000`; seed `localStorage['raw-surf-user']` with a synthetic
`dev-mock-user-id` object and `localStorage['__BACKEND_URL__']`; open `/map`; enable **Waves**; read
`__MARINE_PROJECTION_DIAG__`, `__WEBGL_MARINE_UPLOAD_DIAG__`, `__FORECAST_TIMELINE_COVERAGE_DIAG__`.

Two traps that cost me time and will cost the next agent the same:
- **Front the browser tab** or every timed read is starved (B-01) and promises never settle.
- **Settle ≥7 s after any `jumpTo`.** An unsettled read reports the 2° global load-state; I nearly
  published F-02 backwards from exactly that. The 2° reading at z9 was a *transient*, not the resting state.
