# 2026-10-09: the HRRR wind lane, chosen by place and time (branch `claude/hrrr-wind-lane`)

Brief (parent session local_e8e3ee51, relaying the owner): "we don't need to start it switched off, start it switched
on, we need this to be state of the art too. So use your jacobian lens to help make sure we're doing the right thing."
Build a wind-map lane where the model is chosen by PLACE and TIME, never by zoom: HRRR inside HRRR's domain and horizon
on every tier, GFS elsewhere; regional products from the ingest, not the Render box; a feathered domain edge; a labelled
time seam; default on with kill switches. This log is written only by this session. All times UTC.

## 1. What HRRR is, measured (NOAA AWS Open Data and Open-Meteo, queried from a workstation, never the backend)

- **The domain is a Lambert conformal grid**, not a lat/lon box: sphere R 6371229 m, standard parallels 38.5N, LoV
  97.5W, 1799 x 1059 cells at 3 km, first point 21.138123N 122.719528W (GRIB section 3, template 3.30). Its south edge
  is 24.4N on 97.5W but 21.1N at the corners. `services/_hrrr_grid.py` implements it. The decoded 12Z f03 message's own
  lat/lon matched `inverse` to 1e-5 deg, and `edge_km` changes sign exactly where Open-Meteo's `gfs_hrrr` goes null on
  two transects: 87W between 23.75N (-7.6 km) and 24.0N (+20.9 km), and 30N between 69.5W (+13.0 km) and 69.0W (-33.3 km).
- **Horizon:** 48 h from the 00/06/12/18Z cycles, 18 h from the others. Open-Meteo's `gfs_hrrr` ran to 12Z + 48 h.
- **Open-Meteo's own seams:**
  - space: none. `gfs_seamless` jumps from GFS to HRRR between two 0.25-deg nodes (14.0 -> 17.7 kn at 24N 87W);
  - time: a linear hand-off over HRRR's last hours. Its weights at 27.5N 87W and 47N 62W, derived from speeds,
    were 1.0 / 0.75 / 0.47-0.5 / 0.24-0.29 / 0 at H-3 / H-2 / H-1 / H / H+1.

## 2. Two defects in Open-Meteo's HRRR (why the lane fetches NOAA directly)

- **Directions are grid-relative.** HRRR's GRIB flags its winds grid-relative (section 3 resolution and component
  flags `0b1000`). Signed direction difference against GFS at the same hour, 12Z f03, 69 points with both winds over 4 m/s:

  | | west of LoV (alpha -14.3 deg) | east (alpha +15.2 deg) |
  |---|---|---|
  | HRRR, unrotated | +9.8 deg | -16.4 deg |
  | HRRR, rotated to earth | -4.3 deg | -2.5 deg |
  | Open-Meteo `gfs_hrrr` | +12.0 deg | -19.5 deg |

  Open-Meteo serves the unrotated field. The rotation angle is 0.6225 x (lon + 97.5) deg: +10.9 deg at Florida's 80W,
  +17 deg at 70W, -12.8 deg at 118W, -16.5 deg at 124W.
  - Against 101 NDBC buoys over 5 days (below), unrotated is worse by 0.47-0.69 kn vector RMSE and 2 deg direction MAE.
  - Spot points still ask `fetch_point` for `gfs_seamless`, which is HRRR inside the domain. So spot-hub "GFS" wind at
    US coasts for the first ~48 h carries this error. That feeds ratings, so it is out of this PR's scope (§9).
- **Point sampling aliases.** `gfs_hrrr` returns the 3 km cell under the node. At 0.25 deg that differs from the
  cell's area mean by 0.71 kn p50, 5.19 kn p95 and 20.18 kn max, and it nearly doubles the field's interior gradient
  p95 (0.42 vs 0.22 kn/km). The isolated 11 kn cell inside the 2026-10-09 eyewall was this.
- **Quota:** 37,760 lattice nodes per cycle is ~4 days of Open-Meteo's free 10,000 location-calls. AWS has no quota
  and names the run.

## 3. The lane (built)

- **Ingest** (GitHub Actions core lane, `scheduler/forecast.py` after "GFS Wind Global"):
  - `weather_pipeline/wind_lane_ingest.py` spawns `services/noaa_hrrr_wind_fetcher.py` by path. The fetcher:
    - takes the newest complete extended cycle;
    - fetches f00-f48 hourly UGRD/VGRD 10 m by byte range (49 x 4.76 MB);
    - checks section 3 against the grid and REFUSES a changed one;
    - rotates to earth when flagged;
    - writes each 0.25-deg cell's area mean (scalar speed, vector direction: L-S16) as zlib+base64 int16 knots
      (~4.5 MB per cycle).
  - The ingest publishes `wind_lane/hrrr-<cycle>.json` and then `wind_lane/index.json` (the index LAST, so a
    half-upload is never served), keeps the previous cycle and deletes the one before.
  - It runs on GitHub Actions only (`GITHUB_ACTIONS=true`; `WIND_HRRR_LANE_INGEST=0` kills it, `force` runs it elsewhere).
- **Serve** (`weather_pipeline/wind_lane.py`):
  - One function, `apply_wind_lane`, runs last in the `/grid` route, which `/grid_series` calls per frame.
  - Every GFS wind tier passes through it: the 10-deg and 2-deg world tiers, the 0.25-deg regional tiles, the dynamic
    viewport, and the native recovery.
  - At each node: weight w = space(lat, lon) x time(valid). Speed blends as a scalar; direction comes from the blended
    vector. The product is copy-on-write and never stored, so stored products, the dynamic index, spot points,
    ratings and glyphs are untouched.
  - The response carries `wind_lane` (`lane`, `hrrr_cycle`, `hrrr_horizon`, `time_weight`, cells, `reason`).
  - The lane loads in a background thread at startup and on index change (TTL 300 s): one ~4.5 MB GET per cycle per
    process, int16 in memory (7.4 MB).
- **Base under the feather:** while the lane is on, Open-Meteo GFS wind grids ask for `gfs_global`
  (`wind_grid_gfs_global()` is true). Render already has `WIND_GRID_GFS_GLOBAL=1`, so nothing changes there.
- **Client:**
  - `windLane.js` and `WindLaneStatus` (in `TimelineStatus`, rendered by `renderTimeline`, so all three layouts and
    themes show it) print the drawn wind's model in words, `role="status"`: "Wind: HRRR + GFS", then
    "Wind: HRRR → GFS" in the taper, then "Wind: GFS (HRRR ended)".
  - The TruthOverlay HUD gains a "Wind lane" row.
  - The scrubber is never capped: past HRRR the map is GFS.
- **Flags:**
  - `WIND_HRRR_LANE` defaults to "1" in `_RATING_FLAGS` (D-017); "0" returns every product untouched, which is the
    gfs_global map exactly.
  - `window.__RAW_DISABLE_WIND_HRRR_LANE__ = true` (then reload) sends `wind_lane=gfs` on /grid and /grid_series; a
    middleware reads it, and the cache keys stay apart.
  - Tunables: `WIND_HRRR_FEATHER_KM` (200) and `WIND_HRRR_TAPER_HOURS` (3).

## 4. State of the art (research, 2026-10-09)

- **NOAA National Blend of Models:** takes HRRR as a CONUS input to 36 h (00/06/12/18Z; extended to 48 h planned).
  - It weights members by a decaying-average MAE against URMA, so the hand-off is a weighting, not a cut (NBM v3.1 MAE
    alpha 0.05; NWS NBM webinar 2026-04-15; NWA JOM 2020-1).
  - Adopted: a blended hand-off. Not adopted: skill weights. We have no wind truth lane yet; see the 5-day buoy result
    below and commitment §8.
- **Open-Meteo `gfs_seamless`:** HRRR inside its domain to its horizon, GFS elsewhere, with the measured 3-hour linear
  time hand-off and a hard spatial cut (§1). Adopted: that time taper.
- **Ventusky:** "Automatic" switches to the highest-resolution model available, and its point chain goes HRRR, then
  ICON, then GFS by lead time (Ventusky user guide; moderator reply). Adopted: model by place and time, labelled.
- **Windy:** presents HRRR and NAM as separately labelled models with no blended edges. **Windfinder:** Superforecast
  (high resolution, ~3 days) and Forecast (GFS, 10 days) are separately labelled products. Adopted: labels in words.
- **Limited-area nesting (Davies relaxation):**
  - the boundary zone is ~8 coarse grid points, or ~100 km (DWD ICCARUS 2018; ALADIN);
  - the profile is chosen to avoid discontinuities (Marbaix et al. 2003; Lehmann 1993).
  - Adopted: a cos^2 (smooth in value and slope) feather starting past HRRR's own 15 km relaxation rows. Its width,
    200 km (8 GFS cells), is set by the smoothness row, not copied.

## 5. Jacobian rows (every row with its instrument)

### Smoothness at the domain edge

The seam term |H-G|.|dw/dx| against the natural interior p95 gradient (HRRR 12Z vs NOAA GFS 12Z, 0.25 deg lattice,
`meas/feather_rep.py`), in kn/km:

| lead | natural p95 HRRR / GFS | hard cut | 100 km | 150 km | **200 km** | 250 km |
|---|---|---|---|---|---|---|
| f03 | 0.223 / 0.190 | 0.526 | 0.263 | 0.221 | **0.186** | 0.142 |
| f12 | 0.261 / 0.278 | 0.995 | 0.301 | 0.182 | **0.128** | 0.106 |
| f24 | 0.275 / 0.228 | 0.687 | 0.358 | 0.224 | **0.169** | 0.123 |
| f36 | 0.310 / 0.320 | 1.068 | 0.277 | 0.189 | **0.131** | 0.113 |
| f48 | 0.287 / 0.241 | 0.878 | 0.350 | 0.228 | **0.168** | 0.133 |

- 200 km is the narrowest tested width that stays under the smaller natural p95 at every lead.
- The edge jump |H-G| within 120 km of the edge is 2.61 kn p50, 7.82 p95, 22.34 max.
- The drawn field is bilinear on this lattice, so its gradient is bounded by these pair gradients.

### Time seam at the horizon

HRRR 12Z f44-f48 against GFS 12Z f44-f50, at nodes of full space weight:

| hand-off | step p95 (max) kn |
|---|---|
| natural hourly GFS | 3.93-4.43 (31-73) |
| natural hourly HRRR | 4.46-4.86 (24-39) |
| hard switch, at the step | **10.62** (38.9) |
| 3 h taper, every step | 4.07-4.74 (18.7-26.7) |

- |H48 - G48| is 3.45 kn p50, 10.63 p95, 35.34 max.
- By f48 the storm is off the Carolinas at 27-30 kn: the two models put its wind maximum ~90 km apart (34.75N 76.0W
  for GFS, 35.5N 75.5W for HRRR).

### The drawn eye

Wind bench lane mode, `frontend/scripts/wind-bench/lane-run.js`:
- the real engine, AMD 890M, D3D11, working tree @ `5bf360d8`;
- fixtures from `backend/scripts/wind_lane_bench_fixtures.py`, i.e. the production `apply_wind_lane` on 15Z tiers:
  NOAA GFS 12Z f003, Open-Meteo gfs_global 15Z, and the HRRR 12Z lane f00-f08;
- reference: box B (Open-Meteo, -92..-79), z6.

| row | result |
|---|---|
| null tier/pan: Open-Meteo box A, NOAA recovery boxes A, C, D, z5.5-7 | **0.0-0.2 km, same closing T (40 kn), area x1.00** |
| null zoom: box B at z5.5-7 vs z6 | <= 0.2 km, x1.00 |
| null upstream: the same box from Open-Meteo and from the NOAA recovery (the breaker / cache order) | **0 km, x1.00** |
| positive: the OLD pair (NOAA GFS box z6 -> Open-Meteo seamless box z6.5) must fail | **38.3 km, -16 kn, x2.17: fails, as it must** |
| reported: lattice, the 0.25-deg tile vs the 0.5-deg box | 0.5 km, same T, area x0.30 (the finer lattice draws a smaller eye; a lattice change, not a model change) |
| time seam: the eye through the taper at z6 (w = 1 -> 0.75 -> 0.5 -> 0.25 -> 0) | 10.2 / 8.9 / 9.6 / 6.5 km per step, closed at 38-40 kn throughout; 32.7 km in one step if the switch were hard |

- Exit 0: every null holds and the positive control fails.
- The lane's eye (area-mean HRRR) closes to 40 kn. Open-Meteo's point-sampled HRRR closed only to 32: its aliased calm
  cell broke the wall.

### No knock-on to served numbers (structural; `tests/test_wind_hrrr_lane.py`)

- AST guard: only `routes/weather.py` (once), `server.py` (middleware and warm-up) and `wind_lane_ingest.py` import
  the lane.
- `fetch_point` still asks for `gfs_seamless`.
- The lane writes nothing back: the input product, its grid, its vector list and its vectors stay untouched, so stored
  products, the dynamic index (PATH 2a of the point resolver) and the surf-band wind sampler are unchanged.

### Cost

See §6.

### Coastal detail and coastal truth

`meas/coastal5.py` and `meas/coastal5b.py`:
- 101 NDBC buoys inside HRRR's full-weight area, NDBC 5-day files, 19 valid times 2026-10-05 00Z to 10-09 12Z;
- leads 3 h and 24 h, 1686 matched observations per lead;
- anemometer speeds x 1.10 to 10 m.

| lead, buoys | model | vector RMSE kn | speed MAE kn | dir MAE deg |
|---|---|---|---|---|
| L3 coastal (<50 km, 1441) | **HRRR lane (as drawn)** | **5.97** | **2.56** | 20.0 |
| | GFS 0.25 (as drawn) | 5.99 | 2.76 | 19.9 |
| | HRRR unrotated (= Open-Meteo) | 6.44 | 2.41 | 22.0 |
| L24 coastal (1441) | HRRR lane | 6.61 | 2.78 | 23.2 |
| | GFS | 6.47 | 2.89 | 22.4 |
| | HRRR unrotated | 7.30 | 2.90 | 25.0 |

- Buoys where the lane beats GFS on vector RMSE: 45/88 (L3), 40/88 (L24). **Accuracy at the buoys is a tie.**
- **Detail is the gain:** at the 3,338 coastal lattice nodes (cells that hold both land and water), the gradient p95 is
  0.33-0.47 kn/km for the lane vs 0.25-0.35 for GFS, **x1.37 (median), larger in 19 of 19 valid times**.
- A water-only mean in mixed coastal cells fixed the L3 speed bias (-1.22 -> -0.22 kn) but worsened vector RMSE
  (6.11, and 7.02 at L24). Rejected; the plain area mean stays.
- n = 5 days in one season: recorded, not a verdict (commitment §8).

## 6. Cost (no new requests; CPU measured offline)

By construction:
- the client sends the same URLs (`windLaneParam()` is '' unless killed);
- the serve path makes no upstream call per pan or zoom (the lane is in memory);
- the Render box does one L2 GET per HRRR cycle per process (~4.5 MB, every 6 h);
- the lane writes nothing to the dynamic index or L2.

The measurement is in §10.

## 7. Tests

- Backend:
  - `test_wind_hrrr_grid` (20), `test_noaa_hrrr_wind_fetcher` (14), `test_wind_hrrr_lane` (33) and
    `test_wind_hrrr_lane_ingest` (9) = 76, guards lane;
  - `test_fetcher_script_imports` +1 (estate);
  - `test_wind_grid_gfs_global`: its two pre-lane defaults are now pinned under `WIND_HRRR_LANE=0`.
  - Twelve mutations, one per rule, all RED: no rotation; flipped rotation sign; grid check skipped; vector speed;
    hard cut; hard time switch; in-place write; asked hour instead of the served frame; route hook removed; series
    drops the lane; index written first; ingest runs anywhere.
- Floors:
  - guards 190/2559 -> 194/2635, `_FLOOR_SET_FROM["guards"]` 2565 -> 2641 (hosted dev db037eaf, CI 37971676215:
    190 files, 2565 passed);
  - estate 1542 -> 1543, `_FLOOR_SET_FROM["estate"]` 1544 -> 1545.
- Frontend: `windLane.test.js` (16 tests). Map tree + src/tests: 286 suites / 3549 tests passed locally. The LOC
  ratchet stays green: MapWeatherControls is 956 lines against a baseline of 957, via the `TimelineStatus` extraction.

## 8. Ledger and commitments

See §11.

## 9. Open after this PR (not done here)

1. **Spot-point wind inside HRRR's domain is Open-Meteo's grid-relative HRRR**: `fetch_point` uses `gfs_seamless`, and
   its direction is 11-17 deg off at the coasts for the first ~48 h. It feeds ratings: a D-001 question for the owner.
   The fix would read the point from this lane, or rotate.
2. **The lattice by zoom:** the dynamic lane's adaptive lattice (0.5 deg up to ~z7, 0.25 beyond) changes the drawn
   eye's area x0.30 without moving it (0.5 km). Inside HRRR the lane is stored at 0.25 deg everywhere, so a fixed
   0.25-deg lattice there would remove it. Not done: it moves the dynamic tier's request size and the point lane's
   PATH 2a inputs.
3. **Skill weights (the NBM's practice):** grade HRRR vs GFS wind against NDBC over >= 14 days by lead and coast before
   any weighting (commitment §8).

## 10. Cost measurement (offline: the real `/grid` route with its middleware, resolver stubbed, no network)

`meas/cost.py`, this workstation, a production-size 49-hour lane:

| item | cost |
|---|---|
| lane load (parse and decode of 4.5 MB) | 27 ms per cycle per process; 7.4 MB resident (int16) |
| `apply_wind_lane`, world 2 deg (15,023 vectors, 429 inside HRRR) | 2.9 ms median |
| world 10 deg (629 vectors) | 0.35 ms |
| regional tile 0.25 deg (725) | 2.5 ms |
| dynamic box 0.5 deg (405) | 1.5 ms |
| dynamic box 0.25 deg (1,537) | 5.2 ms |
| a box outside HRRR (405) | 0.05 ms |
| a 48-frame series page (0.5-deg box / 2-deg world) | 101 ms / 147 ms, against 10-13 s of box CPU for a world page today (~1-1.5%) |
| a pan/zoom burst of 22 `/grid` requests through the route | **0 network calls**; median per request 2.6 -> 5.4 ms (+2.8 ms), total 220 -> 320 ms |

- Requests per pan/zoom are unchanged, on the client and upstream.
- CPU grows by the blend alone, about 1-5 ms per GFS wind response and only inside HRRR's lattice. That is small next
  to the resolver's own cost, but it is not zero; this log does not claim zero.
- Windows `process_time` ticks at 15.6 ms, so the burst uses wall time in one process.

## 11. Ledger

- seq 965: finding (Open-Meteo HRRR is grid-relative and point-sampled).
- seq 966: decision (D-017, default on).
- seq 967: owner_action, reconstructed (the owner's WIND_GRID_GFS_GLOBAL=1 on Render, learned from the brief; its
  read-back stays with commitment 963).
- seq 968: pr_open, PR #293 (head 69258099).
- seq 969: commitment, due 2026-10-13T18:00Z. The live read-back: the ingest's publish line, the index, ONE /grid
  inside HRRR with `wind_lane` (and with `wind_lane=gfs`), the lane bench on that product, and Render memory.
- seq 970: commitment, due 2026-10-27T18:00Z. The >= 14-day NDBC wind grade, lane vs GFS, by lead and coast. D-017
  reopens if the lane is worse by > 0.3 kn at any lead or coast.

STATE's ledger head moves to 970.

## 12. Correction: the chain floor

The chain lane gains 2 tests: `test_fetcher_http_pooling` parametrizes over `POOLED_FETCHERS`, which the new fetcher
joins. Floor 163/2436 -> 163/2438, `_FLOOR_SET_FROM["chain"]` 2442 -> 2444 (hosted dev db037eaf: 163 files,
2442 passed).

## 13. Correction: the lane stores native m/s (19:51Z)

The hosted-equivalent guards run found the fetcher and the fixture script writing their own knots constant
(`1/0.514444`). `test_wind_unit_constant_parity` allows one pair, `surf_rating.MS_TO_KT`, read as an attribute,
because a truncated copy once flipped a rating at a strict `< 3.0 kt` edge.

The fix:
- the lane now stores native m/s, as the GRIB carries it (int16, step 0.05 m/s, about 0.1 kn; `units: "m/s"`);
- `wind_lane.Lane.sample` converts once with `SR.MS_TO_KT`;
- the fixture script reads the same constant.

The lane object and fixtures were rebuilt and the bench rerun:
- null tier/pan/zoom/upstream: 0.0-0.1 km, the same 40-kn closing T, x1.00;
- positive: 38.3 km;
- lattice: 0.5-0.6 km, area x0.28;
- taper: 10.3 / 9.0 / 9.5 / 6.5 km per step, 32.9 km if hard.

The §5 eye rows above were measured on the earlier knots encoding and stay as written; these supersede them for the
shipped code (SCOREBOARD row). The same run also listed 9 other guards failures. With a short `--basetemp` all 9 pass:
they were Windows path-length artifacts of a long temp root, like 31 of chain's 32.
