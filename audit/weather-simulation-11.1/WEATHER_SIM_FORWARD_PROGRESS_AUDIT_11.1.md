# RAW SURF WEATHER SIMULATION — FORWARD-PROGRESS ASSURANCE AUDIT 11.1

| | |
|---|---|
| **Report** | Weather Simulation Forward-Progress Assurance Audit |
| **Version** | 11.1 (post-11.0 course-correction review) |
| **Audit date** | 2026-08-10, 21:30Z – 22:20Z |
| **Branch** | `dev` |
| **Audited commit** | `8be9dd56d4ae9ef0315e62a7247c0d9e27c28cbc` — **every static, test and science result below is anchored here** |
| **Working-tree HEAD at audit end** | `518485cf3615241937f082c12692bc75df063cd9` — **the shared tree advanced under the audit**, see below |
| **Report 11.0 baseline commit** | `c9a0e9fca53d30d8001e46fd7faebd4b73b79fbd` (2026-08-09) |
| **Commits reviewed** | **103** (`c9a0e9fc..8be9dd56`), plus the 2 that landed mid-audit (reviewed, docs-only) |
| **Working-tree status** | **Clean of my changes** — the only entry in `git status` at audit end is the untracked `audit/weather-simulation-11.1/`. **No production source code was modified by this audit.** |
| **⚠️ Baseline movement** | A concurrent session pushed `8b3a0efb` and `518485cf` to `origin/dev` **and advanced this shared working tree** during the audit. Both are docs-only for the audited subsystem (`AUDIT-2026-08-10-…md`; `render.yaml`, which the same commit documents as **not applied** to the service). **No finding in this report is affected**, but the tree is no longer at the commit named on this page. See §2.2 and `OPEN_EVIDENCE_GAPS.md` G-08. |
| **Application endpoints** | backend `https://raw-surf-antigravity.onrender.com` (production, `/api/health` version = full HEAD SHA at audit start); frontend `http://localhost:3009/map` (local dev server at HEAD) |
| **Deployed dev frontend** | `dev--rawsurf.netlify.app` SW `BUILD_VERSION = '8be9dd56'` — **equal to HEAD**, but its `/map` route redirects to `/auth`, and account creation is a prohibited action for this agent, so the deployed frontend could not be driven |
| **Browsers tested** | Chromium (in-app Browser pane) — **hidden-tab constraint applies, see §2.4** |
| **Machine** | Windows 11 Pro 26200, Node v24.14.1, local Python 3.14.4 (env-parity-flagged vs the declared 3.12) |
| **Reports reviewed** | Master Weather Simulation Report 11.0 + its 19-artifact evidence directory (Executive Recovery Brief, First Implementation Packet, Root-Cause Graph, Test Ladder, Architecture Authority Map, Software Jacobian Matrix, System Capacity Profile, Upgrade Status Matrix, Codex Verification Ledger, Commit Review Ledger, Chat & Handoff Ledger, Open Questions) |
| **Handoffs / audits reviewed** | 6 (2026-08-09-B, -C ×2, -D, -E; 2026-08-10 OOM audit; 2026-08-10 dark-fixes handoff) |
| **Live tests run** | 12 (3 controlled memory probes, 1 controlled science A/B against an isolated baseline worktree, 1 full frontend suite, 1 live browser lifecycle probe, CI/E2E/monitor census, artifact identity) |
| **Videos reviewed** | **0 — see §2.4 and `OPEN_EVIDENCE_GAPS.md` G-02.** No video was captured because no video taken in a hidden tab could support a claim. |
| **Production code modified** | **NONE.** |

---

# SECTION 1 — EXECUTIVE TRAJECTORY VERDICT

# ⚖️ **ON TRACK WITH CORRECTIONS**

**Is the project moving in the right direction?** Yes. The central bet of the 11.0 lineage — *invest
in composition, reach and measurement, not in new technology* — is paying off, and this window
produced the first hard evidence of it: **three separate instruments built in the last 48 hours each
caught a real defect they were built for, one of them catching its own author.**

**Did recent work create measurable progress?** Yes, and it was measured, not asserted: 8 of 18
Report 11.0 findings materially repaired at HEAD; the frontend suite grew 178 → **209 suites** and
1,640 → **1,949 tests**, all green on an independent rerun; `grid_series` p90 latency **32 s → 16 s**;
the E2E cancellation cascade broken and verified live; and — the most important single result —
**103 commits moved not one served forecast number.**

**Is architecture converging?** **Flat.** One genuine convergence (a fourth composition surface
enrolled in the parity guard), one genuine divergence (five new permanently-dual feature flags), and
everything else within counting noise.

**Should the next planned phase proceed?** **Not yet — one correction first.** The most consequential
repair of the window was declared complete on a measurement that could not have shown otherwise.

**Should anything be paused or rolled back?** **Nothing rolled back.** Four things paused (§16).

**Is the feature safer than at Report 11.0?** **Yes, on correctness and observability; no, on
capacity.** The forecast chain is bit-identical, three more classes of silent failure are now
visible, and one previously-unobservable defect (mixed model runs) is now caught in production. But
the serve box still spends essentially its entire memory headroom on a single client settle.

---

## 1.1 Five strongest verified improvements

1. **`run_census` shipped and immediately caught the thing it was built for.** A production
   `grid_series` response carried `distinct_runs: 2, mixed_runs: true` with run times **7.8 hours
   apart** in one scrubbable page. Report 11.0 listed this as open question **U-2** — *"mechanism
   proven; live occurrence not sampled"*, priority HIGH. **U-2 is now closed by positive
   observation.** An instrument that finds its target within a day of shipping is the strongest
   possible evidence the measurement investment is correct.
2. **Scientific correctness is bit-identical across the whole window.** A controlled A/B — isolated
   git worktree at `c9a0e9fc` vs HEAD, identical inputs, no network — returns the same five
   height/quality pairs across a 24× swell range: `3.3/68.1 · 5.8/84.5 · 17.6/84.5 · 30.6/55.7 ·
   29.5/59.8`. Four commits touched the physics/rating subsystem and none moved a served number.
3. **The JS/Python rating mirror is closed, including the green test that was defending the bug.**
   `surfRating.js:116,142` ports `MIN_SWELL_ENERGY_SHARE`, and `surfRating.test.js`'s fixture — which
   was *actively certifying* the pre-refusal behaviour — was corrected with its rationale recorded
   in-comment. A 64.6-point release blocker retired.
4. **The CI lane that was protecting nothing now protects 141 files, and caught a real regression
   within hours.** 340 of 482 backend test files were selected by no lane, including every guard on
   the box's memory bounds. The named-family widening caught `4cb9c3c6`'s stale contract the same
   afternoon.
5. **The E2E lane has an opinion again.** 26 of 40 runs were being cancelled by newer pushes — *"no
   evidence at all."* `paths-ignore` broke an 8-run cascade; the fix's own run completed **SUCCESS**
   at 17:26:51Z, the first uncancelled run since 16:01Z, and the two docs-only commits after it
   correctly fired no run.

## 1.2 Five most important unresolved risks

1. **⛔ The Render OOM root cause is reproducible at HEAD.** One global `grid_series` costs
   **+156.7 / +201.6 / +812.8 MB** resident across three replicates against verified-flat baselines,
   with peak RSS rising up to **+800.2 MB** — against a recorded post-fix claim of **+0.0 MB**. The
   client fires three per settle against ~484 MB of headroom, and live peak sits at **84.9 % of the
   2 GiB cap**.
2. **⛔ A live credential is still committed.** `BRAIN_RULES.md:200` still carries a Qdrant Cloud API
   key and its cluster endpoint. Flagged P1 in Report 11.0; unchanged. History retains it regardless
   of any future edit, so only provider-side rotation closes it.
3. **⛔ No CI green has ever proven the marine field paints.** `weather-simulation.spec.js` = 5 live
   tests, **1 `test.fixme`** (the pixel oracle, `:578`) and **6 `test.skip`**. The single largest
   test gap in the system, and the blocker was already diagnosed as a declaration rather than a
   missing GPU.
4. **⛔ A free competitor beats the product's own lane at every horizon.** Paired, at HEAD: Open-Meteo
   wins at +24/48/72 h (Δ +0.050 / +0.079 / +0.081 m, win rate 39/36/37 %, n≈790), and the `raw_surf`
   blend also loses to its own `raw_surf:EURO` member. **The accuracy gate is green throughout** —
   its population is not the product's lane.
5. **⚠️ The owner env-var one-click has been outstanding for 7 days.** None of `PREFETCH_*`,
   `MALLOC_ARENA_MAX`, `MALLOC_TRIM_THRESHOLD_` is set on the live box. `PREFETCH_CONCURRENCY` is the
   literal multiplier in the OOM fix's own *"CONCURRENCY full grids"*, so risk #1's severity is
   partly bounded by a setting no engineer can change.

## 1.3 Three regressions or negative trends

1. **The capacity claim regressed against reality** (not the code — the *belief*). `+0.0 MB` became
   `+157 to +202 MB` under controlled re-measurement. The engineering was sound; the acceptance
   criterion was not.
2. **Five new permanently-dual runtime paths** (`__RAW_*` flags 316 → **321**), each default-off and
   individually justified, none with a dated owner decision. Report 11.0's own drift criteria name
   this exactly.
3. **29 of 76 code-bearing commits landed with no test file touched** (38 %). The estate grew overall,
   but a substantial minority of behaviour changes shipped without a matching guard.

## 1.4 Three highest-leverage next actions

1. Give the `grid_series` memory bound an oracle that can fail (**Mission 1** — see
   `NEXT_IMPLEMENTATION_PACKET.md`).
2. Add `persistence` and `open_meteo_marine` **paired** rows to the accuracy monitor's RED criterion,
   so "worse than a free competitor" cannot pass a green gate.
3. Un-`fixme` the executed-GL pixel oracle.

## 1.5 The single next action authorized

> **Write `backend/tests/test_series_build_peak_memory.py`, register it in BOTH `ci.yml` list sites,
> and watch it fail at HEAD.** No production code changes. It is the smallest defensible action with
> the highest causal leverage, because it is what makes every subsequent capacity claim provable —
> and it is precisely what was missing when `+0.0 MB` was accepted.

---

# SECTION 2 — AUDIT SCOPE AND EVIDENCE QUALITY

## 2.1 Coverage

| axis | covered |
|---|---|
| Commits | 103 of 103 enumerated in `COMMIT_DELTA_LEDGER.csv`; full diffs read for every commit touching the physics/rating chain, `grid_series`, CI lane selection, the render control plane and the E2E lane |
| Handoffs / audits | 6, every claim checked against commits and runtime (`CHAT_HANDOFF_DELTA_LEDGER.md`) |
| Report 11.0 findings | **18 of 18 dispositioned**, plus 3 action-register items (`REPORT_11_RECOMMENDATION_LEDGER.csv`) |
| Test suites | frontend **209/209 suites, 1,949/1,949 tests** and backend composition guard lane **1,620 passed / 66 skipped / 0 failed** (141 files, 25 m 50 s), both rerun independently; CI at HEAD resolved **by full 40-char SHA** across all lanes |
| Models | GFS (live capacity + science probes); ICON/EURO via the monitor's per-source table |
| Layers | `waves` (live); legends/readouts by source |
| Geographies | Pipeline (science control), global + Florida bboxes (capacity control). **The 13-location projection sweep was not run** |
| Performance | server-side fully; **client-side frame behaviour not at all** |

## 2.2 Baseline status

**Known-good, with one qualifier.** The working tree is clean; CI is green at HEAD across `CI`,
`LOC Governance Check`, `Encoding Guard`, `Lighthouse CI` (17:32Z) and every scheduled lane
(`Forecast Ingestion`, `Forecast Accuracy Monitor`, `Sim Parity Monitor`, `Forecast Calibration
Census`, `Data Health Monitor`, `Precompute Spot Ratings`). Deployed backend and dev frontend both
equalled HEAD at audit start.

**Qualifier — and it is a real one.** During the audit a concurrent session pushed two commits to
`origin/dev` **and advanced this shared working tree** from `8be9dd56` to `518485cf`. Because every
push to `dev` is a production deploy, the live box also restarted twice mid-session and served three
different SHAs.

Both commits were reviewed: `8b3a0efb` edits one markdown file; `518485cf` edits `render.yaml`,
which that same commit documents as **not applied** to the service. `git diff 8be9dd56 518485cf`
touches no code the audited subsystem executes. **No finding here is affected** — every static, test
and science result is anchored to `8be9dd56`, and every live number carries the SHA it was taken at.

★ It is recorded because it is the second time in this window that a concurrent session's activity
altered an in-flight measurement — the first forced this audit to retract an inference (§2.3). The
standing rule *"concurrent sessions share this tree — stage by path"* now needs a companion:
**a concurrent session's pushes are production deploys and its checkouts move your baseline.**
(`OPEN_EVIDENCE_GAPS.md` G-08.)

## 2.3 An inference this audit made and then retracted

The first restart was read as a possible live OOM reproduction — plateau flat, one request, +157 MB,
process gone. **It is fully explained by the concurrent session's deploys at 21:32Z and 21:35Z.**
A mechanism with a competing sufficient explanation is not evidence, so the reading was withdrawn
before it entered any finding. What survives is what was measured directly: the per-request cost.

## 2.4 The hard limit on this audit

> ⛔ **Every animation, frame-rate and projection measurement in this environment is invalid, and
> this was measured rather than assumed:** `document.visibilityState === "hidden"`,
> `document.hasFocus() === false`, **0 `requestAnimationFrame` ticks in 1.5 s.** A hidden tab
> suspends rAF entirely.
>
> ★ **AN ANIMATION ORACLE MUST ASSERT ITS OWN VISIBILITY BEFORE IT ASSERTS ANYTHING ELSE.** A frame
> count of zero from a hidden tab is indistinguishable from a frozen renderer. This audit's first
> instrumented RAF census returned "0 distinct callers" and was **discarded, not reported** — the
> same discipline the rest of this report applies to everyone else's instruments.

Consequently Checkpoints 4 (animation continuity), 5 (geographic projection), 10 (soak) and most of
9's environmental matrix are **BLOCKED**, not failed. See `OPEN_EVIDENCE_GAPS.md`.

## 2.5 One instrument failure of this audit's own, recorded

The frontend suite was first run with `npx jest` directly instead of the CRA runner. Result: **207
failed suites, 23 tests** — Babel parse errors from a missing transform config. Re-run correctly:
**209 passed / 1,949 passed**. A catastrophic false red from a harness mistake. It is recorded
because the pattern — *the instrument failed, not the code* — is the dominant failure mode in this
codebase's recent history, and this audit was not exempt from it.

---

# SECTION 3 — DELTA SINCE REPORT 11.0

| axis | change |
|---|---|
| **Code** | 103 commits; 76 code-bearing, 29 docs-only. Concentrated in frontend UI (14), tests (49), docs (33), CI (9), render/GL (8), backend routes (7), marine serving (4), physics/rating (4) |
| **Architecture** | +8 map components, +1 `window.__X__` global, **+5 `__RAW_*` flags**, +1 enrolled composition surface. Net: flat |
| **Tests** | backend files 475 → **484**; frontend files 193 → **209**; CI composition lane **49 → 141 files**; e2e specs **2 → 2** |
| **Observability** | build stamps on truth/telemetry; `run_census` on every series response; live diagnostic accessors replacing lying snapshots; two of three fabricated status surfaces now measure-or-refuse |
| **Performance** | `grid_series` p90 32 s → **16 s**; wire 6.67 → **4.33–5.20 MB**; `/api/surf-spots` p50 26 s → **250 ms**; **per-request resident cost unchanged** |
| **Documentation** | 33 docs commits, including two audits and two handoffs. Two of their headline claims are contradicted by this audit (§13) |
| **Upgrade plan** | unchanged in order; one new #1 item (bound at resolution) that postdates 11.0 |
| **New dependencies** | none found |
| **Removed systems** | none |
| **New systems** | the build-time series bound; four dark behavioural flags; the E2E `paths-ignore` filter |
| **New risks** | five undated dual paths; a third memory-bounding stage with two fast paths that reach none of them |

---

# SECTION 4 — REPORT 11.0 RECOMMENDATION LEDGER

Complete in `REPORT_11_RECOMMENDATION_LEDGER.csv` — **no Report 11.0 recommendation disappears
without a disposition.** Summary:

| status | count | items |
|---|---:|---|
| **Verified Complete** | 4 | R11-02, R11-03, R11-04 (serialization), R11-18 (mechanism), + ACT-2 (clocks closed) |
| **Complete but Unvalidated** | 2 | R11-01, R11-10 |
| **Partially Complete** | 5 | R11-07, R11-08, R11-09, R11-11, R11-15 |
| **In Progress** | 1 | R11-14 |
| **Not Started** | 6 | R11-05, R11-06, R11-12, R11-13, R11-16, R11-17 |
| **Regressed** | 0 | — |
| **Wrong Direction** | 0 | — |
| **Unable to Verify** | 0 | — |

**Verified complete or better: 6 of 18. Materially advanced: 12 of 18. Regressed: 0.**

---

# SECTION 5 — BEFORE-AND-AFTER RUNTIME EVIDENCE

Full matrix in `BEFORE_AFTER_EVIDENCE_MATRIX.md`. The two decisive comparisons:

**Scientific (A):** identical machine, interpreter, inputs and call signature; baseline in an
isolated worktree. **Bit-identical on both axes across a 24× height range. Trend UNCHANGED,
confidence HIGH.**

**Capacity (B):** identical URL, host, encoding; plateau verified flat before each treatment
(0.0 MB / 40 s and +1.0 MB / 213 s).

| | pre-fix (recorded) | post-fix (**claimed**) | **HEAD (measured ×3)** |
|---|---:|---:|---:|
| RSS delta | +170.3 MB | **+0.0 MB** | **+156.7 / +201.6 / +812.8 MB** |
| peak delta | +157.1 MB | **+0.0 MB** | **+0.0† / +124.1 / +800.2 MB** |
| `vectors_before_bound` | ~390,000 | — | **450,690 / 540,828 / 525,805** |

† A high-water mark cannot rise past itself: that process's peak already stood 174 MB above the
post-request RSS.

**The discriminating control** (small arm first, so warm-cache bias runs *against* the conclusion):
small bbox 165 cells/frame → **+5.7 MB**; global bbox 966 cells/frame → **+812.8 MB**.
**142× the memory for 5.9× the cells.** It is the request.

---

# SECTION 6 — TEST LADDER REGRESSION RESULTS

Full table in `TEST_LADDER_REGRESSION_RESULTS.csv`.

- **Previously failing → now passing:** the JS mirror's counter-pinning fixture (R11-02); the E2E
  cancellation cascade; the accuracy-monitor and skill-ledger clocks (both closed).
- **Previously passing → now failing:** **none found.**
- **Unchanged failures:** the pixel oracle (`test.fixme` + 6 `test.skip`); committed credentials;
  integrity-chain checksums; the uncancellable FPS rAF loop; `/conditions/*` HTTP-200-with-error
  (6 paths).
- **New failures:** **one — T-CP1-07**, the OOM root cause reproducible at HEAD against a claim of
  closure.
- **Blocked:** all animation/geographic/soak checkpoints (hidden tab). *(The local backend guard
  lane was initially blocked and then completed: **1,620 passed / 66 skipped / 0 failed** across the
  141-file list in 25 m 50 s — skip rate 3.9 %, i.e. not hiding behind refusals. It corroborates CI
  rather than substituting for it: the repo's own checker flags this interpreter as python 3.14 vs
  the declared 3.12, 28 of 46 pins differing.)*
- **Flaky:** none observed in this audit's own runs. The E2E lane's historical flakes
  (10, all WebKit) were not re-exercised.
- **Tests that no longer reproduce the real problem:** `ratingParity.test.js:38` still passes **6 of
  12 args**, so it cannot see the class of drift it exists to catch — even though the specific
  instance is closed.
- **Tests that need replacing:** none. One needs **creating** — the memory oracle (Mission 1).

---

# SECTION 7 — ARCHITECTURE CONVERGENCE

Full ledger in `ARCHITECTURE_CONVERGENCE_LEDGER.md`.

| question | answer |
|---|---|
| Fewer active authorities? | **One fewer ungoverned rating surface** (band enrolled, 3 → 4). Otherwise unchanged. |
| Fewer renderers? | Unchanged — 1 WebGL context, 1 canvas, fallbacks still mutually exclusive. |
| Fewer RAF loops? | **No.** The `WeatherTelemetry` FPS loop still has no stored id and no cancel path. |
| Fewer data paths? | **No — one more.** A third memory-bounding stage was added; the EURO and Open-Meteo fast paths reach none of them (the fix says so itself). |
| Fewer model-specific exceptions? | Unchanged. |
| Clearer lifecycle contracts? | **Yes** — `triggerRepaint` now in `finally` on both custom layers; teardown routed through `safeDeleteTexture`; the score texture added to the dispose inventory. |
| Clearer worker contracts? | **Yes** — `onerror` and the zero-fill→null repair landed. Reply-ordering still untested. |
| Field Composition Engine more authoritative? | Unchanged (Superseded status stands). |
| Projection ownership clearer? | **No** — ~10 duplicated closed-form copies untouched. |
| OceanMask ownership clearer? | **No** — five mechanisms, three sources, unchanged (Violated). |
| Timeline ownership clearer? | **No** — R11-12 untouched. |
| Legacy paths becoming removable? | **No, and five new ones arrived.** |
| **Did anything increase entropy?** | **Yes, in exactly two places:** the third bounding stage, and the five undated flags. |

---

# SECTION 8 — INVARIANT DRIFT

Full matrix in `INVARIANT_DRIFT_MATRIX.csv` (20 historical + 6 newly-stated + 2 added here).

**Improved (4):** #7 render ownership (`triggerRepaint` in `finally` on both layers) · #12 resource
release (score texture + accounting) · #19 run mixing — **visibility** improved sharply, the defect
itself unchanged · N5 keep-earliest eviction (ledger closed with `evicted_cap=0`).

**Regressed (2):**
- **#20 horizon/tier contract** — `874ad925` proved the per-layer forecast cap is **inoperative for
  the `rain` layer**: the scrubber offers 14 days where ICON rain supports 7. The fix ships **dark**,
  so the knowledge regressed (a known-wrong horizon is served by default) while behaviour is
  unchanged.
- **N8 (new) no undated dual paths** — `__RAW_*` 316 → 321.

**Violated and unchanged (1):** #6 — exactly one ocean-mask authority. Five mechanisms, three
sources, no consolidation attempted (correctly, given the open correctness work).

**Preserved with zero drift (the important one):** **N7 ONE FORECAST COMPOSITION** — bit-identical
across 103 commits.

---

# SECTION 9 — ANIMATION, PROJECTION AND LIVE INTERACTION

| axis | verdict |
|---|---|
| Map boot / engine init | **PASS** — exactly one `engine_init` per boot (`__MARINE_CHURN__.counts`), 1 WebGL context, 1 canvas, no fallback canvas, `droppedFrameCounter: 0`, guardrail `false/false` |
| Render ownership | **PASS** — MapLibre owns the lifecycle; `triggerRepaint` now in `finally` on both layers |
| Churn-loop instrumentation | **PASS on the healthy path** — zero re-drives observed; the guardrail never tripped, so the repair is unvalidated under trip |
| Animation continuity · frame-rate independence · map attachment · zoom · pan · bearing · pitch · resize · DPR · world wrap · antimeridian · high latitude · coastal alignment · OceanMask · timeline interaction · model switching · layer switching · remount · tab visibility | **NOT MEASURED — BLOCKED.** `visibilityState: hidden`, 0 rAF ticks in 1.5 s. No claim is made in either direction. |

---

# SECTION 10 — SYSTEM CAPACITY AND PERFORMANCE DELTA

Full detail in `SYSTEM_CAPACITY_DELTA.md`.

| metric | 11.0 | HEAD | class |
|---|---|---|---|
| `grid_series` RSS / request | +170.3 MB (claimed +0.0 post-fix) | **+156.7 … +201.6 MB** | **Regressed vs claim / Unchanged vs reality** |
| `grid_series` peak RSS / request | +157.1 MB (claimed +0.0) | **+124.1 … +800.2 MB** | **Unchanged** |
| `grid_series` wire | 6.67 MB | 4.33–5.20 MB | **Improved (~25 %)** |
| `grid_series` p90 | 32 s | **16.0 s** (n=8) | **Improved** |
| `/api/surf-spots` p50 | 26 s | **250 ms** | **Improved** |
| frames per global request | 26 | 30–36 | **Improved** |
| resident plateau | 1,650–1,706 MB | 1,563.6 MB @4 h | Improved (modest) |
| peak % of cgroup cap | ~83 % | **84.9 %** | **Unchanged** |
| 5xx | — | **0 / 404** | Stable |
| CPU · GPU inference · allocation pressure · React commits · MapLibre repaints · cold load · throttled network · DPR 2 · mobile · soak | — | **NOT MEASURED** | — |

**The OOM arithmetic at HEAD:** plateau 1,563.6 MB, headroom ~484 MB, three pages per settle ×
156.7 MB = **470 MB**. Improved from clearly-negative to **marginal**, driven mostly by a lower
observed plateau rather than by a lower per-request cost.

---

# SECTION 11 — DATA AND FORECAST INTEGRITY

**Preserved, and proved rather than assumed.** The controlled A/B against an isolated baseline
worktree returns bit-identical output on both axes. Model identity, run, valid time, units,
direction convention, grid orientation, interpolation and missing-value handling were not touched by
any commit in the window, and the one composition control that spans all of them is unchanged.

**Three integrity findings, all pre-existing:**

1. **Mixed runs are served, and now we can see it.** `run_census: {distinct_runs: 2, mixed_runs:
   true}` spanning 7.8 hours in one response. The disclosure is new and working; the mixing is not
   repaired.
2. **`CLAUDE.md`'s documented sim control is stale on the quality axis.** Heights reproduce exactly;
   every quality figure is 1.3–2.0 points high — **at HEAD *and* at the 11.0 baseline**, and
   independent of `allow_reference_lookup`. The drift predates this window. It is a landmine: the
   next reader will see a false regression.
3. **Skill, paired, at HEAD.** We beat persistence by 0.017 m (win rate 51 % — a coin flip). We
   **lose** to Open-Meteo at all three horizons and to our own EURO member. `raw_surf:ICON` carries
   a +0.143 → +0.191 m warm bias. **The gate is green throughout.**

> ★ **The 08-10 audit's "the forecast is losing to persistence / negative skill" headline is
> REFUTED** — by the paired control the very next commit (`60f724d0`) shipped. It compared two
> unpaired columns over different populations, which is the exact sign-inversion that commit was
> written to fix, applied to the Open-Meteo row and never swept back to the persistence one.
> **A retraction habit is not yet a retraction *sweep*.**

---

# SECTION 12 — SOFTWARE JACOBIAN DELTA

Full table in `SOFTWARE_JACOBIAN_DELTA.csv`.

**Unexpected couplings removed:** guardrail-flip × backstop re-drive (structurally decoupled at two
seams) · docs commit × E2E coverage (`paths-ignore`, verified live) · docs commit × production
deploy (closed out-of-band via the Render build filter; not verified by this audit).

**Reduced:** concurrency × peak retention (multiplier N → CONCURRENCY) · CI lane selection × guard
coverage (49 → 141 files, first catch banked) · rating mirror × `SURF_PARTITIONS`.

**Unchanged:** `grid_series` build × process high-water RSS (**declared removed, measured intact**) ·
accuracy-gate population × product lane.

**New, quantified for the first time:**
- **Global bbox × resident memory — 142× the memory for 5.9× the cells.** The dominant serving cost
  is superlinear in viewport extent and no shipped guard bounds it.
- **Tab visibility × animation scheduler** — a coupling on the *test harness*, not the product, and
  it invalidates an entire checkpoint family.
- **Unpaired per-source MAE × sign of the verdict** — a coupling on the *instrument*: comparing two
  unpaired columns can invert the answer.

**What the pattern implies:** couplings on the *product* are being removed steadily. The couplings
that survived, and the ones newly found, are overwhelmingly **on the instruments** — three of the
five most consequential findings in this audit are measurement defects, not code defects. That is
the correct problem to have at this stage, and it is also the reason Mission 1 is a test.

---

# SECTION 13 — CONFIRMED NEW REGRESSIONS

### F11.1-01 — The `grid_series` build-time bound does not bound the resident cost

- **Severity:** **HIGH** (P1) · **Confidence:** **HIGH**
- **First known commit:** `0d9149b7` (2026-08-10) — the *claim*, not the defect; the underlying cost
  predates it.
- **Runtime reproduction:** find a serve process whose RSS is ≥150 MB below its own `peak_rss_mb`;
  verify a flat plateau over ≥40 s; issue one global-bbox 48-hour `grid_series`; re-read
  `/api/health`.
- **Evidence:** `evidence/memory/T-CAP-01…03`. Three replicates: **+156.7 / +201.6 / +812.8 MB** RSS,
  peak up to **+800.2 MB**, all with `bounded_at: "build"`. Size-scaling control: small bbox
  **+5.7 MB**, global **+812.8 MB**.
- **Active source path:** `grid_series_helper.py` → `_series_build_stride` / `_apply_build_stride` →
  `series_vector_budget.stride_for`.
- **Root cause:** the bound is applied **after** each hour's `GridVector` models are materialized.
  `vectors_before_bound` is still 450 k–540 k per request. The fix's own docstring states the
  residual: *"peak retention drops from N full grids to **CONCURRENCY full grids**."* With
  `PREFETCH_CONCURRENCY` unset, that multiplier is 5. Two fast paths (EURO, Open-Meteo) reach the
  build-time bound not at all.
- **Affected:** every model/layer served through the generic per-hour loop, at wide zoom.
- **Scientific impact:** none.
- **Performance impact:** one client settle ≈ the entire memory headroom.
- **Recommended response:** **CORRECT** — Mission 1 (oracle), then Mission 2 (bound at resolution).
  **Do not roll back `0d9149b7`**; it genuinely improved wire and latency.
- **Required acceptance test:** `backend/tests/test_series_build_peak_memory.py`, with a
  small-bbox positive control and a precondition that the measured process has headroom.

### F11.1-02 — Five undated dual runtime paths

- **Severity:** LOW–MEDIUM · **Confidence:** HIGH
- **Commits:** `106f113e`, `874ad925`, `37654183`, `843f6e59`, `ecac97fc`
- **Evidence:** `__RAW_*` distinct flags 316 → 321, diffed against the baseline worktree.
- **Root cause:** each flag is a correct owner-gating decision; none carries a decision deadline.
- **Recommended response:** **CORRECT** — attach a dated owner decision to each. Not a rollback.

### F11.1-03 — 38 % of code-bearing commits shipped without touching a test

- **Severity:** LOW · **Confidence:** HIGH
- **Evidence:** 29 of 76 code commits touched no test file (`COMMIT_DELTA_LEDGER.csv`).
- **Recommended response:** **CONTINUE with monitoring.** The estate grew +25 files overall, so the
  trend is positive; the tail is the concern, not the mean.

**No correctness, scientific, projection or rendering regression was found.**

---

# SECTION 14 — VERIFIED IMPROVEMENTS

### I-01 — Run identity and the run census
**Problem:** R11-04 / U-2 — mixed model runs served with no disclosure, never observed live.
**Commit:** `7312412b`. **Before:** frames stripped `run_time`/`upstream_provider`; "which run is
this?" unanswerable. **After:** every frame carries them; the response carries a census.
**Runtime evidence:** a production response with `distinct_runs: 2, mixed_runs: true`, 7.8 h apart.
**Architecture effect:** the series lane gained the identity it lacked. **Remaining limitation:**
`run_time` is still ingest wall-clock, not the model cycle; the client page key still has no run
component.

### I-02 — The JS rating mirror
**Problem:** R11-02, 64.6-point two-sided divergence on `SURF_PARTITIONS` flip, with a green JS test
certifying the wrong behaviour. **Commit:** `9fe18414`. **Evidence:** `surfRating.js:116,142`; the
corrected fixture plus a new explicit refusal test; 4,320-row goldens green in a 1,949-test run.
**Remaining limitation:** the parity **gate** still passes 6 of 12 args.

### I-03 — CI lane coverage
**Problem:** 340 of 482 backend test files selected by no lane, including every memory guard.
**Commits:** `c7099d0a` → `6e5bf70a`. **Evidence:** lane at 141 files; first regression caught
(`4cb9c3c6` → `c4d1c7f8`) within hours. **Architecture effect:** the partition assertion now covers
the memory family. **Remaining limitation:** ~340 → still a large unselected remainder.

### I-04 — E2E signal restored
**Problem:** 26 of 40 runs cancelled — "no evidence at all". **Commit:** `00dfba86`. **Evidence:**
run `00dfba86` completed **SUCCESS** 17:26:51Z, first uncancelled since 16:01Z; the two subsequent
docs commits fired no run. **Remaining limitation:** one data point, and not yet on a code commit.
`cancel-in-progress: false` is correctly pinned *against* with the reason enforced by a test.

### I-05 — Fabricated observability retired
**Problem:** R11-08 — three status surfaces serving hardcoded numbers as measured. **Commit:**
`926d6b22`. **Evidence:** `routes/weather.py:663-686` returns `None` with an explicit pointer to the
real source; `routes/admin/system.py:486-524` reads `request_telemetry.snapshot()`.
**Remaining limitation:** `system.py:208 error_rate = 0.5  # Placeholder`.

### I-06 — Render-lifecycle hardening
**Commits:** `1073f36f` (`triggerRepaint` into `finally` on **both** custom layers), `2e20122d`
(score texture in the dispose inventory, teardown via `safeDeleteTexture`, state isolation units
0–6), `843f6e59` (Promise-as-geojson → `null` with a type-guarded resolved ref).
**Runtime evidence:** 1 context, 1 canvas, `engine_init: 1`, `droppedFrameCounter: 0`.

---

# SECTION 15 — STATE-OF-THE-ART UPGRADE READINESS

Full matrix in `UPGRADE_READINESS_MATRIX.md`.

**Ready Now:** bound `grid_series` at resolution (Mission 2, after Mission 1) · the executed-GL pixel
oracle (un-`fixme`) · baseline rows in the accuracy gate's RED criterion · the client→server
telemetry uplink · cross-fall slot sampling · the one `# Placeholder` residual.

**Ready After Current Gate:** R11-01's `force_marine_fallback` soak · true model-cycle identity ·
serve-side run-age staleness · worker reply-ordering test · canvas-hash scrub assertion.

**Benchmark First:** arming `marineCommitArbiter` (read `arb_shadow_diverge` first) · dt-normalized
advection (**and the benchmark is currently impossible — fix the harness's visibility precondition
first**).

**Premature:** WebGPU · OffscreenCanvas · worker rendering · SharedArrayBuffer. Adopting a new
rendering substrate while no executed-pixel test has ever proven the current one paints would layer
a new system on an unverified foundation.

**Reject (reaffirmed, premises re-tested):** JAX/CuPy/GPU/Numba — *the measured bottleneck is server
RSS on the serve path, and the cost scales with cells serialized, not with arithmetic* · Zarr/COG/
Kerchunk/Dask · GNN/nested grids/AMR/SWAN/FVCOM · finer bathymetry as an accuracy lever ·
**neural emulators and learned downscaling, now rejected for a stronger reason than 11.0 had: the
product's lane is 33 % behind a free deterministic competitor at +24 h, so a learned layer would
optimise the wrong term.**

**Does the current direction align with best practice?** Yes. The platform is doing what mature
forecasting systems do — measure against baselines, refuse rather than fabricate, gate changes
behind flags, and keep one composition. The gap is not sophistication; it is that two of its own
gates currently measure the wrong quantity.

---

# SECTION 16 — COURSE-CORRECTION DECISIONS

Full detail in `COURSE_CORRECTION_DECISIONS.md`.

- **CONTINUE** — the composition-guard estate · run identity + census · the widened CI lane · the JS
  mirror port · E2E `paths-ignore` · the dark-flag discipline · bit-identical science.
- **COMPLETE** — the `grid_series` bound (one more stage) · R11-01's soak · R11-04's cycle half ·
  R11-08's residual · R11-11's last two items · R11-02's 12-arg detector.
- **CORRECT** — the OOM repair's acceptance criterion · the two contradicted headline claims in
  `AUDIT-2026-08-10` · the accuracy gate's RED criterion · push discipline during live measurement ·
  dates on the five flags.
- **PAUSE** — further `grid_series` performance work (until Mission 1) · the ICON warm-bias
  correction (until the gate can catch a mistake) · all animation/dt work (until the harness can
  measure) · `SURF_PARTITIONS` (unchanged from 11.0).
- **ROLL BACK** — **nothing.**
- **DEFER** — R11-05 · R11-06 · R11-12 · R11-17 · run-age staleness · canvas-hash assertion.
- **REJECT** — the full §15 list.
- **INVESTIGATE** — OOM recurrence (owner) · the gate's headline population · the churn loop under a
  real trip · whether the marine field paints in CI · integrity-chain corruption.

---

# SECTION 17 — NEXT THREE MISSIONS

## Mission 1 — Give the memory bound an oracle that can fail *(fully specified in `NEXT_IMPLEMENTATION_PACKET.md`)*

**Objective:** one new backend test that measures what a global `grid_series` **costs**, registered
in both `ci.yml` list sites, failing at HEAD.
**Root cause addressed:** nothing in the repo measures the quantity the bound exists to control —
which is why `+0.0 MB` was accepted.
**Why it is next:** it is the smallest action with the highest leverage, and writing Mission 2 first
would produce a second unfalsifiable improvement.
**Non-goals:** no serving code, no constants, no flags, no shaders.
**Completion:** fails at HEAD with the number printed; small-bbox positive control passes;
`test_flag_lane_parity` green; sim control bit-identical.
**Gate unlocked:** **GATE D** for the capacity workstream.

## Mission 2 — Bound `grid_series` at RESOLUTION, before `GridVector` materialization

**Objective:** drive `vectors_before_bound` down to the same order as `vectors_total`.
**Root cause:** the bound is applied after each hour's full product is materialized; the residual is
`CONCURRENCY` full grids plus the allocator high-water of ~500 k short-lived models.
**Files:** `grid_series_helper.py`, `series_vector_budget.py` (`stride_for` is already the shared
expression — reuse it, do not add a second).
**Non-goals:** do not touch the end-stage `apply_vector_budget` (still the only bound on the EURO and
Open-Meteo fast paths); do not change `PREFETCH_CONCURRENCY` in code (env, owner).
**Regression risk:** MEDIUM — it changes which cells are served. Requires the frame-count and
stride-parity goldens plus the sim control.
**Rollback:** the existing kill switch, plus the end-stage budget as the backstop.
**Completion:** Mission 1's test goes green and is promoted to `strict`.
**Gate unlocked:** **GATE E (capacity).**

## Mission 3 — Make the accuracy gate able to fail for the right reason

**Objective:** add `persistence` and `open_meteo_marine` **paired** rows to the monitor's RED
criterion, and print the headline's own n-by-source breakdown.
**Root cause:** the gate is green (`MAE 0.152 m` vs warn 0.30) while paired comparisons show the
product lane losing to a free competitor at all three horizons. **The gate's population is not the
product's lane.**
**Why third:** every future forecast improvement will be graded by this gate; a gate that cannot
express "worse than free" cannot certify any of them.
**Non-goals:** **do not touch the ICON warm bias yet** — that is a calibration change and the
standing constraint is no calibration tuning until the gate that would catch a mistake exists.
**Completion:** the gate goes RED on today's data for the Open-Meteo comparison, and the reason is
legible in the run log.
**Gate unlocked:** **GATE B (correctness)** for the forecast-accuracy workstream.

---

# SECTION 18 — FINAL AUTHORIZATION DECISION

**Should the current implementation direction continue?** **Yes.** Root causes are closing, the
instrument layer is catching real defects — including its own authors' — the forecast chain is
bit-identical across 103 commits, and no correctness regression was found.

**What must be corrected before more modernization begins?** One thing: **the acceptance criterion
for capacity work.** A repair was recorded as eliminating a cost it did not eliminate, because the
only measurement taken could not have shown otherwise. That is a Gate-D failure, and it is cheap to
fix.

**Which workstream gets the next session?** **Capacity — starting with its test, not its fix.**

**Which should not be touched yet?** Animation and dt work (unmeasurable until the harness asserts
its own visibility); the ICON warm bias (until the gate can catch a mistake); `SURF_PARTITIONS`
(the parity detector still sees 6 of 12 args); any further `grid_series` optimisation (until
Mission 1 exists).

**What evidence would justify moving to the next upgrade gate?** Mission 1's test failing at HEAD,
then going green after Mission 2, with the sim control bit-identical and `vectors_before_bound`
within a small factor of `vectors_total`.

**What result would prove the current path is wrong?** Any of:
- the ONE FORECAST COMPOSITION control ceasing to reproduce between two commits without a registered
  science decision;
- a global `grid_series` still costing >100 MB resident **after** Mission 2 — which would mean the
  cost is not in the vector build at all and the whole mechanism is misattributed;
- the paired Open-Meteo gap **widening** while engineering effort continues to go elsewhere.

---

## GO / HOLD / ROLLBACK GATES

| gate | verdict | reasoning |
|---|---|---|
| **A — Baseline truth** | **PASS** | Clean tree; CI green at HEAD by full SHA; both deployed surfaces equalled HEAD at audit start; the science control is deterministic and reproduces from an isolated baseline worktree. |
| **B — Correctness** | **CONDITIONAL PASS** | No data/time/unit/direction/model-mixing *regression*; the composition chain is bit-identical. Conditional because mixed runs are now **observed** in production (disclosed, not repaired) and the accuracy gate is green about a different population than the product's lane. |
| **C — Lifecycle & ownership** | **CONDITIONAL PASS** | Render, RAF and worker ownership are explicit and improved; teardown verified. Conditional because the R11-01 repair has never been exercised under a real guardrail trip, and the `WeatherTelemetry` FPS loop remains uncancellable. |
| **D — Regression protection** | **FAIL** | The window's most consequential repair has **no test that can fail**, and its production acceptance measurement was structurally incapable of showing the defect. The pixel oracle remains `test.fixme`. 38 % of code commits touched no test. |
| **E — Capacity** | **FAIL** | One client settle consumes essentially the whole memory headroom; peak sits at 84.9 % of cap; the per-request resident cost is unchanged from pre-fix. |
| **F — Upgrade readiness** | **HOLD** | Phase-2 prerequisites are not complete. No premature-phase violation was found — nothing is being modernized ahead of its foundation — so this is a hold, not a fail. |

> **Gates D and E are failed. No further capacity or accuracy-affecting phase is authorized until
> Mission 1 lands.** Everything else in flight may continue.

---

## AUDIT INTEGRITY STATEMENT

**No production source code was modified by this audit.** `git status` was clean at audit start; at
audit end its only entry is the untracked `audit/weather-simulation-11.1/`. The tree's HEAD moved
from `8be9dd56` to `518485cf` because a **concurrent session** advanced it — not this audit — and the
two commits involved are docs-only for the audited subsystem. Report 11.0 and its evidence directory
are untouched. One temporary detached git worktree was created at `c9a0e9fc` inside the
session scratchpad for the controlled science A/B; the primary working tree was never checked out,
reset, stashed or cleaned. All production probes were read-only GETs — five requests in total, the
same requests a single client settle makes. No load testing was performed. No credential value is
reproduced anywhere in this report or its evidence.
