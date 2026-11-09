# 2026-11-08 — Claude weather lead: marine render session (evening)

Append-only session log. Evidence is live dev reads (`dev--rawsurf.netlify.app/map?diag=1`), bounded: one map tab, a few pans,
`/api/health` probed before and after (healthy both times). No load test was run.

## Shipped (merged to dev, owner-named)
- #744 opt-in map-clear recorder (`?diag=1`, kill `__RAW_DISABLE_SOAK_RECORDER__`) + TideReadout fixture-clock fix.
- #745 EURO atmospheric cycle cadence 12h as ingested (health threshold only; stops the daily ~18Z false WARN).
- #746 marine render fixes, each ON with a kill switch:
  `__RAW_DISABLE_FINER_RESIDENT_HOLD__`, `__RAW_DISABLE_LANE_SWITCH_REGIONAL_FIRST__`, `__RAW_DISABLE_UNPATCHED_MASK_HOLD__`.

## Measured before #746 (12-lane sweep, 100 ms sampler of the drawn grid)
- Every lane switch first drew the 2 deg world frame (181x83 = 15023 vectors) or a 2 deg clip, then the regional window.
  Example: ICON wind_waves resident 13x13 at 0.5 deg replaced by 8x9 at 2.0 deg, then the world frame (2.0 deg).
- Every pan's `moveend` fetch was followed 0.2-1.0 s later by a `clamp_resharpen` re-drive. 97 "detach" entries were false;
  they counted fetches that had already landed.
- EURO/waves drew one 200 ms frame with no data. EURO swell, swell2 and wind_waves drew 30 vectors.

## Verified after #746 deployed (bundle chunk contains all three switches; backend at the #746 merge)
- ICON wind_waves at z9 over 3 pans: `clamp_resharpen` re-drives 0 (each pan triggered one before), false detach 0, empty frames 0.
- `__MARINE_FINER_HELD__.count` = 2: the hold kept the 13x17 grid (0.235 deg) over a same-size 21x17 clip.
- REMAINING: on layer activation the 2 deg world frame replaced the 0.25 deg regional grid at t=1.6 s and stayed ~17 s, until
  a pan. #746 exempts world grids on purpose (engine base wash); being fixed on a branch, not merged.
- The lagoon (unpatched-mask) hold could not be timed live: the browser pane was throttled to ~1 timer tick/s.

## New finding: opposing particle fields (owner report, 20:44 EST)
On the live ICON wind_waves 13x17 grid, 45 of 170 wet cells have EXACTLY direction=180, period=1, u=0, v=+height. They cluster
in the coastal columns (lng -81 .. -80.25) and at lat 28-30. Real neighbours read e.g. 54 deg / 1.45 s. A 180 deg placeholder
drives particles north while the real field moves SW, which is the "two fields opposing" look. This looks like a missing value
decoded as data. Being traced on a branch: the fix must not invent a direction (honest no-direction, or a neighbour fill with
lowered confidence).

## Open
- EURO/waves blank frame (cross-model switch, likely an empty grid committed) — branch in progress.
- EURO/marine provenance warn — draft #747 adds `model_cycle_unverified_cohorts` (diagnostic only; no verdict change).
- #743 re-derived on current dev: head 01288107f, guards floor 3562 -> 3579 (hosted must read 3585). Not merged; owner names merges.
  #743 and #747 both move the guards floor, so whichever merges second re-derives.
- Idle WebGL fallback: context-loss restore is wired; no live repro. Proxy/429: handled by the breaker and client cooldown;
  the Open-Meteo skip is an owner decision (recommendation: keep, plus a flagged partial-hours coverage skip).
- Swell 2 sparse: data-limited (WW3 partitions are zero), not coverage.

## Opposing fields: upstream forensics (21:20 EST)
Direct Open-Meteo marine queries at the same cells (2026-11-09T00-01Z): `gwam` returns EXACTLY dir 180 / period 1.0 at
27.0,-80.25 (H 0.12), with real values at neighbours (dir 27-79, 1.15-1.65 s). So the placeholder is PROVIDER data, not our decoder.
Other models at the same cells: ncep_gfswave025 gives an all-zero fill (H 0, dir 0, per 0); ecmwf_wam025 gives null; meteofrance_wave
gives real tiny seas (0.4-0.7 s). Planned classification: GWAM direction == 180 AND period <= 1.0 means "direction undefined" (keep the
height). The fix is on a branch. A Playwright timing probe of the lagoon hold was blocked by the beta access gate (no credentials
entered).

## Placeholder scan, every marine layer (21:30 EST; Open-Meteo marine, 24 points x 7 h: FL coast and lagoons, Keys, Gulf, HI, CA)
| model | waves | swell | swell2 | wind_waves |
|---|---|---|---|---|
| gwam (ICON) | clean | clean | ALL null (no secondary swell) | 38/168 dir 180 + per <= 1.0 placeholder |
| ncep_gfswave025 | 42 zero-fill | 53 zero-fill | 108 zero-fill | 83 zero-fill |
| ecmwf_wam025 | clean | null | null | null |
Only GWAM wind waves invents a direction. GFS's H=0/dir=0 fill must render as calm (being checked on the fix branch). ICON Swell 2
looks sparse because GWAM sends no secondary swell at all through this provider.
EURO/waves 200 ms blank: root cause NOT proven. The only unattributed clear found is an encoder throw (WebGLMarineTextureEncoder
~779 nulls the textures), now logged as `__WEBGL_MARINE_ENCODE_THROW__` / `engine_encode_throw`. World-over-regional hold
(`__RAW_DISABLE_WORLD_OVER_REGIONAL_HOLD__`) is on a branch.

## Nearshore validation (Codex relay, 21:10 EST; verified in code)
- Latest Nearshore Validation run 42543128074 (Nov 9 00:59Z) failed. 16 archived MOP runs were read, but grading refused at
  9 station-hours against the 30 minimum (GRADED_MIN_STATION_HOURS), with 2 live stations and the surf-zone grade skipped.
  That is insufficient evidence, not a scientific failure. MOP ingest 42545007135 (01:19Z) succeeded; validation hasn't recovered yet.
- Pair-table cutoff, verified: `backend/data/nearshore_validation_pairs.json` generated_at 2026-08-15T23:15:44Z (85.1 days old on
  Nov 8); `PAIRS_MAX_AGE_DAYS = 90.0` (nearshore_validation.py:40), so validation HARD-REFUSES at **2026-11-13T23:15:44Z**.
  It has warned since day 75 (run_nearshore_validation.py:194).
- Refresh owner: Claude weather lead. Plan: rerun `backend/scripts/build_nearshore_pairs.py` (it reads CDIP, not our backend),
  review the diff (station identities only; no grading gate changes), and open a PR for the owner to name before Nov 13.
  The 30 station-hour gate stays as it is.
