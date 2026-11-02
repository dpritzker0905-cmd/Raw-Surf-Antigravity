# 2026-11-01: item 13, GFS pilot full horizon (Claude, side session of the lead; branch `claude/gfs-pilot-full-horizon`)

Sibling logs from the same session: `2026-11-01-claude-ingest-items-13-15.md` (item 15 and the EURO boundary-hour
gap). Base `dev` 340e70c07. Nothing dispatched, flipped or pushed.

## What sets the horizon (read in code and workflow)
- `.github/workflows/forecast-ingest-pilots.yml` sets `GFS_MARINE_FORECAST_DAYS: '5'` (8 d -> 3 d on 07-13 -> 5 d
  on 08-01). Its WHY comment says the coarse-vs-fine benefit was measured to day 5 only: "Do not raise further without
  re-running both instruments" (`scripts/tier_resolution_delta.py` plus the constant-tier spread check).
- `flagship_pilot_days` gives the 14 d flagship horizon only to `REGIONAL_CONFIGS` (florida_east_coast,
  us_west_coast_socal). The other 17 boxes (12 worldwide, 4 F-08 Stage A extras, us_pacific_northwest) take 5 d.
- The 10-26T14Z CDN audit (shared notes, `owner-manual-test-2026-10-26/cdn-coverage-and-tail-readiness/audit_1400.json`)
  read 113/115 frames for the two flagships and 41/45 for the other 17, gap `h116-h336`. The "16 of 19" in earlier logs
  is 17 of 19 (the 19 boxes are 2 + 12 + 4 + 1).
- The fetcher steps three-hourly (`noaa_gfs_wave_fetcher.py`: `range(0, max_f + 1, 3)`), so 5 d = 41 steps and
  14 d = 113. The flagship pass already downloads f384 when `GFS_WORLD_FULL_HORIZON=1` (a repo variable since 10-25).

## The change (draft PR, DARK)
- `pilot_regions.gfs_marine_pilot_days(region_id)`: one function holds the env reads; both scheduler call sites
  (multi-bbox pass and per-region fallback) call it. `GFS_PILOT_FULL_HORIZON=1` raises the worldwide horizon to the
  flagship's (never lowers a longer setting).
- Wired in `forecast-ingest-pilots.yml` as `${{ vars.GFS_PILOT_FULL_HORIZON || '0' }}` with a WHY comment, and in
  `_RATING_FLAGS`. `GFS_MARINE_FORECAST_DAYS: '5'` is untouched.
- Tests: `tests/test_gfs_pilot_full_horizon.py`, 6 (chain lane; floor 3019 -> 3035, set from 3041, files 185), incl.
  the cost claim: flag on, every box rides ONE 14 d pass (no new download pass). `test_flagship_pilot_horizon.py`'s
  source-text guard now checks the helper. Local: 9 passed for those two files; the pilot/day-14/parity suites 107 of
  109 before those two fixes.

## Cost and risk, stated for the flip decision
- Download: the 41-step 5 d pass disappears (the 17 boxes join the f384 flagship pass). Net fewer GRIB steps.
- Products: ~17 boxes x 4 layers x (113 - 41) = ~4,900 more per fire (about 2,800 -> 7,700), on a ~12k manifest.
  Scaled from Stage A (4 boxes, ~220 products, ~55 MB) that is roughly +300 MB of Render RSS on a box measured at
  460-709 MB of 2 GB. Unmeasured scaling.
- Frames: ~4,900 more regional frames into `FRAME_PUBLISH_BUDGET_S` (960 s with tails). Regional bundle sets publish
  last, so they are the first skipped if the budget runs out. Per-frame cost not measured here.
- **Served numbers change when flipped** (z7-9 GFS past day 5 from the 0.25-deg tile instead of the 2-deg tier or
  `/grid`): owner's word with evidence (D-001), a SCOREBOARD row, and the day-5+ instruments the workflow comment asks
  for. None while dark.
- Suggested flip check: one pilots run with the variable set; `[Pipeline Scheduler] GFS-Wave multi-region OK: N
  regions in one 14d pass` with N = 19 (+ global_mid when its horizon matches) and no 5d pass line; Render memory over
  the next cycle; the frame step's summary shows regional sets built, not budget-skipped.
