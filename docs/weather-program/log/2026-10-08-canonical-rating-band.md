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
