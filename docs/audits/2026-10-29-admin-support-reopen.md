# Support reopened-ticket resolution timestamps

Owner: Codex, chat01a188c2-90f8-7b11-a690-39f8cfdd9957, ce30/raw-surf, branch codex/admin-support-selection-20261029. David requested another forensic recheck and the next support-ticket audit issue, isolated with no overlap or weather disturbance. HEAD72b4652d5753423cce18b9ad1d1de95f0afcb7e7 remains unchanged; candidate local, uncommitted and unpublished.

## Problem and repair

Audit finding179, continuation section “Support-ticket resolution timestamps and SLA,” identifies that active tickets retain their earlier resolved_at after reopening. The metrics handler includes recent rows with any non-null resolution timestamp, so the old observation remains in the resolution-time average. Priority-related SLA policy in the same finding was unconfirmed and is outside this repair.

The repair adds **three lines in backend/routes/admin/support.py**. An explicit status update to Open, In Progress, Waiting User or Waiting Internal clears resolved_at in the same SQL UPDATE as the status. The existing first-public-reply path also clears it when that path changes status to In Progress. Closed preserves its existing resolution timestamp; explicit Resolved retains its existing timestamp-setting behavior. Metadata-only changes, internal notes and later replies keep their existing behavior. No SLA deadline, priority policy, resolution-average query, API shape, model, migration or frontend change in this slice.

This is forward lifecycle consistency. Untouched historical active rows with stale timestamps remain eligible under the existing metrics query; no data cleanup or inferred resolution history is applied. The model has a single current resolution timestamp, and this change adds no event history.

## Forensic recheck and baseline

Before editing, **60/60** source/test/evidence hashes match the prior SLA-scope verification. Fresh existing UI suite **78/78**, actual metrics **12/12**, status persistence **10/10** and SLA-scope **11/11** pass. The UI suite includes selection/drafts, pagination/list failures/races, metrics refresh, absent-versus-zero sample handling and Waiting Internal controls.

The new actual-handler fixture baseline passes **10/26**, with16 failures specifically retaining old resolution timestamps on active transitions and the existing first-public-reply transition. Example: Resolved to Open persists the old timestamp and leaves2 metric samples, rather than removing the target and leaving the1 unchanged comparison ticket. Baseline JSON retains those field/count observations and table hashes.

The initial fixture invocation stopped on SQLAlchemy expiration after commit because its session used the library default. The application's database.py uses expire_on_commit=False; the fixture was corrected to match before the recorded baseline. This was a fixture setup failure, not the stale-resolution reproduction. A final auxiliary assertion additionally verifies first-response timestamp/sample persistence; no product workaround was made for the harness.

## Final verification

**26/26 lifecycle cases** pass through actual handlers, request models, ticket/message declarations and metrics SQL, using a fixed clock and separate sessions for durable readback:

- Resolved and Closed to each of the four active statuses clear the timestamp; explicit active statuses also clear existing stale timestamps.
- Reopen then re-resolve removes the old observation and records the new72-hour resolution duration. With the untouched4-hour comparison ticket, the resulting average is38 hours.
- Resolved/Closed terminal updates, metadata-only and priority-only edits preserve existing behavior; the priority fixture independently checks the existing four-hour High deadline.
- First public replies on Resolved, Closed and a stale Open ticket clear resolution, persist one message, and set the first-response timestamp/sample. Internal notes and later public replies retain existing terminal behavior.
- Injected update/reply commit failures, followed by rollback, preserve every row and column and leave no new message. Every successful case checks all unrelated columns, rows and tables plus exact message persistence.

Prior backend contracts pass again on the final code: metrics12/12, status10/10, SLA scope11/11. The metrics fixture deliberately continues to characterize untouched historical stale rows, rather than silently revising query eligibility. Narrow flake8 E9/F63/F7/F82, Python compilation and git diff --check pass.

Fresh Chrome **6/6** runs the previous frontend scenarios across light/dark/beach and1440×1000/390×844, with actual component/primitives/ThemeProvider/CSS and fictional transport. UTF-8, no page errors/external requests/horizontal overflow, draft retention and SLA scope remain verified. Light/mobile screenshot inspected. This preserves frontend evidence; the browser transport does not exercise the new lifecycle handler. No frontend source changed, so the already-passing78 UI tests were not repeated after the backend-only edit.

Removing the exact three added backend lines reconstructs the entry SHA256. The other **59 checkpoint hashes**, including the frontend and historical source/test/evidence files, remain identical. Cumulative runtime candidate remains the same two owned files from this chat; only backend/routes/admin/support.py changes in this slice.

## Isolation and limits

Read-only chat inspection found “Audit each app feature” working on monthly leaderboard replay/scheduler reporting and “Audit and repair Raw Surf” idle after trophy handoff review. Primary, booking-availability-repairs and2866 support-file Git statuses are clean at entry and closeout. No other checkout edits or messages, and no owner acknowledgement claimed.

Fixtures extract actual declarations/functions without importing the normal application, loading .env, starting schedulers, or accessing weather storage. Database is disposable in-memory SQLite; minimal Profile/Booking mappings replace unrelated dependencies. Sessions match the application's expiration setting. Existing SLA-scope fixture alone normalizes known-UTC synthetic SLA timestamps returned naive by SQLite; no model/schema change. Browser traffic is confined to its owned temporary loopback origin; browser and server close on completion.

No mounted authentication, full-app UI-to-backend, PostgreSQL, concurrent-request, live/real ticket, physical-device, cross-browser or assistive-technology acceptance is established. No provider/security/paid/shared migration/commit/push/merge/deployment action. Weather runtime, flags, STATE, canonical ACTIONS and SCOREBOARD remain unchanged; no served weather number changes. Only this session's log and ledger fragment record the support work.

## Evidence, reproduction and rollback

Evidence: docs/audits/evidence/2026-10-29-admin-support-reopen/. entry-hashes.json and verification.json bind the exact source and harnesses. baseline-reopen.json/reopen-results.json retain field/metric observations and integrity snapshots; browser-results.json/six PNGs retain frontend checks. Raw Jest output, logs and build/cache outputs are ignored. All identities/tickets are fictional and email domains are example.invalid.

```powershell
$env:RAW_SUPPORT_TEST_DEPS='<existing frontend node_modules directory>'
$env:NODE_PATH=$env:RAW_SUPPORT_TEST_DEPS
node docs/audits/evidence/2026-10-29-admin-support-reopen/run-tests.cjs
node docs/audits/evidence/2026-10-29-admin-support-reopen/run-browser.cjs
& '<Python with SQLAlchemy and aiosqlite>' -B docs/audits/evidence/2026-10-29-admin-support-reopen/verify-reopen.py
```

Rollback: remove the three added backend lines and verify the entry hash; preserve prior repairs. No live database was changed. No historical timestamp restoration is needed for fictional discarded fixtures. Reconcile ownership and dependencies before any future integration. Final repository gate readback follows below.

Final repository readback: canonical ledger2074 entries OK; docs-only memory audit **0 FAIL,63 WARN,12 NOTE**, exit0. Existing weather commitment warnings are outside this support slice. Fresh final manifest confirms entry60/protected59 hashes,78 UI, baseline10/26 to final26/26 lifecycle, final metrics12/status10/SLA scope11 and Chrome6 passes; narrow flake8, syntax and whitespace pass. Implementation action: ledger.d/codex--admin-support-selection-20261029.jsonl:13. Local, uncommitted, unpublished; no live or release action.
