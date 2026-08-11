# DO NOT ADVANCE — 11.2

Items that must not proceed until the named gate passes. This file exists to stop gate-skipping.

> ⚠️ **CORRECTED 2026-08-11 (later same day).** This file was written before the Gate 2 and Gate 6
> measurements landed, and it contradicted `RELEASE_GATE_MATRIX.csv` — which is the authority. A
> session reading only this file would have re-measured work that was already done, or recorded
> "untested" for gates that carry results. Original text preserved below each correction.
> ⭐ **The file that stops gate-skipping is worthless if it disagrees with the gate record.**
> Two files stated the gate set; only one was updated. Check both before citing either.

## 1. Failed prerequisites (block everything below)
- **Gate 1 Data Truth — FAIL** *(verdict stands; the cited MECHANISM is repaired)*. The one-bit
  ternary is gone: `TruthOverlay.js` now computes a six-valued class (`NO DATA` /
  `UNVERIFIED SOURCE` / `ESTIMATED FALLBACK` / `SUBSTITUTED SOURCE` / `RESOLUTION UNKNOWN` /
  `COARSE n° GRID` / `AUTHORITATIVE NATIVE`) — shipped `516a7200`, verified by execution
  2026-08-11. ⛔ **The FAIL verdict is not lifted by this note** — a gate verdict is a measurement,
  and the failure-injection journey has not been re-run. Re-run it before changing the verdict.
  *(ORIGINAL: "`AUTHORITATIVE NATIVE` is a one-bit function of `isEstimated` (`TruthOverlay.js:418`)
  and was observed green on a coarse resample, a cross-model fallback, and a null product." The
  line-418 citation no longer resolves — the file has moved on.)*
- **Gate 3 State & Concurrency — FAIL.** Layer and model round-trips are unstable; model identity
  has three simultaneous disagreeing authorities; no recovery after request failure.
- **Gate 5 Scientific Conformance — FAIL.** Product-selection state changes the served value.
- **Gate 7 Regression Protection — FAIL** *(verdict stands; the cited MECHANISM is repaired)*. The
  vacuous guard is gone: parity is four-valued (`MATCH`/`MISMATCH`/`UNSAMPLED`/`NOT_APPLICABLE`,
  `516a7200`) and the HUD row now consumes it on every path including `MISMATCH` and
  instrument-absent (`truthVerdict.js`, 2026-08-11). Both are mutation-verified. ⛔ **Deterministic
  tests for RC-01..RC-04 still do not exist** — that is the rest of this gate.
- **Gate 2 Projection — CONDITIONAL PASS** *(corrected: was "BLOCKED (untested)")*. Measured
  2026-08-11; see `GATE2_PROJECTION_CERTIFICATION.md`. ⛔ Must not be recorded as a full PASS.
  Residue: DPR 1v2, resize, pixel-wise OceanMask registration. **Synthetic canonical fields now
  exist for the ENCODER half** (`WebGLMarineTextureEncoder.canonicalFields.test.js`, 2026-08-11,
  mutation-verified in both directions): handedness (meteorological "from", +u=east, +v=north),
  index order (cell *i* -> texel *i*, no row/column reversal) and `UNPACK_FLIP_Y_WEBGL` false are
  settled. ⛔ **Still open, and the harness says so in its own header:** whether the BACKEND's
  `vectors[0]` is the NW or SW corner, and whether the SHADER's `v=0` samples north or south.
  ★ A pass-through proof is not an end-to-end proof — **two flips still cancel.**
- **Gate 6 Capacity — CONDITIONAL PASS** *(corrected: was "BLOCKED (unmeasured)")*. Measured
  2026-08-11; see `CAPACITY_CERTIFICATION.md`. ⛔ Must not be recorded as a full PASS. Residue:
  frame behaviour needs a non-throttled harness (all FPS readings are RETRACTED — RAF delivered
  1 frame in 5 s under pane throttling), and the transfer spikes are unbounded.

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
- Do not record Gates 2 or 6 as a **full PASS**. *(CORRECTED 2026-08-11: the original read "They
  were not tested." They were — both were measured later the same day and carry CONDITIONAL PASS
  with named residues. The instruction not to overstate them stands; the claim that they are
  unmeasured does not.)*
- ⛔ **Do not restate a gate verdict from this file alone.** `RELEASE_GATE_MATRIX.csv` is the
  authority; this file is a derived summary and has already drifted from it once.
- ⛔ **Do not cite `F-STALE` as "9× over budget / production may have stopped."** Re-measured
  2026-08-11T22:09Z against production `GET /api/weather/products`: **130 (model, layer, tier)
  marine triples, max age 1.72 h, p50 0.95 h — nothing is stale by hours, so the pipeline is
  running.** But **127/130 (98%) exceed the declared `freshness_sec: 1800`**, and only ICON
  `global_coarse` sits inside it. By F-STALE's own discriminator that is **sawtooth, not monotonic
  growth ⇒ the DECLARATION is wrong, not the pipeline.** The original 4.5 h / 9× reading does not
  replicate; it was one sample. ⚠️ Caveat: refreshes are **batched** into ~5 distinct `run_time`s,
  so effective n ≈ 5, not 130 — two more samples ~60 min apart pin the true cadence. That is
  ~2 hours of work, not the 24 h the original note projected.
  ⭐ **A cross-sectional sample over many products can substitute for a longitudinal sample of one.**
