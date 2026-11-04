# 2026-11-04 (claude, round7-history): every built forecast fix ON against historical data (research only)

Branch `claude/round7-history` from dev 8a401da41, worktree `C:/t/r7` (docs only). Research and testing only: no flag
flip, env, deploy, merge, or backend call. Owner, 2026-11-04 ~00:42Z: "I dont want any fixes set at OFF. We need them
all on, and testing against historical data."

## Pre-registration (written BEFORE any arm was scored)

- Windows: W1 2024-12-01..12-28 (winter), W2 2025-03-01..03-28 (spring), W3 2025-07-01..07-28 (summer),
  W4 2025-10-01..10-28 (autumn), plus 2026-10-06..10-19 and 2026-10-20..10-31. 6-h targets, leads 24/48/72.
  Model inputs from 2024 onward only (production parity); input-version breaks flagged from GRIB keys.
- Stations: union of the SSK list (C:/t/flip-run/stations10.json) and the BHC list (stations_r5.json, 8 CDIP
  nearshore + 14 NDBC) + the 11 Bight NDBC buoys of round 6 + CA pairs in data/nearshore_validation_pairs.json with an
  anchor <= 20 km. A station is scored in a window only if its truth covers >= 50% of the window's targets
  (coverage inventory: `flip-candidates/scorecards/round7/cdip-coverage-inventory-2026-11-04.json`; e.g. 285p1 has no
  archive before 2026-09-21, 284p1 starts 2025-07-09, 101p1 ends 2025-01-03, 266p1 ends 2025-10-18).
- Truth: CDIP realtime or archive `_historic.nc` (whichever covers), NDBC historical stdmet.
- Arms: SURF_EXPOSURE_RECONCILED, SURF_TIDE_DEPTH, RATING_BREAKER_TYPE (impact only: moves no Hs),
  SURF_SPECTRAL_K (#706 head 7bad5ab74), SURF_BIGHT_HS_CONSENSUS (#707 head 6a5258515; EURO weight w = 0.5 production,
  variants w = 0.75 and 1.0), ANCHOR_DEEP_READ once its branch exists, the offline nearshore-input station read
  (drop shelf attenuation) x SURF_SPECTRAL_K factorial, COMBINED (all Hs-moving arms on).
  CONSENSUS_DIRECTION_VECTOR, ALERTS_FORECAST_WINDOWS, RATING_WIND_HRRR (#711) and ICON_ISLAND_SHADOW need their own
  truth (direction, alert replay, anemometers, Hawaii Waveriders).
- Factorial strata (pre-registered): sampled-cell depth (`inputs.shelf_depth_m` of the anchor's replay row)
  < 50 m / 50-200 m / > 200 m; exposure sheltered vs open.
- Gate: binding = two-way (spatial block ~100 km x day) bootstrap CI of the pooled gain (absolute error) excluding 0,
  >= 14 days; the station-cluster CI reported as advisory. PASS = pooled CI > 0 AND no season or region
  significantly worse after Holm. Null (identical) and positive (20% less error) / negative (25% more) controls in
  every window. BHC binding quantity = hs_offshore at the Bight buoys, with hs_station and hb_proxy no-harm.

## Checkpoint for restart (2026-11-04, SAFE PAUSE requested by the lead)

- DONE: read CLAUDE.md, the harness contract, journal rounds 5-6, #712's scorecards, PR bodies #706/#707/#711; CDIP
  realtime/archive coverage inventory for 33 CA stations (committed here); pre-registration above; worktree C:/t/r7.
- Local research tree (NEVER pushed): detached worktree `C:/t/r7c` = dev 8a401da41 + merge 7bad5ab74 (#706) + merge
  6a5258515 (#707), workflow conflicts union-resolved, local commit 25c832896. Scratch `C:/t/r7w/` (inv_cdip.py,
  cdip_inventory.json).
- IN FLIGHT: nothing. No download started; no cache written. C:/t/hist-cache (backfill agent) did not exist yet;
  claude/anchor-deep-read, claude/harness-two-way-gate, claude/alerts-dedupe-cap had no pushed commits.
- EXACT NEXT STEP: write `C:/t/r7w/r7_run.py` = the BHC r5_arms.py pattern on C:/t/r7c (EURO input substitution with
  weights) + a truth patch of eval_reference.fetch_station to CDIP `_historic.nc` hyperslabs / NDBC historical stdmet,
  + an offline NSI arm (model_hs_from_nearshore_input), then run W4 first (cache under C:/t/hist-cache if it exists,
  else C:/t/r7w/cache), score with round 6's twoway_ci (bhc/twoway.py pattern).
- Moved aside (not deleted): stale pytest temp dirs that occupied C:/t/r7 -> `C:/t/r7-pytest-2026-11-01`.
