# Raw Surf — consolidated audit repair handoff

Saved from the owner's requested paste-ready handoff. Audit observations were collected October 13, 2026 EDT, extending into October 14 UTC. No application repairs were made during either audit.

## Purpose

Use this as the repair and verification backlog from two independent audits. Confirm current source before assuming any finding remains unfixed. This handoff does not authorize deployments, production-data writes, merges, or owner-controlled flag changes.

## Audited snapshot

Repository: `C:/Users/David/.codex/worktrees/7dd9/raw-surf`

- Baseline: `ab416298d30bf98932d7be5ee0868714c34e43b3`
- Merged dev at audit: `131d5d9e434124d9bf510edb9eed2e8238723313`
- Audited final head, including pending PR #330: `2e41e83a72a4ac260e18a9c79048e0fa27372aba`
- Scope: 62 commits, 296 changed files.
- PR #264 was open/conflicting at `de490d11` and contained proposed older repairs. Neither PR state nor deployment state should be assumed current.

Reports, relative to repository root:

1. [First audit](log/2026-10-13-codex-delta-forensic-audit.md)
2. [Final audit](log/2026-10-14-codex-final-forensic-audit.md)

Evidence root, abbreviated **E** below:

`C:/Users/David/.codex/visualizations/2026/10/09/01a1224e-394f-7062-b9f3-7a6d0ce6cc81`

At handoff creation these reports and evidence were local. Publication update (2026-10-15): this handoff and both linked audit reports are committed on local branch `codex/audit-handoff-docs-2026-10-15`, based on dev `b660815e`, independently of the active repair branch. The external evidence directory remains machine-local and is not included in this documentation publication. These are historical audit findings, not a claim that every finding remains open; reconcile current repair logs and ownership before editing. Public push is pending explicit approval after automatic approval review rejected the six-file publication payload. A fresh local context can read this branch; another clone cannot fetch it until publication is approved. No application repairs are included.

## Startup and working rules

- Read AGENTS.md, CLAUDE.md, BRAIN_RULES.md, and docs/weather-program/README.md, STATE.md, DECISIONS.md and relevant LESSONS.
- Inspect git status, actual branch/head, open PRs, and concurrent work. Preserve the existing audit documents and ledger changes.
- Use Trevec if exposed; otherwise use targeted Git/source searches.
- This repository is PUBLIC. Never put credential values in tracked files, test fixtures, reports, or captured logs.
- Weather-program logs/ledgers are append-only. Use one session-owned log. Shared-file changes require exact replacements. Use action_ledger.py append, update STATE's ledger anchor, and verify the chain.
- Every fix changing a served number needs a SCOREBOARD row.
- Respect the shared 1-CPU backend. Start with offline probes; do not turn acceptance testing into an unbounded production load test.
- Preserve owner decisions, especially D-017's scalar-speed blending contract.
- Run mutations in isolation. Never let a reviewer or benchmark read sources while another process temporarily mutates them.
- Line numbers below refer to the audited head and may drift.

## Repair order

1. P1 private-chat authentication and P1 forecast-identity retention.
2. False recovery coverage and actual-time scientific matching.
3. Background-task cancellation before enabling the optional bounded mode; same-cycle HRRR reload and truthful model labels.
4. Repair measurement tools before using them to tune or approve visuals.
5. Qualify zoom continuity and directional cancellation.
6. Resolve older marine/scientific gaps and complete source-matched release, device and live acceptance.

For every repair: reproduce the defect on the audited/current failing source, add a meaningful regression test, show it passes after the repair, preserve positive controls, and report the exact tested SHA. A green existing suite alone does not close a finding.

## P1 — Security residual: private crew-chat WebSocket

**Status:** pre-existing; not introduced by the new wind work.  
**Source:** backend/routes/crew/crew_chat_reactions.py around 246–263.

The socket trusts booking/member IDs from its URL. It checks that the supplied member belongs to the booking without authenticating that the caller owns that identity. An unauthenticated synthetic client received private broadcasts and registered as the victim. Knowledge of both IDs is required.

**Repair:** authenticate the connection using the app's supported browser-compatible mechanism; derive identity from verified credentials and enforce membership.

**Acceptance:**

- Missing, invalid and expired credentials cannot join or receive broadcasts.
- Authenticated outsider cannot join.
- Member A cannot become member B by changing the URL.
- Authorized member connects, receives permitted messages and sends typing events under their own verified identity.
- Rejected sockets never enter the broadcast registry.
- Disconnect cleans up membership; adjacent HTTP reaction behavior still works.
- Use an offline real-route test with synthetic records, not live exploitation.

**Evidence:** E/security-standards-audit.md; E/security-websocket-probe.py.

## F1 — P1: finer old data can block a fresh forecast

**Sources:** frontend/src/components/map/WebGLWindEngine.js around 226–229; windTierMosaic.js, windOverlayKeep.js, WeatherEngine.js, windController.js.

Early resolution-preservation returns precede strict time/cycle/lane eligibility. One replay retained stale 00Z, 0.25° data at 10 kn over fresh 06Z, 0.5° data at 40 kn. A second replay through WeatherEngine's actual delivery closure retained the exact old fine object when a fresh 2° covering clip arrived. A 1° control correctly replaced it.

**Repair:** establish authoritative forecast eligibility before resolution preference. Inspect every early retention/no-op path, not just one setter branch.

**Acceptance:**

- Reproduce both noop_coarser_than_fine and noop_base_clip bypasses.
- Same requested-hour label with different served time cannot retain wrong air.
- Different verified cycles and HRRR/GFS lane identities are handled correctly.
- Stale-to-fresh rollover works through the actual delivery chain.
- Late older arrivals cannot overwrite newer eligible data.
- Same-time/cycle/lane coarse arrivals still preserve useful fine detail.
- Pan, zoom-out and timeline rollover retain correct values AND provenance.
- Define and test behavior when provenance is missing; do not silently treat unknown identity as proven equality.

**Evidence:** E/visual-source-repro.cjs; E/second-audit/visual-contract/transition.cjs; E/second-audit/visual-contract/transition.cjs.txt.

## A2 — P2: failed hours are falsely recorded as recovered

**Sources:** backend/services/weather_pipeline/wind_native_recovery.py around 343–346; viewport_helper.py around 521–522.

The helper catches per-hour failures, but recovery records the entire window as successful. Missing products can then suppress useful retries for the default 600-second reuse interval. Native recovery defaults on.

**Acceptance:**

- Inject failure for target−3h and target+3h while target succeeds.
- Successful target remains reusable.
- Missing +3h is eligible for recovery in a different contained bbox.
- Different-bbox test must distinguish the defect from old exact-key cooldown.
- Test normalization failure and persistence failure separately.
- Total failure publishes no successful coverage.
- Coverage/counters/logging describe actual success, not attempted hours.
- Genuine completed coverage still prevents duplicate work.

**Evidence:** E/second-audit/fault-order/probe.py; E/second-audit/fault-order/probe-results.txt.

## A1 — P2, flag-conditional: cancelled requests retain background tasks

**Sources:** backend/services/weather_pipeline/viewport_service.py around 313 and 471; wind_bg_build.py around 74–76.

**Condition:** WIND_BG_BUILD_BOUNDED=1. This flag DEFAULTS OFF; do not claim live exposure without reading actual configuration.

asyncio.shield leaves hour futures pending after caller cancellation. The new keeper mistakes those futures for live subscribers. Six cancelled requests retained six background tasks, versus one flag-off.

**Acceptance:**

- Replay the six-box cancelled-sharing-request sequence with gated scheduling.
- Cancelled callers stop protecting obsolete tasks.
- Task/context retention stays within an explicit bound as request count grows.
- With two real subscribers, cancelling one must not disrupt the other.
- Test timeout, cancellation before registration, after registration, and cancellation racing completion.
- Flag-off behavior and served numerical results remain unchanged.
- Every waiter resolves/fails appropriately; no orphaned ownership records.

**Evidence:** E/second-audit/fault-order/probe.py; E/second-audit/fault-order/findings.md.

## F3 — P2: same-cycle HRRR repairs do not reload

**Sources:** backend/services/weather_pipeline/wind_lane.py around 190; wind_lane_ingest.py around 68–75.

Ingest can repair the object at the same key; loader treats unchanged key as unchanged content. Storage had 49 hours while the warm process retained 48.

**Acceptance:**

- Warm a process with a missing non-horizon hour.
- Publish a repaired same-cycle object and advance the refresh clock.
- Warm process sees the repaired hour without restart or new cycle.
- Fresh and already-running processes agree.
- Unchanged revision avoids unnecessary downloads.
- Corrupt replacement/transient storage failure preserves the last good lane.
- Test index/object publication ordering and recovery after a failed refresh.

**Evidence:** E/forecast-spec-repro.py.

## A3 — P2: model status does not follow visible data

**Sources:** frontend/src/components/map/windLane.js around 30–36; WindLaneStatus.js; WebGLWindEngineInit.js around 201; WindParticleOverlay.js.

Status prefers any resident fine grid, even offscreen. Europe fine GFS followed by a pan to the US still announces GFS while the visible base is HRRR+GFS. On WebGL disposal/Canvas fallback, the label disappears entirely.

**Acceptance:**

- Global HRRR+GFS → Europe fine GFS → US pan reports visible provenance.
- Partially overlapping tiers produce an honest mixed-coverage description.
- Model/time changes remove stale labels.
- WebGL failure → Canvas preserves correct model and horizon-transition text.
- Renderer recovery, inactive state and unmount clean up correctly.
- Accessible status agrees with visible text and does not announce unchanged messages continuously.
- Use mounted integration tests as well as helper tests.

**Evidence:** E/second-audit/visual-contract/transition.cjs.

## F2 — P2: dark colour checker models the wrong compositing law

**Sources:** frontend/scripts/wind-color/check.mjs around 86; frontend/src/components/map/WebGLWindShaders.js around 992; WebGLWindEngine.js around 590.

Checker models c*a + background*(1-a); audited GPU path produces c*a² + background*(1-a). Corrected analytic sweep found a failing pair at all 281 tested maxima. Actual GPU tritan separation was about 2.955 dE2000 for 47/55 kn at maximum 60 kn, not approximately the 5.0 project floor.

**Acceptance:**

- Pin predicted RGB against actual framebuffer pixels, including the recorded ground RGB(93,117,126), 47/55 kn and maximum 60.
- Test actual uploaded LUT sampling/rounding and all three themes.
- Sweep maxima 10–80 by 0.25 over land and water.
- Report each relevant colour-vision simulation and failing pair.
- Preserve a deliberately wrong-equation positive control that must fail.
- Correcting the checker may legitimately leave the palette FAILING. Do not lower thresholds or call the palette repaired merely because the instrument now measures honestly.
- Any palette/renderer change requires fresh visual and numerical acceptance.
- The project dE threshold is not WCAG certification.

**Evidence:** E/dark-composite-probe.py; E/colour.txt; E/z6-gpu-results.json.

## F6 — P2: motion cache can reuse another experiment

**Sources:** frontend/scripts/wind-bench/motion-run.js around 70; crops.js around 45.

Cache identity omits important build/experiment fields.

**Acceptance:**

- Independently vary source SHA, theme, zoom, wind multiplier, frame count, particle pool, DPR, map DPR, dimensions and crop centre.
- Every output-affecting change invalidates the appropriate cache.
- Identical complete inputs reuse it.
- Different builds cannot print a fresh label over old captures.
- Legacy incomplete metadata, missing/truncated files and interrupted writes cannot be silently accepted.
- Preserve immutable source/config/fixture identity with each result.

**Evidence:** E/motion-cache-repro.cjs; E/motion-cache-repro-results.json.

## A4 — P2: singular fit falsely reports “no veil”

**Source:** frontend/scripts/wind-bench/truth.js around 193–194.

Rank deficiency forces q=0 instead of reporting unidentified coefficients. Independently generated dark p=q=.505 returned p=.332, q=0, RMS=0 on a degenerate gray fixture.

**Acceptance:**

- Ground64/trail128 synthetic fixture reports non-identifiability, not a uniquely measured q=0.
- Diverse trail levels 30–228 recover p≈q≈.505 within quantization tolerance.
- Sweep nearly singular cases and report conditioning/uncertainty.
- Handle empty, saturated and uninformative observations honestly.
- Do not classify a compositing law solely from zero residual.
- Generate reference pixels independently from the estimator helper.

**Evidence:** E/second-audit/instruments/probe.mjs; E/second-audit/instruments/results.json.

## A5 — P2: artifact count depends on seed order

**Source:** frontend/scripts/wind-bench/replicates.js around 29–32.

Greedy clustering changes majority verdict when identical observations are reordered. Five seeds at x=0/60/120/180/240 flip from zero to one artifact.

**Acceptance:**

- All 120 permutations of that five-seed fixture produce the same verdict.
- Define expected grouping explicitly; stable sorting alone must not conceal an invalid matching rule.
- Cover multiple clusters per seed, non-transitive proximity, ties and duplicate observations; one seed cannot count as multiple votes.
- Recheck all saved real groups and positive controls.
- The earlier 17 actual three-seed groups already survived all six permutations; do not claim those earlier counts were overturned.

**Evidence:** E/second-audit/instruments/probe.mjs; E/second-audit/instruments/followup.mjs; E/second-audit/instruments/followup-results.json.

## F5 — P2: zoom-6 visual discontinuity

**Sources:** frontend/src/components/map/WebGLWindUtils.js around 435 and 467; WebGLWindShaders.js.

Density and speed culling change abruptly just above zoom 6. At 45 kn, target marks fell 67.1%; measured L* fell 43.059→35.916. With new rules disabled, the control stayed 43.059→43.253.

**Acceptance:**

- Sweep both directions across zoom 6, with dense samples around the boundary.
- Hold field, seed, camera, DPR and elapsed simulation time constant.
- Test calm/moderate/strong wind across dark/light/beach, land and water.
- Verify continuous density/culling behavior and absence of a perceived pop.
- Compare imagery and motion, not merely target particle counts.
- Include multiple seeds/DPRs and actual map composition.
- Set a justified visual tolerance before tuning; do not invent one afterward.
- Preserve fine-detail, field strength and particle-motion correctness.

**Evidence:** E/z6-gpu-results.json; E/z6-45-5.999-default.png; E/z6-45-6.001-default.png; E/evidence-viewer.html.

## F4 — P2: HRRR/GFS directional cancellation singularity

**Source:** backend/services/weather_pipeline/wind_lane.py around 303–313.

v = S*B/|B| becomes ill-conditioned as blended vector B approaches zero. Synthetic opposing 19.4384-kn winds reversed 180° across 0.222 m.

**Repair constraint:** D-017 intentionally preserves scalar speed. Do not silently replace that contract with ordinary vector averaging. Define a cancellation/disagreement policy before changing served behavior.

**Acceptance:**

- Sweep directions through 170–190°, weights across 0.5, equal/unequal speeds, calm inputs and tiny perturbations.
- Cover spatial feather and temporal handoff.
- No NaN/Inf; finite, deterministic output under the chosen policy.
- Verify scalar-speed and endpoint contracts where applicable.
- Measure sensitivity near cancellation; any intentional discontinuity must be explicit and qualified rather than described as generally smooth.
- Recheck common-node consistency across tiers and realistic stored fixtures.

**Evidence:** E/forecast-spec-repro.py.

## Older scientific/marine issues — still open

### B1. Actual-time validation joins — high priority

**Source:** backend/scripts/run_nearshore_validation.py around 271.

Requested time replaces actual served time. The +1h fixture falsely produced 36 matches/exit 0; actual-time matching yielded zero.

**Test:** retain the exact-time 36 positive control; shifted fixture must not get those false matches. Carry served time, cycle, source and estimation status through every comparison arm. Test nearest-frame substitution, backfill and missing metadata. Preserve 29-station-hour refusal/30-hour eligibility. GRADED is not an accuracy threshold.

### B2. Judge covers only part of published breaking physics

**Source:** nearshore_validation.py and canonical surf transform.

Komar change moved served height 2.1817→3.1930 m; judge stayed 1.6471 m.

**Test:** preserve an explicitly named buoy-depth-Hs metric; independently test the full published breaking-height path. Each metric must respond to the parameters it claims to validate. Use observations of the matching quantity; do not compare buoy Hs with face/set height as interchangeable truth.

### B3. Marine finer-cache actual-instant eligibility

**Source:** frontend/src/components/map/marineSeriesFinerEntry.js.

Earlier replay selected finer 10:00 data over exact 12:00 under equal hour label 16.

**Test:** same-label/different-instant rejection, rollover, different model, same-instant finer selection and integration with pending #264.

### B4. Decimated world bounds do not always describe retained nodes

**Sources:** series_vector_budget._decimate_frame, normalizer, gridPointRegistration.js.

Recorded example: 181×83, stride 4 retains latitude −80..80 but bounds say −80..84.

**Test:** coordinate-valued synthetic grids across odd/even shapes and strides; retained nodes must map to their real positions. Include world base ingestion, clipping, dateline and poles. Existing measurements are inherited; reproduce.

### B5. Coarse marine base identity uses shape rather than content

**Sources:** marineEngineDecisions.js coarseBaseKey; WebGLMarineEngine.js.

**Test:** same shape/hour label with new cycle, valid time or values refreshes the base; genuinely identical content avoids needless recapture. This was source-supported, not a fresh on-screen reproduction.

### B6. Partition/geometry sensitivities and caps

Splitting equal-energy identical trains into 2/3/6 increased height 7.18%/11.61%/19.62%. Backside/head-on ratio was about 59.5%. A shallow-depth fixture caps Hs 6/8/12 at 7.533 m.

**Test:** equivalent-partition invariance for any proposed physics repair, direction/bathymetry/tide sweeps, cap-boundary continuity and canonical-path parity. A deliberate physical cap is not automatically a bug to remove. Qualify candidates on paired held-out observations before owner activation. Use local Jacobians within regimes; explicit sweeps at discontinuities.

### B7. First zoom-in lacks fine observations

Inherited storm-ladder measurements: about 21 km eye displacement, 12-kn weakest-wall change, 6.7× eye area at coarse tier.

**Test:** cold-cache full zoom-in AND warmed zoom-out using one time/model fixture; measure eye position, wall strength and area. Retaining previously loaded fine data does not prove cold-start fidelity. Set domain-justified tolerances.

### B8. Skill archive capacity/durable publication

**Source:** forecast_skill.py; proposed work in #264.

Monthly JSON growth and 54,000 pending cap remained concerns. No current failure date was established.

**Test:** realistic payload sizes, month rollover, bounded retention, upload failure, durable read-back and compatibility of both readers. Preserve pending data on failed publication. Re-measure actual limits; do not repeat an old deadline as fact.

### B9. Scientific acceptance remains incomplete

Use paired forecasts/observations at actual times, disjoint evaluation blocks, lead/coast/sea-state stratification and uncertainty accounting for dependent station/storm observations. Thirty readings are not necessarily 30 independent samples. Multi-model spread is not automatically calibrated uncertainty.

## Secondary residuals / hardening

- Native recovery A-running → B-waiting → final A still executes obsolete B. Test final-view superseding without duplicating A or cancelling useful work.
- Regional → global wind warm-up leaves regional requests alive. Test actual transport abort signals; regional→regional and unmount are positive controls.
- Both preserve baseline behavior; do not label them new regressions.
- controlAcrossSeeds drops incomplete pairs and can return PASS. Test missing either arm, duplicate seeds and empty input => incomplete/refuse. Normal current runner generates/awaits complete pairs, so no observed false PASS on that normal path was established.

## Verification already done — not proof of future repairs

- 67 frontend suites / 1,462 tests passed.
- Backend reviewers reported 208 and 221 passing executions with overlap; do not sum them as unique tests.
- 51 actual GPU configurations plus three-theme motion captures.
- Offline fault, state-transition, security and scientific probes.
- 249 changed source/config/test/fixture hashes remained unchanged.
- No full live penetration test, dependency-advisory audit, new empirical forecast regrade, real-phone/120-Hz acceptance or full accessibility review.

**Environment:**

Backend Python: `C:/Users/David/App/raw-surf/backend/.venv/Scripts/python.exe`

That environment lacked declared pygrib and uvloop; mocked tests do not prove native GRIB/production compatibility.

Chrome: `C:/Program Files/Google/Chrome/Application/chrome.exe`

Frontend node_modules were local junctions into the main checkout. Verify dependencies before trusting reproducibility; do not delete junction targets during cleanup.

## Release / visual acceptance still required

Audit observations on October 13, 2026 EDT:

- Dev service worker 131d5d9e; production fc140024 at about 10:11 p.m. (02:11 UTC October 14).
- Backend previously observed f9320c27; its difference to dev was docs-only.
- Latest checked dev E2E failed; root cause was not uniquely established.
- Marine nightly REFUSED because of instrument timeouts; not a visual pass.
- Data-health had ICON/EURO provenance warnings.
- Refresh all of these; none is a claim about the current deployment.

After repairs:

- Run focused failing-before/passing-after tests and relevant complete CI lanes.
- Use exact source/config/fixture identities and fresh evidence caches.
- Positive controls must detect deliberately restored defects.
- Test actual app layer stack, page background, theme switching, pan, zoom, resize, timeline, context loss/recovery and Canvas fallback.
- Include real mobile GPU precision, high-refresh motion, keyboard/screen-reader behavior and motion controls.
- Revisit four recurrent z6.5 scanner clusters; they are investigation signals, not four separately diagnosed bugs.
- Match browser bundle and backend identity before bounded live acceptance.
- Keep healthy, available, GRADED, visually acceptable and scientifically accurate as separate conclusions.

## Do not “fix” rejected suspects

- Jacobian 10%-turn columns intentionally report finite changes; missing division by 0.1 was not a demonstrated units error.
- Calm/veil exclusions in that tool are documented limitations.
- Step-size variation at piecewise knots is not itself an optimizer defect.
- Task-identity checks already prevent an old native-job callback from deleting its replacement.

## Closeout required from the repair session

For each ID report:

- reproduced / fixed / deferred / not reproducible;
- exact source change and tested SHA;
- failing-before and passing-after evidence;
- positive controls and remaining limits;
- served-number/flag/deployment impact;
- memory, ledger and scoreboard updates where required.

Do not close an issue merely because an existing suite is green, a PR exists, a fit has zero residual, a screenshot looks better, or the API is healthy.

