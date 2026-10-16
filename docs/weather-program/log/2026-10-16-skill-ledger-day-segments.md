# 2026-10-16 — skill ledger: scored archive in day objects (branch `claude/skill-ledger-day-segments`)

Session: Claude Code (Sonnet 5.5), takeover of the 2026-10-14/15 repair program. One writer for this file.
Owner's words authorizing the build (2026-10-16 ~13:45Z): "Approved: build the day-segmented skill-ledger archive as the first bounded
repair. Tests first, in an isolated worktree off dev, [skip render], CI floors moved in the same commit. Do not merge or deploy; show me the
diff and the hosted CI result first." Nothing here is merged, deployed or flagged.

## What was wrong (measured, not assumed)

`Forecast Accuracy Monitor` has failed on 11 consecutive scheduled runs since 2026-10-13 19:49Z (`SKILL LEDGER DEAD`, then `STOPPED SCORING`).
Cause: `calibration/skill/scored-2026-10.json` is one object re-uploaded whole by every ledger pass. It reached 52,404,041 B against Storage's
50 MiB (52,428,800 B) object limit (the `weather-products` bucket has no limit of its own: `file_size_limit` null). From 2026-10-13 16:47Z,
49 of 57 passes (precompute and ingest lanes) failed with `HTTP 400 {"statusCode":"413","code":"EntityTooLarge"}`; 8 succeeded (6 before, 2 on
10-15 at 17:02Z and 17:13Z, ending at 52,404,041 B, which is why a monitor run then read "liveness recovered").
`forecast_skill.run_skill_ledger` writes the archive before `pending.json`, so each failed pass also skipped the pending write: the pass's new
forecasts were never recorded (upper bound ~1.4k rows a pass; mean 1,376 over the 8 good passes).
Not caused by #331/#341: the first failed write (10-13 16:47Z) precedes both. Measurement-only: no served forecast is affected.
Trigger: lanes added 09-26..09-30 (MOS shadow, attribution, consensus, GFS_SCALAR, S7/S8, S9) put October at ~4.1 MB/day against September's 34 MB.
Evidence: `reports/2026-10-16-takeover-evidence/` (untracked, primary checkout): `ledger_timeline.py`, `ledger-timeline-output.txt` (57 passes);
Supabase `storage.objects` metadata read (one read-only SELECT earlier in this session, before the build; exact time not recorded): scored-2026-08 47.4 MB, -09 33.6 MB, -10 52.4 MB (last written 10-15 18:44:45Z), pending 6.5 MB (last written 18:44:46Z).

⚠️ Correction to the handoff's reading (not an edit of it): the archive's newest target moving to 10-15 19:00Z was two passes squeezing under the limit.
And the gap is TWO-SIDED: `score_pending` joins only against THIS run's buoy report (one latest observation per buoy, ±90 min of the target) and
unmatched rows expire after 96 h, so rows whose targets passed during the outage cannot be scored later. A fix restores the series from the first
healthy pass; it does not backfill the hole (10-13 ~16:00Z -> the fix, bar the two lucky passes).

## The change

- NEW `backend/services/weather_pipeline/skill_scored_archive.py` (stdlib only: the monitor imports it with no dependency installed). A target in a
  month before `DAY_SEGMENTS_FROM = "2026-10"` is archived in its monthly object as before (Aug, Sep stay put); from October, in one object per UTC
  day of the TARGET (`scored-YYYY-MM-DD.json`, ~4 MB). The monthly `scored-2026-10.json` is FROZEN: read (rows still count and still dedupe), never written.
  `read_month` lists a month's objects and reads them all; an unreadable part raises, it is never read as empty.
- `forecast_skill.py`: groups scored rows by `key_for_target`; a day's rows dedupe against the day object AND the frozen month; one read per object per
  pass (the frozen month is ~50 MB); `mos_history_rows` reads through `read_month`. `SKILL_SCORED_PREFIX` kept as an alias.
- `forecast_accuracy_monitor.py`: `_fetch_l2` now answers `ABSENT` (Storage's own "object does not exist", same predicate as the strict reader) vs
  `None` (could not read); `_fetch_scored_month` reads the frozen month plus the days; ANY unreadable part, or a pre-October month with no object, is
  blind (`scored segment: not readable`), a missing day object or a month with no monthly object from November is normal.
- Write gate: no change needed. `calibration/…` keys are ungated state blobs, never retried (`store.py:439`), the same for a day key as for a month key.
- No served number, flag, schema or shared-backend path changes. Ships `[skip render]` (the ledger runs in the Actions lanes, from the checked-out code).
  No SCOREBOARD row: nothing the product serves moves.

## Tests (TDD: written first, watched fail for the right reason)

RED on unmodified production code: 29 failures. The incident test failed with the production error itself
(`CalibrationWriteError: L2 write failed for calibration/skill/scored-2026-10.json`) against a fake Storage that enforces a size ceiling and answers
with the verbatim `EntityTooLarge` body. Baseline before any change: 276 related tests green on pristine dev (db453937).
- NEW `tests/test_skill_scored_archive.py` (13): keys, UTC day, the switch month, `keys_for_month`, `read_month` (order, absent, override, fail-closed).
- `tests/test_forecast_skill_retention.py` (+16): the ceiling incident; frozen-month dedupe; create-before-pending ordering; append to the same day; fail-closed
  reads for pending / frozen month / day object x {503, timeout, InvalidJWT}; a month with no monthly object; a pass spanning midnight; MOS history.
- `tests/test_forecast_accuracy_monitor.py` (+5): liveness sees day objects; an unreadable day object is blind; a month with only day objects grades;
  a pre-switch month with no object stays blind; `_fetch_l2` tells absent from unreadable. Two existing fakes moved to the new "absent" contract
  (`l2.get(key, fam.ABSENT)`), the only existing-test edits; every September-dated test is untouched and green.
- Mutation checks (each mutant killed, file restored byte-for-byte): frozen-month dedupe removed -> `test_a_row_already_in_the_frozen_month_object_is_not_written_again`
  fails; unreadable read as empty -> `test_an_unreadable_day_object_is_blind_not_quiet` fails; missing pre-switch month read as empty ->
  `test_a_pre_switch_month_with_no_monthly_object_is_still_blind` fails.
- One of my own assertions was wrong and was fixed on first run: "verdict: REFUSED" (the combined verdict was RED because that fixture's empty residual history
  is RED, and RED outranks REFUSED); the tests now assert the specific blind-archive line.

## CI floors (same commit)

Hosted reading on dev db453937 (CI 38844443190): guards 196 files / 2669 passed; chain 163 / 2444; estate 1674. Additions counted by `--collect-only` on dev vs this
branch: monitor +5 (guards), retention +16 and the new file +13 (chain). Projected guards 2674/196 -> `MIN_PASSED` 2668; chain 2473/164 -> `MIN_FILES, MIN_PASSED` 164, 2467;
`_FLOOR_SET_FROM` 2674 / 2473 / 1674. Estate unchanged. Hosted CI's "collected N" must equal these projections.

## Results

Code commit `238f23e04` (PR #342, draft, base dev db453937). Hosted CI run 38913422185.

| Check | Reading |
|---|---|
| Hosted chain lane (`backend-forecast-chain-guards`) | `collected 2473 tests across 164 files -> 2473 passed, 0 skipped, 0 failed, 0 errors` = the projection exactly (2473 / 164) |
| Local chain lane, full (164 files, venv 3.12 with 2 declared packages absent) | 2473 passed, 0 failed, 12 m 44 s |
| Hosted estate, floor-staleness, lint, file-size, import-check, BOLA, frontend jobs | all success |
| Hosted guards lane (`backend-sim-composition-guards`) | `collected 2741 tests across 196 files -> 2674 passed, 67 skipped, 0 failed, 0 errors` = the projection exactly (2674 / 196; same 67 skips as the base) |
| Local guards lane, full (196 files, same interpreter) | `2672 passed, 68 skipped, 1 xfailed`, exit 0, 21 m 18 s; 2741 collected = the hosted count. The 2-test gap to hosted is the two declared packages absent from this interpreter (the environment banner says so) |
| Hosted workflows on the code commit | CI run 38913422185, LOC Governance Check and Lighthouse CI all completed/success; 14 checks passing, 0 failing, 0 pending, merge state CLEAN |
| Related files, local, after the change | 153 passed across the three directly touched test files; 266 across the ledger-side set |

TRUE-SCALE CHECK (throwaway script, not committed; `scratchpad/true_scale_check.py`): the repo's own `wire` fixture, a frozen October month of 183,349 rows
padded to exactly 52,404,041 B (the size read from Storage), the fake enforcing 52,428,800 B, 300 pending rows that all score in the pass (~87 KB, past the ~24.7 KB headroom).
Pristine dev (db453937): `CalibrationWriteError: L2 write failed for calibration/skill/scored-2026-10.json` (the production signature). This branch: passes in 2.8 s, writes
only `scored-2026-10-16.json` and `pending.json` (largest write 59,401 B), frozen month untouched. My FIRST version of this control scored a single row and pristine dev passed it
(one row adds ~300 B to an object 24,759 B under the limit): that was a flaw in the check, not evidence the code was fine, and is why the scenario now scores 300 rows.
The 2.8 s includes the fixture's deepcopy of a 52 MB object per read; production cost is JSON parse of the same objects, which the ledger already paid.

Process note: I read the local guards lane's progress from a stale percentage and believed it was still running after it had finished; I found out when I tried to
stop it. The file's own summary line is the reading, not a progress counter.

## Not done / limits

- Not merged, not deployed. Real Storage was not written to by this session; the ceiling behavior is proven against a fake that models the limit, not against the live 50 MiB object.
- Day objects begin at the first healthy pass after the merge; Oct 1-15 stay in the frozen month. The old frozen object (52.4 MB) is still downloaded by readers until October rolls off the MOS window.
- An early-warning for a size ceiling (a log line when any ledger object passes ~80% of 50 MiB) was NOT added: it is a follow-up, not part of this bounded repair.
- Owner-only stopgap that I did not take: raising the Supabase global upload limit would also resume writes, but is a project setting change.
