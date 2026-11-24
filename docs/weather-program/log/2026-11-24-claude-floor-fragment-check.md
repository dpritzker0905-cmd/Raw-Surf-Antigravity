# 2026-11-24 · PR-time floor fragment check (advisor's cause walk)

18 estate tests slipped past the shrink-only ratchet (#1155 +1, #1234 +2, #1228 +15 with no fragment). A floor is a
MINIMUM, so an under-declared PR passes its own run and surfaces later as dev staleness. The director wrote two catch-ups
for them today (#1272, #1275).

## The check

`backend/scripts/floor_fragment_check.py`, CI job `backend-floor-fragment-check`. It runs on PRs only, is skipped for
docs-only PRs, and is REPORT-ONLY until repo variable `FLOOR_FRAGMENT_CHECK=block`.
- **Measure:** it COLLECTS `tests/` (`pytest --collect-only`) at the PR head and at its merge base (a temporary
  worktree), buckets the result by each side's own `ci_test_lanes.py` lists, and compares each backend lane's delta with
  the PR's own added or changed fragments.
- **Fix:** a mismatch prints the exact `rederive_floor.py` command.
- **Not checked:** fragments-only catch-up PRs, which `ci_floor_overlift.py` guards; and frontend Jest.
- **Never a pass:** a shrinking lane is reported, and a collection error is inconclusive.

## Pre-tests (Python 3.12 venv, Windows, ~2 min per run)

- **#1228 head `719df1b4a`, base `f37de972a`:** estate **+15 tests, fragment 0, mismatch**. It printed
  `python backend/scripts/rederive_floor.py --lane estate --add 15 --note "<what the tests are>"`.
- **#1268 (control):** chain +7 tests and **+1 file**, against a fragment of 7 tests and 0 files. That was a real miss of
  mine (no `--add-files` for the new `test_run_age.py`). The pre-test read #1268's own delta against its merge base
  `3b0407247` (the #1266 merge, 13:16Z), before the director's catch-up #1272 (`cf8b74090`, 16:10Z).
  **Superseded by #1272:** #1268 had already merged (13:59Z, head `33d72454f`) when I pushed a fragment fix `4c3ba8e1c` to
  its branch. That commit is on no path to dev and gets no PR, because #1272's chain MIN_FILES 268 to 269 already absorbed
  the +1 file, and a second fragment would count it twice.
- **This PR on itself:** estate +15 against a fragment of +15: ok.
