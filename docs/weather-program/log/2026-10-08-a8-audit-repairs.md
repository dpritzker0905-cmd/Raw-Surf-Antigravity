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
