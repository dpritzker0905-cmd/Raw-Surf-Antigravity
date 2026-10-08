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

## 2026-10-08 11:20Z — PR264 reconciliation publication a79a2d02 (ledger seq 995)

Pushed the verified reconciliation, proposed historical fulfillments, candidate scoreboard rows and privacy-safe response-origin/timing categories to draft PR264 at a79a2d02. Backend candidates remain in the working tree; reserved routes and both CI floor sources are untouched.

Readback: Git push advanced 9d314a98 to a79a2d02. Pre-publication ledger994 and memory audit 0 FAIL, 8 WARN, 4 NOTE passed. All prior exact head9d code/preview checks passed; new head checks are pending and E2E causal acceptance remains open.

Rollback: Revert the proposed receipt extension by reviewed PR; preserve the ledger prefix.

## 2026-10-08 11:20Z — PR264 final-scope description (ledger seq 996)

Updated draft PR264 description to distinguish receipt tooling and proposed reconciliation from unpublished backend repairs. It records the observed auth landing without calling the unidentified401 causal, preserves D017 and lists open release/acceptance requirements.

Readback: gh pr edit succeeded with the exact body file; no PR merge or deployment was performed.

Rollback: Replace the description with a corrected final-scope description if evidence changes.

## 2026-10-08 11:35Z — A8-04 / SV02: validate product ids and bound read coordination (ledger seq 997)

Built public product-hint validation and bounded LRU read coordination offline. Owners and waiting readers pin the same download lock; saturation is a labelled refusal, never absence. Default limits are 256 download entries and 1024 negative entries. No served number, shared product or reserved file changed.

Readback: 27 focused controls pass, including 1000 distinct misses, public request validation and concurrent deduplication under pressure. 100 revision/stride/cache/identity companion controls pass. Same saved replay: old pool 1000 locks, candidate 256; 13301 saved registry filenames accepted. Backend candidate is unpublished; new test must be staged and its owning lane floors updated after #263 merges.

Rollback: Revert the candidate product-read changes; no Storage rollback is required.

## 2026-10-08 11:35Z — WF02 / CX34-07 / A8-05: recognize the producer pending stamp (ledger seq 998)

Reproduced fallback during loading with the producer pending object: the new exclusion test fails on the old comparison. Changed the guardrail to recognize a pending object and reset consecutive low-FPS evidence during loading. The diagnostic kill switch restores the old comparison. Actual sustained low-FPS fallback remains enabled. This changes no served number; 860 remains open.

Readback: 5 guardrail suites / 70 tests pass after the repair; the old comparison fails the pending-object test. The kill-switch positive control still triggers fallback. Frontend lint ratchet passes across 1242 files with no never-zero finding or increased rule debt. All 659 backend Python files meet the 800-line gate; reserved routes and CI floors have zero diff.

Rollback: Set window.__RAW_DISABLE_GUARDRAIL_FETCH_STAMP__ = true for a diagnostic rollback; revert the guardrail commit for a release rollback.


### Additional reconciliation and implementation handoff

| Existing task ID | Current evidence | Status | Next action | Acceptance requirement |
|---|---|---|---|---|
| A8-04 / SV02 | 27 focused + 100 companion passes; pinned owners/waiters survive pressure; 13301 saved product names accepted | Offline candidate qualified, unpublished | After #263 merges, stage the new test, project its owning lane and update both floor declarations in the same commit | Hosted request/cache controls pass; retained compatibility and labelled refusals; no shared load test |
| WF02 / CX34-07 / A8-05 | Before pending-object test fails; after 70 passes; kill switch reproduces the old fallback | Ready for publication, live acceptance open | Publish qualified frontend repair; then release only with E2E acceptance or an owner waiver naming the PR | Commitment 860's quiet stable paused receipt on matching deployed source; no playback claim |
| A-05 / A8-01 | Origin/family receipts are published; 401 cause remains open | Blocked on quiet live interval | Refresh the regional job and deployed source before one diagnostic hub journey | Identify the causal request and prove the targeted correction makes the real journey green |

Implementation handoff: the new backend candidates remain outside #264. They require staging their test files and updating both CI floors after Claude's reservation ends. The two earlier new suites have 29 cases; A8-04 adds 14 cases whose owning lane must be projected from the selector. The pending-stamp repair can publish independently and has a diagnostic kill switch. Do not merge #264 while dev E2E is red without a waiver naming #264. Preserve the paused, quiet 860 contract and all separate playback, served-time, Gulf, device and data-health acceptance work. Owner-only scientific switches stay off.

## 2026-10-08 11:39Z — PR264 guardrail source publication (ledger seq 999)

Pushed the qualified pending-stamp guardrail repair and receipts through seq998 on codex/a8-weather-audit-repairs at 644b9c6f2d7b00c9605077e7fe39ef04863f6f4c. Backend candidates remain unpublished. No merge, deployment or flag flip.

Readback: GitHub PR264 reads OPEN DRAFT at the exact pushed source. Encoding Guard passes; other fresh hosted checks are in progress.

Rollback: Revert the guardrail source commit; close the draft PR if abandoned.

## 2026-10-08 11:39Z — PR264 review description reconciliation (ledger seq 1000)

Updated PR264 title and description around the pending-stamp guardrail repair plus bounded E2E failure receipts, its 70-test qualification, and separate unpublished backend candidates. D017 named waiver and live acceptance holds remain explicit.

Readback: GitHub title reads fix(map): respect pending fetch stamps and retain E2E failure receipts; OPEN DRAFT source644b9c6f. Claude263 is still open; regional pilot37766797123 still active.

Rollback: Restore the preceding PR description if scope changes; retain all evidence in the append-only log.

## 2026-10-08 11:53Z — A8-04 / SV02: dynamic product compatibility qualification (ledger seq 1001)

Corrects the breadth of seq997 qualification: the initial candidate accepted all saved registry names but had not covered the separate dynamic viewport filename builder. Three new real-builder controls rejected legitimate dynamic products. Expanded the bounded suffix grammar to retain regional, world and antimeridian dynamic product identities. No candidate was deployed.

Readback: Final 131 focused and companion controls pass, including the three formerly rejected dynamic products, an incomplete suffix rejection, 1000-miss bounds, pinned concurrent deduplication, transient refusal labels, revision refresh and strided read identity. All 13301 saved registry names still accepted. New A8-04 suite now has 18 cases, not the earlier14.

Rollback: Revert the unpublished validator/read-bounds candidate; retain the original failure and correction receipts.

## 2026-10-08 11:53Z — WF03 / FE02: containment matches a valid instant (ledger seq 1002)

Built a dark client cache repair behind REACT_APP_MARINE_SERIES_INSTANT_MATCH, unset by default. Exact and containment selections compare frame valid_time with the current absolute target; unknown instants miss. Rebased relative hour metadata is copied, not written into cached frames; stored product and substitution receipts are preserved. Owner arming remains required.

Readback: Before the repair, 5 of6 new controls fail. Final9 suites /81 tests pass. Paired real client cache replay with fake transport:417 rollover requests, wrong selected instants278 before and0 after;139 same-anchor requests have0 cached-object changes. One offline fetch seeds each paired fixture; no live requests or physical forecast accuracy claim.

Rollback: Leave REACT_APP_MARINE_SERIES_INSTANT_MATCH unset/false; diagnostic kill window.__RAW_DISABLE_MARINE_SERIES_INSTANT_MATCH__ = true restores legacy matching.

## 2026-10-08 11:53Z — LIVE09 / FE03 and LIVE03 / FE04: calendar and missing size labels (ledger seq 1003)

Corrected the existing dark calendar helper so date-only identifiers remain intact while Today/Tomorrow follow the viewer timezone. Default current-condition size labels now show Unavailable for null, undefined and NaN in full and compact layouts; measured zero remains Flat. No physical served value or scientific flag changed. Daily numeric truth and upstream-coerced zeros remain separate acceptance work.

Readback: Six timezone controls fail before the calendar repair;18 default missing-label controls fail before the size-label repair. After:3 suites /72 tests pass, including light/dark/beach and both layouts, same numeric ladder, zero and rollback controls. Latest frontend lint ratchet passes across1244 files,86 existing errors/917 existing warnings, no increased rule debt.

Rollback: Diagnostic kills: __RAW_DISABLE_FORECAST_CALENDAR_LOCAL_TODAY__ and __RAW_DISABLE_MISSING_HEIGHT_LABEL__; the broader forecast identity and availability flags remain unset/off.


### WF03 and label reconciliation; implementation handoff

| Existing task ID | Current evidence | Status | Next action | Acceptance requirement |
|---|---|---|---|---|
| WF03 / FE02 | Paired417-request rollover replay278 wrong instants to0;139 same-anchor requests unchanged;81 passes | Locally qualified, dark and unpublished | Publish the candidate with scoreboard receipts; leave the build flag unset | Owner arming packet, hosted controls and isolated served-time/cache acceptance; no playback closure |
| LIVE09 / FE03 | Six timezone counterexamples fail before; viewer Today and date-only calendar controls pass after | Existing dark helper repaired locally | Publish with existing forecast identity flag off | US evening, date-line, DST, month/year and device label evidence; backend daily sampling remains separate |
| LIVE03 / FE04 | 18 default missing-label counterexamples fail before; full/compact light/dark/beach pass after | Current size-label repair qualified locally | Publish the label repair with its diagnostic rollback | Missing current height shows Unavailable; finite measured zero remains Flat; backend availability and daily numeric acceptance stay independent |
| A8-04 / SV02 | Qualification expanded to18 new cases plus113 existing companions/refusal cases | Corrected candidate131 passes, still unpublished | After #263 merges, stage all3 new backend suites; project29 chain cases plus18 A8-04 cases into their owning lane, update both floors in the same commit | Hosted actual collection equals projection and all relevant controls pass; no live flood |

Implementation handoff: retain 860, the hub causal E2E, and all owner-only arming requirements. Do not rerun the completed section2 receipts. Publish this tested frontend batch independently of the reserved backend floors; qualify the new source before considering a named merge waiver. A8-02's selection is dark and A8-03's Storage MIME/upload-ACK compatibility still needs a released-source receipt. Remaining health, ingestion, serving, physics, UI and process items stay in the supplied queue; no closure is inferred from these unit controls.

## 2026-10-08 11:56Z — PR264 frontend time and label publication (ledger seq 1004)

Pushed tested frontend time/label source and receipts through seq1003 at e7296da0ae30ccd245cd0cf169db233656f8ea68. Fresh hosted checks are required. Backend candidates are outside the push; all reserved routes/floors remain untouched. No merge, dev deployment or scientific flag flip.

Readback: GitHub PR264 reads OPEN DRAFT at the exact pushed source. Prior guardrail source644b9c6f CI37771266173 completed success; new source is not yet fully qualified by hosted CI.

Rollback: Revert the time/label source commit; leave the instant-match flag unset/off.

## 2026-10-08 11:57Z — PR264 final scope readback (ledger seq 1005)

Updated the reviewer description around fetch-state guardrail, dark instant matching, viewer calendar, missing size labels and retained E2E failure evidence. Local evidence is scoped; backend and live acceptance holds remain explicit.

Readback: GitHub PR264 title fix(weather): respect fetch state and cached frame instants; OPEN DRAFT sourcee7296da0.

Rollback: Revise the description if final scope changes; retain append-only receipts.

## 2026-10-08 11:57Z — 860 / A-05 quiet prerequisite and current data health (ledger seq 1006)

Regional ingestion37766797123 remains active, so neither860 nor another hub diagnostic was forced. Metadata-only11:56Z API/dev sourceb02 matches, restorationcomplete13262 with0errors. Data health remainsWARN: ICON marine cycle conflicting, ICON weather cycle missing, EURO marine cycle conflicting, EURO wind cycle23.9h old above18h. API availability is not data acceptance.

Readback: Four source/health endpoints returned200; prepared map Waves have not been enabled in this turn. Claude263 remainsOPEN with mergedAtnull; no merge action fabricated.

Rollback: No application/shared-data rollback; retain the blocker and genuine warnings until separate evidence resolves them.

## 2026-10-08 11:59Z — Current repair state and publication handoff (ledger seq 1007)

Reconciled the current source after the frontend batch push. All three unpublished new backend suites project to the chain lane, with 47 new cases total; the actual tracked projection and both floor declarations must be updated together after Claude263 merges. Post-push receipts1004 onward remain local for the next substantive publication. No docs-only merge loop.

Readback: Published frontend source e7296da0 on draft264; backend candidates remain local and the reserved files have no diff. Ledger verifies through1006 before this state note.

Rollback: Append a correction if a published source or acceptance claim changes.

## 2026-10-08 12:49Z — #263 (ledger seq 1008)

Claude squash-merged the owner-authorized hotfix into dev at baee6438b61aed13b9cc51a3ed7cb5b8276e4376. Generic public receipt only. The route and CI-floor reservation is released.

Readback: GitHub state MERGED; mergedAt 2026-10-08T12:34:17Z; mergeCommit baee6438b61aed13b9cc51a3ed7cb5b8276e4376. The canonical handoff section3 names Claude as actor and reports green hosted checks.

Rollback: Revert baee6438 on dev through a reviewed PR.

## 2026-10-08 12:49Z — A8 queue: integrate merged hotfix and release publication hold (ledger seq 1009)

Fetched origin/dev baee6438 and merged it into the repair branch as f6ec98125985d1a44112a4a95b8c1a87ed153aaa. Existing unpublished backend repairs were retained without conflict. Regional ingestion37766797123 completed success. Previous OPEN/in-progress hold records are historical, not current.

Readback: Local merge succeeded; GitHub263 MERGED and regional run COMPLETED/success. PR264 hosted checks at e7296da0 all passed before this source integration; fresh checks are required for the new head.

Rollback: Revert the integration merge with mainline1 on this branch if necessary; retain Claude hotfix on dev.

## 2026-10-08 12:49Z — WI02 / WI03: truthful ingestion exit and dependency health (ledger seq 1010)

Reproduced four false-success exits with real product-upload controls; repaired partial-upload failures, failed scheduled jobs, critical health and unreadable enabled health. Actual scheduler now returns failed/completed jobs and continues other lanes. Legacy mixed-cycle estimates are evaluated by verified anchor/donor cycles instead of treating a normal six-hour skew as unverified. Health exposes newest native cycle age, bounded grouped anchor/donor cycle receipts, skew and actionable dependency issues. No physical payload, serving selection or scientific switch changes.

Readback: Ingestion before4failed/19passed; after23passed; actual scheduler exception/empty/success controls plus existing scheduling checks30passed. Health before4failed/58passed; repaired health and estimator provenance companions138passed. The first companion run hung on Windows internal asyncio socketpair, was stopped only by its owned command line, then completed under the loopback-permitted offline runner. No cloud test or forecast load.

Rollback: Revert the ingestion exit/health source commit. Leave scientific flags off; preserve original evidence.

## 2026-10-08 12:52Z — A8 backend publication qualification (ledger seq 1011)

After Claude263 merged, staged the three new test files before running the canonical tracked-only selector. They add47 chain cases; existing ingestion controls add8 chain cases and data-health controls add13 guards cases. Exact collection delta248 to316 =68. Updated CI floors and their reference readings together: guards2554/floor2548, chain2471/floor2465/163files, estate1341 unchanged. These are projections awaiting hosted confirmation.

Readback: Combined offline backend batch396passed; floor parsing/staleness36passed; fatal flake8 passed; all660 backend Python files satisfy800LOC. Prior A8-04 compatibility and archive controls remain as qualified in the log. Scientific flags remain unset/off. No forecast traffic or shared data mutation.

Rollback: Revert the backend candidate commit and its paired floor changes together; retain append-only evidence.

Proposed reconciliation after Claude263 merge (canonical records still end at960 until this PR merges):

| Existing task ID | Current evidence | Status | Next action | Acceptance requirement |
|---|---|---|---|---|
| WI02 / WI03, A8-02 |396 combined offline backend controls; normal mixed cycles OK, stale donors critical; exit failures reproduced and repaired | Candidate qualified locally | Push source with coordinated floors; inspect exact-head hosted readings | No false-green partial/critical cycle; real anchor/donor provenance and separate live health receipt |
| 282 / 283, A8-03 | Historical282 recovery already proposed fulfilled989; gzip/readers/cap/seams qualified | Capacity repair candidate;283 acceptance open | Hosted qualification and bucket MIME/ACK compatibility receipt before10-14 | Both readers preserve bytes; durable scored/pending writes and month-seam monitor survive |
| A8-04 / SV02 | Real builder filenames and saved registry accepted; bounded miss/concurrency controls pass | Candidate qualified locally | Hosted collection and reviewed publication | Malformed IDs refused; no active-lock eviction; bounded negative/lock pools; no live flood |
| A-05 / A8-01 | Two diagnostic journeys fail; causal401 endpoint not identified | Open | One quiet Chrome diagnostic at released source using latest taxonomy | Named cause with positive control; genuine spot hub journey green |
| 860 / WF02 | Fetch-stamp producer-object repair offline-qualified; regional run now complete | Open | Verify current deployment/dwell/quiet prerequisites | One stable paused GFS Waves scene; counts/verdicts/CPU/gaps/fallback and cleanup health; playback remains independent |
| WI03 / IN03, IN04, IN06 | Audit cadence gap, premature manifest publication and receipt-based ceiling remain | Open; not closed by this batch | Monitor cadence then ACK-gated manifest publication and cycle-based horizon candidates | Scheduled liveness receipt, injected upload failure preserving durable registrations,336h cycle ceiling plus null/positive controls |
| 863 | Canonical fulfillment883 after254 merge | Fulfilled | Preserve closure | No duplicate rollout task |

Implementation handoff: publish the current backend source/floors on draft264; treat all new hosted readings as pending. Do not flip any scientific switch or infer live acceptance from unit tests. Continue IN03/IN04/IN06 in order, then the owner-only arming packet and remaining serving/physics/UI work. Retain the existing task IDs and do not repeat the already verified audit section2. Storage MIME/ACK and the bounded860 receipt remain acceptance gates.

## 2026-10-08 12:55Z — PR264 backend repair publication (ledger seq 1012)

Pushed db29b6435fa3ad15373ed8b5189c036693dc4be4 to the existing draft PR264, including backend source, coordinated floors and Claude263 merge receipt through1011. This is candidate publication, not deployment or acceptance.

Readback: GitHub264 OPEN DRAFT at exact db29b643; fresh CI37780206048 in progress. Prior e7296da0 was green; it does not qualify the new source. Netlify preview is available.

Rollback: Revert db29b643 and its paired floor changes together; leave owner-only switches off.

## 2026-10-08 12:55Z — PR264 review scope and 860 quiet hold (ledger seq 1013)

Rewrote draft title/description around the published source, validation and rollback. The former reservation is released, but current forecast ingestion37780016571, regional ingestion37777327032, precompute37776504487 and dev E2E37777820773 are active. No860 or extra hub journey was forced. Next work remains IN03/IN04/IN06 with existing WI task identities.

Readback: GitHub readback exact draft db29b643 and active workflow metadata. Backend MIME/upload-ACK and live acceptance stay open; no scientific flip or dev merge/deploy occurred.

Rollback: Revise the review description when source changes; preserve the blockers and scoped receipts.

## 2026-10-08 13:04Z — A8-04 hosted coordinate fixture qualification (ledger seq 1014)

The first combined backend hosted run db29b643 fails24 existing coordinate positive controls: their product hint offline-product is not a legitimate filename. The floor remains intact:1317 passed plus24 failed, not a silent skip. Corrected only the positive fixture to a real lane-specific filename, preserving all coordinate and exact forwarding assertions. Other published candidates remain scoped; first-head hosted acceptance is not claimed.

Readback: Completed estate job113321096927 reports24 failures, all in test_audit_weather_point_coordinates.py. Corrected real-router coordinate controls plus product-ID/read controls106passed offline with synthetic environment and blocked cloud access.

Rollback: Revert the fixture change if its generated filename is shown not to match the production builder; keep strict validation and all assertions.

## 2026-10-08 13:04Z — WI03 / IN03: rescue missed health-monitor slots (ledger seq 1015)

Added the existing data-health workflow to the backend dispatcher with its own5-minute grace. The ingestion lanes keep their30-minute grace. Added completion-liveness fields and an ERROR when no completed monitor is observed within120minutes; dispatch acknowledgments never clear that signal and do not imply healthy data. No actual workflow was dispatched by these controls, no token or scientific switch changed.

Readback: Before8failed/14passed; after23passed, including48/48 missed slots rescued exactly once over96 quarter-hour polls, active/completed-run suppression, overdue completion vs ACK and token privacy. Canonical selector owns test_workflow_dispatch.py in estate; +9 cases project1350/floor1348, unchanged file count. Actual cadence, log-alert delivery and independent external paging remain unverified.

Rollback: Revert the dispatcher monitor entry and paired estate floor/reference increment; existing ingestion rescue stays intact.

Reconciliation update: WI03/IN03 is now a locally qualified monitor-rescue candidate, not live cadence acceptance. A8-04 adds a corrected real-router fixture receipt; its validator and assertions are unchanged. The estate reference1350 is projected1341+9 and restores the failed24 positives without lowering the ratchet. IN04 and IN06 remain open under WI02/WI03. Implementation handoff: push this correction/monitor source, await exact-head hosted readings, then build an ACK-gated manifest publication candidate with upload-failure positive control and a verified-cycle336h ceiling candidate; keep the existing scientific switches off. The completion-overdue ERROR is an operational signal, not proof that an external page was delivered.

## 2026-10-08 13:07Z — PR264 monitor and coordinate correction publication (ledger seq 1016)

Pushed70098490 after the real-router correction106pass, monitor23pass and floor/selector47pass. Draft review now includes the monitor candidate and preserves cadence/alert delivery,Storage compatibility,hub E2E and860 acceptance holds. IN04 and IN06 remain next, with existing WI identities. No merge,dev deployment or scientific flip.

Readback: GitHub264 OPEN DRAFT at70098490; new hosted checks pending. The previous db29b643 estate failure is explicitly explained, not waived or hidden by a lowered floor. Fresh projected readings guards2554/chain2471/estate1350 remain to be observed.

Rollback: Revert70098490 and its paired estate floor change together; retain the validation and append-only correction receipt.

## 2026-10-08 14:51Z — claude/bind-actor-routes-batch1 (ledger seq 1017)

Canonical handoff reports Claude published the separate route-hardening branch at48ae107367ef7f464d40e5c0022b152373609772, approximately13:25Z. Owner chose Guard + batch1 now.

Readback: GitHub265 head and handoff agree; detailed unrelated route findings are not reproduced.

Rollback: Revert its merged change through a reviewed PR.

## 2026-10-08 14:51Z — #265 (ledger seq 1018)

Claude opened the separate route-hardening PR against dev under the owner-approved scope.

Readback: GitHub265 records head48ae1073 and subsequent mergefe5573db.

Rollback: Reopen/revert the merged change only through owner-authorized review.

## 2026-10-08 14:51Z — #265 (ledger seq 1019)

The owner merged265 into dev asfe5573db42bb8b147f4d085a39d540134bd2f8b4. Canonical handoff explicitly attributes the merge to the owner, not Claude or Codex.

Readback: GitHub mergedAt2026-10-08T13:52:40Z and mergeCommitfe5573db; healthy API version now matchesfe5573db. Handoff reports estate1446 on306 files.

Rollback: Revertfe5573db on dev through a reviewed PR.

## 2026-10-08 14:51Z — claude/live-session-escrow (ledger seq 1020)

Handoff reports Claude published its separate escrow candidate atc63b7f3d2b5ccfcf33b9eb788f0a868998b4c3f3, approximately14:25Z, under the owner-approved design.

Readback: GitHub266 OPEN at exactc63b7f3d. Codex has not modified that branch.

Rollback: Close the unmerged PR or revise it in its owning session.

## 2026-10-08 14:51Z — #266 (ledger seq 1021)

Claude opened its separate escrow PR against dev. The owner supplied its scope; no merge authorization is inferred here.

Readback: GitHub266 OPEN atc63b7f3d; its files do not include weather-feature source. Shared CI floors overlap.

Rollback: Close the unmerged PR in its owning session.

## 2026-10-08 14:51Z — PR264 exact-head hosted qualification (ledger seq 1022)

All hosted checks at70098490 passed; Netlify rule contexts are neutral. This qualifies the published source, not live smoothness, Storage compatibility or scientific acceptance.

Readback: CI37781744882: guards2554passed/67skipped on188files; chain2471passed on163files; estate1350passed/2865skipped. APIhealthy atfe5573db; datahealthWARN has three cycle-provenance alerts.

Rollback: Revert the qualified source commit if its bounded contract regresses.

## 2026-10-08 14:51Z — WI02 / WI03: IN04 and IN06 weather candidates (ledger seq 1023)

IN04 single/batch saves register only acknowledged designated-writer uploads, retain prior local bytes/registrations on refusal, bound payload queue to4 and preserve parallel uploads. IN06 default-off ESTIMATE_CYCLE_CEILING uses verified native cycle+336h or conservative nominal-anchor fallback; blend decay stays unchanged.

Readback: IN04 corrected fixture before11fail; after12controls pass. IN06 initial10counterexamples fail; repaired extension/heterogeneous Jacobian set36pass. Combined relevant batch210pass; floor/flag controls57pass. Three heterogeneous states per model yield identical retained values and sensitivities; four1% period/direction mutants detected. Initial exhausted/quantized probe was blind and was corrected, not reported as scientific parity. Fatal lint/LOC pass.

Rollback: Revert candidate source and paired CI floors; leave ESTIMATE_CYCLE_CEILING off.

## 2026-10-08 14:51Z — Weather forensic and Jacobian reconciliation


Relevant history reviewed: store registration/refactor9106dbc0, manifest concurrency51cdb703, per-item isolationbe8771c3, receipt-clock tail repair04b64846, ICON tier62030654, provenance6dfe9703/1912639b and currentdb29b643/70098490. This is a scoped review of these weather paths, not a claim that every repository commit or file has been audited. Prune/restore manifest writers operate on registered entries; the shared single/batch boundary now withholds new entries until upload ACK. Existing mutable-key revisions, manifest CAS/lost updates and CDN acceptance remain independently tracked. No source from unmerged266 is integrated.

Online design references: [Python futures](https://docs.python.org/3/library/concurrent.futures.html) distinguishes submitted work from its result/exception and warns about same-executor waits. The ACK barrier runs in the caller, keeps upload parallelism, and bounds queued payloads. [Supabase uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads) treats upload success/error explicitly and warns about overwrite/CDN propagation; this repair does not certify revision freshness or multi-object transactions. [ECMWF forecast time](https://codes.ecmwf.int/grib/format/grib1/ctable/5/) defines valid forecast time relative to reference time, supporting separate model-cycle and ingestion clocks.

| Existing task ID | Current evidence | Proposed status | Next action | Acceptance requirement |
|---|---|---|---|---|
| WI02/WI03 IN04 |11 genuine failing controls before;12 repaired controls;210 combined relevant passes; delayed/refused/parallel/timeout and local-only paths covered |Candidate qualified offline |Publish exact source and inspect hosted results |Real ingestion ACK precedes registration; mutable-key/CDN and CAS receipts remain separate |
| WI03 IN06 |10 receipt-clock failures before;36 extension/Jacobian controls after; retained values and Jacobians identical, four mutants detected |Dark candidate qualified offline |Publish; prepare owner arming evidence |Verified cycle bounds at336h, short native controls and independent released coverage receipt |
| A8-03 /282/283 |Gzip/readers/cap/seams in qualified70098490; no bucket MIME/upload compatibility receipt |Acceptance open, deadline before10-14 |Read actual bucket configuration/compatibility in an authorized isolated scope |Both real readers and durable uploads succeed; historical282 closure stays preserved |
| A8-01 /A-05 |Causal hub401 still unnamed;265 changed auth and266 remains separate/unmerged |Open |Bounded diagnostic when released source and quiet prerequisites hold |Named cause and positive control with genuine successful hub journey |
| 860 /WF02 |Qualified fetch-stamp repair; stable paused live receipt still missing |Open |Refresh source/dwell/quiet/focus prerequisites |Paused counts/verdicts/CPU/gaps/fallback plus cleanup; playback independently accepted |
| 863 |Canonical883 fulfilled |Fulfilled |Preserve closure |No replacement task |

Implementation handoff: integrate only already merged265, combine its105 estate cases with IN03's9 (1455, floor1453), and add34 chain cases (2505, floor2499;165files). Keep scientific flags off, preserve all open acceptance gates, and qualify the new exact source on hosted CI. Next evidence gap is archive Storage compatibility, followed by serving concurrency/encoding and the remaining independently tracked physics/UI work. No live forecast load or shared Storage write occurred.
