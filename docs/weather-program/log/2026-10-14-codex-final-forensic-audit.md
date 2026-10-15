# Final forensic audit — independent second angle
**Evidence cutoff: 2026-10-14 02:17 UTC. Audit only; no repairs.**

**Verdict: NOT READY for unqualified acceptance of the audited changes.** The wind work has meaningful improvements, but the first pass's six findings remain open. This second pass adds five failure families: cancelled-request task retention, false recovery coverage, misleading model status, unidentifiable compositing fits, and order-dependent artifact aggregation. Two of these concern measurement tools, not forecast values. One runtime defect requires an optional flag that defaults off.

This report consolidates the decision. The [first-pass report](C:/Users/David/.codex/worktrees/7dd9/raw-surf/docs/weather-program/log/2026-10-13-codex-delta-forensic-audit.md) retains the detailed colour, GPU, science and security evidence; this document explains what a different method added or challenged.

## Scope, method and memory

Same immutable comparison: baseline `ab416298d30bf98932d7be5ee0868714c34e43b3` through `2e41e83a72a4ac260e18a9c79048e0fa27372aba`, including merged dev `131d5d9e` and pending #330. The first pass inventoried **62 commits and 296 changed files**. This second pass is a targeted independent challenge of failure ordering, cross-component state and measurement validity, not another claim to inspect every line of that entire delta.

Different methods used:

- **Deterministic fault injection:** real production async functions, gated scheduling, caller cancellation and failed normalization. Synthetic upstream/storage boundaries; no live load.
- **State-transition replay:** Europe → US, WebGL disposal → Canvas fallback, regional → global, and old-cycle → fresh-cycle delivery through the actual WeatherEngine delivery closure and engine setters.
- **Metamorphic tests:** reorder identical seed observations, vary experimental excitation, and remove individual control observations. These test invariants without accepting the tool's own expected answer.
- **Identifiability analysis:** independently generate pixels from a blending law, inspect the design matrix rank, then test whether the estimator can distinguish two coefficients.
- **Artifact-to-source verification:** read public service-worker identities and compare relevant Git ranges; hash 249 changed source/test/fixture/config files around the reviews. **No hashed source changed.**

Skills used: FlightDeck Review for acceptance boundaries and Doubt-Driven Development for three fresh-context adversarial reviewers. Reviewers received artifacts and contracts, not the first audit's conclusions. I reconciled their results against source and controls; their outputs were not accepted wholesale. Tree Ring's guidance was used for evidence-backed recall, alongside the canonical weather-program records and a successful Codex thread-history read of **Audit weather simulation system**. Relevant lessons include L-V81 (read named data, not column positions), L-V84 (positive controls must differ), and L-V85 (mutation runs must not contaminate other measurements).

**Capability limits:** Macroscope and Tree Ring CLIs were absent from PATH and this project's checked local locations; neither review nor Tree Ring recall was falsely claimed. No installation was performed. The Code Review connector was attempted and returned “Can't connect to GitHub”; that read is unavailable. Trevec was not exposed. The external cross-model option was offered; no external-model CLI was invoked. Existing repository memory remains authoritative.

## Additional findings

### A1 · P2 · Cancelled callers keep obsolete background work alive
**Introduced; conditional on `WIND_BG_BUILD_BOUNDED=1`, which defaults off.**

The new [waiter test](C:/Users/David/.codex/worktrees/7dd9/raw-surf/backend/services/weather_pipeline/wind_bg_build.py:74) interprets an unresolved hour future as a live request. But the [sharing caller](C:/Users/David/.codex/worktrees/7dd9/raw-surf/backend/services/weather_pipeline/viewport_service.py:313) awaits it through `asyncio.shield`. Cancelling the caller leaves that future unresolved, so [the retention path](C:/Users/David/.codex/worktrees/7dd9/raw-surf/backend/services/weather_pipeline/viewport_service.py:471) preserves the displaced background task despite the caller being gone.

Controlled sequence: six disjoint boxes; for each, start the real target-hour fetch, register a sharing request for +12 hours, cancel and await that requester, then move to the next box. Hold normalization behind a gate to inspect exact task ownership.

| Identical cancelled-request sequence | Live background tasks | Retained displaced tasks |
|---|---:|---:|
| Flag off | 1 | 0 |
| Flag on | **6** | **5** |

The keeper set has no independent cap; pending future counts grow from 1 to 6. This does not measure production memory or prove an outage. It demonstrates a route by which cancellation defeats the claimed work bound and retains raw forecast contexts.

**Repair direction, not performed:** track actual subscriber lifetime, unregister on cancellation, and enforce a bound independent of future completion. Acceptance needs the same timed-out/cancelled-page sequence, not only successful waiters.

[Probe](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/second-audit/fault-order/probe.py) · [measured output](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/second-audit/fault-order/probe-results.txt)

### A2 · P2 · Failed hours are advertised as successfully recovered
**Introduced; native recovery defaults on.**

[Native recovery](C:/Users/David/.codex/worktrees/7dd9/raw-surf/backend/services/weather_pipeline/wind_native_recovery.py:343) records the whole requested time window in `RECOVERED` after the remaining-hours helper returns. The [helper](C:/Users/David/.codex/worktrees/7dd9/raw-surf/backend/services/weather_pipeline/viewport_helper.py:521) catches individual normalization failures and continues, without returning successful-hour coverage. Completion of the task therefore does not establish completion of its window.

Fault injection: target hour succeeds; target−3h and target+3h normalization raises. The real helper logs both failures and returns. Recovery still records complete coverage. A retry for the missing +3h product in a **different, contained bbox** returns false. Removing only the false `RECOVERED` claim makes that identical retry return true. The different bbox controls for the older exact-key cooldown.

**Impact:** useful native recovery is suppressed for the default 600-second reuse interval even though the requested product was never built. A coarse/stale fallback can persist unnecessarily. This is an availability failure, not evidence of numerical corruption.

**Repair direction:** record successful products/hours, or verify product availability before asserting coverage. Partial success must not become whole-window success.

[Detailed evidence and controls](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/second-audit/fault-order/findings.md)

### A3 · P2 · The model label is detached from what is visible
**Introduced; two demonstrated transitions share the status-source problem.**

[windLaneOnScreen](C:/Users/David/.codex/worktrees/7dd9/raw-surf/frontend/src/components/map/windLane.js:30) unconditionally prefers resident fine-grid metadata and only inspects WebGL state.

1. **Pan:** file a global HRRR+GFS base, then Europe fine GFS, then pan to the US and deliver a coarse US clip. The engine correctly keeps the reusable base and the Europe fine object. Shader bounds select the base in the US, but the status still says **“Wind: GFS. HRRR covers the United States only.”** The retained fine grid is completely offscreen. This is incorrect provenance text, not a demonstrated shader-selection error.
2. **Renderer fallback:** dispose WebGL and supply an HRRR-stamped grid to Canvas. [Engine cleanup](C:/Users/David/.codex/worktrees/7dd9/raw-surf/frontend/src/components/map/WebGLWindEngineInit.js:201) clears the slots; the status becomes null because Canvas's visible data is not consulted. The new model-transition label disappears on the supported fallback path.

[WindLaneStatus](C:/Users/David/.codex/worktrees/7dd9/raw-surf/frontend/src/components/map/WindLaneStatus.js:12) polls these values every 500 ms, so waiting does not repair the source selection. The same incorrect/missing text affects its accessible status.

**Repair direction:** derive status from the active renderer and visible contributing grids, including mixed coverage. Test panning, overlapping tiers and fallback transitions.

This is an executable state replay with mocked GL/transport, not a new screenshot claim. [Probe](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/second-audit/visual-contract/transition.cjs) · [output](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/second-audit/visual-contract/transition.cjs.txt)

### A4 · P2 · A zero fit residual can falsely identify the compositing law
**Introduced measurement defect.**

[truth.js](C:/Users/David/.codex/worktrees/7dd9/raw-surf/frontend/scripts/wind-bench/truth.js:193) treats every singular two-column fit as “no veil,” forcing coefficient `q=0`. A singular system can instead have two nonzero, collinear columns: the data cannot identify the coefficients.

An independent pixel generator used gray ground 64, trail 128, and the dark law **p=q=0.505**. The estimator returned **p=0.332, q=0, RMS=0**. Its Gram determinant was approximately **1.78×10⁻¹⁴**, despite a nonzero veil column. Both laws explain those quantized observations; zero residual cannot select one.

Control: vary the trail levels from 30 to 228 under the same generating law. The determinant becomes 8.8814; the fit correctly returns **p=q=0.505**, RMS 0.299 byte levels. This localizes the problem to identifiability reporting, not the general least-squares algebra.

**Repair direction:** report rank/conditioning and “unidentified,” rather than a measured zero. Acquire sufficiently varied observations before classifying a law. No claim is made that Claude's existing recorded fits used this degenerate dataset.

[Independent arithmetic and results](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/second-audit/instruments/FINDINGS.md)

### A5 · P2 · Reordering identical observations changes the artifact verdict
**Introduced measurement defect; prior saved three-seed counts survive this challenge.**

[recurringShapes](C:/Users/David/.codex/worktrees/7dd9/raw-surf/frontend/scripts/wind-bench/replicates.js:29) greedily assigns clusters against the first member of the first matching group. Its proximity relation is not transitive, so the majority count depends on input order.

Five seeds each contain one identical-kind, four-block cluster at x=0/60/120/180/240. The matching reach is 64 pixels. Ordering seeds [0,1,2,3,4] gives **zero recurrent artifacts**; reordering the same observations to [2,1,3,0,4] gives **one**, seen in 3/5 seeds. No pixels or observations changed.

Crucially, the reviewer also re-aggregated **all six permutations of each of the first audit's 17 actual three-seed groups**. **None changed artifact count or block count.** The new counterexample does not overturn the earlier measured four recurrent scanner clusters.

**Repair direction:** make grouping deterministic and order-independent, and define what constitutes one cross-seed shape before using its count as an acceptance gate.

[Metamorphic probe](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/second-audit/instruments/probe.mjs) · [actual-sample permutation results](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/second-audit/instruments/followup-results.json)

## What the second pass changed about the first conclusions

| First finding | Final assessment |
|---|---|
| F1 P1: finer old forecast blocks fresh data | **Strengthened.** A fresh covering delivery traverses WeatherEngine's real delivery closure to the engine. A 1° new-cycle control replaces the fine data; a 2° clip returns `noop_base_clip` and retains the exact 00Z fine object despite known incoming 06Z metadata. Upstream guards do not establish cycle eligibility first. Transport remains synthetic. |
| F2 P2: dark checker uses the wrong blend | **Stands.** The new Jacobian tool documents/corrects its local equation; the older checker still does not model actual dark RGB compositing. The first pass's actual framebuffer control supports the defect. |
| F3 P2: repaired HRRR cycle does not reload | **Stands.** No repair occurred; same-key revision identity remains absent. |
| F4 P2: opposing-wind blend singularity | **Stands, bounded.** Synthetic directional-cancellation evidence; not proof of a particular live NOAA seam. |
| F5 P2: visible zoom-6 density jump | **Stands.** Earlier controlled GPU evidence remains applicable. |
| F6 P2: motion-cache identity omits experiment fields | **Stands.** The cache can reuse mismatched captures; no claim that every past capture was contaminated. |

The **pre-existing P1 crew-chat WebSocket authorization gap** remains open. Earlier nearshore actual-time matching, partial-observer physics validation, partition inflation, cache instant identity and first-zoom fidelity gaps also remain. These are not newly introduced findings in this pass. #264's proposed repairs require their own integration and acceptance; an open proposal is not a fix.

## Residual gaps and rejected suspicions

Two additional cancellation sequences violate the new broad latest-view claims but preserve older behavior, so they are **not counted as new regressions**:

- Native recovery A running → B waiting → final view A still executes obsolete B. The existing/coverage return precedes superseding.
- Wind warm-up regional → global leaves two regional request signals alive; another regional identity or unmount correctly aborts them. The shared policy returns the global lifetime signal before cancelling regional intent.

A defensive instrument weakness was also demonstrated: `controlAcrossSeeds` can report PASS after silently dropping a missing pair. However, the current normal runner generates paired configurations and awaits every result, failing out on a thrown run. An incomplete-array counterexample alone does **not** show a false PASS in that normal path. Keep this as an instrument-hardening concern, not another observed failed run.

The review **rejected** these proposed defects:

- Jacobian “10% turn” columns lack division by 0.1: their stated units are finite change for that turn; no units bug established.
- Omitted calm-air/veil effects make the Jacobian secretly complete: the tool explicitly excludes them. This is a use limitation, not an undisclosed implementation claim.
- Local speed slopes vary with finite-difference step: confirmed at piecewise ramp knots, but not enough to establish an optimizer defect where no derivative inversion is claimed.
- A cancelled native job's callback deletes its replacement: task-identity checks prevent it.
- The recovery retry failure is merely the old exact-key cooldown: the contained-bbox control disproves that explanation.

## Jacobian conclusion

A useful Jacobian audit has three parts, and this second pass exercised the latter two more deeply:

1. **Forward sensitivity:** the first report quantifies how physical and visual outputs move with inputs, including caps and the direction-normalization singularity.
2. **State transitions:** time/cycle identity, cancellation, renderer fallback and coverage claims are discrete states. A smooth local derivative cannot certify them. The new counterexamples require ordered traces and failure injection.
3. **Inverse identifiability:** even perfect agreement with measured pixels cannot identify hidden coefficients when the design matrix loses rank. A4 demonstrates that zero residual is not proof of the inferred law.

Accordingly, use local derivatives within a qualified regime, boundary sweeps at seams, and rank/conditioning checks when inferring parameters. Palette, frame appearance, motion, provenance and forecast accuracy remain separate acceptance questions.

## Deployment, visual quality and verification

Fresh lightweight public reads at **02:11:14–15 UTC** found:

| Artifact | Observed identity | Meaning |
|---|---|---|
| Dev service worker | `131d5d9e` | Matches merged dev, not pending #330's audit tools |
| Production service worker | `fc140024` | Confirms the previously recorded production freeze |

[Timestamped response metadata and SHA-256 digests](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/second-audit/deployed-static-versions.json). A service-worker stamp establishes that artifact's declared build identity, not every currently open client's cache state. The first pass observed backend `f9320c27`; Git shows its difference to `131d5d9e` is documentation only. Backend health was not re-read in this pass. #330's frontend runtime-file differences are comments; its tool changes are substantive.

**Visual/art assessment:** keep the first pass's credit for coherent streaks, registration, anchoring and stronger light/beach treatment. Its 51 GPU configurations and three-theme captured motion remain evidence, accessible in the [animation viewer](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/evidence-viewer.html). This pass adds semantic correctness: a visually coherent field can still be accompanied by a wrong or absent model label. It also narrows what the instruments can prove. No new real-phone, 120-Hz, responsive-layout, live-app animation or accessibility certification was performed.

The first pass's **67 suites / 1,462 passing frontend tests** and focused backend checks are inherited verification, not newly rerun totals. This pass added targeted executable counterexamples and controls, not a larger pass-count claim. All 249 hashed changed source/config/test/fixture files remained unchanged during the independent reviews.

## Final priorities and closeout

1. Address the existing private-chat authorization gap and F1 forecast identity before clean acceptance.
2. Correct false recovery coverage; fix A1 before enabling bounded background work.
3. Derive model status from visible data and the active renderer.
4. Align the colour checker, experiment cache identity, compositing-fit identifiability and artifact aggregation with their actual contracts.
5. Qualify zoom continuity and cross-model directional cancellation; retain the owner's flag and release decisions.
6. Finish exact-time scientific validation and source-matched live/device acceptance with explicit evidence.

**No application repairs, source mutations, commits, merges, pushes, deployments, workflow dispatches or production-data writes were performed.** New writes are audit evidence, this report and required weather-program ledger/anchor records. The reports remain local and uncommitted; no report was posted to another person or external service.

