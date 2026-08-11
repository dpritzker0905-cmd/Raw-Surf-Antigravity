# ARCHITECTURE CONVERGENCE LEDGER — 11.0 → 11.1

**Baseline** `c9a0e9fc` · **HEAD** `8be9dd56` · **103 commits** (105 including the two the concurrent
session pushed to `origin/dev` during this audit)

Counting method is stated for every number, because Report 11.0's counts used different windows and
a mismatched method would manufacture a trend. Where the method differs from 11.0's, that is said.

---

## 1. The scalar picture

| dimension | 11.0 | HEAD | Δ | direction |
|---|---:|---:|---:|---|
| distinct `window.__X__` globals in `components/map` | 447 | **448** | +1 | Diverging (marginally) |
| files carrying them | 142 | **146** | +4 | Diverging (marginally) |
| `.js` files in `components/map` (non-test) | ~142 | **150** | +8 | Diverging (marginally) |
| distinct `__RAW_*__` feature flags (frontend) | 316 | **321** | **+5** | **Diverging** |
| backend test files | 475 | **484** | +9 | **Converging** |
| frontend test files | 193 | **209** | +16 | **Converging** |
| e2e spec files | 2 | **2** | 0 | Unchanged |
| backend pipeline bare `except…pass` | 26 | **24** | −2 | Converging (marginally) |
| empty JS `catch {}` in `components/map` | 85 | **84** | −1 | Converging (marginally) |
| composition surfaces enrolled in the parity guard | 3 | **4** | +1 | **Converging** |
| WebGL contexts at runtime (healthy path) | 1 | **1** | 0 | Stable |
| RAF loops with a cancel path | 2 of 3 | **2 of 3** | 0 | Unchanged |
| ocean-mask authorities | 5 mechanisms / 3 sources | **5 / 3** | 0 | Unchanged (Violated) |

**Net:** the *verification* estate grew materially (+25 test files, +1 enrolled composition surface);
the *runtime* surface grew marginally (+8 components, +5 flags, +1 global). Architecture is
**FLAT — neither converging nor diverging materially** — with one genuine convergence and one
genuine divergence, named below.

---

## 2. The one genuine CONVERGENCE

**`578e9a1c` — the map rating band enrolled as the FOURTH composition surface.**

`test_rating_composition_parity.py:588` now asserts `len(POST_STEP_SURFACES) >= 4`. Before this,
the AST guard that enforces ONE FORECAST COMPOSITION could not see the surface users look at most.
That is a real reduction in the number of *ungoverned* rating paths, and it is enforced by a test
rather than by discipline.

★ It also earned its keep immediately: the guard caught the author's own CI double-edit
(`c7099d0a` → `6e5bf70a`) within hours — a composition file list that exists **twice** in `ci.yml`
and was edited in only one place.

**Second-order convergence** (real but smaller):
* `13b772bf` moved the wind layer onto marine's shared `deviceTier` helper — one fewer
  hand-rolled `innerWidth < 768` pool-sizing copy.
* `2e20122d` routed teardown through `safeDeleteTexture`, giving the GPU accounting one owner.
* `1073f36f` put `map.triggerRepaint()` in `finally` on **both** custom layers — the same contract
  on both renderers instead of one.
* `8b20f2c3` named the eight cross-fall cutovers as constants — values unchanged, drift impossible.

---

## 3. The one genuine DIVERGENCE

**Five new permanently-dual runtime paths, all shipped in one session (2026-08-10).**

| flag | what it forks | default |
|---|---|---|
| `__RAW_NEARSHORE_RENORM__` | wave height on land-adjacent cells (11.43× at worst) | OFF |
| `__RAW_LAYER_CAP_ALIAS__` | the per-layer forecast horizon cap for `rain` | OFF |
| `__RAW_AXIS_FLOOR__` | whether a past-axis stale frame is disclosed | OFF |
| `__RAW_BACKSTOP_IGNORE_GUARDRAIL__` | the R11-01 backstop suppression | OFF (suppression ON) |
| `__RAW_DISABLE_SERIES_PREWARM__` | series prewarm | OFF |

Report 11.0's own drift criteria name this exactly: *"a new feature flag that permanently preserves
two active paths."* Each is individually defensible — every one changes a number a user reads, and
the owner decision is genuinely theirs. Each is default-off, strict `=== true`, and mutation-tested
against silently defaulting on. **The problem is not any one of them; it is that five arrived
together with no dated retirement and no owner-decision deadline.** A flag with no expiry is a
permanent second implementation.

⚠️ `__RAW_LAYER_CAP_ALIAS__` is the sharpest: with the flag off, the app **knowingly serves a
14-day scrubber for a layer whose model supports 7**. The defect is now documented and dark; it
was previously undocumented and dark. That is better observability and identical user-visible
behaviour.

---

## 4. Duplicate-authority audit, responsibility by responsibility

| responsibility | 11.0 authority | current actual authority | bypass paths | direction |
|---|---|---|---|---|
| Forecast composition (height + quality) | `surf_point`→`surf_transform`→`surf_rating`, one write site | **unchanged, and now guarded across 4 surfaces** | none found | **Converging** |
| Rating mirror (JS) | hand-maintained, missing the refusal | refusal ported; still hand-maintained | parity gate covers 6 of 12 args | Converging (partly) |
| Forecast-time ownership | one `useState` + six one-way mirrors | unchanged | six mirrors | Unchanged |
| Model selection | per-lane | unchanged; sim still single-model-per-process | sim tools model-less | Unchanged |
| Grid orientation / projection | ~10 duplicated closed-form copies | unchanged | — | Unchanged |
| Field composition | `decideMarineCommit` choke | unchanged | dormant FCE dispatcher retains a 2nd decoder | Unchanged |
| Data caching (series) | page cache without run component | **frames now carry `run_time`; response carries `run_census`** | client page key still run-less | **Converging** |
| Animation scheduling | 3 loops, 1 uncancellable | unchanged | `WeatherTelemetry` FPS loop | Unchanged |
| Repaint scheduling | `triggerRepaint` per layer | **now in `finally` on both** | — | **Converging** |
| Ocean mask | 5 mechanisms / 3 sources | unchanged | — | Unchanged (Violated) |
| Texture lifecycle | dispose inventory missing score tex | **score tex added; teardown via `safeDeleteTexture`** | — | **Converging** |
| Worker lifecycle | no `onerror`, zero-fill on truncation | repaired (`47d249bb`) | — | **Converging** |
| Cursor / infobox values | ft/m missing on cards; fog blank on EURO/ICON | **both repaired** | cross-fall slot sampling still absent | Converging |
| Legends | rain mislabelled; wind legend a stale CSS copy | **both repaired, wind derived from the ramp** | radar dBZ open (refused for want of a spec) | **Converging** |
| Serve-time memory bound | end-stage `apply_vector_budget` | **build-time bound added** — retention bounded, allocation NOT | EURO / Open-Meteo fast paths bypass it entirely | **Diverging** ⚠ |
| Observability status endpoints | 3 fabricated surfaces | **2 now measure-or-refuse** | `system.py:208 error_rate = 0.5 # Placeholder` | **Converging** |
| Error handling (HTTP status) | 200-with-error on `/conditions/*` | **unchanged — 6 paths** | — | Unchanged |

---

## 5. Did any recent change increase architectural entropy?

**Yes, in exactly two places, and both are worth naming precisely:**

1. **The build-time series bound created a third memory-bounding stage without retiring either of
   the first two.** The system now has (a) `apply_vector_budget` on the assembled response,
   (b) `_series_build_stride` per hour in the generic loop, and (c) two fast paths (EURO,
   Open-Meteo) that reach neither. Three policies, one quantity — and the fix's own scope note
   says so. The measured consequence is in `SYSTEM_CAPACITY_DELTA.md`: the resident cost is
   essentially unchanged.

2. **Five new dual paths** (§3).

Everything else in the window either reduced duplication or left it flat.

---

## 6. Churn concentration (all-history commit counts per file — method differs from 11.0's window)

| file | commits |
|---|---:|
| `MapWebGL.js` | **394** |
| `WebGLMarineEngine.js` | 192 |
| `marineController.js` | 184 |
| `useMarineOrchestrator.js` | 158 |
| `WebGLMarineLayer.js` | 149 |
| `OceanMask.js` | 133 |
| `MapForecastOverlay.js` | 133 |

Report 11.0 measured 191/184/158/148/132/129 over its own window. The *set* of hotspots is
identical; `MapWebGL.js` remains the render control plane's single densest file. **No
consolidation happened here in this window, and none was attempted** — correctly so, given the
open correctness work.

---

## 7. Are legacy paths becoming safely removable?

| candidate | removable? | blocker |
|---|---|---|
| Canvas2D marine/wind fallbacks | **No** | still the only display when the guardrail trips |
| Dormant FCE dispatcher (2nd marine decoder) | **Yes, in principle** | zero production setters; nobody has priced the deletion |
| `_old_sampler` | **No, by design** | it is the argmin differential's only rollback |
| End-stage `apply_vector_budget` | **No** | it is still the ONLY bound on the EURO/Open-Meteo fast paths |
| ICON client blend | **No** | R11-06 unstarted; backend bake does not yet serve the per-hour lane |
| The five new flags | **Not yet** | each awaits an owner decision with no deadline attached |
