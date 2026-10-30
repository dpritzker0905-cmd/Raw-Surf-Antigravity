# Raw Surf — two-batch repair handoff

Updated October 29, 2026, after the owner's 2:30 p.m. America/New_York repair deadline.
Both code batches finished before that deadline; this subsequent update is documentation-only,
explicitly requested by the owner. Treat the status below as **repaired and verified locally**,
with integration, hosted CI and deployed acceptance still open. A subsequent completion receipt
at the end of this handoff records the audit lane's Saved Crew and weekly-challenge repairs; the
weekly-date/count candidate listed historically below is now repaired in that separate worktree.

Latest companion continuation: [WebRTC setup cancellation](2026-10-29-call-cancellation.md) is repaired
and verified, now saved in focused local commit `b3b2b75d685411da4288bd1374264edd363a4161`. Publication
and integration remain pending. Historical uncommitted testing descriptions below are superseded
for delivery status by the dated commit receipt at the end of this handoff.

## Start here: avoid duplicate work

Branch: `codex/audit-repair-20261029`. Base: `72b4652d5753423cce18b9ad1d1de95f0afcb7e7`.

| Commit | Completed work | Evidence |
| --- | --- | --- |
| `65380d9d3` | Notifications, search/navigation, Surf Log form/account/query consistency, profile reviews | [Batch 1 report](2026-10-29-consistency-repair.md) |
| `3f3ebeed8` | Batch 1 verification receipt; no additional application change | Same report and branch ledger |
| `1056b4f7b` | WebRTC timeout, peer callbacks, duration/stats monitors and retry ownership | [Batch 2 report](2026-10-29-call-lifecycle-repair.md) |

Do not rebuild these fixes from the historical audit descriptions. Inspect these commits and their
tests first. They are saved locally, not pushed, merged or deployed. The audit's older observations
remain historical evidence, not proof that these local fixes are absent.

The other chat, **Audit each app feature**, was inspected again at 18:31 UTC. It remains active in
`codex/booking-availability-repairs`, testing Saved Crew overlapping list requests. Its fresh changed-file
list contains 59 files; none intersects the 13 application source files below. It also owns the existing
booking, financial, gallery, account and crew repair lane. Weather/map/science remains with its existing
owner. Recheck current ownership before extending either lane; this snapshot is not a permanent lock.

At the documentation closeout, the shared audit worklist/index and continuation carried a pointer
to this handoff, and no direct message had been sent. The owner subsequently explicitly requested
delivery to the other audit chat. The app accepted that message for **Audit each app feature**,
including completed repairs, evidence, remaining tests and continuation guidance. Recipient readback
or acknowledgement has not been verified.

## Completed behavior and exact source ownership

| Audit area | Repaired behavior | Application source files |
| --- | --- | --- |
| Notifications (#35/#1306 and related inbox findings) | Stable older-history cursor, global unread controls, serialized writes and authoritative readback; stale account/open-cycle/read/mutation results rejected; error recovery, midnight regrouping and accessible rows | `backend/routes/notifications/notifications.py`; `frontend/src/components/NotificationsDrawer.js`; `NotificationsPage.js`; `frontend/src/hooks/useNotificationInbox.js`; `useUnreadCounts.js`; `frontend/src/services/notificationService.js` |
| Explore/search (#9/#111/#274) | URL query handoff, stale primary/fallback/result/finalizer rejection, Enter-before-debounce cancellation, short/cleared-query reset and query/tab-owned recent searches | `frontend/src/components/Explore.js`; `GlobalSearchBar.js`; `frontend/src/hooks/useExploreData.js` |
| Surf Log (#13) | Local calendar dates, zero/missing coordinate preservation, fresh draft reset, geocoder/form/save/account/list ownership, filtered total before pagination | `backend/routes/surf_data/surf_log.py`; `frontend/src/components/SurfLog.js` |
| Profile reviews (#167) | Old profile/role/retry/unmount completions ignored; cleared identity resets; failures have explicit retry | `frontend/src/components/ProfileReviewsSection.js` |
| Calling lifecycle (continuation: outgoing timeout / connection monitors) | A's timeout cannot terminate B; correct timeout recipient; one duration/stats monitor; retired peer events and late stats ignored; offline retries coalesced and bound to the original offer; cleanup detaches before close | `frontend/src/hooks/useWebRTCCall.js` |

Companion changes include regression tests, evidence scripts, the paired estate-floor records in
`.github/workflows/ci.yml` and `backend/tests/test_ci_floor_staleness.py`, one append-only scoreboard
row, our session log and our branch ledger fragment. Although application files do not overlap, shared
docs and CI floor changes require reconciliation at integration. Preserve both lanes' appended rows.

## Verified evidence — counts are not additive

| Instrument | Batch 1 | Batch 2 / final combined state | Scope |
| --- | --- | --- | --- |
| Frontend React tests | 95 / 10 suites | **103 / 11 suites = prior 95 + 8 calling cases** | Actual components/hooks with controlled services and clocks; not full-app/device acceptance |
| Backend checks | 51 = 15 new + 36 floor-governance checks | Not repeated for hook-only batch 2 | Local API/SQLite/SQL and governance checks |
| Disposable PostgreSQL 17.11 | 19 = 10 notification + 9 Surf Log | Not repeated for hook-only batch 2 | Real target-table types and route SQL; unrelated foreign keys omitted; no auth/startup/provider qualification |
| Chrome | 6 theme/width notification/review scenarios | 4 separate calling scenarios | Local actual component/hook; synthetic service/media/RTC/signaling; zero external requests and page errors |
| Production frontend compilation | Passed | Passed by 18:28 UTC | Same frozen application sources; source maps off, duplicate build-time ESLint plugin off to avoid shared cache writes; separate lint gate passed |
| Full lint ratchet | Passed | Passed over 1,589 files | Existing 86 errors / 907 warnings retained; no increased rule bucket |
| Other governance | Fatal backend lint, size/LOC and test partition passed | Whitespace/fragment checks and staged secret scan passed | Final documentation audit: 0 FAIL / 64 WARN / 12 NOTE; existing warnings remain |

The original five calling tests were independently rerun; three later tests cover late stats,
ICE-first event order and retry coalescing. The final combined run includes all eight. The independent
Chrome baseline **reproduced** A's timeout changing B from outgoing to idle, then passed all
four checks on the fixed hook. An earlier Jest RED run had an invalid reset media mock and is excluded
from defect evidence. Do not describe it as five reproduced application failures.

Evidence entry points:

- [Batch 1 structured summary](evidence/2026-10-29-consistency-repair/verification-summary.json),
  [source hashes](evidence/2026-10-29-consistency-repair/source-manifest.json),
  [Chrome results](evidence/2026-10-29-consistency-repair/browser-results.json),
  [PostgreSQL results](evidence/2026-10-29-consistency-repair/postgres-results.json).
- [Calling baseline/final Chrome results](evidence/2026-10-29-call-lifecycle/browser-results.json)
  and `frontend/src/hooks/useWebRTCCall.lifecycle.test.js`.
- [Combined handoff manifest](evidence/2026-10-29-repair-handoff.json), including all 13 current hashes,
  commit identities, fresh ownership comparison and verification totals.
- Session log: `docs/weather-program/log/2026-10-29-codex-consistency-repair.md`.
  Ledger: `docs/weather-program/ledger.d/codex--audit-repair-20261029.jsonl`.

All owned disposable PostgreSQL instances, browser instances and loopback fixture servers were stopped.
For PostgreSQL, the final OS listener-table read verified zero owned listeners; Windows socket status
10035 was inconclusive and is not closure evidence. The transient PostgreSQL password file was removed.

## Remaining issues and next work

1. **Integrate without duplication.** These commits are local and based on the recorded dev SHA.
   First compare fresh dev, this branch and the other lane's working changes. Keep source/test/evidence
   and ledger changes together. Reconcile shared scoreboard rows and re-derive both CI floor records
   for the combined test set. Current estate projection is 3,391, floor 3,389, derived from hosted dev
   run 40807961067 plus 15 new tests; it is not a hosted result for this branch. No integration,
   publishing, deployment or provider changes were authorized by this documentation request.
2. **Calling setup cancellation is still open.** Pending media acquisition, permission/SDP work or
   answer setup can outlive cancellation/unmount; this repair does not generation-fence those awaits.
   Reproduce with held promises, then require stale streams to stop and late success/error paths to
   neither signal, create timers nor clean up a newer call. Cover incoming and outgoing paths plus
   account/unmount boundaries. Claim ownership of the hook before extending it.
3. **Calling protocol/device acceptance is still open.** The existing signaling protocol lacks per-call
   IDs, so late network end/decline/answer messages across attempts are outside the local peer guard.
   Signaling reconnect lifecycle, real media, NAT/TURN and physical-device two-party calls are separate.
   The hook also retains pre-existing hardcoded TURN credentials. These were not added or changed by
   either batch; provider rotation and removal of public credential configuration remain open. Record
   only environment-variable names and remediation status, never the values. No rotation or provider
   configuration change was performed.
4. **Notification delivery is still open.** Quiet hours, digests, push/email/provider delivery and a
   continuously synchronized inbox list were not qualified. List freshness still needs a fetch/reopen
   or successful read action. Persisted settings/response-shape findings remain separate from inbox fixes.
5. **Full app and hosted verification are still open.** Authenticated navigation and integration of
   search, Surf Log, reviews and notifications, all real-device/theme layouts, deployed runtime identity
   and provider delivery remain unverified. Local Node was 24.21.0 versus repository pin 24.22.1;
   Python 3.12.10 had four missing declared packages. Hosted CI remains the release authority.
6. **An unimplemented complex audit candidate is weekly challenge ISO dates.** Read-only current-source
   checks found week 1 of 2024 starts December 25, 2023 rather than January 1; January 1, 2021 resolves
   to (week 53, year 2021) rather than (53, 2020); finalization assumes the previous year has 52 weeks.
   `backend/routes/career_hub/challenges.py` also counts only its top-20 display as total participants.
   These remain unrepaired. Recheck ownership, then test ISO rollover/53-week years and counts.
   Tied ranking/award policy is unresolved; do not silently choose it. Audit continuation pointers:
   lines 253, 342 and 4070 at the inspected version (search headings if lines move).

## Replay notes

Run backend tests from `backend/`, not repository root. Use the checked-in narrow tests and disposable
fixtures; ordinary backend startup can seed or modify data and is not part of this handoff.

From `frontend/`, use CRACO Jest with the final test pattern recorded in the manifest, `--runInBand`,
`--watchAll=false`, `--watch=false`, a writable worktree cache, `CI=true` and `TZ=UTC`.
The final eight call tests can be selected with `--testPathPattern=useWebRTCCall.lifecycle`.

The call browser fixture's `--baseline` reads **current Git HEAD**, not a pinned historical revision.
After commit `1056b4f7b`, using it directly no longer recreates the old defect. Historical RED evidence
is retained in `browser-results.json`; a repeat must use source revision `3f3ebeed8` with the verifier
in a separate scratch checkout, or explicitly pin that revision in a scratch verifier. Preserve the
fixture's in-memory source handling and ICE-configuration removal; never save a raw provider config.
The ordinary final replay remains usable from the current branch with a private output directory.

These are evidence-backed local repair receipts. They do not close the audit's whole feature areas,
scientific accuracy, security coverage, authenticated full-app behavior or deployed acceptance.


## Subsequent audit-lane completion — October 29, 2026

At the owner's explicit request, the audit chat completed the Saved Crew dialog slice, then the
weekly-challenge ISO date and participant-total slice. Its final turn and final governance receipt
were read back after completion. These application changes remain in its isolated
`codex/booking-availability-repairs` worktree; no source was copied into this companion branch.

- Saved Crew: 27 shared-Radix cases, seven preservation checks, 81 retained UI cases and four API
  checks, plus three Chrome workflows. The prior request-order and load-recovery fixes were retained.
- Weekly challenges: 25/25 native PostgreSQL cases against a retained 12/25 baseline; matching
  explicitly adapted SQLite results; eight preservation checks; independent January-4 oracle
  835/835 valid week intervals and five UTC boundary keys. The oracle assertions supplement the
  25-case matrix and must not be added as separate API tests.
- Dates now use matching ISO year/week, ISO Monday starts, and correct previous-week selection
  across 52/53-week years. Totals count all rows for the current challenge while preserving the top20
  display, existing ranking and trophy policy. Counts0/1/20/21/47 exclude seven other-challenge rows.
- Final governance: all86 observed source fingerprints match, including80 protected prior sources;
  ledger2074OK; documentation audit0FAIL/69WARN/12NOTE. Both disposable PostgreSQL clusters stopped
  with no owned OS listeners. Memory, plans and the audit lane's shared handoffs were updated.
- The existing nonempty trophy-finalization Text/list storage failure remains open and rolls back.
  Passing finalization cases prove date selection/status with empty challenges. Scheduler wiring,
  concurrent auto-creation, hosted CI, integration and deployment acceptance remain open. Weather
  application source and runtime were not touched.

For current status and detailed evidence, read the audit lane's
`docs/audits/2026-10-29-saved-crew-dialog-labels.md`,
`docs/audits/2026-10-29-weekly-challenge-boundaries.md` and
`docs/audits/evidence/2026-10-29-weekly-challenge-boundaries/final_governance.json`.
The audit lane is the owner of these changes and their continued verification. Do not implement
another weekly-date/count repair from the historical candidate paragraph above.

## Trophy storage and scheduler follow-up — authorized and in progress

The owner subsequently directed Audit each app feature to fix the retained trophy-storage failure,
verify scheduler wiring, fully test and update memory/audit without touching weather. The app accepted
that direction; the recipient's active turn already follows this scope. Acceptance includes native
badge persistence/readback, preservation of existing badges/ranking policy, nonempty finalization,
rollback and repeat-run behavior, and isolated verification of actual scheduler registration/callback
and UTC timing. Weather application source, jobs and runtime remain outside the work.

Completion is pending. Continue to treat trophy storage and scheduler wiring as open until the owning
audit chat publishes its final evidence and documentation receipts. Do not duplicate this active repair.

## WebRTC setup-cancellation continuation completed locally — October 29, 2026

Fresh continuation selected only the existing pending item in this lane's useWebRTCCall.js. This
working-tree repair now guards held media, permission and SDP success/error, owns ICE queues per
attempt, settles cancelled signaling waits, invalidates pending incoming answers on terminal actions,
prevents same-tick competing starts/answers, and stops late streams. Committed account identity guards
avoid an abandoned React render invalidating the live call. Pre-offer cancellation emits no hangup.

Evidence: docs/audits/2026-10-29-call-cancellation.md and its evidence directory. Initial actual-hook
baseline35fail/6controls; final55new cancellation cases plus8unchanged lifecycle cases pass63/63,
independently repeated. Combined prior103+55new=158tests/12suites. Browser baseline2/14 -> final14/14,
with no pageerrors/externalrequests and all owned timers/browser/server cleaned up. Full lint ratchet
passes1590files with existing86errors907warnings; production compilation exit0. Finalhook636lines,
SHA256808a5a1eec5c55ab8127e5b398222f28c8f4ce1e0f888f98f53bc0560fdc0186. All12first-batch source
fingerprints, original8-case lifecycle test and ICE configuration remain unchanged.

This repair and its new tests/evidence are UNSTAGED/UNCOMMITTED on codex/audit-repair-20261029 at
HEAD1a3e51875a90553d97fc637b4640bf02b3be656e. Do not assume that commit contains this continuation.
No source was copied into another worktree. No integration/migration/push/merge/deploy or weather
application change occurred. Preserve the companion parent_link_approved predicate and all other lanes.

Residuals: protocol call IDs, underlying signaling reconnect, async camera flip/toggle cancellation,
active remote-SDP failure recovery, and real-device/provider/hosted acceptance remain separate.
No additional repair scope is created by recording them. Shared schema/version, hosted CI and actual
Claude acknowledgement remain with the integration/release owners. The booking lane's finalized
candidate PostgreSQL, real-checkout patch-check, Alembic graph and ordered migration-function receipts
supersede earlier local rehearsal gaps; final ordered nativePG receipt is9/9 on BOTH candidates,
stopped/noOSlisteners. Those disposable receipts do not establish shared schema/version readiness.

## Focused local packaging authorised after verification

The owner's new local-commit instruction supersedes the earlier no-commit hold for this completed
WebRTC cancellation delta only. Historical unstaged/uncommitted statements above describe the testing
checkpoint at1a3e51875. The verified code/test/fixture fingerprints are unchanged; the existing158/63/14
and build/lint receipts are reused. Exact12-path allowlist is in the cancellation verification-summary.
Current delivery must be established by Git history/readback. The seven earlier commits remain intact.
Mandatory redacted staged-secret and PythonLOC gates stay enabled; no active/network security probe.
Publication/integration/sharedschema/weather authority is unchanged. No support consumer or auth/router
source is included in this package.


## Focused WebRTC commit readback and support-contract hold

Focused local commit `b3b2b75d685411da4288bd1374264edd363a4161` has parent
`1a3e51875a90553d97fc637b4640bf02b3be656e`, preserving all seven earlier commits. Exactly the 12
approved source/test/evidence/doc paths were staged and committed. The unchanged mandatory hook's
redacted local staged-secret check and Python LOC guard passed. Working source/test/fixture raw
fingerprints still equal the tested manifest; commit blobs equal those tested files under configured
LF normalization. Existing 158 frontend, independent 63-hook, 14 Chrome, build and lint receipts were
reused; no new test/build run is claimed. Immediately after commit, index and worktree were clean.
This subsequent delivery/coordination receipt is documentation only and remains unstaged.

The product decision authorizes an in-app support conversation plus a minimal email notice linking
after sign-in. ce30 remains producer/dashboard/new-inbox/backend owner; 2866's bounded potential slice
is notification consumer/deep-link behavior. No support consumer source has changed. Exact event,
ticket/recipient fields, route/auth-return and new helper-file reservation are still unconfirmed.
Coordination reported automatic approval review rejected ce30's contract transmission; its rejection
reason was not provided to this lane. No retry or alternate transmission was attempted after that
restriction. Direct cross-thread messaging is currently held by the latest direction.

Permitted read-only findings/test design, without choosing a new contract:

- NotificationResponse omits envelope user_id; agreed recipient binding is needed. Generic
  data.user_id currently falls through to a profile route. Validate a new event before read effects.
- Already-read clicks bypass mutation serialization; both surfaces need the agreed owner/cycle and
  duplicate-activation acceptance cases, including delayed reads and A-to-B-to-A.
- ProtectedRoute uses pathname+query in redirect and defaults to signup. Actual Auth tab/category/back
  changes drop that redirect; an already-authenticated Auth effect goes to feed. Auth/router/gate
  fixes remain outside this consumer slice and need the lead's ownership resolution.
- A new protected inbox route inherits the Grom gate unless explicitly handled; the ToS overlay mounts
  children. Test actual Auth/ProtectedRoute with BrowserRouter and fictional auth/API state once the
  lead contract is agreed. No provider messages, speculative route or auth-rule change was made.

## New app approvals and support contract retry outcome

The subsequent explicit app approvals permit normal redacted staged-file Gitleaks/LOC hooks, approved
support contract/ownership coordination between ce30 and2866, and SLA recalculation from original
created_at using the new priority's existing duration. SLA implementation remains ce30-owned. The
already completed WebRTC commitb3b2b75d685411da4288bd1374264edd363a4161 and its fingerprints are preserved;
no duplicate commit or test/build rerun was needed.

2866 requested the now-authorised contract retry, read the lead's actual local proposal and sent a
conditional agreement pending explicit consumer/helper reservation and invalid-payload/role/auth-return
confirmation. The lead's supported task state then confirms that its one permitted retry was again
rejected by automatic approval review: approval appeared in delegation context, whereas the reviewer
requires direct user authorization in the lead chat. The contract was not delivered by that retry.
No further retry, alternate transmission or consumer implementation was attempted after this outcome.

Consumer source remains unchanged. Event/payload/recipient/ticket/route/auth-return ownership agreement
is not complete. Shared router mounting remains with its current owner; ce30 owns producer/inbox/backend
and bounded auth work. No speculative helper, router/Auth/apiClient, SLA or other-worktree edit occurred.
Read-only test design is ready: actual notification surfaces/hook, UUID/recipient validation before read,
already-read/unread duplicate activation, delayed read/account/open-cycle changes, legacy destinations,
and actual BrowserRouter/Auth/ProtectedRoute with fake auth/API after agreement. Real providers, email,
weather, publication and shared migrations remain outside this lane.


## Three-file delivery receipt closeout

The owner authorised one focused docs-only local commit of this handoff, the existing own session
log and the existing branch ledger fragment. These three files form the complete receipt unit for
commit `b3b2b75d685411da4288bd1374264edd363a4161` and the already recorded support-contract hold.
Historical descriptions of these receipts as unstaged refer to their state before this closeout.

Expected parent is `b3b2b75d685411da4288bd1374264edd363a4161`; the delivery commit subject is
`docs(audit): close WebRTC delivery receipts and support hold`. Git history and final tool/chat
readback identify the actual new SHA and final status. No further tracked receipt edit will be made
solely to record this docs commit's self-referential SHA. The ledger entry records the allowlisted
unit and verified preconditions; the final readback remains in this conversation.

Application/test/fixture fingerprints are unchanged from the tested and committed WebRTC repair.
No app tests or production build were rerun for documentation-only content. Normal redacted staged
secret and file-size hooks remain enabled. No support contract retry, alternative relay, consumer
implementation, publication, integration, shared migration or weather action is part of closeout.


## Support consumer v1 implemented and verified locally

Fresh written action-specific owner approval authorizes implementation, testing and one focused LOCAL consumer commit. The accepted v1 exchange and explicit ce30 ownership acknowledgement supersede the historical pending-contract hold above. No denied transmission was retried through another route.

2866 completed only notificationDeepLinks.js, NotificationsPage.js, NotificationsDrawer.js and bounded useNotificationInbox.js changes, with three focused Jest files. Exact three UUID support metadata fields and current-recipient validation precede every activation effect; invalid read/unread replies cannot fall through to generic destinations. A committed account/open-cycle token and one pending lock prevent old callbacks, duplicate activation and stale completion. Suspense/StrictMode and A-to-B-to-A/open/unmount cases are covered. New support activation requires a successful authoritative refresh; existing non-support and bulk-read behavior is retained.

Final parent Jest253/253 across9suites (214new+39retained), nativeChrome9/39baseline to39/39 on identical frozen fixtures, fullLintRatchet1593files pass with existing86errors/907warnings, productioncompileexit0. Ten source/test/fixture fingerprints match; all five prior WebRTC fingerprints unchanged. Zero browser page errors/external requests; browsers/servers closed. Fixtures use synthetic account/API/unread/Sheet/ticket destinations; no fullCSS, actualauth/backend/email/provider/device qualification. See [consumer report](2026-10-29-support-notification-consumer.md) and its structured evidence.

Ce30 retains producer, inbox, delivery and bounded Auth. App.js mounting remains with its owner; ProtectedRoute/apiClient and all other-worktree source remain untouched. Next integration gate: combine producer/inbox/Auth plus this consumer, mount the accepted owner ticket route, then qualify authenticated return and ticket read/reply on the final combined head with CI. No source overlay, shared migration, push/PR/merge/deploy, paid/provider or weather runtime action.

Expected local parent0890cd877f586736751c46fecbd9ba59078f6f03; focused subject fix(notifications): validate and scope support reply activation. Actual SHA/committed names/final status are recorded by Git/tool/chat readback, without a post-commit tracked receipt loop.
