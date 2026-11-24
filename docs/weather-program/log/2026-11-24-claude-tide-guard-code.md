# 2026-11-24 · claude · the TIDE guardrail family, code (tide-guard-v1 + amendment 1)

Append-only. Stamps come from `date -u`.

## 21:19Z: the tester code PR (step 2 of 4), built against the pre-registered gate

- **Gate:** `gates/tide-guard-v1.md` (#1278, merged), plus amendment 1 (#1280, with the advisor). The advisor's limits:
  - L1: the amendment comes before the code;
  - L2: the tester and the A two-arm table come as separate gated PRs;
  - L3: the flag stays OFF until the A gate PASSES AND T4 accepts on a real build.
- **Block move first (#1267 L3):** the cold-start snapshot-drift block moved verbatim to `flag_guardrail_drift.py`
  and is re-exported. `flag_guardrail.py` went from 756 to 714 lines, then 725 with the TIDE wiring.
- **`flag_guardrail_tide.py`:**
  - it scores the served table's `am_h` (ON) against `keys` (OFF) at the 40 frozen subordinate monitors, in two
    disjoint 7-day windows, on NOAA High/Low;
  - WORSE means some stratum is WORSE in both windows; sanity checks b2–b6;
  - staleness is judged every cycle; a fresh, already-judged build is CACHED (no strike, no pass, no reset);
  - the blind report counts UNTESTABLE cycles over ≥ 24 h, under one "TIDE guard blind" issue;
  - the near-lineage monitor 9418686 is reported with and without; the count of WORSE builds over 14 days is printed;
  - the planted controls run in a sandbox on every newly scored build;
  - everything runs inside `scored_rows_gate.read_only_http` (the bucket host and CO-OPS only);
  - REPORT-ONLY until `TIDE_GUARD_RELEASED=1`.
- **Registered:** `SURF_TIDE_A_HARCON`, default "0", in `GUARDED`, `_RATING_FLAGS` and `COVERAGE` (class `tide`).
  It is inert until the A build writes `am_h`. Nothing served changes, so there is no SCOREBOARD row; one is written
  when the A gate is scored.
- **Workflow:** passes `TIDE_GUARD_RELEASED`, and adds a step that opens or closes the TIDE guard blind issue.
- **Tests:** `tests/test_flag_guardrail_tide.py`, 24 tests (chain lane; floor fragment +24 tests, +1 file). They
  cover:
  - T1/T2 (D-090 rule 2) and the T3 transitions;
  - the T4 plants on a synthetic table: all five give their required verdict;
  - T5: the runtime guard refuses the backend, other hosts, and POST;
  - amendment 1's three rules, and run() end to end.
  - The neighbouring suites pass: 228 passed, 1 skipped, under the backend venv on Python 3.12.
- **Not done:** the A two-arm table (its own PR, with T6), and a real build for T4. The flag stays OFF.

## 21:31Z: the advisor's HOLD on #1283 at 3c809e5fc (one structural gap), fixed

- **The gap:** `tide_pass` ran only over watched flags, so with `SURF_TIDE_A_HARCON` at its default '0' the tester
  never judged a real build. T4 and the null readings could never exist before the flip that requires them: a
  deadlock.
- **The fix:** `run()` now gives every `TIDE_FLAGS` flag a result, marked `observe_only` when the flag is not watched.
  Such a result feeds only three things, never `decide()`: the report, the blind counter and the T4 record. The
  decision loop reads `watched` only.
- **Added with it:**
  - A table with no ON arm yet is UNTESTABLE ("no two-arm table yet") with no NOAA call.
  - While the flag is OFF, that does not count toward the blind issue: today's production table has no `am_h`, and
    otherwise the job would make about 40 NOAA calls per cycle and open a blind issue within a day.
  - With the flag ON, the same state still counts as blind.
- **Tests:** +2.
  - With the manifest OFF: a judged TIDE result (the build, a real b5 breach observed), a full planted T4 record, and
    NO `decisions` entry, no manifest write, no change.
  - With the flag OFF and no ON arm: zero NOAA calls and no blind line over 30 h.
- **Floor fragment:** chain +26 tests (was +24), +1 file.
- **Checks:** the suites give 230 passed and 1 skipped, twice (Python 3.12). flake8 CI gate and file size OK.
  `flag_guardrail.py` is at 728 lines.
