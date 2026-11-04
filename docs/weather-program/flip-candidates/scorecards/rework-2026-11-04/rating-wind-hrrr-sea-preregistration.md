# Pre-registration: RATING_WIND_HRRR rework, nearest HRRR SEA cell (2026-11-04)

Written and committed BEFORE any row of this rework was scored. Branch `claude/rework-rating-wind-hrrr-sea`
(from #711 `claude/rating-wind-hrrr` + dev). Nothing below may be tuned after scoring; a change needs a new
pre-registration, and the result of this one is reported as is.

## Why this rework

#711's lane (NOAA HRRR, 0.25-deg lattice area mean) gained +0.22 rating MAE [-0.30, 0.71] on 2026-09-19..10-18,
-0.84 at the piers, and was worse in all three light-wind regimes after Holm. On the same rows Open-Meteo's
`gfs_hrrr` gained +1.27 [0.81, 1.75]. Rotation and the area mean were ruled out (#711 log: un-rotated points
-0.24, native bilinear +0.21). Open-Meteo documents that it picks the grid cell whose elevation best matches the
requested location, so at a sea-level pier it most likely takes a SEA cell. Our lane mixes land and sea cells.
Hypothesis: the wind over the WATER at the break is what the rating needs, and a land-contaminated sample is too
slow and too steady (the light-wind failure).

## Arms (two candidates, Holm across both; one reference)

Every arm uses the SAME HRRR cycle and lead, the SAME feather and time weights as #711
(`_hrrr_grid.space_weight(lat, lng, WIND_HRRR_FEATHER_KM)` x `time_weight` with horizon = cycle + 48 h, so 1 at
leads 1-6 h), and the SAME blend with GFS (`wind_lane.blend_vector`). Only the HRRR sample at the spot differs.
HRRR = `wrfsfcf{01..06}` UGRD/VGRD 10 m, rotated grid -> earth with `_hrrr_grid.rotate_to_earth` (as the lane does).
The land mask is `LAND:surface` from the same cycle's f01 file (1 = land, 0 = water).

- **A1 `sea_nearest` (primary).** The native 3 km cell with LAND == 0 nearest to the spot (grid distance in cell
  units from the spot's fractional (i, j), `_hrrr_grid.grid_ij`), searched within 10 cells (30 km). None found = the
  arm keeps the served GFS wind for that row.
- **A2 `sea_bilinear` (secondary).** The bilinear 2x2 stencil around the spot with LAND == 1 cells' weights set to 0
  and the rest renormalised; all four land = A1's nearest sea cell.
- **R `lane` (reference, not gated for the verdict).** #711's served lane: `rating_wind.lane_wind` on a Lane built
  from the same messages (`noaa_hrrr_wind_fetcher.area_mean` + `encode`).
- **Baseline `gfs`.** The served GFS 10 m wind: pgrb2.0p25 UGRD/VGRD 10 m from the SAME 6-hourly GFS cycle at fh
  1..6, through the production `PointSampler` at the spot (`eval_gfswave.products`).

## Rows, chain and truth

- **Stations (L6's 7, #711's coordinates):** piers DUKN7 (duck 36.18, -75.75), TRDF1 (cocoa 28.40, -80.59), LJPC1
  (torrey 32.867, -117.257), JMPN7 (wrightsville 34.21, -77.79); harbour GTOT2 (galveston 29.28, -94.79); buoys
  46026 (obsf 37.755, -122.511) and 46012 (mavericks 37.49, -122.50), buoy wind log-adjusted 4.1 m -> 10 m
  (z0 2e-4 m), piers unadjusted (as #711).
- **Windows:** W1 2024-12-01..12-28, W4 2025-10-01..10-28, W26 2026-10-17..10-30 (the recent 14 days). Valid hours
  t = c + fh, c every 6 h (00/06/12/18Z), fh 1..6, t inside the window (00Z first day .. 23Z last day).
- **Marine (same for every arm):** GFS-Wave 0.25 (AWS archive) HTSGW/PERPW/DIRPW of the same cycle and fh through
  the production `PointSampler` at the spot. A land-masked cell gives no row (#711: torrey and obsf had 0 rows).
- **Chain:** `resolve_surf_geometry` + `estimate_surf_at` (breaking height) + `compute_surf_rating(hb, tp, wind m/s,
  wind_from, shore_normal, swell_from, break_depth)`, the same call #711's evaluation made, at this branch's code.
- **Truth:** the same chain graded with the ANEMOMETER wind: NDBC stdmet WSPD/WDIR, hourly vector mean of records
  within 20 min of the hour (the archive's +10 min stamp shift applied, `eval_reference.parse_ndbc_historical`);
  QC'd archive for W1/W4, realtime2 for W26. A row needs truth, marine, GFS and every scored arm's sample.

## The gate (binding; nothing else decides)

- Loss = |rating - truth rating|; gain row = loss(gfs) - loss(arm), pooled over the three windows.
- **Gain test:** `eval_twoway.two_way_ci` (D-066: complete-linkage 100 km blocks x UTC days, 2000 reps, t
  interval), >= 14 UTC days. One-sided p = 1 - t_cdf(mean / se, days - 1). An arm's gain is significant when
  Holm across A1 and A2 at one-sided alpha 0.025 holds AND its 95 % two-way CI lower bound > 0.
- **No-harm family (per arm, Holm at 0.05):** two-way (same rule, strata with >= 5 days and n >= 30) one-sided
  p_worse = t_cdf(mean / se, days - 1) in each of: season (W1, W4, W26), region (east: duck, wrightsville, cocoa;
  gulf: galveston; west: mavericks, obsf, torrey), and #711's 9 wind regimes (truth speed < 6 / 6-15 / >= 15 kt x
  truth offshoreness > 0.38 offshore, < -0.38 onshore, else cross).
- **PASS** = gain significant AND no stratum worse after Holm. Otherwise FAIL (or REFUSED when < 14 days).
- **Controls** on the baseline's own rows, through the same gate: null (cand = gfs) REFUSED; cand = truth +
  0.8 (gfs - truth) PASS; cand = truth + 1.25 (gfs - truth) FAIL. Failing controls = every verdict INVALID.
- Advisory (never decide): station-cluster bootstrap, per-station gains, level-miss rate, vector RMSE / speed
  slope vs the anemometer, the `lane` reference arm through the same gate.

## What follows from the verdict

- PASS: the winning sample becomes the lane's sample (the lane fetcher carries the sea cells), RATING_WIND_HRRR
  ships default ON with a '0' kill switch, GUARDED, SCOREBOARD row, DECISIONS entry (D-065).
- FAIL: RATING_WIND_HRRR stays '0'; the result and diagnosis are recorded; the sampler stays as tested code.

Where it runs: GitHub Actions on the draft PR (`.github/workflows/rework-score-hrrr.yml`), public data only
(NOAA AWS Open Data, NDBC), no secret, never the app or its backend. Owner's word for running the scoring in CI:
2026-11-04, "Yes" (to "can I take this as your go-ahead to run scoring jobs on the three draft PRs?").
