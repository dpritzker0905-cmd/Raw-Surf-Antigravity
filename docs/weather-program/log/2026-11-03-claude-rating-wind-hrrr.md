# 2026-11-03 · claude · RATING_WIND_HRRR (dark)

Branch `claude/rating-wind-hrrr`, cut from `origin/dev` 35feaaac6 and rebased on b308e37b6. One writer: this session.
Authority: the owner, 2026-11-03 ~16:19Z, "lets keep moving forward toward state of the art weather simulation system
features" (earlier: "Whatever's state of the art makes sense"), via the lead's brief. Dark build: draft PR, no flip.

## What was built

A default-OFF backend flag, `RATING_WIND_HRRR`. With it on (and the map lane `WIND_HRRR_LANE` on), a GFS rating grades
on the HRRR wind lane inside HRRR's domain and horizon, and on GFS's own wind everywhere else.

- **One composition point.** `point_resolution.resolve_point` calls `rating_wind.apply_to_wind_point` on every wind
  point it returns. Everything that rates reads its wind there: `spot_ratings.rate_one_spot` (glyphs, `/spot-ratings`,
  the precompute, `/point-rating`), the spot hub (`spot_conditions`, `self.resolve_point(domain="wind")`), the sim
  (`/api/weather/point`) and buoy calibration. The rating band (`grid_resolver_surf._build_wind_sampler`) has no point
  resolver, so its sampler passes through `rating_wind.blend_ms`, the same function.
- **The same lane as the map, not a second wind path.** It uses `wind_lane.current_lane()` (the one HRRR cycle the box
  already holds for /grid), `_hrrr_grid.space_weight` (0 outside HRRR and in its 15 km relaxation rows, then a cos²
  feather over 200 km), `Lane.time_weight`, and the per-node blend. The blend was moved out of `_blend` into
  `wind_lane.blend_vector` without changing it (the existing lane suite passes unchanged), so the map and the rating
  share one formula. Test: at a fractional feather weight, the map's node and the rating's point have the same wind.
- **The 48 h boundary.** `Lane.time_weight` tapers HRRR linearly over WIND_HRRR_TAPER_HOURS (3) before the cycle's
  last hour: 1 / 0.75 / 0.5 / 0.25 at horizon−3 h .. horizon, then 0. This matches Open-Meteo's own seamless hand-off,
  measured 2026-10-09. So the rating wind moves from HRRR to GFS over four hours and never steps by more than one taper
  increment. This is the map's own taper, so the two cannot disagree at the horizon.
- **Fallback = today's model wind, untouched** in each of these cases: flag off; `WIND_HRRR_LANE=0` (the map's kill
  switch also kills this, because it is one product); a model other than GFS (EURO and ICON keep their own wind, as on
  the map); no lane in memory; an hour before the cycle, past the horizon, or not held; outside HRRR or in its
  relaxation rows; no HRRR cell near the spot; any error.
- **Provenance.** `NormalizedPointResponse._rating_wind` is a pydantic PrivateAttr, so `/point` JSON is unchanged.
  `rate_one_spot` adds `wind_src: "hrrr" | "hrrr+gfs"` only when HRRR carried weight, so the precomputed blob is
  byte-identical while the flag is off. `SpotRatingItem` declares `wind_src` (the wire-contract guard requires it). As
  a result the live `/spot-ratings` fallback JSON gains `"wind_src": null`, the same way every other conditional key
  serialises there. No number moves.
- **Precompute.** `precompute_spot_ratings` calls `rating_wind.preload()` once, before rating, when the flag is on and
  GFS is in the model list. That is one index read plus the cycle object from L2, so the whole run uses one cycle. It
  fails open: with no lane, the run uses GFS wind and `wind_src` is absent.
- **Registration.** `_RATING_FLAGS["RATING_WIND_HRRR"] = '0'` (where to flip: Render env AND forecast-ingest.yml AND
  precompute.yml, plus sim-parity-monitor.yml). It is declared `'0'` in all three workflows. `rating_wind.py` was added
  to the science-switch scan (`test_flag_lane_parity._RATING_SURFACES`), to precompute.yml's dev-push paths, and to the
  D-017 guard's list of lane importers (`test_wind_hrrr_lane`). That guard now also asserts that rating_wind never
  applies the grid blend. `eval_replay.UNREPLAYABLE` names it (v0 archives no lane and has no wind truth).

## Cost (measured: evidence/rating-wind-hrrr-2026-11-03/bench_cost.py)

- Serve box: **no I/O per request**. The lane is the object the box already holds for /grid; the keeper re-reads its
  index every 300 s (server.py). One rating point reads 4 lattice cells: **54 µs**. The map's sampler, which
  dequantizes the whole hour, takes 252 µs for one point; `sample_point` equals it to 1e-9, tested on random fields
  with holes. A cold box has no lane for its first refresh and rates on GFS (fallback).
- Precompute (GitHub Actions, not the box): the lane object is 4.4 MB for 49 hours and parses and decodes in 0.036 s.
  1,800 spots × 48 GFS hours of point blends ≈ 4.6 s CPU.

## Tests

`backend/tests/test_rating_wind_hrrr.py`, 25 tests (guards lane). They cover: off is byte-identical (four flag values,
with a lane in memory, on the point JSON and the rating dict); inside HRRR = HRRR, outside = model; EURO/ICON/CONSENSUS
untouched; the map's kill switch; marine never touched; the horizon walk (weights 1,1,1,1,.75,.5,.25,0,0 at H−6..H+2,
scalar blend, max step ≤ one taper step); before the cycle; no lane / missing hour / missing cells / an exception all
fall back; every surface on one wind (point = the /grid blend at that node = band sampler, and
rate_one_spot's score = compute_surf_rating on that wind, with a positive control that off ≠ on); map = rating inside
the feather; the composition-point AST guard; 2x2 sampler = map sampler; preload once, only when on, and before
rating; and registration.

**Mutations (11/11 killed):** flag ignored; no time weight; any model; composition call removed; sampler off by one;
band unwired; no preload; `wind_src` dropped; GFS u/v swapped; map blend drifted by 1%; the off path stamping `gfs`.

Floors: guards 3443 → 3468, set from 3474 = dev run 41726327573's 3449 + 25, files 217 → 218
(`rederive_floor.py --lane guards --add 25 --add-files 1`).

## Evidence on a FRESH window (offline, public data only; evidence/rating-wind-hrrr-2026-11-03/)

Window **2026-09-19T01Z – 10-18T23Z**, 30 days, disjoint from L6's 10-19..11-02. Truth is the rating graded with the
anemometer wind. The stations are L6's seven: piers DUKN7, TRDF1, LJPC1, JMPN7; harbour GTOT2; buoys 46026 and 46012,
log-adjusted from 4.1 m to 10 m. The marine input is the same for every arm (Open-Meteo `ncep_gfswave025`), and the
chain is the same (`resolve_surf_geometry` + `estimate_surf_at` + `compute_surf_rating` at this branch's code).

Arms:
- `gfs`: Open-Meteo `gfs_global`, the served rating wind.
- `lane`: `rating_wind.lane_wind` on **NOAA HRRR lane objects built with the repo's own fetcher functions**. These are
  6-hourly cycles at leads 1–6 h, with horizon = cycle + 48 h (time weight 1) and the real feather. All 3,498 rows had
  space weight 1.
- `pt_bil` / `pt_near`: the same NOAA messages, sampled at the spot on the native 3 km grid (rotated). This is a
  diagnostic only.
- `omhrrr`: Open-Meteo `gfs_hrrr`, L6's arm.

LJPC1 (Torrey) and 46026 (Ocean Beach SF) give 0 rows, because their GFS-Wave cells are land-masked (L6's side
finding). n = 3,498 spot-hours at 5 stations, 149 spot-day clusters, bootstrap 4,000 reps. A positive gain means the
arm is closer to the anemometer rating than served GFS.

| arm | rating MAE gain [95% CI] | level-miss gain, pp [CI] | MAE gfs → arm | miss gfs → arm |
|---|---|---|---|---|
| **lane (what this flag serves)** | **+0.22 [−0.30, +0.71]** | **−0.5 [−3.2, +2.1]** | 8.91 → 8.68 | 48.9% → 49.4% |
| lane, piers only (n 2,075 / 89) | **−0.84 [−1.46, −0.23]** | −2.8 [−6.8, +1.2] | 5.22 → 6.06 | 34.1% → 36.9% |
| native 3 km point (diagnostic) | +0.21 [−0.43, +0.86] | +0.8 [−2.0, +3.6] | 8.91 → 8.70 | 48.9% → 48.1% |
| Open-Meteo gfs_hrrr (L6's arm) | **+1.27 [+0.81, +1.75]** | +6.3 [+3.7, +9.1] | 8.91 → 7.64 | 48.9% → 42.6% |
| Open-Meteo gfs_hrrr, piers | +0.70 [+0.18, +1.24] | +3.6 [+0.4, +6.7] | 5.22 → 4.52 | 34.1% → 30.5% |

- **Held out by station** (leave one out, lane): +0.46 (no Duck), +0.92 (no Cocoa, CI [0.41, 1.46]), +0.08 (no
  Wrightsville), −0.63 (no Mavericks, [−1.11, −0.16]), +0.28 (no Galveston). The sign depends on which station is
  left out. Per station: Mavericks +3.5 [2.5, 4.5], Wrightsville +0.8 [0.0, 1.6], Galveston 0.0, Duck −0.8 [−2.0, 0.3],
  Cocoa −2.6 [−3.4, −1.7].
- **Band check, wind regime** (obs speed × direction, lane, Holm across 9 strata on "worse"): **worse after Holm in all
  three light-wind strata**. Light cross −2.3 [−3.5, −1.2], light offshore −1.7 [−2.4, −1.0], light onshore
  −2.3 [−3.5, −1.3] (n 238/291/588). Better in moderate cross +3.0 [2.2, 3.8], strong cross +3.9 [2.4, 5.3] and
  strong onshore +1.2 [0.3, 2.5]. No other stratum is significant.
- **Band check, size** (lane): Hb < 0.6 m +0.16 [−0.15, 0.43] (n 87); 0.6–1.2 m −0.92 [−1.47, −0.35]; ≥ 1.2 m
  +1.46 [0.70, 2.22].
- **Wind itself vs the anemometer** (obs ≥ 3 m/s, n 2,435): vector RMSE gfs 3.44 m/s, lane 3.09, native point 3.18,
  Open-Meteo HRRR 2.80. Speed slope 0.83 / 0.88 / 0.92 / 0.80. The lane improves the wind vector but not the rating.
  The rating's error sits in light-wind hours, where the wind quality steps from 3 kt.
- **Lead is not the reason** (evidence/lead_split.json): lane gain by lead 1..6 h ranges from −0.13 to +0.37, and every
  CI spans 0. Open-Meteo HRRR's gain is +1.13..+1.52 at every lead.

**Reading.** L6's +1.17 is reproduced on this fresh window, but only for **Open-Meteo's** `gfs_hrrr` (+1.27). The
product this flag would serve is NOAA HRRR, rotated, as the lane stores it. On the same rows it shows no gain overall,
is worse at the piers, and is worse in light wind after Holm. Taking native 3 km points from the same messages does
not change that (lane vs native point −0.02 [−0.33, 0.31]), so the 0.25° area mean is not the cause. The gap between
Open-Meteo's HRRR and NOAA's is largest at the beach piers (Cocoa, Galveston, Duck).

One hypothesis, not tested: Open-Meteo picks the grid cell whose elevation best matches the request, which at a
sea-level pier is likely a sea cell, while the lane interpolates across land and sea cells. A nearest-sea-cell HRRR
sample made from the same lane fetch would test it. Grade: B (n with a cluster CI, but the truth is a station, not the
break).

## Flip gate (all four required; status today)

1. A fresh-window gain whose CI excludes 0. **NOT MET**: +0.22 [−0.30, +0.71]; piers −0.84 [−1.46, −0.23].
2. No wind regime worse after Holm. **NOT MET**: all three light-wind strata are worse.
3. The owner's word (D-001). Not asked: the evidence does not support it.
4. A SCOREBOARD row on the flip. None now: nothing served moved.

**Recommendation: keep it dark.** The code is correct and cheap, and it puts the rating's wind on the map's wind. But
the product it reads does not yet beat GFS for the rating. The next step is a measurement, not a flip: build a
sea-cell (land-mask-aware) HRRR sample from the same lane fetch and re-score it on this window and on L6's, stratified
by wind regime.

A flip-candidate declaration is at `flip-candidates/rating-wind-hrrr.json`. It is unlabelled, and the scorecard
refuses it by design (UNREPLAYABLE).
