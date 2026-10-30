# Support ticket selection and reply drafts — isolated repair

Owner: Codex, chat 01a188c2-90f8-7b11-a690-39f8cfdd9957. Workspace: ce30/raw-surf. Branch: codex/admin-support-selection-20261029. Entry HEAD: 72b4652d5753423cce18b9ad1d1de95f0afcb7e7; entry working tree clean.

Authorization: “Start with the support ticket selection and reply draft repairs. Use forensics, keep the work isolated, and make sure you don't overlap with the other chats or disturb weather.”

## Ownership and scope

This session reserves frontend/src/components/admin/AdminSupportDashboard.js and its new adjacent regression test. Other application files, backend contracts, ticket pagination, delivery, financial features and weather runtime are outside this repair. Only this session's report, log and ledger fragment accompany the fix.

Read-only overlap check: primary application checkout, booking-availability-repairs and 2866 each had no Git changes to AdminSupportDashboard.js or backend/routes/admin/support.py. The active chats' inspected work covers money/crew and notifications/search/Surf Log/profile reviews. The shared booking coordination notice has no support-file reservation. No acknowledgement or message from another chat is claimed. Recheck target files before closeout.

## Acceptance

- Selecting a ticket immediately removes the previous ticket's editor. Only the latest selection/request may supply detail, loading or error state. Failure has a visible retry for the selected ticket.
- Reply text and internal-note choice belong to their ticket and remain in memory during selection changes. No browser-storage persistence is introduced.
- Delayed reply/update completion cannot replace another selection, clear its draft, or change its note mode. Failed submission retains the original draft. Repeated activation does not submit duplicate mutations.
- Ticket selection works by keyboard, and touched controls have meaningful accessible names. Existing three-theme and responsive layout conventions are preserved.
- Use the actual React component and controllable transport promises to distinguish response-order defects from backend data, caching and provider behavior. No live tickets, reply delivery or weather calls.

## Evidence

Baseline ran the actual React component with deferred API promises: **14 failed / 2 passed / 16 total**. The selected row changed before its editor, older requests overwrote newer detail, text/note mode crossed tickets, and late reply completion cleared another draft. Two pre-existing controls (normal same-ticket reply and repeated send clicks) passed. These experiments hold data/response shape constant and vary response order, establishing a frontend state-lifetime cause rather than a provider/database issue.

The repair changes only the support component's runtime source:

- Selection changes its synchronous identity ref and starts a numbered detail request. Request/account/selection must still match before any completion changes detail, loading or error state. Mismatched response identity is unavailable. Detail is cleared at request start, so loading/failure cannot leave the previous editor actionable.
- Draft text and internal-note mode are indexed by ticket in component memory. Submission captures its ticket and draft version; successful completion clears only that version. Failed submission retains it. Drafts do not survive unmount/account changes, and are not written to localStorage.
- Reply/update callbacks check account lifetime and refresh detail only if their ticket is still selected. A synchronous pending-action guard prevents duplicate mutations; selection and another ticket's draft remain available during the operation. Mutation controls are disabled while one action is pending; this is intentionally one operation at a time.
- Ticket rows are native non-submit buttons, with pressed state and visible focus. Touched status/priority, internal-note and reply controls have meaningful accessible names.

Final **21/21** actual-component regression checks pass. Five added cases cover response identity, account-change/unmount mutation callbacks and ordering between a pre-update read and the post-update refresh. One expanded account-change test initially tried selecting while the list was still loading; its helper now waits for the visible row. This was a test synchronization correction, with no extra product change.

Focused ESLint: **0 errors / 0 warnings** on component and test. `git diff --check` passes. Webpack compiles the actual component, real shared UI primitives and ThemeProvider in the local fixture; dependencies are read from an existing installation, without installing packages or modifying it.

Final Chrome verification: **6/6** combinations, light/dark/beach at **1440×1000** and **390×844**. Each runs seven workflow scenarios: out-of-order selection, per-ticket text/note retention, delayed reply completion, failed selection/retry, keyboard Space selection, delayed update completion and exact reply URL/payload. Every combination explicitly verifies the theme's CSS background variable; zero page errors, external requests or horizontal overflow. Mobile screenshots are viewport emulation, not physical-device evidence. Initial fixture generation omitted ThemeContext from Tailwind content and therefore purged Beach base styles. Screenshot inspection caught that fixture defect; the corrected six-case run supersedes the first run.

Evidence folder: `docs/audits/evidence/2026-10-29-admin-support-selection/`. `verification.json` retains compact baseline/final case results, lint, changed-file bounds and SHA256 hashes. `browser-results.json` and six PNGs retain the final browser evidence. Raw Jest/lint results, build output and caches are ignored; all fixture identities are fictional.

## Reproduction commands

Run from repository root in PowerShell. Point `RAW_SUPPORT_TEST_DEPS` at an existing compatible frontend dependency installation. No API credentials or app `.env` are loaded.

```powershell
$env:RAW_SUPPORT_TEST_DEPS='<existing frontend node_modules directory>'
$env:NODE_PATH=$env:RAW_SUPPORT_TEST_DEPS
node docs/audits/evidence/2026-10-29-admin-support-selection/run-tests.cjs
node docs/audits/evidence/2026-10-29-admin-support-selection/run-browser.cjs
```

The browser script requires installed Chrome and loopback access. It replaces auth and API modules with fictional fixtures and blocks external requests in both browser routing and CSP; its temporary server/browser are closed on completion. Browser ThemeProvider uses its existing theme preference storage only. No backend, weather runtime or provider is started.

## Qualification and handoff

Entry and closeout read-only target Git status checks in primary, booking-availability-repairs and 2866 returned no edits to either support source file. Only ce30 is modified. This proves the checked target-file status at those times; no message/acknowledgement or future file reservation by another chat is claimed.

Backend support handler, shared apiClient, AuthContext, ThemeContext and UI primitives are unchanged. Weather STATE/ACTIONS/SCOREBOARD are unchanged. The only weather-folder additions are this session's uniquely named log and ledger fragment, required by the repository action-recording protocol. Initial docs-only memory audit: **0 FAIL / 57 existing WARN / 18 NOTE**; unrelated weather commitments are not adopted or changed.

This is local UI state qualification. Real ticket persistence/recipient delivery, full-app authentication, hosted CI, physical devices, other browsers and assistive technology are unverified. Pagination/filter/list races, support metrics, ticket-number generation and delivery semantics remain separate audit items. No deployment or live support action is implied.

Final repository checks: action ledger **2074 entries OK**; docs-only memory audit **0 FAIL / 63 WARN / 12 NOTE**. The initial audit tally above is retained separately. Existing weather commitments remain outside this repair.

Rollback: revert the single AdminSupportDashboard.js diff and remove the new test/report/evidence/log/fragment with this uncommitted candidate. No database, provider or live-data rollback is needed. Integration should reconcile the current target source and file ownership again before applying this candidate elsewhere. No commit, push, merge or deployment was made.
