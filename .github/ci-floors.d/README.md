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

## The PR-time fragment check is BLOCKING (2026-11-25, #1311)

`backend-floor-fragment-check` (`backend/scripts/floor_fragment_check.py`) collects every backend lane at the PR head
and at its merge base, and compares each lane's delta with the PR's own fragments.

### Outcomes

| outcome | result |
|---|---|
| every lane ok, no relevant change, or fragments-only | pass |
| shrinks only (tests removed, no fragment) | the job passes, but the advisor holds the PR OPEN until its body names the removed tests (the floor is shrink-only by design; a silent shrink is how coverage leaks) |
| docs-only PR | never runs: the job-level `if:` skips it, which a required check counts as success |
| mismatch | **fails**, and prints the exact `rederive_floor.py` command that fixes it |
| unknown (a collection error, an inconclusive lane, or a crash) | the collection is retried once, after a 15 s pause (`FLOOR_FRAGMENT_RETRY_PAUSE_S`, capped at 120 s); still unknown = **fails** |

### Required check

Since 2026-11-25T03:50Z the check is one of the 13 required status checks of the dev ruleset
(`dev: ci.yml jobs must pass`, id 25675068, integration 15368 = GitHub Actions). The director made that change on David's
words "Yes, make it block" and "Yes, block + fix". To read the list:
`gh api repos/:owner/:repo/rulesets/25675068 --jq '[.rules[]|select(.type=="required_status_checks")|.parameters.required_status_checks[].context]'`.
Removing the check from the ruleset is the owner's decision, like adding it.

### Escapes

- **One PR** blocked by a mismatch or an unknown result: label the PR `floor-fragment-override`, AND add a ledger
  `decision` line to the PR's own fragment:

  ```bash
  python backend/scripts/action_ledger.py append --kind decision --target "floor-fragment-override #<pr>"
  ```

  - **`--why`:** a written reason, ≥ 20 characters.
  - **`--authorized-by`:** must START with David or the director.
  - **`--actor`, `--outcome`, `--verified`, `--rollback`, `--evidence`:** as usual.

  Then re-run the job; it reads the label live. Every lane uses one GitHub account, so the authorizer is a ledgered
  claim the advisor reviews, not an identity check.
- **A repo-wide breakage** (every PR fails the same way, e.g. dev broke an import): set repo variable
  `FLOOR_FRAGMENT_CHECK=report`. Every outcome becomes a warning and the job passes. That is a CI-policy change:
  1. record it with a ledger line (`--kind env_change`: why, who authorized it, the run that showed the breakage);
  2. **revert it** (delete the variable, or set it to `block`) as soon as dev is fixed;
  3. record the revert with a second ledger line.

  Leaving it on silently turns the floor back into a minimum nobody checks, which was the 18-test slip this check
  exists to stop.
