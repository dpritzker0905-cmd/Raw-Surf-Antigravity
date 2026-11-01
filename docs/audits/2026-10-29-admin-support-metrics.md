# Support metrics loading and refresh — isolated continuation

Owner: Codex, chat 01a188c2-90f8-7b11-a690-39f8cfdd9957, ce30/raw-surf, branch codex/admin-support-selection-20261029. Authorization: David said “keep moving forward” after the support pagination repair. Continue the next bounded support audit issue, preserving the prior selection/pagination work and isolation/no-overlap/no-weather constraints.

## Ownership and contract

Only AdminSupportDashboard.js runtime source is reserved for this slice, plus a new adjacent metrics regression test and session-owned evidence/docs/log/fragment. Primary, booking-availability-repairs and2866 support-file Git status is clean at entry. Read-only chat inspection shows Saved Crew dialog work/weekly-challenge follow-up and companion handoff reconciliation, with no support overlap. No message or acknowledgement is claimed. Prior checkpoint files are hash-checked and their evidence remains historical and unchanged.

Fix the source-observed audit findings: metrics load failures can leave stale/hidden data without feedback; manual refresh and successful replies/updates do not reload metrics. Give metrics their own guarded pending/error/retry lifecycle, reject old-request/account callbacks, refresh after confirmed successful mutations and on manual Refresh, and leave retry GET-only and independent of ticket/draft state. Clarify the resolved card as resolved/closed tickets created during the last30 days, which is the current API's definition. Preserve backend formulas, response schema, ticket status/SLA policy, reply delivery and pagination contracts.

Zero-sample average and support backlog/denominator policy concerns remain separate. Do not infer absence of observations from a numeric zero or change accounting/business definitions in this UI repair. No backend/model/migration/provider/security/weather changes are authorized by this slice.

## Verification

Entry: **25/25 checkpoint hashes** matched; the prior **42/42 UI regressions** and **10/10 offline pagination-handler cases** passed again. Historical selection/pagination reports and evidence remain unchanged. At closeout24 recorded hashes still match; only AdminSupportDashboard.js intentionally changes in this slice, with a new metrics test/harness/evidence set.

Actual-component metrics baseline: **4 passed / 14 failed / 18 total**. Existing successful numeric values, legitimate zero values and failed mutation behavior already passed. Failure feedback, refresh wiring, latest-request/account/unmount guards, independent retry and cohort disclosure did not. The regression fixture varies API completion order and failures while holding ticket/data contracts constant, isolating the UI request-lifecycle mechanism.

Final combined UI suite: **60/60**, including all previous42 and the new18. Metrics now have independent pending/error/empty states, account/request identity guards and an explicit GET-only retry. Refresh reloads the current ticket page and metrics; a successful reply, internal note, status or priority update reloads metrics. Failed mutations retain their previous metrics/draft behavior. Starting a metrics read removes old cards so they cannot masquerade as current data after failure. A late metrics response/error cannot replace newer figures, and retry does not reload the list or change selected detail/draft/note mode. A null successful response displays unavailable text; numeric zero remains a valid displayed value. Backend formulas and sample interpretation are unchanged.

The resolved card now says “Resolved / closed” and “Tickets created in last30 days,” matching the existing created-at cohort query rather than implying all resolutions during that time. No resolution-count, average, SLA, status or ticket-lifecycle formula was changed.

Final Chrome **6/6**: light/dark/beach,1440×1000 and390×844, actual ThemeProvider/CSS/component/primitives with fictional transport. Each retains previous detail/draft/pagination scenarios and adds automatic metrics refresh after reply/update, manual refresh pending/failure, metrics-only keyboard retry, reordered success/failure, cohort label and unchanged selected draft. Explicit theme CSS variables, zero page errors, zero external requests and no horizontal overflow. Screenshot inspected in light/mobile. Mobile is viewport emulation, not a physical device.

Scoped ESLint: **0 errors / 0 warnings** on the component and all three tests. Webpack compiled actual imports, git diff whitespace and source/hash bounds pass. The component is614 physical lines, within the repository800 limit. No backend change was needed; the ten SQLite cases are a prior-pagination regression check, not metric-aggregation qualification.

## Reproduction and evidence

Folder: docs/audits/evidence/2026-10-29-admin-support-metrics/. `entry-hashes.json` and `verification.json` retain source/hash bounds and compact baseline/final cases; `handler-recheck.json` records prior list-handler qualification. `browser-results.json` and six final screenshots retain Chrome scenarios. Raw Jest/lint output, caches and build artifacts are ignored. All account/ticket identities are fictional. No app .env is loaded by the fixtures.

From repository root, using an existing frontend dependency installation:

```powershell
$env:RAW_SUPPORT_TEST_DEPS='<existing frontend node_modules directory>'
$env:NODE_PATH=$env:RAW_SUPPORT_TEST_DEPS
node docs/audits/evidence/2026-10-29-admin-support-metrics/run-tests.cjs
node docs/audits/evidence/2026-10-29-admin-support-metrics/run-browser.cjs
```

Installed Chrome and loopback access are required for browser checks. The owned temporary browser/server close on completion; auth/API modules are replaced with fictional transport, and CSP/browser routing block external requests. The existing ThemeProvider uses its ordinary theme preference only. No normal application backend, provider or weather runtime is started.

## Isolation and limitations

Support-file Git status in primary, booking-availability-repairs and2866 was clean at entry and closeout; other chat scopes were read without messages/acknowledgement claims. This slice changes only the already-owned support component. The cumulative unpublished candidate still has exactly two runtime paths: that component and the previously qualified one-line support.py tie-breaker. Backend, shared primitives/auth/API client and protected weather records are unchanged from this slice's entry. Only the session-owned log/ledger fragment is appended for governance.

Metric aggregation, missing-sample versus actual-zero interpretation, backlog/denominator definitions, resolution timestamps, SLA policy and recipient delivery remain separate audit issues. No authenticated full-app, real support data, PostgreSQL aggregation, hosted CI, physical-device, cross-browser or assistive-technology acceptance is claimed. No live/provider/security/shared-migration/paid-resource/commit/push/merge/deployment action occurred.

Rollback this slice against its recorded entry source hash to retain selection/pagination, or revert the cumulative two-runtime-file candidate to abandon all local support work. New test/evidence/report records belong to this candidate; no live-data rollback is needed. Reconcile current source and file ownership before integration. Final repository checks are recorded below after their actual output is read.

Final readback: action ledger2074 entries OK; docs-only memory audit0 FAIL,63 WARN,12 NOTE, exit0. Fresh source/hash bounds and whitespace checks pass. Implementation record: ledger.d/codex--admin-support-selection-20261029.jsonl:5. The candidate remains local/uncommitted/unpublished; no release action followed verification.
