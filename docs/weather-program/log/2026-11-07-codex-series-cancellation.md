# 2026-11-07 - Cancelled series requests stop building

## Scope and evidence

Base: dev `3398063fc9a5719ee6587255c1e7bfb6fe5f48bb`, fetched before work. Claude allocated backend series repair to Codex and reported no overlapping active changes. Runtime edits are confined to `backend/services/weather_pipeline/grid_series_helper.py`. No served forecast number, admission setting, cache retention, provider policy, flag or deployment changes.

The #741 log records the live OOM and map clearing. This patch does not establish the OOM's cause or cure: there is no incident memory profile. The independently reproduced defect is cancellation amplification. Four `except BaseException` handlers turned cancellation into recoverable provider failure: a cancelled fast path could start the per-hour fallback, and cancellation during hour zero could start the rest of the page. The surrounding gather could swallow cancellation into an empty successful response.

The handlers now catch `Exception`. Python's `asyncio.CancelledError` propagates through the builder instead of starting replacement work. Ordinary timeouts and provider exceptions retain existing fallback/partial-page behavior. An independently cancelled first hour or fast path now cancels the page as intentional control flow. An independently cancelled later hour is still omitted by `gather(return_exceptions=True)`, without cancelling its siblings.

This does not preempt already-running thread work, cancel independently shielded provider fetches, or change the response envelope's worker ownership. It is not a total-process memory bound. Admission/caches and baseline memory growth remain separate investigation items.

## Offline verification

Instrument: `backend/tests/test_grid_series_deadline_bound.py`, executing the real builder with controlled async resolver/provider doubles, no live weather load.

- Baseline: four cancellation regressions failed, 15 tests passed. The failures cover hour zero, later gathered hours, EURO fast path and GFS/ICON fast path.
- Initial candidate cohort: 114 passed, 3 pre-existing Pydantic deprecation warnings. Includes existing EURO merge, response envelope, page memo, build-time stride and load-time stride tests.
- Review requested two additional controls: resolver cleanup completed before cancellation returns, and autonomous later-hour cancellation preserves siblings. Both were added; final cohort pending at this checkpoint.
- Seven new test cases in an existing guards file. Official `rederive_floor.py`: hosted dev run 42414690794 read 3560 / 224 files; dev map 3560; +7 gives 3567 expected, floor 3561 / 224 files. Both floor files updated together.
- Fatal lint passed for changed source/tests; backend 800-line gate: 0 violations, 147 existing warnings across 821 files.
- Independent read-only review found no blocking patch-introduced defect; final added controls require execution.

Local Python is 3.12.10. Four declared dependency packages are absent, so these results qualify this local environment, not CI or production. No live load test, restart, environment change, merge or deployment occurred.

## Safeguards and release boundary

Work is in the existing approved independent clone on a new no-track branch. Its installed hook and pinned Git configuration were preserved, and its original sparse selection was saved for restoration. Existing source/receipt branches and original working trees remain untouched. Specific-PR owner approval is required before any merge. Hosted exact-head checks remain necessary for release qualification.

## Final local cohort

The final seven-file cohort passed: **151 passed, 3 warnings**, no skips. This includes both review-requested controls and CI-floor staleness tests. The warnings are existing Pydantic deprecations; four absent dependency pins remain an environment limitation.
