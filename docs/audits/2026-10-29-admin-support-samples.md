# Support response/resolution measurement counts — isolated repair

Owner: Codex, chat 01a188c2-90f8-7b11-a690-39f8cfdd9957; ce30/raw-surf; codex/admin-support-selection-20261029. Authorization: David requested a fresh forensic verification followed by the next support-ticket audit issue, isolated with no overlap/weather disturbance.

## Contract and ownership

This slice owns the already-reserved backend/routes/admin/support.py metrics query/response and frontend/src/components/admin/AdminSupportDashboard.js average cards, plus new scoped tests/evidence. Primary/booking-availability-repairs/2866 support-file Git status is clean at entry. The active audit chat is working on weekly challenges; the companion repair chat is idle after handoff reconciliation. No messages/acknowledgements are claimed. Historical selection/pagination/metrics evidence is preserved.

Reproduce the audit finding that an average with no observations is displayed as0h. Add first_response_sample_count and resolution_sample_count from the same eligible non-null duration expressions used by the existing averages. Preserve existing numeric average fields, values, filters/cohort, status/SLA policy and query count. The UI should show an em dash and explicit no-measurements text only for a reported count of0; a measured zero stays0h. Positive counts disclose sample size. Missing count fields preserve compatibility with an older backend.

This does not select a resolution/reopen, SLA-reset or backlog policy. Ticket-number allocation, customer delivery and underlying metric-policy issues remain separate. No schema/migration/provider/auth/security/weather change.

## Evidence

Entry forensics passed **32/32 checkpoint hashes**, **60/60 UI regressions** and **10/10 prior pagination-handler cases**. Historical reports, tests and evidence are unchanged. At closeout only the two owned runtime hashes intentionally differ; the other30 checkpoint hashes still match.

Actual-component UI baseline: **4/10 passed**. Genuine-zero, older-backend, failed-read and stale-response controls already worked; absence/sample-size presentation failed. Final combined UI suite: **70/70**, including all previous60 and ten new cases. No observations render an em dash and explicit text; an observed zero remains0h. Response/resolution sample sizes are independent, singular/plural labels are tested, refresh transitions retain correct state, and absent fields from an older backend preserve the previous numeric display without inventing counts.

Offline execution of the actual get_support_metrics function and actual SupportTicket/TicketMessage/enum declarations: **0/12 ->12/12** for the new count contract. All legacy numeric averages were already correct under their existing definition and are identical before/after; the baseline failed because sample metadata was absent, not because average arithmetic was newly corrected. Cases cover empty/unanswered cohorts, actual zero durations, positive durations, independent missing values, excluded old creation dates, the exact30-day boundary, one second outside it, a custom7-day window and retained timestamp eligibility for a reopened row. The latter explicitly preserves the known lifecycle-policy issue; it does not endorse or fix that policy.

Each fixture metrics call executes exactly **nine SELECT statements**, before and after. Both new counts use the same non-null duration expression and WHERE filters as their paired average, in the same aggregate SELECT. Before/after snapshots of all fixture tables match. The existing numeric fields/rounding, query eligibility, status/SLA/backlog behavior and route dependencies are preserved. The two added integer response fields require no migration. The prior ten list-handler cases also pass again after the backend-file change.

Final Chrome **6/6**, light/dark/beach at1440×1000 and390×844, uses actual React/primitives/ThemeProvider/CSS with fictional API/auth seams. It retains previous selection/draft, pagination and metrics lifecycle scenarios, then tests absent samples, measured zero, older-backend compatibility and independent response/resolution counts. Final screenshots display no response observations beside one measured zero-resolution observation. Actual theme CSS and UTF-8 are asserted; no page errors, external requests or horizontal overflow. Light/mobile screenshot inspected. Browser viewports are emulated, not physical-device evidence.

The first browser sample assertion exposed a fixture encoding defect: its HTML had no charset and Chrome used windows-1252, turning an em dash into mojibake. The saved encoding-diagnostic.json records the actual character set and rendered text. The real app's public/index.html already declares UTF-8; it was not changed. Only the new fixture's HTML/meta/MIME headers were corrected, then all six cases reran successfully. Earlier browser failure is not counted as product failure or accepted theme evidence.

Scoped ESLint on the component/four tests: **0 errors /0 warnings**. Scoped backend/fixture flake8 E9,F63,F7,F82 and Python syntax compilation pass. Actual component imports compile in the Webpack fixture; source/hash bounds and whitespace checks pass. Component630/backend434 physical lines, both within the800-line rule.

## Reproduction and artifacts

Evidence folder: docs/audits/evidence/2026-10-29-admin-support-samples/. `entry-hashes.json` and `verification.json` retain checkpoint readback, per-case summaries and source/harness SHA256 hashes. `baseline-handler.json` / `handler-results.json` retain actual averages/counts/query totals and immutable fixture snapshots; `list-recheck.json` / `final-list-handler.json` retain the prior list checks. `browser-results.json` and six final screenshots retain final browser evidence. Raw Jest/lint dumps, build output and caches are ignored. All account/ticket data is fictional.

From repository root with existing dependencies:

```powershell
$env:RAW_SUPPORT_TEST_DEPS='<existing frontend node_modules directory>'
$env:NODE_PATH=$env:RAW_SUPPORT_TEST_DEPS
node docs/audits/evidence/2026-10-29-admin-support-samples/run-tests.cjs
node docs/audits/evidence/2026-10-29-admin-support-samples/run-browser.cjs
& '<Python with SQLAlchemy and aiosqlite>' docs/audits/evidence/2026-10-29-admin-support-samples/verify-metric-samples.py
```

The backend fixture reuses the prior offline declaration loader, fixes time and uses a fresh in-memory database per case with lightweight Profile/Booking foreign-key seams. No normal database/app initialization, app .env, authentication or provider path is imported/executed. Browser traffic is confined to its owned temporary loopback server through substituted auth/API modules, CSP and request routing. Browser/server close on completion. This is function/query/model and local UI qualification, not mounted authenticated API or real support history.

## Isolation, limits and rollback

Read-only support-file Git status in primary, booking-availability-repairs and2866 was clean at entry/closeout. Current chat scopes were checked; no other checkout was edited, and no message/acknowledgement is claimed. The cumulative candidate still has only the two owned runtime paths. Models, shared UI/auth/API client, real HTML encoding and weather runtime/flags/STATE/ACTIONS/SCOREBOARD remain unchanged. Only this session's append-only log/ledger fragment accompany the source/evidence work.

PostgreSQL, mounted/full-app authentication, real support records, hosted CI, physical devices, other browsers and assistive technology remain unverified. Counts describe the current created-at/timestamp eligibility, including its retained reopen-policy limitation. Older backend responses cannot disclose absence until the additive fields are available; their numeric behavior is deliberately preserved. Query-count evidence does not establish production latency or whole-response snapshot consistency. Ticket-number allocation, delivery, resolution/reopen and SLA-reset policy remain separate audit issues.

No normal app/weather runtime, provider/security test/live-data/paid-resource/shared migration/commit/push/merge/deployment action. No weather served number changes; this adds support measurement metadata and presentation only. Candidate remains local/uncommitted/unpublished. Roll back this slice against its recorded entry hashes to retain previous support repairs, or revert the cumulative runtime diffs to abandon the candidate; no database/provider rollback. Reconcile source ownership again before integration. Repository checks are recorded after actual readback below.

Final readback: canonical action ledger2074 entries OK; docs-only memory audit0 FAIL,63 WARN,12 NOTE, exit0. Fresh hash/source bounds and git diff whitespace pass. Implementation record: ledger.d/codex--admin-support-selection-20261029.jsonl:7. No release/live action followed qualification.
