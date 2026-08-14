# COMPLETENESS TRACEABILITY GRAPH — Audit 12.2

**The central deliverable.** For every critical runtime surface:

```
Runtime Surface → Contract → Objective → Canonical Task → Implementation
                → Test → Runtime Evidence → Owner → Observability → Recovery/Rollback
```

Classification per link: **Complete · Complete Under Monitoring · Missing Contract · Missing
Objective · Missing Task · Missing Implementation · Missing Test · Missing Runtime Evidence ·
Missing Owner · Missing Observability · Missing Recovery · Conflicting Chain · Unable to Determine.**

---

## The shape of the result

The breaks are **not** where six audits of engineering effort have been spent. Data correctness,
projection, normalization, cancellation, GPU lifecycle and composition all trace cleanly. **Every
broken chain in this graph breaks at one of three links:**

| Link | Chains broken here | Why |
|---|---|---|
| **Objective / Task** | 6 | The surface exists and runs and no row in the program names it |
| **Test** | 5 | Active runtime paths with no test that exercises them |
| **Observability (the "who reads it" link)** | 4 | An instrument produces correct output that reaches nobody |

The third is new, and it is the audit's structural finding: **the graph has no link for *who reads
the output*, and that is precisely where this platform fails.** A chain can be Complete through
Runtime Evidence and still be worthless if nothing consumes the evidence. Three of the four such
chains below were **green all the way to Observability and still failed.**

---

## A. CHAINS THAT ARE COMPLETE

Recorded first and in full, because a coverage audit that only prints breaks misrepresents the
system.

### A1 · Nearshore breaking height and the 0-100 quality — **COMPLETE**
`surf_point.resolve_surf_geometry` → `estimate_surf_at` → `surf_rating.compute_surf_rating`
→ contract: CLAUDE.md ONE FORECAST COMPOSITION (binding) → **WS-OBJ-201** → *(certified, no open
task)* → 63 consuming files, single write site `point_surf_augment.py:204` → `backend/tests/`
composition guards (`1779 tests / 0 failed`) → LV-06 + this audit's independent bypass search
(nothing under `backend/routes/`) → owner: science registry + ratchet → `/api/weather/point`
provenance fields → kill-switch + control-arm discipline.
⚠️ **One consumer never joined this chain** — see D1. The chain is intact; its *consumer census* was
not.

### A2 · Model normalization, units, direction, ±180 wrap, antimeridian — **COMPLETE**
`WeatherNormalizer.normalize` single authority → WS-OBJ-002 → converged, no duplicate → tests →
LV-05 → observability via provenance fields → rollback via flags. **SOTA A4 MET, and genuinely
state of the art.**

### A3 · Projection and per-vertex Web Mercator — **COMPLETE UNDER MONITORING**
GPU projection authority → WS-OBJ-102 → WS-CAN-0028 *(open)* → WebGL2 custom layers → tests →
LV-05 **plus this audit's 24/24 geography cells rendered incl. 179.6° and 68°N** → owner → 
`styleLoaded`/layer counts.
⚠️ *Monitoring* because row order and UV flip remain unverified **in both directions** (SOTA A5).
**Every measurement in this audit grades reachability, never value correctness.**

### A4 · Async cancellation and stale-response rejection — **COMPLETE**
Monotonic request ids + live-target guards → WS-OBJ-002/003 → verified line-by-line at 11.0 →
`ERR_ABORTED` observed live in this audit's network capture (23 to `map-tiles.open-meteo.com`),
which is the authority working, not failing.

### A5 · Release identity — **COMPLETE**
`/api/health` embeds the SHA; SW `BUILD_VERSION` stamped by `update-sw-version.js` (fails closed in
an `&&` chain); `marineForensics.announceBuild` cross-checks the running bundle.
Verified live this audit: backend `172f66aa`, dev SW `791fdf78` = HEAD exactly.

### A6 · Server-side weather readiness — **COMPLETE, and MISSING OBJECTIVE**
`/api/health/data` → 503 on `critical` → `data-health-monitor.yml` every 30 min → caught a real
production outage within one cycle.
❌ **Objective: NONE. Task: NONE.** `health/data`, `data-health-monitor`, `compute_data_health` =
**0** in both registers (control: `uptime_probe` = 1). *The chain works and the program cannot see
it.*

---

## B. CHAINS BROKEN AT OBJECTIVE / TASK — the surface runs, nothing names it

### B1 · The optical render harness — **MISSING OBJECTIVE, MISSING OWNER, and RED**

| link | state |
|---|---|
| Runtime surface | `marine-nightly.yml` `zoomlab-battery`, nightly since 2026-07-18 |
| Contract | budget: ≤2 render findings, 0 `DEAD_BAND_PERSISTENT`, 0 `SETTLED_STEP` — **explicit and good** |
| **Objective** | ❌ **NONE** — 0 occurrences, both registers, every 12.1 artifact |
| **Task** | ❌ **NONE** |
| Implementation | `zoomlab.js` (26,730 B), `zoomlab-verdict.js`, both git-tracked |
| Test | n/a — it *is* a test |
| Runtime evidence | ✅ **abundant** — `.webm` + 59.5 MB artifact, 14-day retention |
| **Owner** | ❌ **NONE** |
| **Observability** | ⛔ **the output reaches nobody** — 18 of 37 runs failed; the workflow's own comment concedes *"a red nobody read"* |
| Recovery | n/a |

**⛔ RED AT HEAD:** `22 render findings, 0 instrument findings, 387 anim frames`. `0 instrument
findings` = the renderer *was* graded.

### B2 · The second renderer — **MISSING OBJECTIVE, MISSING TASK, MISSING TEST, MISSING RECOVERY**

| link | state |
|---|---|
| Runtime surface | `MarineParticleCanvas` (in `GPUMarineLayer.js`), `WindParticleOverlay.js` |
| **Contract** | ❌ **NONE** — nothing states these must agree with the WebGL stack on colour scale, units or land mask |
| **Objective / Task** | ❌ **NONE** — 0 in both registers, every 12.1 artifact |
| Implementation | active, 4 triggers |
| **Test** | ❌ **ZERO** test files reference either (control: `WebGLMarineEngine` → 30) |
| Runtime evidence | the guardrail fired **5×** during this audit's probe |
| **Observability** | `webgl_marine_fallback_engaged` is emitted and **nothing aggregates it**; the user is never told |
| **Recovery** | ❌ the `localStorage` trigger is **persistent with no reset path** |

### B3 · The runtime override surface — **MISSING OBJECTIVE, MISSING TEST, MISSING OBSERVABILITY**

261 globals / 143 files · 197 with **no test** · **5** visible to the program (1.9%) · 2 change a
**displayed forecast quantity** · **no** telemetry of which are set.
Contract exists only as prose in handoff runbooks (223 of 261 documented — documentation is *good*;
the register is where they are absent).

### B4 · The flag-lane parity class — **MISSING OBJECTIVE**

Guard exists (`test_flag_lane_parity.py`) for a defect that ran **eleven days**. `RATING_TIDE` = 0 in
all three registers (control: `SURF_TIDE_DEPTH` = 1). By the test's own admission at `:53`, the lane
where the defect lives **cannot be checked from git**.

### B5 · Third-party analytics — **MISSING CONTRACT, MISSING OBJECTIVE**

PostHog, injected at `frontend/public/index.html:149,172-173`, observed live. In **no** dependency
register. Missed by six audits because every dependency census ran over `frontend/src` and
`package.json`.

### B6 · The two binding UI mandates — **MISSING OBJECTIVE**

THREE THEMES (2026-07-12) and ACCESSIBILITY (2026-07-14) are binding in `CLAUDE.md` with a documented
debt inventory. Neither is named by any of 40 objectives, 65 tasks, or any SOTA row.

---

## C. CHAINS BROKEN AT OBSERVABILITY — correct output, no reader

**The new failure mode.** These are green through Runtime Evidence and fail at "who reads it".

| Chain | Produces | Read by |
|---|---|---|
| C1 · `report_calibration.py` — the **only** instrument grading the served nearshore height + quality | `star_mae`, `height_mae_m` from surfer logs, and a 60,000-entry prediction archive **at its hard cap** | **one read-only diagnostic route.** No threshold, no gate, no page. The gate that *can* page (`forecast_accuracy_monitor.py`) never references it — absence confirmed with positive controls. **Live: `n_reports: 0`, all MAEs `null`, `"available": true`** |
| C2 · `useWebGLGuardrail` | `__MAP_RENDER_FPS__` every second; `FPS_drop_detected`; `webgl_marine_fallback_engaged` | nothing aggregates any of it |
| C3 · `WS-CAN-0027`'s video key | a `.webm` of a **weather** test failing in WebKit, retained ⏰ **expires 2026-08-27** | **unread** — it worked on the first qualifying failure |
| C4 · `marine-nightly` | see B1 | **unread** |

⚠️ **C1 additionally cannot refuse.** Three silent-zero paths — missing Supabase credentials
(`fetch_recent_reports_via_rest():234`, `return []` **with no log at all**), an HTTP failure, and a
genuine drought — render **identically** as `n_reports: 0` + `"available": true`. Nobody can
currently tell whether the observation feed is broken or the ocean is quiet. The sibling instrument
implements an explicit `REFUSED` state for exactly this.

---

## D. CHAINS BROKEN AT TEST — the guard exists and grades the wrong file

### D1 · The surf alert — **CONFLICTING CHAIN.** ★ the audit's only Critical reaching a user today

| link | `routes/surf_data/alerts.py` | `scheduler/surf_alerts.py` |
|---|---|---|
| Contract | ✅ mandate quoted verbatim in-file | ❌ none |
| Objective | WS-OBJ-201 | WS-OBJ-201 **(never enumerated as a consumer)** |
| Implementation | ✅ quality-aware, 8 refs | ❌ **0 refs** |
| **Test** | ✅ `test_surf_alert_states_the_quality.py` | ❌ **the guard opens one hard-coded path — this file is not it** |
| Runtime evidence | manual POST only | ✅ **live: `interval[0:15:00]`, confirmed in `/api/health`** |
| Recovery | — | revert one composition |

**The repaired path is the one nobody calls. The path that fires every 15 minutes sends
`"Waves are {h}ft - perfect conditions!"` with `rating`/`rating_level` unread in the same dict.**
The guard is green. The census is the defect.

### D2 · The executed-GL pixel oracle — **MISSING TEST (structurally)**

`weather-simulation.spec.js:607` is still `test.fixme` at HEAD. WS-CAN-0018/0019, unchanged. It
**cannot fail**.

### D3 · The E2E lane's `flaky` class — **MISSING RUNTIME EVIDENCE → now available**

WS-OBJ-705 is CERTIFIED on a passed/skipped/failed triple that **cannot express `flaky`**. 17 flaky
across 6 runs, **100% WebKit**, 5 of them weather tests. The video that would diagnose it exists and
is unread.

---

## E. UNABLE TO DETERMINE

| Chain | Blocked by |
|---|---|
| Live Render configuration (env vars, `healthCheckPath`, `autoDeploy`, `buildFilter`) | `render.yaml` is **not applied**; config exists only in the dashboard. `WS-CAN-0040`, owner |
| Whether the two renderers agree scientifically | no test exercises the Canvas2D path at all |
| Production frontend behaviour at HEAD | 85-day freeze, `WS-CAN-0039`, owner |
| Concurrent-user capacity | never measured; an agent's "nothing bounds concurrency" claim was **PROOF_FAILED**, so it is open in *both* directions |

---

## Tally

| Classification | Count |
|---|---|
| **Complete** | 5 (A1–A5) |
| **Complete, but MISSING OBJECTIVE** | 1 (A6) |
| **Missing Objective and/or Task** | **6** (B1–B6) |
| **Missing Test** | 5 (B2, D1, D2, and 2 within B3) |
| **Missing Observability — a reader, not an instrument** | **4** (C1–C4) |
| **Missing Recovery** | 2 (B2's persistent trigger; no rollback runbook) |
| **Conflicting Chain** | 1 (D1) |
| **Unable to Determine** | 4 (E) |

## The one sentence this graph produces

> **The program's engineering is ahead of its bookkeeping, and its bookkeeping has no column for
> "who reads this."** Six audits built instruments. None of the 105 objective-and-task rows asks
> whether an instrument's output ever reaches a human — which is why a `.webm` of a failing weather
> test, a 60,000-entry nearshore prediction archive with zero observations, and a nightly optical net
> that is red half the time can all coexist with a green board.
