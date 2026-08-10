# MASTER WEATHER SIMULATION REPORT 11.0
## Live Browser Examination, Historical Reconstruction, Capacity Analysis, Software Jacobian Testing, Root-Cause Forensics, and Recovery Roadmap

---

## TITLE PAGE

| Field | Value |
|---|---|
| **Report** | Master Weather Simulation Report **11.0** (`audit/weather-simulation-11.0/`) |
| **Audit start** | 2026-08-09 18:02:18 −04:00 |
| **Audit completion** | 2026-08-09, same session |
| **Repository** | `C:\Users\dprit\Raw-Surf` — `origin` = `github.com/dpritzker0905-cmd/Raw-Surf-Antigravity` |
| **Branch** | `dev` |
| **Commit at audit start** | `3d3ccdc26c120dfb79be2ee5c8e83c25fae1b187` — working tree **clean** |
| **Commit at audit end** | `9f4f85708e765741d51ac2812de5a36373ac514b` — ⚠️ see *Provenance caveat* below |
| **Working-tree status** | Clean throughout except **new untracked files under `audit/weather-simulation-11.0/` only** |
| **Application URL** | `http://localhost:3007/map` (CRA dev server via `craco start`, compiled clean) |
| **Environment** | **Local frontend → PRODUCTION backend** (`REACT_APP_BACKEND_URL=https://raw-surf-antigravity.onrender.com`) |
| **Browser** | In-app Chromium (Claude Browser pane), viewport 961×910 CSS, **DPR 2**, **vsync 30 Hz** |
| **Host** | Windows 11 Pro 26200 · i7-11800H 8C/16T · 63.75 GB RAM · RTX 3060 Laptop + Intel UHD · 3840×2160 |
| **Codex report** | `docs/research/AUDIT-OF-THE-AUDIT-2026-08-03-codex-weather-sim-review.md` (read in full) |
| **Prior master report** | `MASTER_WEATHER_SIMULATION_REPORT_11.0.md` (repo root, 130 KB) + `docs/research/MASTER-AUDIT-{1..11}.0-*.md` |
| **Historical baselines tested** | **None executed.** `b5bbaa7d` / `f5f6a3d` verified to *exist* and characterised; see §3 |
| **Browsers tested** | Chromium only |
| **Prior reports overwritten** | **None.** This report is written to a new path; the repo-root 11.0 is untouched |

> ### ⚠️ Provenance caveat — HEAD moved mid-audit
> The audit opened at `3d3ccdc2`. At 18:07:30 a **concurrent session** (same git identity,
> `dpritzker0905-cmd`) committed `9f4f8570` — *"docs(handoff): the tide A/B produced its first
> TRUSTWORTHY verdict"*. Verified: **fast-forward only, no history rewritten**
> (`git merge-base --is-ancestor 3d3ccdc2 HEAD` → true), and the delta is **one documentation file,
> +24/−4** (`docs/research/HANDOFF-2026-08-09-D-…md`). **No production source changed**, so every
> runtime measurement in this report remains valid. This is the known hazard that this project's own
> memory records: *concurrent sessions share this working tree.* It was not caused by this audit —
> this audit ran no mutating git command.

> ### Honesty statement
> This audit **did not** capture video, **did not** run cross-browser tests, **did not** exercise 11
> of 12 weather layers, and **did not** run a historical-baseline comparison. Those are marked
> BLOCKED in §6 and §18 with the exact action that would unblock each. Nothing in this report claims
> a test that was not run.

---

## SECTION 1 — EXECUTIVE VERDICT

### Overall status: **YELLOW**

**The current baseline is safe to build upon.** That is the most important sentence in this report,
and it is a *change of frame* from three months of "unstable development" narrative.

The evidence does not support the premise that the weather simulation is architecturally broken. What
the evidence supports is narrower and more actionable:

> **The engine is sound. The instrumentation lies. The product does not disclose when it is showing
> stale data — and a decade of accumulated diagnostic scaffolding has made the system extremely hard
> to observe correctly, including for this audit.**

Three of my own strongest early hypotheses — duplicate RAF loops, duplicate engine modules,
subscriber churn — were **each falsified by direct measurement**. A fourth, "two marine renderers draw
concurrently", was **falsified at runtime**. A fifth, "geographic dead zones and land bleed", was
**not reproducible at any tested location**. That pattern is itself the finding: *this codebase is
repeatedly diagnosed as broken by instruments that are themselves broken.*

### Is this a forecast visualizer, a derived-field engine, or a true simulation?

**It is a forecast visualiser with GPU particle advection — decisively, and by measurement.**

`SimulationLoop.simulationTick` gates **all** field evolution and **all** RK4 particle advection on
`window.__IN_SIMULATION_SANDBOX__ === true` (`SimulationLoop.js:219`). On `/map` that flag is
**`undefined`**. Therefore `evolveField()` (`:224`), `_windParticles.update()` (`:245`) and
`_marineParticles.update()` (`:250`) **never execute in the shipped path** — while the boot banner
prints *"RK4 particles + field evolution active"* and `evolutionTicks` climbs at 15 Hz from a counter
that sits **outside** the guard (`:226`). The FCE agrees: `__FCE_DIAGNOSTICS__ → {populated:false}`,
`__FCE_FIELD__ → null`.

The crests you see are `WebGLMarineEngine` / `WebGLWindEngine` advecting a **downloaded forecast field**
on the GPU. That is a legitimate and good architecture. It is simply **not** what the telemetry says.

### Direct answers

| Question | Answer |
|---|---|
| Is the baseline safe to build on? | **Yes** — with the disclosure defect (§11 F-01) fixed first |
| One authoritative path? | **Mostly.** One RAF loop ✅, one normalization contract ✅, but **three composition tiers** coexist and one dead renderer remains imported |
| Deterministic production behaviour? | **At the engine level yes** (1.00× real time, dt exactly 1/60). **At the data level no** — the served grid tier is non-monotonic in zoom |
| Should major modernization proceed now? | **No.** No measured limitation justifies WebGPU / JAX / Zarr / neural emulation |
| Must stabilization happen first? | **Yes — but it is small.** The top repair is a disclosure fix, not a rewrite |

### Subsystem ratings

| Subsystem | Rating | Basis |
|---|---|---|
| Data ingestion | **Strong** | 24-entry capability contract; provider vs upstream_provider distinguished |
| Model normalization | **Adequate** | one normalizer; provider leakage assessed by subagent B2 |
| Forecast-time correctness | **Critical** | ≥60 s silent 72-hour stale render under confident labels (F-01) |
| Field composition | **Lagging** | FCE reachable but authority Superseded; live choke is `decideMarineCommit` |
| Animation | **Leading** | single RAF, fixed timestep, exactly 1.00× real time — textbook |
| Projection | **Strong** | correct at Florida, Portugal, Morocco, New York; antimeridian **unverified** |
| Ocean masking | **Strong** | 4–12× land/ocean channel separation; no land bleed |
| React state | **Adequate** | React Scan shipped in dev bundle; commit counts not profiled |
| MapLibre integration | **Strong** | 2 custom layers, clean registration, `reregisterCount: 0` |
| WebGL lifecycle | **Leading** | 204/204 textures, 1092/1092 VAOs, **0** program churn across 6 cycles |
| Performance | **Lagging** | 11–31 fps; world-sized grid requests 3.7–6.3 s |
| System capacity | **Unable to verify** | backend deliberately not load-tested; GPU binding unknown |
| Reliability | **Lagging** | the stale-render window self-heals but is silent |
| Testing | **Lagging** | Playwright config exists, unused this session; 11/12 layers untested |
| **Observability** | **Critical** | the primary published diagnostic is a **stale snapshot that lies in both directions** |
| Forecast validation | **Unable to verify** | delegated to subagent E1; not independently re-run |
| Nearshore physics | **Adequate** | rich backend chain; maturity assessed by E1 |
| Upgrade-program maturity | **Lagging** | three composition tiers, one dead renderer, 81 days of coexistence |

### Five strongest confirmed assets

1. **The fixed-timestep render orchestrator** (`render-orchestrator.js`) — one RAF chain at exactly
   vsync, `dt` exactly 1/60, simulation clock at **1.00× real time** while the display runs 30 Hz.
   Three duplication hypotheses were raised against it and **all three were refuted**.
2. **GPU resource lifecycle** — 6 layer-toggle cycles: textures 204/204, buffers 3114/3124, VAOs
   1092/1092, **shader programs 0/0** (compiled once at boot, reused). No leak.
3. **Stale-request cancellation** — switching models 300 ms apart aborted both in-flight requests
   (`ABORT:AbortError`) and the last click won. The classic race is *already solved*.
4. **The capability contract** (`__WEATHER_CAPABILITIES__`) — 24 model×layer entries separating
   `provider` from `upstream_provider`, `native_horizon_hours` from `estimated_horizon_hours`, with
   an `unsupported_reason` per gap. It even records its own past error in prose.
5. **Zero-network timeline scrubbing** — 14 rapid scrub clicks issued **0** requests, with exact
   click arithmetic and hour parity.

> ### ⚠️ Severity corrections applied by the adversarial pass
> An independent red-team agent was spawned per Critical/High finding, instructed to **refute** it and
> to default to `survives=false` when it could not independently reproduce the evidence.
> **30 findings were attacked; 24 survived, 6 were CONTRADICTED**, and **several severities were
> corrected downward**. Most importantly, **E1-01 was corrected Critical → High.**
> **After the adversarial pass, this audit has NO Critical findings.** Full ledger in §13b.

### Five highest-risk confirmed problems *(post-red-team severities)*

1. **E1-01 — the map rating band bypasses the ONE FORECAST COMPOSITION chain entirely.** Measured at
   the *same coordinate*: band height up to **3.04×** the point height, rating up to **56.9 points**
   apart, signed both ways. A direct violation of the project's single binding rule — and
   **E1-02**: the parity guard meant to catch this **structurally cannot see the band**.
   *(Red team: **survives, CONFIRMED, severity corrected Critical → High.** E1-02 corrected High → Medium.)*
2. **F-01 — the map renders a stale hour/model under confident labels, silently** (≥60 s measured).
3. **E1-03 — H1/10 is applied *after* the γ·d cap**, so the served height exceeds its own
   depth-limited ceiling by **+25.0 %** and is **non-monotonic** in offshore Hs
   (10.00 m → 36.86 ft, but 10.25 m → 29.50 ft).
4. **F-02 — `window.__SIM_DIAGNOSTICS__` is a static snapshot that reports a healthy engine as frozen**
   (23.6 s stale when measured). It misled this audit through four probes.
5. **F-04 — the served grid tier is non-monotonic in zoom** (z8 = 25 cells, z9 = 306, z10 = 25) and the
   rendered value at a **fixed coordinate drifts with zoom** — the runtime twin of E1-01.

*(F-03, the inert physics kernel, and F-05, world-sized grid requests, rank next.)*

### Three most important root causes

1. **One label covering two different quantities.** The band vs the point (E1-01); requested vs
   rendered hour (F-01); three period statistics under one `wave_period` field (E1-04); the Codex
   review's own §2 (`quality_rating` meaning two things across sibling tools). **This single class
   explains more confirmed findings than any other, on both sides of the API.**
2. **Silent fail-safes and guards that cannot see the defect.** The system detects bad data and
   protects the pixels, then discards the fact (F-01). The composition guard enumerates three
   surfaces and misses the fourth (E1-02).
3. **Diagnostics not wired to their source.** Snapshot globals (F-02), counters outside their guards
   (F-03), boot banners describing gated code, 88 debug globals with unstable contracts. *This is why
   the project keeps re-diagnosing itself — including, four times, during this audit.*

### Five highest-leverage next actions

1. Surface `__MARINE_RENDER_HOUR_PARITY__` in the UI (**Mission 1** — see `FIRST_IMPLEMENTATION_PACKET.md`).
2. Convert `__SIM_DIAGNOSTICS__` (and siblings) to live accessors.
3. Fix the boot banner + move `evolutionTicks++` inside its guard, or delete the inert kernel.
4. Investigate grid-tier selection non-monotonicity in zoom.
5. Stop requesting world-sized grids for small viewports.

### The single first action I would authorize

> **Extend the composition-parity guard so it can see the rating band (E1-02).**
>
> Not because it is the biggest defect — E1-01 is — but because it is the **prerequisite for fixing
> the biggest defect safely.** The guard currently enumerates three surfaces and `sim_rating.py:9-11`
> asserts "exactly three surfaces compose a rating," which is **false at HEAD**. Until the band is
> inside that registry, any attempt to correct a 3.04× height divergence is unmeasurable and
> unprotected against regression. It changes **no user-visible number** — it only makes the existing
> violation *visible and locked*.
>
> **Authorize in parallel** (disjoint surfaces, zero shared files): the **F-01 disclosure badge**,
> fully specified in `FIRST_IMPLEMENTATION_PACKET.md`. It is the frontend twin of the same principle —
> *make the truth visible before changing any number.*
>
> ⛔ **Do NOT yet tune either the band or the point lane.** E1 confirmed the band is the surface to
> correct but did **not** isolate the responsible sub-term, and the project's own open QUEUE E#1
> reached the same stopping point from the runtime side. Fixing the guard is what turns that
> investigation from guesswork into measurement.

---

## SECTION 2 — AUDIT SCOPE, TOOLS, AND EVIDENCE QUALITY

| Dimension | Coverage |
|---|---|
| Commits reviewed | **100** — `COMMIT_REVIEW_LEDGER.csv` (91.5 KB, subagent A2) |
| Documents / handoffs reviewed | `CHAT_AND_HANDOFF_LEDGER.md` (28 KB) + contradiction ledger (28 KB) |
| **Exported chats** | ⚠️ **CORRECTION — they DO exist.** An earlier draft of this report said "NOT LOCATED". That was **wrong**. There are **116 `.jsonl` session transcripts, 482.9 MB**, at `C:\Users\dprit\.claude\projects\C--Users-dprit-Raw-Surf\`. Subagent A1 **enumerated the ten preceding sessions and read each one's opening instruction**, but did **not** read ~0.5 GB of message bodies. So the ten-chat requirement is **partially met**: sessions identified and framed, bodies unread. Any decision that lives only inside a chat body and never reached a commit or document is outside this audit's evidence base |
| Live test runs | 18 instrumented browser probes, all first-party measurements |
| **Recordings reviewed** | **ZERO.** No video capture tool was available in this pane — a genuine gap |
| Screenshots | 5 reviewed inline; **not persisted to disk** (tool returns them inline) |
| Layer coverage | **1 of 12** (Waves) end-to-end |
| Model coverage | **3 of 3** (GFS, ICON, EURO) |
| Geographic coverage | 4 sites (Cocoa Beach, Portugal, Morocco, New York) × zooms 5–10 |
| Browser coverage | **1 of 3** (Chromium) |

### Tool capability inventory

| Capability | Available | Tool | Safe | Limitation |
|---|---|---|---|---|
| Real pointer/click | ✅ | Browser pane `computer` | ✅ | verified trusted via a capture-phase probe |
| Runtime JS probes | ✅ | `javascript_tool` | ✅ | **30 s hard timeout** — split long probes |
| Console / network capture | ✅ | Browser pane | ✅ | text only |
| WebGL readback | ✅ | `gl.readPixels` after a render pass | ✅ | the highest-value tool in this audit |
| Webpack module introspection | ✅ | `webpackChunkfrontend` runtime probe | ✅ | dev build only |
| React Scan | ✅ **already shipped** | in dev bundle | ⚠️ | v0.1.32, outdated; draws a full-viewport overlay canvas |
| Playwright | ⚠️ config only | `frontend/playwright.config.js` | ✅ | **not run** |
| Video / trace / profiler | ❌ | — | — | **not available in this pane** |

### Evidence hierarchy actually used

Every finding in §11 rests on **reproducible runtime behaviour** plus **active source path**, with git
history where relevant. Where a consequence was not measured, the finding says so and severity is
capped accordingly.

---

## SECTION 3 — HISTORICAL RECONSTRUCTION

### The baseline-commit question, answered

`b5bbaa7d` and `f5f6a3d` **both exist** (`git cat-file -t` → `commit`), and `f5f6a3d` is an
unambiguous 7-char prefix.

| commit | date | subject | scope |
|---|---|---|---|
| `b5bbaa7d` | 2026-05-27 | *v3.13.7: World-wrap seam fix — 3-copy rendering + stripe reduction* | **1 file, +17/−5** (`WebGLMarineEngine.js`) |
| `f5f6a3d` | 2026-05-26 | *fix: correct wind/wave zoom advection containment cache bug…* | 2 files, +17/−16, **empty commit body** |

> **Verdict: `CONTRADICTED` as "known-good baselines."** Neither is tagged. Both are single-concern
> fixes 2.5 months upstream of HEAD, predating the entire current forecast chain
> (`surf_point`, `surf_rating.py`, `science_registry.py`, the shore-normal asset). `b5bbaa7d` patches
> a renderer since refactored (`dbeb8456`, 3845 → 3207 lines). `f5f6a3d` records **no rationale at
> all**. Use them only for the specific behaviour each touched, never as a general "good state".

### The coexistence window — 2026-05-10 → 2026-05-20

| module | introduced | LOC @HEAD | imported by |
|---|---|---|---|
| `MapWebGL.js` | 05-10 `cde0ab28` | 1,097 | `MapPage.js:3` |
| `WeatherEngine.js` | 05-14 `41bc83b8` | 1,116 | `MapWebGL.js:13` |
| **`GPUMarineLayer.js`** | **05-15 `e92aca76`** | 573 | `MapWebGL.js:7` |
| `WebGLWindEngine.js` | 05-16 `0105a9d7` | 1,093 | `MapWebGL.js:10` |
| **`WebGLMarineEngine.js`** | **05-20 `8dd9abe3`** | **3,204** | `MapWebGL.js:11` |
| `FieldCompositionEngine.js` + `SimulationLoop.js` | 05-27 `b5fad579` | 250 / 391 | `engine-bootstrap.js:30` |

`git log --diff-filter=D` returns **nothing** for `GPUMarineLayer.js` or `WeatherEngine.js` — neither
was ever deleted. The legacy/replacement marine pair has coexisted **81 days**.

**⭐ Runtime closure (measured by this audit, answering subagent A2's open question):** only **two**
custom map layers exist (`webgl-marine-particles`, `webgl-wind-particles`); there is **no
`MarineParticleCanvas` in the DOM**; the four page canvases are MapLibre + two timeline sparklines +
React Scan's overlay. ⇒ **"Two marine renderers draw concurrently" is REFUTED.** `GPUMarineLayer` is
**imported but never mounted** — bundle weight and cognitive load, *not* a rendering conflict. This
materially lowers the urgency of "remove the competing renderer."

### Other leads dispositioned

| Lead | Disposition |
|---|---|
| Field Composition Engine | Introduced `b5fad579` (05-27). **Exists and is reachable.** Its "single source of truth" authority is **Superseded** per the repo's own Report 11.0 §invariant-14; live choke is `decideMarineCommit` |
| RK4 particle integration | Introduced `42435c41` (05-17). **Present, imported — and inert in production** (see F-03). ⚠️ **Three** RK4-labelled paths exist: `engine/particle-system.js`, `engine-brain/wind-advection-model.js`, and the GL shader path |
| OceanMask | Introduced `74fa33ef` (05-18). 905 LOC, grandfathered in the LOC ratchet. **One** production importer. Not touched by any of the last 100 commits. ⚠️ A *separate, unrelated* `ocean_mask` exists in the Python pipeline (`bathymetry.py:214`) — same word, different subsystem |
| Geographic dead zones (NY, Portugal, Spain, Morocco) | **NOT REPRODUCIBLE** at HEAD — treat as a **stale historical description** |
| Land bleed | **NOT REPRODUCIBLE** at z9 Florida |
| Transient texture recreation | **NOT REPRODUCIBLE** across 6 toggle cycles (204/204 balanced) |
| Tile scrubbing "~36 ops reduced" | Scrubbing now costs **0 network requests** inside the cached horizon |

---

## SECTION 4 — CURRENT AUTHORITATIVE ARCHITECTURE

Full table in `ARCHITECTURE_AUTHORITY_MAP.md` (50 KB) and `evidence/network/B2-backend-pipeline-map.md`
(66 KB). Condensed:

```
Open-Meteo / Copernicus / RainViewer
        └─> backend/services/weather_pipeline/  (85+ modules)
              ingestion -> normalizer.py -> store.py -> grid_resolver
              surf chain: surf_point.resolve_surf_geometry -> estimate_surf_at
                          -> surf_rating.compute_surf_rating      [ONE FORECAST COMPOSITION]
        └─> /api/weather/grid , /api/weather/grid_series
              |
   FRONTEND   v
   backendWeatherServiceClient* -> marineController / useMarineOrchestrator
        -> decideMarineCommit            <-- THE LIVE COMPOSITION CHOKE
        -> WebGLMarineEngine (GPU advection, 87,616 crests)   [custom layer: webgl-marine-particles]
        -> WebGLWindEngine   (GPU advection, 147,456 particles)[custom layer: webgl-wind-particles]
   engine/  render-orchestrator (ONE RAF, fixed dt) -> SimulationLoop
        -> FieldEvolutionEngine + RK4 ParticleSystem  ......... INERT (sandbox-gated)
        -> FieldCompositionEngine (composeRenderPlan) ......... diagnostics only, 4 Hz
   GPUMarineLayer / MarineParticleCanvas ................. IMPORTED, NEVER MOUNTED
```

**Three composition tiers coexist:** (1) the direct React→engine path (authoritative), (2) the FCE
(diagnostics-only, `populated:false`), (3) the inert SimulationLoop physics kernel.

---

## SECTION 5 — SYSTEM CAPACITY AND OPERATING ENVELOPE

Full detail in `SYSTEM_CAPACITY_PROFILE.md`. Headline:

- Idle GPU cost is **near zero** — 0 draw calls, 2 textures, ~0.7 MB estimated.
- **235,072 particles allocate at boot** with zero layers active.
- Layer toggling sustains **zero** GPU leak; churn is ~519 buffers + 182 VAOs + 34 textures per cycle.
- Scrubbing inside the cached horizon: **0 requests**.
- Slowest measured request: **6,327 ms** for a world-sized grid.
- **The bottleneck is network, not physics and not GPU.**

⚠️ **NOT MEASURED:** which GPU Chromium bound (hybrid laptop), 60 Hz behaviour, DPR 1, mobile,
CPU throttling, backend limits (deliberately not load-tested against production), 11 of 12 layers.

---

## SECTION 6 — TEST LADDER RESULTS

Full CSV: `WEATHER_SIM_TEST_LADDER_RESULTS.csv` (33 tests).

| Level | Pass | Fail | Blocked |
|---|---|---|---|
| L0 Provenance/Boot | 3 | 0 | 0 |
| L1 Data & time truth | 1 | 1 | 0 |
| L2 Static layers | 2 | 0 | 1 (11 layers) |
| L3 Animation | 2 | 2 | 0 |
| L4 Zoom/pan/DPR | 0 | 2 | 1 |
| L5 Timeline/model/layer | 2 | 2 | 0 |
| L6 Projection/geography | 4 | 0 | 1 |
| L7 Cross-layer composition | 0 | 1 | 0 |
| L8 Failure/race/recovery | 0 | 0 | 1 |
| L9 Performance | 1 | 2 | 0 |
| L10 Lifecycle/soak | 1 | 1 | 1 (heap inconclusive) |
| L11 Cross-browser | 0 | 0 | 1 |
| L12 Scientific validation | delegated to subagent E1 | | |

---

## SECTION 7 — LIVE VISUAL AND RUNTIME FINDINGS

Complete pack: `evidence/console/LIVE-RUNTIME-EVIDENCE-PACK.md`. Summary in §11.

The most important *visual* finding is one screenshot: model chip **EURO**, layer **Waves** lit,
timeline **"Thu 12 AM"**, legend *Combined Waves (ft) 0–20+* — over a wave field **pixel-identical**
to the earlier GFS hour-6 render, with **no spinner, badge or error**. Confidently wrong is
indistinguishable from correct.

---

## SECTION 8 — ANIMATION AND PROJECTION VERDICT

| Question | Answer |
|---|---|
| One animation authority? | **Yes.** `frame` fires 29.6/s against 29.6/s vsync |
| How many schedulers exist? | **4 RAF chains** — engine + **two** FPS counters + web-vitals probe |
| Any duplicated? | **No engine duplication.** One module instance each (webpack cache walked) |
| Frame-rate independent? | **Yes** — accumulator loop, `dt` exactly 1/60, sim clock 1.00× real time |
| Attached to the map? | Yes — custom layers render inside MapLibre's pass |
| Mercator / geographic correction? | Correct at all four tested sites |
| Row/texture orientation consistent? | **No upside-down field observed**; land/ocean separation 4–12× |
| Global behaviour? | Correct at Florida, Portugal, Morocco, New York |
| Antimeridian? | ⚠️ **NOT TESTED.** Note `b5bbaa7d` was a world-wrap seam fix — a known-sensitive area |
| High latitude? | ⚠️ **NOT TESTED** |
| Pan/zoom/resize/bearing/pitch/DPR? | zoom **FAILS** (value drifts, §11 F-04); bearing/pitch/DPR **NOT TESTED** |
| OceanMask aligned at every scale? | Correct at z8–z9. ⚠️ Only **10** land features at the 10 m tier |

---

## SECTION 9 — DATA AND FORECAST CORRECTNESS

Executed by subagent E1 (`evidence/synthetic-probes/E1-science-correctness.md`, 46 KB) with four
re-runnable probe scripts (`probe_E1_*.py`) using the project's own interpreter. **I did not
personally re-run these**; they are reported with E1's own classifications and its environment
disclosure (Python 3.14 vs declared 3.12; 28/46 pins differ — arithmetic-only code paths, so drift
risk is low but non-zero).

### ⭐⭐ The most important science finding: the map band bypasses the ONE FORECAST COMPOSITION chain

**E1-01 · CONFIRMED · Critical.** `rating_transform_grid` — the coastal **rating band** — does **not**
go through `surf_point.resolve_surf_geometry` + `estimate_surf_at` + `surf_rating.compute_surf_rating`.
Measured **at the same coordinate**: band height up to **3.04×** the point height, and band rating up
to **56.9 points** apart, **signed both ways**.

This is a direct violation of the project's single binding rule in `CLAUDE.md`, and it is the
**backend-side twin of my live finding F-04** (the rendered value at a fixed coordinate drifting with
zoom). Two independent methods — E1's Python composition comparison and my `readPixels` zoom sweep —
converge on the same defect from opposite ends. It also independently corroborates the project's own
open **QUEUE E#1** ("the band and the glyph are two populations", 2.3–2.7×).

**E1-02 · CONFIRMED · High.** The composition-parity guard enumerates **three** surfaces and
**structurally cannot see the band**; `sim_rating.py:9-11` asserts "exactly three surfaces compose a
rating" — **false at HEAD**. *A guard that cannot see the defective surface is not protection.*

### Other confirmed science findings

| ID | Finding | Class | Sev |
|---|---|---|---|
| **E1-03** | H1/10 is applied **after** the γ·d cap test ⇒ served height exceeds its own depth-limited ceiling by **+25.0 %** and is **non-monotonic** in offshore Hs (10.00 m → **36.86 ft**, 10.25 m → **29.50 ft**) | CONFIRMED | High |
| **E1-04** | `wave_period` carries **three different period statistics** (peak / mean-inverse-moment / per-value fallback) across four fetchers under **one field name and one unit** | CONFIRMED (code) | High |
| **E1-05** | The frontend **never reads** `units` / `value_unit` / `display_unit_hint` — assigned at **20 sites, read at 0**. Every display conversion is a hardcoded assumption | CONFIRMED | Medium |
| **E1-08** | Two fallback paths upload a **linear-in-latitude** mask into a slot the shader samples with a **mercator** `mask_v` — error up to **17.1° of latitude** on a global frame | CONFIRMED (code) | Medium |
| **E1-09** | `surf_point.py:253-257` still claims "NO SERVING-PATH CALLER SUPPLIES η YET"; the wire landed 19 h later (`bd4d67e5`) | CONFIRMED | Low |
| **E1-11** | `wave_wrapping.py` (489 lines, diffraction) has **zero non-test references** — unreachable prototype | CONFIRMED | Info |
| **E1-12** | `FieldEvolutionEngine.js:36` holds the truncated `KNOTS_TO_MS = 0.514444` the backend forbids — **dormant**, because it sits behind the same sandbox gate as F-03 | CONFIRMED (unreachable) | Info |

### Confirmed-correct (defects actively refuted)

- **E1-06** — shore normal **is** seaward (9/10 depth-profile test); `offshoreness` and `swell_exposure`
  agree on the FROM frame. **No 180° direction defect.**
- **E1-07** — lat **ascending**, row 0 = south, `UNPACK_FLIP_Y=false`, `tex_v=(lat−south)/(north−south)`.
  **No upside-down field.** *(Independently consistent with my live land/ocean pixel separation.)*
- **E1-10** — CLAUDE.md's 14 s/315°/5 kt sweep **reproduces exactly at HEAD** once the unstated wind
  direction (045°) is supplied. **Not stale.**
- Wind unit round-trip (`MS_TO_KT` / `KT_TO_MS`) is **closed and correct** across all four rating callers.

### Synthesis

The capability contract remains a genuine strength. But the science verdict is **not** "the chain is
fine and only the UI lies." It is two-part:

1. **At the render/disclosure boundary** — a correct refusal to draw bad data paired with a UI that
   keeps advertising the requested hour and model (F-01).
2. **At the composition boundary** — **the band surface never entered the mandated chain at all**
   (E1-01), and the guard meant to catch exactly this cannot see it (E1-02).

The recurring shape across both, and across the Codex review's own §2, is unchanged:
**one label covering two different quantities.**

---

## SECTION 10 — CONFIRMED STRENGTHS

| ID | Strength | Location | Why preserve |
|---|---|---|---|
| **S-01** | Fixed-timestep single-RAF orchestrator | `engine/render-orchestrator.js` | 1.00× real time; survived 3 falsification attempts. **Do not touch** |
| **S-02** | Capability/provenance contract | `__WEATHER_CAPABILITIES__` | Separates dispatch key from upstream; records its own past error |
| **S-03** | GPU resource lifecycle | WebGL engines | 204/204, 1092/1092, **0** program churn |
| **S-04** | Accessible weather controls | weather panel | 32 `aria-label`, 16 `aria-pressed`, 0 bare clickable divs — meets the project's own mandate |
| **S-05** | Stale-request cancellation | marine fetcher | Both in-flight ICON requests aborted on a newer choice |
| **S-06** | Zero-network scrubbing | timeline | 14 clicks, 0 requests, exact arithmetic |
| **S-07** | Self-knowledge | `__MARINE_RENDER_HOUR_PARITY__` | The app **already computes** the fact Mission 1 needs. The repair is disclosure, not detection |

---

## SECTION 11 — ROOT-CAUSE ISSUE REGISTER

### F-01 — The map renders a stale hour and model under confident labels, silently
**Classification** CONFIRMED (symptom) / HYPOTHESIS (mechanism) · **Severity High** · **Confidence High**
· Provenance: Runtime (this audit) · Subsystem: marine render / timeline authority

- **Reproduction:** `/map`, Cocoa Beach z9, GFS→Waves at +6 h; click ICON, +300 ms click EURO;
  immediately click `+1d` ×3.
- **Measured:** `__MARINE_RENDER_HOUR_PARITY__ = {parity:false, reason:"retained_previous",
  requestedHour:78, renderedDataHour:6}` at T+12 s **and** T+60 s. `renderedParticleCount` unchanged
  at 87,616 throughout. UI shows EURO / "Thu 12 AM" with **no** loading or staleness indicator.
- **Root cause:** the renderer correctly refuses an unusable grid and retains the previous field —
  a **silent fail-safe**. The retain decision is recorded and discarded.
- **Falsification attempted:** waited 60 s+ (not transient); confirmed fetches returned **200** (not a
  network failure); confirmed `parity:false` is the *app's own* verdict. Later tour showed parity
  recovers after a viewport change ⇒ **severity revised Critical → High** and the mechanism left open.
- **Alternative not excluded:** the degenerate 6×5 grid may be a **backend** defect. Portugal/Morocco/NY
  rendered fine from comparably small grids, so grid size alone does **not** explain it.
- **Repair boundary:** surface the existing flag. Do **not** change the retain logic — it is correct.
- **Acceptance test:** reproduce the sequence; a staleness indicator must appear within 2 s of
  `parity===false` and clear when it returns true.

### F-02 — The primary published engine diagnostic is a stale snapshot
**Classification** CONFIRMED · **Severity Medium** · **Confidence High** · Subsystem: observability

- `Object.getOwnPropertyDescriptor(window,'__SIM_DIAGNOSTICS__')` → **DATA property**, not an accessor.
- Over 3 s: global `frameIndex` Δ = **0**; live `getSimDiagnostics()` Δ = **180** (exactly 60 Hz).
  Live 29,157 vs stale 27,743 = **23.6 s stale**.
- **Impact:** it reports a healthy engine as frozen *and* fabricates catch-up bursts. **It cost this
  audit four probes and would have produced a fabricated finding in a less careful review.**
- `window.__RAW_GPU__` additionally **changed type mid-session** (function → object), breaking a probe.
- **Repair:** `Object.defineProperty(window,'__SIM_DIAGNOSTICS__',{get:getSimDiagnostics})`.

### F-03 — The physics kernel is inert in production while telemetry reports it active
**Classification** CONFIRMED · **Severity High** (truth-in-telemetry + dead weight) · Subsystem: engine

- `SimulationLoop.js:219` gates everything on `__IN_SIMULATION_SANDBOX__ === true`; measured
  **`undefined`** on `/map`.
- ⇒ `evolveField` (`:224`), `_windParticles.update` (`:245`), `_marineParticles.update` (`:250`)
  **never run**. Boot prints *"RK4 particles + field evolution active"*.
- `_evolutionTicks++` (`:226`) sits **outside** the guard ⇒ reported 304 evolutions that did not happen.
- **Decision required (owner):** either wire the kernel into production behind a real flag, or delete
  it and its telemetry. Leaving it is what produces reports like this one.

### F-04 — Zoom changes the rendered forecast value at a fixed coordinate
**Classification** CONFIRMED (coupling) / HYPOTHESIS (cause) · **Severity High** · Subsystem: grid tier

- Fixed point −79.60/28.35, EURO, hour 78: RGB z5 `(35,168,128)` → z10 `(63,141,127)`;
  **ΔR +28, ΔG −27**, monotonic.
- Served grid **non-monotonic in zoom**: z8 = 5×5 (21 nonzero, maxH 1.1519); **z9 = 18×17 (191, 2.1559)**;
  z10 = 5×5 (21, 1.1519).
- **Corroborates the project's own open QUEUE E#1** (band vs glyph, 2.3–2.7×). This is an independent
  runtime reproduction from a different direction.
- ⚠️ I measured **colour drift**, not feet. I did not decode the ramp. Do not quote a height error.

### F-05 — World-sized grids requested to paint a 2° viewport
**Classification** CONFIRMED · **Severity Medium** · Subsystem: fetch scope

- `/api/weather/grid?...bbox=-180,-80,180,85` → 3,745 ms and 5,273 ms;
  `grid_series?...bbox=-180,-80,180,85&hours=78` → 6,327 ms. Viewport was 2.2° × 2.1°.
- 14 marine requests for one model switch + 3 timeline clicks; 2 still pending at +12 s.
- **The dominant measured latency in the entire session.**

### F-06 — Event listener leak across layer toggles
CONFIRMED · **Low/Medium** — 661 added / 630 removed over 6 cycles = **net +5.4 per cycle**, monotonic.

### F-07 — Eager engine allocation at boot
CONFIRMED · **Low** — 235,072 particles and both custom layers allocated with **zero** layers active;
layers enter `render()` with `active:false`.

### F-08 — Add-before-style-ready race at boot
CONFIRMED · **Low** — `[WebGLMarine-Forensic] Failed to add layer: Style is not done loading` +
same for wind. Self-correcting, but a latent ordering dependency.

### F-09 — Diagnostic overhead shipped in the dev bundle
CONFIRMED · **Low** — React Scan active (v0.1.32, outdated) drawing a full-viewport overlay canvas at
`z-index 2147483600`; **two independent FPS counters**; 88 `window.__*` globals; a **0×0 canvas with a
1×1 backing store** (a collapsed duplicate scrubber).

### F-10 — Duplicate static asset fetch
CONFIRMED · **Low** — `ne_50m_land.json` fetched **3×** per page load.

### F-11 — Heatmap/infobox parity flag is false
**BLOCKED** · severity withheld — `__WebGLMarineLayer_DIAG__.infoboxHeatmapParity === false`. The app
tracks it and it is failing; **consequence not independently reproduced**. Needs a dedicated test.

### F-12 — Committed live credentials, in TWO tracked files (not one)
CONFIRMED (subagent A1) · **Severity: owner decision — treat as urgent**

Two live keys are committed in `BRAIN_RULES.md` **and again in `.antigravityrules`** — a second
git-tracked file whose content is **275 of 279 lines identical** to the first, and which appears in
**no audit, handoff, memory index or queue entry** in this repo. The keys are also in history.

⇒ The standing instruction in the repo's own Report 11.0 to *"secret-scan all refs"* has
**demonstrably not been executed** — a file-level census would have found the duplicate immediately.

**Action: rotate both keys, then scan all refs (not just the file you remember).** Neither key was
opened, tested, or reproduced by this audit — the finding rests on their presence in two tracked
files, which is sufficient to require rotation regardless of whether they are still live.

⭐ **Reusable rule:** *a census of the asset you remember cannot find the asset you forgot — enumerate
the tracked population, not the known instance.*

### F-13 — The STALE BLOCKER defect class was never applied to its own founding instance
CONFIRMED (subagent A1, executed) · **Severity Medium** *(red team: survives, corrected High → Medium)*

`test_rating_composition_parity.py:142-144` and `spot_ratings.py:149` still assert that
`bathymetry.bed_slope_at` *"returns None until the finer slope asset is bundled — wire it WITH the
asset, not before."* The asset (`etopo_slope_0p1.npy`, **12.96 MB**) has been **git-tracked since
2026-06-29** (`fa86fb53`). Executed at HEAD, `bed_slope_at` returns **real floats at 6 of 6 spots**
(Pipeline 0.0301, Mavericks 0.0066, Nazaré 0.0606, Cocoa 0.0012, Teahupo'o 0.1563, J-Bay 0.0052).

The precondition is **false**, and the same repo *published the "stale blocker" defect class on
2026-08-05* — then never re-ran the sweep against its own founding example.

⚠️ **This is NOT a recommendation to flip `RATING_BREAKER_TYPE`.** The finding is *"the blocker is
stale"*, not *"enable it"*; a prior audit prices that flip as HIGH risk (18.5 % out-of-validity slopes).

### F-14 — `SURF_HEIGHT_H110` declares conflicting defaults, and the parity guard cannot see it
CONFIRMED (subagent A1) · **Severity Medium** *(red team: survives on every code fact; the
"three defaults" framing was corrected as inaccurate)*

The flag the project says moves **every displayed height by ~27 %** carries a different declared
default in the source (`surf_height_convention.py:74` → `os.environ.get("SURF_HEIGHT_H110", "1")`,
i.e. **ON**) than in its own admin registry. `test_flag_lane_parity.py` — which exists precisely to
make *"the registry describe reality"* — grades workflows against **the registry's own tuple** rather
than the source's `os.environ.get` fallback, so the mismatch is **structurally invisible to it**.
An AST + regex census across all 40 registry entries found this is the **only** production instance.

Same shape as E1-02: *a guard that reads its own declaration instead of the code cannot detect a
declaration that disagrees with the code.*

---

## SECTION 12 — SOFTWARE JACOBIAN FINDINGS

Full matrix: `SOFTWARE_JACOBIAN_MATRIX.csv` (19 input×output relationships).

**Couplings that should be zero and are not:**

| input → output | observed |
|---|---|
| **zoom → rendered value at a fixed coordinate** | ΔR +28 / ΔG −27 across z5→z10 (F-04) |
| **zoom → served grid tier** | non-monotonic: 25 / 306 / 25 cells at z8 / z9 / z10 |
| **model switch + far scrub → rendered hour** | 72-hour divergence, silent, ≥60 s (F-01) |
| **layer toggle → event listeners** | +5.4 per cycle |
| **instrument choice → reported engine health** | snapshot vs live diverge 23.6 s (F-02) |

**Couplings that are correctly absent (verified):** pan → masking; pan → parity; model switch →
stale overwrite; scrub → network; layer toggle → GPU leak.

---

## SECTION 13 — CODEX AUDIT VERIFICATION

Source: `AUDIT-OF-THE-AUDIT-2026-08-03-codex-weather-sim-review.md` (itself an audit of
`OPUS5_WEATHER_SIM_DEEP_AUDIT_HANDOFF_2026-08-03.md`).

| Codex finding | Disposition here |
|---|---|
| 1 — `explain()` gets the post-gate score | **Not re-verified** (backend/MCP surface, outside the live browser lane) |
| 2 — `sim_window` publishes an ungated score | **Not re-verified** |
| 3 — margin computed in saturated display space | **Not re-verified** |
| 4 — failures cached for the positive TTL | Recorded as **FIXED at `77f66211`**; re-verification delegated to subagent B2 |
| 5 — one global breaker couples endpoints | **Not re-verified**; the review itself calls the split an owner decision |
| **§2 root reframe:** "`quality_rating` is an unqualified name for two quantities" | **STRONGLY CORROBORATED, from a different direction.** F-01 is the same defect class at the *render* boundary: one label (`+78 h / EURO`) covering two different quantities (requested vs rendered). The Codex reframe generalises further than it claimed |
| §6 invariant: *"a cached negative must not outlive the mechanism that produced it"* | Endorsed |
| §6 invariant: *"any 'every surface does X' invariant needs a registry **and** a negative control"* | **Endorsed and reinforced** — this audit's own false starts were all missing negative controls |

**Honest note:** this audit's live lane could not verify Codex findings 1–3 and 5, which are backend
MCP-surface claims. They are **not** disputed; they are **not re-proven**. Their disposition remains
as the Codex review left it.

---

## SECTION 13b — RED-TEAM / FALSIFICATION LEDGER

One adversarial agent per Critical/High finding, each instructed to **refute** it, to re-read every
cited line rather than trust it, to prove reachability, to name an alternative cause, and to
**default to `survives=false`** when it could not independently reproduce the evidence.

**30 attacked · 24 survived · 6 CONTRADICTED · many severities corrected downward.**

> ### ⚠️ ID NAMESPACE COLLISION — read before quoting any finding ID
> The subagents numbered their own findings `F-01`, `F-02`, `F-03`, `F-05`, `F-07`, `F-11`, and
> **these are NOT the same findings as the lead auditor's `F-01…F-12` in §11.** For example
> subagent `F-03` concerns `netlify.toml:7 NODE_VERSION`, while lead `F-03` is the inert physics
> kernel. **Lead findings are also published as `L-01…L-07` in the live evidence pack — prefer the
> `L-` prefix when citing them.** The verdicts below are on the **subagent** namespace.

### Killed — do not carry these forward

| ID | Verdict | Why it died |
|---|---|---|
| subagent **F-02** | **CONTRADICTED** | *"All cited paths are wrong in the brief — the module is `frontend/src/engine/engine-bootstrap.js`, not `components/map/engine/`."* Individual code facts survived; the finding as framed did not |
| subagent **F-05** | **CONTRADICTED** | Literal quotes checked out, but **both the reachability claim and the causal claim failed under execution** |
| **A2-04** | **CONTRADICTED** | severity corrected to Info |
| **A2-05** | **CONTRADICTED** | severity corrected to Low |
| **A2-06** | **CONTRADICTED** | severity corrected to Low |
| **D-15** | **CONTRADICTED** | severity corrected to Low |

### Survived, but with severity corrected downward

| ID | Verdict | Severity | Red-team note |
|---|---|---|---|
| **E1-01** | CONFIRMED | Critical → **High** | The headline composition finding survives the attack |
| **E1-02** | CONFIRMED | High → **Medium** | |
| **E1-03** | CONFIRMED | High → **Medium** | *"I tried to destroy this and failed on the mechanism, but succeeded on the severity and on its novelty"* |
| **E1-04** | CONFIRMED | High → **Medium** | *"I tried to break it on all six axes and it held on five"*; two off-by-one citation errors corrected |
| **A1-01** | CONFIRMED | High → **Medium** | stale `bed_slope_at` blocker |
| **A1-02** | CONFIRMED | High → **Medium** | |
| subagent **F-07** | CONFIRMED | High → **Medium** | survives on every code fact, *"but the 'three defaults' framing is inaccurate"* |
| subagent **F-01** | CONFIRMED | → **Medium** | *"CODE FACT CONFIRMED BY EXECUTION, CONSEQUENCE AND FRAMING REFUTED"* |
| subagent **F-03** | CONFIRMED | → **Medium** | `netlify.toml:7 NODE_VERSION = "18.20.2"` verified verbatim |
| **A2-03**, **A2-07**, **A2-08**, **B2-01**, **B2-05**, **D-03**, **D-14**, **B-01** | CONFIRMED | **Medium** | |
| **A2-01** | **PROBABLE** | High | one link remains inferential |
| **A2-02** | CONFIRMED | **High** | |
| subagent **F-11**, **D-01**, **B-02** | CONFIRMED / PROBABLE | **Low** | |
| **A2-09** | **NOT REPRODUCIBLE** | — | did not reproduce under documented conditions — treat as unproven |

### The lead auditor's own findings were falsified in-session, not by this pass

The workflow red-teamed the **subagent** packs. My live findings were attacked by me as I went, and
**four of my own hypotheses died**: duplicate RAF loops, duplicate engine modules, subscriber churn,
and concurrent duplicate marine renderers — plus land bleed and geographic dead zones, which failed
to reproduce at every site tested. The one finding I *did* revise on evidence was L-02/F-01
(Critical → High, after it proved to self-heal).

> **Method note worth keeping.** The adversarial pass corrected severity on **9 of 24 survivors** and
> killed **6 of 30**. A finding list that does not shrink under attack has not been attacked.

---

## SECTION 13c — THE UNREADABLE-GREEN SWEEP (2026-08-09, post-push)

After the E2E reporter defect was fixed, a 16-agent sweep generalised the class across the estate:

> **A refusal you cannot READ is indistinguishable from a pass.** A guard that declines to run — or
> runs and cannot answer — and reports that decline only into a channel nobody consults returns a
> green a reader will over-interpret. It costs CI time and buys nothing.

**Red team: 12 findings attacked, 6 survived, 6 CONTRADICTED.** Packs:
`evidence/console/S1-workflow-green-audit.md` (31 KB, all 27 workflows) ·
`S2-refusal-and-vacuity-audit.md` · `S3-silent-failsafe-audit.md` · `S4-guard-census-audit.md`.

### Five mechanisms, 15 further instances

| # | Mechanism | Examples |
|---|---|---|
| **M1** | Verdict is a `warn`/annotation; exit code always 0 | `lighthouserc.json`, `ci.yml backend-lint`, calibration-census |
| **M2** | An explicit REFUSE branch exits 0 beside a real PASS | `vector-blockmean-parity`, `marine-nightly`, `science-shadow-ab` |
| **M3** | An empty population is treated as a pass | `encoding-check`, `precompute_ci`, data-health paging gate |
| **M4** | A swallowed error (`\|\| true`, `2>/dev/null`, `continue-on-error`) turns a broken instrument green | `encoding-check`, `data-health-monitor`, `marine-nightly` |
| **M5** | The step's NAME overstates what it asserts | `build-shore-normals` "Verify the asset against its own gate" |

### Findings that survived

| ID | Sev | Finding |
|---|---|---|
| **F1** | **High** | **`backend-lint` is a REQUIRED check on `main` that cannot fail.** `ci.yml:267-270` runs flake8's `E9,F63,F7,F82` (syntax + **undefined names**) under `continue-on-error: true`, as the job's last step ⇒ conclusion unconditionally success. **The same file, `:110-130`, documents how the missing FRONTEND equivalent let a `no-undef` live 12 days in the WebGL render path** — the frontend gap was closed, the backend twin left warn-only |
| **F2** | Medium | **`lighthouse`, also required, has all four assertions set to `warn`** (`lighthouserc.json:12-19`) incl. `categories:accessibility`. Measured **100/100 recent runs green** — and `lighthouse.yml:8-9` cites that green as evidence the job is safe to require, **reasoning from an outcome it had made impossible.** It is the estate's only automated a11y score |
| **F4** | Medium (PROBABLE) | `marine-nightly` prints **"WITHIN BUDGET — PASS"** and exits 0 when `verdict.json` is unreadable (`[ "" -gt 0 ]` errors, the if-chain falls through). Reproduced in bash; **no live instance found** |
| **S2-01** | Medium | **No `-rs`/`-ra`/`addopts` anywhere in the repo** — all five pytest invocations run bare `-q`. **Every pytest skip reason is discarded**, the exact twin of the Playwright defect just fixed |
| **S2-02** | Medium | Vacuity shapes in the test suites (asserts inside possibly-empty loops) |
| **S3-01** | Medium | **The staleness badge exists and is gated off the default layer** — see below |

**Highest-consequence single line found:** `precompute_ci.py:75-76` logs `n_spots, n_frames` and
**never asserts them**, so a cycle that rates **zero spots** returns 0 and `precompute.yml` is green.
The same file floors its *input* correctly at `:53-55`. **Input floored, product not.**

**Also confirmed:** the Forecast Calibration Census went 6-red → 3-green **by changing the gate, not
the data** — run `31335894359` has `conclusion=success` while its own log prints
`VERDICT: BOUNDS STALE`. Two workflows git-push assets they never verify. **`dev` — the branch that
redeploys the backend on every push — is not protected at all** (`404`), and
`backend-estate-coverage`, the job with the strongest anti-vacuity gate, is the only `ci.yml` job
**not** required.

### S3-01 — it corrected this audit's own implementation packet

`FIRST_IMPLEMENTATION_PACKET.md` said *"the app computes `parity:false` and never surfaces it —
build a badge."* **Wrong.** Verified at `file:line` by the lead auditor: producer
(`WebGLMarineLayer.js:175-189`) → mapper (`forecastDiagnostics.js:24-25`) → badge
(`forecastCardCompiler.js:22`, *"Stale Hour Retained"*) → render (`MapForecastOverlay.js:780-787`).
The whole feature is **built**, and blocked by `forecastDiagnostics.js:13-15`, which restricts it to
**EURO + swell layers only** — unreachable on **`waves`**, the default and the layer the +78 h defect
was measured on. In one sentence: **`WebGLMarineLayer.js:185` explicitly records `'waves'` as a layer
it reports staleness for; `forecastDiagnostics.js:13` excludes `'waves'` from displaying it.**
(The second `activeModel !== 'EURO'` at `:131` is in `writeOverlayDiagnostics` and does not gate the
badge — `:13` is the only blocker.)
⇒ **Mission 1b changed from "build" to "un-gate."** Packet rewritten.

### What the repo already gets right

The sweep's agent **refuted four of its own hypotheses** and recorded them (sim-parity *does* refuse
on an empty comparison; `--passWithNoTests` is closed by a count floor; artifact-interpreter-parity
cannot pass with 0 artifacts and carries a mutation control; no `paths:`-filtered job is currently
required). **Both fixes this class needs already exist in-tree:** `ci.yml`'s count floors (assert
what *ran*, with `if: always()`) and `artifact-interpreter-parity`'s `--mutate` control. Three files
already use the right exit convention (0=pass, 1=fail, **2/3=NOT MEASURED and red**); four collapse
the refusal into 0.

---

## SECTION 14 — PREVIOUS REPORT DELTA

| Prior claim | Status |
|---|---|
| "Geographic dead zones (NY, Portugal, Spain, Morocco)" | **STALE** — not reproducible |
| "Land bleed" | **STALE** — not reproducible |
| "Transient texture recreation" | **STALE** at the layer-toggle level — 204/204 balanced |
| "Duplicate/competing renderers" | **PARTIALLY STALE** — coexist in *code* (81 days), but the second **never mounts**. Downgrade urgency |
| "Multiple animation loops" | **CONTRADICTED** — exactly one engine RAF chain |
| "Tile scrubbing ~36 ops" | **RESOLVED** — 0 network requests when scrubbing inside the cached horizon |
| "FCE is the single source of truth" | **SUPERSEDED** (the repo's own Report 11.0 already says so; three stale comments remain) |
| "Temporal dead zone crash" | **UNABLE TO VERIFY** — not reproduced |
| CLAUDE.md: "the sim delegates both halves to production" | **CONTRADICTED IN THE SHIPPED PATH** — the *frontend* kernel is sandbox-gated (F-03). CLAUDE.md's claim concerns the *backend* sim; both can be true, and the wording invites exactly this confusion |

---

## SECTION 15 — STATE-OF-THE-ART COMPARISON

Full pass: `evidence/react-scan/F2-state-of-the-art-2026.md` (70 KB) — **30 decisions**, every one
carrying source, source date, access date (**2026-08-09**), installed version, the confirmed
limitation, migration cost, regression risk, required benchmark, and decision. Versions were read
from `node_modules/*/package.json` via `node -e`, **not** from manifest ranges.

### Installed vs current (measured)

`maplibre-gl` **5.24.0** (upstream 6.2.0) · `react`/`react-dom` **19.2.6** · `react-scripts` **5.0.1**
(CRA retired/unmaintained) · `@playwright/test` **1.60.0** (upstream 1.62.1) · `react-scan` **0.5.6** ·
`typescript` **6.0.3**. Backend: `numpy 2.4.4`, `xarray 2026.4.0`, `netCDF4 1.7.4`, **`scipy` NOT
INSTALLED**, `zarr 3.2.1` **installed but provably unused** (no `import zarr` anywhere).

### The four decisions that matter most

| Decision | Finding |
|---|---|
| **ADOPT — Playwright 1.60 → 1.62 + `video: 'retain-on-failure'`** | The suite has **zero `video`/`screencast` configuration**; its only artifact is `screenshot: 'only-on-failure'`. The failures this project chases are **temporal** (frozen animation, stale frames) — the exact class a screenshot cannot capture. **This directly closes this audit's single largest evidence gap (B-01).** |
| **REPAIR — the executed-GL pixel oracle does not assert in CI. TRUE — but for a completely different reason than anyone stated, and F2's remedy would NOT have fixed it.** *(claim revised twice; this is the measured version)* | **What is true:** `Rendered-field pixel truth (executed GL)` (`weather-simulation.spec.js:578`) **skips on all four projects**, so no CI green has ever proven the marine field painted. **What is false:** that it skips because runners have no GPU. It is declared **`test.fixme(...)`** — a skip by *declaration*, independent of environment. **Proof pair, same browser, same run, GPU PRESENT locally:** `:578` → `1 skipped`; sibling `:327` → **passed 20.7 s**. And the GPU premise fails independently — a 4-arm probe (`evidence/webgl/gl-lane-probe.js`) shows the **exact CI config under `--disable-gpu` already has WebGL and paints** (`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`); `--enable-unsafe-swiftshader` and `channel:'chromium'` change **nothing**. ⇒ **`channel:'chromium'` + GPU args is the WRONG FIX** — `test.fixme` skips regardless of flags. **The right fix is the author's own exit condition**, recorded at `:570-577`: finish the commit-latch wait, then un-fixme *("once the latch wait passes 3 consecutive local headed runs")*. Remaining blocker in their words: *"the +24h commit is not yet reliably observed against the shared 1-CPU box."* **Severity: Medium** — it is documented WIP, not a silent hole. |
| **REPAIR — `map.triggerRepaint()` sits inside the `try` that wraps `engine.render()`** (`WebGLMarineCustomLayer.js:322-338`) | A throw in `render()` skips the repaint call and **drops the self-sustaining repaint chain — MapLibre provides no heartbeat for custom layers.** ⭐ **This is a concrete, code-level mechanism for the historical "frozen animation" symptom**, which no other lane in this audit could explain. ~1 line. |
| **DEFER — MapLibre 6.x, and here is the hard blocker** | `@openmeteo/weather-map-layer@0.0.19` declares `maplibre-gl: ^5.20.1` as a **hard dependency, not a peer**. npm would install a **second MapLibre 5 runtime**, and for a package that injects a custom layer into the host map's GL context that means **two MapLibre runtimes sharing one canvas** — a silent-corruption class. Regression risk: **very high.** |

### Other decisions (abbreviated)

| Decision | Items |
|---|---|
| **Keep Current Approach** | MapLibre 5.24.0 (the last 5.x, no CVE named) · `renderingMode:'2d'` · the **scissor** save/restore in `WebGLStateIsolation` (**MapLibre 5.24.0 tracks no scissor state — a leaked `SCISSOR_TEST` is unrecoverable**) · react-scan 0.5.6 harness (*"better than the upstream default"*) · SW `BUILD_VERSION` cache keying · `AbortController` (21 files) · `pygrib` |
| **Complete Existing Migration** | **Buoy-anchored bias correction** — `buoy_calibration.py`, `height_quantile_map.py`, `forecast_skill.py` already exist; *"the highest-value, lowest-risk accuracy lever available"*. ⚠️ **Evaluate on the tails, not the median** · resolve the numpy 3.11/3.12 producer-consumer split (**the parity harness already exists**) |
| **Repair Current Approach** | Node **18.20.2** in `netlify.toml:7` — **EOL since 2025-03-27, ~16 months unsupported** in the deployed build |
| **Benchmark First** | Trimming the redundant `captureWebGLState` (27 `gl.getParameter` per engine per frame, up to **54/frame** with both engines — **redundancy confirmed as a code fact, cost NOT measured**; ⚠️ the 4→7 texture-unit widening shows at least one residual was real) · React Compiler 1.0 · removing `--legacy-peer-deps` |
| **Prototype** | ECMWF **AIFS ENS Wave** (operational 2026-05-12; the installed `ecmwf-opendata==0.3.34` already supports it) — ⚠️ **does NOT fix the EURO swell-partition gap**; its value is *calibrated uncertainty*. Start with `type="em"/"es"`, not 51 members, on a 2 GiB box |
| **Defer** | MapLibre 6 · Zarr v3 / VirtualiZarr / Icechunk (*"zarr cannot change an artifact it never touches"*) · transferable buffers |
| **Reject** | **WebGPU custom layer** (MapLibre WebGPU is unshipped Phase 4) · globe projection · WebGL2 transform feedback (*"87k particles is not compute-bound"*) · SharedArrayBuffer/COOP-COEP · `toHaveScreenshot()` golden images (**foam phase is wall-clock — no golden image can be stable**; the repo's hand-rolled oracle self-calibrates its noise floor and *refuses* when the environment cannot paint — **better than the SOTA option**) · SWAN nest · **training a neural wave/GNN emulator** (no torch, no jax, no labelled nearshore set, no GPU budget) |
| **Not Applicable** | OffscreenCanvas for the custom layers — **mechanically impossible**, MapLibre owns the canvas |

### Verdict

**Almost every fashionable upgrade is correctly rejected or deferred on measured grounds**, and in
two places the repo's existing engineering is *ahead* of the off-the-shelf SOTA option (the
self-calibrating pixel oracle; the react-scan harness). The justified moves are unglamorous:
**better test artifacts, a supported Node runtime, one line of repaint-chain hardening, and finishing
the buoy calibration that is already built.**

---

## SECTION 16 — UPGRADE-PROGRAM STATUS

⚠️ Subagent F1's `UPGRADE_STATUS_MATRIX.md` had not landed at writing time. From evidence in hand:

| Upgrade | Status | Note |
|---|---|---|
| Single animation ownership | **Active and validated** | measured this session |
| RK4 particle integration | **Dual-path / inert** | 3 RK4-labelled paths; product path gated off |
| Field Composition Engine | **Dual-path transition, authority Superseded** | reachable, `populated:false`, diagnostics-only |
| Backend field/heatmap migration | **Active** | `backend_owned: true` across the capability matrix |
| OceanMask | **Active and validated** | correct at every tested site |
| GPU texture residency | **Active and validated** | 0 program churn, balanced lifecycle |
| Timeline / tile-scrub optimization | **Active and validated** | 0 requests when cached |
| Worker offloading | **Unable to determine** | ~17 MapLibre worker blobs; app-level workers not profiled |
| Service-worker caching | **Unable to determine** | dev unregisters SW; production build not tested |
| Higher-resolution coastal data | **Partial** | only 10 features at the 10 m land tier |
| AI-assisted forecast correction | **Not started / design only** | |

**Which incomplete transition is actively creating instability?** The **FCE/SimulationLoop tier** —
not because it misbehaves, but because it is *reachable, inert, and loudly self-reporting as active*,
which corrupts every diagnosis made through it.

---

## SECTION 17 — ZERO-REGRESSION PROTECTION PLAN

The single highest-value asset this audit produced is a **reusable, deterministic probe**:

1. **Golden geographic pixel test** — `gl.readPixels` at fixed lat/lng after a render pass, asserting
   `sea(G−R) > 100` and `land(G−R) < 40`. Catches land bleed, dead zones, upside-down fields and
   projection drift **in one cheap assertion**. Runs in ~8 s per site.
2. **Hour-parity assertion** — `__MARINE_RENDER_HOUR_PARITY__.parity === true` after every model,
   layer and timeline transition settles. **This alone would have caught F-01.**
3. **Zoom-invariance assertion** — identical RGBA at a fixed coordinate across z5–z10. Catches F-04.
4. **GPU balance assertion** — wrap `gl.create*`/`delete*` over N layer cycles; assert net 0.
5. **RAF census assertion** — exactly one callback named `frame` per vsync.
6. **Live-diagnostic assertion** — assert every `window.__*` diagnostic is an **accessor**, not a data
   property. Prevents F-02 recurring.

Budgets to lock: frame time, request count per interaction (scrub = **0**), max bbox span per
viewport, net listener delta per cycle = 0.

---

## SECTION 18 — RECOVERY AND UPGRADE SEQUENCE

**Gate 0 — Establish truth** *(prerequisite for everything)*
Convert diagnostic globals to accessors (F-02). Fix the boot banner and `evolutionTicks` (F-03).
Land probes 1–6 from §17 as a Playwright suite. **Nothing else should start before this.**

**Gate 1 — Correctness and disclosure**
Mission 1: surface hour parity (F-01). Investigate grid-tier non-monotonicity (F-04). Fix the
listener leak (F-06).

**Gate 2 — Consolidate architecture**
Decide the FCE/SimulationLoop tier's fate. Delete or mount `GPUMarineLayer` (now known safe —
it never mounts). Correct the three stale "single source of truth" comments.

**Gate 3 — Low-risk performance**
Stop world-sized grid requests (F-05). Reduce per-toggle allocation churn. De-duplicate
`ne_50m_land.json`. Remove one of the two FPS counters.

**Gate 4–7 — Data modernization, GPU/numerical, nearshore, AI** — **all DEFERRED.** No measured
limitation currently justifies entering these gates. Re-evaluate only after Gate 0 gives trustworthy
measurement.

---

## SECTION 19 — HIGHEST-LEVERAGE REPAIR MISSIONS

| # | Mission | Root cause | Symptoms removed | Risk |
|---|---|---|---|---|
| **1** | **Extend the composition-parity guard to cover the rating band** (+ correct the false "exactly three surfaces" assertion at `sim_rating.py:9-11`) | E1-02 | Makes the Critical E1-01 divergence **measurable and regression-locked**. Changes no number | **Very low** — test/registry only |
| **1b** | **UN-GATE the staleness badge that already exists** (parallel track, disjoint files) — *revised: it is not a build, it is three consumer edits. `forecastDiagnostics.js:13-15` restricts a working warning to EURO + swell layers, so it can never fire on `waves`, the default* | F-01 / S3-01 | Silent stale forecast under confident labels | **Very low** — three lines in the consumer, no physics, no new component |
| **1c** | **Make `backend-lint` able to fail** — delete `continue-on-error: true` (`ci.yml:270`); if the current violation count is non-zero, ratchet it shrink-only like `check_eslint.js` already does | F1 | A required check on `main` that cannot go red over **undefined names** | Low — measure the count first |
| 2 | Convert diagnostic globals to live accessors | F-02 | Every future misdiagnosis through them | Very low |
| 3 | **Investigate** the band-vs-point divergence with the new guard in place — isolate the sub-term. **Do not tune yet** | E1-01, F-04 | The 3.04× height / 56.9-point rating divergence | Medium — gated behind Mission 1 |
| **4** | **Move `map.triggerRepaint()` OUT of the `try` that wraps `engine.render()`** (`WebGLMarineCustomLayer.js:322-338`) | F2 §F-A4 | ⭐ **An entire "frozen animation" failure mode.** A throw in `render()` skips the repaint call and drops the self-sustaining chain — **MapLibre provides no heartbeat for custom layers**. This is the only code-level mechanism this audit found for the most-reported historical symptom | **Low — ~1 line.** Must be measured: force a throw via a kill switch, confirm the frame counter keeps advancing and the render-error counter still increments |
| 5 | Land the §17 probe suite in Playwright — **and take F2's two ADOPTs with it**: upgrade 1.60 → 1.62 and set `video: 'retain-on-failure'`; fix the GL lane (`channel:'chromium'` + GPU args) so it stops **skipping while reporting green** | testing gap | Regression blindness across 11 untested layers; **no temporal evidence at all** | Low |
| 6 | Fix the H1/10-after-cap ordering (non-monotonic served height) | E1-03 (Medium post-red-team) | +25 % ceiling breach; 10.25 m reading lower than 10.00 m | Medium — touches the height chain; needs the owner-anchor harness |

**Missions 1 and 1b precede everything** because both convert an invisible failure into a visible one
**without changing a single forecast number**, and because the detection already exists in both cases.
Mission 3 — the one that actually moves the user's number — is deliberately **gated behind Mission 1**,
since correcting a divergence you cannot measure is how this project has previously regressed.

---

## SECTION 20 — FINAL ARCHITECT VERDICT

- **KEEP** — the fixed-timestep orchestrator; the GPU resource lifecycle; abort-based cancellation;
  the capability contract; the cached-series scrubbing; the accessible control surface.
- **PROTECT** — one RAF chain; net-zero GPU resources per cycle; zero-request scrubbing; land/ocean
  channel separation. Lock each with an assertion from §17.
- **REPAIR** — F-01 (disclosure), F-02 (accessors), F-04 (grid tier), F-05 (request scope), F-06 (listeners).
- **COMPLETE** — decide the FCE tier; correct the stale authority comments.
- **CONSOLIDATE** — remove `GPUMarineLayer` (safe: never mounts); collapse three RK4 paths to one.
- **OPTIMIZE** — world-grid scope; allocation churn; duplicate asset fetch; duplicate FPS counters.
- **MODERNIZE** — only the test harness.
- **PROTOTYPE** — nothing yet.
- **DEFER** — WebGPU, JAX, Zarr/Kerchunk, neural emulation, OffscreenCanvas, memoization passes.
- **REJECT** — any rewrite of the engine loop.

### If I were personally accountable, what exact first repair would I authorize?

**Extend the composition-parity guard so it can see the rating band — and correct the false assertion
at `sim_rating.py:9-11` that "exactly three surfaces compose a rating."**

**What evidence makes that the correct first repair.** The project has exactly one binding
architectural rule: ONE FORECAST COMPOSITION. E1 measured the rating band diverging from the point
chain by up to **3.04× in height** and **56.9 rating points** *at the same coordinate*, signed both
ways — and I independently reproduced the runtime shadow of it (a fixed coordinate's rendered value
drifting monotonically with zoom, over a grid tier that is non-monotonic in zoom). **Two methods, two
sides of the API, one defect.** The reason it survived is E1-02: the guard built to enforce that rule
enumerates three surfaces and **structurally cannot see the fourth**. Every hour spent correcting the
band before that guard exists is unmeasurable and unprotected.

It is also the *smallest* defensible change: it is a registry and a test. It changes **no forecast
number, no constant, no shader, no fetch path** — so it cannot regress the height chain that three
months of work has been spent stabilising.

**What would disprove this choice.** If the band is *intentionally* a different quantity — a
cell-aggregate rather than a spot value — then it is not a composition violation at all but a
labelling one, and the correct first repair becomes renaming / re-scoping the band's published field
instead of enforcing parity. **Cheap discriminator, run it first:** check whether any surface,
tooltip or legend presents the band value as *the spot's* surf height. If yes, it is a composition
defect. If no, it is a labelling defect. Either way the guard is still the prerequisite — only the
remedy behind it changes.

Second falsifier: if `__MARINE_RENDER_HOUR_PARITY__.parity` proves false during ordinary operation
(not just genuine transitions), Mission 1b's badge would become noise and the flag itself is the
defect. **Test before building the UI** — the duty-cycle gate in `FIRST_IMPLEMENTATION_PACKET.md` §7.

**What follows:** Mission 1b (disclosure badge, parallel) → Mission 2 (live accessors) → Mission 4
(probe suite) → **Mission 3 (isolate the band sub-term — the one that finally moves the user's
number)** → Mission 5 (H1/10 ordering). Gates 4–7 stay closed until Gate 0 makes measurement
trustworthy.

> **The through-line of this audit:** every confirmed defect is a **provenance or composition**
> problem — one label covering two quantities — and **not one of them is a physics problem.** The
> physics is not the bottleneck; the bookkeeping around it is.

---

*No production source file was modified during this audit. All runtime instrumentation was
non-persistent and restored within the same call. No prior report was overwritten.*
