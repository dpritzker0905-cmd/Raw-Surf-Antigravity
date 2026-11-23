# 2026-11-22: Spot Forecast Series never completes (PR #1174)

Session: the spot-series diagnosis side session, started by the director (local_d6b521eb). This is a CI operations
fix; it changes no served number, so it adds no SCOREBOARD row.

## Root cause (measured)
- Every `rate (MODEL, n)` job in runs 45085780784 and 45043668835 ran **exactly 60m14s**, then
  `##[error]The operation was canceled.` That is the job's `timeout-minutes: 60`. It is not a concurrency cancel (the
  group is `cancel-in-progress: false`) and not a hang (the log shows rating until the kill). `assemble` then fails:
  there are no rows.
- **No automatic run has ever completed.** Last 158 runs: 100 skipped (before #918), 50 cancelled, 6 failed,
  1 success. The success was dispatch 43734665312 (11-15), 40 spots a job, with publish skipped.
- That dry run measured **206-366 ms a frame** against the ~54 ms the workflow was sized on. A full job (~443 spots ×
  58 frames) projects to ~88-157 min.
- No code regression. The workflow started using runners when #918 un-skipped the automatic runs: 12 runners × 60 min
  on every precompute completion, which queued PR CI behind it.
- Separate and transient: the 11-19 failures were `L2 restore: 0 products (Manifest download failed)`.

## Fix (#1174)
- `max-parallel: 4` on the rate matrix.
- `spot_series_ci.py` rates in 25-spot chunks and logs `rate progress`. With `SPOT_SERIES_RATE_BUDGET_MIN=50`, a job
  projected to overrun fails after 30% of the budget, with the numbers.
- When a job completes it writes identical rows (pinned by a test).

## Owner action
- 2026-11-23T02:08:20Z: the director set the repo variable `SPOT_SERIES_PUBLISH=0` on the owner's words "Yes, set it to
  0". The variable did not exist before (unset meant ON). Automatic runs are now skipped; the in-progress run
  45087479819 was not cancelled. Ledger: `ledger.d/fix--spot-series-timeout-starvation.jsonl:1`.
- **Open, owner's decision:** (a) a ~180-min timeout plus a throttled trigger, (b) more shards, (c) find out why a
  frame costs 4-7× the estimate (steady L1-miss L2 downloads during rating), (d) a shorter horizon or lower frame
  density. Until one is picked and the variable is unset, the series stays off.
