# 2026-10-02 session floor-staleness-retry: the floor-staleness check asks again, and asks REST, before refusing

> **Recovered 2026-10-10** from closed PR #222 (head `672b996e`; a superset of #224's copy). The code landed on dev on
> 2026-10-03 through `f9cd9404` and `7cd898f4` without this log. The text below is unchanged. Its ledger numbers 326-336
> are the closed branch's own: on dev those numbers are other actions (see log `2026-10-10-closed-pr-audit.md`).

Worktree `C:\Users\David\App\raw-surf\.claude\worktrees\nice-hofstadter-535656`, branch
`claude/floor-staleness-retry` off `origin/dev` @ `c4a59c01`. Asked by the owner in chat: before refusing on an
implausibly old newest run, retry the lookup a bounded number of times with a short backoff and cross-check the REST
endpoint, refusing only if every source still answers old. Times are clock reads (`date -u`) or platform timestamps
(L-P10). **This change moves no served number**: it is a CI instrument (README rule 5), so no SCOREBOARD row.

## The failure, as the owner reported it

`backend-floor-staleness` (`backend/scripts/ci_floor_staleness.py`, `last_green_run`) refused twice with the same
answer: the newest successful ci.yml run on `dev` was 35183181239 (2026-09-17T04:46:22Z), 15 days old. That happened on
PR #220 (run 36972188156, 06:09Z) and PR #221 (run 37007605637, 12:35Z). Minutes later `gh run list` and the REST
endpoint both returned 36961412429 (`c4a59c01`, 2026-10-02T03:43:29Z), and attempt 2 of 36972188156 passed. The
2026-09-28 fix (the newest of 20, not the first of one, PR #140) could not help: the WHOLE list was stale.

## Reproduced here, read-only

- The first `python scripts/ci_floor_staleness.py --report --branch dev` of this session (just before a `date -u` read
  of 12:42:40Z) refused with the same message, naming 35183181239. The exact `gh run list` arguments, `--limit 3`, and
  `actions/workflows/ci.yml/runs?branch=dev&status=success&per_page=20` were run right after, and each named 36961412429.
- Between 12:43:20Z and 12:50:24Z, one Python process asked both sources: `gh run list` named 35183181239 (stale)
  and the REST endpoint named 36961412429 (current). This is the "REST current while the run list is stale" case,
  caught live.
- Tally of this session's calls: `gh run list` was stale on 2 of 26 calls, and the REST endpoint on 0 of 22. Both stale
  answers were the FIRST call of a fresh process after minutes idle, which is how the CI job calls it. Tight loops
  (8 and 12 rounds of both sources) were never stale. That is a pattern from n=2, recorded but not relied on: the fix
  does not depend on it.

## The change (`ca3a06a6`)

- `last_green_run` asks up to `RUN_LOOKUP_ATTEMPTS = 3` times, sleeping `RUN_LOOKUP_BACKOFF_S = (5, 15)` seconds
  between attempts. Each attempt asks `gh run list` and then the REST endpoint
  (`repos/{owner}/{repo}/actions/workflows/ci.yml/runs?branch=<quoted>&status=success&per_page=20`, mapped into the run
  list's `databaseId/headSha/createdAt` fields). The reading is the newest run that any answer named.
- Nothing is relaxed. The chosen run must still be under `MAX_READING_AGE_DAYS` (14). A source that fails is recorded
  and named in the refusal; it never decides the result. When every answer is old, the check refuses with the same
  message, which still names the newest run, plus each attempt's answer. A current first answer costs one call, as before.
  A reading recovered after an old or failed answer prints a `::notice::` naming what came before, so the run log
  shows how often this happens.
- Known limit: each `gh` call keeps its 180 s timeout, so a `gh` that HANGS on all six calls would outlast the job's
  10-minute timeout. The job would still go red (killed), but without a named cause. That has never been observed.

## Tests and evidence

- `tests/test_ci_floor_staleness.py` (estate lane, selector-confirmed with `ci_test_lanes.py --lane estate`) goes from
  22 to 25 collected. The 2026-10-02 run ids are the fixtures. The cases:
  - Stale, then current: passes after one backoff.
  - REST current while `gh run list` is stale: passes with no backoff, and the endpoint's branch, status and per_page
    are asserted.
  - All stale: still refuses, naming the newest stale run across both sources (35183181239, "15 days old"). This is
    the existing refusal test, extended; both sources must be asked `RUN_LOOKUP_ATTEMPTS` times.
  - A failing source is named in the refusal, not swallowed.

  An autouse fixture records each backoff instead of sleeping.
- RED was observed before the change: 4 failed, each for the missing behavior.
- GREEN after it: 25 passed, plus `test_check_floor_before_push.py` (29 together).
- Mutation checks killed 7 of 7: one attempt only, no REST source, no backoff, source errors fatal, answers dropped
  from the refusal, age gate removed (4 tests red), REST branch not sent.
- Live, read-only (between 12:43:20Z and 12:50:24Z): both sources through the new code returned 20 runs each, and REST resolved
  `{owner}/{repo}` from the checkout. A full `ci_floor_staleness.py --branch dev` read run 36961412429 and exited 0.
- flake8 CI gate clean, full flake8 at 150 clean, `check_file_size.py` exit 0 (script 427 lines, test 447).

## Floors

Dev's hosted run 36961412429 (`c4a59c01`) read estate 582 passed (`ci_floor_staleness.py --report --branch dev`).
Plus 3 executed tests gives a projection of 585, so `MIN_PASSED` moves 580 to 583 and `_FLOOR_SET_FROM["estate"]` moves
582 to 585, in the same commit. Guards and chain are untouched. Hosted CI must confirm 585.

## Ledger and STATE

- One `decision` line is appended after dev's head, seq 293. Open PRs #220, #221, #222 and #223 also append from
  seq 294, so whichever merges later re-chains (L-P21).
- #219's `pr_merge` is NOT recorded here: #222 and #223 already carry it.
- STATE.md is not edited. Four open PRs already edit it, and its seq-293 anchor stays valid while this branch appends.
  The estate floor is recorded here and in the ledger.

## Pushed and opened (owner: "yes")

`claude/floor-staleness-retry` pushed at `451bade0` (13:12:06Z) and opened as PR #224 against `dev` (createdAt
13:12:28Z), ledger seq 295. Hosted CI must confirm the estate projection of 585; this log records the reading when it
arrives.

## Merged dev after #223, as the bottom of a stack (owner: "resolve the merge #222 conflicts, and other merge conflicts you see, lets clean up our progress and streamline")

- #223 merged at 13:24:08Z (`ca71acd1`), and #220, #221, #222 and #224 all conflicted with dev on the shared files:
  `ACTIONS.jsonl`, `STATE.md`, the floor pair (`ci.yml`, `_FLOOR_SET_FROM`). Merging them one at a time would
  re-conflict every other PR on each merge, so they are STACKED (L-P21): dev <- #224 <- #222 <- #220. #224 goes at the
  bottom because the PRs above run its fixed floor-staleness check in their own CI. That check failed a third time on
  #220 at 12:38Z (run 37007886200, the same stale run 35183181239). #221 is left to its session, which is active: two
  unpushed local commits, an uncommitted edit, and a new push at 13:35Z.
- Hosted CI on #224 read estate 585 (run 37011560800 on `8c312c4a`), the projection exactly. After the merge,
  `_FLOOR_SET_FROM` = guards 2183, chain 1754 (dev's, from #223), estate 585.
- Ledger re-chained with a helper that remaps `fulfills`/`corrects` inside the moved block and keeps each original
  time as `acted_at`. Branch seq 294 -> 301 (decision) and 295 -> 302 (pr_open). Seq 302's `why` still says "the seq
  294 decision" in free text; that now means seq 301.
- Seq 303 re-records #219's merge under the target `#219`. Dev's seq 294 records it as `PR #219 (claude/...)`, which
  `memory_audit.check_completeness` does not match (it tests exact membership of `#N`), so #219 would FAIL as soon as
  #223's merge is newest. Seq 304 records #223's merge (merged by the owner's account; this session did not see the
  words). #222's own `#219` line becomes a duplicate and is dropped when #222 is re-chained onto this branch.

## Correction (13:50:26Z): the stack is dev <- #224 <- #222, not dev <- #224 <- #222 <- #220

The section above planned #220 as a third level. At 13:50:26Z #220's head was `b945f009` and #221's was `dd8616fa`:
their own sessions had merged dev (ca71acd1) into them at 13:38:55Z and 13:35:00Z, re-chaining each from seq 301,
and both read MERGEABLE. #225 had opened at 13:50:04Z. Stacking #220 on #222 would have overridden that session's
own resolution, so this session left it alone. Only #224 and #222 (whose session was idle since 12:52Z) were still
conflicting. STATE says so; the first PR merged after the stack must carry `pr_merge #224`.

## #222 stacked on #224

- Merged `claude/floor-staleness-retry` into #222 (`claude/c228-series-par2-deadline` @ `99672397`), pushed by this
  session as `stack-222:claude/c228-series-par2-deadline`. #222's own worktree, `strange-snyder-982d2a`, had no
  unpushed or uncommitted work when read, and its last commit was 12:52:05Z.
- Chain floor: #223's run 37009550311 read 141 / 1754, and #222's run 37009323668 read 141 / 1780. Each added one file
  over `c4a59c01`'s 140 / 1740, with +14 and +40 tests. Stacked, that is 1794 tests, so the floor is 142 / 1788;
  `--lane chain` selects 142 files here.
- Ledger: #222's seq 294-298 became 305-308 (deploy, finding, commitment, pr_open). Its `pr_merge #219` was dropped as a
  duplicate of seq 303. STATE's citations of #222's seq 295-296 were remapped to 306-307, marked "written as ... on
  #222's branch". #222's own log keeps its branch numbers, because this session does not write another session's log.
