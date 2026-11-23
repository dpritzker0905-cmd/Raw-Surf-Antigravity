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

## 2026-11-23: the cause is narrowed; the full-prefetch build (owner: "Yes, build it")
- Measured in the cancelled GFS job's log:
  - `[Prefetcher] Capping warm set 14005 -> 400 (nearest-hour-first); rest lazy on demand`, at conc=5, with
    `global_mid` excluded.
  - The 3,259 lazy L1 misses were all DISTINCT, ~1.1 s each: gfs marine swell 1,273, waves 1,259, wind 667, plus EURO
    waves 60. Every one is a layer the prefetcher warms. The 400 cap (sized for the 512 MB serve box) left them lazy.
- Consulted SubQ, Reflection and Longcat. All three chose making the job fast (option c).
  - Longcat flagged product choice by disk presence. It is real: `point_resolution.py:274` (hint swap) and
    `grid_resolver.py:362` (Step 3.5 preview).
- Built (#1174):
  - `prefetcher.py`: `PREFETCH_MODELS` (model filter) and `PREFETCH_RETRIES` (backoff), both default off, so the serve
    boot is unchanged.
  - The rate step warms its model uncapped, incl. `global_mid`, 16-way with 3 retries.
  - Dispatch input `identity_check=true` rates each job twice in separate processes on an emptied L1: the capped
    prefetch, then the full one. It fails unless every row is identical, and an ingest between the arms makes it
    'inconclusive'.
- Commitment (`ledger.d/fix--spot-series-timeout-starvation.jsonl:2`): `SPOT_SERIES_PUBLISH` stays 0 until that
  dispatch reads 'identical' on GFS, EURO and ICON.

## 2026-11-23 02:26Z: identity-check dispatch (owner: "Yes, run it")
- The director dispatched run 45100260710 on ref `fix/spot-series-timeout-starvation` (@95c5fd69a) with limit=40,
  hub_parity=0, identity_check=true. Ledger: `ledger.d/fix--spot-series-timeout-starvation.jsonl:3`.
- It is queued behind run 45087479819 (concurrency group `spot-series`).
- Expected to be refused: the `supabase-service` environment allows only `dev` and `main` (its deployment-branch
  policies, read 2026-11-23), so no identity verdict can come from a PR-branch run. A real verdict needs #1174 merged,
  then a dispatch on `dev`.
- Watched read-only. No re-run, and `SPOT_SERIES_PUBLISH` stays 0; unsetting it needs David's word after GFS, EURO and
  ICON all read 'identical'.
- 02:27:38Z: the director CANCELLED run 45100260710 before any job ran (0 jobs; a PR ref gets no credentials).
  Ledger: `ledger.d/fix--spot-series-timeout-starvation.jsonl:4` (corrects `:3`). Next: #1174 merges, then the director
  dispatches on `dev` with the same inputs under the same "Yes, run it".
