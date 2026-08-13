# RAW SURF WEATHER SIMULATION — OBJECTIVE CLOSURE & FINISH-LINE AUDIT 12.1

| | |
|---|---|
| **Report** | Objective-level program control — supersedes 12.0 as the current control document |
| **Version** | 12.1 |
| **Date** | 2026-08-13 |
| **Branch / commit** | `dev` / `9febd970ef5d39585ad2b7b8ae5a3a7e038b8df2` |
| **Audit 12.0 baseline** | `3bc776d9fe67d658ce1032bffa0ca39170771ed0` · **59 commits since** |
| **Production code modified** | **NONE.** Writes confined to `audit/weather-simulation-12.1/` |
| **Live surfaces read** | Render backend (6 read-only GETs) · both Netlify service workers · GitHub Actions run + log history · `dev--rawsurf.netlify.app/map` |
| **Scope** | Objective-level closure and finish-line readiness. Not another defect sweep |

---

# SECTION 1 — EXECUTIVE: ARE WE STILL ON THE RIGHT PATH?

## 1.1 The verdict

# ON PATH WITH CORRECTIONS

| Question | Answer |
|---|---|
| Overall trajectory | **On path with corrections** |
| Current program stage | **Late stabilization, now with working instruments.** Not consolidation, not optimization, nowhere near modernization |
| Reliable-baseline gate (A) | ❌ **NOT MET** — 8 met, 4 partial, **6 failing** of 18 criteria |
| State-of-the-art-core gate (B) | ❌ **NOT MET** — 3 met, 6 partial, **6 failing** of 15 criteria |
| Is architecture converging? | **Yes, on assurance only.** 4 responsibilities converged, **0 diverged** — and **0 of 5** ownership questions besides the accuracy criterion received a single commit |
| Is scientific trust increasing? | **Yes.** The composition chain is certified; the accuracy gate now grades the right quantity. What lags is the platform's *self-description*, not its numbers |
| Is the critical path narrowing? | **Yes — and it is longer than 12.0 described**, because 12.0 was not counting two objectives that were always on it |
| Is the program still suffering audit churn? | **Reduced but not resolved.** Six findings shipped without IDs within a day of the register being declared authoritative |
| Should the approved path continue? | **Yes.** *Composition, reach and measurement — not new technology.* Nothing found here overturns it |

## 1.2 The six answers the brief asks for

**Most important verified progress since 12.0:** the **paired accuracy gate is live and grading**.
Run `31710210215` emits `SKILL FLOOR BREACHED at +24h … [pages after 2026-08-22T00:00Z]` while
correctly staying green in its grace window. The oldest named-and-unstarted corrective action in the
program — named 2026-08-10, dropped from the lineage by 11.2 and 11.4 — is closed.

**Most important objective newly closed:** **WS-OBJ-705 (CI and E2E lane integrity)** — the first
objective this program has **opened and closed inside one audit cycle**. Five consecutive completed
green E2E runs, each `Running 52 tests · 47 passed · 5 skipped · 0 failed`.

**Most important objective still blocking completion:** **WS-OBJ-104 — release delivery.** Production
is 85 days behind HEAD. It blocks nothing technically and it blocks the *value* of everything.
Of the objectives engineering can move, **WS-OBJ-202 (`run_time` is the ingest clock)** is the worst,
because every lead-time computation downstream inherits the error.

**Most important objective that should be abandoned:** none should be abandoned. Two should be
**closed as unnecessary**: the Audit 11.3 phantom (deliberately not run, on recorded advice) and the
standalone `DO_NOT_ADVANCE_ITEMS.md` (superseded in form by the canonical register).

**Most important objective requiring a replacement approach:** **WS-OBJ-504 (client→server
telemetry).** The plan was "build the uplink". The plan is now "**fix the transport first**" —
`TruthOverlay.js:126` sends `fps: …?.gpuStats?.fps || 60`, so a measured 0 becomes a healthy 60 on
the only client→server channel in the system.

**Exact next mission:** **`WS-CAN-0061`** — read `window.__OM_URL_TRACE__.blockedDetail` at the zoom
floor and fix whichever side of the model-lock comparison is wrong. It closes WS-OBJ-101 outright.

## 1.3 The three findings that matter most

### ① Audit 12.0 authorized a mission its own repository had committed 52 seconds earlier

```
2ac9631f   2026-08-12 16:22:20 -0400   feat(accuracy): gate on the PAIRED comparison   ← WS-CAN-0026
3bc776d9   2026-08-12 16:23:12 -0400   docs(audit): weather-sim 12.0                   ← the audit
```

`2ac9631f` is the **immediate parent** of the publication commit. 12.0's register field for
WS-CAN-0026 reads `uncommitted working tree 2026-08-12 (3 files)` — false when written — and its
prescribed remaining work includes *"(2) commit + push"*, already done.

**This is the defect 12.0 diagnosed in 11.4 and then repeated.** 12.0 §1.3② is titled *"The most
recent audit authorized a mission that was already complete"* and its Rule 6 says *"before publishing
a gate verdict, re-read the evidence generated during the audit's own window."* The interval narrowed
from **22 minutes to 52 seconds**.

*Honest counterweight, and it matters:* 11.4 was **wrong about the world** — it published a FAIL its
own evidence contradicted. 12.0 was **right about the world and stale about the ledger** — its
register correctly records the code as built and tested, and correctly identifies the real remainder
as an **owner threshold decision**. The finding stands; the substance of 12.0 does not fall.

### ② The forecast deficit widened, and 12.0's counterweight is refuted

12.0 wrote: *"the gap is **narrowing** … the +24 h delta was +0.050 … it is now +0.038."*

| paired row | 12.0 (08-12) | **12.1 (08-13)** | direction |
|---|---|---|---|
| vs `persistence` +24 h | n=1790 · Δ **+0.007** · win 46% | n=**2483** · Δ **+0.015** · win **44%** | **doubled** |
| vs `open_meteo_marine` +24/48/72 h | Δ +0.038 / +0.051 / +0.063 | Δ **+0.040 / +0.052 / +0.069** | worse |
| vs `raw_surf:EURO` +24/48/72 h | Δ +0.016 / +0.003 / +0.012 | Δ **+0.023 / +0.012 / +0.024** | worse ×3 |

Samples grew ~39% in one day and **every row moved against the product or held flat**. The gate arms
on **2026-08-22** and, on this data, **pages**.

*Two things that survive as strengths:* the lane **beats persistence at +48 h and +72 h** (win 54%,
55%), so the deficit is specifically a +24 h problem; and the gate **correctly refuses** to grade the
+72 h floor on `POPULATIONS DIVERGE`. Refusal-over-fabrication is working inside the new instrument.

### ③ A fourth fabricated status surface — inside the truth layer built to prevent the other three

`frontend/src/components/map/TruthOverlay.js:126`:

```js
fps: window.__WEATHER_TELEMETRY__?.gpuStats?.fps || 60,
```

`gpuStats.fps` is `Math.round(frames × 1000 / elapsed)` — **`0` when the render is frozen**. `0 || 60`
is `60`. Three states collapse to one wire value: healthy, measured-zero, and never-sampled. And
`TruthOverlay.js:141` is, per 12.0 §I-11, **the only client→server transport in the entire system**.

The sibling read at `:307` has **no** `|| 60` and correctly yields `null`. **The surface shown to the
user refuses; the surface sent to the server fabricates.**

This is the sixth instance of what 12.0 named the program's most-repeated root cause — *a check that
cannot distinguish "not sampled" from "broken" reports success* — and the first found **inside the
repair for the other five**.

---

# SECTION 2 — AUDIT COVERAGE AND BASELINE

Full manifest: `CURRENT_BASELINE_MANIFEST.md`. Coverage delta: `AUDIT_COVERAGE_DELTA.csv`.

| | |
|---|---|
| Branch / commit | `dev` / `9febd970` |
| 12.0 baseline | `3bc776d9` · 59 commits · 48 files |
| Prior audits represented | **35 reports / 6 prompts / 551 sources**, carried from 12.0's index; no additional program-numbered audit found |
| New audits since 12.0 | **0** (correctly — 12.0 Rule 3) |
| Handoffs reviewed | **4** (`HANDOFF-2026-08-13-*` ×3, `HANDOFF-2026-08-13-the-map-layer-arc`) |
| Commits reviewed | **59 / 59**, each mapped to a task and an objective — 0 unmapped |
| Live runtime evidence | 10 artifacts (LV-01…LV-08, CF-02, SV-BUILD) |
| Backend deployed | `ba7f1c18` · healthy · 22,843 products · **0 5xx across 1,904 requests** |
| Dev frontend | SW `BUILD_VERSION = 9febd970` = **HEAD exactly** |
| Production frontend | SW `BUILD_VERSION = 3bd38a83` (2026-05-20) — **85 days behind** |

**Limitations** (full list: `OPEN_BLOCKERS_AND_EVIDENCE_GAPS.md`): no recordings, screenshots,
traces, heap snapshots or CPU profiles — the agent browser pane does not composite frames while
hidden (LV-08). No sustained-load profile. Seven register items carried from 12.0 without
independent re-verification.

---

# SECTION 3 — PROGRAM OBJECTIVE INVENTORY

**40 canonical objectives: 7 north-star (Level 1), 33 program (Level 2).** Full register:
`PROGRAM_OBJECTIVE_REGISTER.csv`. Lineage: `OBJECTIVE_SOURCE_CROSSWALK.csv`. Task mapping:
`OBJECTIVE_TO_TASK_TRACEABILITY.csv`.

| North-star outcome | Children | Finish line |
|---|---|---|
| **WS-OBJ-001** Reliable global weather & marine visualization | 101–104 | A |
| **WS-OBJ-002** Scientifically trustworthy forecast display | 201–207 | A |
| **WS-OBJ-003** Stable, bounded, high-performance runtime | 301–304 | B |
| **WS-OBJ-004** Maintainable single-authority architecture | 401–402 | B |
| **WS-OBJ-005** Objective forecast validation | 501–506 | B (prerequisite for C) |
| **WS-OBJ-006** Advanced nearshore surf differentiation | 601–605 | C |
| **WS-OBJ-007** Program truth and closure discipline | 701–705 | supporting |

**Three objectives are new — and all three always existed; none was ever tracked:**
**WS-OBJ-101** (every activated layer paints), **WS-OBJ-207** (geometry-quality disclosure),
**WS-OBJ-705** (CI and E2E lane integrity). This is the single most important structural finding of
the audit: the task register had **no notion of "a layer must actually paint"**, so when water
temperature rendered nothing on every model, there was no row for it.

Canonical tasks: **65** — all 59 of 12.0's IDs preserved, **6 opened here** (WS-CAN-0060…0065).

---

# SECTION 4 — OBJECTIVE STATUS SUMMARY

| Delivery | n | Evidence | n | Disposition | n | Finish-line relation | n |
|---|---|---|---|---|---|---|---|
| Partially Delivered | 17 | Partially Verified | 15 | Continue | 12 | Blocks SOTA Core | 14 |
| Not Started | 16 | Verified Current | 11 | Repair | 12 | Blocks Reliable Baseline | 11 |
| Fully Delivered | 4 | Verification Failed | 11 | Complete | 9 | Supporting | 8 |
| Operational | 3 | No Evidence | 3 | Defer | 3 | Blocks Advanced Diff. | 4 |
| | | | | Investigate / Preserve / Reject | 4 | Research / Optional | 3 |

**Certified complete: 3. Operational but uncertified: 3. Regressed: 0. Blocked on owner: 5.**

---

# SECTION 5 — CERTIFIED OBJECTIVE CLOSURES

Full certificates: `OBJECTIVE_CLOSURE_CERTIFICATES.md`.

| Objective | Tasks | Why closure is defensible |
|---|---|---|
| **WS-OBJ-201** One forecast composition | 0002, 0023 | The only objective where intended outcome, code, runtime, tests and a live payload all agree — and where the original defect (offshore height served as surf height, −18.7% to +92.7%) is provably absent. LV-06: 24 live spots each carrying height **and** quality **and** `reference_size_m` |
| **WS-OBJ-501** The accuracy gate grades the right quantity | 0026 | LV-03: the gate names the losing comparison, cites both agreeing statistics, discloses its own arming date, and refuses on diverging populations. Control RV-03/RV-06: 56 of 57 keys byte-identical — it changed what the gate *reports*, not what the system *computes*. Kill switch is one env var |
| **WS-OBJ-705** CI and E2E lane integrity | 0059, 0065 | LV-02: five consecutive **completed** greens, `Running 52 tests` — checked for content, not colour. At the pre-fix 18% rate, p ≈ 1.9 × 10⁻⁴. The prior session's explicit stop condition ("not on one green") is satisfied |

**Four near misses, and the clause each fails:** WS-OBJ-505 (uptime probe — *"the active runtime uses
the implementation"*: it runs nowhere) · WS-OBJ-102 (projection — *"appropriate tests exist"*:
canonical fields never run) · WS-OBJ-303 (memory — *"reproducible"*: two incomparable windows) ·
WS-OBJ-502 (regression protection — *"no bypass invalidates the result"*: a `test.fixme` still
occupies the pixel-oracle slot).

---

# SECTION 6 — OPERATIONAL BUT UNCERTIFIED

| Objective | What exists | **The exact verification that would close it** |
|---|---|---|
| **WS-OBJ-505** uptime probe | 231 LOC stdlib-only, 13 tests, three-way discrimination proven against real targets, measured timeouts | **One owner action**: create a free heartbeat URL and schedule it **anywhere that is not GitHub Actions** with `--ping-url`. A GitHub-hosted probe would reproduce the defect it exists to measure |
| **WS-OBJ-102** projection | Exact per-vertex Web Mercator, `85.051129` clamp, ≤ 0.1 km mid-cell error, 0 NaN across 7 geographies; LV-05 re-confirms 179.6°E and 64.1°N | Run **synthetic canonical fields** (uniform E/W/N/S, vortex, checkerboard) through the real render path. Row reversal and UV flip are unverified **in either direction** — the session that scoped it called this *"the largest true unknown in the system"* |
| **WS-OBJ-303** memory | Peak RSS 60.7% of the cgroup here vs 87.0% at 12.0 | **One sustained-load run.** Different traffic on different windows proves nothing either way |

---

# SECTION 7 — PARTIAL, REGRESSED AND BLOCKED

**Regressed: zero.** No objective moved backwards; no previously-fixed defect reopened. **Third
consecutive audit** to reach this conclusion — the program's strongest single property.

Two *initiatives* were **regraded** on new evidence, which is not the same thing: I-04 truth-layer
honesty (Completed → Active/Partially Validated, on the `fps || 60` discovery) and I-11 telemetry
uplink (Designed → Designed-with-a-defective-foundation).

**Partial with a named remainder** — the ten that block Finish Line A or B:

| Objective | Remainder |
|---|---|
| WS-OBJ-101 every layer paints | **one value** — `blockedDetail` at the zoom floor |
| WS-OBJ-506 measure-or-refuse | **two lines** — `system.py:208`, `TruthOverlay.js:126` |
| WS-OBJ-203 resolution | **one stamp** — `deduce_grid_resolution` exists and is called; the value never reaches the response |
| WS-OBJ-202 model-run truth | thread `cycle_dt`, add `ingested_at`, key L1 by run |
| WS-OBJ-207 geometry disclosure | make `confidence` read `geometry_readiness` |
| WS-OBJ-301 bounded lifecycle | **one `cancelAnimationFrame`** |
| WS-OBJ-302 bounded latency | one route at a ~1-minute median |
| WS-OBJ-206 one composition/hour | serve the ICON bake through the per-hour lane |
| WS-OBJ-503 runtime evidence | **one config key** — blocker cleared 08-13 |
| WS-OBJ-502 tests that can fail | complete or delete the `test.fixme` block |

**Conflicting authorities (unchanged from 12.0):** 3 accidental duplicates, 3 bypasses.
**Wrong-sequence work:** none this cycle — the one ordering decision made (0059 before 0027) was
correct and has now discharged.

⚠️ **The governance gap that matters most: no dual path has an exit condition.** The arbiter, the
settle debounce and the ICON blend sit exactly where 12.0 left them. 12.0 prescribed an action for
each and no *date*. A migration without a date is an architecture with two owners.

---

# SECTION 8 — SUPERSEDED, REPLACED, REJECTED, UNNECESSARY

Full reasoning: `STOP_DEFER_REJECT_NOT_NECESSARY.md` and `OBJECTIVE_DRIFT_AND_REPLACEMENT_LEDGER.csv`.

**Rejected (3), unchanged and not reopened:** Zarr/Kerchunk/COG/Dask · JAX/CuPy/GPU/Numba ·
SWAN/FVCOM/GNN/nested grids. Each priced against what it would replace by three independent audits.

⭐ **The crosswalk preserves the objective, not the technology** — and 12.1 supplies fresh proof the
framing was right. *"Add Zarr"* was never the task; *"reduce forecast-data access latency"* was.
The latency finding this audit adds — `/api/conditions/batch` at a ~1-minute median — has nothing to
do with storage format.

**Not necessary (2):** the Audit 11.3 phantom (deliberately not run on recorded advice — close it as
a decision, not a gap) and the standalone `DO_NOT_ADVANCE_ITEMS.md` (superseded in form).

**Replaced approach (1):** WS-OBJ-504 — "build the uplink" becomes "**fix the transport, then build
the uplink**".

---

# SECTION 9 — PROGRESS SINCE AUDIT 12.0

Full ledger: `POST_12_0_CHANGE_LEDGER.csv` — **59 of 59 commits mapped, 0 unmapped.**

| Classification | n |
|---|---|
| Verified Objective Progress | **49** |
| Local Improvement Without Objective Closure | 3 |
| No Material Objective Progress | 3 |
| Self-retracted claim (counted as regression in the ledger) | 3 |
| Implementation Activity Without Verification | 1 |

⚠️ **Read the three "regressions" precisely.** All three are *docs* commits that published a claim a
later commit in the **same session** retracted (`0d325cd2`→`7102f9cf`; `fd83074c`→`6eee749f`→
`f39e9cf5`; `bd35a92e`→`50321e08`). **None reached a deployed defect.** The program's habit of
retracting its own findings in public is a strength, and the ledger's taxonomy has no better slot
for it.

**Where the work went:**

| Task | Commits | Objective closure |
|---|---|---|
| `WS-CAN-0053` tide | **18** | none — correctly; it is an owner decision, and the work produced a harness proven able to detect a 38.1-point move |
| `WS-CAN-0065` CI floors | **11** | ✅ closed |
| `WS-CAN-0062` geometry census | 6 | none — diagnosed, never registered until now |
| `WS-CAN-0060/0061` map layers | 7 | 0060 ✅ closed · 0061 root-caused |
| `WS-CAN-0059` E2E | 3 | ✅ **certified** |
| `WS-CAN-0057` model census | 2 | held open, correctly |
| `WS-CAN-0025` uptime probe | 1 | built; not deployed |

**Blockers removed: 2** (0059 cleared 0027; 0026's engineering cleared). **Blockers created: 1**
(0063 now precedes 0020). **Tests added:** colour-scale class guard (mutation-proven), non-vacuity
guard, floor-hook tests, relative height tolerance. **Architecture convergence: 4 responsibilities.
Divergence: 0.**

**Scope drift:** the register stopped receiving findings. 24 of 59 commits map to work that had no
canonical ID until this audit.

---

# SECTION 10 — CURRENT RUNTIME VERIFICATION

Full matrix: `LIVE_OBJECTIVE_VERIFICATION_MATRIX.csv` · artifacts under `evidence/`.

**Baseline journey.** `/map` loaded at Cocoa Beach z9 on the dev build (`9febd970` = HEAD). Map
settled reading: 5 base sources, 120 layers, `areTilesLoaded: true`. **No weather source is active by
default.** ⚠️ `isStyleLoaded()` remained **false** throughout while `areTilesLoaded()` was true —
the "recurring non-attaching map state" the prior session logged, reproduced here. This matters
methodologically: the settle assertion the program prescribes (*assert `isStyleLoaded()` before
reading*) **cannot be satisfied on this surface**, so a stable-zoom/bounds signature was used instead.

⚠️ **A self-caught instrument error, recorded because the program catalogues this class:** my first
weather-source check used the regex `/om|weather|marine|wind/i` over source keys and returned `true`
— matching the substring `om` inside `c**om**posite`. `"x" in src` is never a real needle. The
corrected reading is that **no weather source was active**.

| Check | Result |
|---|---|
| **Console errors** | none captured |
| **Backend health** | 1,904 requests, **0 5xx**, 38 routes, 22,843 products, 2/2 checks pass |
| **Latency** | total p99 58.7 s; `/api/conditions/batch` **8 of 8 calls over 10 s, p50 58.7 s**; `/api/weather/point` p50 50 ms |
| **Memory** | peak RSS 1,243 MB = **60.7%** of the 2,048 MB cgroup |
| **WebGL / GPU** | `textureCount: 2`, `framebufferCount: 1`, `shaderCompileCount: 6`, ANGLE/RTX 3060 hardware accelerated |
| **RAF lifecycle** | **`activeRafCount: 1` with `activeLayers: []`** — first live confirmation of WS-CAN-0022 |
| **Scientific values** | LV-06: height + quality + reference + limiter + `why`, all present, 24/24 spots |
| **Geographic** | LV-05: Cocoa Beach, Portugal, **antimeridian 179.6°E**, **64.1°N** — all valid, `grid_parity: true` |
| **Provenance** | ❌ `run_time` identical to the microsecond across 3 tiles · ❌ `resolution: null` ×4 · ❌ `freshness_sec: 1800` ×4 |
| **Recordings / traces / profiles** | **none — the pane does not composite frames** (LV-08) |

---

# SECTION 11 — CURRENT AUTHORITATIVE ARCHITECTURE

Full map: `CURRENT_ARCHITECTURE_CONVERGENCE_MAP.md`.

| Plane | Single Verified Authority | ⚠️ Duplicate / Bypass |
|---|---|---|
| **Data** | normalization · orientation/units · spatial interpolation · storage | **product selection z8–z10 (unknown)** · **`run_time` (bypass)** · **`resolution` (bypass)** · integrity (absent) |
| **Physics** | breaking height · quality score · single write site · sim · constants | **band vs glyph (duplicate)** · **ICON >168 h (dual path)** · **geometry disclosure (new bypass)** |
| **Client state** | model/layer · fetch+commit · cancellation · caches · workers | **hour-0 (3 owners)** · **arbiter (dual path)** |
| **Render** | projection · repaint · ocean mask · cursor · **colour scales (new)** | **RAF scheduling (duplicate)** · legends (2 of 7) · **`om://` model lock (new bypass)** |
| **Observability** | request metrics · truth lineage · parity · release identity · **accuracy (converged)** · **CI floors (new)** | **`system.py:208`** · **client transport absent *and* fabricating** |
| **Release** | backend deploy · dev frontend · CI gating | ⛔ **production frontend frozen 85 days** |

**Converged this cycle: 4. Diverged: 0. Newly surfaced (pre-existing, unmapped): 3.**

---

# SECTION 12 — INITIATIVE STATUS

Full map: `CURRENT_INITIATIVE_STATUS_MAP.md`. 15 initiatives reassessed, 3 added.

**⬆ Advanced:** I-06 instrument loop → **Completed** (the largest single initiative advance in the
program's history) · I-17 CI lane governance → **Completed** (new) · I-16 layer render completeness →
**Active/Partially Validated** (new).

**⬇ Regraded:** I-04 truth-layer honesty (Completed → Active/Partially Validated) · I-11 telemetry
uplink (Designed → foundation defective).

**↔ Unchanged (10).** Including all three dual paths and every one of 12.0's remaining ownership
questions.

**The initiative that did the most work and closed nothing:** I-15 nearshore physics — **18 of 59
commits**, zero closure, **and that is correct**: what remains is an owner decision on
`SURF_TIDE_DEPTH`, and the work produced the evidence to make it.

---

# SECTION 13 — STATE-OF-THE-ART TARGET CONTRACT

Full contract with acceptance criteria: `STATE_OF_THE_ART_TARGET_CONTRACT.md`.

- **Tier 1 — Reliable core (18 criteria):** 8 met · 4 partial · **6 failing**.
- **Tier 2 — SOTA core (15 criteria):** 3 met · 6 partial · **6 failing**.
- **Tier 3 — Advanced differentiation (8 capabilities):** 1 proceed-after-measurement · 2 owner ·
  5 rejected/deferred. **None is a prerequisite for Tier 1 or Tier 2** — stating that explicitly is
  the point of the tier, because three audits' scope expansion came from treating Tier 3 as blocking.

**Already state of the art, recorded so it is not re-litigated:** range-streamed GRIB2 ingestion
(0.72% vs 16.83% of bytes) · a single normalization authority · WebGL2 custom layers with exact
per-vertex Web Mercator · refusal semantics at ~8 seams · release identity end to end · a science
registry with a ratchet · and **kill-switch-and-control-arm discipline**, which is better than
industry norm and is why the program has zero code regressions across three audits.

---

# SECTION 14 — FINISH-LINE GAP ANALYSIS

Full matrix: `FINISH_LINE_GAP_MATRIX.csv`. Counts, not fabricated percentages:

| | n |
|---|---|
| Objectives certified complete | **3** |
| Operational but uncertified | **3** |
| Partial | **17** |
| Not started | **16** |
| Blocking the reliable baseline | **11** |
| Blocking the SOTA core | **14** |
| Blocking advanced differentiation | **4** |
| Supporting | **8** |
| Blocked on owner | **5** |
| Deferred | **11 tasks** |
| Closed as unnecessary or superseded | **2 objectives / 6 task-level supersessions** |
| Rejected | **3 tasks** |

---

# SECTION 15 — CRITICAL PATH TO COMPLETION

Full graph: `CRITICAL_PATH_TO_COMPLETION.md`.

```
WS-OBJ-101 → WS-OBJ-503 → WS-OBJ-506 → WS-OBJ-203 → WS-OBJ-202 → WS-OBJ-207
  → WS-OBJ-301 → WS-OBJ-302 → WS-OBJ-206 → WS-OBJ-103 → WS-OBJ-102 → WS-OBJ-502
  → WS-OBJ-402 → WS-OBJ-104 (owner, parallel throughout)
```

**Single-point blockers:** `WS-CAN-0027` (one config key → unlocks 0037 **and** 0028 → Gate 3 → Gate
6) · `WS-CAN-0039` (one owner decision → the *value* of every frontend objective) · `WS-CAN-0033`
(→ all of Gate 7) · `WS-CAN-0063` (one line → makes 0020 safe) · the `WS-CAN-0026` threshold (→ makes
Gate 8 debatable on evidence).

**Nine tasks collapse into four visits:** three provenance tasks share one visit; two `conditions.py`
tasks share one; two measure-or-refuse sites share one.

**Four objectives can close with zero production edits** — WS-OBJ-102, 303, 205, 103. Cheapest
quadrant in the program.

---

# SECTION 16 — PROGRAM PATH FORWARD

Full detail: `PATH_FORWARD_12.1.md`. Caps observed.

**CLOSE NOW (5):** WS-CAN-0061 (the mission) · WS-CAN-0027 · WS-CAN-0063 + 0010 · adopt the 12.1
register and gate taxonomy · the 5-item owner track.
**VERIFY NOW (4), no production edits:** canonical fields · re-measure z-tier · replay failure
injection · sustained-load memory.
**NEXT (5):** 0005 · 0014 · 0062 · 0022 · 0064+0009.
**LATER:** 0007 · 0017 · 0018/0019 · 0020 · 0015 · 0037 · 0016 · 0043 · 0024 · the three exit conditions.
**RESEARCH:** 0051 · 0049 · 0050 — isolated from core capacity.
**DEFER:** 11 items, each with a named reopening gate. `WS-CAN-0058` is deferred **by one measurement
only** and should be promoted the moment it exists.
**REJECT:** 0046 · 0047 · 0048.
**PRESERVE:** 13 systems, including all three certified.

---

# SECTION 17 — NEXT AUTHORIZED MISSION

Full packet: `NEXT_AUTHORIZED_EXECUTION_MISSION.md`.

**`WS-CAN-0061` — close WS-OBJ-101: every activated layer paints.**

Every `om://` raster layer renders blank at z2–z3. Measured, controlled, one notch apart:
**z2.99 → 45 entered / 20 reached / decoded; z2.00 → 24 entered / 0 reached / 0 decoded.** Probes are
deployed; the owner ran them; the branch is **`blocked: model_lock`**.

**Step 0 is a read, not an edit:** `window.__OM_URL_TRACE__.blockedDetail`. A three-row decision table
covers the expected outcomes. ⛔ If the value matches none of them, **stop and report** — nine
hypotheses already died on these layers, every one to a measurement that was available before it was
guessed.

Chosen over the other four CLOSE NOW items because it is the only one that is neither a config key
nor an owner decision, it is **user-visible and owner-reported**, it fails Finish Line A (which must
hold before Finish Line B), and it **closes an objective outright**.

**Then `WS-CAN-0027` immediately** — ~15 minutes, named by five consecutive audits, blocker cleared
today.

---

# SECTION 18 — AUDIT AND PROGRAM GOVERNANCE

Full rules: `AUDIT_GOVERNANCE_AND_CLOSURE_RULES.md`. 12.0's ten rules stand; two are sharpened and
four are added:

- **11.** Before authorizing a mission, run `git log` on the task's files. *The disproof was not in an
  evidence file either time — it was in git.*
- **12.** A finding gets an ID **at diagnosis**, not at action.
- **13.** Every dual path carries a **dated** exit condition: **arm, or delete**.
- **14.** A "no evidence produced" disclosure must record the **mechanism**.
- **15.** A green check is read for **content**, never colour. *Zeros must never render as good news.*
- **16.** A closure claim states what it did **not** establish. *Closed-by-repair ≠ closed-by-explanation.*

**A seventh broad audit requires three of five conditions** (Gate 1 reaches CONDITIONAL PASS · a
production frontend deploy · at least one `.webm` in a CI artifact · one armed accuracy cycle after
08-22 · three or more objectives regress). Until then the correct artifact is a **gate review**.

---

# SECTION 19 — FINAL INDEPENDENT VERDICT

**Are we still following the correct path?** **Yes.** The direction three audits reached
independently — *composition, reach and measurement, not new technology* — is unchanged and better
supported than before. What needs correcting is not the path but three habits: register a finding
when you find it, date your migrations, and check git before authorizing a mission.

**Which objectives have truly been completed?** **Three, with certificates.** One forecast
composition — the program's foundation, verified live at HEAD. The accuracy gate — the oldest
unstarted corrective action in the register. CI and E2E lane integrity — opened and closed inside
one cycle. All three met the full closure standard including *the runtime uses it* and *no bypass
invalidates it*, the two clauses that failed most other candidates.

**Which only appear complete on paper?** **Truth-layer honesty**, closed by 12.0 on three real
repairs that still hold — while a fourth instance of the same defect class sat un-swept in the same
subsystem, on the only channel that leaves the device. And **the uptime probe**, which is built,
tested, proven against real targets, and running nowhere.

**Which are no longer necessary?** The Audit 11.3 phantom and the standalone `DO_NOT_ADVANCE_ITEMS`
file. Nothing else — difficulty was never accepted as a reason, and specifically the recording gap
was **not** written off even though this audit also failed to produce recordings.

**Which require a different approach?** **The telemetry uplink.** Do not lay a wire to a transport
that reports a healthy frame rate when the render is frozen.

**Which partial migrations remain dangerous?** All three — not because any is broken, but because
**none has an exit condition**. That is how a temporary fallback becomes permanent architecture, and
it is now happening on three fronts simultaneously.

**What prevents a reliable production baseline?** Five things, none of them physics: every `om://`
layer blanks at the zoom floor · `run_time` carries the ingest clock · `resolution` is null ·
degraded geometry is indistinguishable from full · one RAF has no cancel path. Plus one route at a
~1-minute median, and **production 85 days behind**.

**What prevents a state-of-the-art core?** No runtime video · frame rate unmeasurable · two
fabricated status surfaces · no dual-path exit conditions · no integrity chain · no measured capacity
envelope.

**What is optional rather than blocking?** Everything in Tier 3. Coverage expansion is the one item
worth doing soon, and it is one measurement from ready.

**Is the project stabilizing, consolidating, optimizing, or prematurely modernizing?** **Stabilizing
— and for the first time, with instruments that work.** 12.0 concluded the instruments were the
constraint. That is no longer true: the accuracy gate grades, the E2E lane runs, and a class guard
now covers every raster layer. **The constraint has moved from the instruments to the finishing.**

**What exact mission should begin next?** **`WS-CAN-0061`.** Read one value; fix one side of one
comparison; guard it. Then `WS-CAN-0027` — one config key that five audits have named and none has
written.

**What must not begin yet?** Zarr/JAX/SWAN-class work · WebGPU · AI correction · any flag flip · any
canary · the telemetry uplink · and a seventh broad audit.

---

> **The finding this audit would most want carried forward:** *a green check is read for content,
> never for colour.* Every material result here came from asking a passing thing what it actually
> did — `Running 52 tests` rather than a green tick, `over_10000ms: 8` rather than a bucketed p50,
> `git log` rather than a register field. The program's most-repeated root cause has now appeared
> six times. It will appear a seventh. **Count the tests, not the checkmarks.**

---

## APPENDIX — ARTIFACT INDEX

| Artifact | Contents |
|---|---|
| `EXECUTIVE_FINISH_LINE_BRIEF.md` | One page |
| `CURRENT_BASELINE_MANIFEST.md` | Baseline lock, environment, flags, test status |
| `AUDIT_COVERAGE_DELTA.csv` | 15 checks of 12.0's coverage against current reality |
| `PROGRAM_OBJECTIVE_REGISTER.csv` | **40 objectives × 4 status axes — the new source of truth** |
| `OBJECTIVE_SOURCE_CROSSWALK.csv` | Original wording → canonical objective, with lineage |
| `OBJECTIVE_TO_TASK_TRACEABILITY.csv` | Objective → tasks → commits → tests → evidence |
| `POST_12_0_CHANGE_LEDGER.csv` | **59 commits, 0 unmapped** |
| `OBJECTIVE_CLOSURE_EVIDENCE_MATRIX.csv` | The 13-item closure standard applied to all 40 |
| `OBJECTIVE_CLOSURE_CERTIFICATES.md` | 3 certificates + 4 explained near misses |
| `OBJECTIVE_DRIFT_AND_REPLACEMENT_LEDGER.csv` | 6 drift events, 5 replacements, 1 new dependency |
| `CURRENT_CANONICAL_TASK_REGISTER_12.1.csv` | **65 tasks — all 12.0 IDs preserved, 6 opened** |
| `CURRENT_INITIATIVE_STATUS_MAP.md` | 18 initiatives, 3 new, 2 regraded |
| `LIVE_OBJECTIVE_VERIFICATION_MATRIX.csv` | 10 live verifications tied to closure criteria |
| `CURRENT_ARCHITECTURE_CONVERGENCE_MAP.md` | Per-responsibility trend vs 12.0 |
| `STATE_OF_THE_ART_TARGET_CONTRACT.md` | 3 tiers, 41 measurable criteria |
| `FINISH_LINE_GAP_MATRIX.csv` | Per-objective gap to each finish line |
| `CRITICAL_PATH_TO_COMPLETION.md` | Dependency graph and single-point blockers |
| `RELEASE_GATE_AND_DEPENDENCY_GRAPH.md` | Gates 0–8 **+ the one-time taxonomy mapping (WS-CAN-0056)** |
| `PROGRAM_TRAJECTORY_DASHBOARD.md` | Compact current state |
| `PATH_FORWARD_12.1.md` | CLOSE NOW / VERIFY NOW / NEXT / LATER / RESEARCH / DEFER / REJECT / PRESERVE |
| `NEXT_AUTHORIZED_EXECUTION_MISSION.md` | The one authorized mission |
| `STOP_DEFER_REJECT_NOT_NECESSARY.md` | Closure register |
| `AUDIT_GOVERNANCE_AND_CLOSURE_RULES.md` | 16 rules + conditions for a seventh audit |
| `OPEN_BLOCKERS_AND_EVIDENCE_GAPS.md` | What this audit could not establish |
| `evidence/` + `artifact-manifest.csv` | LV-01…LV-08, CF-02, GV-*, SV-01 with SHA-256 |
