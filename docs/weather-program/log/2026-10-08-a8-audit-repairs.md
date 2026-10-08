# Independent audit repair continuation — 2026-10-08

Owned by Codex on codex/a8-weather-audit-repairs. Times UTC.

## 2026-10-08 10:22Z — Close superseded PR #222 (ledger seq 970)

Claude closed PR #222 after its source had already landed on dev. Owner authorization: close #222 #224 #225.

Readback: GitHub readback CLOSED, closedAt 2026-10-08T03:37:46Z; not merged by this action.

Rollback: gh pr reopen 222

## 2026-10-08 10:22Z — Close superseded PR #224 (ledger seq 971)

Claude closed PR #224 after its source had already landed on dev. Owner authorization: close #222 #224 #225.

Readback: GitHub readback CLOSED, closedAt 2026-10-08T03:37:48Z; not merged by this action.

Rollback: gh pr reopen 224

## 2026-10-08 10:22Z — Close superseded PR #225 (ledger seq 972)

Claude closed PR #225 after its source had already landed on dev. Owner authorization: close #222 #224 #225.

Readback: GitHub readback CLOSED, closedAt 2026-10-08T03:37:50Z; not merged by this action.

Rollback: gh pr reopen 225

## 2026-10-08 10:22Z — claude/auth-money-routes-hotfix (ledger seq 973)

Claude published the authorized hotfix branch at 3788b4ce694a1153a1b4766fefea053b39b468b5. Owner words supplied in the handoff: push the hotfix and merge it when green. Push time is approximately 04:05Z; no exact acted_at is asserted.

Readback: GitHub branches API reads 3788b4ce694a1153a1b4766fefea053b39b468b5.

Rollback: Close the proposed PR; revert its changes by a reviewed PR if subsequently merged.

## 2026-10-08 10:22Z — #263 (ledger seq 974)

Claude opened the authorized hotfix PR against dev. It remains OPEN; Codex has not merged it. Reserved routes and CI floors remain untouched. Detailed local security evidence is not published.

Readback: GitHub PR readback OPEN, mergedAt null, head 3788b4ce694a1153a1b4766fefea053b39b468b5.

Rollback: Close PR #263.

## 2026-10-08 10:22Z — A-05 / A8-01: missing E2E failure evidence (ledger seq 975)

Run 37717937279 timed out at the 40-minute step bound and has zero GitHub artifacts. First failing run 37503777375 explicitly reports no files at frontend/playwright-report/. A8-01 remains open: Node version and hub latency are hypotheses, not identified causes. No shared forecast test was started; ingestion 37751941923 is active.

Readback: Saved audit logs; GitHub artifact API total_count 0. Three Node receipt controls pass, including a 1000-request retention control and persisted per-attempt facts before reporter shutdown.

Rollback: Revert the proposed E2E instrumentation; retain the failed-run evidence.

## 2026-10-08 10:22Z — A-05 / A8-01: preserve evidence before E2E shutdown (ledger seq 976)

Added allowlisted hub request facts, bounded at 64, and a streaming completed-attempt reporter. Retain existing test-results alongside HTML reports. Raw tracing stays off; no URLs, headers, request/response bodies or credentials enter these new receipts. Test assertions and retries remain unchanged. This repair changes no served number; live causal acceptance remains open.

Readback: node --test frontend/scripts/e2e_receipts.test.cjs: 3 passed; git diff --check clean. Source and receipts remain proposed on this branch.

Rollback: Revert the E2E instrumentation commit; no application or shared-data rollback is needed.

## 2026-10-08 10:24Z — D-017 / A-05: named E2E waiver (ledger seq 977)

Recorded the owner audit queue policy: no repair merge on a red dev E2E without an explicit owner waiver naming the PR number. Other acceptance requirements remain independent.

Readback: DECISIONS.md D-017; current dev E2E 37717937279 failed. No merge was performed.

Rollback: Append an owner-authorized superseding decision; preserve this decision and its evidence.

## 2026-10-08 10:27Z — codex/a8-weather-audit-repairs (ledger seq 978)

Published qualified E2E evidence instrumentation and append-only receipts at 6941798a861e7772a7c3c02e99bf893071e14cd6. No application deployment or shared forecast test was initiated.

Readback: Git push succeeded; PR head readback matches 6941798a861e7772a7c3c02e99bf893071e14cd6.

Rollback: Revert the proposed commit by reviewed PR if needed; no main or dev branch was modified.

## 2026-10-08 10:27Z — #264 (ledger seq 979)

Opened a draft against dev for A8-01 / A-05 failure-evidence retention. Existing assertions remain; live root-cause acceptance is still open. D-017 requires a named owner waiver while dev E2E is red.

Readback: GitHub OPEN, isDraft true, base dev, head 6941798a861e7772a7c3c02e99bf893071e14cd6; attached to this chat.

Rollback: Close PR #264; retain its evidence.

## 2026-10-08 10:41Z — e2e-tests.yml / 37764654623 (ledger seq 980)

Dispatched exactly one Desktop Chrome spot-hub journey with diagnostic_no_retry=true against dev. Application is still b02f43f8; diagnostics run source is proposed 6941798a. No Play, scrub, map stress or 860 acceptance check. Matching healthy API, restored 13234 products and matching dev frontend read back at 10:36Z; no concurrent forecast workflows at dispatch.

Readback: GitHub run 37764654623 in progress, head 6941798a861e7772a7c3c02e99bf893071e14cd6. Receipt pr262-deployment-20261008T103648.json; data health remains warn with independent cycle alerts.

Rollback: Cancel only run 37764654623 if needed; hosted browser contexts close when the job ends.

## 2026-10-08 10:50Z — A-05 / A8-01: retained failure narrows the cause (ledger seq 981)

Bounded single-attempt run 37764654623 failed and retained one artifact. Its batch request finished HTTP 200 in 102 ms; no spot-details request was observed after the click. Screenshot and accessibility snapshot show the signup page. This contradicts a pending hub request as the explanation of this observed failure; the triggering redirect remains to be identified. All PR264 code checks pass, but E2E acceptance remains open.

Readback: GitHub run FAILURE; artifact 11543832312 retained. Post-check metadata at 10:49Z: API healthy, deployed API/dev source b02f43f8, restore complete 13234, zero restore errors. Data health WARN persists, including EURO wind cycle 22.8 hours old. Claude263 remains OPEN.

Rollback: Retain the failed-run evidence; no shared data or application was changed.

## 2026-10-08 10:50Z — A-05 / A8-01: observe setup and unauthorized response categories (ledger seq 982)

Extended bounded privacy-safe E2E receipts to setup, known incidental endpoint categories and otherwise unclassified 401 responses. Final landing is an allowlisted category. No raw URL, identity, header, body or credentials are retained, and existing UI assertions are unchanged. Changes no served number.

Readback: Four Node controls pass; syntax and diff checks pass. The real auth client clears synthetic session state two seconds after a non-admin 401; this mechanism is a hypothesis until the triggering response is measured.

Rollback: Revert the receipt extension commit.

## 2026-10-08 10:56Z — PR264 receipt extension 8c4b0ebb (ledger seq 983)

Pushed 8c4b0ebbf47233d7f38848f7ac15974c4019ad08 to the existing draft PR264. Local backend changes were not staged.

Readback: Git push verified the remote branch advanced from 6941798a to 8c4b0ebb.

Rollback: Revert the receipt-extension commit by reviewed PR.

## 2026-10-08 10:56Z — A-05 / A8-01 diagnostic 37766160851 (ledger seq 984)

One Chrome hub attempt without retries, against unchanged dev b02f43f8. Existing code CI jobs only were active at dispatch; no other forecast workflow was running.

Readback: GitHub run37766160851 completed FAILURE. Setup receipt records one unclassified 401 followed by failed batch/details/pulse requests and an auth landing. Active-session and notification calls were200; badge fixture used twice; profile404. This rules out those successful incidental calls but does not yet identify the401 endpoint.

Rollback: Owned hosted browser closed with the run; retain the privacy-safe receipt.

## 2026-10-08 10:56Z — WI03 / A8-02 dark freshness qualification (ledger seq 985)

Default-off FRESH_ESTIMATE_SELECTION guards real grid and manifest-point candidate paths, overlap selection and remote manifest reconciliation. A repeated reconcile can reintroduce a future-valid estimate after the prune exclusion is gone; the guarded reconcile removes it again. Saved registry reproduces16 stale exact-hour EURO coarse-wave selections with flag off; each selects a newer neighbouring native frame with flag on and returns to the old exact-hour frame when disabled. No network requests or shared Storage writes were made.

Readback: Ten focused tests pass, including coverage/resolution/unique-tail null controls and receipt-versus-cycle separation. The16 count is from the saved02:39Z snapshot, not a fresh live served-frame census; owner arming and served readback remain open.

Rollback: Keep FRESH_ESTIMATE_SELECTION unset or0; revert the candidate source if not accepted.

## 2026-10-08 10:56Z — 282 / 283 / A8-03 archive qualification (ledger seq 986)

Prepared gzip scored-month archives at existing keys with byte-identical decoded JSON and both readers accepting old JSON/new gzip. Pending cap86400 preserves64800 rows at20passes/day across60buoys,9lanes and24/48/72h leads; old54000 cap evicts10800. Stored-size warning starts40MiB. Actual monitor main borrows confirmed missing new-month archives only from readable previous rows; corruption and non-list JSON keep grading non-green. No shared-data writes or scientific flag changes.

Readback: 208 focused offline controls pass. Initial new month-seam positive fixture accidentally included future targets and refused; corrected fixture has260 past targets and gradesOK, while current/prior corrupt archives refuse. Hosted qualification, Storage MIME compatibility, compressed upload acknowledgement and post-deploy writer/reader receipts are still pending.

Rollback: Deploy both readers before compressed writes; preserve existing archives and row identities. If reverting compression after any compressed write, retain gzip-compatible readers.

## 2026-10-08 11:07Z — PR264 category extension 9d314a98 (ledger seq 987)

Pushed the tested allowlisted response-category extension and local repair qualification receipts to draft PR264 at9d314a98. Backend source/tests and CI floors remain unpublished and unstaged.

Readback: Remote push advanced8c4b0ebb to9d314a98; four Node controls pass and ledger986 verifies.

Rollback: Revert the category extension by reviewed PR.

## 2026-10-08 11:07Z — A-05 / A8-01 diagnostic 37766830325 cancelled before testing (ledger seq 988)

Dispatched a single diagnostic then cancelled it because the same status read showed a newly active regional forecast job37766797123. Corrected the command-ordering error by cancelling before the test stage; no app probe ran. Future dispatches inspect and assess the status result before dispatching.

Readback: GitHub run37766830325 completed CANCELLED, Run E2E tests SKIPPED. Only this owned diagnostic was cancelled; the scheduled regional job continues.

Rollback: No application or shared-data rollback; retain the cancellation receipt.

## 2026-10-08 11:07Z — Commitment282 historical writer recovery assessment (ledger seq 989)

Fulfilled the original missing-object writer-recovery obligation using the owner-supplied independent audit C-282 and canonical merge receipt288. PR217 merged2026-10-02T02:42:26Z. Scored October object created06:11:21Z, residual October object05:51:50Z, pending updated2026-10-08T03:03:28Z; monitor subsequently named different causes and recovered. The lost window is2026-09-30T22:45:05Z through no later than2026-10-02T06:11:21Z, at most31.4h. This closure does not accept the new archive-size or reader-seam repairs.

Readback: Assessed existing independent SQL/run receipts instead of repeating those checks. All five audited calibration passes log ledgered with zero cap evictions. Proposed fulfillment lives on this branch until a receipts PR merges.

Rollback: Append a correction if historical evidence is disproved; keep A8-03 capacity and283 reader acceptance independently open.

## 2026-10-08 11:07Z — Commitment309 historical missing-ops diagnosis assessment (ledger seq 990)

Fulfilled309 from the owner-supplied independent audit C-309. The original HTTP400 missing-object reader cause was repaired by PR217. Audited report at2026-10-07T19:18Z contains ops: ledgered1359, scored952, pending40962, evicted0. All11 scheduled monitor runs in the audited2026-10-04T06:46Z to2026-10-07T19:18Z interval are green. Subsequent October-only window grading had a separate cause and fix; new capacity/month-boundary findings stay open.

Readback: Assessed existing monitor/report/run-history evidence and canonical source/merge receipts; no repeated live forecast or SQL checks. Proposed fulfillment is not yet a merged canonical record.

Rollback: Append a correction if historical recovery receipts fail verification; do not silently reopen a distinct capacity or month-seam finding.

## 2026-10-08 11:07Z — WI03 / 283 candidate scoreboard and residual-seam qualification (ledger seq 991)

Appended candidate scoreboard rows for16/0/16 saved-registry selections and byte-identical synthetic archive compression. Added a readable status note by exact replacement. Extended the reader repair to the residual-history first24h grace window and pending capacity warning above85percent; both current/prior corruption remain non-green.

Readback: 212 focused archive/monitor/retention/retry controls pass; all658 backend Python files meet800-line gate. Backend tests/floors and Storage compatibility remain unpublished/unverified. The prior208-pass row is historical qualification of the earlier candidate, not a live acceptance claim.

Rollback: Revert proposed source by reviewed PR, retaining gzip-compatible readers after any compressed write. Keep scientific flags off.

## 2026-10-08 11:11Z — A8 candidate qualification details (ledger seq 992)

Corrected only this session's two unpublished scoreboard additions from seven columns to six. All prior published text remains an exact prefix; candidate evidence and limitations are retained. Final archive qualification now212passes, including both reader seams and pending warning thresholds.

Readback: memory_audit0FAIL8WARN4NOTE. Reverting just the residual grace in the actual monitor main makes the missing-first-month fixture failREFUSED; unchanged candidate passesOK. No network, source flags or Storage writes in that control.

Rollback: Preserve the published prefix and append evidence corrections; do not weaken memory gates.

## 2026-10-08 11:13Z — Proposed task reconciliation and implementation handoff

The merged canonical ledger ends at 960 on dev b02f43f8. This branch's additions are proposed records until merged. The three PR253 cache repairs remain complete at their qualified scope; no current evidence reopens them. Their paused-live, playback, Gulf accuracy, served-time, device and isolated-staging requirements remain separate.

| Existing task ID | Current evidence | Proposed status | Next action | Acceptance requirement |
|---|---|---|---|---|
| A-05 / Nightly E2E / A8-01 | Bounded Chrome receipt: 401 followed by cancelled hub requests and auth landing; successful badge/session calls excluded. PR264 retains artifacts; code checks qualified at earlier head | Open investigation; source receipts proposed in PR264 | Identify the remaining response category, repair only the relevant seeded fixture if causal, and rerun the same journey | Positive control on the actual failed journey; required E2E green or owner waiver naming the exact PR; no timeout-only acceptance |
| WI03 / A-04 / A8-02 | Actual selection on saved 02:39Z registry: old exact-hour subject selected 16 / 0 / 16 with flag off / on / off. Real reconciliation reproduces reinsertion; coverage and unique-tail null controls pass | Dark local candidate; not deployed or armed | After reserved hotfix merges, publish with correct chain floors and request owner arming evidence | No older served cycle or receipt where a newer eligible neighbour exists unless explicitly labelled stale; verify writer and serving readback |
| 282 | Independent historical writer recovery receipt: scored/residual objects created after PR217; pending updates and ledgered passes recovered; lost window recorded in seq989 | Fulfilled at original historical scope, proposed on this branch | Merge the assessment receipt once qualified; preserve the separate A8-03 capacity finding | Already supplied post-merge writer, residual and monitor evidence; no duplicate probe |
| 309 | Independent audited ops/report and 11 scheduled green monitor runs; original missing-object and subsequent window causes identified | Fulfilled at historical scope, proposed seq990 | Merge assessment receipt; retain new reader and capacity findings | Existing recovery receipts satisfy the earlier missing-ops diagnosis; do not extend closure to future month seams |
| 283 / A8-03 | Real monitor main: confirmed missing scored and residual month files borrow readable prior rows only within their windows; corrupt/non-list inputs refuse. Residual repair reverted alone makes same fixture fail | Locally qualified; release obligation open | Publish reader changes after hotfix/floor coordination; qualify hosted tests and merge before deadline | Merged repair before first November read; absent-versus-unreadable contract and both actual reader seams pass |
| A8-03 capacity, attached to 282 / 283 work | Gzip preserves decoded bytes; both old/new formats readable. Pending population 64800: old cap loses10800, candidate loses0. Size and 85-percent-cap warnings covered | Locally qualified; live compatibility pending | Qualify Storage MIME support and compressed upload acknowledgement on the released source, then read writer/monitor receipts | No dropped evidence, acknowledged writes before pending consumption, both readers compatible; finish before 10-14 |
| 860 | Prior assisted receipt resized the viewport and did not isolate the stable scenario; no replacement task created | Open, currently held for quiet prerequisites | Run only its original paused GFS Waves contract when source/health/quiet/visibility prerequisites hold | Stable viewport, actual grid and bounds, paint counts/verdict/cost, callback gaps and fallback; Waves off, owned-tab cleanup, post-health. No playback acceptance |
| 863 | Canonical seq883 fulfilled after PR254 merged3310b6f5 at documented receipt scope | Complete; retain canonical identity | No replacement task and no repeat rollout qualification | Documentation scope only; independent product acceptance remains open |
| WF02 / CX34-07 / A8-05; WF03; WI03 health; PF03 / LIVE04; AS04 | Remaining owner-supplied audit findings | Open; queue order retained | Continue A8-04 next, then guardrail, time, health, serving, physics and UI work in order | Each finding needs its own symptom-specific control and release evidence; owner-only scientific flags remain off |

Implementation handoff:

1. PR263 is still open at head3788b4ce. Do not touch its reserved routes, test or CI floors, and do not merge it on Claude's behalf. Read the refreshed canonical handoff section3 after its merge and record the exact pr_merge with actor claude. Its push/pr_open records are already proposed on this branch.
2. PR264 currently carries E2E receipt tooling and proposed reconciliation records. Preserve assertion strength, raw tracing off, bounded allowlisted facts, and the no-merge-on-red policy in D017. The latest diagnostic was cancelled before tests when a scheduled regional job started. Wait for a quiet interval before a real hub probe.
3. The backend working tree contains A8-02 and A8-03 source/tests, not published backend changes. New files test_estimate_freshness.py and test_skill_archive_codec.py both belong to the chain lane. Update both CI floor sources in the same backend commit after the reservation ends; use actual hosted collection counts. Current new case count is 29, before any later controls.
4. FRESH_ESTIMATE_SELECTION defaults off and is registered. Preserve receipt-versus-cycle distinctions, matching coverage/resolution and unique far-horizon tails. An off/on/off selection proof is not a buoy accuracy result and does not authorize arming.
5. Gzip writes retain existing monthly keys and strict ACK/create-only ordering. Release both compatible readers before any compressed writer runs. A rollback after compressed writes must retain compatible readers. No Storage object deletion or shared-data rewrite is authorized by the local fixture tests.
6. Keep the residual grace at 24 hours, paired scored window at seven days and scoring liveness at its existing shorter grace. An unreadable current or previous archive must remain non-green. Pending warning above85percent is distinct from actual eviction, which stays an error.
7. Do not repeat the independent audit's section2 controls. Use paired Jacobian controls for later physics changes, with heterogeneous states and a positive mutant. Do not add nested CPU timings or call callback cadence completed GPU frames.

## 2026-10-08 11:15Z — A8 proposed reconciliation and handoff (ledger seq 993)

Appended the requested task-to-evidence/status/action/acceptance table and separate implementation handoff to this session's owned log. Preserved canonical863 fulfillment and860 identity, proposed282/309 historical fulfillment, and the remaining independent acceptance gates. Candidate scoreboard rows use existing instrument IDs and preserve all published text.

Readback: Exact draft head9d314a98 code, ledger and preview checks are green. Post-diagnostic metadata11:15Z: healthy API, matching b02 source, complete13234 restore, zero errors. Data health remains WARN including EURO wind23.2h old. Regional ingestion is active; no additional hub/860 probe started.

Rollback: Append corrections if evidence changes; preserve historical task IDs and owner decisions.

## 2026-10-08 11:18Z — A-05 / A8-01 redirect discrimination (ledger seq 994)

A bounded non-forecast status read rules out the incidental account-notice candidate: HTTP 200 for the declared synthetic identity. The retained unclassified401 therefore remains unidentified. Added allowlisted origin categories backend/frontend/other and a timing discriminator: known request-to-finish versus late-discovered response-to-finish. Raw URLs, identities, headers, bodies and credentials remain excluded. No application auth change or broad fixture was introduced.

Readback: Four Node receipt controls pass; existing UI assertions remain unchanged. Active regional ingestion prevents the next real hub check. Backend repairs remain local and new chain tests still wait for the reserved hotfix/floor coordination.

Rollback: Revert the receipt-only extension; preserve failed-run facts and keep causal acceptance open.
