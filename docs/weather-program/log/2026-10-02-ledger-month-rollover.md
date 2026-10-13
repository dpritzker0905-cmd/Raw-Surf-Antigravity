# 2026-10-02 session ledger-month-rollover: the skill ledger died at the October rollover; the strict reader now knows Supabase's missing-object answer

Worktree `C:\Users\David\App\raw-surf\.claude\worktrees\ledger-month-rollover`, local branch
`worktree-ledger-month-rollover`, stacked on #216 (`claude/ledger-215-merge` @ `1f62ff38`, itself on `origin/dev` @
`63a70425`) so that this branch's ledger lines follow #216's seq 278 instead of forking the chain a third time
(LESSONS L-P21). The session ("Concurrent models audit and work") was asked by the owner to audit the far-zoom
session's audit and work; that review is a private artifact and was sent to that session. The owner then chose
"This session, own worktree (Recommended)" for the fix below and said "go" for the missing-object rule. Times are
clock reads (`date -u`) or platform timestamps (L-P10). **This change moves no served number**: it repairs a
measurement instrument (README rule 5).

## Diagnosis, read-only (ended before 01:36:11Z)

- The Forecast Accuracy Monitor is red on its runs of 2026-10-01 07:08Z, 18:49Z and 23:06Z; its last green run was
  2026-09-30 22:57Z. Run 36938984221: `SKILL LEDGER DEAD`, and both `calibration/history/residuals-2026-10.json` and
  `calibration/skill/scored-2026-10.json` read `HTTP Error 400: Bad Request`.
- The precompute job names the cause in its own log (run 36929784890, 2026-10-01T22:20:53Z): `forecast skill ledger
  skipped (L2 read failed for calibration/skill/scored-2026-10.json: CalibrationReadError: L2 read returned HTTP
  400); report unaffected.` The job then exits rc=0, green.
- Storage, by read-only SQL on `storage.objects`: neither October object exists. `calibration/skill/pending.json` was
  last written 2026-09-30 22:45:05Z and `scored-2026-09.json` 22:45:04Z. Every precompute run since then has built its
  new forecast rows and dropped them, because the pending queue is written only after the archives.
- Supabase Storage renders every error as HTTP 400 with the real status inside the JSON body (`supabase/storage`
  `src/http/error-handler.ts`, unless a deployment sets `respectStatusCode`), and `src/internal/errors/codes.ts`
  gives a missing object `{"statusCode":"404","code":"NoSuchKey","error":"not_found","message":"Object not found"}`.
  A keyless probe of this project's storage API during this session answered a missing bucket with HTTP 400
  `{"statusCode":"404","code":"NoSuchBucket","error":"Bucket not found",...}`.
- The cause: `load_calibration_l2(strict=True)` counted only an HTTP 404 with code NoSuchKey/not_found as absent
  (`buoy_calibration.py`). The first read of a month segment that did not exist yet raised, `run_skill_ledger`
  aborted before any write, and the residual roll-up (`buoy_residual_retention.roll_up_history`, same reader) aborted
  too. It reads every segment before writing any, so September's last rows are held back as well. The strict rule
  landed 2026-09-20 (`91b90ae9`), after September's segment existed (created 2026-08-31 23:00:48Z), so 2026-10-01
  was the first new month it met. The tests had a month-rollover case, but their fake answered a missing object with
  HTTP 404, so the case passed while production died.
- Three open commitments compute inside this ledger and cannot be met while it is dead: seq 149 (GFS_SCALAR paired
  rows), seq 172 (S7/S8 graded rows) and seq 217 (`by_forecast_by_region`). The far-zoom branch's unmerged commitment
  about the red monitor is answered by this diagnosis (its local number changes when that branch re-chains).

## The fix (01:36:11Z)

- New pure helper `l2_retry.is_missing_object(resp)`. It answers True only for a missing object: an HTTP 404 with
  code NoSuchKey or not_found (unchanged), or an HTTP 400 whose body says code NoSuchKey, or statusCode "404" with
  error "not_found" (older storage-api releases send no `code`). A missing bucket or tenant, InvalidJWT,
  AccessDenied, any other 400 and a non-JSON body stay unreadable: the read fails closed and nothing is written. It
  lives in `l2_retry.py` beside `transient_storage_error` because `buoy_calibration.py` sits at the 800-line cap;
  the call site changes one line for one.
- Why "absent" is the safe side to lean toward: after an absent read the callers write create-only, so a false
  "absent" is caught by the create-only conflict (`test_false_missing_cannot_overwrite_an_existing_object`, now also
  run with the production shape). A false "unreadable" is what killed the ledger.
- Tests. The retention suite's fake now answers a missing object the way production does (HTTP 400 with the NoSuchKey
  body) by default, with explicit modes for production's NoSuchKey, NoSuchBucket and InvalidJWT answers. With the old
  rule 13 tests failed, all with `L2 read returned HTTP 400`. Four of them were pre-existing tests that failed only
  once the fake told the truth: `test_month_boundary_partial_success_is_retryable`,
  `test_residual_writers_acknowledge_append_or_create[False-hot]` and `[False-monthly]`, and
  `test_partial_residual_rollup_is_retryable`. New: `test_supabase_missing_object_answer_is_absent_and_not_retried`,
  `test_older_supabase_missing_object_answer_without_code_is_absent`, `test_every_other_400_still_fails_closed`
  (five shapes) and `test_residual_rollup_creates_the_first_new_month_when_storage_answers_400`.
- Verified locally: the 18 test files that touch the reader, the retry module, the ledger or the roll-up, 452
  passed. The local venv lacks two declared packages, so hosted CI is the authority. Mutations of
  `is_missing_object` (scratch runner, source restored byte-identical): 5 of 6 caught (400 not accepted, statusCode
  alone, no guard for a non-JSON body, a 404 with any code, code only). The sixth (error label only) survives as an
  equivalent mutant under today's shapes; both clauses are kept so that either field alone still identifies the object.
- CI floor: chain lane `MIN_PASSED` 1714 -> 1732 (+18 executed tests, files 140 unchanged) and
  `_FLOOR_SET_FROM["chain"]` 1720 -> 1738, from the hosted reading of 1720 tests in 140 files on dev `63a70425`
  (run 36858078858).

## Not in this change

- The monitor still reads only the current month's segments and reports any failure as "not readable". In the
  hours after a month boundary before the first write (the residual roll-up runs only when the UTC hour is below 6),
  it would page ARCHIVE READER BLIND and SKILL FLOOR UNMEASURED. Its liveness check already adds the previous month in
  that window; giving the two archive readers the same merge is a commitment (below), due before 2026-11-01.
- The rows dropped since 2026-09-30 22:45Z are not recovered here. Whether they can be rebuilt from archived model
  runs is open.
- When the monitor can turn green: after the merge, the next precompute run writes the October scored segment and
  pending. The October residual history segment needs the first precompute run in the 00:00-05:59Z window.
- PR #216 is red only because its floor-staleness job got a 14-day-old answer from GitHub's run list (a transient
  the job itself names); the same queries returned current runs during this session, so a re-run should clear it.

## Ledger

seq 279 (finding: the root cause), seq 280 (decision: the fix, built locally), seq 281 (memory_write: the Render
`workspaceId` and Supabase HTTP 400 facts), seq 282 (commitment: the post-merge read-back, due 2026-10-04T18:00Z) and
seq 283 (commitment: the monitor's month-boundary window, due 2026-10-25T18:00Z). The far-zoom branch also appends
from seq 274; it re-chains after #216 and this branch merge, which renumbers its lines.

## PR #217 opened, #216's failed job re-run (01:42:49Z)

The owner chose "Push, open PR, re-run #216 (Recommended)". Pushed as `claude/ledger-month-rollover` and opened #217
against `dev` (it shows #216's three docs commits until #216 merges; #216 merges first). Re-ran the failed jobs of
#216's CI run 36860391909 at 01:42:21Z (the transient 14-day-old run-list answer). Ledger seq 284 (pr_open) and
seq 285 (the re-run). Nothing is merged.
