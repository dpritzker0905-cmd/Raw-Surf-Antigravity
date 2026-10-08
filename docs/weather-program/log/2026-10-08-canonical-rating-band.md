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
