# STATE-OF-THE-ART PATH CHECK — Audit 13.1

**Scope, per the audit contract:** research is limited to *subsystems changed since the
baseline*, *the current release gate*, *the next proposed gate*, and *confirmed remaining
bottlenecks*. Nothing else is surveyed.

---

## The finding that frames every row below

The program already reached the correct answer, in this window, at `4b281e11`:

> **"researched the path to state of the art — it is not a technology, and the repo already
> said so."**

**Audit 13.1 confirms it independently.** Not one finding in this report is solved by adopting a
new technology. The open items are: a mislabelled published field, an unwatched default-ON
ingestion lane, a stale register, an over-firing instrument, and a serving tier that has not
caught up to the resolution its own ingestion now fetches.

---

## The ten questions, applied to each candidate

### ⭐ 1 · Complete the 0.083° island lane's SERVE half — **COMPLETE EXISTING MIGRATION**

| question | answer |
|---|---|
| What verified problem does it solve? | **The served marine grid is `~223 km (2°)` at every zoom from 5 to 12**, measured on the deployed build (Finding 13.1-F4) |
| Prerequisite gate passed? | **No — Gate 1 is failing.** This is why it is the mission *after* 13.1-C1, not now |
| Bottleneck measured? | **Yes** — 20-cell deployed sweep + 20-cell local control |
| Partial migration already exists? | **Yes** — `fb50fa6d` shipped the ingest half **and it is default ON** |
| Can it run in shadow? | Yes — gate serving on an explicit tier declaration |
| Rollback? | Yes — one env default |
| Creates another authority? | **It already did.** EURO now has 3 marine ingestion lanes |
| Deterministic fallback preserved? | Yes — the 2° lane remains |
| Shortens the critical path? | **Yes — more than anything else on this list** |
| Correct next step? | **Not yet.** Immediately after 13.1-C1 |

**Decision: COMPLETE EXISTING MIGRATION.** Highest-leverage item on the board. An ingest half
that is default ON with no serve half is the worst of both states: it changes chain data without
delivering the resolution benefit.

---

### 2 · WebGPU — **DEFER**

`navigator.gpu` is **false** in the audit context. No frame-time bottleneck was measured
attributable to WebGL — and under SwiftShader no such measurement would be meaningful anyway.
The renderer census is stable: **2 custom MapLibre layers, 2 GL engine constructors, 1 context,
byte-identical to baseline**. Adopting WebGPU would create a **third** renderer authority in a
program that has removed **zero** authorities in 128 commits.

**Reopening condition:** a measured frame-time bottleneck on real hardware attributable to WebGL.

---

### 3 · Zarr / Kerchunk — **DEFER**

Correctly identified as a candidate for chunked geospatial array access. But the measured ceiling
is **not** a storage-format problem: the `.om` upstream is healthy (`HEAD` 200, `Range` 206,
`latest.json` 200/5,332 B), the 0.25° product **is** requested, and the served resolution is
still 2°. **The bound is in tier selection and serving, not in how the arrays are stored.**

**Reopening condition:** after the resolution ceiling lifts and storage/bandwidth becomes the
next measured bound.

---

### 4 · Worker rearchitecture / transferable buffers — **NOT NECESSARY NOW**

| measured | value |
|---|---|
| `new Worker` construction sites | **2**, identical to baseline |
| live workers on the map route | **18**, off it **1** |
| multiplication under race + 3 remount cycles | **none** |

**There is no problem here.** Rearchitecting a subsystem with zero measured defects, while Gate 1
fails, is the definition of premature modernisation.

---

### 5 · MapLibre custom-layer architecture — **CONTINUE CURRENT APPROACH**

Two custom layers, stable across 128 commits, surviving an unthrottled race journey, a 12-camera
projection tour including the antimeridian and 66.5 °N, and three remount cycles with clean
context release.

**The debt to pay is not the layer model — it is the projection duplication:** **6 JS + 11 GLSL
definitions** of one Web-Mercator Y transform. `marineMaskProjection.js:118` calls itself the
shared projector, yet `WebGLMarineMaskRenderer.js:607` defines its own, and the engine consumes
`marineEngineDecisions.js:27` rather than the generically named `mapUtils.js` export.

**Decision: CORRECT CURRENT APPROACH** — consolidate the 17 definitions. This is exactly what
`WS-CAN-0069` ("the second renderer") was reserved for, **and that id was never allocated.**

---

### 6 · React rendering boundaries — **BENCHMARK FIRST**

**No React Scan or React Profiler capture was obtained** (`OPEN_EVIDENCE_GAPS.md` G-09). This
audit makes **no statement** about React commit counts or re-render behaviour, and no
modernisation here can be justified without that measurement.

⚠️ One data point that *is* established and bears on it: at step 9 of the parity trace, the
**HUD displays a violation while the computed state says there is none** — consistent with a
React-state snapshot not re-rendering when the window object updates. That is a hypothesis, not a
finding, and it is the natural first thing a profiler capture would resolve.

---

### 7 · Async cancellation — **CONTINUE**

Working, and measured working:

- Race journey: **71 in-flight requests** under unthrottled thrash, **no stale label survived**,
  no old field reappeared.
- `modelSwitch × timeScrub` interaction residual ≈ **0** on every output.
- `hidden × timeScrub` residual ≈ **0**.

The two input pairs most likely to produce a stale-data race produce **no interaction at all**.
**Preserve; do not refactor.**

---

### 8 · Cache freshness / service workers — **NOT ASSESSED**

No probe distinguished a fresh grid from a cached one (`OPEN_EVIDENCE_GAPS.md` G-14), and
WS-CAN-0005 (true model-cycle identity) is **owner-blocked** because 87 spots share `run_time` to
the microsecond — rendering it would ship an ingest clock as a forecast cycle. **The owner
decision precedes any technical work here.**

---

### 9 · Scientific forecast validation / nearshore modelling (Gate 7) — **CONTINUE, DARK**

The WS-CAN-0076 nearshore outcome loop is **imported by nothing** under `backend/routes` or
`backend/services` — confirmed from code, not from its commit message — and it **reuses the
serving path's own component functions** (`nearshore_validation.py:75-87`) rather than
re-deriving them.

**This is the single best-behaved new subsystem in the window.** Keep it dark until Gate 1
closes.

---

### 10 · Model blending / AI correction (Gate 8) — **REJECT FOR NOW**

Gate 1 is **failing**, and `/conditions/batch` currently publishes a field whose physical meaning
depends on which lane answered. **An AI correction layer applied over an ambiguous quantity
multiplies the ambiguity rather than reducing it** — and it would make the ambiguity much harder
to detect afterwards, because a learned correction absorbs a systematic offset without
complaining.

**Reopening condition:** Gate 1 passes.

---

## Where current practice is already ahead of typical

Recorded so the program does not "modernise" away things it does better than the norm:

| practice | where |
|---|---|
| **Three-valued and four-valued gates that REFUSE rather than pass** | `forecastDiagnostics.js:294` — *"a check that cannot tell 'not sampled' from 'agrees' must REFUSE"*. The principle is right; F3 is a scoping failure of an otherwise excellent design. |
| **User-facing resolution disclosure** | `servedResolutionNotice.js` — silent on native tiers, **refuses** on unknown resolution: *"an unknown resolution is not 'fine' and not 'coarse'"*. Few forecast products disclose their own grid coarseness to end users at all. |
| **Dark-by-default science changes with a declared kill switch** | `SURF_CAP_SEAM_MONOTONE`, `__RAW_COARSE_BRIDGE_GRACE__`, the nearshore loop |
| **AST-census guards that discover their own subjects** | `a1b5aac3` — a new emitter is graded without editing the guard |
| **Fixture-integrity censuses** | `a6e4339a` — no test double may answer a `Range` request with a fixed body |
| **An append-only proof log for layer ordering** | `LAYER_ORDER_PROOF_LOG.json` |

---

## Summary decision table

| candidate | decision |
|---|---|
| **Island lane SERVE half** | **Complete Existing Migration** — highest leverage, immediately after 13.1-C1 |
| **Projection consolidation (6 JS + 11 GLSL)** | **Correct Current Approach** |
| MapLibre custom-layer model | **Continue Current Approach** |
| Async cancellation | **Continue** |
| Nearshore modelling (Gate 7) | **Continue, dark** |
| React boundaries | **Benchmark** |
| WebGPU | **Defer** |
| Zarr / Kerchunk | **Defer** |
| Worker rearchitecture | **Not Necessary** |
| Cache freshness | **Not Applicable** — owner-blocked upstream |
| AI-assisted enhancement (Gate 8) | **Reject for now** |
