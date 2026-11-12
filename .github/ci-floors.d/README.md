# CI floor fragments

Each CI lane has a shrink-only floor: guards, chain, estate (backend pytest lanes) and frontend (the Jest suite).
Before 2026-11-11 every PR that added tests rewrote one running-total line per lane in `.github/workflows/ci.yml` and in
`_FLOOR_SET_FROM` (`backend/tests/test_ci_floor_staleness.py`). Any two open PRs conflicted on those lines, and every
merge re-broke the others. Now each PR adds its own file here instead. Different files never conflict.

## The rule

- **A feature PR never edits the base lines.** That covers `MIN_FILES, MIN_PASSED = …` and `MIN_PASSED = …` in ci.yml,
  `FRONTEND_BASE_SUITES / FRONTEND_BASE_TESTS` in ci.yml, and `_FLOOR_SET_FROM`. Instead it adds one fragment per lane it
  grows, written by the helper (from the repo root or `backend/`):

  ```bash
  python backend/scripts/rederive_floor.py --lane chain --add 91 --add-files 2 --note "location-time phase 1"
  python backend/scripts/rederive_floor.py --lane frontend --add 12 --add-files 1   # files = Jest suites
  ```

  Re-running it on the same branch replaces that branch's fragment for that lane. It never stacks a second one.
- **Effective floor = base literal + Σ fragments for that lane.** `MIN_PASSED += Σ tests`, `MIN_FILES += Σ files`.
  For the frontend lane, MIN_TESTS gets `+= Σ tests` and MIN_SUITES gets `+= Σ files`, because `files` counts Jest
  suites there. The effective set-from is `_FLOOR_SET_FROM[lane] + Σ tests`, which is the number the PR's hosted run
  must read. The margins don't change (guards/chain 6, estate 2, frontend 0).
- **One helper does the summing:** `backend/scripts/ci_floor_fragments.py`. The ci.yml lane steps, the staleness
  checker (`ci_floor_staleness.py`), `rederive_floor.py` and the tests all call it, so they can't drift apart.
- **`--compact` is for dev only.** It runs in a PR of its own and never in a feature PR.
  `python backend/scripts/rederive_floor.py --compact` folds every fragment into the base literals and
  `_FLOOR_SET_FROM`, writes one `⬆` comment line per lane, and deletes the fragments.

## File format

Each fragment is named `<branch-slug>.<lane>.json`. The slug is the branch name with `/` replaced by `-`.

```json
{"lane": "chain", "tests": 91, "files": 2, "branch": "claude/location-time-phase1", "date": "2026-11-11", "note": "..."}
```

Validation is strict, and **any malformed fragment turns CI red with the reason**: it fails closed, so a floor never
silently reads low.

- `lane` must be one of `guards`, `chain`, `estate`, `frontend`, and must match the lane in the file name.
- `tests` and `files` must be non-negative integers. Booleans and strings are refused.
- `files` must be 0 or absent for `estate`. That lane is a complement, so it has no file floor.
- `lane`, `tests`, `branch` and `date` (`YYYY-MM-DD`) are required. `files` and `note` (a string) are optional.
  Unknown keys are refused.
- Only this README and `*.json` fragments may live in this directory. Any other file is refused.

## Converting a PR that edited the base lines

1. Merge `origin/dev`.
2. Resolve every floor line (ci.yml base lines and their `⬆` notes, `_FLOOR_SET_FROM`) to **dev's** side. If the PR
   changed nothing else in those two files, `git checkout --theirs .github/workflows/ci.yml backend/tests/test_ci_floor_staleness.py`.
3. Write the fragment: `python backend/scripts/rederive_floor.py --lane <lane> --add <N> --add-files <M>`.
   For a backend lane, `--add auto` reads the PR's own earlier change.
