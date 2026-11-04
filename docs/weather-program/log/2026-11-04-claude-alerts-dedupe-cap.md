# 2026-11-04 · claude · Alert windows: collapse, same-window suppression, daily cap (flip test still FAILS)

Session: a delegated subagent of the lead. Branch `claude/alerts-dedupe-cap`, cut from `origin/dev` `f96fd8359` and
then merged with dev `29c01f71f`. Brief: make `ALERTS_FORECAST_WINDOWS` (#704, merged dark) pass its flip test, or say it
can't. Ledger: `ledger.d/claude--alerts-dedupe-cap.jsonl:1`. DRAFT PR only. Nothing is merged, flipped, sent or deployed, and the live
backend was not called. The flag default stays **'0'**. The owner's later rule is "default ON once the bar is met",
and the bar is not met. With the flag off, no served number changes, so no SCOREBOARD row is owed.

## Why #712 failed (reproduced first)

`docs/weather-program/flip-candidates/scorecards/alerts-forecast-windows.json` (#712) reported these numbers. I
reproduced them exactly with its own wrapper on its own data (`C:/t/flip-alertdata`, fetched 2026-11-03T22:53Z).
For size-only at sigma 1 the histogram is {0:147, 1:196, 2:194, 3:78, 4:27, 5:3}, with precision 0.731 and recall
0.947. Forecast noise splits one session into fragments that do not overlap, and the per-alert overlap de-dup sends
each fragment again.

## What changed (all inside the dark flag)

| Piece | Where | Rule |
|---|---|---|
| Collapse | `services/surf_alert_windows.collapse_windows` | merge a spot's windows whose gap is <= `ALERTS_WINDOW_MERGE_GAP_H` (default **1**); the span keeps the best part's rating, and `hours` counts only qualifying hours |
| Same-window suppression | `same_window`, `scheduler/surf_alert_windows.sent_for` | a window that overlaps, or sits within the gap of, a window already sent to this USER for this SPOT (any of their alerts) is never re-sent |
| Daily cap | `admit`, `rank_best_first` | at most `ALERTS_MAX_PER_USER_DAY` (default **2**) per user per local day (the nautical zone of the spot being sent), a hard limit, spent best-rated first across the user's alerts and re-checked after every send in the run |
| Kill switch | `ALERTS_WINDOW_SUPPRESSION=0` | exactly #704: per-alert overlap de-dup, no collapse, no cap |

- **Sent-alert store: the existing `notifications` rows. No new table and no migration.** Each run reads
  `(user_id, data, created_at)` for the last 10 days of `surf_alert` rows that carry `alert_window`. `created_at`
  is the send time used for the cap.
- **G = 1 came from the replay, not a guess.** Precision is flat in G: for size-only at sigma 1 it is 0.734-0.761
  for G = 0-4. Recall falls as G grows: 0.929 / 0.920 / 0.905 / 0.895 / 0.878. G = 1 is the smallest gap that
  brings the perfect-forecast control to <= 2 per user-day without the cap. G = 2 drops sigma-2 size recall to
  0.829, below 0.85.
- **No rounded-start key on top.** The brief asked for spot + rounded start + level. Windows are >= 2 h long, so
  with G = 1 two windows that neither overlap nor sit within the gap start >= 4 h apart. A start rounded to 3 h can
  then never match them. The sweep confirms this: G2 and G2 + key produced identical numbers in every row. The level
  term would only re-send an upgrade that overlap already suppresses. Reflection judged the key redundant for the
  same reason (below).
- Cost on the box: one extra column read. The gate is arithmetic over at most 10 days of one user's rows.

## Evidence: paired replay (`backend/scripts/alert_window_replay.py`, both arms in one run)

Command: `--data <same dir> --sigma 0 1 2 --seeds 5 --step 1 --tiers free,basic,premium --hysteresis --jobs 8`.
Summary: `evidence/2026-11-04-alerts-dedupe-cap/replay_summary.json`. Each arm runs on the same forecasts, because
the issues are drawn from `Random(seed)` before any policy runs. The kill-switch arm reproduces #712 row for row.

| Class | sigma | BEFORE precision / recall / max per day | AFTER precision / recall / max per day | AFTER per-user-day histogram |
|---|---|---|---|---|
| dawn, clean, mid/high tide | 0 | 1.000 / 0.967 / 2 | 1.000 / 0.967 / 1 | {0:72, 1:57} |
| | 1 | 0.665 / 0.963 / 3 | **0.678 / 0.960 / 2** | {0:233, 1:389, 2:23} |
| | 2 | 0.580 / 0.963 / 4 | 0.585 / 0.947 / 2 | {0:180, 1:439, 2:26} |
| morning+afternoon, offshore, light | 0 | 1.000 / 0.950 / 2 | 1.000 / 0.950 / 2 | {0:111, 1:17, 2:1} |
| | 1 | 0.457 / 0.930 / 3 | **0.469 / 0.920 / 2** | {0:466, 1:162, 2:17} |
| | 2 | 0.255 / 0.850 / 4 | 0.253 / 0.820 / 2 | {0:358, 1:242, 2:45} |
| size only, 2-6 ft | 0 | 1.000 / 0.955 / 3 | 1.000 / 0.955 / 2 | {0:50, 1:68, 2:11} |
| | 1 | 0.731 / 0.947 / 5 | **0.740 / 0.916 / 2** | {0:154, 1:278, 2:213} |
| | 2 | 0.675 / 0.924 / 6 | 0.665 / 0.849 / 2 | {0:113, 1:261, 2:271} |

- Tier: 0 windows fell outside the tier window in every arm, class, sigma and tier. Free, basic and premium all
  resolve to 72 h and gave identical numbers.
- Hour-precision is the share of announced hours that were realised-good. It did not fall (size sigma 1: 0.665 ->
  0.664), so the collapsed spans are not inflating precision with gap hours.
- **Hysteresis** was optional item 4: a window must also appear in the previous cycle. It is a replay-only arm and is
  NOT in the product. At sigma 1 the after arm gives precision / recall of **0.792 / 0.933** (dawn), **0.792 /
  0.800** (offshore) and **0.827 / 0.893** (size). Exempting near-lead windows (3 / 6 / 12 h, in the scratch sweep)
  traded the two back again: offshore went 0.729/0.810, 0.685/0.840, then 0.583/0.890. It was not adopted, because
  it costs offshore recall 0.12 and still misses the bar.

**Verdict against the bar: FAIL.** Volume passes (max 2 per user-day everywhere, previously up to 5-6) and the tier
window passes (0 outside). Precision >= 0.8 at recall >= 0.85 fails for all three classes without hysteresis, and
for offshore-light and dawn with it. The false alerts that remain are FIRST announcements of windows the noisy
forecast invents, which suppression cannot remove. The binding error is the wind lead error, which is ASSUMED (1.8
m/s + 0.4/day, 25 deg + 10 deg/day), not measured. A measured wind-skill row, or a calibration of the level floor or
notify lead per class, is the next lever. The bar was not moved. No light flip PR is ready.

## Reflection (Beam, high) on the dedupe key design

Its answer was truncated by its token budget. Adopted from it: drop the rounded key (subsumed, see above); scope
suppression to (user, spot); collect a user's candidates, rank them by rating, then spend the cap; update the
in-memory record after every send. Not adopted: a per-user DB lock. The job already runs with `max_instances=1,
coalesce=True` (`scheduler/__init__.py:71`) on one process, and the per-alert atomic claim still stops a double
send. The residual case, two PROCESSES at once spending cap + 1, is documented in the scheduler docstring. Also not
adopted: a level-upgrade re-send, because it would add volume back. Recorded: a committed row counts against the cap
even if its push then fails (the in-app row exists), and users with spots in different zones have an approximate
local day.

## Tests and gates

- +20 tests in the existing guards-lane files (`test_surf_alert_windows.py` +13 incl. params,
  `test_surf_alert_windows_scheduler.py` +8, one replaced: net +7). They pin collapse, gap edges, the kill switch (= #704), fragment
  suppression, best-rated order, the cap's local day, cap 0, (user, spot) scope, one window per run for two alerts,
  and the knob ranges. Suites: 103 passed.
- Mutants (`scratchpad/adc/mutate.py`, 25 single edits across collapse, suppression, cap, ranking, the kill switch
  and the scheduler scope and in-run record): **25 / 25 killed**.
- Floors via `rederive_floor.py --lane guards --add 20` (re-run after merging dev 945d887f, which carried #712): 3454 -> **3474**, MIN_PASSED 3468, MIN_FILES 217.
- flake8 `E9,F63,F7,F82` clean. Largest touched file: 490 lines.
