# 2026-10-09: the hurricane eye that changed on a one-stop zoom (branch `claude/wind-eye-one-model`)

Owner report (STATE "Open, not yet diagnosed", added by #286): on LIVE data, with the forecast hour fixed and no
scrubbing, the eye of the Gulf hurricane changed shape and size, and panning changed it. Mid-session the owner
added: "Its happening between two midclose zoom levels, when I zoom in and out one stop", and pasted the console
log of that session. This log is written only by this session.

## 1. What the console log showed (owner's browser, ~15:2xZ)

- Each one-stop zoom filed a different FINE overlay over the resident 2° world base (`gfs_wind_wind_global_mid`,
  181x83): `viewport_gfs_wind_wind_20261009T150000Z_-90.00_25.00_-78.00_32.00` (25x15) and
  `..._-92.00_25.00_-79.00_32.00` (27x15), and once a 14x11 clip of the world product.
- Every swap logged `maxWindSpeed updated: 62.285 -> 78.4438` or back. The colour LUT is keyed in absolute knots
  (built over 0..max, sampled at speed/max), so the re-normalisation itself changes no colour. It only says that
  the two grids hold different data.
- Pairs of `Particles re-seeded (trails kept — camera recenter)` are what the engine logs when the zoom goes from
  ≤6 to >6 (tile init plus the tier crossing). The owner's stops straddle z6.

## 2. Provenance: two upstreams under one label (Render logs, read-only)

| box (same 15Z, same 0.5° lattice) | registered | upstream | served max |
|---|---|---|---|
| -90..-78 / 25..32 | 15:21:54Z | Open-Meteo breaker open (15:21:49Z) -> `Spawned GFS native recovery ... res 0.5, viewed hour` -> NOAA GFS 0.25 GRIB, `model_run_time` 06Z | 78.4 kn at 28.0N 87.0W |
| -92..-79 / 25..32 | 15:22:41Z | `[Open-Meteo Provider] Fetching GFS wind/wind grid. Coords count: 405` (breaker closed again) | 58.6 kn at 27.5N 87.0W |

Both are cached as `viewport_gfs_wind_wind_<hour>_<bbox>` with `provider: open-meteo` and
`source_dataset: gfs_seamless` (the native fetchers keep that label on purpose, for manifest byte-identity). The
engine's base+overlay rule (`windGridsCompatible`: same model label, same hour) therefore files either over the
GFS base.

**Live check (the one allowed):** 15:34:02Z `/api/health` 200 in 11.6 s (already slow before any request of
mine), then `/api/weather/grid?model=GFS&domain=wind&layer=wind&valid_time=2026-10-09T15:00:00Z&bbox=-90,25,-78,32`
and `...bbox=-92,25,-79,32`, cache hits at 1.7 s and 1.5 s. The products were 12 min old, under the 30-min SWR
age, so no refresh was queued. Then `/api/health` 200 in 9.3 s at 15:34:26Z.

**What gfs_seamless is here** (Open-Meteo queried from this workstation, never through the backend, 405 nodes of
box B at 15Z, `models=gfs_seamless,gfs_global,gfs_hrrr`):

| comparison | nodes equal within 0.05 kn | mean abs diff | max diff |
|---|---|---|---|
| served B vs `gfs_hrrr` | **405 / 405** | 0.00 | 0.00 |
| served B vs `gfs_seamless` | 405 / 405 | 0.00 | 0.00 |
| served B vs `gfs_global` | 2 / 405 | 3.40 | 42.60 |
| served A vs `gfs_global` (345 shared nodes) | 52 / 345 | 0.51 | 17.49 |
| served A vs `gfs_hrrr` | 7 / 345 | 3.43 | 42.56 |

Open-Meteo meta at ~15:50Z: `ncep_gfs025` last run 06Z (available 12:44Z), `ncep_hrrr_conus` last run 13Z. So
inside HRRR's domain the "GFS" dynamic lane is HRRR (3 km) point-sampled at 0.5°. Its eye shows HRRR's
convective-scale noise: isolated cells such as 11.0 kn at 29.0N 86.0W among 33-40 kn neighbours, and 2.3 kn at
25.5N 89.0W. Open-Meteo's own GFS reports nodes off the 0.25° lattice (e.g. 28.0048N 87.5037W), which is why A vs
`gfs_global` is not exact even on the same 06Z run.

## 3. Bench: what the engine draws (new eye mode, `frontend/scripts/wind-bench/eye-run.js`)

The real engine (working tree @ `8ba4aae6`, AMD 890M, D3D11), one heatmap frame per threshold from 30 to 50 kn in
2-kn steps. The colour LUT is swapped for a white-below-T ramp and the eye's T-kn contour is read back. Base: 2°
world copying the served nodes. Fixtures: the two served products (`fixtures/eye-2026-10-09-*.json`) and Open-Meteo
`gfs_global` on box B. Camera centred on 87.6W 27.8N.

| overlay | drawn eye centre | closed from..to | r at closing T | aspect |
|---|---|---|---|---|
| A: NOAA GFS (recovery) | 87.55W 27.88N | 30..48 kn | 45.9 km | 1.26 |
| B: Open-Meteo gfs_seamless (HRRR) | 87.70W 27.57N | 30..32 kn | 36.5 km | 1.41 |
| C: Open-Meteo gfs_global (GFS 06Z) | 87.51W 27.81N | 30..46 kn | 35.7 km | 1.28 |
| 2° clip of the base | none closed at 30-50 kn | | | |

| comparison (identical at z5.5, 6, 6.5 and 7) | centre shift | weakest-wall change | area at the common closing T |
|---|---|---|---|
| **A -> B: the owner's swap** | **38.3 km** | **-16 kn** | **x2.17** (32 kn) |
| A -> C: both lanes GFS (the flag) | 9.1 km | -2 kn | x0.71 (46 kn) |
| null: B in box B vs B cropped to box A | 0 km | 0 | x1.00 |
| null: A at z5.5 vs A at z6/6.5/7 | <= 0.3 km | 0 | x1.00 |
| positive: A vs the 2° clip | eye no longer closes | | |

Both controls hold. The renderer draws the same data identically in any box and at any of these zooms. **The eye
moved because the data under it changed model.**

**Particles (the respawn/density question).** After 180 real frames (2 seeds), the trail ink inside the eye
(<= 25 km) over the ink on its wall (50-90 km), with the grid FIXED:

| grid | z5.5 | z6 | z6.5 | z7 |
|---|---|---|---|---|
| A | 1.18 | 1.21 | **1.77** | 1.57 |
| B | 1.08 | 1.12 | **1.50** | 1.40 |

The two seeds agree within 1.5%. A second lever is therefore IN, at the z6/z6.5 boundary, for the eye's contrast
(not its place). Above z6 `v2SpeedKeepUniform` switches the speed-aware draw cull on at full strength (k = 1 for
z <= 7.5, a hard step at 6; it fades out only at 7.5-9.5), and `v2DensityAt` jumps from the flat 490 to the
close-zoom curve. The cull thins fast eyewall marks and keeps slow eye marks, so the eye reads relatively heavier.
Not changed here: it is a look change and needs an owner A/B (L-V1).

## 4. Fix (PR, dark)

`WIND_GRID_GFS_GLOBAL=1` makes every Open-Meteo GFS **wind grid** request ask for `models=gfs_global`. That is the
dynamic viewport lane, plus the scheduler's Open-Meteo fallback when NOAA-direct fails. All three GFS wind lanes
are then GFS: the NOAA world base, the native recovery, and Open-Meteo.

- It is dark (default `0`) because it moves served wind speeds inside HRRR's domain (D-001). It is registered in
  `_RATING_FLAGS`.
- Untouched: point forecasts (`fetch_point` keeps gfs_seamless), pressure/precipitation, ICON and EURO. Labels are
  not changed.
- Tests: `tests/test_wind_grid_gfs_global.py` has 10 tests; 6 were red before the fix. The other 4 are the
  "nothing else changes" guards, green before and after.
- Guards floor 189/2549 -> 190/2559; `_FLOOR_SET_FROM["guards"]` 2555 -> 2565 (hosted dev 8ba4aae6, CI 37948644845:
  2555 passed, +10 projected).
- Frontend: `windBenchEye.test.js` (12 tests) pins the bench arithmetic. Correction: the code commit `2bfa8fff`
  says 14; Jest counts 12. Map tree: 263 suites / 3283 tests; src/tests:
  22 / 248; the ESLint and LOC ratchets are green.
- This PR changes no served number until the owner flips the flag.

**Expected after the flip:**
- Two boxes built by the same lane draw the same eye (null control, 0 km).
- An Open-Meteo box next to a native-recovery box (only while the breaker is open) still differs by about 9 km,
  2 kn and x0.71 at the eye. That is Open-Meteo's GFS resampling, not the model.
- Not addressed: run skew (NOAA publishes a run hours before Open-Meteo), which can put two runs side by side
  during a cycle change.

## 5. Open after this session

1. The owner flips `WIND_GRID_GFS_GLOBAL=1` on Render. Read back with a post-flip viewport GFS wind product
   compared against Open-Meteo `gfs_global` and `gfs_hrrr` at its nodes (expect gfs_global at most nodes, hrrr at
   few), and the eye bench on a fresh pair of boxes.
2. The z6 particle step (section 3): a candidate that fades the speed-keep cull in over z6 -> 7 and makes the
   density continuous at z6. It needs an owner A/B before default-on.
3. Point forecasts: `fetch_point` still asks for gfs_seamless, so spot-hub "GFS" wind inside HRRR's domain is HRRR.
   That feeds ratings, so it is a D-001 question for the owner, not part of this PR.
4. Residual lane mismatch: Open-Meteo GFS vs NOAA GRIB at the eye node is up to 17.5 kn. A full fix would serve
   the fine wind overlay from the same source and run as the base.

## 6. Tooling notes

- Jest in a worktree under `.claude\worktrees\`: CRA builds `testMatch` from the Windows root path, and `\.claude`
  becomes a glob escape, so `react-scripts test <path>` finds 0 tests. Pass an explicit pattern:
  `--testMatch "**/src/components/map/**/*.test.js"`.
- The app's `sync_with_base_branch` failed with "Committer identity unknown"; a manual `git merge origin/dev` worked.
- A TaskStop on a backgrounded `react-scripts test` left its node process running and writing into the same output
  file (25 bogus "worker crashed" FAILs). Kill it by PID, filtered on this worktree's path, and re-run.
