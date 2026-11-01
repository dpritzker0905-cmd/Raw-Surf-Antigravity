# Support SLA card scope — isolated continuation

Owner: Codex, chat01a188c2-90f8-7b11-a690-39f8cfdd9957, ce30/raw-surf, codex/admin-support-selection-20261029. David authorized a forensic recheck and the next support-ticket audit issue with isolation/no overlap/no weather disturbance.

Target: audit finding993. The list's overdue flag applies to unresolved tickets of any age, but the SLA card's API count uses the requested creation-date cohort (dashboard requests30 days). The card does not disclose that cutoff. Reproduce this cross-surface distinction and clarify existing scope without changing the query, numbers, SLA reset, reopen, backlog policy or ticket lifecycle.

Only the already-owned support UI card helper text changes in this slice, with session-owned evidence/log/fragment. No new unit tests are needed for a reversible text change; use existing UI regressions, actual backend query/flag fixtures and browser evidence of the reported mismatch. Other chats are working on monthly trophies/companion handoff checks; primary/booking/2866 support-file status is clean at entry. No other checkout edit/message/acknowledgement is claimed. Preserve historical repair evidence.

## Forensic verification and reproduction

Entry **51/51 checkpoint hashes**, **78/78 existing UI checks**, **12/12 prior metrics cases** and **10/10 prior status-persistence cases** pass again. Historical source/test/evidence files are preserved. The backend and other50 checkpoint hashes remain unchanged.

Actual list and metrics handlers/model declarations pass **11/11** scope-characterization cases with a fixed clock and fictional SQLite data. An unresolved ticket created31 days ago has a list overdue flag but a zero30-day card count; a recent overdue ticket is counted by both. Exact creation cutoff is included, one second outside is excluded, future/equal deadlines are not overdue, Resolved/Closed are excluded, Waiting Internal retains the existing unresolved SLA behavior, custom7-day scope is respected, and mixed records retain the same distinction. Every fixture-table snapshot is unchanged by the reads. These characterize existing behavior; no backend numbers or definitions were repaired or reinterpreted.

The browser baseline reproduces the presentation gap: an older overdue row shows its red list indicator beside a zero SLA card whose only text is “SLA Breached.” The new scope assertion fails and baseline JSON/screenshot are retained. The repair adds one helper paragraph: **“Unresolved tickets created in last30 days.”** It identifies the existing fixed dashboard request period. It does not make the card an all-age backlog count or change the list flags.

## Final qualification

Existing UI regression suite **78/78** passes on the final source. No new string-mirroring unit tests were added for this reversible copy change. Final Chrome **6/6**, three themes at1440×1000 and390×844, retains previous support workflows and checks older-overdue flag/card0 with explicit scope, recent-overdue card1 with the same scope, refresh back to the older case and selected draft retention. Actual controls/ThemeProvider/CSS and UTF-8 are used; no external requests, page errors or horizontal overflow. Light/mobile screenshot inspected.

The new wording made an older browser text locator also match the SLA note. Only the new fixture's resolved-cohort locator was made exact; historical fixtures and product code were not changed to accommodate that harness ambiguity. Final six-case browser run supersedes that failed invocation.

Scoped ESLint on component/five existing tests: **0 errors/0 warnings**. Fixture narrow flake8 and Python syntax pass; actual imports compile in Webpack; whitespace/source bounds pass. Removing the single helper line reconstructs the entry component SHA256 exactly. No event handler, query, payload, selector, calculation, status definition or styling was changed. Component633 physical lines remains below800.

## Artifacts and reproduction

Evidence directory: docs/audits/evidence/2026-10-29-admin-support-sla-scope/. `entry-hashes.json` and `verification.json` bind source/readback and compact case results. `sla-scope-cases.json` retains actual handler output and table snapshot hashes. `baseline-sla-scope.json` / PNG retain the missing-scope reproduction. `browser-results.json` / six PNGs retain final browser checks. Raw Jest/lint output and caches/build artifacts are ignored. All tickets/accounts are fictional.

```powershell
$env:RAW_SUPPORT_TEST_DEPS='<existing frontend node_modules directory>'
$env:NODE_PATH=$env:RAW_SUPPORT_TEST_DEPS
node docs/audits/evidence/2026-10-29-admin-support-sla-scope/run-tests.cjs
node docs/audits/evidence/2026-10-29-admin-support-sla-scope/run-browser.cjs
& '<Python with SQLAlchemy and aiosqlite>' docs/audits/evidence/2026-10-29-admin-support-sla-scope/verify-sla-scope.py
```

Backend fixtures bypass application/auth initialization and use a disposable in-memory database. SQLite returns naive timestamps, so only the fixture's sla_due_at result processor attaches UTC to known-UTC synthetic timestamps, matching the app column's timezone-aware intent and permitting the actual list flag's Python comparison. That is an explicit fixture seam, not an application model/schema/migration change. No app .env is loaded. Browser auth/API modules are substituted; CSP/request routing confines traffic to the owned temporary loopback server; browser/server close on completion.

## Isolation, limits and rollback

Primary/booking/2866 support-file Git status is clean at entry/closeout; current chat scopes were inspected. No other checkout/message/acknowledgement is claimed. This slice changes one paragraph in the existing owned UI; the cumulative candidate's prior backend changes are preserved. Shared primitives/models/auth/API client, backend code, weather runtime/flags/STATE/ACTIONS/SCOREBOARD and served weather numbers remain unchanged. Only session-owned log/ledger entries record this work.

This clarifies the current creation-cohort reporting window; choosing a different SLA/backlog period, priority-reset or reopen policy remains separate. Full-app/mounted-auth/PostgreSQL/real-data/hosted-CI/physical-device/cross-browser/assistive-technology acceptance is unverified. No live/provider/security/paid/shared-migration/commit/push/merge/deployment action.

Rollback: remove the helper paragraph and verify the recorded entry SHA256; no data rollback. Preserve earlier repairs or abandon the whole uncommitted candidate separately. Reconcile current source ownership before integration. Final repository checks will be appended after actual readback.

Final repository readback: canonical ledger **2074 entries, OK**; docs-only memory audit **0 FAIL, 63 WARN, 12 NOTE**, exit0. The existing weather commitment warnings are outside this support slice. Final manifest confirms entry51 hashes, prior/final78 UI passes,11 SLA scope cases,12 metrics cases,10 status cases and6 Chrome scenarios. One-line reconstruction protects the other50 checkpoint hashes; whitespace passes. Implementation action is session fragment line11. Candidate remains local, uncommitted and unpublished; no live or release action.
