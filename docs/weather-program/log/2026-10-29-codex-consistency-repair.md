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
