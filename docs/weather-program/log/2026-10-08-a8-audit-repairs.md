# Independent audit repair continuation — 2026-10-08

Owned by Codex on codex/a8-weather-audit-repairs. Times UTC.

## 2026-10-08 10:22Z — Close superseded PR #222 (ledger seq 970)

Claude closed PR #222 after its source had already landed on dev. Owner authorization: close #222 #224 #225.

Readback: GitHub readback CLOSED, closedAt 2026-10-08T03:37:46Z; not merged by this action.

Rollback: gh pr reopen 222

## 2026-10-08 10:22Z — Close superseded PR #224 (ledger seq 971)

Claude closed PR #224 after its source had already landed on dev. Owner authorization: close #222 #224 #225.

Readback: GitHub readback CLOSED, closedAt 2026-10-08T03:37:48Z; not merged by this action.

Rollback: gh pr reopen 224

## 2026-10-08 10:22Z — Close superseded PR #225 (ledger seq 972)

Claude closed PR #225 after its source had already landed on dev. Owner authorization: close #222 #224 #225.

Readback: GitHub readback CLOSED, closedAt 2026-10-08T03:37:50Z; not merged by this action.

Rollback: gh pr reopen 225

## 2026-10-08 10:22Z — claude/auth-money-routes-hotfix (ledger seq 973)

Claude published the authorized hotfix branch at 3788b4ce694a1153a1b4766fefea053b39b468b5. Owner words supplied in the handoff: push the hotfix and merge it when green. Push time is approximately 04:05Z; no exact acted_at is asserted.

Readback: GitHub branches API reads 3788b4ce694a1153a1b4766fefea053b39b468b5.

Rollback: Close the proposed PR; revert its changes by a reviewed PR if subsequently merged.

## 2026-10-08 10:22Z — #263 (ledger seq 974)

Claude opened the authorized hotfix PR against dev. It remains OPEN; Codex has not merged it. Reserved routes and CI floors remain untouched. Detailed local security evidence is not published.

Readback: GitHub PR readback OPEN, mergedAt null, head 3788b4ce694a1153a1b4766fefea053b39b468b5.

Rollback: Close PR #263.

## 2026-10-08 10:22Z — A-05 / A8-01: missing E2E failure evidence (ledger seq 975)

Run 37717937279 timed out at the 40-minute step bound and has zero GitHub artifacts. First failing run 37503777375 explicitly reports no files at frontend/playwright-report/. A8-01 remains open: Node version and hub latency are hypotheses, not identified causes. No shared forecast test was started; ingestion 37751941923 is active.

Readback: Saved audit logs; GitHub artifact API total_count 0. Three Node receipt controls pass, including a 1000-request retention control and persisted per-attempt facts before reporter shutdown.

Rollback: Revert the proposed E2E instrumentation; retain the failed-run evidence.

## 2026-10-08 10:22Z — A-05 / A8-01: preserve evidence before E2E shutdown (ledger seq 976)

Added allowlisted hub request facts, bounded at 64, and a streaming completed-attempt reporter. Retain existing test-results alongside HTML reports. Raw tracing stays off; no URLs, headers, request/response bodies or credentials enter these new receipts. Test assertions and retries remain unchanged. This repair changes no served number; live causal acceptance remains open.

Readback: node --test frontend/scripts/e2e_receipts.test.cjs: 3 passed; git diff --check clean. Source and receipts remain proposed on this branch.

Rollback: Revert the E2E instrumentation commit; no application or shared-data rollback is needed.

## 2026-10-08 10:24Z — D-017 / A-05: named E2E waiver (ledger seq 977)

Recorded the owner audit queue policy: no repair merge on a red dev E2E without an explicit owner waiver naming the PR number. Other acceptance requirements remain independent.

Readback: DECISIONS.md D-017; current dev E2E 37717937279 failed. No merge was performed.

Rollback: Append an owner-authorized superseding decision; preserve this decision and its evidence.

## 2026-10-08 10:27Z — codex/a8-weather-audit-repairs (ledger seq 978)

Published qualified E2E evidence instrumentation and append-only receipts at 6941798a861e7772a7c3c02e99bf893071e14cd6. No application deployment or shared forecast test was initiated.

Readback: Git push succeeded; PR head readback matches 6941798a861e7772a7c3c02e99bf893071e14cd6.

Rollback: Revert the proposed commit by reviewed PR if needed; no main or dev branch was modified.

## 2026-10-08 10:27Z — #264 (ledger seq 979)

Opened a draft against dev for A8-01 / A-05 failure-evidence retention. Existing assertions remain; live root-cause acceptance is still open. D-017 requires a named owner waiver while dev E2E is red.

Readback: GitHub OPEN, isDraft true, base dev, head 6941798a861e7772a7c3c02e99bf893071e14cd6; attached to this chat.

Rollback: Close PR #264; retain its evidence.

## 2026-10-08 10:41Z — e2e-tests.yml / 37764654623 (ledger seq 980)

Dispatched exactly one Desktop Chrome spot-hub journey with diagnostic_no_retry=true against dev. Application is still b02f43f8; diagnostics run source is proposed 6941798a. No Play, scrub, map stress or 860 acceptance check. Matching healthy API, restored 13234 products and matching dev frontend read back at 10:36Z; no concurrent forecast workflows at dispatch.

Readback: GitHub run 37764654623 in progress, head 6941798a861e7772a7c3c02e99bf893071e14cd6. Receipt pr262-deployment-20261008T103648.json; data health remains warn with independent cycle alerts.

Rollback: Cancel only run 37764654623 if needed; hosted browser contexts close when the job ends.

## 2026-10-08 10:50Z — A-05 / A8-01: retained failure narrows the cause (ledger seq 981)

Bounded single-attempt run 37764654623 failed and retained one artifact. Its batch request finished HTTP 200 in 102 ms; no spot-details request was observed after the click. Screenshot and accessibility snapshot show the signup page. This contradicts a pending hub request as the explanation of this observed failure; the triggering redirect remains to be identified. All PR264 code checks pass, but E2E acceptance remains open.

Readback: GitHub run FAILURE; artifact 11543832312 retained. Post-check metadata at 10:49Z: API healthy, deployed API/dev source b02f43f8, restore complete 13234, zero restore errors. Data health WARN persists, including EURO wind cycle 22.8 hours old. Claude263 remains OPEN.

Rollback: Retain the failed-run evidence; no shared data or application was changed.

## 2026-10-08 10:50Z — A-05 / A8-01: observe setup and unauthorized response categories (ledger seq 982)

Extended bounded privacy-safe E2E receipts to setup, known incidental endpoint categories and otherwise unclassified 401 responses. Final landing is an allowlisted category. No raw URL, identity, header, body or credentials are retained, and existing UI assertions are unchanged. Changes no served number.

Readback: Four Node controls pass; syntax and diff checks pass. The real auth client clears synthetic session state two seconds after a non-admin 401; this mechanism is a hypothesis until the triggering response is measured.

Rollback: Revert the receipt extension commit.
