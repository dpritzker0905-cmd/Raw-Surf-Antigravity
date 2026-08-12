# RAW SURF WEATHER SIMULATION — AUDIT PROGRAM RECONCILIATION & ROADMAP 12.0

| | |
|---|---|
| **Report** | Audit Program Reconciliation — the authoritative program ledger |
| **Version** | 12.0 |
| **Date** | 2026-08-12 |
| **Branch / commit** | `dev` / `3ec3fd134b76013cb61cba2308b5a6c2909aec41` |
| **Working tree at close** | Clean except this audit's untracked `audit/weather-simulation-12.0/` |
| **Production code modified** | **NONE.** Two mutations were applied inside a temporary `git worktree --detach`, which was then removed; `git status` in the primary tree shows only this directory. |
| **Live surfaces read** | Render backend `raw-surf-antigravity.onrender.com` (3 read-only GETs); `dev--rawsurf.netlify.app` and `rawsurf.netlify.app` service workers; GitHub Actions run history |
| **Scope** | Meta-audit of the whole audit and upgrade program. Not another defect sweep. |

---

# SECTION 1 — EXECUTIVE: WHERE WE STAND

## 1.1 The count

| Quantity | Number |
|---|---|
| Audit **prompts** located (distinct commissioning instructions) | **6** — 11.0, 11.1, 11.2-certification, 11.3 *(drafted, never run)*, 11.4, 12.0 |
| Completed audit **reports** located | **35** (see `AUDIT_SOURCE_INDEX.csv`) |
| Of those, program-numbered audits (11.x series) | **5 documents / 5 distinct audits**, under **3 version numbers** |
| Prompt with **no report at all** | **1** — Audit 11.3 |
| Total sources indexed (repo + memory + external) | **551** |
| Byte-identical duplicate reports | **0** |
| **Same-number, different-document collisions** | **3** (see CON-04, CON-05) |
| Canonical engineering tasks | **56** |
| Verified complete and active | **9** |
| Implemented but unverified / partially verified | **9** |
| Partially implemented | **6** |
| Implemented but **inactive or shadow** | **4** |
| Not started | **36** |
| Blocked (owner or prerequisite) | **6** |
| Regressed (code) | **0** |
| Regressed (process) | **1** |
| Superseded / merged into another ID | **19 source identifiers → 56 canonical** |
| Rejected | **3** |
| Deferred | **11** |

## 1.2 The seven answers

**Is the weather simulation currently stable?** **Yes, on the axes that are measured.** Every
scheduled workflow is green at 2026-08-12 — CI, E2E, the accuracy monitor, the calibration census,
the sim parity monitor, data health, marine nightly, keep-warm. Production backend is healthy,
serving 21,678 products with **zero 5xx across 1,481 sampled requests**. The forecast chain is
untouched by the last 100+ commits. Two axes are *not* stable and are not measured as such:
**latency** (36.8% of `grid_series` requests exceed 10 s; p99 31 s) and **memory headroom** (peak
RSS 87.0% of the 2,048 MB cgroup limit).

**Is architecture converging?** **Marginally, and mostly on the truth layer.** The three findings
Audit 11.2 classified Critical on the truth layer — provenance class, parity refusal, orphaned
parity read — are **all closed and independently re-verified at HEAD**. Rendering, projection and
GPU lifecycle were already the best-engineered parts and remain so. What has *not* converged: the
ICON >168 h hour still has two live compositions; the commit arbiter still ships dark beside the
branch chain it was built to replace; the rating band and the spot glyph still answer different
questions at close zoom.

**Where is the platform in its upgrade sequence?** **Late stabilization, entering measurement
repair.** Not consolidation, not optimization, and nowhere near modernization. The distinguishing
fact of this program is that its *instruments* are now the constraint, not its code.

**Which major upgrades are genuinely complete?** Five: the ONE FORECAST COMPOSITION chain with one
write site; refusal semantics; release identity end to end (health SHA, SW stamp, and now truth /
telemetry payload stamps); the series-frame run identity and census; and the truth-layer honesty
repairs from 11.2.

**Which are still transitional?** The verdict cache (correct, guarded, shipping) beside a
settle-debounce that is deliberately default-OFF; the arbiter; the executed-GL pixel oracle that
exists but is `test.fixme`; the client telemetry uplink with both halves built and no wire between
them.

**Which upgrade path remains correct?** The one three consecutive audits reached independently:
**composition, reach and measurement — not new technology.** This audit did not overturn it. It
strengthened it, because the single most consequential thing found is a measurement defect.

**What exact task should begin next?** **WS-CAN-0026 — add the paired persistence and Open-Meteo
rows to the accuracy monitor's RED criterion.** See §18.

## 1.3 The three findings that matter most

**① The accuracy gate is green about the wrong quantity — and the product is losing.**
Scheduled run `31606511901` (2026-08-12T14:23Z) ends `verdict: OK`. In the same log, **8 of 12
paired head-to-head comparisons read `WE LOSE`**:

| Comparison | n | ours (MAE m) | theirs | Δ | win rate |
|---|---|---|---|---|---|
| vs `open_meteo_marine` +24 h | 1,770 | 0.181 | **0.143** | +0.038 | 41% |
| vs `open_meteo_marine` +48 h | 1,796 | 0.202 | **0.150** | +0.051 | 39% |
| vs `open_meteo_marine` +72 h | 1,678 | 0.215 | **0.151** | +0.063 | 38% |
| vs `persistence` +24 h | 1,790 | 0.183 | **0.176** | +0.007 | 46% |
| vs our own `raw_surf:EURO` +24/48/72 h | 1,918/1,870/1,728 | 0.184/0.201/0.215 | **0.168/0.198/0.204** | +0.016/+0.003/+0.012 | 43/46/47% |

The gate grades `height MAE 0.176 m` against `warn 0.30 / red 0.40` and passes. It does not grade
the paired rows at all. Audit 11.1 named this exact corrective action — *"Adding a persistence +
Open-Meteo row to the RED criterion is still unstarted"* — on 2026-08-10. It is still unstarted.
**The sample size has since more than doubled (790 → 1,770) and the direction has not changed.**

*Honest counterweight:* the gap is **narrowing**. At 11.1 the +24 h delta was +0.050 with a 39% win
rate; it is now +0.038 at 41%. And the product beats persistence at +48 h and +72 h. The lane has
real skill at longer leads. It does not yet have skill worth defending at +24 h.

**② The most recent audit authorized a mission that was already complete.**
Audit 11.4 publishes **Gate C (Test Integrity) = FAIL — "6 of 10 mutants survive"** and authorizes
exactly one next mission: repair the test harness so content mutations of a cache hit fail. That
harness was repaired at `ecfc1077` (12:43), **22 minutes before the audit's publication commit
`fb601060` (13:05)** — and the audit's own `MUTATION_RESULTS_FINAL_10of10.json` (M1-M7) + `MUTATION_RESULTS_ROUND2_FINAL_10of10.json` (M8-M10), shipped inside
that same commit, records all ten mutants CAUGHT.

I re-verified this independently rather than taking either document's word for it. In an isolated
worktree at HEAD I applied mutation **M9** (a cache hit returns an all-one mask) and **M8** (all-zero):

```
M9 → Tests: 2 failed, 52 passed, 54 total
M8 → Tests: 2 failed, 52 passed, 54 total
control (unmutated) → Tests: 54 passed, 54 total
```

**Gate C is PASS at HEAD.** And because 11.4's Gate I (*Next-Phase Readiness*) is recorded as
failing *"follows from C"*, its headline verdict — **NEXT ENGINEERING GATE NOT AUTHORIZED** — no
longer stands on its stated basis.

**③ In five audits the program has produced zero recordings, zero screenshots on disk, zero
Playwright traces, zero HAR captures, zero heap snapshots and zero CPU profiles.**
Every prompt from 11.0 onward required screen recording, React Scan, React Profiler, Chrome
performance tooling and memory snapshots. A file-type census of all four audit evidence
directories returns **33 `.md`, 27 `.py`, 19 `.js`, 12 `.json`, 9 `.txt`, 4 `.csv`, 1 `.sh`,
1 `.patch` — and 0 media files of any kind.** Audit 11.0 named the fix itself, calling it *"this
audit's single largest evidence gap (B-01)"*: set Playwright `video: 'retain-on-failure'`. At HEAD,
`frontend/playwright.config.js` still has `screenshot: 'only-on-failure'`, `trace: 'on-first-retry'`
and **no `video` key at all**.

To the audits' credit, every one of them *disclosed* this. 11.0: *"Recordings reviewed: ZERO."*
11.1: *"Videos reviewed: 0."* 11.2: *"no heap snapshots, no performance traces were produced."*
11.4: *"Live browser runs: 0."* Nobody claimed evidence they did not have. They simply never
closed a gap that costs one config key.

⚠️ One directory overstates itself: `audit/weather-simulation-11.0/evidence/react-scan/` contains a
single 70 KB file, `F2-state-of-the-art-2026.md`, which is a state-of-the-art research note. The
directory name asserts a tool that was never run.

---

# SECTION 2 — AUDIT PROGRAM INVENTORY

Full index: **`AUDIT_SOURCE_INDEX.csv`** (551 rows, SHA-256 per file, git introduction and
last-touch commits). Graph: **`AUDIT_VERSION_AND_DEPENDENCY_GRAPH.md`**.

## 2.1 The program-numbered audits

| # | Document | Date | Commit audited | Verdict | Report | Evidence | Packet |
|---|---|---|---|---|---|---|---|
| 11.0-a | `MASTER_WEATHER_SIMULATION_REPORT_11.0.md` (repo root, 131 KB) | 08-09 | `c9a0e9fc` | YELLOW / stable baseline | ✅ | in-report + receipts | ✅ |
| 11.0-b | `audit/weather-simulation-11.0/MASTER_WEATHER_SIMULATION_REPORT_11.0.md` (69 KB) | 08-09 | `3d3ccdc2..9f4f8570` | (recovery roadmap) | ✅ | 41-row manifest | ✅ |
| 11.1 | `audit/weather-simulation-11.1/WEATHER_SIM_FORWARD_PROGRESS_AUDIT_11.1.md` | 08-10 | `8be9dd56` | ON TRACK WITH CORRECTIONS | ✅ | 10-row manifest | ✅ |
| 11.2-fp | `audit/weather-simulation-11.2/WEATHER_SIM_FORWARD_PROGRESS_AUDIT_11.2.md` | 08-10 | `c2e83b07` | ON TRACK | ✅ | shared | — |
| 11.2-c | `audit/weather-simulation-11.2/WEATHER_SIM_CERTIFICATION_REPORT_11.2.md` | 08-11 | `e015d90b` | ⛔ NOT CERTIFIED | ✅ | 30-row manifest | ✅ |
| **11.3** | **DOES NOT EXIST** | — | — | — | ❌ | ❌ | ❌ |
| 11.4 | `audit/weather-simulation-11.4/WEATHER_SIM_POST_REPAIR_PROOF_AUDIT_11.4.md` | 08-12 | `e6033e2b` | REPAIR VERIFIED WITH CONDITIONS | ✅ | 13-row manifest | ✅ |

**Three documents carry the number 11.0** (the two above plus
`docs/research/MASTER-AUDIT-11.0-2026-08-08-…`). **Two carry 11.2.** **None carries 11.3.**

## 2.2 The wider lineage

- **`MASTER-AUDIT-{1.0 … 11.0}`** (`docs/research/`, 2026-08-03 → 08-08) — 11 reports produced from
  a *"Non-Invasive Principal Systems Architect"* prompt template, traceable across 7 sessions.
- **`AUDIT-2026-08-01…03` series** (v2–v7, MASTER-final-pass, E, F, AUDIT-OF-THE-AUDIT) — 11 more.
- **Six pre-August audits** (2026-07-03 → 07-29): weather-system, `WEATHER-SIM-MASTER-AUDIT-2026-07-10`,
  admin-panel Jacobian, theme parity, tri-tool, LOC governance.
- **Four external agent audits** (OneDrive, outside the repo): two Codex, one Opus 5 deep audit,
  one Claude 4.8 audit. `CODEX_FORENSIC_…2026-08-09.md` is Report 11.0-a's primary lead-set.
- **153 handoff reports** and **104 indexed memory entries** carrying decisions that appear nowhere
  else.

## 2.3 Referenced but not located

| Reference | Referenced by | Status |
|---|---|---|
| `WEATHER_SIM_ROOT_CAUSE_CLOSURE_AUDIT_11.3.md` | the 11.3 prompt itself (session `33778014`) | **Referenced but Not Located** |
| Audit 11.3 *Authorized Execution Mission* | the 11.4 commissioning prompt | **Referenced but Not Located** |
| Audit 11.3 *Repair Rehearsal Plan and Results* | the 11.4 commissioning prompt | **Referenced but Not Located** |
| Audit 11.3 *Experimental Patch* | the 11.4 commissioning prompt | **Referenced but Not Located** |
| Audit 11.3 *Regression Guardrail Specification* | the 11.4 commissioning prompt | **Referenced but Not Located** |

**The reason is recorded verbatim in the transcript.** At 2026-08-11T22:11:50Z, in session
`33778014` — the session that *authored* both the 11.3 and 11.4 prompts — the closing
recommendation was:

> *"On the audit question: don't run 11.3, and don't run the 11.4 I wrote you. Both would produce a
> fifth document about a system whose problems are now specifically named. You have four failing
> gates with corrective actions already written. The next artifact should be a one-page gate ledger
> you **update**, not a new report you **author**."*

11.3 was not run. 11.4 was, 16.75 hours later, and opened by discovering that its own stated
premise did not exist.

---

# SECTION 3 — AUDIT EXECUTION COMPLIANCE

Full ledger: **`AUDIT_EXECUTION_COMPLIANCE_LEDGER.csv`** (47 required actions across 6 audits).

| Audit | Actions w/ strong evidence | Partial | Not completed | Blocked | Reliability classification |
|---|---|---|---|---|---|
| 11.0-b (audit dir) | 4 | 2 | 6 | 0 | **Substantially Executed** |
| 11.0-a (repo root) | 1 | 1 | 2 | 1 | **Substantially Executed** |
| 11.1 | 5 | 0 | 3 | 0 | **Substantially Executed** |
| 11.2-c | 6 | 1 | 3 | 0 | **Fully Executed and Evidence-Backed** |
| 11.2-fp | 1 | 1 | 0 | 0 | **Substantially Executed** |
| 11.3 | 0 | 0 | 5 | 0 | **Primarily a Planning Prompt — never executed** |
| 11.4 | 5 | 0 | 3 | 1 *(Unable to Determine)* | **Substantially Executed, one stale conclusion** |

**Counts are reported but must not be read as a score.** The omissions are not evenly weighted:
"cross-browser not run" is a scope decision; "the gate matrix contradicts evidence in its own
commit" is a conclusion defect.

## 3.1 The one systemic omission

**Runtime media capture, in every audit.** Required by every prompt; produced by none. It is the
only required procedure with a **0/5** completion record, and it is the cheapest to fix
(WS-CAN-0027).

## 3.2 The three procedures executed better than the brief asked

1. **11.2's blind-first protocol.** Findings were written and **SHA-256 hash-locked**
   (`69DCAF8D…073715`, 23:24:57) *before* any prior report was read. This is the single strongest
   methodological artifact in the program.
2. **11.2's self-refutation.** It published G2-01 (*"the marine field does not render at the
   antimeridian"*) as **CRITICAL**, then refuted it with its own controls and preserved the
   superseded text rather than quietly deleting it.
3. **11.2's FPS retraction.** It discovered that `requestAnimationFrame` delivers ~1 frame per 5 s
   in an unfocused browser pane and **retracted every frame-rate reading in the program** rather
   than publishing them with a caveat.

## 3.3 The one conclusion defect

**Audit 11.4's Gate C.** Detailed in §1.3 ②, CON-01, and evidence `RV-04`. The analysis was
correct when written; the report was published without reconciling against evidence generated
during its own window and committed in its own commit.

---

# SECTION 4 — CANONICAL TASK REGISTER SUMMARY

Full register: **`CANONICAL_TASK_REGISTER.csv`** (56 tasks, three status axes each).
Lineage: **`TASK_SOURCE_CROSSWALK.csv`**.

| Implementation State | n | | Verification State | n | | Disposition | n |
|---|---|---|---|---|---|---|---|
| Not Started | 36 | | Verification Failed | 18 | | Complete Remaining Work | 20 |
| Implemented and Active | 10 | | Verified Current | 14 | | Defer | 11 |
| Partially Implemented | 6 | | No Evidence Located | 12 | | Keep as Complete | 9 |
| Implemented but Inactive | 3 | | Partially Verified | 9 | | Repair | 9 |
| Implemented in Shadow Mode | 1 | | Verified Historically, Not Current | 2 | | Reject | 3 |
| | | | Blocked | 1 | | Investigate | 2 |
| | | | | | | Preserve, Do Not Modify | 2 |

**Read the axes together.** `Not Started / No Evidence Located / Reject` (WS-CAN-0046 Zarr) and
`Implemented and Active / Verification Failed / Repair` are opposite situations that a single
status field would have collapsed. Three tasks sit at
**`Implemented but Inactive / Verification Failed / Complete Remaining Work`** — code that exists,
was paid for, and cannot currently fail (WS-CAN-0018, 0019, 0043).

---

# SECTION 5 — VERIFIED COMPLETIONS

Nine tasks are closed with evidence gathered *in this audit*, not inherited.

| ID | Outcome | Commits | Active path at HEAD | Why closed |
|---|---|---|---|---|
| WS-CAN-0001 | Marine churn loop bounded | `512b1cb6..9fe18414` | `WebGLMarineEngine.js:3199-3200`, `useMarineScrubSettle.js:91`, `weatherTruthTracker.js:428` | All three cooperating seams present: identity-guarded global clear, `webglMarineFailed` gate, `chainCancelled` terminal stage |
| WS-CAN-0002 | JS/Python rating mirror agrees across the 0.50 gate | `512b1cb6..9fe18414` | `surfRating.js:109-116,142` | `MIN_SWELL_ENERGY_SHARE = 0.50` present and enforced, mirroring `surf_rating.py:444,475`. **This retires the named release-blocker on `SURF_PARTITIONS`** |
| WS-CAN-0003 | Truth/telemetry payloads are release-attributable | `512b1cb6..9fe18414` | `weatherTruthTracker.js:8,204`; `WeatherTelemetry.js:8,282` | `BUILD_VERSION` imported and emitted on both |
| WS-CAN-0004 | Series frames carry run identity + census | `512b1cb6..9fe18414` | `grid_series_helper.py:58-63, 428-434` | Fields and `run_census` present; 11.1 records it catching a real mixed page in production |
| WS-CAN-0008 | Worker crash no longer strands the lane | `512b1cb6..9fe18414` | `useGridWorker.js:42,68` | `onerror`/`onmessageerror` set; instance re-created on next use |
| WS-CAN-0023 | Sim parity grades on the glyph's disclosed reference | `32bd579c`, `fee36d57..6568d94b` | sim parity probe; `reference_size_m` on the wire | **Live production point payload carries `reference_size_m: 1.789`**; Sim Parity Monitor green on its 2026-08-12T18:09Z scheduled run |
| WS-CAN-0031 | Verdict-cache guardrail catches content mutations | `ecfc1077` | `marineMaskShelter.wrapper.test.js:159-162` | **RV-04: M8 and M9 both CAUGHT at HEAD in an isolated worktree** |
| WS-CAN-0034 | Provenance class is multi-state with a cannot-determine | post-11.2 | `TruthOverlay.js:274-286` | Seven states gated on 5 inputs; the *"AUTHORITATIVE NATIVE during a total load failure"* path is unreachable |
| WS-CAN-0035 | Parity gate REFUSES on unsampled; orphaned read repaired | post-11.2 | `forecastDiagnostics.js:48, 288-354` | Both halves: `parityStatus`/`unsampledReasons` third state, **and** the ~10-week orphaned read now points at `webglSourceVectorCount`, with the history documented in-file at `:15-31` |

**Invariant protecting the set:** `surf_height_m` still has exactly one production write site
(`point_surf_augment.py:204`), and the AST guard over all three rating surfaces still holds.

---

# SECTION 6 — IMPLEMENTED BUT UNVERIFIED

| ID | What exists | Exact verification needed |
|---|---|---|
| WS-CAN-0013 | GPU hygiene batch (b/d/e) — accepted on 11.0's receipt | Independently re-verify (c), the encoder error-rollback that nulls resident pointers without deleting reused textures |
| WS-CAN-0012 | 2 of marine's 4 invariants ported to wind (device tier, reduced-motion) | Confirm OOB culling and in-place reseed; the OOB gap is an active correctness issue at z>6 |
| WS-CAN-0030 | Parity REFUSE state shipped | Confirm **every** `TRUTH VIOLATIONS` path consumes it, not just the one that was fixed. Scoped by its own author at ~2 h |
| WS-CAN-0036 | The `NO DATA` disclosure branch is reachable | Re-run 11.2's failure injection against HEAD. Disclosure shipped; **detection and recovery were never re-tested** |
| WS-CAN-0006 | Sim single-model contract | Not re-verified at HEAD by this audit; needs an owner contract decision before any code |
| WS-CAN-0032 | Settle debounce, default-OFF | **A human must watch a pan.** A deferral leaves the mask un-suppressed for that frame — a visible-behaviour change behind a perf flag |

---

# SECTION 7 — PARTIAL AND DUAL-PATH WORK

| Situation | Verdict |
|---|---|
| **The ICON >168 h hour has two live compositions** — `backendWeatherServiceClient.js:272` client blend vs `icon_marine_extension.py` backend bake; which one a user sees depends on series-cache warmth | **Complete it.** This is the CLAUDE.md ONE-COMPOSITION mandate one subsystem over. Serve the bake through the per-hour lane |
| **`marineCommitArbiter` ships dark** behind `__RAW_MARINE_ARBITER__` while the branch-heavy guard chain stays live — 3000/3000 differential-tested | **Benchmark, then decide.** Read `arb_shadow_diverge` first. Do not flip blind |
| **The executed-GL pixel oracle is `test.fixme`** — written, committed, and structurally unable to red CI | **Complete or delete.** A test that cannot fail is worse than no test: it occupies the slot |
| **Settle debounce vs verdict cache** — cache ON (88% static hit), debounce OFF | **Preserve as-is.** The author's stop condition is correct and explicit |
| **`resolution`: consumer fixed, producer absent** — the client now derives it from served grid bounds with a `resolutionSource` label because the backend never populates it | **Complete the producer.** The derivation is a good fallback and a bad permanent contract |
| **Two gate taxonomies** — 11.2 gates 1–8 by domain, 11.4 gates A–I by audit dimension, with no mapping | **Consolidate (WS-CAN-0056).** No gate currently has a history |

---

# SECTION 8 — REGRESSED OR REOPENED WORK

**Code regressions: none.** No previously-fixed defect was observed re-opened at HEAD. This is the
second consecutive audit to reach that conclusion, and it is the program's strongest single
property.

**One process regression:** Report 11.0 flagged **one** stale registered git worktree as a
search-hygiene hazard. At HEAD there are **six** — five orphans from a prior session pinned to
`79056047` / `e8f10955`. A stale worktree makes a repo-wide search silently read a different
commit. (WS-CAN-0055. These may hold another session's work — prune deliberately, not blind.)

**One conclusion reopened:** Audit 11.4's Gate C, refuted in §1.3 ②.

**One number that needs restating rather than retracting:** 11.1 reported `grid_series` p90
improving 32 s → 16 s. Live at HEAD, p50 is 5.0 s and **p99 is 31.1 s with 36.8% of requests over
10 s**. These are different statistics and neither refutes the other — but the program should stop
comparing across them (CON-08).

---

# SECTION 9 — NOT STARTED AND BLOCKED

**Not started by choice** (correctly deferred): WS-CAN-0011 dt-advection, WS-CAN-0016 hour-0
unification, WS-CAN-0044 p2 precedence, WS-CAN-0052/0053 flag flips, WS-CAN-0054 skill-gate arming.

**Not started because a prerequisite is missing:** WS-CAN-0049 (AI correction — needs a validated
baseline, which is exactly what ① denies), WS-CAN-0050 (WebGPU — needs a frame harness),
WS-CAN-0048 (nearshore model — needs deterministic selection *and* coverage).

**Blocked on the owner, not on engineering:**

| ID | Item | Cost | What it unblocks |
|---|---|---|---|
| WS-CAN-0039 | Unfreeze the production Netlify frontend | one decision | **Everything.** Measured today: prod `BUILD_VERSION = 3bd38a83` (2026-05-20) vs dev `= 3ec3fd13` = HEAD. Every frontend finding in this program is about an artifact production does not serve |
| WS-CAN-0021 | Rotate the two committed credentials | minutes | P1 governance; history retains them regardless of any edit |
| WS-CAN-0040 | Read the Render env-var screen | one screen | Bounds several flag-state questions across two masters |
| WS-CAN-0041 | Uninstall the Vercel GitHub App | one click | Removes 8-of-8 failing-deployment noise |
| WS-CAN-0042 | The calibration-bound value | one decision | Gate 5. **Never widen** |

**Blocked by wrong sequencing (now corrected by this audit):** WS-CAN-0045 was the *only* genuinely
open stage of the 11.4 packet; the packet led with three stages that were already done.

---

# SECTION 10 — SUPERSEDED, DUPLICATED, REJECTED, UNNECESSARY

Full reasoning: **`STOP_DEFER_REJECT_AND_NOT_NECESSARY.md`**. Merges: `TASK_SOURCE_CROSSWALK.csv`.

**Rejected (3), each priced against what it would replace by three independent audits:** Zarr /
Kerchunk / COG / Dask (WS-CAN-0046); JAX / CuPy / GPU / Numba (WS-CAN-0047); SWAN / FVCOM / GNN /
nested grids (WS-CAN-0048).

⭐ **The crosswalk preserves the objective, not the technology.** "Add Zarr" was never the task —
"reduce forecast-data access latency" was. That objective survives; the measured latency root is
`grid_series` composition and cold-start, not the storage format. When the objective and the
proposed technology were recorded as one item, four audits re-debated the technology and none
re-measured the objective.

**Nothing is classified "Not Necessary."** Every closed item met one of the *proven* criteria in
§18 of the brief. Difficulty was never accepted as a reason.

---

# SECTION 11 — RECURRING TASKS AND AUDIT CHURN

Full analysis: **`RECURRING_TASK_AND_AUDIT_CHURN_REPORT.md`**.

**Most repeated unresolved task:** **WS-CAN-0027** (runtime evidence capture) — named in 11.0,
11.1, 11.2 and 11.4. Four audits, four disclosures, one unwritten config key.

**Runner-up:** **WS-CAN-0025** (external uptime probe) — ranked **P0** by 11.0 and called *"the
cheapest single stability purchase left."* Never started. Its own target is now measurably slow:
`/api/health` p99 15.7 s.

**Most repeated unresolved root cause:** *a check that cannot distinguish "not sampled" from
"broken" reports success.* It has now appeared as: the parity guard's orphaned read (~10 weeks,
cited as PASS by two audits); `mismatches.length === 0` encoding absence as agreement;
`undefined ⇒ falsy ⇒ AUTHORITATIVE NATIVE`; three fabricated status surfaces; a `test.fixme` that
cannot red CI; **and the accuracy gate that passes while its own log says WE LOSE.**

**Audits that did not materially change the program:** none, on the evidence. Even 11.4 — which the
prior session advised against — produced the tautology finding, which was real and which mutation
testing alone had *not* caught.

**Why closure fails.** The blockers are not technical. In descending order of frequency:

1. **Sequencing** — the next packet is written before the current window's own evidence is folded in
   (11.4's Gate C; 11.0's first packet, later rewritten at `8f1fcf41` because it *"specified building
   something that already exists"*).
2. **Evidence, not code** — the top two zombie tasks are both instrument gaps, cheap to close, with
   no owner.
3. **Version identity** — three documents numbered 11.0, two numbered 11.2, none numbered 11.3.
   "Report 11.0 said X" is ambiguous by construction.
4. **A new report is easier to author than an old ledger is to update** — the failure mode the
   `33778014` session named in advance.

---

# SECTION 12 — INITIATIVE HISTORY AND CURRENT STAGE

Full history: **`INITIATIVE_HISTORY_AND_STATUS_MAP.md`**. Summary:

| Initiative | Stage |
|---|---|
| ONE FORECAST COMPOSITION (single chain, single write site) | **Completed / Stabilized** |
| Refusal-over-fabrication semantics | **Active and Partially Validated** |
| Release identity end to end | **Completed** |
| Truth-layer honesty (provenance class, parity refusal, orphaned read) | **Completed** — all three 11.2 Criticals closed |
| Model-run identity | **Dual-Path** — serialization done, cycle identity absent |
| Instrument loop (skill ledger, accuracy monitor, telemetry, persistence baseline) | **Active but Unvalidated as a gate** — see ① |
| Ocean-mask cost reduction (Gate 6) | **Active and Partially Validated** — cache on, debounce dark |
| Single animation / RAF authority | **Dual-Path** — one true violation remains (`WeatherTelemetry`) |
| Commit arbiter consolidation | **Prototype, shipping dark** |
| Executed-GL / pixel testing | **Prototype, unreachable by CI** |
| Client telemetry uplink | **Designed** — both halves exist, no wire |
| Frame-rate measurement | **Wrong Direction, corrected** — retracted program-wide; needs a headed harness |
| GPU projection authority / antimeridian | **Active and Fully Validated** — published Critical, self-refuted, controls preserved |
| Zarr / JAX / SWAN / neural emulators | **Superseded — priced and rejected 3× each** |
| Nearshore physics | **Active and Partially Validated** — 6 processes modelled; binding constraint is input coverage, 3 audits running |

---

# SECTION 13 — CURRENT AUTHORITATIVE ARCHITECTURE

Full map: **`CURRENT_ARCHITECTURE_AUTHORITY_MAP.md`**. The unresolved ownership:

| Responsibility | Status |
|---|---|
| Forecast composition (height + quality) | **Single Verified Authority** — `surf_point.resolve_surf_geometry` → `estimate_surf_at` → `surf_rating`, one write site |
| Grid orientation / units / direction | **Single Verified Authority** — `WeatherNormalizer.normalize` |
| Forecast hour | **Single Unverified Authority** — `useWeatherState.timeOffsetHours` with 6 one-way mirrors; hour-0 has three disagreeing owners |
| ICON >168 h composition | **Transitional Dual Path** ⚠️ |
| Marine commit | **Explicitly Coordinated**, with a dark reducer alongside |
| Animation scheduling | **Accidental Duplicate Authority** — one true RAF-invariant violation (`WeatherTelemetry.js:397-399`, no cancel path) |
| Ocean mask | **Single Authority + a bounded local cache** |
| Product selection at z8/z9/z10 | **Authority Unknown** ⚠️ — non-deterministic, changes the served value (WS-CAN-0033) |
| Resolution disclosure | **Bypass Present** — client derives what the backend never sends |
| Client→server transport | **Single Authority** — one throttled POST; no uplink |

---

# SECTION 14 — CURRENT MATURITY AND SYSTEM STATUS

Full scorecard: **`CURRENT_STATE_MATURITY_SCORECARD.md`**. Headlines:

| Axis | Rating |
|---|---|
| Data-source provenance | **Strong but Incompletely Verified** |
| Model-run identity | **Partial** — `run_time` is provably ingest time in production |
| Unit / direction / orientation correctness | **Verified Stable** |
| Rendering & projection | **Verified Stable** |
| Animation lifecycle | **Strong** — one violation |
| GPU lifecycle | **Strong but Incompletely Verified** |
| Caching / service worker | **Verified Stable** |
| Performance | **Partial** — p99 31 s on the dominant route |
| Memory stability | **Partial** — OOM *kills* closed; *headroom* at 87.0% |
| Testing | **Strong for logic, Not Started for optical output** |
| Observability | **Strong instruments, no transport** |
| Scientific validation | **Active and Unverified as a gate** — see ① |
| Nearshore modelling | **Partial** — physics present, coverage binding |
| Release delivery | **Blocked** — production frontend 84 days behind HEAD |
| Upgrade-program discipline | **Regressed** — 5 audits, 0 recordings, 3 version collisions, 1 phantom |

---

# SECTION 15 — STATE-OF-THE-ART GAP REVIEW

Full matrix: **`STATE_OF_THE_ART_GAP_MATRIX.csv`** (12 capabilities).

**Already modern and correct:** Range-streamed GRIB2 ingestion; a single normalization authority;
WebGL2 custom MapLibre layers with exact per-vertex Web Mercator; model-keyed caches; refusal
semantics; release identity; a science registry with a ratchet.

**Needs repair, not replacement:** the accuracy gate's criterion (WS-CAN-0026); the integrity chain
(WS-CAN-0017); HTTP status honesty (WS-CAN-0009); the third fabricated status surface
(WS-CAN-0010).

**Migration to complete:** executed-GL testing (WS-CAN-0018/0019/0028); runtime evidence capture
(WS-CAN-0027); the telemetry uplink (WS-CAN-0020).

**Premature:** WebGPU (no measured bottleneck *and* no way to measure one); AI correction (nothing
validated to correct toward); finer nearshore models (selection is non-deterministic).

**Rejected:** Zarr/Kerchunk/Dask; JAX/CuPy/Numba; SWAN/FVCOM/GNN/nested grids.

⚠️ **One SOTA claim in the program should be read carefully.** The rejection of AI bias correction
rested on *"no observational validation exists."* That is no longer true — validation exists, and
what it says is that the product lane loses to a free public model. The rejection **still holds**,
for a sharper reason: you cannot fit a learned correction toward a baseline you have not yet beaten.
Fix the gate and the lane first.

---

# SECTION 16 — DEPENDENCY AND GATE ANALYSIS

Full graph: **`DEPENDENCY_AND_RELEASE_GATE_GRAPH.md`**.

```
Gate 0  Source of truth ......... 12.0 register ✅ | uptime probe ❌ | owner one-clicks ❌ | worktrees ❌
Gate 1  Correctness ............. accuracy criterion ❌ | cycle identity ❌ | resolution ❌
                                  | conditions status ❌ | ICON one-composition ❌ | z-tier determinism ❌
Gate 2  Lifecycle & ownership ... churn loop ✅ | RAF cancel ❌ | failure-injection re-test ❌
Gate 3  Regression protection ... verdict cache ✅ | executed-GL ❌(fixme) | canonical fields ❌
                                  | frame harness ❌ | video capture ❌
Gate 4  Low-risk performance .... telemetry uplink ❌ | arbiter arming ❌ (benchmark first)
Gate 5  Data modernization ...... REJECTED (Zarr et al.)  |  flag flips DEFERRED
Gate 6  Numerical / GPU ......... DEFERRED — blocked on Gate 3's frame harness
Gate 7  Nearshore ............... DEFERRED — blocked on Gate 1 z-tier determinism + coverage
Gate 8  AI-assisted ............. DEFERRED — blocked on Gate 1 accuracy criterion
```

**Gate 1 is the binding constraint on Gates 5, 7 and 8 simultaneously.** Gate 3 blocks Gate 6.
Nothing blocks Gate 0, and Gate 0 contains the cheapest items in the program.

---

# SECTION 17 — PROGRAM PATH FORWARD

Full detail with acceptance criteria and rollback: **`PROGRAM_PATH_FORWARD.md`**.

### NOW (5, hard cap)
| ID | Task | Why now |
|---|---|---|
| **WS-CAN-0026** | Paired persistence + Open-Meteo rows in the accuracy RED criterion | The gate is green about the wrong quantity. Named 08-10, unstarted. The numbers are already computed and printed — this is a criterion change, not a measurement project |
| **WS-CAN-0027** | Playwright `video: 'retain-on-failure'` + 1.60 → 1.62 | One config key closes the program's most-repeated evidence gap, four audits running |
| **WS-CAN-0025** | External uptime probe | 11.0's P0. Its own target now has a 15.7 s p99 |
| **WS-CAN-0010** | Third fabricated status surface (`system.py:208`) | Two of three shipped; finishing costs one function |
| **WS-CAN-0045** | Non-vacuity guard in the verdict-cache assertion | The single genuinely open stage of the 11.4 packet |

### NEXT (5)
WS-CAN-0018/0019 un-fixme the executed-GL oracle · WS-CAN-0028 synthetic canonical fields ·
WS-CAN-0009 conditions HTTP status honesty · WS-CAN-0014 populate `resolution` ·
WS-CAN-0005 true model-cycle identity.

### LATER
WS-CAN-0007 ICON one-composition · WS-CAN-0017 integrity chain · WS-CAN-0020 telemetry uplink ·
WS-CAN-0033 z-tier determinism · WS-CAN-0037 frame harness · WS-CAN-0024 band/glyph sub-term ·
WS-CAN-0043 arbiter (benchmark first) · WS-CAN-0056 gate taxonomy.

### DEFER
dt-advection · hour-0 unification · p2 precedence · `SURF_PARTITIONS` · `SURF_TIDE_DEPTH` ·
skill-gate arming (08-22) · WebGPU · AI correction · learned nearshore transform.

### REJECT
Zarr/Kerchunk/COG/Dask · JAX/CuPy/GPU/Numba · SWAN/FVCOM/GNN/nested grids/AMR.

### PRESERVE — do not disturb
The composition chain and its single write site · refusal semantics · the stale-response guard
stack · the two-orientation texture contract · the ask-echo `valid_time` contract · Gate 4
animation lifecycle (11.2: *"good — don't refactor it"*) · the verdict cache implementation
(11.4 verified it correct **and its own test now proves it**) · the settle debounce's default-OFF.

---

# SECTION 18 — AUTHORIZED NEXT MISSION

**One mission: `WS-CAN-0026` — make the accuracy gate grade the comparison that matters.**

Full packet: **`NEXT_AUTHORIZED_EXECUTION_PACKET.md`**.

Chosen over the other four NOW items because it is the only one that closes a **Gate 1 correctness**
question, it simultaneously unblocks **Gates 5, 7 and 8**, it is the oldest named-and-unstarted
corrective action in the register, and every number it needs is **already computed and printed by
the existing instrument**. It is a criterion change in one file.

**Explicitly not in scope:** changing any forecast quantity, tuning any constant, widening any
bound, or switching the default model to EURO. This mission changes what the gate *reports*, not
what the system *computes*.

---

# SECTION 19 — RULES THAT PREVENT AUDIT 13.0 FROM REPEATING AUDITS 1–11

1. **Audit 12.0's `CANONICAL_TASK_REGISTER.csv` is the program's source of truth.** Historical
   reports are preserved and are no longer authoritative.
2. **A task keeps its canonical ID forever.** New reports cite `WS-CAN-nnnn`. A finding without an
   ID must be assigned one before it can be actioned.
3. **No new broad audit merely because an implementation session ended.** The next review is
   **gate-specific**: name the gate, name the tasks, close or re-open them.
4. **A completion claim requires evidence of the type its acceptance criteria name.** A commit
   message is not evidence. A green suite is not evidence that the changed lines are covered.
5. **A recommendation against commissioning a report must be answered in writing before the report
   is commissioned.** (The `33778014` recommendation was correct about churn and wrong about yield —
   which is exactly why it needed an answer, not silence.)
6. **Before publishing a gate verdict, re-read the evidence generated during the audit's own
   window.** 11.4's Gate C was refuted by a file in its own commit.
7. **Version numbers are not identifiers.** Cite the path. Never reuse a number across documents.
8. **A required procedure that is not run must open a task, not just a caveat.** Four audits
   disclosed the recording gap; none opened a task for it. This one is WS-CAN-0027.
9. **Reopening a Rejected / Superseded / Deferred task requires new evidence, named in the reopening
   commit.**
10. **Every audit updates `CANONICAL_TASK_REGISTER.csv` in the same commit that publishes its
    report.** A report whose register edit is missing is not published.

---

# SECTION 20 — FINAL INDEPENDENT VERDICT

**After 35 reports and 5 executed program audits, what has actually been completed?** Nine tasks
verified closed at HEAD by this audit's own evidence, and they are the right nine: the composition
chain is single-authority; the truth layer no longer lies about provenance, parity or release;
the marine churn loop is bounded; the rating mirror agrees across the gate that used to split it;
and the verdict cache is correct *and now provably guarded*. The forecast chain survived 100+
commits bit-identical. **No code regression was found — for the second consecutive audit.**

**What was claimed complete but is not proven?** One: **Audit 11.4's Gate C = FAIL**, refuted by
its own evidence file and by my independent mutation run. Notably, the claims that failed
verification here were mostly *pessimistic*, not optimistic — this program under-claims. That is
much the better failure mode, and it is worth naming as a strength.

**What work is still genuinely necessary?** Twenty tasks to complete, nine to repair. The centre of
gravity is not the code — it is the instruments. **The platform's most urgent defect is that its
accuracy gate reports OK while its own log says the product loses to a free public model at all
three forecast leads.**

**What should be formally closed?** Three technology tracks (Zarr, JAX, SWAN-class), the nine
verified completions, and the 11.3 phantom — which should be recorded as *deliberately not run on
sound advice*, not as an outstanding obligation.

**Which partial migration is causing the most instability?** Not a code migration. **The gate
taxonomy** — two incompatible systems in consecutive audits, so no gate has a history and every
audit re-derives its own frame. Second: the ICON >168 h dual composition, which violates the
project's own binding mandate one subsystem over.

**Where is the platform in its state-of-the-art journey?** **Late stabilization.** It is closer to
modernization-ready than any prior audit concluded — the truth layer is repaired, projection is
certified, the composition chain holds — and it is further from *earning* modernization than any
prior audit stated, because the one instrument that could grade a modernization has just been shown
to pass while the product loses.

**Is the architecture ready to modernize?** **No — and for one specific, fixable reason.** Not
because the code is fragile. Because **you cannot grade an improvement with a gate that is green
about the wrong quantity.** Fix the gate, and Gates 5, 7 and 8 all become debatable on evidence for
the first time in the program's history.

**What must not begin yet?** Any Zarr/JAX/SWAN-class work; any WebGPU work (frame rate is currently
unmeasurable); any AI correction (nothing validated to correct toward); any flag flip
(`SURF_PARTITIONS`, `SURF_TIDE_DEPTH`); any canary (the `p2.py` precedence inversion is unfixed);
any calibration or bound widening; any further mask optimisation; and any sixth broad audit.

**What exact engineering mission should begin next?** **WS-CAN-0026.** One file. One criterion.
The numbers already exist.

---

## APPENDIX — ARTIFACT INDEX

| Artifact | Contents |
|---|---|
| `EXECUTIVE_WHERE_WE_STAND_BRIEF.md` | One-page brief |
| `AUDIT_SOURCE_INDEX.csv` | 551 sources, SHA-256, git provenance |
| `AUDIT_VERSION_AND_DEPENDENCY_GRAPH.md` | Lineage graph, collisions, the phantom |
| `AUDIT_EXECUTION_COMPLIANCE_LEDGER.csv` | 47 required actions × 6 audits |
| `CANONICAL_TASK_REGISTER.csv` | **56 tasks, three status axes — the source of truth** |
| `TASK_SOURCE_CROSSWALK.csv` | Original identifiers → canonical IDs |
| `IMPLEMENTATION_TRACEABILITY_LEDGER.csv` | Claim → commit → active path → this audit's verification |
| `INITIATIVE_HISTORY_AND_STATUS_MAP.md` | 15 initiatives with current stage |
| `CONTRADICTION_AND_SUPERSESSION_LEDGER.csv` | 10 reconciled contradictions |
| `RECURRING_TASK_AND_AUDIT_CHURN_REPORT.md` | Zombie tasks and why closure fails |
| `CURRENT_ARCHITECTURE_AUTHORITY_MAP.md` | Intended vs actual authority per responsibility |
| `CURRENT_STATE_MATURITY_SCORECARD.md` | Per-axis maturity |
| `STATE_OF_THE_ART_GAP_MATRIX.csv` | 12 capabilities with decisions |
| `DEPENDENCY_AND_RELEASE_GATE_GRAPH.md` | Gates 0–8 and what blocks what |
| `PROGRAM_PATH_FORWARD.md` | NOW / NEXT / LATER / DEFER / REJECT / PRESERVE |
| `NEXT_AUTHORIZED_EXECUTION_PACKET.md` | The one authorized mission |
| `STOP_DEFER_REJECT_AND_NOT_NECESSARY.md` | Closure register |
| `OPEN_BLOCKERS_AND_EVIDENCE_GAPS.md` | What this audit could not establish |
| `evidence/` + `artifact-manifest.csv` | RV-01 … RV-04 with SHA-256 |
