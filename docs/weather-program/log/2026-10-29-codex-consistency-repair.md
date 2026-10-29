# 2026-10-29 Codex: audited state-consistency repairs

Started 17:31 UTC. Owner requested a one-hour deep repair aligned with the previous audit,
avoiding the other active context and finishing no later than 14:30 America/New_York
(18:30 UTC). Owner added: "Make sure you're handling some of the most complex issues".

Base: freshly fetched dev `72b4652d5753423cce18b9ad1d1de95f0afcb7e7`.
Branch: `codex/audit-repair-20261029`, isolated existing worktree.

## Ownership and scope

Read the active **Audit each app feature** chat and its October 28 prioritized worklist,
continuation audit, repair coordination and current source-change inventory. Its active
booking-availability-repairs lane owns money, booking, gallery, crew and account repair work.
Primary-checkout changed source was separately checked; weather and map work remain with
their existing owner. This lane selected disjoint notification inbox/count/history,
search handoff/request ordering, Surf Log form/filter integrity, and profile-review reads.
No other checkout was edited. Existing frontend dependencies were linked read-only in use;
test/build caches and outputs use this worktree or task scratch.

No served weather number, scientific flag, model, map animation, payment policy, shared
database, live notification or external message is changed. No merge or deployment is selected.

## Forensic method and external review

- Used the diagnosing-bugs skill: actual React behavioral failures before fixes; isolated
  actual route/SQL fixtures for pagination; no normal backend startup.
- Three parallel implementation lanes with one owner per file; parent review and cross-review.
- Reflection Beam supplied an advisory review focused on stale mutation/count responses,
  account changes, stable keyset ties and geocoder ownership. Its initial attempt exhausted
  the response budget without an answer; a bounded lower-reasoning retry completed.
- Checked official React effect-cleanup and PostgreSQL unique-ordering documentation.
- Trevec, Context7, Logfire and SubQ were not exposed as usable tools. Plugin discovery and
  GitHub connector calls returned unavailable; Git/gh provided current branch/PR evidence.
  Public health retrieval via web failed; there is no fresh live-health claim.
- Entry memory audit: 0 FAIL, 57 WARN, 18 NOTE. Retained open commitments belong to their
  existing weather/release owners; this pass does not claim to fulfill them.

## Early measured results

- Profile reviews: actual component 7/7 failing baseline -> 7/7 passing after effect cleanup,
  identity reset and explicit retryable failure. Includes light/dark/beach, changed profile,
  changed role, cleared identity and old rejection/finalizer.
- Search: original 16-case baseline reproduced 15 failures; one positive control passed.
- Surf Log: original 11 React cases failed; query fixture baseline passed 1/9 (unfiltered).
- Notifications: 6 initial React cases failed. Global count, historical rows, retries and
  stale account/mutation completions exercised locally.
- Initial Chrome matrix passed six theme/width combinations (light/dark/beach; 390/1440px)
  using actual notification/review components and synthetic in-memory API responses.
  No page errors or external browser requests. This is component/browser evidence only.

Further verification and final source fingerprints will be appended after integration.

## Integration checkpoint

Final source fingerprint check covers all 12 application files. Final UTC frontend run: 95/95 tests,
10 suites. Backend: 51/51 (15 new regressions plus 36 CI-floor checks). The initially invoked lane
partition command used the repository root and selected zero files; rerunning from backend/ selected
760 tracked files and proved the partition (213 guards, 183 chain, 361 estate, 2 exclusions, 1 quarantine).
The estate floor was re-derived with the repository tool from hosted dev run40807961067:3376+15=3391,
floor3389. This is a projection for this branch, not a hosted result for it.

Final Chrome replay on frozen source: six theme/width combinations pass, with no external requests or
page errors. Repository-wide lint ratchet:1588 files; retained86errors/907warnings; no bucket increase.
Backend fatal lint and both size gates pass. Read-only final ownership comparison:12 source files here,
59 changed files in the active repair lane, zero overlap. Its current work is Saved Crew.

Disposable PostgreSQL17.11:19/19 actual route/query checks pass. Correction to early cleanup wording:
a Windows socket return10035 is inconclusive. The final verifier instead read the OS listener table
successfully and found zero listeners on its owned port after pg_ctl stopped the server; transient
credential file removed. Evidence: audits/evidence/2026-10-29-consistency-repair/postgres-results.json;
ledger fragment line2. No foreign-key/full-app/provider qualification is claimed.

Full frontend build initially failed because CRA ESLint tried to write through the shared dependency
junction to node_modules/.cache/.eslintcache. The compilation retry disables only the duplicate
build-time ESLint plugin; the separately executed repository-wide lint gate remains green. Build
outputs and webpack cache are confined to this worktree. Final build result will be appended.

## Final result

18:06 UTC: production frontend compilation exit0. Source maps off; duplicate build-time ESLint
plugin disabled only to avoid the shared node_modules cache; separate full lint gate passes.
Final95 frontend,51 backend,19 PostgreSQL and6 browser scenarios pass. All12 source hashes match.
Canonical ledger2074entries verifies; docs-only memory audit0FAIL/63WARN/12NOTE. The shift from entry
warnings reflects existing commitments crossing18:00, not new repair commitments.
No published branch, merge, deployment, shared data write or live acceptance. Local commit follows.

## Commit read-back

Source commit65380d9d3 saved locally; staged secret scan passed; worktree clean at read-back.
Post-commit fragment check0problems and canonical2074entries intact. Docs-only audit0FAIL/64WARN/12NOTE;
the extra warning versus63pre-commit is existing PR638 awaiting the lead-owned fold, not an introduced
repair defect. Two trailing JSX spaces were removed during commit whitespace checking (recorded in
the source manifest); no syntax or behavior changed. This documentation closeout records the receipt.

## Additional owner-requested call lifecycle repair

18:27 UTC: owner requested another complex audit repair before18:30. Fresh other-chat inspection
confirmed SavedCrew request lifecycle; WebRTC hook absent from its59changedfiles. Only
frontend/src/hooks/useWebRTCCall.js changed as application source. Retained/cancelled call timeout,
recipient ref, idempotent duration/stats monitors, retired-peer/late-stats guards, detached teardown,
and offer-owned/coalesced retry fix. No served weather number changes.

Actual Chrome baseline reproduces A timeout ending B; same finalhook passes4checks with no external
requests/pageerrors. Final103React tests across11suites pass, including8newhookcases; five independently
repeated. Full lint ratchet passes1589files with retained86errors907warnings; targeted finaltestlint
passes. Source hash c30722c811c63b2db765237d0174131fd59b7cf5c9d5b6e3e0896ba3526fc3da stable.
InitialJestRED was invalid mock-reset setup and is not productevidence. Memoryaudit0FAIL64WARN12NOTE.
Productionbuildpending. Asyncmedia/SDPcancellation and protocolcallID support remain separate known
limitations; no provider/device/deployed/full-call qualification. Report audits/2026-10-29-call-lifecycle-repair.md.

18:28 UTC closeout: production frontend compilation exit0 on unchanged source. Source maps and duplicate
build-time ESLint plugin disabled as before; separately executed full lint gate passed. Earlier build
pending entry is resolved. All owned browser/server resources stopped; local commit follows.

## Owner-requested memory and audit handoff after repair deadline

The owner explicitly requested memory/audit updates for both batches and a continuation handoff.
Application source remains unchanged from 1056b4f7b; all 13 fingerprints were checked. New canonical
handoff: docs/audits/2026-10-29-consistency-call-handoff.md; machine-readable evidence manifest:
docs/audits/evidence/2026-10-29-repair-handoff.json. Both individual reports link to the handoff.

Original October28 audit worklist and October26 status index/continuation received append-only
receipts and a local handoff entrypoint. Previous bytes were verified intact. A new memory extension
note was saved under memories_v2/extensions/ad_hoc/notes/2026-10-29-raw-surf-consistency-call-repair-handoff.md;
no generated memory file was edited. Fresh other-chat snapshot at18:31UTC remains SavedCrew overlapping
requests, and the59-file delta still has zero overlap with our13applicationfiles. No direct message or
acknowledgement is claimed. Source, log and ledger ownership are preserved.

The handoff distinguishes final103React cases from previous95+8, separate51backend/19PostgreSQL and
6+4Chrome checks, hosted/live/device limits, and valid versus invalid baseline evidence. It retains
pendingmedia/SDP cancellation, protocolcallIDs/reconnect, notificationdelivery/continuoussync, integration
and CI-floor reconciliation. WeeklychallengeISO/count is an unrepaired candidate; tie policy undecided.
Calling --baseline currently reads HEAD; historical replay must use3f3ebeed8. This documentation update
adds no repair, deployment, provider write, shared runtime change or served weather number.

Handoff review correction: cleanup wording now precisely states the transient PostgreSQL password
file was removed, not all database authentication state. The known pre-existing hardcoded TURN
credentials in the calling hook are an open provider-remediation item; no values are reproduced,
no rotation/configuration change was performed, and the browser fixture strips ICE configuration.
This residual is recorded in the canonical handoff, memory note and original-audit entrypoint.
Documentation validation: all13applicationhashes unchanged,15localreportlinks resolve, ledger2074OK,
fragmentcheck0problems. No application tests rerun for this documentation-only update.

## Explicit handoff delivery

The owner asked: Send the handoff to the other audit chat so it knows what is already repaired,
what still needs testing, and where to continue without duplicating our work. The app accepted a
message for Audit each app feature containing the canonical handoff and manifest paths, four saved
commit IDs, completed repairs,13-file ownership boundary,103=95+8 test accounting, separate backend/
PostgreSQL/browser evidence, baseline caveat, remaining issues and the weekly-challenge candidate.
Its current SavedCrew dialog label/description work was checked before sending. Recipient read or
acknowledgement has not been verified. No new application work or release was requested.

## Audit continuation direction and completed receipt

The owner explicitly directed the other audit chat to finish Saved Crew, then repair/test weekly
challenge ISO dates and participant totals and update memory/audit without touching weather. The
app accepted that direction. The audit chat was already executing the same sequence; no restart or
source duplication was requested. Its completed final turn and governance/report receipts were read.
SavedCrew27shared-Radix/7preservation/81retainedUI/API4 and3Chrome workflows pass. Weekly nativePG
baseline12of25 -> final25of25;8preservation; independentJan4 oracle835weekintervals+5UTCkeys pass.
These counts are qualified in its report and are not added to our103frontend tests. BothPGclusters
stopped/noOSlisteners. All86observedhashes match including80protectedprior sources; docs audit
0FAIL69WARN12NOTE; memory/plans/audit/sharedhandoffs updated by their owner. Weather untouched.

Companion handoff now supersedes its historical unrepaired weekly candidate with this separate-lane
completion. Source remains in the audit worktree; no overlay/integration/push/merge/deploy occurred.
Nonempty trophy storage still fails and rolls back; passing finalization proves empty-challenge date
selection/status. Scheduler, concurrency, hosted/integration/deployed acceptance remain open.

## Authorized trophy-storage and scheduler follow-up delivered

The owner explicitly asked the other audit chat to repair trophy storage, verify scheduler wiring,
fully test and update memory/audit without weather work. Fresh chat read confirms an active matching
turn. App accepted the follow-up with native persistence/readback, rollback/idempotency and isolated
scheduler-registration/UTC checks, preservation of ranking and earlier repairs, and explicit weather/
provider/release boundaries. No restart or duplicate source work requested. Completion remains pending
in the owning audit chat; this companion lane only records delegation and active ownership.

## Fresh continuation: selected existing WebRTC setup-cancellation repair

Fresh coordination continuation resumes existing unblocked local repairs only, with no new commits,
push/integration/migration/provider/security/weather actions. Reconciled shared plans and current
booking/admin lane status. Both current changed-file inventories have no useWebRTCCall.js delta.
Selected only the earlier queued media/SDP cancellation item in our owned hook; source/test writer,
read-only reviewer and separate browser-fixture writer have disjoint responsibility. Parent owns docs
and this ledger. Fail-first held-promise tests cover stale setup success/error, replacement, terminal
paths, duplicate starts/answers, account/unmount, timers and buffered ICE. No real media/signaling.

Credit newer booking readiness: final ordered-chain native PostgreSQL receipt reports9/9 on BOTH
candidate schemas, stopped/noOSlisteners. Target-specific PG and actual-checkout patch applicability
receipts supersede earlier local rehearsal gaps. These do not establish shared schema/version,
hostedCI or Claude acknowledgement. Preserve parent_link_approved and scheduler/stats schema boundaries.

## WebRTC setup cancellation final local result

Source froze at808a5a1eec5c55ab8127e5b398222f28c8f4ce1e0f888f98f53bc0560fdc0186,636lines.
Actualhook firstbaseline35failed/6positive controls. Review reproduced5intermediate failures plus1
abandoned-render failure before correction. Final55new+8unchanged cases=63pass; independent63pass.
Combined previous103+55=158pass/12suites. Browser14pass versus baseline2positivecontrols/12failures;
no pageerrors/externalrequests; timerszero and browser/serverclosed. Full lint ratchet1590files passes
with retained86errors907warnings. All12earlier applicationhashes, old8-case test and actual ICE block
match entry. An initial overly broad prefix assertion included the intentionally changed React import;
corrected exact ICE-block preservation check passes and is the relevant evidence.

Production frontend compilation exit0 by23:18UTC on unchanged source. Private worktree output/cache,
source maps off and duplicate build-time ESLint plugin off; separate full lint ratchet passed.
No backend/source-schema change or backend/PGrerun for this hook-only continuation. No paid/security
tools, realmedia/provider operation, weather application change, staging or commit. Source/test/evidence
remain localworkingdiff on originalHEAD1a3e51875. Report and combinedhandoff include precise residuals
and package boundaries. Other lane's latest ordered nativePG9/9 BOTHcandidate receipts credited without
claiming sharedschema readiness or actualClaude acknowledgement. Finalgovernance/ledger follows.

Final continuation readback: source/test/fixture fingerprints match; reportlinks resolve; HEADunchanged
and stagingempty. Canonical2074entries verifies; fragment0problems; docs audit0FAIL64WARN12NOTE.
Established memory extension note updated with local completion,158non-additive tests,uncommitted
status and residual owners. This selected existingqueue item is complete; no additionalrepair started.
Sharedschema/version and release steps remain with integration/databaseowners; actualClaude ack and
hostedCI remain pending. Code/test/evidence/doc working changes preserved for authorized review.

## Focused WebRTC local packaging preparation

Fresh direction explicitly permits one focused allowlisted local commit of the completed cancellation
slice. Previous no-commit testing state remains historical. Entryindexempty; all five tested code/test/
fixture fingerprints match; source remains808a5a1e. Existing158frontend/63independenthook/14Chrome and
productionbuild/fullLint receipts reused, not rerun or promoted to hostedCI. Approved12paths are listed
in the structured summary and tool readback. Seven earlier commits preserved; mandatory hook inspected
and unchanged (redacted localstagedsecret check +PythonLOC). No blanket staging or unrelated source.
