# 2026-11-15 — Gusts and Ocean Currents layers (session gusts-currents-layers, Opus)

Owner approval (relayed by the director, local_d6b521eb): add **Gusts** and **Ocean Currents** to the weather picker as
state-of-the-art lanes on the SAME path the raster layers use (own static frames, `v1/latest.json`, `FRAME_RASTER_*` repo
variables, `ownRasterFrames.js` client). No second path; no live-backend load; the 14-day / tier contract untouched
(`LayerAccessResolver.js` and `capabilities.py` are not edited: both layers inherit the model-wide window, as fog and the
temperatures do, which have no capability rows).

## 1. The path, mapped before any code

- Publisher: `backend/scripts/publish_raster_frames.py --set <name>` → `services/frame_set_raster.py` (`SPECS`, `build_set`,
  `publish`: frames → index → `latest.json` last, retention, latest-guard) → one pilots step per set in
  `.github/workflows/forecast-ingest-pilots.yml`, gated `vars.FRAME_IMAGES_PUBLISH == '1' && vars.<VAR> == '1'`.
- Codec: `services/frame_binary.py` RSWF frames (`encode_plane` one field). Sources: `GfsGribSource` (NOAA AWS byte ranges),
  `frame_set_raster_sources.py` (ECMWF open data, DWD ICON).
- Client: `staticRasterSets.js` (keys) → `ownRasterFrames.js` (sets per layer/model, levers, kills, window, LRU) →
  `useOwnRasterFrames.js` (index pin, window pump, GL layer, LUT per theme, status line) → `ownRasterLayer.js` (R32F
  texture per frame, step LUT, 160 ms value blend = the animation lane's hook) → `useOwnRasterLayers.js` (one hook per layer;
  engaged layers leave the `.om` path). Picker + legends: `MapWeatherControls.js` (desktop panel, mobile collapsed float,
  mobile sheet all map the one `layers` list). Status words: `rasterDrawnFrame.js`. Credit: `LayerDataCredit.js`.
- Tier gating: `LayerAccessResolver.js` gates models and days only (no per-layer rule), so new layers need no edit there.

## 2. Sources

| | GFS (NOAA) | ECMWF open data | DWD ICON | our fetchers before |
|---|---|---|---|---|
| gust | `GUST:surface`, **instantaneous**, f000 (`anl`) to f336, 0.25° | `10fg`: **max** since the previous post-processing (3/6 h window) | `VMAX_10M`: **max** since the last output | `gust` exists as a point variable only, no layer |

Gusts publish **GFS only**: mixing an instantaneous gust (GFS) with window maxima (EURO, ICON) under one label would mix
meanings. Every model reads the GFS set (as fog does) and the credit names NOAA GFS (a bug fixed on the way: the credit and
status line named the PICKED model, so fog under EURO was credited to ECMWF; `ownRasterFrames.sourceModel`).

Currents: Copernicus Marine `GLOBAL_ANALYSISFORECAST_PHY_001_024`, `cmems_mod_glo_phy-cur_anfc_0.083deg_PT6H-i`, surface
`uo/vo` (elevation index 49, -0.494 m, checked against the store), instantaneous, 00/06/12/18Z to ~240 h, updated ~06 UTC.
Read from the service's ARCO Zarr by chunk (`[1,1,512,2048]` float32 blosc-lz4; 24 GETs per step). The existing
`copernicus_*` fetchers read the WAVE dataset through the toolbox; the toolbox opens this same Zarr. The bucket did not ask
for credentials on 2026-11-15 (undocumented); the project's registered account (the `COPERNICUSMARINE_SERVICE_*` secrets)
is the licensee. Licence: free, any purpose incl. commercial, visible credit required: "Generated using E.U. Copernicus
Marine Service Information; https://doi.org/10.48670/moi-00016" (in the index and the legend credit link).
Alternatives considered: the hourly-mean and SMOC (tides + Stokes) datasets — 2x the bytes and hourly-mean is not
instantaneous; SMOC is the follow-up if the owner wants tidal currents.

## 3. Frame contracts

| set (key) | variable | grid | hours | fields | repo variable |
|---|---|---|---|---|---|
| `GFS/weather/gust/global_0p25` | GFS GUST surface | 1440 × 721 | pressure's 193 (hourly to 120 h, then 3-hourly) | 4 `speed` kn (0.01) | `FRAME_RASTER_GUST` |
| `CMEMS/marine/currents/global_0p25` | CMEMS uo/vo -0.494 m | 1440 × 721 | 0–240 h every 6 h (41) | 4 `speed` kn + 1 `direction` TOWARD (0.01°), `uv_convention` 1 | `FRAME_RASTER_CURRENTS` |

Currents regrid: the 0.25° nodes sit exactly on every third 1/12° row and column, so each node is the 3 × 3 VECTOR mean
(u and v separately) over ocean cells; no ocean cell → no data; south of 80S → no data. A currents frame is the wind frame
layout, so `staticFrameCodec.buildWindVectors` already turns it into flow vectors (pinned by a test): the particle hook.
`frame_binary.encode_planes` (several fields per frame) is new; `encode_plane` is its one-field case, byte for byte (test).

## 4. Offline cost (real data, `--out-dir`, this machine; the pilots-job budget)

| set | cycle | frames | MB per run | KB / frame (gz) | seconds | parity max (tol) |
|---|---|---|---|---|---|---|
| gust | GFS 2026-11-15 06Z | 192/193 (f147: NOAA connection reset) | 172.4 | 893 | 45.4 | 0.005 kn (0.005) |
| currents | CMEMS bulletin 2026-11-15 | 41/41 | 72.5 | 1768 | 58.3 | 0.005 (0.005) |

Pilots-job budget (the frame-carry lane's measurement, run 43709308169: 130 of 200 min used, all raster steps together
~3.5 min): the two new steps add ~2 min. Each has its own step, budget and timeout: gust `timeout-minutes: 15`,
`FRAME_RASTER_BUDGET_S=540`; currents `15` / `600`. Gust's 0.01 kn steps compress like fog's 1 m (rounding to 0.1 kn saved
<3%, so the exact step stays). Currents re-read ~1.7 GB from Copernicus once per new bulletin (a run whose bulletin is
already published reads only the time axis).

## 5. Value parity against the source (independent readers)

Gust (eccodes `codes_grib_find_nearest` on NOAA's own GRIB message vs the decoded frame node), f024 and f000:

| point | GRIB kn | frame kn | diff |
|---|---|---|---|
| Pipeline 21.75, -158 | 26.642 | 26.640 | -0.0015 |
| J-Bay -34, 25 | 17.700 | 17.700 | +0.0002 |
| Trestles 33.25, -117.75 | 2.343 | 2.340 | -0.0035 |
| Nazaré 39.5, -9.25 | 18.672 | 18.670 | -0.0018 |
| Southern Ocean -55, 140 | 39.665 | 39.670 | +0.0047 |
| Antimeridian 10, 179.75 | 16.339 | 16.340 | +0.0008 |
| Mavericks 37.5, -122.5 | 3.704 | 3.700 | -0.0042 |

Worst 0.0047 kn at f024, 0.0035 kn at f000 (tolerance 0.005).

Currents (xarray + zarr opening the store, NOT the publisher's chunk reader; the 3 × 3 cells around each node), f048:

| point | source kn / deg | frame kn / deg |
|---|---|---|
| Gulf Stream 35.5, -74.75 | 0.840 / 58.3 | 0.840 / 58.3 |
| Kuroshio 34, 140.5 | 1.357 / 352.9 | 1.360 / 352.9 |
| Agulhas -35, 26.5 | 1.054 / 242.7 | 1.050 / 242.7 |
| off Pipeline 21.75, -158.25 | 0.192 / 344.7 | 0.190 / 344.7 |
| Equator 0, -140 | 0.589 / 262.3 | 0.590 / 262.3 |
| Antimeridian -5, 179.75 | 0.305 / 332.6 | 0.300 / 332.6 |
| Drake -58, -65 | 1.286 / 63.1 | 1.290 / 63.1 |

Worst 0.0049 kn and 0.005° (tolerances 0.005 / 0.005); every point had 9 ocean cells (the alignment holds).

## 6. PRE-REGISTERED GATE (written before the browser measurements below)

Offline only: production build, the synthetic backend (`serve_synthetic.py`), the frames above served by a local CDN with
**150 ms** added latency and CORS; never the live box. Desktop = 1440 × 900; phone = 390 × 844 with 4× CPU throttle.

- **G1 first paint**: click the layer chip → first frame drawn (`__RAW_OWN_RASTER__.shown` set). Pass: desktop ≤ 1.0 s and
  phone ≤ 2.0 s, median of 5 cold toggles per layer.
- **G2 scrub step**: one-hour (gusts) / six-hour (currents) steps on the ForecastWheel by keyboard after the first frame;
  key → the wanted frame on screen. Pass: median ≤ 50 ms desktop and ≤ 150 ms phone over 10 steps; no step leaves the
  label ahead of the field without the status line saying so.
- **G3 value parity**: §5 — PASS already (every point within the frame's own tolerance).
- **G4 themes and devices**: screenshots of both layers in light, dark and beach on desktop and phone, legend and credit
  visible, land and labels readable. Pass = all 12 captured and read by me; any unreadable combination fails.
- **G5 tests**: backend raster tests + the frontend map and `src/tests` trees green, ESLint ratchet not grown.

## 6b. PRE-REGISTERED OBSERVATION CHECK (written 2026-11-15 20:10Z, before any pair was computed; the director's science bar)

Not a pass/fail gate: every number is reported, bad ones included. What is compared is the SOURCE field at the frame node
(the frames equal the source within 0.005 kn, §5/§7a, so this verifies what the map serves).

**G6 gusts vs NDBC buoys.** Observations: NDBC realtime2 standard-met `GST` (peak 5 or 8 s gust in the hour's sampling
window, m/s) and `WSPD`, at every NDBC buoy/C-MAN in the realtime2 index between 60S and 65N that reported GST in the window
(no hand-picking; the list is written to the evidence file). Anemometer heights (~3-5 m on buoys) are NOT adjusted to 10 m:
the bias this causes is stated, not corrected. Forecasts: GFS GUST (cycles 00Z 2026-11-12 .. 06Z 2026-11-15, every 6 h),
ECMWF 10fg/10fg3 (every 00/12Z cycle data.ecmwf.int still holds), ICON VMAX_10M (every cycle opendata.dwd.de still holds),
the 0.25-degree node nearest each station (the frame lattice), the observation nearest each valid hour within +-10 min (EURO
and ICON, windowed maxima: the max of the hourly GST obs over the same window). Leads binned 0-23, 24-47, 48-71, 72-119 h.
Metrics per model x lead bin: n, bias (fc - obs), MAE, RMSE, and the hit rate / false-alarm ratio for gusts >= 15 m/s
(the researcher's proposal). Same-pair comparison: the three models scored on the station-hours all three cover.

**G7 currents vs HF radar.** Observations: NOAA IOOS HF radar hourly total surface currents (ERDDAP, US West Coast 6 km
and US East/Gulf 6 km) for the hours inside the CMEMS 2026-11-15 bulletin's span that have already happened. Pairs: each
CMEMS 0.25-degree node with >= 50% HF-radar coverage of its 3 x 3 box of 1/12-degree cells, radar u/v averaged over that
box. Metrics per hour and pooled: n, speed bias, vector RMSE, complex correlation magnitude, direction MAE for observed
speeds >= 0.2 m/s. Stated caveat: HF radar measures the top ~1 m including tidal and Stokes flow, the CMEMS field is the
-0.494 m model level without tides, so a tidal residual is expected near coasts.

## 7. Results

### 7a. Owner direction mid-session (13:02–13:19 EST): per-model gusts, the wind palette, the wind layer's far-hour rules

- "These lanes need to serve instantly from real GFS, EURO, and ICON lanes from GRIB and CMEM directly": §2's GFS-only gust
  choice is replaced by EACH MODEL'S OWN gust set, its definition said on screen per model (the legend credit note).
- "Mirroring the existing wind theme colors for wind gusts ... will emphasise how much faster the gusts are": the gust heatmap
  takes the colour the WIND HEATMAP draws for the same knot in that theme (`WindColorRamp.resolveDrawnField`, its hue path;
  dark with its rules off falls back to the particle ramp exactly as the wind field texture does). The legend bar is built
  from the same stops.
- "Wind gust should match that logic" (past EURO 240 h / ICON 180 h): measured in the wind code, not assumed —
  EURO wind past 240 h = the GFS field labelled "GFS stand-in beyond this model's range" (`euro_wind_extension.py`); ICON
  wind past 180 h = ICON's OWN data looped over its whole days, 3-hourly, basis `icon_loop_extrapolation` ("beyond ICON's
  native range"; `viewport_helper.extend_icon_wind_to_14d`). Gusts do the same: EURO → GFS stand-in (pressure's existing
  `fallback`), ICON → `ownRasterFrames.loopTail` (same frame files, no extra bytes; span = whole days from the first frame).

ECMWF's open-data gust, decoded per step (cycle 2026-11-15 00Z) — three products by lead time, all window MAXIMA:
`10fg` over the past 1 h to 90 h (stepRange "89-90"), `10fg3` over the past 3 h from 93 to 144 h ("141-144"), `10fg` over
the past 6 h from 150 to 240 h ("234-240"). The EURO source takes whichever is published at each step (`params`) and
accepts a window ending at the step (`window_max`).

| set | cycle | frames | MB per run | seconds | parity max (tol) | repo variable |
|---|---|---|---|---|---|---|
| gust_euro (`EURO/weather/gust/global_0p25`) | ECMWF 2026-11-15 00Z | 64/64 | 70.1 | 22.2 | 0.005 kn (0.005) | `FRAME_RASTER_GUST_EURO` |
| gust_icon (`ICON/weather/gust/global_0p25`) | DWD ICON 2026-11-15 12Z | 112/112 | 142.0 | 59.6 | 0.005 kn (0.005) | `FRAME_RASTER_GUST_ICON` |

Independent parity (EURO: eccodes `codes_grib_find_nearest` on ECMWF's own message; ICON: brute-force great-circle nearest
native cell from DWD's CLAT/CLON, not the publisher's lexsort pick), same seven points as §5:
EURO f024 (1 h window) worst 0.0048 kn, EURO f120 (3 h window) worst 0.0045 kn, ICON f024 worst 0.0047 kn — every point
inside the frame's own 0.005 kn tolerance. Example, Pipeline f024: GFS 26.64 kn (instantaneous), EURO 28.45 kn (1 h max),
ICON 30.84 kn (1 h max): the definitions differ and the legend says which is on screen.

All four new sets together, offline: ~3.1 min and ~457 MB per run on this machine (gust 45 s, gust_euro 22 s, gust_icon
60 s, currents 58 s; each its own step and timeout).

### 7b. Gate G1/G2/G4 (offline harness `ab_lib.js`: production build, synthetic backend, the REAL frame sets of §4/§7a on a local
CDN at +150 ms; host audit 0 leaks to the live box; 5 cold toggles, 10 frame-changing single-key steps per row)

First run found two faults, fixed and re-measured:
- Phone scrub on GFS gusts p50 361 ms: window misses (handhelds prefetched +-1 frame; at a step every 250 ms the next hourly
  0.9 MB frame was still in flight). Fix: the own-only layers keep two frames ahead on every device
  (`ownWindowRadius`, kill `__RAW_DISABLE_OWN_ONLY_PREFETCH2__`).
- Currents in light / beach wore a lavender veil over still water. Fix: alpha 0 below 0.25 kn (dark 0.2 kn).

| row | first paint median | step p50 / p95 |
|---|---|---|
| desktop gusts GFS / EURO / ICON | 425 / 548 / 468 ms | 28/36, 32/32 (n=3), 25/30 ms |
| desktop currents | 571 ms | 27 / 31 ms |
| phone (4x CPU) gusts GFS / EURO / ICON | 1404 / 1340 / 1316 ms | 215/248, 211/231, 162/225 ms |
| phone currents | 1451 ms | 212 / 266 ms |

Against §6: G1 PASS (desktop <= 1.0 s, phone <= 2.0 s). G2 desktop PASS (<= 50 ms); G2 phone NOT MET (<= 150 ms pre-registered).
For reference the live raster lanes measured 269-281 ms p50 on phone in the same harness (2026-11-14 own-three log). Phone
breakdown (GFS gusts, per step): key -> the app's re-render reaching the layer 55-121 ms, then -> drawn 33-98 ms, field decode
~20 ms, fetch already done by the prefetch. The app-wide re-render per hour is the remaining cost (the own-three log's filed
next-batch item); a fast path around React would draw the field before the hour label repaints, against the same-frame rule,
so it is not taken here. G4: 14 screenshots (2 layers x 3 themes x desktop/phone + the phone sheet) read: real fields, legend
and credit visible, land and labels readable after the veil fix. G5: backend raster tests 94 + 9 pass; frontend map + src/tests
trees pass except two mirror-only artefacts (a missing `program/` folder; one 64 s timeout that passes alone).

### 7c. G6 / G7 observation check (pre-registered §6b; scored to valid time 2026-11-15 20Z; protocol unchanged after the results)

G6 gusts vs every realtime2 station reporting GST (552 stations, 70% coastal fixed; 468,003 pairs), m/s (kn):

| model | lead h | n | bias | MAE | RMSE | hit / FAR (>= 15 m/s) |
|---|---|---|---|---|---|---|
| GFS | 0-23 | 164,189 | +0.02 | 2.58 (5.01 kn) | 3.50 | 0.49 / 0.41 |
| GFS | 24-47 | 121,503 | -0.00 | 2.73 | 3.73 | 0.50 / 0.42 |
| GFS | 48-71 | 73,482 | -0.16 | 2.89 | 4.00 | 0.49 / 0.42 |
| GFS | 72-119 | 23,887 | -0.19 | 3.00 | 4.21 | 0.48 / 0.43 |
| EURO | 0-23 | 21,956 | +1.80 | 2.74 | 3.61 | 0.66 / 0.58 |
| EURO | 24-47 | 17,478 | +1.75 | 2.82 | 3.72 | 0.62 / 0.58 |
| EURO | 48-71 | 9,458 | +1.87 | 2.94 | 3.95 | 0.65 / 0.53 |
| EURO | 72-80 | 1,586 | +2.12 | 3.18 | 4.25 | 0.58 / 0.63 |
| ICON | 0-23 | 33,262 | +1.09 | 2.80 | 4.01 | 0.64 / 0.54 |
| ICON | 24-26 | 1,202 | +1.45 | 2.89 | 4.03 | 0.67 / 0.53 |

Same pairs (4,242 station-hours at 536 stations, each model's shortest lead): GFS bias +0.05 / MAE 2.75 / RMSE 3.91 / hit 0.61 /
FAR 0.36; EURO +1.79 / 2.78 / 3.75 / 0.69 / 0.50; ICON +1.07 / 2.77 / 3.96 / 0.64 / 0.52. Reading: MAE is equal within
0.03 m/s; GFS is unbiased against buoys, EURO and ICON read 1-2 m/s high. Part of that high bias is the comparison, not the
models: their 1-hour MAXIMUM is scored against one ~8-minute peak per hour, and buoy anemometers (~4 m) read ~8% low vs 10 m
(+0.6-0.8 m/s to every model's bias). Not a bias correction target until both are separated (a follow-up). No confidence
intervals (pairs autocorrelated).
Deviations: ECMWF 00Z 11-12 had aged off data.ecmwf.int (7 cycles 12Z 11-12 .. 12Z 11-15 used; every EURO pair is a 1-hour
window, leads <= 80); DWD keeps ~1 day (4 ICON cycles, leads <= 26).

G7 currents vs NOAA IOOS HF radar (`ucsdHfrW6`, `ucsdHfrE6`), CMEMS bulletin 2026-11-15, 3 x 3 box pairs:

| hour | n | speed bias m/s | vector RMSE m/s | complex corr | direction MAE (obs >= 0.2 m/s) |
|---|---|---|---|---|---|
| 00Z | 707 | -0.004 | 0.243 | 0.63 | 39.4 deg (361) |
| 06Z | 729 | -0.003 | 0.283 | 0.56 | 36.4 deg (386) |
| 12Z | 748 | +0.000 | 0.244 | 0.56 | 42.6 deg (367) |
| pooled | 2,184 | -0.002 | 0.257 | 0.58 | 39.4 deg (1,114) |

The pooled speed bias hides two of opposite sign: East/Gulf 0.032 m/s slow, West 0.021 m/s fast. 18Z not scored (radar data
ended 15Z / 13Z at run time). Caveat: radar sees the top ~1 m with tide, wind drift and Stokes drift; CMEMS is the -0.494 m
level without them, which is in the direction error.
Evidence (raw pairs, station list, scripts): kept outside the repo with the session's scratch (g6_pairs.csv 468,003 rows,
g7_pairs.csv 2,184 rows); available to the advisor on request.

### 7d. The director's gate line (17:00Z rules): "at every scrub step, the label names the stored hour that was actually drawn"

Full 14-day scrub, one hour per key, real frames, offline harness. Per step: frame drawn = frame wanted (else STALE), drawn hour
= asked hour (EXACT) or the status line says "the nearest stored forecast" (the readout wind uses; the raster lanes' shared
`describeRasterFrame`), "Estimated forecast" on stand-in hours, "no forecast for this hour" past the set's end.

| run | steps | exact | nearest (labelled) | stand-in hours | no frame | stale | blank | mislabelled |
|---|---|---|---|---|---|---|---|---|
| gusts GFS desktop | 340 | 175 | 147 | 0 | 18 | 0 | 0 | 0 |
| gusts GFS phone 4x | 340 | 175 | 147 | 0 | 18 | 0 | 0 | 0 |
| gusts EURO desktop | 340 | 91 | 231 | 102 | 18 | 0 | 0 | 0 |
| gusts ICON desktop | 340 | 152 | 170 | 150 | 18 | 0 | 0 | 0 |
| currents desktop | 340 | 37 | 183 | 0 | 120 | 0 | 0 | 0 |

The first pass found 1 mislabelled step each for GFS and ICON gusts: a frame drawn 2 h from the asked hour with no note, at
a set's last frame and at the ICON / GFS stand-in seam (the note's bound was half the gap to a neighbour that does not
exist there). Fixed in the shared own-raster code, so pressure and satellite gain it too: at a set's first / last frame and
at the own / stand-in seam the note covers the whole 3 h pick window. Kill `__RAW_DISABLE_RASTER_EDGE_NEAREST_NOTE__`.
"No frame" hours: the scrubber runs to now + 14 days; these offline sets were 7-15 h old (GFS 06Z, CMEMS bulletin 00Z, 6-hourly
to 240 h), so the last hours have no frame and say so. Phone decode worker: 177 / 177 loads off the main thread; phone step
p50 after it: GFS 228, EURO 324, ICON 192, currents 182 ms (unchanged within the measured +-40 % phone noise; the per-hour
app re-render is the cost).

### 8. Agreed interface: ENS gusts past ICON 180 h / EURO 240 h (stage 2; NOT built; waits for #939's gate and the director)

With the wind long-range lane (local_162f460b, PR #939 held; stage 1 #935 = gfs_wind_standin, which this PR's `gfs_standin`
BEYOND strategy already matches):
- Source: `ens_wind/latest.npz` (+ `latest.json`: run, steps, grid), 1-degree grid, rows S->N, lon 0..359, ENS steps 144..360
  every 6 h; arrays `{u,v,speed,gust,gust_p90,spread}_{step}` in m/s. Gust = member MEDIAN of 10fg (max gust in the 6 h to
  the step), clipped >= speed; p90 likewise.
- Sampler: `ens_wind_extension.sample_step(meta, arrays, step, lats, lons)` (vectorised; plain bilinear, lon wrap, pole clamp;
  the gate's de-bias factor if recorded; returns u, v, speed, direction, gust, gust_p90, spread and a `clipped` mask). Pinned
  equal to `build_points` (the wind product's composition) by #939's test: one composition per hour for wind and gust.
- This side: a raster set per model tail at NATIVE 6-hourly ENS steps only (no interpolation of window maxima), sampled at
  every 0.25-degree node, knots, field 4 = median, a new field = p90; refuse a frame if > 1 % of cells were clipped; a BEYOND
  strategy `ens_mean_extension` for ICON / EURO; label "Days 8-14: ECMWF ensemble mean (estimate) · max gust in the 6 h to
  this time", accessible label adds "extremes are under-read". The p90 risk cue's UI: with the director.
- Fallback when ENS is absent: the GFS stand-in (as now). max(wind x GF, wind) only for a source without gusts.

### 7e. Honest-label gate re-run after the owner's 19:27 EST decision (no GFS stand-in past ICON / EURO range)

| run | steps | exact | nearest (labelled) | no frame | end note seen | stale | blank | mislabelled |
|---|---|---|---|---|---|---|---|---|
| gusts ICON desktop | 340 | 99 | 71 | 170 | "ICON gusts end at day 7.5; ensemble estimate coming" | 0 | 0 | 0 |
| gusts EURO desktop | 340 | 56 | 162 | 122 | "EURO gusts end at day 10; ensemble estimate coming" | 0 | 0 | 0 |
| gusts ICON phone 4x | 340 | 99 | 71 | 170 | "ICON gusts end at day 7.5; ensemble estimate coming" | 0 | 0 | 0 |

No frame from another model is drawn past a model's range (no stand-in entries: "estimated" 0). GFS gusts and currents are
unchanged from §7d.

### 9. Phone gate: accepted with an owed re-test (the director, 2026-11-15 21:10 EST)

Accepted as "no worse than the live raster lanes in the same harness" (phone step p50 182-324 ms vs fog / EURO air temp
269-281 ms). OWED: re-run the pre-registered 150 ms phone step target after Move 3's app-wide re-render fix lands, record
it here and in SCOREBOARD (ledger commitment, this PR's fragment).
