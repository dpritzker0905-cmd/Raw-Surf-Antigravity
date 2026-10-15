# Forensic audit of the completed Claude Code work — October 13, 2026

**Verdict: substantial improvements, but not a clean bill of health.** The new wind work improves model consistency, grid registration, visual hierarchy, trail anchoring and light/beach colour separation. Six concrete defects or verification defects remain in the audited delta. The most consequential application defect allows an older fine grid to block a fresh forecast. Earlier scientific-validation and security gaps remain independently reproducible.

Audit only: no application repairs, commits, merges, pushes, deployments, flag flips, workflow dispatches or production-data writes. Local test setup, evidence artifacts and this audit's memory records are the only writes. No live map playback or forecast load test was performed.

**Scope and snapshot**

- Previous audit: [October 8 report](C:/Users/David/.codex/worktrees/08a3/raw-surf/docs/weather-program/log/2026-10-08-fresh-forensic-audit.md), source `ab416298d30bf98932d7be5ee0868714c34e43b3`. It also reviewed #270 separately before its external merge.
- Current merged `dev`: `131d5d9e434124d9bf510edb9eed2e8238723313`; completed pending [#330](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/pull/330): `2e41e83a72a4ac260e18a9c79048e0fa27372aba`. The clean audit worktree was detached at that exact head.
- **62 commits: 58 merged and 4 in #330; 296 changed files, 42,779 additions and 611 deletions.** This corrects the preliminary commentary's 57-commit estimate. The entire delta was inventoried; deep review covered changed runtime paths, test instruments, relevant specifications and acceptance records. This is not a claim to have re-audited every unchanged app subsystem.
- #330's app-source changes are comments; its substantive additions are audit/solver tools and records. All listed source CI checks on its pinned head passed. [#264](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/pull/264) remains open at `de490d11` and conflicting; its proposed repairs are not present merely because wind work finished.
- Evidence collected October 13 EDT, extending into October 14 UTC. Tools: Git/GitHub CLI, independent review agents under the Review skill, pytest, Jest, Chrome/Playwright with the actual WebGL engine on Radeon 890M, culori/ColorAide, synthetic production-function probes, and official documentation. Trevec and dedicated Render/Supabase connectors were not exposed. No formal full-estate Codex Security scan is claimed.

**Findings in the audited work**

**F1 · P1 — Keeping the finer grid can keep the wrong forecast.**  
[WebGLWindEngine.js:226](C:/Users/David/.codex/worktrees/7dd9/raw-surf/frontend/src/components/map/WebGLWindEngine.js:226) returns before the stricter freshness checks in [windTierMosaic.js:66](C:/Users/David/.codex/worktrees/7dd9/raw-surf/frontend/src/components/map/windTierMosaic.js:66). The earlier eligibility test ignores known model cycle, actual served-frame differences, stale status and HRRR lane identity. A fresh coarser arrival can therefore be rejected solely because a resident grid is finer.

The actual-source offline replay used identical requested hour/bounds, an old 00Z-cycle, stale 0.25-degree grid at **10 kn**, and a fresh 06Z-cycle 0.5-degree grid at **40 kn**. Broad compatibility returned true, strict same-air returned false, and `setWindData` returned `noop_coarser_than_fine`, leaving 10 kn resident. This is a demonstrated decision-path error, not a claim that a particular live storm currently displays that discrepancy. A related retention policy exists in WeatherEngine/windOverlayKeep.

Recommended repair direction: establish authoritative time/cycle/lane eligibility before any resolution-preservation return; require trajectories covering stale-to-fresh and cycle rollover. Preserve finer samples only when they describe the same eligible air. [Reproduction](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/visual-source-repro.cjs) · [result](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/visual-source-repro-results.json).

**F2 · P2 — The dark colour checker grades a different blending equation from the GPU.**  
[check.mjs:86](C:/Users/David/.codex/worktrees/7dd9/raw-surf/frontend/scripts/wind-color/check.mjs:86) models `c*a + background*(1-a)`. The [shader:992](C:/Users/David/.codex/worktrees/7dd9/raw-surf/frontend/src/components/map/WebGLWindShaders.js:992) emits premultiplied RGB, while [engine:590](C:/Users/David/.codex/worktrees/7dd9/raw-surf/frontend/src/components/map/WebGLWindEngine.js:590) still uses SRC_ALPHA blending: the actual equation is **`c*a² + background*(1-a)`**. Canvas-alpha preservation does not change these RGB factors. #330's Jacobian tool recognizes the discrepancy, but the checker remains unchanged.

The checker reports dark's worst uploaded pair as **4.97 dE2000**, below its 5.0 floor at only 1/281 maxima. Re-evaluating its texture samples through the actual equation gives **2.96**, with at least one failing pair at **281/281** tested maxima. This sweep is a model calculation through the verified equation. Separately, actual GPU centre pixels at 47/55 kn, maximum 60 kn, background RGB(93,117,126), were **(105,81,77)** and **(104,71,83)**: ColorAide's Brettel tritan simulation yields **2.955 dE2000**. Thus the shortfall is not just the previously documented 0.03 margin.

Light/beach's corresponding modelled minima are 5.03/5.04 over water and 5.20/5.31 over land; this finding does not invalidate their different multiply equation. These project-specific perceptual thresholds are not WCAG certification. Recommended direction: share the actual compositing law and pin it against framebuffer pixels before trusting colour optimisation. [Probe](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/dark-composite-probe.py) · [GPU evidence](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/z6-gpu-results.json) · [checker output](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/colour.txt).

**F3 · P2 — A repaired HRRR cycle never reloads into an already warm server.**  
[wind_lane.py:190](C:/Users/David/.codex/worktrees/7dd9/raw-surf/backend/services/weather_pipeline/wind_lane.py:190) considers an unchanged object key sufficient to skip loading. But [wind_lane_ingest.py:68](C:/Users/David/.codex/worktrees/7dd9/raw-surf/backend/services/weather_pipeline/wind_lane_ingest.py:68) deliberately replaces that same cycle key when previously missing hours recover.

Production ingest/refresh code, with storage mocked, published **49 hours**, while the warm process retained **48** and continued returning GFS/`hrrr_hour_missing` for the repaired hour. Repeated TTL checks only read the index; restart or a new cycle is needed. Warm and restarted instances can disagree despite identical available data. Recommended direction: put an immutable version/content identity in the index, or invalidate on the repaired object's revision. [Production-function reproduction](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/forecast-spec-repro.py).

**F4 · P2 — The HRRR/GFS directional blend has a singularity despite its smooth spatial weight.**  
[wind_lane.py:303](C:/Users/David/.codex/worktrees/7dd9/raw-surf/backend/services/weather_pipeline/wind_lane.py:303) preserves scalar speed S but normalizes the blended vector B: `v = S B / |B|`. Its derivative contains `1/|B|`; opposite model winds can make B approach zero. The exact-zero fallback picks a side without removing the seam.

The production blend, with synthetic opposing 19.4384-kn inputs, reversed **180 degrees** across **0.222 m**, producing a **38.8768-kn vector jump** with unchanged scalar speed. Near-opposed winds have the same ill-conditioned neighbourhood. This is boundary evidence, not an assertion that current NOAA observations contain this exact configuration. Existing 90-degree tests cannot expose it.

D-017 intentionally asks for scalar speed preservation, so simply replacing the result with an ordinary vector mean would change the chosen contract. Recommended direction: define and test a directional-disagreement/cancellation policy explicitly, and qualify it before any served-number change. NOAA documents the distinction between HRRR's extended and ordinary cycles; correct horizon handling alone does not make cross-model blending scientifically smooth. [NOAA HRRR inventory](https://www.nco.ncep.noaa.gov/pmb/products/hrrr/) · [reproduction](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/forecast-spec-repro.py).

**F5 · P2 — Zoom 6 has a visible, speed-dependent density discontinuity.**  
[WebGLWindUtils.js:435](C:/Users/David/.codex/worktrees/7dd9/raw-surf/frontend/src/components/map/WebGLWindUtils.js:435) switches density from 490 to approximately 350 immediately above zoom 6. At [line 467](C:/Users/David/.codex/worktrees/7dd9/raw-surf/frontend/src/components/map/WebGLWindUtils.js:467), the full speed cull also switches on. At 45 kn the effective requested population drops **67.1%** across a 0.00001 zoom increment. This percentage describes target marks, not pixel brightness.

Actual-engine GPU verification, same seed/DPR 1.5 and 240 virtual 60-Hz frames:

| Constant wind | Default mean screen L*, z5.999 → z6.001 | With new density/cull disabled |
|---|---:|---:|
| 10 kn | 37.655 → 34.456 | 37.655 → 36.789 |
| 45 kn | **43.059 → 35.916** | **43.059 → 43.253** |

The 45-kn control isolates the new density rules from the older coordinate transition. No GL errors occurred. The z6 step was already acknowledged in program records; this audit quantifies it independently. Recommended direction: qualify a continuous density/cull transition against both perceived brightness and flow readability. [Before](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/z6-45-5.999-default.png) · [after](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/z6-45-6.001-default.png) · [controlled results](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/z6-gpu-results.json).

**F6 · P2 — Motion evidence can be silently reused from another experiment or build.**  
[motion-run.js:70](C:/Users/David/.codex/worktrees/7dd9/raw-surf/frontend/scripts/wind-bench/motion-run.js:70) and [crops.js:45](C:/Users/David/.codex/worktrees/7dd9/raw-surf/frontend/scripts/wind-bench/crops.js:45) omit source SHA/ref, theme, zoom, wind multiplier, frame count, particle pool, DPR/map DPR, dimensions and crop centre from important parts of the cache identity. Reusing a run name and output file can print “cached” and preserve old captures while printing a new engine label. Dark and beach even share the same black page value.

Direct calls to the actual cache predicate accepted nine separately changed experiment fields. This proves a tool defect; it does not establish that Claude's past decisions used contaminated evidence. Recommended direction: content-address the full experiment, record the immutable source SHA, and refuse ambiguous legacy cache entries. [Reproduction](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/motion-cache-repro.cjs) · [results](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/motion-cache-repro-results.json).

**Older issues still open — do not attribute these to the new wind patches**

- **P1 security residual:** [crew_chat_reactions.py:258](C:/Users/David/.codex/worktrees/7dd9/raw-surf/backend/routes/crew/crew_chat_reactions.py:258) authorizes its private-chat WebSocket using a member ID supplied in the URL, without authenticating the connecting caller. An offline real-route probe, using only synthetic booking/member data, connected without Authorization, registered as that member and received a private broadcast. Knowledge of the booking and member identifiers is required. #290 improves the adjacent reaction route; this socket is unchanged from baseline. [Security report and reproduction](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/security-standards-audit.md).
- **Historical nearshore joins remain wrong:** [run_nearshore_validation.py:271](C:/Users/David/.codex/worktrees/7dd9/raw-surf/backend/scripts/run_nearshore_validation.py:271) still stamps requested time after discarding the actual served time. Repeated on the current head: a synthetic +1-hour response produced **36 accepted matches and exit 0**, while actual-time matching produced **zero**. Exact-time positive control: 36. This does not claim 36 bad rows in a live run.
- **The judge still observes only part of breaking physics.** Changing the Komar flag moves synthetic served height **2.1817 → 3.1930 m**, while the buoy-depth judge remains **1.6471 m**. Grading transformed significant height is useful, but does not validate all displayed breaking-height operations. A freshly read scheduled run now emits GRADED; that is progress over October 8's armed-off state, not closure of these two defects. [Run 38489749187](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/38489749187).
- **Cache instant identity and archive capacity remain pending.** The prior finer-marine-cache helper and core physics files have no delta in this audit interval; #264 remains conflicting. Monthly skill JSON/pending-entry capacity requires actual storage/read-back acceptance; this audit did not remeasure the archive or assert a failure date.
- **First zoom-in still lacks fine observations.** Claude's recorded ladder experiment reports about 21 km eye displacement, a 12-kn weakest-wall change and approximately 6.7-times eye area at the coarse tier. Those are inherited measurements, not fresh numbers here. Holding fine nodes improves zoom-out after they have arrived; it cannot reconstruct absent fine nodes during first zoom-in. Existing world-row/bounds and coarse cache-identity issues remain recorded too.

**Visual and animation assessment**

The work is materially stronger than the baseline: point registration, coherent white streaks, land/sea treatment, trail anchoring, and light/beach colour paths have explicit instruments and controls. The new lane label supplies accessible status text across layouts. This is better evidence than a screenshot-only review.

I ran **51 GPU configurations**: five zooms × three themes × three seeds, plus paired positive controls. The positive control detected the deliberately restored defect in all three seeds and rejected it in the repaired arm. The default retained **four recurrent scanner clusters across the three z6.5 theme views**, plus two non-recurrent signals. The other sampled zooms (3, 6, 8, 11) had none. These are investigation signals, not four proven application defects or four independently diagnosed root causes. The standard scanner page intentionally supplies no land mask; its 404s do not establish a production asset failure.

A separate offline map capture ran 90 motion frames in each theme after 180 warm-up frames, using the real current engine and a recorded wind fixture. **No page errors, no GL errors; canvas alpha stayed 1.0; light/beach land masks were ready.** The captured land/sea hierarchy and flow texture are visible in the [playable evidence viewer](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/evidence-viewer.html). It starts paused. The map is synthetic: these captures cannot certify actual labels, roads, satellite styling, responsive controls or live network behavior. Recorded sequence playback is not a production FPS measurement.

The colour improvements have narrow margins and incomplete final-display evidence: the checker models texture rounding but not every final framebuffer/display conversion. The new Jacobian tool itself differs from its embedded historical GPU ground samples by up to about **3.03 L*** in light land and **4.40 L*** in beach land. Those are comparisons to its stored reference measurements, not fresh map measurements. Use it for sensitivity direction and scale, not as an exact moving-picture oracle. Desktop emulation also does not establish mobile `mediump` precision behavior; Khronos explicitly notes that desktop precision can conceal lower-precision shader issues. [Khronos precision limitation](https://registry.khronos.org/webgl/extensions/rejected/WEBGL_debug_shader_precision/).

Accessibility acceptance must remain separate from palette-distance tests: inspect real keyboard controls, theme contrast and motion controls. WCAG requires a pause/stop/hide mechanism for qualifying prolonged automatic motion; this review does not claim a new violation merely because wind animates. [W3C guidance](https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide.html).

**Jacobian lens: smooth sensitivities, seams and blind measurements**

For physical outputs `y=[breaking height, quality]`, use `J=∂y/∂x` locally. Re-running the previous probe on current source defaults gave the same synthetic result at Hs 2 m, period 12 s, direction 35 degrees off normal, wind 8 kt and uncapped deep geometry:

| Input | Height derivative | Rounded quality derivative |
|---|---:|---:|
| Hs, per metre | +1.18366 m | +15.0 points |
| Period, per second | +0.09864 m | +2.5 points |
| Direction, per degree | −0.012945 m | −0.7 points |
| Wind, per knot | 0 m | −0.9 points |

These are local derivatives in different units, not a global ranking of error sources. Rating rounding limits precision. Splitting one sea into 2/3/6 identical equal-energy trains still inflates height **7.18% / 11.61% / 19.62%**. The depth cap still makes Hs 6/8/12 m all produce **7.533 m** in the chosen shallow-break fixture. Both were prior findings; no source-default physics improvement is inferred from visual progress.

This audit adds three practical seams to that lens: **forecast identity can jump while geometry looks stable (F1), normalized cross-model directions can have an unbounded derivative (F4), and zoom alone can alter perceived wind strength (F5).** F2 and F6 show why an instrument's own sensitivity and identity matter. A measurement that omits the real blend or reuses the wrong experiment cannot close an acceptance claim.

Use measured input covariance in `Σy ≈ J Σx Jᵀ` only inside a regime where the linearization is credible. At caps, time/cycle changes, opposing bearings and zoom thresholds, use explicit boundary sweeps and invariants instead. [Fresh science probe](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/science_probe.py) · [numerical results](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/probe-results.json) · [visual sensitivity tables](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/visual-jacobian.txt).

**Standards axis — independent review**

The identity-binding delta improves authorization and matching frontend callers use the shared JWT client. No introduced auth bypass was found in that subset. Existing repeated guard clauses are justified; naming and abstraction preferences were not promoted to defects. CI floor/reference updates are paired. The BOLA ratchet passes at **269 residual routes**, down from 289; a ratchet pass does not certify those routes. A six-pattern scan of added lines found no secret-pattern matches; it is neither a whole-history secret audit nor a dependency-advisory audit. One material standards/security residual was confirmed: the unauthenticated crew-chat socket. [Independent standards report](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/security-standards-audit.md).

**Specification axis — independent review**

D-017 authorizes the default-on map-only HRRR lane, scalar speed preservation, explicit horizon/geographic blending and honest source words; it does not authorize a duplicate surf-rating path. The new queue/recovery work largely implements bounded windows, current-view priority and guarded ownership, and its focused tests pass. Two backend contract boundaries remain: same-cycle repairs are invisible to the loader, and directional normalization invalidates a general smooth-seam claim. Scientific skill and first-zoom fidelity are separate from matching models at common nodes. [Independent specification report](C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81/forecast-spec-audit.md).

**Operational evidence and verification limits**

- Frontend: **67 suites / 1,462 tests passed**, including wind, registration and auth/session cases. Windows CRA path matching and sandbox cache permissions initially prevented execution; explicit test patterns and a writable cache resolved those harness failures.
- Backend: 208 standards/governance/auth test executions and 221 forecast test executions passed; the eligibility file overlaps, so these counts must not be added as unique tests. The detailed reports list files. Local Python lacks declared pygrib and uvloop: successful mocked fetcher tests are not live GRIB or Render verification.
- Current #330 source CI is green. Latest checked [dev E2E run](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/38337078973) failed in Run E2E tests. Logs include missing WebGL support and network/auth fixture errors; no single root cause or application regression was established here.
- Latest checked [marine nightly](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/38413753461) **REFUSED** incomplete evidence: zero reported renderer findings, two instrument timeout findings. A refusal cannot be counted as a visual pass.
- Lightweight live reads: backend healthy at `f9320c27`; data-health warning for ICON marine conflicting cycle, ICON weather missing cycle, and EURO marine conflicting/missing cycle with fallback source. This is provenance uncertainty, not proof every value is wrong.
- Current records say production frontend remains frozen at `fc140024`; this audit did not independently re-read that production build. Promotion to main is not deployment acceptance.
- Memory audit before report writes: **0 FAIL, 14 WARN, 24 NOTE**. Overdue acceptance commitments remain open. No scheduled jobs were dispatched to close them.
- No live penetration test, complete dependency scan, real-phone/120-Hz device test, full responsive screen-reader review, empirical forecast regrade, load test, or complete provider-log review. Browser testing was offline and production traffic was limited to lightweight health reads.

**Recommended order, without performing repairs**

1. Correct forecast-identity gating and the existing private-chat socket authorization.
2. Make colour/motion evidence trustworthy, then qualify the zoom transition and HRRR reload seam with failing-before/passing-after probes.
3. Decide and validate a cancellation/disagreement policy for the scalar-preserving HRRR blend.
4. Integrate #264 without losing newer wind behavior; re-run its exact-head acceptance and actual-time scientific matching.
5. Close bounded live acceptance and real-device checks only with matching deployed source and explicit evidence. Preserve the owner's scientific flag and production-release decisions.

The result is **six findings in the audited delta, one confirmed pre-existing security residual, and several still-open scientific/operational acceptance gaps**. The standards and specification conclusions above remain separate; a green result on one does not substitute for the other.

**Evidence availability:** source references are pinned to the audit worktree head. Evidence files and the prior uncommitted audit are local to this machine; this report and its ledger entry are uncommitted until deliberately published through the repository's normal process. No external report or message was posted on the owner's behalf.

