# DO NOT ADVANCE — 11.2

Items that must not proceed until the named gate passes. This file exists to stop gate-skipping.

## 1. Failed prerequisites (block everything below)
- **Gate 1 Data Truth — FAIL.** `AUTHORITATIVE NATIVE` is a one-bit function of `isEstimated`
  (`TruthOverlay.js:418`) and was observed green on a coarse resample, a cross-model fallback, and
  a null product.
- **Gate 3 State & Concurrency — FAIL.** Layer and model round-trips are unstable; model identity
  has three simultaneous disagreeing authorities; no recovery after request failure.
- **Gate 5 Scientific Conformance — FAIL.** Product-selection state changes the served value.
- **Gate 7 Regression Protection — FAIL.** The guard covering this area passes vacuously.
- **Gate 2 Projection — BLOCKED (untested).** Must not be recorded as passing.
- **Gate 6 Capacity — BLOCKED (unmeasured).** Must not be recorded as passing.

## 2. Technologies that must not begin
| Candidate | Decision | Why |
|---|---|---|
| WebGPU migration | **DEFER** | No measured GPU bottleneck; Gate 8 blocked. |
| OffscreenCanvas / worker rendering | **DEFER** | No workers exist today (`workersMade: 0`); adding one adds an authority to a subsystem that already has three disagreeing ones. |
| Zarr / Kerchunk / Xarray pipeline modernization | **DEFER** | The data contract at the backend is already strong; the defect is that the **client discards** it. Fix the consumer first. |
| Nearshore / coastal wave model | **DEFER** | Cannot validate a finer model while a fixed coordinate's value depends on interaction history. |
| Neural emulators, learned downscaling, model blending | **REJECT for now** | No observational validation exists (G-09). A learned correction fitted against an unvalidated baseline is unfalsifiable. |
| Bias correction | **DEFER** | Same reason. |

## 3. Architecture that must not be replaced yet
- **`marineTransitionCoordinator`** — it is the best-working authority in the system. Do not
  refactor it while diagnosing RC-03; it is not the cause.
- **`CanvasAnimationCoordinator`** — single RAF authority, measured stable. Leave it alone.
- **The GPU resource lifecycle** — measured idempotent and releasing. Do not "optimize" it.

## 4. Legacy paths that cannot yet be removed
- The **`window.__MARINE_TRANSITIONING__` mirror** is a *declared* transitional dual path. Do not
  remove it until every reader is migrated **and** the migration is verified by execution — and do
  not declare that migration complete while both paths are live (§26).

## 5. Performance work that could threaten correctness
- Do not act on the ~27 s cold start, the 4 s pre-request dead time, the duplicated
  `grid_series hours=0`, or the global-extent fetch **as performance work**. Any of these may be
  load-bearing for the product-selection logic that RC-03 shows is already non-deterministic.
  Fix determinism first, then measure again.
- Do not reduce particle count for FPS until Gate 2 confirms the field is drawn correctly at all.

## 6. Reporting that must not be repeated
- Do not cite this audit's **resolution or coverage** numbers as production facts. They are local
  (G-01).
- Do not record Gates 2 or 6 as passing anywhere. They were not tested.
