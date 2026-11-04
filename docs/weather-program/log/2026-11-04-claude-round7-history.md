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

## Resumed 2026-11-04 (after the reboot): results

Scope cut by the lead (budget): W1 2024-12, W4 2025-10 and W26 2026-10-06..10-31 only; no Reflection, SubQ or LongCat
calls. The BHC EURO feed uses the previous 00/12 run at step+6 for 06/18 cycles, because EURO has no 06/18 wave
before 2026: 15,456 same-cycle and 15,456 previous-cycle reads in W1. Input versions: one GFS-Wave GRIB fingerprint
across the windows (backfill index #719). The EURO IFS cycle was not checked: 49r1 (Nov 2024) precedes W1.

The scorecard is `flip-candidates/scorecards/round7/README.md`; the numbers are in `history-gate-2026-11-04.json`.

- **SURF_BIGHT_HS_CONSENSUS PASSES on history.** Bight buoys gain +0.155 m [0.089, 0.196] (two-way), and every season
  is positive (W1 +0.19, W4 +0.14, W26 +0.14). The bias goes from -0.32 to -0.18. The hs_station and hb_proxy no-harm
  checks pass. The EURO weight 1.0 variant does not beat 0.5: hb bias is +0.33 and W1's CI crosses 0.
- **SURF_SPECTRAL_K FAILS.**
  - The hs_station gain is +0.015 [-0.008, 0.043], and hb_proxy is significantly worse (-0.136).
  - Diagnosis: K's fresh-window gain was level compensation of the chain-wide low bias. Once the instrument's shelf
    attenuation is removed (NSI), K costs -0.044 at Bight stations.
  - Proposed variant (not tested; budget): K only where real headland shelter exists (Avila type, 285p1 has no history
    before 2026-09) and BHC as the level fix.
- **SURF_EXPOSURE_RECONCILED FAILS everywhere** (-0.024 [-0.039, -0.006]). It deepens the low bias (-0.347 -> -0.374).
  Retest only after a level fix (BHC).
- **SURF_TIDE_DEPTH is INERT.** Zero heights moved in 46,368 spot-hours. It acts only on the depth-limited breaking
  cap, which no hour in these windows reached.
- **NSI** (`model_hs_from_nearshore_input` from the ETOPO stencil depth; this is the harness instrument, not a served
  number) **gains +0.119 [0.049, 0.187]**.
  - It is positive in both cell-depth strata: < 50 m +0.16, > 200 m +0.11. No station has a 50-200 m cell.
  - It is worse at sheltered 266p1 (-0.28).
  - The instrument double-counts shelf attenuation, so every hs_station verdict here is conservative.
- **Combined:**
  - BHC + SSK + TIDE scores +0.066 [0.011, 0.136], less than BHC alone (+0.124): SSK drags it down.
  - Adding EXPOSURE makes it FAIL (+0.054 [-0.007, 0.117]).
  - The recommended combination is BHC (+ TIDE, inert).

Ready for a turn-on PR: SURF_BIGHT_HS_CONSENSUS (w 0.5). SURF_TIDE_DEPTH could ride along, as no harm was measured
(no gain either).
