# Raw Surf — two-batch repair handoff

Updated October 29, 2026, after the owner's 2:30 p.m. America/New_York repair deadline.
Both code batches finished before that deadline; this subsequent update is documentation-only,
explicitly requested by the owner. Treat the status below as **repaired and verified locally**,
with integration, hosted CI and deployed acceptance still open.

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
