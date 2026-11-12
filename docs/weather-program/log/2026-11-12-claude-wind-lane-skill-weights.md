# 2026-11-12: the skill-weighted wind lane, built DARK (branch `claude/wind-lane-skill-weights`)

Brief (lead session): build option A of the HRRR wind grade's proposal (log 2026-11-11-claude-hrrr-wind-grade.md §4,
draft PR #798) dark. Commit the weight sweep that was never committed, reproduce its 26/28 result, put a per-region,
per-lead cap on HRRR's weight behind a new default-off flag, test both flag states, record it. Draft PR to `dev`; the
flip is the owner's word only. Offline only: nothing touched the Render box, Supabase, a workflow or an env var. This
log is written only by this session. All times UTC.

## 1. The sweep, committed and reproduced

`backend/scripts/sweep_wind_lane_weight.py` is the 2026-11-11 scratch `wsweep.py` (it was found intact in the shared
scratchpad and is reproduced byte-for-byte in its published cells), plus a two-region fit for the table.
- **Input:** the matched pairs `grade_wind_lane_ndbc.py --rows` writes (PR #798's script; it reads only NOAA AWS HRRR
  and GFS byte ranges and NDBC realtime2). The sweep itself reads only those rows.
- **Blend at the buoy:** scalar speed `w*lane + (1-w)*gfs`, bearing from the blended vector, as `wind_lane._blend`.
- **Split:** fit on rows whose (day of month + cycle hour / 6) is odd, score on the even rows; w grid 0.0..1.0 step 0.1.
- **Reproduction (instrument: the grade rerun from its archive cache, then the sweep):** the grade was rerun from the
  2026-11-11 session's cache of public-archive reductions (`--cache`, 252 MB, outside the repo: HRRR area means and
  native cells, GFS sub-arrays, NDBC realtime2 files, the HRRR land mask), 100 cycles 2026-10-15 00Z..11-08 18Z,
  38,709 rows, and gave the same rule triggers as #798. The sweep on those rows: **held-out blend beats both members
  in 26 of 28 published cells**, the same two misses (L3 Gulf offshore n 199, L3 West offshore n 291, both under the
  n 300 rule), and the sweep and table outputs are identical to the run on #798's own rows (`cmp`).
- **Window:** NDBC realtime2 keeps 45 days, so a from-scratch rerun of this window works until about 2026-11-29; the
  cache keeps the NDBC files, so the cached rerun keeps working after that.
- Evidence: `evidence/wind-lane-skill-sweep-2026-11-12.json` (both cell sets, every n, all-row and held-out RMSEs).

### The table (what the flag reads): `services/weather_pipeline/wind_lane_skill_weights.json`

Regions by WMO prefix of the fitted buoys: **west** = 46 (Pacific, 23 buoys); **east** = 41/42/44 (Atlantic + Gulf,
41 buoys; the Gulf's 4 buoys are under n 300 on their own, so they are pooled with the Atlantic). Full-weight buoys
only (space weight 1), coastal and offshore pooled. Vector RMSE, kn, on the held-out even cycles.

| lead | region | n | fitted w_max | held-out blend | GFS | lane today | blend - lane | blend - GFS |
|---|---|---|---|---|---|---|---|---|
| L3 | west | 2267 | 0.4 | 4.46 | 4.51 | 5.14 | -0.68 | -0.05 |
| L12 | west | 2266 | 0.3 | 5.29 | 5.47 | 6.07 | -0.78 | -0.18 |
| L24 | west | 2266 | 0.2 | 5.55 | 5.77 | 6.75 | -1.20 | -0.22 |
| L36 | west | 2265 | 0.2 | 5.98 | 6.21 | 7.21 | -1.23 | -0.23 |
| L3 | east | 3909 | 0.5 | 5.39 | 5.52 | 5.71 | -0.32 | -0.13 |
| L12 | east | 3909 | 0.6 | 5.59 | 5.83 | 5.84 | -0.25 | -0.24 |
| L24 | east | 3911 | 0.5 | 5.79 | 6.12 | 6.09 | -0.30 | -0.33 |
| L36 | east | 3911 | 0.5 | 6.24 | 6.59 | 6.76 | -0.52 | -0.35 |

**8 of 8 table cells beat both members held out.** The L12 east 0.6 is the fit as found (its neighbours are 0.5); it is
kept rather than smoothed so the table is exactly what the committed script prints.

## 2. The lane change (dark: `WIND_LANE_SKILL_WEIGHTS`, default `'0'`, Render env)

- **Where:** `wind_lane.lane_use`, the one function both `/grid` (`_blend`) and the static wind frames' publisher call.
  With the flag on, each node's HRRR weight is `min(space_weight x time_weight, cap(lon, lead))`.
  - `min`, not a product: the fitted w is HRRR's TOTAL weight at a lead (measured where space and time weights were
    1), so the cap bites only in the interior. The 200 km feather and the 3 h taper still take the weight to 0 at
    HRRR's edge and horizon (at L46/47/48 east reads 0.5/0.5/0.25, west 0.2/0.2/0.2; past L48, GFS).
  - **Lead** = hours from the HRRR cycle to the valid time; linear between 3/12/24/36 h, flat outside (L0-3 at the L3
    value, L37-48 at L36). Linear so no hour boundary steps the field (the time-seam lesson of D-017).
  - **Region** = longitude: west of -112 the west row, east of -106 the east row, a cos^2 ramp between (over inland
    Nevada/Utah/Arizona, where no buoy is). No meridian steps the field. Land and the Great Lakes take their side's
    value: no buoy graded them, so this is the regional fit applied there, not a measurement there.
- **Module:** `services/weather_pipeline/wind_lane_skill.py` (flag, table loader with shape checks, `cap`, `west_share`,
  `lead_cap`). An unreadable or malformed table logs once (per distinct error) and blends uncapped; it never raises into
  `/grid` or `/capabilities`.
- **Stamps:** with the flag on, `box_state()` and the `/grid` `wind_lane` stamp carry `skill_weights` = the table id.
  With it off neither key exists, so `/capabilities` and every `/grid` byte are unchanged.
- **Static wind frames:** the publisher pins the flag OFF (`frame_set_wind.LANE_ENV_OVERRIDES`), so frames never cap.
  The client (`windStaticFrames.laneVerdict`) now also requires the box's `skill_weights` to equal the frames' (none):
  a box with the flag on sends the lane's hours (cycle to f48) to `/grid`, never to frames blended otherwise; GFS hours
  stay static. **Cost of a flip:** those ~48 lane hours per wind scrub go back to the 1-CPU box, as before #468. A
  follow-up can make the publisher apply the same table (identity carries the id) before or after the flip.
- **Out of scope, confirmed in code:** no spot point, rating, glyph, hub, alert or the sim reads the lane or the table.
  `tests/test_wind_hrrr_lane.py::test_only_the_grid_route_calls_the_lane` (existing) pins who imports `wind_lane`;
  the new `test_only_the_lane_reads_the_skill_table` pins that only `wind_lane.py` imports `wind_lane_skill`. This
  moves only the drawn wind MAP.
- **Registry:** `_RATING_FLAGS["WIND_LANE_SKILL_WEIGHTS"]` ("0", "Render env"; `routes/admin/surf_forecast.py` stays at
  798 lines: the WIND_HRRR_LANE description was joined onto one line, text unchanged), and
  `flag_guardrail.COVERAGE` BLIND (the replay cannot see the map; evidence is the grade + sweep). Not GUARDED: read
  from `os.environ` at call time, as the brief asked.

## 3. Tests

`backend/tests/test_wind_lane_skill_weights.py`, 34 tests, guards lane (`ci_test_lanes.py`):
- flag off (unset, "0", "", "true", "on", "yes"): `model_dump_json` of the served product equals the flag-unset
  product at L3/L24/L47, the cap function is never called (patched to raise), no `skill_weights` in stamp or
  box_state; full weight 1.0 at the interior nodes as shipped;
- flag on: west/east caps at L3/12/24/36, interpolated leads, the Gulf on the east row, outside-domain untouched,
  scalar speed + vector bearing;
- region ramp: endpoints, midpoint 0.5, 0..360 wrap, monotone, no step > 0.0021 per 0.01 deg, and the served field
  across -116..-102 at L24;
- lead taper: L45..L48 = min(w_t, cap) at both regions; past the horizon GFS; in the feather the lower space weight wins;
- an unreadable table blends uncapped; four malformed tables are refused; the checked-in table records its window,
  split and n (every n >= 300) and its own held-out claim;
- only `wind_lane.py` imports the module; the frames publisher pins the flag off; the registry entry is "0"/Render env
  and the guardrail coverage is BLIND; the sweep recovers a planted weight (0.3) on synthetic rows.
- Frontend: `windStaticFrames.test.js` (existing test, more assertions): a box with `skill_weights` refuses lane hours
  (`box_lane_differs`) and keeps GFS hours static; `skill_weights: null` serves as before. 61 wind suites, 1393 tests
  pass; `check_eslint.js` passes.
- Local: the new file plus test_wind_hrrr_lane, test_frame_set_wind(_rebuild), test_flag_lane_parity,
  test_flag_guardrail_v2, test_config_env, test_runtime_flags: 157 passed. flake8 gate clean; file-size check 0.
- Floor fragment: `.github/ci-floors.d/claude-wind-lane-skill-weights.guards.json` (+34 tests, +1 file); the script
  printed "this PR must read 3677 passed in the guards lane (set-from 3622 + 55; the CI step enforces 3671)" with the
  two other open fragments counted.

## 4. Proposed decision and what a flip needs

DECISIONS D-071 (proposed) reopens D-017's "full HRRR weight". A flip is the owner's word, then:
1. `WIND_LANE_SKILL_WEIGHTS=1` in Render env (the only reader); nothing else.
2. Read back: `GET /api/weather/wind_lane` shows `skill_weights`; one `/grid` GFS wind response inside HRRR carries
   `max_weight` <= 0.6 in its stamp. One short live read, not a load test.
3. Accept or first remove the frames cost in §2.
Rollback: unset the variable (or `0`).

## 5. Limits

- One season (mid-Oct to early Nov 2026), 25 days, 64 full-weight buoys; the Gulf alone is under n 300.
- A static table. The NBM's decaying-average update needs a scheduled wind truth lane (the grade on a cron), not built.
- Graded at buoys 3-55 km offshore; the cap over land and the Lakes is extrapolated.
- The sweep blends at the buoy, the lane blends at the 0.25-deg nodes then bilinear: equal for speed, different for
  the bearing only through the vectors' magnitudes.

## 6. Reproduce

```bash
cd backend
python scripts/grade_wind_lane_ndbc.py --start 2026-10-15T00 --end 2026-11-08T18 --cache <scratch> --out <g.json> --rows <rows.jsonl>
python scripts/sweep_wind_lane_weight.py --rows <rows.jsonl> --out <sweep.json> --table-out <table.json>
```
(`grade_wind_lane_ndbc.py` lands with #798.)

## 7. Ledger

`ledger.d/claude--wind-lane-skill-weights.jsonl`: line 1 a `decision` (the proposed D-071, held for the owner), line 2
the `pr_open`.
