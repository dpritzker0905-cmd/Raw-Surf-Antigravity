# Waiting Internal support status — isolated continuation

Owner: Codex, chat 01a188c2-90f8-7b11-a690-39f8cfdd9957, ce30 worktree, codex/admin-support-selection-20261029. David requested forensic recheck and the next support-ticket audit issue with isolation/no overlap/no weather disturbance.

Scope: the remaining Waiting Internal gap from audit status-filter/editor findings884/885. Closed filtering was already repaired with pagination. Backend TicketStatusEnum and existing list/update handlers support waiting_internal, but the UI's filter and editor omit it. Add the missing option to each control, verify existing-value display, query/payload, persistence and retained draft/page behavior. Do not alter backend lifecycle, SLA/backlog policy, ticket numbering or delivery.

Only AdminSupportDashboard.js runtime source is reserved for this slice, plus new tests/evidence and session-owned records. Other chats are working on weekly-challenge trophy/scheduler work; primary/booking/2866 support-file Git status is clean at entry. No message/acknowledgement or other-checkout edit is claimed. Prior reports/harnesses stay historical and unchanged.

## Forensic gate and repair

Entry **43/43 checkpoint hashes**, **70/70 prior UI checks**, **12/12 prior metrics cases** and **10/10 prior list cases** pass. Historical evidence is preserved. New status UI baseline **2/8 passed**: returning an existing internal ticket to Open and the previously repaired Closed/All filters already worked; internal-value display, filtering/assignment and related retention controls failed.

Final combined UI **78/78**, including all previous70 plus eight status cases. Waiting Internal is now an option in both existing selectors. Existing internal-ticket detail displays its actual status, staff can filter/paginate63 internal tickets and assign the status with the unchanged API payload, drafts/note mode persist, filtered totals update when a ticket leaves the state, and failure retains the prior status/draft. Both controls expose all six current backend statuses. Closed/All behavior stays covered.

Initial screenshot review showed the longer selected label clipped in the narrow triggers. Only those two trigger widths were widened; final Chrome asserts the label fits without horizontal/vertical text clipping. Runtime change is exactly **two option lines plus two width adjustments** in AdminSupportDashboard.js. Removing those four edits reconstructs the entry file's SHA256 exactly. All42 other checkpoint hashes, including backend support.py, remain identical.

## Existing backend contract

The existing, unchanged list/detail/update handlers and actual ticket/model/enum declarations pass **10/10** positive disposable SQLite checks. Existing Waiting Internal filtering/detail works; Open→Waiting Internal→Open persists across separate sessions; filtered totals rise/fall; only the intended ticket's status/update timestamp change, with other fields, rows, tables and reply messages preserved. All six statuses remain reachable through All. Lightweight fixture Profile/Booking seams supply foreign-key/detail fields; no application model or migration is changed.

This proves the missing UI option against the existing handler contract. It does not qualify mounted authentication, PostgreSQL, real support data or concurrent status changes. No backend lifecycle, SLA/backlog/reopen policy, numbering or recipient delivery change was selected.

## Browser and static verification

Final Chrome **6/6** at1440×1000 and390×844 in light/dark/beach. Actual shared controls, ThemeProvider/CSS and UTF-8 are used with fictional auth/API transport. Prior support scenarios are retained; new checks assign Waiting Internal, read its refreshed value, filter it, return to Open and reassign by keyboard activation, verify filtered removal/counts with selected detail/draft intact, and assert exact status-update payloads. The two full selected labels fit, with no document horizontal overflow, page errors or external requests. Final light/mobile screenshot inspected. Viewport emulation is not physical-device or cross-browser qualification.

Scoped UI ESLint on component/five tests: **0 errors/0 warnings**. Narrow fixture flake8 and Python syntax pass; actual imports compile in Webpack; whitespace and source/hash bounds pass. Component632 physical lines is within the800-line limit.

## Reproduction and evidence

Folder: docs/audits/evidence/2026-10-29-admin-support-status/. `entry-hashes.json` and `verification.json` retain per-case results and hash reconstruction. `status-contract.json` retains real handler/model fixture persistence/integrity checks; `metrics-recheck.json` and `list-recheck.json` retain prior backend checks. `browser-results.json` and six screenshots retain the final matrix. Raw Jest/lint output, build output and caches are ignored. Every ticket/account is fictional; no app .env or normal backend initialization is used.

```powershell
$env:RAW_SUPPORT_TEST_DEPS='<existing frontend node_modules directory>'
$env:NODE_PATH=$env:RAW_SUPPORT_TEST_DEPS
node docs/audits/evidence/2026-10-29-admin-support-status/run-tests.cjs
node docs/audits/evidence/2026-10-29-admin-support-status/run-browser.cjs
& '<Python with SQLAlchemy, aiosqlite, FastAPI and Pydantic>' docs/audits/evidence/2026-10-29-admin-support-status/verify-status-contract.py
```

Installed Chrome and loopback access are required for browser tests. The owned browser/server close on completion; API/auth modules are substituted, and CSP/browser routing block external requests. Backend tests execute selected actual declarations with disposable in-memory data and bypass app/auth initialization.

## Isolation and handoff

Read-only primary/booking/2866 support-file status remains clean at entry and closeout, including after the width adjustment. Other chats' work scopes were inspected. No other checkout was written or messaged; no acknowledgement is claimed. Cumulative support candidate still has two runtime paths from prior slices, but this slice changes only the owned UI. Shared controls/models/auth/API client, backend metrics and weather runtime/flags/STATE/ACTIONS/SCOREBOARD remain unchanged. Only session-owned log/ledger records are appended.

Full-app/real-ticket/auth/PostgreSQL/hosted-CI/physical-device/cross-browser/assistive-technology acceptance remains unverified. Existing status/SLA/backlog/reopen, numbering and delivery concerns remain separate. No live/provider/security/weather/paid/shared-migration/commit/push/merge/deployment action. No served weather number changes.

Rollback this slice by removing the two waiting_internal option lines and restoring filter/status widths40→32 and40→28 respectively; entry hash reconstruction verifies exact restoration. No data rollback. Keep prior repairs or abandon the cumulative uncommitted candidate separately, and reconcile ownership before integration. Final repository checks will be recorded after actual output readback.

Final readback: canonical action ledger2074 entries OK; docs-only memory audit0 FAIL,63 WARN,12 NOTE, exit0. Fresh source/hash reconstruction and whitespace checks pass. Implementation record: ledger.d/codex--admin-support-selection-20261029.jsonl:9. Candidate remains local/uncommitted/unpublished, with no live/release action after verification.
