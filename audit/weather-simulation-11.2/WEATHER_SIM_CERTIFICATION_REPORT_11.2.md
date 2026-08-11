# RAW SURF WEATHER SIMULATION — INDEPENDENT CERTIFICATION & ADVERSARIAL VALIDATION AUDIT 11.2

| | |
|---|---|
| **Report** | Independent Certification & Adversarial Validation Audit |
| **Version** | 11.2 (certification; distinct from the *Forward-Progress* 11.2 at `6d5d6c48`) |
| **Audit window** | 2026-08-10 23:00 → 2026-08-11 00:05 (-04:00) |
| **Branch / commit** | `dev` / `e015d90b06bc45189a1c7407854762a1b8c79a63` |
| **Report 11.1 baseline** | `79abe4ed` (2026-08-10 20:06) |
| **Commits since baseline** | **10** (2 code, 8 docs/audit) |
| **Frontend under test** | `http://localhost:3007/map` — CRA dev build at HEAD |
| **Backend under test** | `http://127.0.0.1:8000` — health `2.0.0-stage-6f-v1-e015d90b` (**same commit**), `environment: local` |
| **Production reference** | `https://raw-surf-antigravity.onrender.com` — **one read-only GET**, no load testing |
| **Browser** | Chromium (in-app pane), viewport 961x910 CSS px |
| **Machine** | i7-11800H, 63.7 GB, RTX 3060 Laptop + Intel UHD, Node v24.14.1, Python 3.14.4 |
| **Blind findings** | `BLIND_RUNTIME_AND_ARCHITECTURE_FINDINGS.md`, SHA-256 `69DCAF8D…073715`, locked 23:24:57 |
| **Production code modified** | **NONE** (see §0.3 for a tracked-file disclosure) |

---

> ## ⚠️ ADDENDUM — 2026-08-11, after the production falsification arm
>
> §17 named one test as most likely to overturn this verdict: reproduce the failure injection
> against the **production** backend. **It was run. It confirmed the verdict rather than
> overturning it.** On production, with all `/api/weather/*` rejected, the HUD read
> `GFS / swell_1 · LOADED · Provider NOAA · Class AUTHORITATIVE NATIVE · TRUTH VIOLATIONS: none`
> while `productId` was `null`; 15 s of restored network produced byte-identical output.
> **RC-01, RC-02, RC-04 and RC-05 all reproduce on production.**
>
> Three additions, all documented in `PRODUCTION_FALSIFICATION_AND_FORENSICS.md`:
> 1. **RC-02 has a second, structural cause:** `forecastDiagnostics.js:241-242` reads
>    `renderedVectorCount` / `renderedNonzeroCount`, which **no code writes**
>    (4 occurrences repo-wide, all reads; zero write sites at HEAD). The producer was renamed to
>    `webglSourceVectorCount` / `renderedParticleCount` around `dcfce3c1` (2026-06-03) and the
>    consumer was never updated. **The parity guard has been blind for ~10 weeks**, and the
>    predicate at `:73-74` can never be true. Reports 11.0 and 11.1 both read its PASS as
>    meaningful.
> 2. **RC-03 is not novel — and that is worse.** Report 11.0's `SOFTWARE_JACOBIAN_MATRIX.csv`
>    already recorded non-monotonic `z8/z9/z10` tier selection as "the strongest single lead". It
>    is **still present at HEAD**, having survived the entire 11.1 window unrepaired. See §6 of the
>    forensics addendum for the correction to my reconciliation.
> 3. **New production findings:** one layer activation issues **15** weather requests across 4
>    layers including a whole-planet `grid_series` (PF-01); `selectedTileId` disagrees with
>    `productId` (PF-02); `cols x rows` disagrees with `vectorCount` in steady state (PF-03).
>
> Jacobian: `SOFTWARE_JACOBIAN_11.2_TRUTH_LAYER.csv`. Forward plan: `STATE_OF_THE_ART_PATH.md`.
> **The verdict below is unchanged and its evidentiary basis is now production-grade.**

---

# SECTION 1 — CERTIFICATION VERDICT

# ⛔ **NOT CERTIFIED**

**Scope of the verdict, stated precisely:** this is a **truth-layer and determinism** verdict, not
an architecture verdict. The rendering engine, transition-ownership model and GPU resource
lifecycle are, on measurement, **good** — several are the best-engineered parts of the system.
What fails is the layer that tells the user, and the system itself, *what the number on screen
actually is*.

Three §26 automatic-certification failures were **confirmed by execution**, not inferred:

1. **Stale output is presented as current, and labelled authoritative, under ordinary network
   failure.** With every `/api/weather/*` request rejected, activating a new layer left the HUD
   reporting `Raster Source: LOADED`, `Provider: NOAA`, `Class: AUTHORITATIVE NATIVE` for
   `swell_1` — while `productId` was `null` and no swell data had ever arrived. A value was
   displayed. No error surfaced.
2. **The system did not recover.** After restoring the network and waiting 9 s, no retry fired;
   the mislabelled field persisted unchanged.
3. **A layer round-trip changes the forecast value.** Toggling Waves off→on, with no other
   change, moved the value at a fixed coordinate `0.64 m / 6.8 s → 0.44 m / 3.1 s → 0.64 m /
   6.8 s`. Same model, same layer, same valid time, same coordinate.

**Is the project moving in the right direction?** Yes. The instrumentation investment is real and
it is what made this audit possible. **Is the feature ready to advance?** No.

## 1.1 Five strongest verified capabilities

1. **GPU resource lifecycle is bounded and idempotent.** Across three Waves off→on cycles:
   `progNet` constant at **13** (shaders allocated once), `bufNet` returning to **222** on every
   OFF, `texNet` oscillating 32/32/37/29/37, canvases exactly 4↔2. ON#2 and ON#3 are
   **identical**. No accumulation.
2. **Cleanup genuinely releases.** A Waves→Wind switch drove instrumented GL counters
   **negative** (net −26 textures, −131 buffers), i.e. it released objects allocated before
   instrumentation existed.
3. **Generation-based transition ownership is correctly designed.**
   `marineTransitionCoordinator.js` implements a monotonic `transitionId`, idempotent
   `beginTransition`, "only the current generation may end the transition", and `markDisplayed`.
   Stale completions are structural no-ops.
4. **Animation ownership is stable.** `rafLive` stayed in a 3–7 band across every zoom, model,
   layer, unit and failure transition. No RAF multiplication.
5. **Unit display is genuinely display-only.** ft→m→ft left height, period, direction, product id
   and vector count **bit-identical**. Metamorphic unit invariance passes cleanly.

## 1.2 Five most important unresolved risks

1. **`Class: AUTHORITATIVE NATIVE` is a one-bit function of `isEstimated`**
   (`TruthOverlay.js:418`). It cannot express resolution, cross-model substitution, staleness, or
   absence of data — and was observed green in all three of those conditions.
2. **The parity gate passes vacuously.** `__MARINE_SOURCE_PARITY__.match === true` was returned
   with `heatmap.vectorCount: 0` compared against an `idle`, never-sampled infobox — while
   `__WebGLMarineLayer_DIAG__.infoboxHeatmapParity` said `false` and the real grid had 629
   vectors. The HUD's "No Causal Layer Violations Detected" rests on this gate.
3. **Product selection is non-deterministic across identical user actions**, and product choice
   changes the served value.
4. **No recovery path after transient request failure.**
5. **The client discards `resolution`** (`__MARINE_PROJECTION_DIAG__.resolution === null` while
   the backend sends `0.5`), so no guard, legend or user can react to grid coarseness.

## 1.3 Three blind-pass discoveries

1. **Failure-mode mislabelling (BF-04 + injection).** Neither prior report tested a hard network
   failure against the truth overlay. It reports authoritative, loaded, NOAA-provenanced data for
   a layer that never loaded.
2. **Vacuous parity (BF-06).** Two empty sides compare equal and report PASS.
3. **Layer-round-trip value instability (BF-01/BF-02, confirmed in the lifecycle battery).**

## 1.4 Three places earlier work — including my own — was wrong or incomplete

1. **My own BF-03 was REFUTED.** I found GFS/ICON served *only* 10° global tiles and called it a
   coverage gap. Against **production** that is false: 19,995 products, a three-tier ladder
   (10° / 2° / **0.25°** across 16 regional tiles). My local backend was a partial ingest.
   **A local backend is not a valid proxy for production data coverage.**
2. **My BF-04 provenance claim was downgraded mid-audit.** "NOAA" is not fabricated —
   `source_dataset` is literally `ncep_gfswave025`. The genuinely wrong field was the *local*
   `upstream_provider: "open-meteo"`; production correctly reports `noaa` / `dwd` / `ecmwf`.
3. **Report 11.1's "103 commits moved not one served forecast number"** is a statement about the
   *physics chain* and is consistent with my results — but it does not cover **which product the
   client selects**, which I measured moving the displayed value by up to 2.2× in period with no
   physics change at all. The bit-identical A/B could not have detected this.

## 1.5 The single next action I would authorize

**Make the truth overlay incapable of reporting green when it has nothing to report** — see
`AUTHORIZED_NEXT_PHASE_PACKET.md`. Concretely: make `Class` a function of
`(isEstimated, productId != null, resolution, model-substitution)`, and make the parity gate
**refuse** rather than pass when either side is unsampled.

---

# SECTION 2 — BLIND AUDIT RESULTS

Full text and lock record: `BLIND_RUNTIME_AND_ARCHITECTURE_FINDINGS.md`
(SHA-256 `69DCAF8DBF82058AA0A1722AE3F2A73D6F5D61A20B362C70ACE9FB8CE8073715`,
locked 2026-08-10T23:24:57-04:00 at commit `e015d90b`, **before** any prior report was opened).

**Blindness was partial and is disclosed**: `CLAUDE.md` and the memory router `MEMORY.md` were
auto-loaded into context by the harness before the first instruction. Every finding was
nonetheless re-derived from a measurement or source line taken this session.

Blind findings BF-01 … BF-12 are carried into §16 with their post-reconciliation status.

---

# SECTION 3 — RECONCILIATION WITH REPORTS 11.0 AND 11.1

See `BLIND_FINDINGS_RECONCILIATION.md`. Summary of material points:

| Prior claim | Independent status |
|---|---|
| 11.1: "103 commits moved not one served forecast number" | **Confirmed but incomplete.** True of the physics chain; silent on client product selection, which I measured changing the displayed value. |
| 11.1: architecture convergence "Flat" | **Confirmed.** 10 commits since baseline; 2 code, neither touching composition authority. |
| 11.1: capacity is the weak axis | **Confirmed in shape, not measured here.** Capacity testing was deliberately not run against production (§4 prohibits production load tests). |
| 11.1: could not drive the deployed frontend (`/map` → `/auth`) | **Independently reproduced.** I hit the same gate and solved it with a synthetic local-only session, never real credentials. |
| 11.1 tested against the **production** backend | **Material divergence.** I tested against a **local** backend and this changed one of my findings. Any future audit must state which backend it measured. |

---

# SECTION 4 — CURRENT SYSTEM CONTRACT

| Contract | State | Evidence |
|---|---|---|
| Data | **Explicit and strong at the backend** — `provider`, `upstream_provider`, `source_dataset`, `upstream_model`, `is_estimated`, `estimate_basis`, `coverage_mode`, `cache_hit`, `partial_coverage`, `stale`, `staleReason`, `fallbackReason`, `frame_substituted`, plus a `truthTag` with `dataHash`/`boundsHash`. | `/api/weather/grid` schema |
| Data (client) | **VIOLATED** — `resolution` dropped to `null`; `truthTag` not surfaced. | `__MARINE_PROJECTION_DIAG__` |
| Time | **Explicit.** `valid_time`, `served_valid_time`, `frame_offset_hours`, `frame_substituted`; `__MARINE_RENDER_HOUR_PARITY__` reported `parity: true / parity_match` throughout. | runtime |
| Units | **Explicit and correct.** `value_unit: "m"`, `display_unit_hint: "ft"`; toggle is display-only. | differential |
| Model | **VIOLATED.** Three authorities disagreed simultaneously (UI `GFS`, coordinator `GFS`, projection diag `EURO`) while a GFS product was served under `provider: gfs_estimated_fallback`. | runtime |
| Projection | **Not audited** — see §11 gaps. |
| Animation | **Explicit and honoured.** Single coordinator, bounded RAF. | census |
| Render | **Explicit.** MapLibre custom layer + separate particle canvas; no duplicate ownership found. | source + census |
| Cache | **IMPLICIT and unsafe.** Product identity is chosen by interaction history with no disclosure. | metamorphic |
| Worker | **Absent by design** — `workersMade: 0`; all normalisation on the main thread. | census |
| Resource lifecycle | **Explicit and honoured.** | lifecycle battery |
| Failure recovery | **MISSING.** No user-visible error, no retry, no recovery. | injection |

---

# SECTION 5 — STATE-MACHINE FINDINGS

A formal `STATE_MACHINE_MODEL.md` / `STATE_TRANSITION_MATRIX.csv` was **not produced** (§11).
What was established by execution:

- **False-ready state confirmed.** `Raster Source: LOADED` with `productId: null`.
- **Ambiguous model ownership confirmed.** Three authorities, three answers, one instant.
- **Unrecoverable state confirmed.** Post-failure the machine has no edge back to a good state
  without user action; 9 s of restored network produced no retry.
- **Idempotent layer transitions confirmed good.** ON#2 ≡ ON#3 exactly.
- **Stale-completion protection confirmed by design** (generation ownership) — but note it
  protects *labelling of a frame*, not *which product was selected*.

---

# SECTION 6 — METAMORPHIC TEST RESULTS

Matrix: `METAMORPHIC_TEST_MATRIX.csv`.

| Relation | Result |
|---|---|
| Unit display invariance (ft⇄m) | **PASS** — bit-identical |
| Temporal hour parity | **PASS** — `parity_match` throughout |
| View invariance, zoom 9→6→11→9, sampled value | **PASS** — 0.44 at all four steps |
| View invariance, **product identity** | **FAIL** — zoom 11 selected the *coarser* global product |
| **Layer round-trip (Waves off→on)** | **FAIL** — 0.64/6.8 → 0.44/3.1 → 0.64/6.8 |
| Model round-trip (GFS→EURO→GFS) | **FAIL** — EURO never rendered; ended on `gfs_estimated_fallback` with the model diag reading `EURO` |
| Mount/route round-trip | **BLOCKED** — dev-mock session is cleared by a 401 on route change |
| Cross-browser | **NOT RUN** — Chromium only |

---

# SECTION 7 — DIFFERENTIAL TEST RESULTS

Matrix: `DIFFERENTIAL_TEST_MATRIX.csv`.

**Headline — provider vs application, same coordinate (26.000, −78.000), same
`model=GFS&layer=waves&valid_time=2026-08-11T03:00:00Z`:**

| product | resolution | grid | nearest sample | distance | period |
|---|---|---|---|---|---|
| `gfs_marine_waves_global_coarse` | *absent from response* | 37×17 = 629 | (30, −80) | **4.472° ≈ 497 km** | **6.8 s** |
| `viewport_gfs_marine_waves_…−80,24,−76,28` | 0.5 | 9×9 = 81 | (26, −78) | **0.000°** | **2.85 s** |

**Local vs production** (the correction that reshaped this audit):

| | local | production |
|---|---|---|
| products | 1,294 | **19,995** |
| GFS marine tiers | `global_coarse` only (10°) | 10° / **2°** / **0.25°** × 16 regions |
| `upstream_provider` | `open-meteo` (wrong) | `noaa` / `dwd` / `ecmwf` (correct) |

**New production-only finding:** `EURO / marine / waves` for **`florida_east_coast`** and
**`us_west_coast_socal`** is served with `provider = estimated` and an **empty**
`upstream_provider`, while all 14 other EURO regions carry real `ecmwf` data at 0.25°. Two of the
most-used US surf regions are served *estimated* EURO wave data. This was not reachable locally
and is flagged for confirmation, not certified as a defect.

---

# SECTION 8 — ANIMATION AND PROJECTION CERTIFICATION

- **Animation owners:** one shared `CanvasAnimationCoordinator`; `WebGLMarineEngine` and
  `WebGLWindEngine` contain **no** `requestAnimationFrame` — they are driven by the map/coordinator.
- **RAF owners:** 3–7 live handles, stable across all transitions. No duplication.
- **Map attachment:** correct through pan/zoom/product swaps.
- **Frame-rate independence:** **NOT VERIFIED.**
- **Projection:** **NOT AUDITED.** No antimeridian, high-latitude, OceanMask, DPR, bearing or
  pitch testing was performed. Gate 2 is therefore **BLOCKED**, not passed.

Observed performance note: `__MAP_RENDER_FPS__` fell to **5** with 87,616 particles active over
a 629-point field. Recorded as an observation; no capacity claim is made.

---

# SECTION 9 — SCIENTIFIC CONFORMANCE

**Traceable and correct:** units (`m` internal, `ft` display), direction convention, valid time,
hour parity, model/dataset identity at the backend, `is_estimated` plumbing, content hashing.

**Not conformant:**
- The client cannot express *how coarse* the field it is drawing is (`resolution` → `null`).
- `AUTHORITATIVE NATIVE` is asserted for a 10° resample of a 0.25°-native dataset
  (`source_dataset: ncep_gfswave025`). **"NATIVE" is factually false** for that product.
- The same badge was observed during a cross-model `gfs_estimated_fallback` and during a
  total data-load failure.

**Observational validation (buoy/NDBC/station) was NOT performed** in this audit. Its absence is
recorded as a limitation, not as a pass.

---

# SECTION 10 — FAILURE AND RECOVERY

Matrix: `FAILURE_RECOVERY_MATRIX.csv`. One scenario executed, and it is decisive.

**F-01 — total weather-endpoint rejection, then a new layer request.**
Injection: `window.fetch` rejects every `/api/weather/*` with a `TypeError`. Action: click `Swell`.

| Question | Answer |
|---|---|
| Detected? | **No user-visible detection** |
| User informed? | **No** |
| Stale output retained? | **Yes** |
| Stale output presented as current? | **YES** — `Model/Layer: GFS / swell_1`, `Raster Source: LOADED`, `Class: AUTHORITATIVE NATIVE`, `Provider: NOAA` with `productId: null` |
| Retry bounded? | No retry at all |
| Late response overwrite? | Not reachable |
| Resources cleaned? | **Yes** — `texNet` 37, `bufNet` 260, `progNet` 13, unchanged from the healthy state |
| Could the user recover? | **No** — 9 s after the network was restored, state was byte-identical |
| Console revealed cause? | **No weather errors logged** |

**Certification consequence:** Gate 3, Gate 5 and Gate 7 fail on this scenario alone.

---

# SECTION 11 — CAPACITY CERTIFICATION

**NOT CERTIFIED — NOT MEASURED.** No cold/warm startup profile, no soak, no throttling, no DPR
or mobile-viewport runs, no heap snapshots, no performance traces were produced. Capacity
statements from Report 11.1 are neither confirmed nor contradicted here.

Two recorded observations, explicitly **not** a capacity envelope:
- Cold start click→first rendered field ≈ **27 s** on a cold local backend, with ≈ **4 s** of dead
  time before the first request and a 12 s `/api/weather/products` call returning 1,294 records.
- Heap oscillated 74–258 MB, GC-dominated. **I make no leak claim**; layer-cycle counters were
  bounded, which is evidence against a leak in that subsystem.

---

# SECTION 12 — ARCHITECTURE CONFORMANCE

| Responsibility | Authority | Status |
|---|---|---|
| Model/layer transition | `marineTransitionCoordinator` | **Explicitly Coordinated** — with a declared, documented mirror to legacy `window.__MARINE_TRANSITIONING__` ⇒ **Transitional Dual Path**, not accidental duplication |
| Animation | `CanvasAnimationCoordinator` | **Single Authority** |
| GPU resources | `WebGLMarineEngine` / custom layer | **Single Authority** |
| Render | MapLibre custom layer + particle canvas | **Explicitly Coordinated** |
| **Model identity** | UI ⟷ coordinator ⟷ projection diag | **ACCIDENTAL DUPLICATE AUTHORITY** — three simultaneous, disagreeing answers |
| **Provenance / truth** | `TruthOverlay` + `__MARINE_SOURCE_PARITY__` | **Authority Unknown** — the reporter cannot detect its own blindness |
| Product selection | distributed across fetcher/orchestrator/governor | **Authority Unknown** — non-deterministic in test |

Per §23, a Critical subsystem with accidental duplicate authority **cannot be certified to
advance**. Model identity is such a subsystem.

---

# SECTION 13 — RECENT COMMIT CERTIFICATION

Ledger: `RECENT_COMMIT_CERTIFICATION_LEDGER.csv`. 10 commits since `79abe4ed`; **2 touch code**:

- `679da3d9` `feat(height): flip the nearshore renorm ON` — **Unvalidated by this audit.** A
  default-changing flag flip. My tests exercised the *map band*, not the spot-height chain, so I
  neither confirm nor contradict it.
- `712e3bac` `fix(memory): skip the manifest re-parse when the bytes are unchanged` —
  **Unvalidated by this audit** (no memory profiling performed).

The remaining 8 are docs/audit artifacts: **Neutral**. No commit in this window is implicated in
any finding above; every confirmed defect predates the baseline.

---

# SECTION 14 — RELEASE-GATE MATRIX

Full matrix with evidence: `RELEASE_GATE_MATRIX.csv`.

| Gate | Result | Basis |
|---|---|---|
| 1 — Data Truth | **FAIL** | `AUTHORITATIVE NATIVE` on a 10° resample, on a cross-model fallback, and on a null product; `resolution` dropped |
| 2 — Projection Truth | **BLOCKED** | not tested (no antimeridian / high-latitude / DPR / bearing / OceanMask) |
| 3 — State & Concurrency | **FAIL** | layer and model round-trips unstable; three-way model disagreement; no recovery |
| 4 — Animation & Lifecycle | **PASS** | single owner, bounded RAF, idempotent remount, releasing cleanup |
| 5 — Scientific Conformance | **FAIL** | viewport/selection state changes the served value; no observational validation |
| 6 — Capacity | **BLOCKED** | not measured |
| 7 — Regression Protection | **FAIL** | the parity gate that guards this area passes vacuously |
| 8 — Modernization Readiness | **FAIL** | predecessor gates 1/3/5/7 fail |

---

# SECTION 15 — STATE-OF-THE-ART UPGRADE AUTHORIZATION

Every modernization candidate (WebGPU, OffscreenCanvas/worker rendering, Zarr/Kerchunk pipeline,
nearshore models, neural emulators, learned downscaling) is **DEFERRED**. None addresses a
measured bottleneck, and Gate 8 forbids advancing while Gates 1/3/5/7 fail. Adding a second
rendering or data path now would add a third competing authority to a subsystem that already has
three. See `DO_NOT_ADVANCE_ITEMS.md`.

---

# SECTION 16 — CONFIRMED ROOT CAUSES

**RC-01 — Provenance class is a one-bit function of `isEstimated`.**
Classification **Confirmed** · Severity **Critical** · Blind **Yes**
Source: `frontend/src/components/map/TruthOverlay.js:418`
`{isEstimated ? 'ESTIMATED FALLBACK' : 'AUTHORITATIVE NATIVE'}`
Observed green during: a 10° resample of a 0.25° dataset; a `gfs_estimated_fallback`; and a total
load failure with `productId: null`.
Falsification attempted: is "NOAA" fabricated? **No** — `source_dataset` is `ncep_gfswave025`.
That refutation narrowed the defect to the *Class* row specifically.
Guardrail required: `Class` must be a function of `(isEstimated, productId != null, resolution,
model substitution)` and must have a "cannot determine" state.

**RC-02 — The parity gate cannot distinguish agreement from absence.**
Classification **Confirmed** · Severity **Critical** · Blind **Yes**
`heatmap.vectorCount: 0` vs `infobox.status: "idle"` ⇒ `match: true, mismatchReasons: null`,
while a sibling instrument said `infoboxHeatmapParity: false` and the live grid had 629 vectors.
Guardrail required: **refuse** (third state) when either side is unsampled.

**RC-03 — Product selection is non-deterministic and changes the served value.**
Classification **Confirmed** · Severity **Critical** · Blind **Yes**
Layer off→on ×3 at a fixed coordinate: 0.64/6.8 → 0.44/3.1 → 0.64/6.8.
Alternative explanation considered: nearest-neighbour sampling of legitimately different grids —
**accepted as the mechanism**, which is precisely why selection must be deterministic and
disclosed.

**RC-04 — No detection, no disclosure and no recovery on request failure.**
Classification **Confirmed** · Severity **Critical** · Blind **Yes** (injection)

**RC-05 — The client discards `resolution`.**
Classification **Confirmed** · Severity **Medium** · Blind **Yes**
Backend sends `0.5`; `__MARINE_PROJECTION_DIAG__.resolution === null`. Enables RC-01 and RC-03 to
be invisible.

**RC-06 (production, unconfirmed) — EURO Florida/SoCal waves are `provider: estimated` with an
empty `upstream_provider`.** Classification **Probable** · Severity **High** · needs owner
confirmation.

---

# SECTION 17 — AUTHORIZED NEXT PHASE

## ✅ **Continue current stabilization** — nothing else is authorized.

Full packet: `AUTHORIZED_NEXT_PHASE_PACKET.md`. Mission: **make the truth layer incapable of
reporting confidence it has not earned** (RC-01, RC-02, RC-05), then make product selection
deterministic and disclosed (RC-03), then add failure disclosure and bounded retry (RC-04).

Explicitly **not** authorized: performance optimization, data-pipeline modernization, GPU/numerical
prototypes, nearshore models, AI-assisted forecasting, and removal of any legacy path.

**What would prove this authorization wrong:** if the injection result (RC-04) fails to reproduce
against the **production** backend with a valid session — i.e. if production surfaces an error and
retries where local did not — then RC-04 collapses and the gate set should be re-run before
holding the project here.

---

# SECTION 18 — FINAL INDEPENDENT VERDICT

**Is the direction correct?** Yes. The measurement investment is the right bet and it is what
produced every finding above.

**Is the feature ready to advance beyond stabilization?** **No.**

**What is genuinely dependable?** The GPU resource lifecycle, animation ownership, transition
generation-ownership, and the unit contract. These are well engineered and I could not break them.

**What is the greatest threat?** The system's self-report. A parity gate that passes when both
sides are empty, feeding a badge that is green unless one boolean is set, feeding a HUD that says
"No Causal Layer Violations Detected" — while the field on screen is the wrong layer, never
fetched, and unrecoverable. **The instrument that would catch the defect is the defect.**

**What did the blind pass find that prior audits missed?** That the truth overlay reports
authoritative, loaded, NOAA-provenanced data for a layer whose every request failed.

**What exact mission should begin?** `AUTHORIZED_NEXT_PHASE_PACKET.md`, Mission T-1.

---

## §0.3 — DISCLOSURE: tracked files modified by the test rig

Starting the local backend caused it to rewrite two **tracked** cache files:
`backend/uploads/forecast_cache/marine_global.json` and `.../wind_global.json`.
The working tree was verifiably **clean** at audit start, so these are 100% attributable to this
audit's backend process, not to the user. Originals preserved under
`evidence/forensics/` and the files restored to `HEAD`. **No production source code was
modified at any point.**
