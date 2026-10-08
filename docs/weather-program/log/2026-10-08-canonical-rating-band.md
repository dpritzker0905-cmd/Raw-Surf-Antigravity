# Canonical coastal rating band — 2026-10-08

Owned by Codex on `codex/a8-weather-audit-repairs`; times UTC.
Authority: owner requested continued weather repairs, forensics and a Jacobian lens,
publication, and progress. Scientific activation remains an owner decision. No
live forecast probe, shared-data write, merge, deployment or flag change occurred.

## Reconciled starting point

Canonical dev remains `fe5573db42bb8b147f4d085a39d540134bd2f8b4`, ledger960.
Draft #264 source `11c8511c18051d14fb6d4f9566e575acb297e5f4` now has complete
successful hosted CI37814283377: guards2642 across191 files, 67 skipped;
chain2508 across165 files; estate1455, 306 selected/304 producing, zero silent.
These qualify the hub-index source. The new physics candidate requires its own CI.
Unrelated open #266 at `c63b7f3d2b5ccfcf33b9eb788f0a868998b4c3f3` is excluded.

Commitment863 is already fulfilled by ledger883 at qualified documentation scope.
PR254 merged as3310b6f5; do not repeat that rollout or equate it with product
acceptance. Commitment860 remains open: no fulfillment entry exists. The three
PR253 mask/cache/pixel repairs retain their qualified scope.

## WC-01: same-input counterexample, then the candidate

The historical Snapper scores did not reproduce exactly in the current fixtures.
Current real public-overlay/reference comparisons use identical stored 4m/16s
waves, 6kt offshore wind and a global1.2m reference at three public coordinates.
The existing band scores97.3 at Snapper, Cocoa and Trestles; the real point
resolver plus `rate_one_spot` scores96.1, 78.7 and90.1 respectively. The corrected
before instrument reports three failures and one passing default-off null control.
Its first exploratory run used an unsuitable Snapper >10-point null assertion;
that fixture error is not evidence of a production failure.

The default-off `SURF_RATING_CANONICAL_BAND` candidate grades only loaded combined-sea
`waves` cells through the actual reference `rate_one_spot`, with full geometry and
`estimate_surf_at`. It adds no per-cell forecast or tide fetch. Anonymous cells
have no best-tide prior; a keyword-only preloaded tide override preserves automatic
tide behavior for existing reference callers. Cell-local reference and observation
cap policies remain explicit. Global skips, other marine layers and height mode
retain their existing path. Offshore `phys_speed` and direction vectors are retained.

Partitions, tide-depth and nearshore-MOP refinements lack the necessary inputs in
this combined-sea grid: the candidate refuses them before mutation and the public
overlay returns raw wave heights with a diagnostic. It does not claim parity for
those configurations or for named spots with different local priors.

A second-cell geometry failure initially returned one graded cell mixed with raw
heights: one genuine new failure plus15 passing controls. The worker now grades
private vector copies and publishes them only after complete success. The same
failure control returns wholly raw heights and preserves the original product.

Qualified local run:175 affected controls pass, including23 new cases and152
companions;40 floor/publication controls also pass. Existing tide auto-fetch and
explicit preloaded tide grade compare identically. Optional input refusals, global
skip, other layers, height mode, default-off identity, invalid/ocean/zero cells,
callback failures, observation cap and atomic failure publication are exercised.
An earlier exploratory run failed due to a shared fixture-store object; deep copies
restore the actual ProductStore boundary without removing any assertion.

## Jacobian evidence

The regression uses three heterogeneous seas and12 forward sensitivity columns
(height, period, relative swell bearing and wind speed), matching the actual
point/reference path within score-channel quantization. A1% score multiplier and
a10% breaking-height mutant are both detected. No forecast-accuracy claim follows.

Claude's `physics-jacobian/scripts/compare_paired.py` comparator definitions were
reused without running its historical snapshot jobs. Three matching base states
and12 central-difference columns give zero differing rows after the candidate;
maximum derivative difference is1.43e-14. The repeated candidate null is exactly
zero. Before, Cocoa's0.55m/9s/80degree/12kt state grades15.2 versus8.9 and its height
derivative differs by9.375 points/m. A1% score mutant differs at all three states.
This receipt compares numerical grades/derivatives; it does not test level labels.

## Offline cost and activation boundary

Three measured warm worker samples per mode follow one warm-up, at100 and400
distinct coastal cells for each of the same three coordinates. Qualified400-cell
median legacy/candidate costs in milliseconds: Snapper9.007/31.996;
Cocoa8.882/35.920; Trestles9.237/33.048. Each sample grades400 cells and masks zero.
An initial timing invocation swapped two legacy positional callback arguments;
its timings are discarded. The corrected invocation matches the production call.
Cold-start cost, scheduling gaps, largest served frames, shared-host capacity and
live smoothness were not measured. These small warm measurements do not justify
arming the candidate or extrapolating a production latency estimate.

The candidate retains the existing off-loop worker bridge, one event loop per grid.
Threads do not establish CPU parallelism under the GIL. Python's primary references:
[to_thread](https://docs.python.org/3.12/library/asyncio-task.html#asyncio.to_thread)
and [asyncio.run](https://docs.python.org/3.12/library/asyncio-runner.html#asyncio.run).

## Proposed reconciliation

All source and receipt additions here remain proposed on unmerged #264.

| Existing task ID | Current evidence | Proposed status | Next action | Acceptance requirement |
|---|---|---|---|---|
| WC-01 | Real overlay/reference mismatch;23 controls;12 central sensitivity columns; positive mutants; added CPU cost | Dark candidate built; acceptance open | Qualify this exact pushed source; assess supported configurations and capacity before owner arming | Same-input reference parity, explicit missing-input policy, isolated capacity and owner decision |
| PF03 / LIVE04, LIVE-01 | Hosted11c8511c CI successful; hub46 to1 parses and scoped expiry/isolation evidence retained | Source candidate qualified | Keep existing E2E causal investigation | Real hub/E2E evidence on deployed source; offline timings alone are insufficient |
| 860 | No fulfillment; prior receipts remain qualified by their own viewport/prerequisite limits | Open; no new probe | Recheck source, API, quiet period, no concurrent loads and focused paused scene before executing original contract | Exact paused scene receipt plus required cleanup/health; playback independently open |
| 863 | Ledger883 fulfills qualified PR254 documentation merge/readback | Fulfilled | Preserve identity; no duplicate task | Completed documented scope only |
| A8-01 / A-05 | Dev E2E37787865773 failed; D-017 remains binding | Open | Await green dev E2E or named #264 owner waiver before merge | Exact live E2E evidence; source CI cannot close it |
| A8-03 / 282 / 283 | Existing gzip/readers/size source; no new Storage acceptance | Open for durability/readers | Complete the existing acknowledged-upload and live reader acceptance before October14 | Durable compressed upload and both readers; owner coordination for shared writes |
| LIVE-02 / PJ-01 / PJ-02 / WC-02 / WJ-05 | Remaining physics findings in Claude's existing queue | Open | Next, reproduce LIVE-02's angle-floor case on the actual path | Dark gated repairs, paired before/after and sensitivity/positive controls; owner flips |
| AS04 and playback / Gulf / time / devices / isolation / data-health obligations | No new qualifying evidence in this paused/offline work | Remain open | Follow their existing evidence contracts | Independent product/scientific acceptance, never inferred from pixel parity or API uptime |

## Implementation handoff

Publish the owned source, paired CI floor/reference and append-only receipts on #264.
New tracked partition:666 files, guards192, chain165, estate306, two exclusions and
one existing quarantine. Hosted guards projection2665 retains floor2659 (margin6);
chain/estate references and floors remain unchanged. Confirm actual hosted counts.
The new flag stays0; D-017 requires a named #264 owner waiver while dev E2E is red.
Next bounded physics investigation is LIVE-02, not reopening qualified mask repairs.
Rollback the candidate source and its paired CI floor changes together; preserve
append-only evidence and task identities. Retain 860 and all independent acceptance.

## 2026-10-08 17:36Z — PF03 / LIVE04 LIVE01 exact-source qualification (ledger seq 1052)

All hosted source CI37814283377 succeeds on pushed11c8511c. Hub-index repair qualified at documented source scope; no live product or E2E closure. Canonical dev fe5573db ledger960 and unmerged266 unchanged.

Readback: GitHub jobs: guards2642/191 files/67 skipped, chain2508/165, estate1455/306 selected/304 producing/zero silent. All11 source jobs successful. Existing863 fulfilled by883;860 unfulfilled.

Rollback: Reviewed revert of request-local index source if a demonstrated regression appears; retain existing obligations.

## 2026-10-08 17:36Z — WC-01 dark canonical rating band source and evidence (ledger seq 1053)

Built default-off SURF_RATING_CANONICAL_BAND using actual rate_one_spot and full geometry on already-loaded waves cells. No per-cell forecast/tide acquisition; unsupported partitions/tide-depth/MOP inputs refuse to raw-height diagnostics. Worker publishes atomically. Paired floors project2665 guards/192files, preserving margin6; no flag changed.

Readback: Same real before/after counterexample Cocoa97.3 versus78.7 now matches. 175 affected plus40 floor controls pass;23 new cases. Three heterogeneous states/12 central columns match to1.43e-14, repeat null0,1% score and10% height mutants detected. Qualified400-cell warm medians31.996/35.920/33.048ms vs9.007/8.882/9.237ms. Fatal lint/LOC/partition pass; own hosted checks pending.

Rollback: Keep flag0; revert candidate and paired floors together; preserve append-only evidence. D017 blocks merge without green dev E2E or named264 waiver.

## 2026-10-08 17:54Z — WC-01 publication on codex/a8-weather-audit-repairs (ledger seq 1054)

Published e68e8c11f1afbcb5542ebe0d0e68c0e5e74022f4 on existing draft264. Normal commit hook reports no leaks; normal push succeeds. No dev merge, deployment or scientific activation.

Readback: GitHub PR264 reads exact e68e8c11, OPEN draft. Own CI37818032376 is in progress; source build/lint/estate jobs green, guards/chain pending. Canonical dev fe5573db remains unchanged.

Rollback: Reviewed candidate revert including paired floors; retain receipts and task identities.

## 2026-10-08 17:54Z — WC-01 PR264 review description (ledger seq 1055)

Updated existing PR264 description with actual counterexample, atomic publication, reference/Jacobian and mutant evidence, cost limit, default-off candidate and qualified prior hub source. Existing863 fulfilled and860 open; no duplicate tasks.

Readback: Read back actual PR body and source head e68e8c11; exact new-head CI pending. D017 remains binding while dev E2E is red.

Rollback: Amend only the PR description if evidence changes; append a correction to memory.

## 2026-10-08 17:54Z — LIVE-02 / AS04 dark direct flux and visible warning candidate (ledger seq 1056)

Built default-off SURF_EXPOSURE_FLUX direct-wave proxy sqrt(max(0,cos(angle))) inside the existing height chain; no indirect/refraction-ray accuracy claim. Unknown/nonfinite geometry fails open and old kill/default/reconciled paths remain. Existing directional_conflict now survives conditions whitelist and renders in real hub plus full/compact drawer in three themes. Scientific flags unchanged.

Readback: Before9 backend failures/13 passes and10 UI failures/20 passes. After135 backend controls and116 frontend controls pass. New18 physics cases,2 route cases,11 UI cases. Three heterogeneous H/Tp/geometries yield nine analytic angular derivatives and detected1% gain mutant. Paired120degree heights0.489809/0.848580/0.725127m become0 under flag; aligned heights identical. LOC/partition/fatal lint and frontend ESLint ratchet pass; new own CI pending.

Rollback: Keep flag0; revert source and paired floors together. The visible legacy warning needs no science flip. Owner coastal/spectral validation remains open before arming.

## LIVE-02 continuation: dark numerical candidate and visible disclosure

The unchanged height path retained0.595 at back-facing bearings; the conditions
route also dropped the existing `directional_conflict` block. The real route
counterexample asserts a surviving height control before requiring the warning.
The mounted hub and drawer were missing that warning in all three themes/layouts.
Before source changes:9 backend failures/13 passes and10 UI failures/20 passes.

Default-off `SURF_EXPOSURE_FLUX` uses a direct-arrival proxy inside the existing
height transform: sqrt(max(0, cos(relative angle))). It holds group speed fixed.
This is an inference from the cross-shore energy-flux relation, not a calibrated
coastal ray/diffraction model. The primary textbook describes the projected flux
and changes in wave bearing through refraction:
[Bosboom and Stive, Coastal Dynamics §5.5.5](https://geo.libretexts.org/Bookshelves/Oceanography/Coastal_Dynamics_%28Bosboom_and_Stive%29/05%3A_Coastal_hydrodynamics/5.05%3A_Wave-induced_set-up_and_currents/5.5.5%3A_Alongshore_balance-longshore_current).
The USACE PDF search excerpt was available, but full retrieval timed out; it is
not used as a verified full-source citation. No accuracy or owner activation claim.

Unknown or nonfinite bearings retain fail-open behavior. The existing exposure
kill switch wins; absent/zero new flag preserves legacy and the older reconciled
flag. A back-facing bulk bearing carries a scoped warning: indirect energy and
component arrivals/local conditions may differ. It does not assert an empty sea.
Spectral coherence, bathymetric refraction and field calibration remain activation
requirements; PJ-02's energy-before-breaking work is independent and still open.

The existing producer warning passes through the real conditions route without
changing its heights. A shared text component displays it in the real hub and
both drawer layouts, in light/dark/beach themes. Warnings name the limitation in
words and with an accessible note label; aligned hours render no warning.
Compact text has a separate line; it does not widen the size/quality row.

Qualified checks:135 backend controls (95 affected plus40 floor controls) and
116 frontend controls across five suites. New cases:18 physics, two real route,
11 mounted UI. The physics file follows the existing surf composition family;
the route fixture preserves its existing estate ownership. Partition667:
guards193, chain165, estate306, two exclusions and one quarantine. Projections
2683/2508/1457 and floors2677/2502/1455 retain backend margins. Frontend main floor
adds the11 cases (4177 to4188); no suite was added and its existing margin remains.
Final targeted heterogeneous physics rerun passes all18 cases after broadening
the initially equal-output0.5m/10s fixtures to three distinct seas.

Same-input paired heights (metres), three actual geometries and different H/Tp:

| Spot / sea | Angle | Legacy | Dark flux |
|---|---|---|---|
| Snapper0.45m/8s |0 /60 /120 degrees |0.823208 /0.656509 /0.489809 |0.823208 /0.582096 /0 |
| Cocoa0.8m/10s |0 /60 /120 degrees |1.426185 /1.137382 /0.848580 |1.426185 /1.008465 /0 |
| Trestles0.6m/12s |0 /60 /120 degrees |1.218701 /0.971914 /0.725127 |1.218701 /0.861752 /0 |

Nine central angular derivatives at30/60/80 degrees agree with the direct-proxy
analytic derivative (relative tolerance0.0002); a1% off-angle gain mutant is
detected. Head-on/kill/default controls preserve their heights. This establishes
candidate implementation behavior, not observational forecast skill.

| Existing task ID | Current evidence | Proposed status | Next action | Acceptance requirement |
|---|---|---|---|---|
| LIVE-02 | Dark projection and preserved legacy controls; paired different seas and positive mutant | Candidate built; owner science acceptance open | Qualify exact pushed source and assess coastal/spectral/indirect-arrival assumptions | Field/coastal validation and owner activation decision; no flag flip inferred |
| AS04 directional disclosure | Existing warning survives route; real hub and both drawer layouts render it in three themes | Source repair built; hosted/live acceptance pending | Qualify exact pushed UI source | Deployed warning readback with matching producer; other AS04 items remain open |
| PJ-01 / PJ-02 / WC-02 / WJ-05 | Existing Claude queue, no new closure evidence | Open | Next bounded investigation: PJ-01 real break-depth handling | Same-input before/after, distinct seas, sensitivities and positive controls; owner flips |

Implementation handoff: publish this source on existing draft264 with current
floors, then read its own hosted outcomes. WC-01 source e68e8c11 is separately
qualifying on CI37818032376. Keep both new flags0. D-017, original860, Storage
durability/readers, playback, Gulf, devices, served time and data-health acceptance
remain independent. Revert candidate source and paired floors together if needed.

## 2026-10-08 18:02Z — LIVE-02 publication on codex/a8-weather-audit-repairs (ledger seq 1057)

Normal commit and push published88e87f1d09d4a667499986bcfa49f35d8cb6154d. Secret scan reports no leaks. Scientific flags unchanged; no dev merge performed by this action.

Readback: GitHub PR264 reads exact88e87f1d OPEN draft. No own GitHub workflow runs exist for this head: the PR became DIRTY when canonical dev advanced concurrently; do not report queued or qualified CI for88e87f1d.

Rollback: Reviewed candidate revert with paired floors; preserve append-only evidence.

## 2026-10-08 18:02Z — LIVE-02 PR264 review description (ledger seq 1058)

Updated existing264 body with dark direct-flux limitation, real warning delivery, paired different-sea values,135 backend and116 frontend controls, and existing owner activation boundaries. Broader acceptance remains open.

Readback: Actual PR edit succeeds; source88e87f1d readback. Subsequent base conflict requires corrected integrated projections below.

Rollback: Amend the PR description as verified evidence changes; append corrections.

## 2026-10-08 18:02Z — WC-01 exact-source qualification e68e8c11 (ledger seq 1059)

All source jobs and all four supplementary workflows on e68e8c11 complete successfully. This qualifies WC-01 source scope; no live activation or product acceptance.

Readback: CI37818032376: guards2665/192 files/67 skips, chain2508/165/zero skips, estate1455/306 selected/304 producing/zero silent. Frontend378 suites/4220 tests. Lighthouse, Encoding, Ledger and LOC workflows successful.

Rollback: Reviewed source revert if current regression is demonstrated; retain original860 and independent gates.

## 2026-10-08 18:02Z — #266 (ledger seq 1060)

Claude squash-merged the owner-authorized unrelated PR266 into dev as3b7ca95457e57374860048599bf28f8db5b9d000. Keep public receipt generic. Its earlier push/pr_open are already recorded at1020/1021; no duplicate entries.

Readback: GitHub PR266 MERGED at2026-10-08T17:49:39Z, headc63b7f3d. Canonical handoff reports all14 checks passed, CI37792250278 estate1462/306 selected/zero silent. GitHub dev reads3b7ca954; weather ledger remains960.

Rollback: Reviewed revert of the accepted merge if the owner requests it; no unrelated source edits by this weather session.

## 2026-10-08 18:02Z — PR264 integrate current canonical dev without duplicating repairs (ledger seq 1061)

Integrated accepted dev3b7ca954 into the repair branch. Only two CI-floor conflicts require resolution; unrelated canonical source is retained unchanged. Net16 canonical estate cases plus branch9 monitor and2 route cases give1473, floor1471. Guards2683/floor2677 and chain2508/floor2502 retained. Canonical ledger960 remains an unchanged prefix.

Readback: Integrated135 weather/floor controls pass. Tracked partition667: guards193, chain165, estate306, two exclusions and one quarantine. Own integrated-head hosted qualification and publication remain pending.

Rollback: Revert only the proposed integration or candidate via reviewed commits; preserve canonical source and append-only ledger history.

## Canonical-base change and qualification correction

Claude merged #266 at17:49:39Z while this weather work continued. Earlier statements
excluding unmerged266 describe the snapshots when they were read; they are now
superseded. Canonical dev is3b7ca954, weather ledger still960. Its accepted source
is integrated unchanged; only CI floors conflicted. The proposed combined estate
reading is1462 canonical +9 monitor +2 route =1473, floor1471, margin2 retained.
Guards2683 and chain2508 are unaffected by the accepted base change.

88e87f1d published successfully, but its DIRTY PR had zero own workflow runs.
Do not describe that head as qualifying in GitHub Actions. e68e8c11 finished all
hosted jobs:2665/2508/1455 backend,378/4220 frontend and four supplemental workflows.
Those receipts qualify e68e8c11 only. Integrated-head checks must run again.
The integrated135 weather/floor controls pass and partition667 remains complete.
Scientific flags and D-017 remain unchanged; no source merge into dev by Codex.
The owner parked an unrelated follow-up in Claude's handoff; it is not started here.

| Existing task ID | Current evidence | Proposed status | Next action | Acceptance requirement |
|---|---|---|---|---|
| WC-01 | e68e8c11 fully passes hosted source/supplementary checks | Source scope qualified; integrated source and activation pending | Qualify integrated branch; preserve capacity and owner gates | Matching source, capacity/configuration evidence, owner activation |
| LIVE-02 / AS04 | Source88e87f1d pushed; CI blocked by concurrent canonical-base conflict | Local source built; integrated qualification pending | Publish resolved combined source and inspect its own checks | Current-head CI and independent live/coastal acceptance |

Handoff update: merged266 is now part of the base, not excluded proposal source.
Publish integrated1473 estate projection/floor1471 with the actual immutable head.
Next independent physics finding remains PJ-01. Original860 and all other
acceptance identities remain open;863 remains fulfilled at documented scope.

## 2026-10-08 18:06Z — PR264 integrated weather source publication (ledger seq 1062)

Normal commit hook reports no leaks and normal push publishes81fb2ac6bb6258e658caa4f023c6b3929e2e6a1c, including accepted canonical dev3b7ca954. No force push, dev merge, deployment or science activation. Weather source, floor resolutions and receipts through1061 are published; these post-publication receipts remain local for next substantive publication.

Readback: GitHub264 exact81fb2ac6/base3b7ca954 OPEN draft, conflict cleared. Own CI37821385194 and Lighthouse37821385205 in progress; Ledger37821385166, LOC37821385165 and Encoding37821385214 successful. Canonical ledger960 prefix checked byte-for-byte.

Rollback: Reviewed corrective/revert commit retaining accepted canonical source and append-only evidence.

## 2026-10-08 18:06Z — PR264 current-base review description (ledger seq 1063)

Updated264 body to accepted merged266 base, estate1473 projection/floor1471, fully qualified e68e8c11 receipts and independent current-head CI. Last completed dev E2E red; fresh3b7ca954 E2E37819560211 is in progress. D017 remains binding pending green E2E or named264 waiver.

Readback: Actual PR edit and exact head/base/state readback succeed; no stale unmerged266 claim remains in current description.

Rollback: Amend description only if verified evidence changes; retain historical receipts.

## 2026-10-08 18:06Z — Original860 current prerequisite hold; no duplicate live probe (ledger seq 1064)

Do not run the paused scene while current shared-host work is active. Existing dev E2E37819560211 and regional ingestion37820867865 are in progress. Original860 remains open; browser visibility/focus and matching deployed source have not been requalified. No forecast scene or stress/playback probe was started.

Readback: Fresh readback: dev E2E3b7ca954 in_progress; regional ingestion in_progress. Earlier ingestion37816501503 also remains in_progress. This is a blocker receipt, not paused-check acceptance;863 remains fulfilled by883.

Rollback: After existing jobs finish, assess prior receipts and original prerequisites before any bounded scene; no replacement task.

## 2026-10-08 18:33Z — Exact81fb2ac6 CI qualification failure (ledger seq 1065)

CI37821385194 completed failure: estate test_precompute_follows_pilots finds wave_physics absent from the dev push paths. Actual hosted guards2683, chain2508 pass; estate1472 pass/1fail, floor gate passes. Lighthouse success; exact combined source is not fully qualified.

Readback: Hosted job113463066779 identifies the missing path; unchanged local guard reproduces1fail/7pass. No rerun, workflow dispatch or cancellation.

Rollback: Preserve failed evidence and correct the execution path; do not lower floors.

## 2026-10-08 18:33Z — LIVE-02 precompute trigger integration repair (ledger seq 1066)

Add wave_physics and new break_depth_policy to existing dev precompute push paths. Existing contract guard passes8/8 without weakening. No live workflow is dispatched.

Readback: Original missing-path failure becomes green under the same guard. Canonical accepted source remains intact.

Rollback: Reviewed revert of trigger additions, retaining evidence.

## 2026-10-08 18:33Z — PJ-01 and WJ-04 actual depth counterexample (ledger seq 1067)

Original public geometry/height controls fail2/5: Teahupoo actual asset273m; tested Puerto coordinate has no break depth and uses shelf3490m. Three plausible measured-depth controls pass. This coordinate differs from the historical Puerto67m sample; no invented reproduction.

Readback: Same unchanged two failing assertions pass after the dark candidate. Original scalar breaking/point pipeline remains the composition.

Rollback: Keep original evidence; owner may reject prior model without losing task identity.

## 2026-10-08 18:33Z — PJ-01 default-off common depth candidate and parity (ledger seq 1068)

SURF_BREAK_DEPTH_PLAUSIBILITY defaults0. Coastal missing/nonfinite/nonpositive/>30m samples use median of >=3 distinct valid committed donors within200km, otherwise global valid median; failed/empty assets remain unknown. Plausible depths and old kill switches survive. Label measured/regional_prior/global_prior/unavailable through point, rating, hub and sim diagnostics.

Readback: 27 new cases;197 affected/trigger/floor controls pass. Five actual heterogeneous paired states,15 central height sensitivity columns: two heights/levels change, three measured controls unchanged, repeated null0; actual1% cap-depth mutation detected at all5. Kr positive ratio0.9129438717. Full capacity/field accuracy unaccepted. No flag changed.

Rollback: Flag0 preserves existing numbers; reviewed source/floor revert if needed.

## 2026-10-08 18:33Z — AS04 offline visual checks and Reports contrast repair (ledger seq 1069)

Actual hub/full/compact components rendered in isolated Chrome with synthetic API/auth/router and shipped Tailwind configuration.36 cases: three themes,390/1280 widths,two warning reasons. No external network requests transmitted;12 static image requests fulfilled locally. Visual inspection found selected Reports white on light/beach; two mounted failures before,119 frontend controls after theme tokens and aria-pressed repair.

Readback: All36 warning visibility/overflow/error checks pass; representative final screenshots inspected. Reproducible frontend/scripts/check_directional_warning_visual.cjs and three sample screenshots persisted. This is component evidence, not deployed map, real device, playback or original860 acceptance. Owned browser/server closed.

Rollback: Reviewed contrast revert; preserve visual evidence and remaining acceptance.


### PJ-01 and visual reconciliation; recommendations and implementation handoff

The actual before failures belong to PJ-01/WJ-04. The 30m threshold is inherited
from the audit and existing oversize policy, not a universal oceanographic bound.
Regional200km/three-donor and global median are explicit prior hypotheses. They
are not measured pin bathymetry. Both reproduced affected coordinates have too
few regional donors and receive the global9.5m prior. Do not call that regional
field validation. The shelf depth used for friction remains unchanged.

Same-input instrument (height metres, scores points, 6kt offshore, no local-size
reference; actual full geometry and rating functions):

| Spot / offshore sea | Before depth / height | Dark depth / source / height |
|---|---|---|
| Teahupoo12m/18s |273m /15.745549m |9.5m global_prior /7.695m |
| Puerto10m/16s,15.858,-97.068 |missing /12.982305m |9.5m global_prior /7.695m |
| Cocoa8m/14s |5.9m /4.779m |measured, unchanged |
| Trestles6m/16s |9.3m /7.533m |measured, unchanged |
| Snapper4m/14s |5m /4.05m |measured, unchanged |

Fifteen central columns (Hs,Tp,angle at each state) use the existing Claude paired
comparator definitions without rerunning its historical audit. Changed high-sea
Hs slopes1.049703/1.038584 m/m become0 when the candidate cap binds. This is the
intended implementation fingerprint, not proof the new ceiling matches surf.
Null comparison0; actual1% cap-depth mutation changes all five states; independent
unsaturated Kr0.797/0.873 control gives0.9129438717. Five-state prior-cache miss
replay1.081ms, warm mean0.352ms; this is not process-cold, large-grid, server or
concurrency capacity acceptance. Regression uses the actual stored point resolver
and rate_one_spot, not only a private physics copy.

Primary-source research supports separating grid bathymetry from breaking depth:
[NOAA ETOPO](https://www.ncei.noaa.gov/products/etopo-global-relief-model) specifies
15 arc-second bathymetry. [Bosboom and Stive, wave breaking](https://geo.libretexts.org/Bookshelves/Oceanography/Coastal_Dynamics_(Bosboom_and_Stive)/05:_Coastal_hydrodynamics/5.02:_Wave_transformation/5.2.5:_Wave_breaking)
defines the breaker index using depth at the breaking point and notes slope and
wave-statistic differences. Inferring that a deep pixel can miss that point is
consistent with the reproduced asset mismatch; neither source validates our
30m cutoff, donor radius, global median or surf-height convention. Those remain
owner/science acceptance work.

Visual coverage: actual changed components, production Tailwind utilities and
theme tokens; external data surfaces mocked.36 cases all pass,119 mounted controls
pass. Three saved representative final samples span all themes and layouts.
The selected Reports contrast defect was visually found and reproduced as two
light/beach failures, then repaired with theme text and accessible pressed state.
Other screen defects and full-app global CSS/device acceptance are not closed by
this harness. Font uses a local system fallback; no remote font/map loads.

| Existing task ID | Current evidence | Proposed status | Next action | Acceptance requirement |
|---|---|---|---|---|
| PJ-01 / WJ-04 |Two real failures; dark policy, provenance,27 controls, actual point/rating parity and paired derivatives |Candidate built; product/science acceptance open |Qualify exact publication; review priors and their UI disclosure before owner activation |Regional/field truth, cap convention, capacity and owner decision |
| LIVE-02 / AS04 disclosure |36 component visual cases and119 controls; missing precompute path corrected |Source/visual repair built; hosted/deployed acceptance open |Fresh exact-source CI and deployed warning readback when safe |Matching producer, actual UI, device and data-health evidence |
|860 |Prior viewport changed; concurrent-load prerequisites previously fail |Open/hold |Assess existing receipts and refresh exact original prerequisites |Single focused visible paused GFS Waves scene, stable bounds/grid, paints/CPU/gaps/fallback and cleanup; no playback claim |
|863 |Fulfilled by883, PR254 receipt qualification/merge |Fulfilled |Preserve identity; do not duplicate |Documented receipt scope only |
| PJ-02 / WJ-02, then WJ-01 |No new closure evidence |Open |Next bounded physics repair: energy-before-breaking split invariance |Paired null, k-split positive controls, cross-spot sensitivities; owner activation |
| WC-02 / WJ-05 / PJ-03–06 |Independent remaining evidence from Claude queue |Open |Keep existing ordering/identities; do not infer closure from PJ-01 |Own served-time, tide/wind/disclosure evidence |

Recommendation: finish exact-source hosted qualification, then PJ-02; retain
Storage upload/readers deadline and data-health obligations independently.
Implementation handoff: branch codex/a8-weather-audit-repairs, draft264. Proposed
counts2710/2508/1473, files194/165/306, frontend378suites/4234tests. Floors2704/2502/
1471 and4191 preserve margins. Do not lower floors or merge under D-017 while dev
E2E is red without an explicit owner waiver naming264. Keep all three new science
flags0. Add user-facing prior disclosure and regional/field validation before any
PJ-01 activation; diagnostic provenance alone is not product acceptance.

## 2026-10-08 18:33Z — PJ-01 and visual reconciliation publication preparation (ledger seq 1070)

Append same-input SCOREBOARD pair and detailed five-column task reconciliation, primary-source research limits, recommendations and separate implementation handoff to owned log. Exact-replace current Now entry; preserve canonical960 prefix and previously local1062–1064. No replacement tasks or completed-mask repair reopening.

Readback: Local197 backend,119 frontend,36 visual cases, fatal lint, ESLint and LOC checks pass. Exact new-source hosted CI and publication still pending; candidate priors and live/product acceptance explicitly open.

Rollback: Append correction if evidence changes; never rewrite ledger/log history.

## 2026-10-08 18:39Z — Visual evidence storage and current original860 hold (ledger seq 1071)

Move only owned synthetic PNG samples outside the UTF-8-only weather ledger directory into docs/research/weather-visual-2026-10-08. Text receipt keeps hashes and directory reference. Memory audit now0FAIL9WARN3NOTE; ledger1070 verifies. Dev E2E37819560211 and regional ingestion37820867865 remain active, so no live860 scene is started.

Readback: All36 local visual checks pass; owned headless browser/server closed. Three sample PNGs persist under docs/research; canonical dev3b7ca954 unchanged. Missing browser/harness setup failures were fixed before qualified screenshots. Rejecting an append with kind correction but no corrects field created no ledger row; this publication-layout action uses doc_write.

Rollback: Retain all evidence; append corrections only. Do not force a live probe or close existing obligations.

## 2026-10-08 18:41Z — PJ-01 cached response provenance and final floors (ledger seq 1072)

Final review grades the depth carried by the same augmented marine response that produced the height, rather than re-resolving geometry in rate_one_spot. Canonical cell adapter carries that same provenance. A cached legacy height keeps legacy grading until newly augmented; new public cached-frame control passes. No candidate label is invented for an old height.

Readback: Same final-source197 affected controls pass, plus87 cached-frame/candidate/floor/band controls including the new case. Final new PJ-01 cases28; guards projection2711/floor2705 across194 files; chain2508/165 and estate1473/306 unchanged. Frontend projection378/4234 floor4191. Supersedes earlier27/2710/2704 projections, not the recorded test runs.

Rollback: Flag0 preserves served numbers; revert candidate/floor changes together and retain receipts.

## 2026-10-08 18:43Z — PJ-01 publication validation (ledger seq 1073)

Final source cohort passes198 backend controls,119 mounted frontend controls and36 offline visual cases. Fatal backend lint, frontend ESLint, both LOC checks, staged whitespace and ledger1072 pass; memory audit0FAIL9WARN3NOTE. Add final same-source198 receipt; preserve earlier197/87 run records. Science flags remain off and fresh hosted qualification is required.

Readback: Canonical960 prefix is byte-identical; partition668 files=194guards+165chain+306estate+2exclusions+1quarantine. Reviewed trigger repair, response-bound provenance and portable visual runner. No live probe, shared-data mutation or owner decision made.

Rollback: Reviewed revert with matching floors; retain all before/after and visual receipts.

## 2026-10-08 18:45Z — PR264 break-depth and visual publication (ledger seq 1074)

Normal commit hook reports no leaks and normal push publishes b89666ad0e318e93d4674bbde390505f5a99ddcd on codex/a8-weather-audit-repairs. Includes owned repairs, visual samples and receipts through1073; canonical dev3b7ca954 and ledger960 remain intact. No force push, dev merge, deployment or science flip.

Readback: GitHub264 exact b89666ad/base3b7ca954 OPEN draft. New CI37826576818 in progress; Encoding37826576902 and LOC37826576702 green, import/floor jobs green. Ledger37826576874 and Lighthouse37826576985 pending. This post-publication receipt remains local for the next substantive publication.

Rollback: Reviewed corrective/revert commit retaining accepted canonical source, floors and all evidence.

## 2026-10-08 18:45Z — PR264 latest exact-source review description (ledger seq 1075)

Update existing draft description with PJ-01 actual counterexamples, labelled default-off priors, response-bound cache control,198 backend/119 frontend/36 visual results, failed81 CI cause and local precompute fix. Preserve remaining acceptance and original task identities; no replacement tasks.

Readback: Actual gh pr edit succeeded; head b89666ad and base3b7ca954 read back. Projections2711/2508/1473 and378/4234 await exact hosted counts. D-017 still requires green dev E2E or an explicit owner waiver naming264 in addition to green source checks.

Rollback: Update description only when verified evidence changes; retain append-only history.

## 2026-10-08 18:48Z — A8-01 current dev E2E and original860 gate refresh (ledger seq 1076)

Dev E2E37819560211 on3b7ca954 completed failure at18:34:12Z. Actual failed attempts still include booking-flow137 spot hub across four browser projects and map/weather continuity/control cases;38 failed attempts across13 project/spec identities, not38 distinct tests. Existing A8-01 remains open; no new task or live rerun. Regional ingestion37820867865 remains active, so original860 still fails the quiet prerequisite.

Readback: Read-only hosted step/log assessment, filtered to test identity without publishing raw console dumps. Failure cause is not established by this summary; neither masks regression nor product acceptance is inferred. New source CI37826576818 remains in progress; its Ledger37826576874 is now successful. No shared forecast activity added.

Rollback: Continue diagnosis from exact failure artifacts when safe; retain D-017 green dev E2E or explicit264 waiver requirement.

## 2026-10-08 19:05Z — PJ-01 qualification: rating response drops depth provenance (ledger seq 1077)

Exact b89666ad CI37826576818 completed failure: guards2709pass/2fail/66skip/1xfail. Both failures concern break_depth_source absent from SpotRatingItem. Other ten source jobs succeeded; no source qualification or merge is claimed.

Readback: Hosted failure receipt and same local test_spot_rating_wire_contract signal:2fail/20pass.

Rollback: No state to roll back; retain the failure receipt.

## 2026-10-08 19:05Z — PJ-01: declare depth provenance at rating wire boundary (ledger seq 1078)

Optional break_depth_source declared on SpotRatingItem; actual point/rating parity controls now serialize the full SpotRatingsResponse. No numerical or flag change.

Readback: Same wire controls plus actual depth/point/rating/envelope cohort50pass, including4 actual spot states; legacy omission remains accepted.

Rollback: Revert the optional model declaration and added envelope assertion together.

## 2026-10-08 19:19Z — PJ-02 / WJ-02: current partition split inflation reproduced (ledger seq 1079)

Corrected real SurfGeometry public composition fixture reproduces14 failing/26 passing controls before the candidate. Identical sea labels split k2/3/6 inflate old height by1.071773/1.116123/1.196231. Independent additive algebra and invalid-train execution also fail. Initial malformed fixture construction is setup failure, not application evidence.

Readback: Same actual estimate_surf_at/estimate_surf_partitioned seam; null unchanged single train and capped controls retained.

Rollback: Retain counterexample evidence; no shared product or activation change.

## 2026-10-08 19:19Z — PJ-02 / WJ-02: dark pre-breaking flux candidate (ledger seq 1080)

Added SURF_PARTITION_FLUX default0. Aggregate surviving Komar-equivalent h²TpA^2.5 before nonlinear breaker/jack bound, then shared Kr/magnet/publisher and one final cap. Scalar coefficient is called from the existing function. Linear Komar kill, tide, statistic, source ownership, input validation and zero-arrival behavior guarded. Helper dev push re-rates through existing precompute trigger; no actual dispatch or flag flip.

Readback: 45 new controls pass; final affected/governance cohort339pass. Three stored point/rating/serialized envelope cases agree at documented4/3-decimal precision. Default/no-component path unchanged.

Rollback: Revert this source batch; leave all scientific flags0. Existing output remains served while off.

## 2026-10-08 19:19Z — PJ-02 / WJ-02: same-input scoreboard and Jacobian receipts (ledger seq 1081)

Saved three heterogeneous real-geometry states,24 height/score central columns (including nonzero oblique direction sensitivity), paired repeat-null0, all3 actual period-input mutants detected, and independent Kr ratio. Two heights change and one depth cap remains; levels retained in this small sample. Warm three-state plus24-derivative replay measured0.846ms; not process-cold or server capacity.

Readback: Saved compact paired.json and append-only BEFORE/AFTER SCOREBOARD rows. Primary-source shoaling uses energy flux; Komar1972 abstract corroborates nonlinear flux exponent. Angle power2.5 is algebraic compatibility with existing height-angle calibration, not a validated physical cross-shore projection.

Rollback: Append a dated correction if superseded; do not erase evidence.

## 2026-10-08 19:19Z — PJ-02 / AS04: measured-payload offline visual receipt (ledger seq 1082)

Real SpotHub and full SpotConditions render six actual offline producer/rating/wire BEFORE/candidate payloads across390/1280 widths and three themes.36 cases pass displayed-height/layout/console assertions;18 external static-image requests stubbed locally, no external forecast request. Four representative PNGs live outside the UTF-8-only weather ledger tree.

Readback: Matched screenshot fixture values to final paired wire rows. Manually inspected dark mobile/light desktop/beach mobile; size and conditions quality readable. PJ-03 hub quality omission remains open, as do WF-01 contrast, device and full-app acceptance.

Rollback: Revert runner extension or replace the owned receipt by an append-only correction; no live state rollback.

### Proposed reconciliation — PJ-02 continuation

All source and receipts remain proposed on PR #264; canonical dev/ledger prefix unchanged.

| Existing task ID | Current evidence | Proposed status | Next action | Acceptance requirement |
|---|---|---|---|---|
| PJ-01 / WJ-04 | b896 CI caught missing rating wire provenance; same two controls fail before and pass after; full envelope verified | Local boundary repair complete; hosted qualification pending | Qualify next source SHA | Full source CI; labelled priors plus independent regional/field/activation acceptance |
| PJ-02 / WJ-02 | Corrected before14fail/26pass; final45 new controls and339 affected/governance pass; k-split invariant; paired null/actual-input mutants | Dark local candidate complete at algebra/composition scope | Exact-source hosted qualification, field/size and capacity evidence | Owner activation; bulk angle/statistic/gamma assumptions remain qualified |
| WJ-01 | Height prerequisite now built; dominant-component served period/direction and quality switching not repaired by this batch | Open | Reproduce tiny wind-sea crossover through real point/rating response | Continuous/honest mixed-sea height, period, direction and score on same reconciled components; owner acceptance |
| AS04 / PJ-03 / WF-01 |36 offline actual-number renders; conditions show quality, hub still omits it; known contrast work separate | Partial visual evidence; existing tasks open | Repair quality/size disclosure and contrast in their queue scope | Real full-app, mobile/device and user-flow checks; no closure from controlled screenshots alone |
| A-05 / A8-01 / D-017 | Latest dev E2E37819560211 failed; b896 source has two now locally repaired wire failures | Open; merge held | Keep hub request/attempt diagnostics and compare current red evidence | Green dev E2E or owner-named #264 waiver, plus own source qualification |
| Commitment860 | No bounded live scene started; quiet/source/health prerequisites and existing cleanup contract retained | Open/held | Read any existing stable-viewport receipt before probing | Original exact paused contract, healthy matching source,20min/quiet window; independent playback/Gulf/device acceptance |
| Commitment863 | Fulfilled by883 at PR254's qualified documented scope | Fulfilled; unchanged | Do not duplicate | Documentation qualification does not accept the live product |

The small paired sample changes Cocoa and Trestles heights, while the selected Snapper sea stays depth capped; it does not measure forecast skill. Numerical before/after and24 sensitivity columns are in paired.json. Initial malformed NamedTuple fixture was corrected before the valid14-failure baseline; three added envelope assertions initially demanded equal precision, then were pinned to the producer's existing4-decimal point and3-decimal rating contracts, without changing application rounding.

Sources: [Bosboom and Stive, shoaling](https://geo.libretexts.org/Bookshelves/Oceanography/Coastal_Dynamics_(Bosboom_and_Stive)/05:_Coastal_hydrodynamics/5.02:_Wave_transformation/5.2.02:_Shoaling) derives conservation of energy flux outside breaking under its assumptions. [Komar and Gaughan1972 abstract](https://ascelibrary.org/doi/10.1061/9780872620490.023) gives breaker height proportional to (T H²)^(2/5); search abstract readable, publisher page returned403. Neither validates the mixed-sea angle exponent, calibrated jack factor, peak-period proxy or local depth priors. A^2.5 retains single-component algebra because2.5×.4=1; it is an explicit compatibility assumption.

Recommendation: qualify this default-off source batch, then WJ-01's actual mixed-sea composition. Keep WC-02 tide distance/horizon, WJ-05 missing-normal wind smoothness, PJ-03/PJ-04 UI honesty, A8-01 E2E causal acceptance and Storage durability/readers before October14 separately open. Do not activate partitions as a shortcut to closure or reopen PR253's qualified mask repairs from unrelated E2E failure identities.

### Separate implementation handoff — after PJ-02

1. Use partition_flux.py through estimate_surf_partitioned/estimate_surf_at; preserve SURF_PARTITION_FLUX=0 until owner acceptance. No extra upstream call is introduced. Component resolution/period bands remain existing guarded suppliers.
2. Run test_surf_partition_flux plus the wire/cap/convention/tide/precompute controls. New45 controls project hosted guards2756 at195 files/floor2750; chain2508/floor2502 and estate1473/floor1471 unchanged. Hosted results govern, not projections.
3. WJ-01: compare equal offshore inputs with wind sea crossing the primary swell by0.02m through the real stored point and rating response; retain heterogeneous periods/bearings, null and real input mutants. Study both height and quality switches. Do not fabricate a continuous spectrum from peak labels.
4. Visual runner accepts WEATHER_VISUAL_FIXTURES with controlled current/wire rows;36 mobile-full/desktop-hub cases span BEFORE/candidate and three themes. Unspecified fixtures retain the original36 warning cases. Static images are stubbed, confidence is a controlled fixture, unrelated hub children are mocked; no completed GPU-frame, playback, full-app or device claim.
5. Carry local post-push receipts with the next substantive publication; preserve canonical ledger prefix960 and actor attribution. D-017 requires an owner-named #264 waiver if dev E2E remains red; no merge, deploy, shared-data or scientific flag change occurred in this batch.

## 2026-10-08 19:22Z — PJ-02: local source and governance qualification before publication (ledger seq 1083)

Final affected/governance cohort339pass;45 new PJ-02 controls;36 measured-payload visual cases and original36 warning regression cases pass. Fatal backend lint, backend800LOC, repoLOC, ledger and memory checks pass. Tracked census669 partitions195guards/165chain/306estate/2excluded/1quarantined; projections2756/2508/1473 preserve6/6/2 margins, no floors lowered.

Readback: Observed checks and staged diff clean. Memory audit0FAIL/9historicalWARN/3NOTE; overdue owner/live obligations retained. Initial root-cwd lane invocation read0 and refused; rerun from documented backend cwd gives complete669-file census. Hosted next-source qualification still pending.

Rollback: Revert the candidate source with its paired floors/tests; append receipt corrections rather than erasing evidence.

## 2026-10-08 19:26Z — PR #264: publish PJ-02 repair a6a8e3b6 (ledger seq 1084)

Normal push published a6a8e3b69d30df2f50a3ec123d47540090e2711b with owned receipts through1083. Includes default-off partition candidate, depth wire fix, paired45-control floor raise and measured visual evidence. No force push, merge/deploy, shared-data or scientific activation.

Readback: GitHub PR264 OPEN/DRAFT reads exact a6a8e3b6 head/base3b7ca954. CI37831591529 in progress; seven early source jobs green; Ledger37831591407/Encoding37831591543/LOC37831591466 success. Latest dev E2E37819560211 still completed failure.

Rollback: Revert this weather source batch with floors/tests by reviewed PR; preserve append-only receipts.

## 2026-10-08 19:26Z — PR #264: current composition-boundary review description (ledger seq 1085)

Rewrote review title/body around the full current repair scope and actual source SHA. Includes PJ-02 default-off assumptions/controls, PJ-01 wire repair, measured/fixture visual limits and separate remaining acceptance. Historical execution detail remains in the append-only log.

Readback: gh pr view reads updated title and exact a6a8e3b6 head. Description sent via body-file, no messages to another person or task. D-017 and scientific-owner gates retained.

Rollback: Restore the prior PR title/body from local saved review text; no application rollback.

Post-publication1084–1085 are local receipts to carry with the next substantive publication; no self-hash-only commit/merge chain. Published source/evidence a6a8e3b6 remains subject to its own running qualification.

## 2026-10-08 19:45Z — PJ-01/PJ-02/WJ-02: exact a6 source qualification (ledger seq 1086)

CI37831591529 on exact a6a8e3b6 completed success: eleven source jobs green,2756 guards/2508 chain/1473 estate backend passes and378 suites/4234 frontend tests. Ledger/Encoding/LOC/Lighthouse also success. PR264 remains OPEN DRAFT; canonical dev3b7ca954 preserved; dev E2E37819560211 still failed.

Readback: Hosted count summaries and PR readback; fresh fetch confirms origin/dev3b7ca954. No merge/activation/live product acceptance inferred.

Rollback: No application state changed; append corrections if later evidence supersedes qualification.

## 2026-10-08 19:45Z — WJ-01: current stored-point crossover after height repair (ledger seq 1087)

Real stored component grids through public PointResolutionService, representative/reconciliation gates and rate_one_spot reproduce71.1 ->7.1 at all three coordinates while height stays2.838 ->2.841m. Existing swell-share threshold switches exposure at50%; tallest-swell selection makes rating factors sensitive to label splitting. Corrected baseline10fail/11pass before any production edit.

Readback: Initial14fail/7pass included four overly exact float comparisons; corrected to1e-12 factor tolerance before production edit. Subsequent marginal-swell test initially assumed a2-point scalar floor incorrectly; assertion corrected to the actual scalar short-period grade without changing the curve. No upstream calls in stored controls.

Rollback: No live state to roll back; keep the reproduced counterexamples and test corrections.

## 2026-10-08 19:45Z — WJ-01: shared default-off continuous partition grade (ledger seq 1088)

Added RATING_PARTITION_CONTINUITY0: h-squared weighted exposure/period-quality/period-gate factors for complete finite component inputs. Shares scalar callbacks, retains sea cleanliness and optional gates, refuses incomplete inputs, preserves total peak period/direction fields. Reference why says mixed-sea periods; simulator explanation shares candidate factors and does not invent a graded physical period.

Readback: 26 new controls and final288 affected/governance controls pass. Candidate stored grades35.5 ->34.9; actual legacy-path positive controls restore the jump. Additional91 floor/trigger/candidate checks pass after paired floor update. Cohort totals overlap and are not summed. Local runner initially placed backend files outside pytest root, applying one module autouse flags across modules; fixed ignored runner rootdir to backend. Actual simulator explanation mismatch repaired separately; final reconstruction delta0.

Rollback: Keep flag0; revert helper, common factor/explanation wiring, tests and paired floors together.

## 2026-10-08 19:45Z — WJ-01: paired sensitivities, scoreboard and offline visual evidence (ledger seq 1089)

Three heterogeneous real geometries/36 height-and-score central columns; repeated null0, actual1% primary-period mutant detected3/3, independentKr0.9129438717. Height derivatives unchanged by rating-only candidate; warm instrument mean1.622722ms for three states/36 columns, not request/server capacity. Saved paired evidence, before/after scoreboard rows,72 actual-payload visual receipts and five representative PNGs outside the UTF8 ledger tree.

Readback: Offline Chrome72pass,36 exact rounded-score assertions,three themes and390/1280 widths; external static image requests locally stubbed36; owned server/browser closed. Manually inspected dark mobile candidate and light desktop hub: conditions score35/100, hub quality still absent. Controlled confidence/data-source labels are synthetic; visual pixel rendering is not accuracy, playback or physical-device acceptance.

Rollback: Revert visual runner score assertion/evidence files if needed; retain append-only scoreboard and receipt history.

### WJ-01 proposed reconciliation

| Existing task ID | Current evidence | Proposed status | Next action | Acceptance requirement |
| --- | --- | --- | --- | --- |
| PJ-02 / WJ-02 | a6 source qualified:2756/2508/1473 backend,378/4234 frontend; split controls pass | Source qualified at documented dark scope | Retain flag0 and prepare field/size/capacity evidence | Owner-coordinated activation and independent forecast skill |
| WJ-01 | Actual stored peak crossover score71.1 ->7.1 with stable height; candidate35.5 ->34.9;26 new/288 affected controls,72 offline visuals | Dark candidate locally verified; hosted/owner/live acceptance open | Qualify newly published exact source; replay real complete component seas and all armed optional paths before activation | Stable component grade, clear fallback when components unavailable, field/displayed-level and capacity acceptance |
| WC-02 | Existing nearest-tide/long-horizon finding retained; no new measurement this turn | Open; next bounded physics repair | Inspect actual tide cache distance and provider horizon before designing repair | Correct served-time samples, refusal of unsupported distance/horizon, point/hub/sim parity |
| AS04 / PJ-03 / WF-01 | Candidate conditions card shows quality; actual hub fixture still omits it; earlier contrast findings retained | Open, independent UI acceptance | Fix common quality/offshore labelling and measure all affected pills | Honest size/quality together, three themes/layouts, measured contrast |
| A-05 / A8-01 / D-017 | Fresh dev E2E37819560211 still failure on3b7ca954 | Open; merge held | Use retained allowlisted failure receipts for a causal test | Green dev E2E or explicit owner-named264 waiver; source CI alone insufficient |
| 860 | No live scene attempted; stable focused/quiet/source/healthy prerequisites still owed | Open/held | Resume its exact paused contract only when prerequisites hold | Paint verdict/count/CPU/gaps/fallback, stable actual bounds/grid, cleanup and health readback; no playback acceptance |
| 863 | Existing fulfillment883 retained | Fulfilled at its recorded scope | Preserve receipt, no duplicate task | Documentation qualification does not accept live product |
| 282 / 283 | Code compression/reader seams retained; live Storage acknowledgment/readers still pending | Live durability open before October14 | Obtain bounded storage upload and both-reader receipts under established contract | Acknowledged compressed archive, production-shaped month seam and actual readable data |

NOAA defines dominant period as the maximum-energy spectral peak, which may belong to swell or windsea:
https://www.ndbc.noaa.gov/waveobs.shtml and https://www.ndbc.noaa.gov/faq/wavecalc.shtml.
ECMWF labels swell partitions by height and publishes component heights/periods/directions:
https://codes.ecmwf.int/grib/param-db/140123.
These sources support preserving the actual peak fields and using component inputs. They DO NOT validate
this candidate's quality-factor weighting, the rating coefficients or surf forecast skill.

The continuous candidate weights the existing three bounded grade factors by offshore h^2 for ALL
complete components, rather than inventing a mean/peak physical period. Sea cleanliness remains separate.
The resulting product of averages is an explicit quality prior, not a spectral integral or observational
fit. Missing/incomplete component data retains the legacy branch, so that path can still jump; no
partition-resolution flag was enabled live. Optional breaker type/local/tide/observation I/O was off
for these bounded fixtures. Field/level sweeps and the armed optional combinations remain acceptance work.
The displayed total peak remains14s or7s as supplied. The new reference explanation identifies mixed-sea
period grading; hub/drawer disclosure remains attached to AS04/PJ-03, not silently accepted by screenshots.

Recommendations: qualify the new exact source without reopening the completed cache repairs. Continue
with existing WC-02 tide nearest-sample/horizon work. Keep the owner flag bundle, Storage deadline,
E2E cause and860 live contract visible; playback/scrub, Gulf/device/staging/served-time/data-health gates
remain independent. No replacement task identity or owner flag decision was created.

### Separate implementation handoff

Use partition_rating.partition_factors through the shared rating_factors; do not introduce another
height/score chain. Default RATING_PARTITION_CONTINUITY0. Inputs require finite positive-period/nonnegative
height components and finite directions; zero energy contributes nothing. Incomplete inputs returnNone
and keep legacy behavior. Public tests exercise stored component products and the actual resolver, not
injected partitions. The simulator and reference explanation use the same helper; bulk peak fields stay
unaltered. Evidence is in evidence/2026-10-08-mixed-sea/. The three science sensitivity states differ in
component heights/periods/directions; the six stored crossover states intentionally match Claude's original
crossing at three coordinates. Finite differences operate on rounded scores and are not an analytic
derivative or population forecast validation. Next projected hosted passes2782guards/2508chain/1473estate,
floors2776/2502/1471; census670files196/165/306 plus2 exclusions/1 quarantine. Preserve canonical prefix960,
existing860/863 and all append-only evidence; no scientific switch, live load, merge or deploy this turn.

## 2026-10-08 19:47Z — WJ-01: publication governance and existing-task reconciliation (ledger seq 1090)

Fatal backend lint, backend800LOC (669 source files), repoLOC (2624 files,12 grandfathered nongrowing), tracked census670 files with196guards/165chain/306estate/2excluded/1quarantined, ledger and memory checks pass. Source-qualified a6 base counts2756/2508/1473 plus26 new guards project2782/2508/1473; floors2776/2502/1471 preserve margins. Proposed reconciliation and separate handoff retain WJ01/860/863 and nextWC02 rather than duplicate tasks.

Readback: Canonical960-line ledger byte-identical prefix; memory audit0FAIL/9historicalWARN/3NOTE. Final72 visual cases include36 exact score assertions. Fresh dev E2E37819560211 failed,PR264OPEN DRAFT,origin/dev3b7ca954 unchanged. No floor/limit lowered or owner flag changed; new hosted-source qualification pending.

Rollback: Revert owned source/floor/evidence changes together; retain append-only reconciliation and action history.
