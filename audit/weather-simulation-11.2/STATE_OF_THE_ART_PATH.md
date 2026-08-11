# BEST PATH TO STATE OF THE ART — Jacobian-ranked, 11.2

## The strategic finding, in one line

The Jacobian shows **two sensitivities that are exactly inverted**:

| Quantity | Should be | Measured |
|---|---|---|
| ∂(forecast value at a fixed coordinate) / ∂(interaction history) | **0** | **≠ 0** — ±45% in height, 2.2–2.4× in period |
| ∂(truth report) / ∂(actual truth) | **≠ 0** | **0** — badge, LOADED row and parity gate are all invariant to total data loss, on production |

**The number that must not move, moves. The report that must move, cannot.**

That is the whole problem, and it dictates the order of everything below. No state-of-the-art
forecasting technique — bias correction, model blending, learned downscaling, nearshore models,
neural emulators — can be *evaluated* on a system whose served value depends on interaction
history and whose self-report returns PASS unconditionally. Adopting any of them now would be
**unfalsifiable**: you could not tell an improvement from a regression.

**So the path to SOTA does not start with SOTA. It starts with restoring the ability to measure.**

---

## Phase 0 — Repair the instruments (days, ~4 files)

*Highest leverage in the entire audit. All four are small, and three are near-trivial.*

| # | Change | Files | Jacobian row addressed |
|---|---|---|---|
| 0.1 | Fix the orphaned field names: `renderedVectorCount` → `webglSourceVectorCount`, `renderedNonzeroCount` → the published nonzero key | `forecastDiagnostics.js:73,74,241,242` | dead instrument (blind ~10 weeks) |
| 0.2 | Make parity **three-valued**: `MATCH` / `MISMATCH` / **`UNSAMPLED`**. `UNSAMPLED` must never render as a pass and must suppress "No Causal Layer Violations Detected" | `forecastDiagnostics.js:246-254` | vacuous pass |
| 0.3 | Make `Class` **multi-valued** over `(isEstimated, productId != null, resolution, upstream_model vs active model)`: `AUTHORITATIVE` / `COARSE` / `SUBSTITUTED` / `NO DATA` / `UNKNOWN`. Never take the confident branch on `undefined` | `TruthOverlay.js:231,416,418` | inverted coupling (badge) |
| 0.4 | Carry `resolution` — and ideally `truthTag.dataHash` — from the grid response into `__MARINE_PROJECTION_DIAG__` and the legend | client parse boundary | dropped signal |

**Exit criterion:** with all `/api/weather/*` rejected, the HUD must not read `LOADED` +
`AUTHORITATIVE NATIVE` + zero violations. Automate the production injection harness as the test.

**Unblocks:** Gate 1, Gate 7.

---

## Phase 1 — Make the number deterministic (1–2 weeks)

Tier/product selection must become a **pure function of `(viewport, zoom, model, layer, hour)`** —
never of interaction history, and **monotonic** in zoom (closer view ⇒ equal or finer grid, never
coarser).

**Note this is not a new bug.** Report 11.0's Jacobian already recorded the non-monotonic
`z8/z9/z10` tier selection and called it "the strongest single lead". It is still present at HEAD
and now reproduces on a second axis (layer round-trip). **It has survived one full audit window
unrepaired.**

**Exit criteria:**
- Layer OFF→ON ×3 returns an identical `productId` and identical sampled value every time.
- Zoom sweep z5→z12 at a fixed coordinate is monotonic in tier and stable in value.
- The active tier is **disclosed** in the UI (this is why 0.4 comes first).

**Unblocks:** Gate 3, Gate 5.

---

## Phase 2 — Failure semantics (1 week)

Detect request failure; surface it; retry with bounded backoff; recover without user action.
Today there is no edge out of the failed state — 15 s of restored network on production produced
byte-identical output.

**Unblocks:** the rest of Gate 3.

---

## Phase 3 — Measure what has never been measured (2–3 weeks)

Gates 2 and 6 are **untested, not passed**, and must stop being reported as anything else.

- **Gate 2 (Projection):** antimeridian, high latitude, polar, bearing, pitch, DPR 1/2, resize,
  OceanMask registration, coastline alignment. Use synthetic canonical fields (uniform E/W/N/S,
  vortex, checkerboard, gradient) — they are the only way to catch row reversal, UV flip and
  handedness, and none exist today.
- **Gate 6 (Capacity):** cold/warm startup, soak, throttling, mobile viewport, heap snapshots.
  Fold in **PF-01** — one layer activation currently issues **15** weather requests across 4
  layers including a whole-planet `grid_series`, against a 2 GiB-capped box. Fix the fan-out here,
  **not** earlier: it may be load-bearing for the selection logic Phase 1 is rewriting.

---

## Phase 4 — Establish ground truth (the real SOTA prerequisite)

**Nothing above this line makes the forecast better. Nothing below it is possible without it.**

Build an observational validation harness: NDBC buoys, tide/water-level stations, and archived
forecast snapshots → **bias, MAE, RMSE, directional error, correlation, and skill vs persistence
and vs the unmodified source model**, per region and per lead time.

This is the single highest-value *scientific* investment available, and it is currently absent
(G-09). Without it every accuracy claim — including "the height flip is validated" — rests on
internal consistency rather than on reality.

**Exit criterion:** a nightly scorecard that can detect a regression in served skill.

---

## Phase 5 — Only now is modernization decidable

With a working scorer, each candidate becomes an experiment with a pass/fail answer. Run every one
in **shadow mode** behind a flag, scored against Phase 4, adopting only on measured skill gain:

| Candidate | Order | Why this order |
|---|---|---|
| Bias correction against buoys | 1st | Cheapest, largest expected skill gain, directly scored by Phase 4 |
| Multi-model blending (GFS/ECMWF/ICON) | 2nd | The lanes already exist; blending is a scoring problem, not an engineering one |
| Learned downscaling / statistical nearshore | 3rd | Needs 1–2 to establish a trustworthy coarse baseline |
| Physical nearshore model (SWAN-class) | 4th | Highest cost; only justified if 3 plateaus |
| Neural emulators / graph coastal models | 5th | Justified only by a measured bottleneck that 1–4 fail to close |
| WebGPU / OffscreenCanvas / worker rendering | Deferred | No measured GPU bottleneck; Gate 6 unmeasured. This is a *rendering* answer to a *truth* problem |
| Zarr / Kerchunk / cloud-native pipeline | Deferred | The backend data contract is already strong (`truthTag`, full provenance). The defect is that the **client discards it**. Fix the consumer, not the producer |

---

## What this path deliberately refuses

- It does not start with performance. The ~27 s cold start and the 15-request fan-out are real,
  but touching them before Phase 1 risks perturbing the selection logic that is already
  non-deterministic.
- It does not start with new data sources or new models. A better input measured by a broken
  instrument is indistinguishable from a worse one.
- It does not remove the `window.__MARINE_TRANSITIONING__` mirror, or refactor
  `marineTransitionCoordinator`, `CanvasAnimationCoordinator`, or the GPU resource lifecycle.
  Those are the parts that **passed**.

## The one-line version

**Fix the instrument (Phase 0), stabilise the number (Phase 1), then earn the right to modernise
by being able to score it (Phase 4).** Phase 0 is roughly four files and would have caught every
Critical finding in this audit before it shipped.
