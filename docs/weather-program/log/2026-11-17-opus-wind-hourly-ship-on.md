# 2026-11-17 — opus: FRAME_WIND_GFS_HOURLY ships ON (the owner's yes), under D-065

Session: the frame-carry side session. The owner answered in this session at 08:36 EST: "Yes, both". He was asked whether to
turn on hourly GFS wind (and run-keyed names, PR #1005), after being told it changes the wind numbers users see and adds
time to the frames step. Written 14:09Z.

## What moves

GFS global_mid wind (/grid and the static wind frames) at the 2 of every 3 hours f001-f119 that are not 3-hourly steps.
- **Before:** the nearest 3-hourly product, which the client interpolates. The offline hold-out (3 GFS runs, 2026-10-25) left
  0.89 m/s vector RMSE between the best interpolation and NOAA's real hour.
- **After:** NOAA's own hourly field, stored to f120.
- Ratings that read wind at those hours move with it. That is why it is a D-065 change: code default ON, a kill switch, a
  `_RATING_FLAGS` entry, a SCOREBOARD row, and the default-on history filter on the PR.

## The change (opus/wind-hourly-ship-on)

- **Code default:** `wind_mid_res_ingestion.gfs_wind_hourly_until` returns 120 unless FRAME_WIND_GFS_HOURLY = '0'.
- **Pilots workflow:** defaults '1'.
- **Kill switch:** the repository variable FRAME_WIND_GFS_HOURLY = '0', which is David's word, or a revert.
- **Test:** `test_noaa_gfs_wind` proves unset = hourly to f120, and that '0' restores the pre-flip fetch (3-hourly), by two
  ingests whose requests are [120, None].
- **Registry:** `_RATING_FLAGS` has the entry on its opener line; the file stays at its 800-line cap.
  `test_flag_lane_parity` passes.

## Cost and the frames-budget gate

- **Cost:** +80 hourly steps of byte-range GRIB a run (about 1.16 MB each, about 93 MB of download), and +80 wind frames
  (about 51 KB each, about 4 MB on the CDN).
- **Frames step:** the wind set was 29-38 s a run; hourly adds about 80 frames, so roughly +25 s inside #996's 1,500 s.
- **Under the frames-budget plan's item 3:** the first pilots run after this merges builds the new hours once. It is excluded,
  and named before that run's gate lines are read.

## 16:18Z: what the evidence is, and what checks it (the advisor's condition, 16:17Z)

- **The default-on history filter did not evaluate this flag.** The PR's check "filter" is green, but its log reads "SKIPPED the
  history replay: no cache", and its row is `FRAME_WIND_GFS_HOURLY | SKIPPED | no | no cached history window`. The filter is
  also blind to it by design: its primary is wave height at stations, which hourly wind does not move.
- **The live guardrail (flag-guardrail.yml) is BLIND to wind.** Nothing will auto-disable it. The registry tag now says
  "guardrail BLIND, filter SKIPPED".
- **The evidence is an offline hold-out of 3 GFS runs, model against model:** 0.89 m/s vector RMSE between our best interpolation
  and NOAA's own hourly field. It is NOT a skill test against observations. The reason to ship is that it replaces our
  interpolation with NOAA's published field at those hours, not a measured gain at the buoys.
- **The kill switch:** the repository variable FRAME_WIND_GFS_HOURLY = '0' (David's word), or a revert PR.
