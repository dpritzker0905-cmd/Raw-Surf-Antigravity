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
