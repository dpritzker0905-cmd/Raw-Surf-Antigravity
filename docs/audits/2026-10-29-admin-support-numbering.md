# Support ticket-number allocation — isolated repair

Owner: Codex, chat01a188c2-90f8-7b11-a690-39f8cfdd9957, ce30/raw-surf, branch codex/admin-support-selection-20261029. David requested another forensic recheck and the next support audit issue, isolated with no overlap or weather disturbance. HEAD72b4652d5753423cce18b9ad1d1de95f0afcb7e7 unchanged; local, uncommitted and unpublished.

## Problem and resulting behavior

The original audit's “Ticket creation” finding (continuation line4088; feature index42) traces number allocation to COUNT(rows)+1 despite a unique ticket-number index. Two concurrent requests can choose the same number; deletion gaps can also collide with an existing number. Fresh actual-handler fixtures reproduce **both failures in SQLite and PostgreSQL17.11**, baseline0/2 on each engine. The synchronized baseline waits until both requests have generated their number before either inserts. Only one request then persists. With legacy TKT-00001 and TKT-00003 present, the next count-derived number collides with TKT-00003.

Future numbers now use **TKT- plus16 uppercase hexadecimal characters**, fitting the existing20-character field. Random generation does not query the ticket table. It does not by itself guarantee uniqueness: the existing database unique index arbitrates insertion. Native PostgreSQL/SQLite INSERT ON CONFLICT(ticket_number) DO NOTHING RETURNING(id) retries only a skipped number collision, up to three candidates. Successful inserts commit once and return the existing success/number/id response shape. Exhaustion returns503 without creating a ticket. Unrelated insertion errors and commit errors propagate; no automatic retry follows uncertain commit acknowledgement.

Existing numbers and IDs are not rewritten. Request fields, enum/default handling, priority deadlines, tags, optional booking reference and initial status/timestamps retain their existing behavior. Both dialects match database.py's supported database configurations. Only generate_ticket_number, create_ticket and three imports change in backend/routes/admin/support.py. No model, index, migration, frontend, shared primitive, auth or API-client change.

## Prior-repair forensic recheck

**70/70 checkpoint hashes** match the preceding reopen repair before editing. Fresh UI **78/78**, reopen lifecycle **26/26**, metrics **12/12**, status persistence **10/10** and SLA scope **11/11** pass. Final source again passes reopen26, metrics12, status10, SLA scope11 and pagination/list10. The existing UI suite was not repeated after the backend-only edit; fresh Chrome builds the unchanged frontend afterward.

Removing the three new imports and restoring only the two changed functions reconstructs the exact entry backend SHA256. The other **69 checkpoint hashes**, including frontend, tests and historical evidence, remain identical. Cumulative runtime candidate remains the same two owned support files from this chat; this slice changes only the backend file.

## Allocation verification

Final **17/17 on SQLite and17/17 on PostgreSQL17.11** execute actual functions, request models, ticket/message declarations, SQL and separate-session durable reads:

- Synchronized concurrent creation retains both requests with distinct numbers and IDs. A second synchronized race deliberately generates the same candidate in both sessions; the unique index selects one winner and the other request retries successfully.
- Deleted-row gaps coexist with legacy numbers. One/two forced collisions succeed on the next candidate without changing earlier rows. Three collisions return503 and leave every table unchanged.
- New rows retain request payload, initial Open status, null response/resolution measurements and priority-specific1/4/24/72-hour deadlines. List search/detail readback finds the returned number and ID.
- A non-number NOT NULL insertion failure propagates on its first attempt, even with a colliding number present. A simulated pre-commit failure leaves no durable row and causes no automatic retry.
- A simulated lost acknowledgement raises after the actual commit: one ticket remains durable, one candidate was generated, and the handler does not replay the request. This does not implement request-level idempotency or recovery from a caller's later manual retry.
- The real random generator emits128 distinct correctly sized/formatted samples; an explicit query-forbidden session confirms allocation performs no database read. The native unique index remains the authority for uniqueness; the sample is not a probability or security qualification.

Prior committed fixture rows/tables are preserved, with no reply messages added. Failure tests inspect state after session cleanup. SQLite uses an owned local file to permit independent concurrent sessions; PostgreSQL uses a fresh owned loopback cluster and database for each launch. No existing cluster or application database is accessed. Baseline/final cluster controls report pg_ctl status3 and no OS listener after shutdown. Native PostgreSQL testing requires no timestamp adapter; only SQLite's SLA result is normalized from known-UTC fictional values for the existing list comparison.

## Frontend compatibility and quality

Fresh Chrome **6/6**, light/dark/beach at1440×1000 and390×844, runs all earlier support workflows with a20-character reference. Number, priority and status bounds do not overlap; mobile naturally wraps after TKT-. List selection/detail title, drafts, filtering/pagination, refresh/failure/race handling and metric sample/scope behavior remain intact. UTF-8, no page errors/external requests/horizontal overflow. Light/mobile screenshot inspected. Actual component/primitives/ThemeProvider/CSS are used with fictional auth/API replacements; this is not mounted UI-to-backend proof. No frontend repair was needed.

Narrow flake8 E9/F63/F7/F82, Python syntax, Webpack browser build, exact source reconstruction and whitespace checks pass. Component633 lines remains below800. The evidence collector initially assumed a Jest suite field absent from this JSON format; it was corrected to count assertion statuses. A browser fit locator initially used the enum spelling rather than the rendered status text; correcting the fixture locator produced the six passing runs. Neither adjustment changed product code. The first PostgreSQL launcher invocation used a transaction context around CREATE DATABASE and stopped on ActiveSqlTransaction; the launcher was corrected to create the database in autocommit, and the owned cluster was stopped on both attempts. These setup failures are distinct from the recorded count-allocation baseline failures.

## Isolation and limits

Read-only inspection found “Audit each app feature” preparing monthly replay integration/migration readiness with Claude; the companion chat remains on trophy handoff review. Primary/booking-availability-repairs/2866 support-file Git statuses are clean at entry and closeout. No other checkout edits/messages or owner acknowledgement claimed. Existing support ownership and isolated branch are reused.

Fixtures extract actual declarations/functions without normal application imports or .env loading. Minimal Profile/Booking mappings replace unrelated dependencies. PostgreSQL uses existing binaries read-only, a new ignored cluster, an independently allocated loopback port and no fixture password. Connection settings pass through RAW_SUPPORT_FIXTURE_DATABASE_URL in the child environment; no connection value is stored in tracked evidence. Browser traffic stays on its owned temporary loopback origin; browser/server close on completion.

No hosted schema/index inspection, mounted authentication/full API, request-level idempotency, live/real ticket, physical-device, cross-browser or assistive-technology acceptance. Shared schema must retain the existing unique ticket-number index for future integration. No shared database/migration/provider/security/paid/commit/push/merge/deployment action. Weather runtime, flags, STATE, canonical ACTIONS and SCOREBOARD unchanged; no served weather number changes. Only session-owned support evidence/log/ledger fragment records this work.

## Evidence and rollback

Evidence directory: docs/audits/evidence/2026-10-29-admin-support-numbering/. entry-hashes.json/verification.json bind source/harnesses. baseline/final SQLite/PostgreSQL JSON retain race, payload, error and persistence outcomes; PostgreSQL control JSON records stop/listener checks. Browser JSON/six PNGs retain compatibility checks. Raw outputs/logs/build caches/database files/clusters are ignored. All records are fictional; email domain example.invalid.

```powershell
& '<Python with SQLAlchemy, aiosqlite, asyncpg and psycopg2>' -B docs/audits/evidence/2026-10-29-admin-support-numbering/verify-numbering.py
& '<same Python>' -B docs/audits/evidence/2026-10-29-admin-support-numbering/run-postgres.py
$env:RAW_SUPPORT_TEST_DEPS='<existing frontend node_modules directory>'
$env:NODE_PATH=$env:RAW_SUPPORT_TEST_DEPS
node docs/audits/evidence/2026-10-29-admin-support-numbering/run-tests.cjs
node docs/audits/evidence/2026-10-29-admin-support-numbering/run-browser.cjs
```

Rollback this unpublished slice by restoring the two functions and removing the three imports, verifying the recorded entry SHA256 while preserving previous repairs. No live data rollback is needed. If integrated later, random references must remain readable; reverting allocation would restore the original count bug. Reconcile current ownership and schema/dependencies before release. Final repository gate readback follows below.

Final repository readback: canonical ledger2074 entries OK; docs-only memory audit **0 FAIL,63 WARN,12 NOTE**, exit0. Existing weather commitment warnings remain outside this support slice. Final manifest confirms70 entry/69 protected hashes,78 UI, SQLite17/17 and PostgreSQL17/17 allocation cases, reopen26/metrics12/status10/SLA scope11/list10 and Chrome6 passes. PostgreSQL stop/listener readbacks pass; source reconstruction, narrow flake8, syntax and whitespace pass. Implementation action: ledger.d/codex--admin-support-selection-20261029.jsonl:15. Candidate remains local, uncommitted and unpublished; no live/release action.
