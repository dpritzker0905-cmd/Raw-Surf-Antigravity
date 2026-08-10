# Rationale — 2026-08-09 observability + duplicate-load fixes

Moved out of the source files to satisfy the LOC ratchet (`scripts/loc_ratchet.py`).
**The knowledge is not deleted, it is relocated** — the house rule after the 2026-08-04 finding that
both LOC regressions were ~90% rationale. Each call site keeps a one-line pointer here.

Covers four fixes, all from the Master Weather Simulation Report 11.0 audit
(`audit/weather-simulation-11.0/`). None of them changes a forecast number.

---

## 1. `useMapDebugTools.js` — the published diagnostics were stale snapshots

**Symptom.** `window.__SIM_DIAGNOSTICS__` reported a healthy 60 Hz engine as **frozen**.

**Measured (2026-08-09).** Over a 3 s window the global's `frameIndex` delta was **0** while
`SimulationLoop.getSimDiagnostics().frameIndex` advanced **180** (exactly 60 Hz). Absolute drift at
the time of measurement: live 29,157 vs published 27,743 — **1,414 frames ≈ 23.6 s stale**.

**Root cause.** The globals were plain assignments of React props inside a `useEffect`, and that
effect had been *deliberately* decoupled from per-frame updates for performance (its own note says
"a bridge update does not re-run it"). The perf win silently froze the published diagnostics. Nobody
noticed because nothing compared the global against its source.

**Cost.** It cost this audit four probes and produced two fabricated hypotheses — "the engine
stalls" and "the engine runs 7.5× too fast" — before the instrument itself was suspected. Both were
wrong; the engine holds 1.00× real time.

**Fix.** `defineLive(name, read)` publishes an accessor (`Object.defineProperty` + `get`) instead of
a value.
* `__SIM_DIAGNOSTICS__` → `getSimDiagnostics()` (engine module, always live)
* `__GPU_DISPATCHER__` → `getDispatcherDiagnostics()` (engine module, always live)
* `__FCE_FIELD__`, `__FCE_DIAGNOSTICS__` → refs updated every render (React-owned; no module getter
  exists, so "as fresh as the last render" is the ceiling — better than "last effect run")

**Why not just re-run the effect per frame:** that would undo the performance decision the effect
was restructured to make. A live getter costs nothing until something reads it.

★ **The general rule this yields:** *a diagnostic that can be stale must either be live or carry its
own timestamp.* `__DATA_DIAG__` in the same file is still a snapshot — but it stamps `timestamp`, so
a stale read is **detectable**. That is the difference between an honest snapshot and a lying one.

**Proof.** Each read now constructs a fresh object (`window.__SIM_DIAGNOSTICS__ !==
window.__SIM_DIAGNOSTICS__`) and deep-equals the live module. A stale snapshot is structurally
impossible.

⚠️ **A non-defect, recorded so it is not "fixed" later.** The audit also claimed `window.__RAW_GPU__`
"changed type mid-session (function → object)". **That was the auditor's probe bug, not a defect.**
`__RAW_GPU__` is assigned once as a plain object (`WebGLMarineEngine.js:102`, guarded by
`!window.__RAW_GPU__`) and mutated in place by several modules, so reads are always fresh. Leave it.

---

## 2. `SimulationLoop.js` — a counter that advanced when the work was skipped

**`_evolutionTicks++` sat OUTSIDE the `shouldEvolve` guard.** Measured on `/map` with
`__IN_SIMULATION_SANDBOX__` unset: `getSimDiagnostics().evolutionTicks` read **304** while
`evolveField` had run **zero** times. A counter that advances when the work is skipped is not a
diagnostic, it is a decoy.

`FieldEvolutionEngine.getEvolutionDiagnostics` (:428-429) already ANDs the count with `inSandbox`,
i.e. it was compensating downstream for a number that lied upstream. Now the number is true at the
source and that AND is belt-and-braces rather than load-bearing.

**The boot banner was also false.** It printed *"RK4 particles + field evolution active"* on every
boot. In the shipped map path `shouldEvolve` is false, so `evolveField`, `_windParticles.update` and
`_marineParticles.update` **never run**. An audit had to measure the flag to establish that the
product is a forecast **visualiser with GPU advection**, not a running physics simulation — the
console said otherwise every time. The banner now names the gate and states which path actually
drives the visible crests (`WebGLMarineEngine` / `WebGLWindEngine`, a different path from this
loop's RK4 system).

**Post-fix:** `evolutionTicks` reads **0** on `/map`, alongside `marineParticles: 3000` and
`hasEvolvedField: true` — the particle systems exist, they simply never advance. That is the truth.

---

## 3. `marineGridSeries.js` — an abort listener leaked on the queued-drop path

**Measured.** Over 4 Waves toggle cycles: `abort @ loadSeriesPage` — **10 added, 0 removed**.

**Root cause.** `loadSeriesPage` registers `onCallerAbort` on the **long-lived** caller signal (one
`AbortController` per model+layer+map, reused for the whole session). Its `finally` removes it
correctly — but the early return taken when `acquireSeriesSlot` fails or the signal is already
aborted sits **outside** that `try`, so the removal never runs. Every load **superseded while
queued** — constant during pan/scrub — left a listener behind.

The registration site's own comment already said the handler is named *"so the finally can REMOVE
it"* and described the exact monotonic accumulation. The cleanup was written; one of the two exit
paths never got it.

**Why the fix goes in the early-return branch and not by moving the acquire inside the `try`:** the
`finally` calls `releaseSeriesSlot()`. Covering a path that never *took* a slot would **over-release
the semaphore**. The narrow fix is correct; the tidy-looking refactor is a bug.

**Post-fix:** 3 `addEventListener('abort')` / 3 `removeEventListener('abort')`, with the third add
using `{ once: true }` (self-removing). Both exit paths of `loadSeriesPage` now remove.

---

## 4. `OceanMask.js` + `openMeteoProtocol.js` — the 2.76 MB land asset fetched three times

**Measured.** `/ne_50m_land.json` was requested **3×** on a single page load.

**Root cause.** Three owners, three private caches, one asset:
| owner | cache |
|---|---|
| `mapUtils.getSharedLandGeoJSON` | `window.__LAND_GEOJSON_PROMISE__` / `__LAND_GEOJSON_CACHE__` |
| `openMeteoProtocol.getLandGeoJSONOnce` | module-local `LAND_GEOJSON_PROMISE` |
| `OceanMask.loadLand` | **none** — a bare `fetch` |

`getSharedLandGeoJSON` already existed and already had consumers (`WebGLMarineLayer`, and
`OceanMask` itself for the hi-res twin). The other two simply never adopted it.

**Fix — HALF SHIPPED, and the other half is blocked by the LOC ratchet.**

* ✅ `OceanMask` imports and calls `getSharedLandGeoJSON()` — it also gains the 110m fallback that
  call site did not have. **Measured post-fix: 3 → 2 fetches per page load.**
* ⛔ `openMeteoProtocol` — **written, verified at 1 fetch, then REVERTED.** The read-or-publish
  version needed ~+12 lines in a file grandfathered at **943 LOC**, and `scripts/loc_ratchet.py`
  allows grandfathered files to **shrink only**. Compressing the logic into one-liners to fit a line
  budget is a worse outcome than one extra cached fetch, and `--update-baseline` is forbidden.

  ⚠️ **When someone picks this up:** it must **NOT** `import { getSharedLandGeoJSON } from './mapUtils'` —
  `mapUtils.js:294` does `export * from './openMeteoProtocol'`, so that import closes a **cycle**.
  The working approach was to read-or-publish `window.__LAND_GEOJSON_PROMISE__` /
  `__LAND_GEOJSON_CACHE__` directly (no import), keeping a private fetch as the fallback for realms
  without `window`, and clearing both slots on failure behind an identity check against the captured
  promise so a failed load cannot stomp a newer one. **Verified at 1 fetch/load before reverting.**

  **Real prerequisite: split `openMeteoProtocol.js` (943 LOC).** Queued in
  `audit/weather-simulation-11.0/OPEN_QUESTIONS_AND_BLOCKERS.md`.

**Post-fix today:** **2** fetches per page load (was 3).

---

## What was NOT done, and why

* **The two extra RAF-driven FPS counters** (4 concurrent RAF chains at idle: engine + two FPS
  counters + a web-vitals probe). Removing one means deciding which of two user-visible readouts is
  redundant — that is a product call, not a cleanup, and guessing would break a badge someone reads.
* **The 0×0 canvas with a 1×1 backing store** (a collapsed duplicate timeline scrubber). Cosmetic,
  and untangling which of the two scrubber instances should not mount needs the responsive-layout
  owner's intent.

Both remain queued in `audit/weather-simulation-11.0/OPEN_QUESTIONS_AND_BLOCKERS.md`.
