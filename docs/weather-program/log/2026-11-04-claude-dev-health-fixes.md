# 2026-11-04 (claude): dev health, aged fixtures and the Bethune parity red

Branch `claude/dev-health-fixes` off `dev` `29c01f71f`. No served number moves.

## 1. `test_product_run_keys.py`: 4 RED on dev itself (CI run 41768965889)

- Cause: the fixture slice was the literal `2026-11-02T03Z`. `store.manifest_retention_cutoff` (store.py:150) drops
  products older than now minus `MANIFEST_RETENTION_DAYS` (2), so once the wall clock passed 2026-11-04T03Z the
  four merge tests found no product at `VALID` (`[] == [b]`). The code under test was right; the fixtures had aged.
- Fix (test only): `NOW` is frozen once at module load (hour-floored), `VALID = NOW + 3 h`, `RUN1 = VALID - 81 h`,
  `RUN2 = VALID - 9 h` (the live incident's spacing), and the name and regex literals are built from them. No
  assertion was loosened. The GC tests at the bottom use their own injected `now` and literal names, and still pass.
- Local: 26 passed (was 22 passed, 4 failed). The test count does not change, so no floor moves.

## 2. Sim Parity Monitor run 41834804752 (13:06Z, dev 29c01f71): Bethune Beach

- Artefact row: glyph 27.7/poor vs sim 29.1/poor_fair, d 1.4 (> the 1.0 straddle margin), attribution
  `composition`, marine and wind run ids identical. Glyph `tide` norm 0.292, spot `best_tide` "Mid tide";
  sim `tide_fit` 1.0, `sim_tide_applied` false.
- Arithmetic: "mid" parses to (0.33, 0.67) (surf_rating.py:508), `tide_fit(0.292)` = 1 - 1.3 x 0.038 = 0.9506
  (surf_rating.py:527-535), and 29.1 x 0.9506 = 27.66, which rounds to 27.7. The whole gap is the tide term.
- Glyph path: `spot_ratings.rate_one_spot` resolves `tide_norm_at` under RATING_TIDE (spot_ratings.py:165-177)
  and passes `tide_norm` / `best_tide` into the rating (spot_ratings.py:206-207, 235-236). The monitor sets
  `RATING_TIDE: '1'` (sim-parity-monitor.yml), the same as the precompute lanes.
- Sim path: `sim_rating` applies tide only when it is handed `served_tide` (sim_rating.py:312-323, 393-394), and
  `sim_observed.served_tide` / `glyph_tide` return None unless `SIM_SERVED_TIDE` == '1'
  (sim_observed.py:212, 227). The cron runs `SIM_SERVED_TIDE: ${{ github.event.inputs.sim_served_tide || '0' }}`
  (sim-parity-monitor.yml:126), which `test_probe_tide_banded.py::test_the_monitor_dispatch_carries_the_ab_and_the_cron_stays_tide_blind`
  pins on purpose.
- Verdict: a real CODE divergence. It is the known W-30 gap: the fix is built but dark, the A/B was measured
  2026-09-30 (commitment 203: tide-blind max d 9.6 with 3 level differences, flag on 0.0 and 0), and the flip has
  waited on the owner since then (STATE "Owner decision pending: flip SIM_SERVED_TIDE"). When it fires depends on
  time and data: the monitor goes red only when a tide-banded spot is outside its band, the score sits at a
  level edge, and |d| > 1.0. At 03:01Z Bethune was not in that state. The monitor should not tolerate it, because
  that would hide the exact divergence it exists to catch.
- #714 has no bearing on this. It changes only frontend shaders and the particle encoder, and the probe compares
  the backend sim against the backend precompute, with the same run ids on both sides.
- Code change: none. The parity is already pinned with the flag on by
  `test_sim_served_tide.py::test_a_low_tide_spot_at_high_water_rates_as_the_glyph_would`. Flipping the default
  would change the sim's served quality, so under D-001 it needs the owner's word. The one-line flip: the
  `'0'` defaults at sim_observed.py:212 and :227, plus the monitor's cron default at sim-parity-monitor.yml:126.
- Not run: the monitor and the live backend. No rerun.

## 3. The flip (coordinator, same session): SIM_SERVED_TIDE default ON

- Authority: the owner's policy in chat at ~01:41Z on 2026-11-04 ("fixes by default so they are visible and on"),
  quoted verbatim in `docs/audits/RAW-SURF-COORDINATION.md` on `claude/raw-surf-coordination`, and relayed by the
  coordinator for this PR. ⚠️ That entry says the policy supersedes D-001 "once its PR merges"
  (`claude/default-on-guardrails`), and I found no merged PR for it. So this PR's flip takes effect only when the
  owner merges #720.
- Change: `sim_observed.served_tide` and `glyph_tide` treat an unset flag as ON, and only `'0'` disables
  (sim_observed.py:212, :227). The monitor's cron default is `'1'` (sim-parity-monitor.yml:126), and dispatching
  `'0'` runs the tide-blind kill arm as the A/B.
- Tests: `test_sim_served_tide.py::test_on_by_default_and_the_kill_switch_makes_no_request` (unset = ON, `'0'` =
  None with no fetch); `test_probe_tide_banded.py`, where the shared reader is ON when unset and off at `'0'`, and
  the cron default is `'1'`. The test count is unchanged (one test was renamed in each file), so no floor moves.
- The SCOREBOARD row is appended, and its AFTER reading is owed from the first scheduled monitor run after the merge.
- Kill switch: set `SIM_SERVED_TIDE=0` in the sim's process. For the monitor, dispatch with `sim_served_tide=0`.

## 4. #720 review fixes (Codex, confirmed by the coordinator at 37db6f3f3)

- `served_tide` now always uses the STRICT frame check (`_aligned_frame`, which was the time-match branch of
  `_comparison_frame`), whatever SIM_SERVED_TIME_MATCH says. The legacy parity frame is "GFS at the asked hour"
  and skips the model and served-time checks, so with it a EURO/ICON sim or a stale fallback frame could have
  borrowed another frame's tide. Any unknown, mixed or mismatched frame now gives None (tide neutral). The parity
  path's own legacy frame is unchanged.
- The `sim_served_tide` dispatch input now defaults to '1', matching the cron. '0' remains the kill arm you can pick.
- Five new test cases in `test_sim_served_tide.py`: a EURO sim gets no GFS tide; a stale `served_valid_time` gives
  None; an unknown or mixed frame gives None with no fetch (2 cases); an aligned frame applies the tide.
  Mutation check: swapping back to `_comparison_frame` turns 4 of them red.
- Guards floor: `rederive_floor.py --lane guards --add 5` gives 3449 + 5 = 3454, with MIN_PASSED moving from 3443
  to 3448.
