# WEATHER SIMULATION — COVERAGE, BLIND-SPOT AND COMPLETION-INTEGRITY AUDIT 12.2

**Independent search for missing objectives, hidden runtime paths, untested boundaries, operational
gaps, and the evidence-based path forward.**

`dev` @ `791fdf78b91a056ff95e17d2aec22487aba0c2ad` · 2026-08-13/14 · **no production source modified**

---

# SECTION 1 — EXECUTIVE: ARE WE MISSING ANYTHING?

## Verdict

> ## CRITICAL BLIND SPOT FOUND — CORRECT PATH

**Not because the platform is broken.** On every dimension this audit could measure empirically, the
system performed **better** than the registers imply: 72 of 72 layer/model/browser cells paint, 24 of
24 geography cells render including the antimeridian and 68°N, all four browser engines run in CI on
every push, the ONE FORECAST COMPOSITION serving chain has no route-level bypass, and server-side
weather readiness is genuinely well instrumented.

The correction is to the **program**, not the product.

## The blind spot, in one sentence

> **The objective program is a register of WORK. It is not a register of the SYSTEM.**

All 40 objectives and 65 canonical tasks are phrased as something to *build, fix or prove*. Nothing
enumerates what already exists and runs. The consequence is not a longer backlog — it is that
**working instruments fall out of the program, are later declared missing, and go red with nobody
reading them.**

Three independent confirmations, each measured with a paired positive control:

| Instrument | 12.0 reg | 12.1 reg | objective reg | any 12.1 file | state at HEAD |
|---|---|---|---|---|---|
| `marine-nightly.yml` / `zoomlab` — nightly optical render harness that **records `.webm`** | **0** | **0** | **0** | **0** | ⛔ **RED**, 18 of 37 runs failed |
| `/api/health/data` + `data-health-monitor.yml` — 503-capable readiness poller | **0** | **0** | **0** | 1 (a name in a list) | ✅ working, already caught a real outage |
| `useWebGLGuardrail` + `MarineParticleCanvas` / `WindParticleOverlay` — a **second renderer** and the switch into it | **0** | **0** | **0** | **0** | active, fired 5× in this audit, **0 tests** |

*Controls, same searches, same files:* `playwright` = 3 in each register · `uptime_probe` = 1 ·
`WebGLMarineLayer` = 1 · `WebGLMarineEngine` = 30 test files · `SURF_TIDE_DEPTH` = 1.

## The single most consequential fact

12.1 named as *"the single largest remaining evidence gap in the program"*:

> **"Nobody has ever seen this application render a weather field in a controlled, recorded way.
> Six audits, zero recordings."**

and made *"at least one `.webm` in a CI artifact"* condition 3 of the five that authorise another
broad audit. Measured at HEAD:

```
[zoomlab] videos: page@e7970e4ed413a5cfd3e1b1f1669c2fdb.webm
[verdict] FAIL — 22 render finding(s), 0 instrument finding(s), 387 anim frames, 156 water samples
artifact: zoomlab-nightly-31680258907  59,558,824 B  expires 2026-08-27
```

`0 instrument finding(s)` is the harness stating **the sea under test arrived, so the renderer WAS
graded** — those 22 are real optical findings, not missing-data artifacts.

**Condition 3 was already satisfied four weeks before 12.1 declared it unsatisfied.** And this is a
*loss, not a discovery*: 11.0 audited this exact workflow
(`evidence/console/S1-workflow-green-audit.md:92`) and flagged two vacuity mechanisms in it. 12.0
reduced it to one word in a list. 12.1 dropped it.

## The most important **true omission** — and the only Critical that reaches a user today

**The production surf-alert push notification asserts "perfect conditions!" from a height alone,
every 15 minutes, with the quality score sitting unread in the same dict it already fetched.**

There are two implementations. The one repaired to state quality (`routes/surf_data/alerts.py`, **8**
references to the quality helper) is a manual POST nobody calls. The one on the scheduler
(`scheduler/surf_alerts.py`, **0** references) is live — confirmed in this audit's own `/api/health`
capture:

```json
{"id":"check_surf_alerts","trigger":"interval[0:15:00]","next_run":"2026-08-14T00:42:42Z"}
```
```python
scheduler/surf_alerts.py:94   body=f"Waves are {wave_height_ft:.1f}ft - perfect conditions!"
scheduler/surf_alerts.py:111  body=f"Waves are {wave_height_ft:.1f}ft - Go get some!"   # WEB PUSH
```

`CLAUDE.md` names this surface explicitly and states the failure directly: *"A size without a quality
is also incomplete: a blown-out 6 ft and a groomed 6 ft must not render identically."* **They render
identically.**

**And the regression guard passes**, because `test_surf_alert_states_the_quality.py:105` opens one
hard-coded path — the file that is *not* scheduled. The assertion is excellent; **the census is the
defect.**

⚠️ **It is not the only consumer in that state.** An independent sweep found
`GET /api/surf-conditions` also serves a breaking height **with no quality and no model identity**,
and it appears in no 12.0/12.1 register row. Two consumers, found by two different sweeps, both
outside the composition chain's certified consumer list — which is why the finding is scoped as
*"WS-OBJ-201's consumer census was never taken"* rather than as one defect.

## The most important apparent omission that is already covered

**Cross-browser and mobile coverage.** The E2E lane runs **all four** Playwright projects on every
push — Desktop Chrome (13), Desktop Firefox (13), Desktop Safari (28), Mobile Safari (13), with
`npx playwright install --with-deps` and no `--project` filter. **Do not open a browser-coverage
task.** (The *residue* — 100% of observed flakes are WebKit — is a different finding with a different
fix.)

## The most important untested boundary

**WebGL renderer ↔ Canvas2D fallback renderer.** Nothing states, and no test asserts, that the two
stacks agree on colour scale, units or land mask. Under ONE FORECAST COMPOSITION, a second renderer
drawing different values from the same data is the visual analogue of a second forecast path. Zero
test files reference either fallback component.

## The most important operational gap

**`dev` has no branch-protection object at all** (`gh api …/protection` → HTTP 404). **401 of 595
commits in 14 days** pass the live `buildFilter` and deploy the single production backend — ~29/day —
with **no required status check**. CI runs *beside* the deploy, not in front of it. The finding is
not "a bad deploy is likely" (three consecutive audits record zero code regressions) but that **no
mechanism exists to make one less likely.**

## The most important scientific gap

**The validation estate grades the model's offshore INPUT; the one instrument that grades the served
nearshore OUTPUT is empty, cannot refuse, and is read by nothing.** Live, 2026-08-14:

```json
GET /api/weather/report-calibration
{"available": true, "n_reports": 0, "n_archive": 60000,
 "summary": {"star_mae": null, "height_mae_m": null, "height_n": 0}}
```

**60,000 archived nearshore predictions — the archive is at its hard cap — validated against
nothing.** Its only consumer is a read-only diagnostic route; the gate that *can* page never
references it; and three silent-zero paths (missing Supabase credentials with **no log at all**, an
HTTP failure, a genuine drought) render identically.

## The most important user-facing gap

The surf alert above. Everything else in this audit that touches a user is bounded by
**`WS-CAN-0039`: production has served a 2026-05-20 artifact for 85 days.**

## Is the 12.1 critical path still valid?

**It is not wrong — it is spent.** Its authorised mission (`WS-CAN-0061`) and its named successor
(`WS-CAN-0027`) both shipped, along with `WS-CAN-0010`, `WS-CAN-0063` and `WS-CAN-0014`, in the seven
commits since 12.1 published. Two of its single-point blockers rest on premises that are false at
HEAD — `WS-CAN-0037` ("no headed harness exists") most of all.

## Exact next mission

**`WS-CAN-0066` — make the surf alert that actually runs state the quality**, and make its guard
*discover* its census instead of naming one file. Full scope in
`NEXT_AUTHORIZED_EXECUTION_MISSION.md`. Three unread artifacts run **in parallel** (zero production
change, two expiring 2026-08-27).

---

# SECTION 2 — BASELINE AND SCOPE

Full detail: `CURRENT_BASELINE_MANIFEST.md`.

| | |
|---|---|
| Branch / HEAD | `dev` / `791fdf78` |
| 12.1 publication commit | `3f83bbdb` — **7 commits back** |
| Working tree | clean but for 2 pre-existing dirty cache files, untouched by this audit |
| Backend | `2.0.0-stage-6f-v1-172f66aa`, healthy, 23,124 products |
| Dev frontend | SW `791fdf78` = **HEAD exactly** |
| Production frontend | SW `3bd38a83` — **85 days behind** |
| Reports reviewed | Audits 11.0, 11.1, 11.2, 11.4, 12.0, 12.1 in full; both canonical task registers; the objective register; the SOTA contract; the governance rules |
| Commits reviewed | 7 since 12.1; 595 in the 14-day deploy window |
| **Runtime surfaces inventoried** | **412** across 15 independent area sweeps |
| **Candidate gaps raised, then adversarially verified** | **131** — each required to survive four checks: does the proof reproduce at HEAD · does an existing row cover it under different words · is it a symptom of a tracked task · did it ship in the last seven commits |
| **Verdicts** | **64 CONFIRMED · 28 PROOF_FAILED · 24 NEEDS-EXPANSION-ONLY · 7 ALREADY-COVERED · 4 SYMPTOM-OF-TRACKED-TASK · 4 OUT-OF-SCOPE** — **67 of 131 (51%) killed or downgraded.** Authoritative record incl. every refutation: `evidence/VERIFIED_CLAIM_LEDGER.csv` |
| Sweep saturation | **not demonstrated.** An interim reading of this audit's own data showed the confirmed count flat at 53 across ~20 verdicts and I recorded that as convergence; the final 18 verdicts added **11 more confirmed**. It was a plateau, not a ceiling — the same "a quiet window is not an absence" error this audit criticises elsewhere, made on its own instrument. **A deeper sweep would find more.** |
| Apparent concerns positively identified as already covered | **185** — `evidence/ALREADY_COVERED_LEDGER.csv` |
| Tests run | none authored; CI + E2E read **for content**; this audit's own read-only browser probes |
| **Browsers/devices tested by this audit** | Chromium desktop (1280×800 DPR 1) · Chromium mobile (390×844 DPR 2, touch) · **Firefox desktop** — each with video, screenshots, console/network capture and a WebGL capability census |

### Evidence limitations, disclosed

- **This audit's Chromium probe rendered in SwiftShader software GL.** Its 1–3 FPS measures the
  runner, not the product. On the same host, the **Firefox** probe reported
  `ANGLE (NVIDIA, GeForce GTX 980)`, `maxTextureSize 16384` vs Chromium's `8192` — the two engines
  took different GPU paths on identical hardware.
- **Firefox's first run failed on my harness's 30 s navigation default, not on the app.** Positive
  control: Firefox reached `/` in 13.7 s and `/auth` in 46.6 s, both HTTP 200. The re-run at a 120 s
  budget completed fully.
- **No WebKit binary** is installed for Playwright 1.60 locally, and installing one is a dependency
  change this audit is forbidden from making. WebKit coverage comes from CI.
- **Every frontend reading is against `dev`.** Production is 85 days older.
- No sustained-load run; the live telemetry window is 1 h 30 m of uncontrolled traffic.

---

# SECTION 3 — ACTIVE SYSTEM SURFACE INVENTORY

Full data: `ACTIVE_SYSTEM_SURFACE_INVENTORY.csv` (**412 rows**); per-area raw inventories in
`evidence/source-inventory/` (15 files, ≈470 KB).

**412 runtime surfaces inventoried, classified by the weakest link in their traceability chain:**

| Chain status | Surfaces | Share |
|---|---|---|
| **Complete** | **134** | 32.5% |
| **Missing Objective** | **95** | 23.1% |
| Missing Test | 48 | 11.7% |
| Missing Contract | 33 | 8.0% |
| Missing Task | 27 | 6.6% |
| Missing Observability | 22 | 5.3% |
| Missing Runtime Evidence | 21 | 5.1% |
| Missing Owner | 16 | 3.9% |
| Conflicting Chain | 11 | 2.7% |
| Missing Recovery | 5 | 1.2% |

⚠️ **How to read this, and how not to.** Each row is classified by its *weakest* link, so the counts
do not sum to independent defects — a surface counted under "Missing Objective" may also lack a test.
And **"Missing Objective" is not 95 pieces of work.** The large majority collapse into the small
number of *classes* in `MISSING_OBJECTIVE_REGISTER.csv` — 197 untested runtime overrides are one
class, not 197 tasks. **A large raw count here is a symptom of poor normalization, and the register
is deliberately 6 rows.**

The signal that matters is the *shape*: **the single largest category after Complete is "the surface
runs and no row in the program names it"** — which is the audit's structural finding, arrived at
independently by 15 sweeps that did not share notes.

| Category | Scale measured | Surfaces missing objective **or** task |
|---|---|---|
| **User-facing** | 12 selectable layers, 3 models, 3 control layouts, timeline, legends, infobox, cursor sampling | the two binding UI mandates have no objective at all |
| **Data** | 88 modules in `backend/services/weather_pipeline/` (30,817 LOC); 51 tracked routes live; 2 tile providers; 1 analytics provider | **PostHog**, both tile providers' quotas |
| **Processing** | normalizer, interpolation, derived fields, masks, bathymetry, 2 web workers | — |
| **Rendering** | 293 files in `components/map/` (64,429 LOC with `engine/`); MapLibre custom layers; **2 WebGL engines + 2 Canvas2D fallbacks** | **the entire Canvas2D fallback stack** |
| **State / lifecycle** | **261** `window.__RAW_*`/`__OM_*` overrides in 143 files; 2 persistent `localStorage` renderer overrides | **256 of the 261** |
| **Infrastructure** | **27** GitHub workflows; 17 in-process scheduler jobs; Render + Netlify + Supabase | **18 of 27 workflows**; the in-process scheduler as a capacity surface |

**Scale note:** the frontend weather estate is 64,429 non-test LOC with 134 test files in
`components/map/` alone; the backend weather pipeline is 30,817 LOC against 496 test files in
`backend/tests/`. **This is a well-tested codebase.** The gaps below are not a testing-culture
problem — they are a *census* problem.

---

# SECTION 4 — COMPLETENESS TRACEABILITY

Full graph: `COMPLETENESS_TRACEABILITY_GRAPH.md`.

| Classification | Count |
|---|---|
| Complete | 5 |
| Complete, but **missing objective** | 1 |
| **Missing Objective and/or Task** | **6** |
| Missing Test | 5 |
| **Missing Observability — a *reader*, not an instrument** | **4** |
| Missing Recovery | 2 |
| Conflicting Chain | 1 |
| Unable to Determine | 4 |

**Every broken chain breaks at one of three links: Objective/Task, Test, or Observability.** Data
correctness, projection, normalization, cancellation and composition all trace cleanly — the six
audits of engineering effort are visible in the graph.

**The third link is the new one.** The prescribed chain has no position for *who reads the output*,
and that is exactly where this platform fails: three chains are green all the way to Runtime Evidence
and still worthless.

---

# SECTION 5 — NEGATIVE-SPACE FINDINGS

Full detail with proofs and controls: `NEGATIVE_SPACE_FINDINGS.md`. Ten instances, of which six are
Confirmed Omissions. **This audit also refuted two of its own findings**, recorded in the same file —
`/api/health` "blindness" (killed by `/api/health/data` twelve lines further down the same file, an
executed control, and a 30-minute poller) and "mobile touch targets are 0 px" (killed by my own
computed-style control: they are `display:none` desktop controls, `focusable: 0`).

Both failed for one reason: **a measurement that stops at the first plausible answer is not a
measurement.**

---

# SECTION 6 — BOUNDARY CONTRACTS

Full matrix: `BOUNDARY_CONTRACT_MATRIX.csv`.

| Verdict | Notable |
|---|---|
| **Explicit and Tested** | provider→parser→normalizer (single authority, ±180 wrap, antimeridian); field→worker→main thread; GPU per-vertex projection; cache→active field identity |
| **Explicit but Untested** | zoomlab's optical budget (explicit and good — but its verdict is read by nobody) |
| **Implicit and Risky** | **WebGL renderer ↔ Canvas2D fallback** — no contract of any kind; **application ↔ 261 runtime overrides** — no default assertion, no expiry; **serve box ↔ ingest lane env flags** — the guard exists and cannot see the lane |
| **Contract Missing** | `scheduler/surf_alerts.py` → notification body (the mandate names the surface; the code does not honour it); push `notificationclick` → `/map?spot=` (**nothing reads that parameter** — control: ~20 files elsewhere use `useSearchParams`) |
| **Conflicting Contracts** | the two alert implementations |
| **Unable to Verify** | deployment configuration → runtime behaviour (`render.yaml` not applied) |

---

# SECTION 7 — HIDDEN PATHS, FLAGS, FALLBACKS, LEGACY

Full data: `HIDDEN_PATHS_FLAGS_AND_FALLBACKS.csv`.

The dominant finding is **the runtime override surface as a class**: 261 globals, 143 files, **197
with no test**, **5** visible to the program, essentially no `NODE_ENV` gating (one guard exists in
the whole map directory, and it gates an error-boundary detail panel).

⚠️ **Two independent counts, both reported, because the corpus differs and mixing them would
manufacture a number.** Mine: **261** distinct `window.__RAW_*`/`__OM_*` names in *non-test*
`frontend/src` (`--exclude=*.test.js`). An independent sweep, over a wider corpus and classifying by
mechanism, found **337** names of which **255 are externally settable** and **26 are default-OFF
behavioural gates**. The two are consistent under their different definitions. **The 26 default-OFF
behavioural gates are the subset that most resembles WS-OBJ-402's three dual paths — and it is 26,
not 3.**

Two of them change a **displayed forecast quantity**:

```js
marineEngineDecisions.js:113  __RAW_RATING_SPAN_FADE_HI__  (default 9.5)
WebGLMarineEngine.js:1656     __RAW_BLEND_HEIGHT_HI__      (default 1.4)
```

The sharp irony: **SOTA B12 scores ✅ MET** for kill-switch discipline — *"the program's strongest
habit"* — and that habit is what produced 261 ungoverned globals. **B12 grades that a kill switch
exists; nothing grades that one is ever removed, tested or reported.**

Plus: two **persistent** `localStorage` renderer overrides with no reset path; a stale
`render.yaml` warning I nearly filed as Critical; and `python-upgrade-readiness.yml`, which has
**never executed** and carries six `continue-on-error: true` steps.

---

# SECTION 8 — TEST-COVERAGE REALITY

Full matrix: `TEST_COVERAGE_REALITY_MATRIX.csv`. CI read for content, per governance rule 15:

```
backend estate : collected 1779 tests across 150 files -> 1712 passed, 67 skipped, 0 failed, 0 errors
frontend jest  : Test Suites: 228 passed, 228 total · Tests: 2138 passed, 2138 total
E2E            : Running 52 tests → 42 passed · 5 skipped · 5 FLAKY
marine-nightly : [verdict] FAIL — 22 render findings
```

| Class | Instances |
|---|---|
| **Strong protection** | the composition guards, the colour-scale class guard (mutation-proven), the CI floor hook, `pngPixels` |
| **Cannot fail structurally** | `weather-simulation.spec.js:607` `test.fixme` — WS-CAN-0018/0019, unchanged |
| **Guard grades the wrong file** | `test_surf_alert_states_the_quality.py:105` — the census is one hard-coded path, and it is the unscheduled one |
| **Untested active paths** | `MarineParticleCanvas`, `WindParticleOverlay` (**0** test files; control: `WebGLMarineEngine` → 30); 197 of 261 runtime overrides |
| **Green that hides a failure class** | **`flaky`** — 17 across 6 runs, **100% WebKit**, 5 of them weather tests, workflow conclusion `success` every time |
| **A red nobody reads** | `marine-nightly`, 18 of 37 runs failed |

Governance rule 15 names three disguises a green can wear — a cancelled run, a skipped suite, a
`test.fixme`. **`flaky` is a fourth, and it is the one live at HEAD.**

---

# SECTION 9 — PRODUCT AND USER COVERAGE

Full matrix: `PRODUCT_AND_USER_COVERAGE_MATRIX.csv`.

**Core correctness** — the alert defect (§1); the model **run time has no display half** at all
(`run_time` reaches 16 client modules and telemetry and **no rendered surface**); the legend's
coarse-grid notice reads a marine diagnostic global for all 12 layers, so 8 non-marine legends can
never earn the notice and one can inherit a stale marine claim.

**Usability** — the surf-rating key prints three of its four words over the wrong colour band; the
rating key is gated on the layer while the rating colouring is not, so 4 of 12 layer states show
colour with no key.

**Accessibility** — the desktop weather panel's only expand control is a bare `div`-with-`onClick`,
keyboard-inoperable, and collapsing it unmounts the entire control surface with no keyboard route
back; the mobile sheet is a modal with no modal semantics; the rating palette has never been checked
for discriminability (worst under deuteranopia).

**Measured POSITIVE and not to be re-litigated:** all 12 layer controls are real `<button>`s with
`aria-pressed` on **12 of 12**, visible text labels (so no `aria-label` is needed), correctly
`display:none`d in the wrong layout (`focusable: 0`). **Better than the program's own 2026-07-14
debt inventory implies.**

⚠️ **Every frontend item here is bounded by the 85-day production freeze.** They are real, and no
production user currently sees them.

---

# SECTION 10 — EXTERNAL DEPENDENCY AND OPERATIONS

Full data: `EXTERNAL_DEPENDENCY_RISK_REGISTER.csv`, `DEPLOYMENT_AND_OPERATIONAL_READINESS.md`.

- **Two tile providers** in the live request stream — `map-tiles.open-meteo.com` and
  `a/b.tiles.mapbox.com`. Mapbox is token-gated; `marine-nightly.yml:47-52` hard-fails without the
  secret. **Neither quota is documented anywhere.**
- **An Open-Meteo quota is a load-bearing design constraint cited in 7 source comments across 6
  files, and counted nowhere.** An undocumented quota on a load-bearing dependency is a finding.
- **PostHog** in `frontend/public/index.html` — in no register.
- **No staging backend exists.** "dev" and "production" are the same Render service.
- `render.yaml` is **not applied**; live configuration exists only in the dashboard.
- **27 workflows: 25 green, 1 red, 1 never executed.**

---

# SECTION 11 — SECURITY AND DATA INTEGRITY

Full detail: `SECURITY_DATA_INTEGRITY_AND_SUPPLY_CHAIN.md`. **No immediate security blocker in the
weather feature.** No credential value appears in any 12.2 artifact.

Two items for the owner: complete first-party source is published via source maps on **both** deploys
including HEAD (4.8 MB `main.js.map`, HTTP 200 — severity **LOW**, deliberately downgraded, and it is
also what makes a production stack trace legible); and the git-tracked
`forecast_cache/*.json` acts as a **live serving fallback**, which belongs in `WS-CAN-0017`'s surface
list. Service-worker cache poisoning was **refuted**, and the SW caches **no** weather response
(control: `api/surf-spots` → 3, `api/weather|conditions` → 0).

---

# SECTION 12 — SCIENTIFIC COVERAGE

Full detail: `SCIENTIFIC_COVERAGE_COMPLETENESS.md`. The §1 headline in full there.

Beyond it: **no variable other than significant wave height is validated against an observation** —
not wind, air temp, pressure, precipitation, water temp, period, direction, secondary swell or wind
waves. **The accuracy estate is partitioned by height band, lead and model — never by geography**, so
a regional failure is invisible, and the program's largest measured accuracy lever (0.25° coverage
expansion) is a *regional* decision being made with no regional error signal. **Temporal interpolation
is never measured**, though interpolated frames are served through the full chain. Grid orientation
remains unverified **in both directions** (SOTA A5, `WS-CAN-0028`, four audits).

**This audit's own 72/72 and 24/24 pixel results grade reachability and rendering, never value
correctness.** A wrong-but-colourful field passes every oracle used here.

---

# SECTION 13 — PERFORMANCE, CAPACITY, STORAGE, COST

Full detail: `PERFORMANCE_CAPACITY_AND_COST_GAPS.md`. **No monetary figure is invented.**

Measured: `peak_rss 1231.6 MB` of a **2048 MB** cgroup limit (a genuinely good `ru_maxrss`
instrument — note the 2026-07-24 incident was on a **512 MB** box, so cross-machine comparisons are
invalid). `/api/conditions/batch`: **11 of 11 sampled calls over 10 s**, max 36.0 s — third
consecutive audit. **`/api/weather/grid_series`: 4 of 22 over 10 s** — so `WS-OBJ-302`'s
*"one route"* framing is an undercount; the population is two.

Unmeasured and material: **concurrent-user behaviour.** One backend, one process, 17 in-process
scheduler jobs, one route occupying it for 36 s, no measured concurrency limit or queue. An agent's
claim that *"nothing bounds concurrency"* was **PROOF_FAILED** — so the question is genuinely open in
both directions, which is worse than a known answer.

---

# SECTION 14 — STATE-OF-THE-ART OMISSIONS

Full matrix: `STATE_OF_THE_ART_OMISSION_MATRIX.csv`. The target contract's Tier 1/2/3 structure is
sound and should be preserved. Four omissions from the contract itself:

| Capability | Class |
|---|---|
| **An instrument's output has a named reader** | **Missing core requirement.** No SOTA row asks it. Three chains are green to Runtime Evidence and fail here |
| **Runtime configuration is reportable** | **Missing SOTA core capability.** B5 lists model/time/cache/worker/renderer state; it does not list *which overrides are set*, without which a client cannot be reconstructed |
| **Automated degradation is disclosed to the user** | **Missing core requirement.** The platform silently swaps renderers; no row covers progressive-degradation *disclosure* |
| **Validation covers the SERVED quantity, not only the model input** | **Covered but under-specified.** B7 is MET on offshore Hs. Correct its scope; do not revoke it |

Deliberately **not** added: WebGPU, Zarr/Kerchunk, SWAN/FVCOM, learned downscaling. Their
prerequisites are unchanged, and this audit strengthens the case against them — **the platform's
problem is not capability, it is that existing capability goes unread.**

---

# SECTION 15 — MISSING OBJECTIVE AND TASK DECISIONS

Full register: `MISSING_OBJECTIVE_REGISTER.csv` — **6 rows, deliberately small.**

**New:** `WS-OBJ-706` (register the system, not only the work) · `WS-OBJ-707` (every forecast-
rendering runtime path is enumerated and graded) · `WS-OBJ-708` (the runtime override surface is
inventoried and reportable) · `WS-OBJ-709` (both binding UI mandates have an owner) ·
**`WS-CAN-0066`** (the scheduled alert — CRITICAL) · `WS-CAN-0067` (register the optical harness and
read its red).

**Expanded, not duplicated:** `WS-CAN-0064` (+`grid_series`) · `WS-CAN-0017` (+ the git-tracked cache
fallback) · `WS-CAN-0025` (+ point `healthCheckPath` at the 503-capable endpoint) · `WS-CAN-0040`
(make it repeating) · `WS-OBJ-504` (payload carries override + fallback state) · `WS-OBJ-501` (state
that its scope is the offshore input).

**Rescoped:** `WS-CAN-0037` — from *build a frame harness* to *read the one that exists*.

**Reopened:** `WS-OBJ-705` → PARTIAL (the `flaky` class) · `WS-OBJ-201` scope (the notification
consumer was never enumerated).

**Rejected as duplicates** — full list in `DO_NOT_CREATE_DUPLICATE_WORK.md`: a browser-coverage lane
· mobile touch-target remediation · a "check the other layers paint" task · a projection task ·
making `/api/health` fail on weather (**refuted, and it would be harmful**) · a `RATING_TIDE` task
(**stale blocker, closed 2026-08-10**) · building a frame harness.

---

# SECTION 16 — UPDATED FINISH-LINE GAP MATRIX

Full data: `UPDATED_FINISH_LINE_GAP_MATRIX.csv`. Changed from 12.1 only where 12.2 evidence supports
it: **4 objectives closed** (101, 503, 506, 203) · **1 reopened** (705 → PARTIAL) · **1 scope
corrected** (201) · **4 new** (706–709) · **1 rescoped** (via WS-CAN-0037) · **6 expanded**.

No fabricated completion percentage. Counts by relationship are in the CSV.

---

# SECTION 17 — UPDATED CRITICAL PATH

Full detail: `UPDATED_CRITICAL_PATH.md`. **The 12.1 path is not wrong — it is spent**, and two of its
single-point blockers rest on false premises. Four of its nine Finish Line A positions closed in one
day.

| Finish Line | 12.0 | 12.1 | **12.2** |
|---|---|---|---|
| A — Reliable Baseline | 10 (implied) | 11 | **9** |
| B — SOTA Core | 15 (implied) | 14 | **12** |
| Advanced differentiation | — | — | 2 |
| Supporting / optional | 5 | 4 | 7 |

*Counted from the 44-row matrix, excluding L1 roll-ups and CERTIFIED rows. **4 closed · 4 opened ·
1 reopened · 2 scope-corrected · 5 expanded.***

> **The path is shorter than 12.1 measured it — and the largest remaining unlock is not on it at
> all.** The VERIFY lane closes or rescopes four objectives for a few hours of *reading*, touches no
> production code, and appears nowhere in the 12.1 critical path, because a path built from a
> register of *work* has no position for *reading*.

---

# SECTION 18 — PATH FORWARD

Full detail: `PATH_FORWARD_12.2.md`.

**CLOSE NOW (3):** `WS-CAN-0066` the scheduled alert ★ · `WS-CAN-0067` read the red then register the
harness · reopen `WS-OBJ-705`.
**CONTINUE:** nothing — the 12.1 mission is complete.
**VERIFY IN PARALLEL (5, zero production change):** read the zoomlab red + video ⏰ · read the WebKit
failure video ⏰ · read `__MAP_RENDER_FPS__` on hardware GL · one sustained-load run · the 27-workflow
census.
**NEXT:** the provenance visit (0005 + 0062 + the `run_time` display half) · the latency visit (0064
expanded + 0009) · the override inventory · the second renderer.
**LATER · RESEARCH · DEFER · REJECT · PRESERVE:** as listed, with `WS-CAN-0028` flagged in LATER as
**the only thing that grades whether painted values are correct.**

---

# SECTION 19 — NEXT AUTHORIZED EXECUTION MISSION

`NEXT_AUTHORIZED_EXECUTION_MISSION.md` — **`WS-CAN-0066`**, implementation-ready, with ordered steps,
a guard-first sequence (**write the census fix and watch it go red before touching behaviour**),
acceptance criteria, three stop conditions, forbidden scope, and rollback.

**Why it outranks the reading mission I first drafted:** every other finding here inherits its reach
from the 85-day production frontend freeze. The backend is current. This job fires every 15 minutes
on it. **It is the only Critical in this audit that reaches a real user today.**

---

# SECTION 20 — FINAL INDEPENDENT VERDICT

**Is anything foundational still missing from the 12+ audit program?**
**Yes — one thing.** The program tracks work, not the system. It has no instrument inventory and no
concept of a *reader* for an instrument's output. That single omission produced a lost optical
harness, a certified evidence objective that closed the second of two lanes, an unread red, an
unread failure video, and a 60,000-entry nearshore prediction archive validated against nothing.

**Which active runtime surfaces lack complete traceability?**
Six break at Objective/Task — the optical harness, the second renderer, the 261-global override
surface, the flag-lane parity class, third-party analytics, and both binding UI mandates. Four more
break at Observability with everything upstream green.

**Which boundaries remain implicit or untested?**
WebGL ↔ Canvas2D fallback (no contract of any kind) · application ↔ 261 runtime overrides · serve box
↔ ingest-lane env flags · scheduler → notification body · push `notificationclick` → a URL parameter
nothing reads.

**Which apparent gaps are already covered?**
Cross-browser and mobile E2E coverage · layer paint · projection and the antimeridian · the layer
controls' accessibility · server-side weather readiness · the ONE FORECAST COMPOSITION serving chain
· `RATING_TIDE`. All measured, all in `DO_NOT_CREATE_DUPLICATE_WORK.md`.

**Which new objective or task must be added?**
Six rows. One is CRITICAL and user-facing (`WS-CAN-0066`); one is HIGH and expiring (`WS-CAN-0067`).
The rest are structural.

**Which proposed new work should be rejected as duplication?**
Seven items, listed in §15 — including two of this audit's own findings, refuted by its own
adversarial pass.

**Are production operations, mobile behaviour, external dependencies, security, observability and
scientific validation adequately represented?**
Operations: **no** — no branch protection, no rollback runbook, 18 of 27 workflows uncensused.
Mobile: **partly** — emulation is covered in CI and here; real hardware never. Dependencies:
**no** — two tile providers and an analytics provider are unregistered, and a load-bearing quota is
counted nowhere. Security: **yes**, adequately, with two owner items. Observability: **the
instruments are adequate and their readers are not.** Scientific validation: **no** — it grades the
offshore input.

**Does the Audit 12.1 critical path remain correct?**
**Spent, not wrong.** Re-derive it; do not re-endorse it.

**What exact mission should happen next?**
`WS-CAN-0066`, with the three artifact reads in parallel.

**What work must not begin yet?**
All Tier-3 research (`WS-CAN-0046`–`0051`) — and `WS-CAN-0049`/`0051` are now *known* to have an
unmet premise, not merely an unproven one. `WS-CAN-0058` coverage expansion. Any deletion of the 261
globals — **inventory before decisions.** Any canary (`WS-CAN-0044`). Any flag flip.

---

## A governance note, and this audit's own honesty check

12.1's rules state a seventh broad audit is **not authorised** unless three of five conditions hold.
Measured: condition 3 (runtime media) **holds — and already held when 12.1 wrote it**; condition 2
(production deploy) fails at 85 days; condition 4 (an armed accuracy cycle) cannot hold before
2026-08-22; condition 1 (Gate 1) is 1 of 4 closed. **At most two of five.** Rule 5 requires that a
recommendation against commissioning a report be answered in writing before it is commissioned; that
did not happen, and this paragraph is the record.

The rule was aimed at **re-reconciliation churn**. Audit 12.2 is a different instrument — an
independent inventory of the real system, not a re-read of prior reports — and its yield is the test
of whether the exception was warranted. **The recommendation is not "run fewer audits" but "the rule
should distinguish a re-reconciliation from a coverage sweep",** with the coverage sweep permitted
only when it commits in advance to inventorying the system independently rather than re-reading the
registers.

★ And this audit is subject to its own finding. It **refuted two of its own claims** — the
`/api/health` blindness and the mobile touch targets — and **67 of 131 candidate gaps (51%) died or
were downgraded** to an adversarial pass that required each one to survive four checks: does the
proof reproduce at HEAD, does an existing row cover it under different words, is it a symptom of a
tracked task, and did it ship in the last seven commits. **Every death is recorded with its
refutation in `evidence/VERIFIED_CLAIM_LEDGER.csv`, not hidden** — a coverage audit that publishes
only its survivors has no way to be checked.

**The next artifact after this one should be a gate ledger you update, not a report you author.**
