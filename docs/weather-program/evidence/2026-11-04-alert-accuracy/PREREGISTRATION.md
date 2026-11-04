# Pre-registration: ALERTS_FORECAST_WINDOWS precision levers (2026-11-04, claude, branch `claude/alert-accuracy`)

Committed BEFORE any lever is scored in the replay. Only the wind-skill measurement and the error-model fit have
run when this file is committed. Nothing below may be changed after scoring starts; any later deviation is listed
in the session log as a deviation, with its reason.

## The bar (unchanged from #712 / #718; never moved)

Per alert class (`size_only_2_6ft`, `morning_afternoon_offshore_light`, `dawn_morning_clean_mid_high_tide`):
window **precision >= 0.80 AND recall >= 0.85** (the replay's `new_precision`, `new_recall`), **max sends per
user-day <= 2**, **0 sends outside the tier window**. Binding row: **sigma = 1** (the measured error model as
measured). sigma = 0 (perfect-forecast control) and sigma = 2 (doubled error, stress) are reported, not gating.

## Instrument

- `backend/scripts/alert_window_replay.py`: the same 3 spots (Cocoa Beach FL, Scripps Pier CA, Duck Pier NC) x 3
  classes x seeds 0-4 as #718, hourly frames (`--step 1`), the shipped #718 defaults (merge gap 1, same-window
  suppression, cap 2/user-day, notify lead 24 h). Issues every 4 h, as #718.
- Data: #718's NDBC realtime2 / CO-OPS dir (`C:/t/flip-alertdata`) is not reachable from this sandbox (NDBC, CO-OPS
  and Open-Meteo are blocked by its network policy). The replay runs on an ARCHIVED window built by
  `scripts/alert_replay_inputs.py`: 2024-09-19 .. 2024-11-06 (the same calendar window one year earlier), wind truth =
  the REAL pier anemometers (TRDF1, LJPC1, DUKN7 via ISD), sea truth = GFS-Wave 0.25 analysis hours at the buoys,
  tide = synthetic astronomical (shared by truth and forecast). Both error-model arms run on this same data.

## Error model arms (paired: same data, seeds, users)

- **A0 assumed** = #718 exactly (wind sd 1.8 m/s + 0.4/day, dir 25 deg + 10/day, AR(1) rho 0.95/h, fresh per issue).
- **A1 measured** = `fit_error_model` of the GFS lane (the lane ratings and alerts read) at the replay's own three
  anemometers: per station x observed speed class (< 5 / 5-10 / 10-20 / >= 20 kt), speed-error bias and sd and
  direction-error sd, linear in lead; measured within-run hourly correlation; measured cross-cycle correlation
  (one valid time, runs 6 h apart) applied as a shared + fresh decomposition. Hs: #718's measured MAE by lead (vs
  buoys, SCOREBOARD 2026-09-29/30), with its persistence (hourly rho, cross-cycle correlation) measured from GFS-Wave
  forecasts against GFS-Wave analysis where the archive allows; otherwise #718's AR(1) fresh per issue, stated.
- A1 is the after-arm's error model. A0 is reported for continuity only.

## Levers (fixed parameters; each scored alone and in the listed combinations, on A1)

- **L1 AGREE (confidence gate, model agreement).** A window found in the alert's lane (GFS) is sent only if at least
  one PEER lane in the same horizon object (EURO in the replay; EURO or ICON in the product) also finds a qualifying
  window for the same alert that overlaps it by >= 1 h. A spot with no peer frames is not gated (fail open, logged).
  Replay peer: EURO wind = truth + the measured ECMWF error model, correlated with the GFS error at the measured
  GFS-ECMWF error correlation (speed and direction, pooled over leads). Peer Hs error: same MAE as GFS, correlated
  with the GFS Hs error at **rho_hs = 0.8** (not measurable here: no buoy truth); sensitivity rho_hs = 1.0.
- **L2 LEADQ (lead-dependent quality thresholds).** An hour at lead L h (after the run time) qualifies only with
  margins scaled by m = L / 24: size band [min x (1 + 0.10 m), max x (1 - 0.10 m)]; light-wind needs < 10 - 1.0 m kt;
  clean needs < 5 - 0.5 m kt (or offshore <= 20 - 1.0 m kt); offshore needs offshoreness > 0.34 + 0.05 m. Variant
  **L2b** doubles every margin.
- **L3 HYST-L (hysteresis scaled by lead).** A window whose start is < 6 h after the run is sent on first sight;
  6-18 h needs an overlapping window in the previous 1 issued cycle; >= 18 h needs it in each of the previous 2.
- Combinations: L1+L2, L1+L3, L1+L2+L3.

## Decision rule

1. A configuration PASSES only if the bar holds for all three classes at sigma 1 under A1 **with rho_hs = 0.8 AND
   with rho_hs = 1.0** (for configurations containing L1; others do not depend on rho_hs).
2. Adoption order (the first passing configuration is adopted; fewer product changes first): L1, L2, L2b, L3,
   L1+L2, L1+L3, L1+L2+L3.
3. If one passes: ALERTS_FORECAST_WINDOWS's code default flips to '1' (kill switch '0'), the lever ships ON inside
   it with its own kill switch, the 2/day cap stays, and the flag joins the guardrail GUARDED list.
4. If none passes: FAIL is reported, the flag stays default '0', and the closest configuration is reported with
   the class and number it misses by. The bar is not moved.
