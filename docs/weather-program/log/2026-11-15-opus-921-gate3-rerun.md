# 2026-11-15: #921 gate 3 re-run after the build-ahead scheduler change (Opus, Move 3; the advisor's open limit)

## 19:55Z: what is re-run, and how it is scored (registered before the run)

#921 merged at `7186aa737`; the four earlier gate 3 runs (log `2026-11-15-opus-series-decode-worker.md`, 15:55Z-16:47Z) were all
measured BEFORE the build-ahead scheduler change (`requestIdleCallback` only, no forced timeout, a 4 ms idle floor; no build-ahead at
all where `requestIdleCallback` is missing). This re-run measures the code as merged. The change is already ON in `dev`; the result
is written as it falls and changes nothing by itself.

**Build:** a production build of `origin/dev` at `02a5c5cb1` (contains #921). **Lab:** offline synthetic backend (4298), never the live box.

**Instrument and scenario, unchanged:** `scn_series_decode.js`, phone 4x CPU, z2 and z6 at (-75, 30), GFS Waves, 10 ArrowRight steps,
the decode-path ms each step adds (`__MARINE_SERIES_DIAG__.decodeMs` read just before and 900 ms after each step: `stepBuildMs`),
3 sessions per arm per zoom, arms alternating first.

**Arms:** `worker` (as shipped), `kill` (`__RAW_DISABLE_SERIES_DECODE_WORKER__`), and NEW `noric` (the worker arm with
`requestIdleCallback` removed before boot: the Safari on iOS path, no build-ahead).

**Scored against both wordings on record, per arm (worker, noric) vs kill:**
- *Original (relative):* not worse than the kill arm by more than 5 ms p50 / 15 ms p95.
- *Amended (absolute):* per-step added ms p50 <= 5 and p95 <= 15.

The secondary `stepSyncMs` (the step's own synchronous builds) is reported too.

## 20:05Z: re-run A (as registered at 19:55Z; machine load NOT recorded): worker FAILS both wordings at z6 p95 by 0.3 ms; noric passes

Raw: `scratchpad/m3/g3re/runs.jsonl`. Production build of `origin/dev` 02a5c5cb1, phone 4x, 3 sessions per arm per zoom, 10 steps.
Per-step decode-path ms added (`stepBuildMs`), pooled, and per session (p50 / p95):

| zoom | arm | p50 | p95 | max | sessions (p50 / p95) | sync p95 (secondary) |
|---|---|---|---|---|---|---|
| z2 | worker | 0 | 5.7 | 19.8 | 0/5.7, 0/19.8, 0/3.9 | 5.4 |
| z2 | kill | 0 | 0 | 0 | 0/0 x3 | 0 |
| z2 | noric | 0 | 10.6 | 11.9 | 0/7.4, 0/10.6, 0/11.9 | 10.6 |
| z6 | worker | 0 | **15.3** | 17.8 | 2.1/17.8, 0.2/3.2, 0/14.5 | 11.4 |
| z6 | kill | 0 | 0 | 0 | 0/0 x3 | 0 |
| z6 | noric | 0.2 | 13.9 | 20.2 | 0.3/8.8, 0.9/13.9, 0.2/20.2 | 13.9 |

- **Original (relative) wording**, not worse than kill by > 5 ms p50 / 15 ms p95: worker z2 PASS, **z6 FAIL (+15.3 ms p95)**; noric PASS both.
- **Amended (absolute)**, p50 <= 5 and p95 <= 15: worker z2 PASS, **z6 FAIL (15.3)**; noric PASS both.
- Build-ahead that runs later than the 900 ms window is outside `stepBuildMs` by design; the noric arm has none at all, so its
  step cost is the first-read build (its p95 13.9 ms at z6).
- **A discrepancy I must flag:** the kill arm reads 0 per step here (the series pages are decoded on the main thread at ARRIVAL,
  before the steps, and frames are not built per step). The #921 body says the kill arm "adds p95 98-179 ms on the same steps" and
  that the original wording passed because of it. That does not reproduce in this run. The 98-179 ms figure needs re-checking against
  the earlier runs' raw files before anyone relies on it; until then the "passes its original wording" claim in #921 is unsupported.
- This run recorded no machine load (the director's quiet-machine rule came after it started). It stays on record as run A; the
  quiet-machine run under the registered void rule follows.
- **Correction to the bullet above (20:08Z):** the earlier runs DID record it: the series log's 16:13Z table has the kill arm at z6
  "0 / 98.2 / 122.7" (p50 / p95 / max). So the 98-179 ms figure is measured, not unsupported. In this run the kill arm adds 0, most
  likely because the kill arm's page decodes now land before the first step rather than inside a step's 900 ms window; that is not
  yet verified. What stands: the original wording's pass rested on the kill arm's in-window decodes, which did not occur this time.

## 20:24Z: re-run B on a quiet machine (the director folds it into the quiet-machine session); registered before it runs

Same instrument, build, arms (worker, kill, noric), zooms, sessions and both wordings as 19:55Z. Added, decided now: the load record
and void rule of `2026-11-15-opus-scrub-render-census.md` 20:20Z (a fixed 20,000,000-iteration in-page calibration before the first
and after the last step; a session is VOID above 1.25x the run's lowest calibration, re-run once at the end, else the arm runs short
and the run is INCOMPLETE; `typeperf` total CPU recorded). Per-session values are reported.

## 20:42Z: re-run B re-registered (the advisor's additions), before it runs; the first start of B was stopped unread

The 20:24Z start of re-run B was stopped about 10 minutes in, before any of its output was read, to register these first; its
partial files sit in `scratchpad/m3/g3b/` and are not used. Re-run B now runs from scratch with:
- **(a) 6 sessions per arm per zoom** (worker, kill, noric; z2 and z6; 72 sessions). Beside each p95 point value: the count of steps
  over 15 ms, and a bootstrap 95% interval for p95 (10,000 resamples of the pooled steps, seeded). **What decides:** the point values
  scored against both wordings, exactly as registered at 19:55Z; the interval and the count are reported beside it and do not change
  the verdict. Where the interval straddles 15 ms the line says so.
- **(b) The arrival cost in both arms**, reported (not gating): main-thread long-task ms within 1 s of a series page landing
  (`longTaskMsNearArrival`), per session and pooled.
- **(c) Why kill reads 0, verified:** each session records when its series pages landed (`pagesAt`) and when the first step began
  (`firstStepAt`), so the log states how many pages landed inside a step window in each arm.
- The 20:24Z load-void rule applies unchanged.
