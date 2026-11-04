# 2026-11-03 · claude · Spot-hub phase 2: the hub on THE ONE composition (ON by default, kill `SPOT_HUB_RATE_ONE_SPOT=0`)

Session: a delegated subagent of the lead. Branch `claude/spot-hub-phase2`, cut from `origin/dev` `35feaaac6` and
rebased onto `b308e37b6` (#704). Owner's words: "our own logic to generate our own forecasting charts that work in
the rating color codes" (2026-11-03 ~03:41Z); phase 1 approved and merged as #698; "lets keep moving forward toward
state of the art weather simulation system features" (~16:19Z). DRAFT PR only: nothing merged, no flag flipped, no
Render/Netlify env change, no workflow dispatch, no live backend or app call. Research of record: memory
`research-spot-hubs-forecast-charts-2026-11-03.md` (M1-M13).

## 2026-11-04 update: ON by default

The lead relayed the owner's policy change (~01:41Z): "fixes now ship ON by default with a kill switch, plus a history
filter and a live guardrail; nothing is built dark", with `SPOT_HUB_RATE_ONE_SPOT` and `SPOT_SERIES_PUBLISH` defaulting
to `"1"` and `"0"` kept as the kill switch. Done: the read is `os.environ.get("SPOT_HUB_RATE_ONE_SPOT", "1") != "0"`,
the registry default is `"1"`. The history filter and the live guardrail are the lead's `claude/default-on-guardrails`
PR, which lands first. Seven legacy-contract test files (`test_audit_conditions_isolation`,
`test_conditions_batch_precompute`, `test_forecast_tier_window`, `test_spot_conditions_batch_bounds`,
`test_spot_details_forecast_deadline`, `test_spot_hub_data_source`, `test_spot_hub_local_size_reference`) pin the
KILL-SWITCH chain with an autouse `SPOT_HUB_RATE_ONE_SPOT=0` fixture; the default path's route, tier-window and
size-reference equivalents were added to `test_spot_hub_rate_one_spot.py` (now 20 tests). The tier windows are
unchanged (free 72 h rolling as the phase-1 resolver echo has it, basic 7 d, premium 14 d; "day-of + 2" vs rolling
72 h stays the owner decision phase 1 recorded). Everything below that says "dark" or "flip" describes the
pre-policy build; the evidence stands, and the flip-gate list is now the merge gate.

## What changed

`SPOT_HUB_RATE_ONE_SPOT` (default `'0'`, read at call time in `spot_conditions.resolve_spot_conditions_impl`,
registered in `_RATING_FLAGS` with lane "Render env": only the serve box runs the hub, the same as
`SPOT_HUB_SURF_TRANSFORM`, so no workflow declares it).

With `'1'`, `services/weather_pipeline/spot_hub_composition.py` answers the hub, the drawer (`/conditions/{id}`,
`/conditions/forecast/{id}`, `/conditions/batch` live lane), alerts and explore:

| Mismatch | Before | With the flag |
|---|---|---|
| M3 product choice | `find_cached_grid_product` + `sampler.sample_point` (the hub's own pick) | `rate_one_spot` -> `resolve_point` (the glyph's pick) |
| M3 tide / breaker | `tide_norm`, `best_tide`, `breaker_xi` never passed | the glyph's spot dict (`spot_meta_of`, same keys as `/spot-ratings`' `_rate`), so `RATING_TIDE` / `RATING_BREAKER_TYPE` reach the hub exactly as they reach the glyph |
| M3 rounding | rated `round(ft, 1) / 3.28084` | rated on the exact `surf_height_m`; ft only at the display boundary |
| M3 "now" | nearest 3 h | top of the UTC hour (the glyph precompute's base); the glyph's precomputed item first (fresh -> stale ladder, as `/point-rating`), else `rate_one_spot` + `gate_single_model_surface` |
| M1 daily rows | one 12:00 UTC sample per UTC day, "max", min = 0.6 x max | the spot's LOCAL (solar) day; `wave_height_max` / `wave_height_min` = real max / min over the frames that resolved; `rating` = the day's best frame (`rating_basis: "best_frame"`, `rating_time`); `frames_planned`, `frames_rated`, `sample_basis`, `utc_offset_hours`, `max_time` |
| M13 source mixing | a miss on any of 11 frames -> an Open-Meteo point fallback for the missing ones | no provider fallback: a frame that does not resolve is unknown (`no_data`), never 0 ft |
| tier window | all rows computed, then trimmed | frames stop at the window the route passes (`forecast_tier_window.tier_horizon_hours`); rows beyond it are `not_computed` and `apply_tier_window` names them in `forecast_locked_dates` |

ONE frame plan for the hub AND the phase-3 chart series (`frame_plan`): 3-hourly on the UTC grid to +72 h, then
local 06/12/18 solar per day, each snapped to the 3-hourly grid (07/13/19 at -8 h). ~57 frames to +336 h.

LOCAL DAY = solar time, `round(lng / 15)` h. The catalogue has no timezone column and the backend no tz database;
solar time is within ~1-2 h of civil time almost everywhere (Hawaii reads -11, civil -10). Every row carries the
offset. An owner decision if civil time is wanted (a tz column or a tz lookup asset).

`wind_relation` was extracted from `spot_ratings.rating_why` (pure refactor, the why-text is byte-identical) so the
hub's wind word is the why-text's word.

Routes pass the new kwargs ONLY while the flag is on (`spot_hub_composition.call_kwargs`, `{}` when off), so a
flag-off call is the exact call made before and every test fake of that signature still works.

## Evidence

- **Flag off is byte-identical** to origin/dev's hub code: the legacy fixture through this branch's
  `resolve_spot_conditions_impl` and through `git show origin/dev:...spot_conditions.py` loaded as a module, frozen
  clock: both 2,739 bytes, sha256 prefix `012b054f40e4b800` (scratch script `cmp_old.py`, not committed). In the
  suite: unset == `'0'` == `'0'` with the new kwargs (`test_flag_off_is_byte_identical`).
- **Parity** (`tests/test_spot_hub_rate_one_spot.py`, 15 tests, real `rate_one_spot`, a fake point resolver):
  - live lane: hub `surf_height_m` == `/point-rating`'s == `rate_one_spot`'s, hub `rating` == `/point-rating`
    `score` == the gated `rate_one_spot` score, `rating_raw` == the ungated score;
  - precomputed lane: hub == `/point-rating` item == `/spot-ratings` `select_precomputed_laddered` item
    (1.437 m / 61.3 / fair_good), and the marine point is NOT re-resolved;
  - tide term: with `RATING_TIDE=1` and `best_tide='high'` the hub's raw score equals `rate_one_spot` on the
    spot's own dict (and differs from `best_tide=None`, the setup control);
  - every daily row's max / min / best rating recomputed independently from `rate_one_spot` at that day's frames.
- **M1**: at Trestles (-8 h) the first row is local 2026-11-04, 8 three-hourly frames, max at 21Z, above the 12Z
  sample; min is measured, not 0.6 x max.
- Existing suites green locally: 379 passed / 39 skipped over the hub, conditions, alerts, point-rating, spot-ratings,
  tier-window, flag-lane and composition-parity files (`test_precompute_follows_pilots` caught the new module
  missing from `precompute.yml`'s push paths; added).

## Cost on the 1-CPU box (why the flip needs a budget)

One frame = one `rate_one_spot` (~54 ms warm in CI run 41491110869). Cold hub build: free 72 h = 1 + ~21 frames
(today's remaining hours are not rated), premium = 1 + ~45. Bounded by: live frames cached 15 min per (model, spot,
hour, ref); 2 frames at once per build; the whole payload built ONCE per (model, spot, window, hour, flags) with
concurrent viewers awaiting that build (shielded, so the opt-in deadline does not cancel it) and repeats inside 5 min
read it. Every live forecast frame also takes the single-model gate, which caps beyond the glyph's +0/+3 h frames
at 69.9 unless the confirmation object says otherwise: "what the app shows" for those hours today.

## Reviews

- Reflection (Beam, high), pass 1 without code by mistake: ranked load first; asked for a whole-payload cache with
  in-flight coalescing. **Done** (`_PAYLOAD`, `_BUILDING`, `test_one_build_serves_concurrent_and_repeat_viewers`).
  Its tier-clip concern (12:00 UTC of a local date) checked: for |offset| <= 12 that instant always lies inside the
  local day, and frames never pass the window, so no beyond-window data reaches a sent row.
- Reflection pass 2 with code (compressed): its "critical" items were artefacts of my pseudocode (`lat`, `.hours`,
  `scored` exist in the real file). Its by-id vs nearest-within-2 km point: kept by id on purpose (the hub knows its
  spot; nearest could be a neighbour); identical to `/point-rating` at the spot's own coordinate except co-located
  duplicate pins.

## Flip gate (owner's word; none of it done here)

1. This PR's parity tests green in hosted CI (guards lane must read 3465).
2. A scorecard read that hub ratings equal glyph ratings on real products: the phase-3 dry-run job
   (`spot-series.yml`, `--hub-parity`) compares the hub path with `rate_one_spot` for sampled spots offline.
3. A measured CPU budget for a cold premium hub build on Render (one short scenario, `/api/health` before/after).
4. The owner's word, then `SPOT_HUB_RATE_ONE_SPOT=1` in Render env, and a SCOREBOARD row with the read-back.
Rollback: `SPOT_HUB_RATE_ONE_SPOT=0` (read per call, no deploy).

## Owner decisions

- Flip phase 2 (after the gate above).
- Solar local day vs civil time (needs a timezone source).
- Daily `rating` = the day's best frame (alternatives: AM/PM parts, the rating at the max-height hour).
