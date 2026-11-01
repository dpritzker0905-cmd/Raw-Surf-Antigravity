# Raw Surf: audit-driven consistency repairs, 29 October 2026

Local repair branch: `codex/audit-repair-20261029`, based on freshly fetched dev
`72b4652d5753423cce18b9ad1d1de95f0afcb7e7`. Work began at 17:31 UTC under the owner's
one-hour request and 18:30 UTC deadline. This report records local verification, not deployment.

For both completed batches, exact file ownership, current evidence and remaining work, start with the
[combined handoff](2026-10-29-consistency-call-handoff.md). This report preserves batch 1's historical
95-test result; the later combined total is 103 (95 plus eight calling tests), not an additional 103.

## Selection and ownership

The October 28 prioritized audit worklist and October 26 continuation audit were read from
the **Audit each app feature** chat's artifacts. The active chat and its repair coordination
were checked before selecting work. It owns booking, payment, gallery, crew and account repairs;
its later status was rechecking Saved Crew. Weather/map/science/animation work remains with
its existing owner. No forecast values, scientific flags or weather application code changed.

The final comparison found **zero overlap** between this branch's 12 application source files
and the other lane's 59 changed files. Three implementation agents worked in disjoint files;
the parent and a peer reviewed the changes and added further reproductions where needed.
Shared weather state and the canonical action chain were not rewritten; this branch uses its
own log and ledger fragment. The scoreboard addition reports only this lane's local app counts.

## Repaired behavior

| Area | Reproduced failure | Final behavior |
| --- | --- | --- |
| Notification history and counts | The latest 50 could all be read while an older unread item kept the navigation badge positive; the page/drawer hid mark-all and could not reach the older item. | Page and drawer use the account-wide unread count. The page loads older history with a stable `(created_at, id)` cursor. The existing array response and default 50-item page remain compatible. |
| Notification concurrency | Old account reads, old mutation completions and a pre-mutation badge request could overwrite current state. | Account/open-cycle and request generations reject obsolete results; writes remain serialized through their authoritative refresh. New notifications arriving after mark-all remain unread. Cross-mounted inboxes refresh after a successful write. |
| Notification usability | Failures looked empty, date groups stayed stale past midnight, and rows were clickable divs. | Errors have retry controls, date groups refresh across midnight, and rows use named native buttons. Category counts explicitly describe the loaded history. |
| Search and navigation | Old primary/fallback results replaced newer queries; one-character input retained results; View All lost its query; Enter before debounce could reopen the dropdown after navigation. | Query/tab changes invalidate transport and every completion path. Explore consumes URL queries even when reused; clearing clears the input; submitting cancels the sidebar request. Recent-search history accepts only current results. |
| Surf Log form integrity | Reverse geocoding attached an old name to new coordinates, manual names were overwritten, new drafts inherited edited fields, zero coordinates disappeared, and the default date used UTC. | Separate form/location request ownership protects the current draft, fields reset for new sessions, zero coordinates survive, missing coordinates serialize as null, and dates use the local calendar. |
| Surf Log saves and account changes | A late save closed a newer draft; old list reads overwrote current reads; account changes retained previous entries/editors. | Successful writes refresh their still-current account without closing a newer form. Page reads use account/request ownership. Switching accounts or logging out clears former-account drafts, setup, GPX and tracking UI state. Writes are not automatically retried or assumed cancelled. |
| Surf Log pagination totals | Filtered rows were paired with an unfiltered count: a two-row mood result reported four. | The count uses the same filtered relation before pagination, including empty and past-end pages. |
| Profile reviews | A late response or rejection for the previous profile/role overwrote the current profile; fetch failure claimed no reviews. | Effect cleanup protects success/error/finally, cleared identity clears data, and actual failures show an accessible retry. |

## Verification

- **95 frontend tests passed across 10 suites**, including all new behavioral suites and neighboring
  notification-service, shared-badge and Explore-recovery tests. The final combined run used UTC;
  local-date regressions explicitly pin local calendar getters and do not depend on the host timezone.
- **51 backend checks passed**: 15 new ASGI/SQLite or actual-route/SQL regressions plus 36 existing
  CI-floor governance checks. The lane partition claims every tracked test file.
- **19 disposable PostgreSQL 17.11 checks passed**: 10 notification cases and all nine Surf Log
  filter/count/page cases. Cases include tied timestamps, new/tied arrivals between pages,
  timezone-equivalent cursors, a deleted cursor row, exhaustion and account-scoped mark-all.
- **Six Chrome component/browser scenarios passed**: light/dark/beach at 390px and 1440px, using
  actual notification/review components with a synthetic in-memory API. Older unread history,
  mark-all visibility/action and reviews worked without horizontal overflow, page errors or
  external browser requests. This is not an authenticated full-app or physical-device test.
- Repository lint ratchet, backend fatal lint and LOC gates passed. The repository has existing lint
  debt; the ratchet reported 86 existing errors and 907 warnings, with no increased bucket.
- CI's estate projection was re-derived from hosted dev run `40807961067`: 3376 + 15 = **3391**,
  with floor **3389** and the existing margin of two. Hosted CI on this branch has not run.

Initial failing evidence was retained: search 15/16 failed plus three later navigation failures;
notifications 6 initial UI failures and 5/6 API failures; Surf Log 11 initial UI failures and
8/9 query failures plus save/account/read races; profile reviews 7/7 failed. Positive controls
and subsequent neighboring tests prevent interpreting a broken fixture as the application defect.

Evidence and replay tools: [verification summary](evidence/2026-10-29-consistency-repair/verification-summary.json),
[source fingerprints](evidence/2026-10-29-consistency-repair/source-manifest.json),
[browser replay](evidence/2026-10-29-consistency-repair/verify_browser.cjs),
[PostgreSQL replay](evidence/2026-10-29-consistency-repair/verify_postgres.py),
and [Surf Log SQL fixture](evidence/2026-10-29-surflog-integrity/verify_filtered_total.py).

## Evidence limits and cleanup

The PostgreSQL fixture uses real target-table column types and actual route SQL, with foreign keys
omitted so the unrelated application schema need not start. It does not qualify authentication,
full application startup, provider delivery or deployment. The server was stopped; the OS listener
table verified zero listeners on its port; the transient credential file was removed. A Windows
socket probe returned 10035 and was retained diagnostically, not used as proof of closure.

Local runtime: Node 24.21.0 (repository pin 24.22.1), Python 3.12.10. Python's environment checker
reported four missing declared packages. Results apply to this local environment; hosted CI remains
the release authority. No shared database, payment, email, live notification or external user data
was changed. Nothing was merged or deployed. API list freshness still depends on a fetch/reopen or
successful read action; this repair does not add a push-delivery or continuous inbox-sync guarantee.

The diagnosing-bugs skill guided failure-first checks. Reflection Beam's advisory review challenged
mutation/count races and cursor ties. Implementation principles were checked against official
[React effect cleanup](https://react.dev/reference/react/useEffect) and
[PostgreSQL ordering guidance](https://www.postgresql.org/docs/current/queries-limit.html).
Trevec, Context7, Logfire and SubQ were not exposed as usable tools; plugin discovery and GitHub
connector calls returned unavailable. Git/gh supplied current source and PR evidence. A public
health retrieval failed, so this report makes no fresh live-health claim.

## Final closeout

At 18:06 UTC the production frontend compilation completed successfully (exit 0), with source maps
off and the duplicate build-time ESLint plugin disabled to avoid writing through the shared dependency
junction. The separately run repository-wide lint ratchet passed. All 12 source fingerprints remained
unchanged through the final tests, browser replay and compilation.

Source repair commit: `65380d9d3`. The commit secret scan passed and the worktree read back clean.
Canonical ledger verification: 2,074 entries, intact; branch-fragment check: zero problems.
Post-commit docs-only memory audit: 0 failures, 64 warnings, 12 notes. The pre-commit audit had
63 warnings; the additional warning is the existing PR638 merge awaiting the lead-owned ledger
fold. Other warning/note shifts include existing commitments becoming overdue at 18:00 UTC.
Those commitments and the ledger fold remain with their existing owners. The selected repairs are ready
for review and hosted CI on this local branch. No push, merge, deployment or live acceptance is claimed.
