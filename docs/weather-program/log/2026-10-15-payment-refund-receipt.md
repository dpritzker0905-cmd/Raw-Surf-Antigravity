# 2026-10-15 payment refund receipt linking — Codex

User authorization: finish remaining CI and fix buyer refund-status linking, isolated;
verify before/after, update memory and lessons, leave Claude wind untouched, no deploy.
Starting branch `codex/payment-release-readiness`, HEAD `23faf5c9b`, DEV `9405b91fc`.

## Before evidence and bounded repair

- Previous actual React/sandbox receipt returned a generic live409 after an app-admin
  refund. The helper knew the refunded shape, but the active backend did not emit it.
- Fresh regressions: 15 failures/9 passes across live and scheduled state/binding
  controls; two scheduled React cases failed because both refund states displayed
  generic review. Sandbox-restricted temp/SQLite attempts were startup failures,
  not defect evidence; isolated authorized interpreter produced the actual RED.
- Guards now retain case authority for `refund_pending`, `review_required`, `refunded`
  after receipt binding, before entitlement. Existing case recording returns its state
  to buyer return/status and signed callbacks. No new refund/money movement endpoint.
- Live returns retain a persistent accessible receipt notice and original receipt URL;
  scheduled returns distinguish pending refund from confirmed refund. Neither grants
  entitlement or retries automatically on a reconciliation response.
- Added24 backend controls; frontend +3 controls. Projected estate1738/floor1736,
  frontend431 suites/5571 tests. Counts remain projections until hosted readback.
- No served forecast number changed. No wind, F2, Render or hosted schema change.

Verification and publication results will be appended after readback.

## Active buyer receipt readback

Production React build passed. Reconstructed disposable records reuse only the exact
previous owned refunded sandbox receipt, independently retrieving its Checkout and
Refund: test mode, full2500USD cents, succeeded, matching payment intent. Actual buyer
return emits409 with refunded case; persistent role-alert text says payment refunded
and session not confirmed. Database: one refunded case, zero participants, wallet80,
zero credit entries. No new provider charge or refund. Screenshot:
`scratch/payment-combined-react/refund-linked.png` (ignored local evidence).
Focused19UI tests pass. First green backend attempt:58pass/3assertion failures because
webhooks include an additional status=received field; test corrected to compare the
public reconciliation fields without rejecting the webhook envelope.

## Qualification and source publication

Prior23f all6hosted workflows SUCCESS: general38778681404, payment38778681397,
Lighthouse38778681415, ledger38778681410, encoding38778681411, LOC38778681432.
New repair: disposable PostgreSQL123passes/0skip in235.12seconds; local Python
reports9declared packages absent, so hosted runtime parity remains necessary.
Focused19UI and36floor controls pass. A RED1failure/6pass context assertion now passes:
confirmed refunds clear only the owned matching recovery record; pending and other-owner
records remain. No extra test count from strengthening those existing assertions.
Source3342f9b0f pushed to existing draftPR333 with skip-render/netlify markers.
A local documentation update attempt stopped on UTF8 decoding before changing files;
corrected explicitly to UTF8 here. No failed attempt is a qualification pass.
The first long local PG attempt was interrupted before a result; the completed
configured run is the123pass result above. New-source CI and42browser cases pending.

## Independent invariant review and limits

Reviewed the public route paths, owner-before-provider checks, receipt binding,
transaction/case locks, refund-state authority, replays and checkout recovery isolation.
The extra entitlement guard was demonstrated with deliberately inconsistent fixture
records: a pending/review case paired with stale Pending transaction fields and restored
availability. The current admin refund handler already writes Reconciliation status
atomically with refund_pending; no real-world duplicate entitlement from that handler
was observed. The guard makes case state authoritative even under such legacy drift.
No new schema, refund API, provider SDK version, refund action or operator UI was added.
The buyer view refreshes on receipt reload; automatic refund-event ingestion, operator
cadence/alerts/historical orphan integration and deployed acceptance remain separate holds.
Final3342production build and adjacent131controls passed; actual buyer receipt reload
again shows the persistent refunded notice. Sanitized source-bound receipt:
`docs/audits/evidence/2026-10-15-payment-readiness-sync/refund-receipt-link.json`.
Provider references: https://docs.stripe.com/api/checkout/sessions/object and
https://docs.stripe.com/api/refunds/object distinguish Checkout payment status from
Refund pending/succeeded status. Actual test-provider reads confirm the specific receipt.

## Fresh hosted application checks

Source3342 payment workflow38781322965 SUCCESS: Python3.12 runtime parity46/46pins,
123PostgreSQL/0skip,19UI and42production-fixture browser cases across3themes/2sizes.
General38781322961 completed application jobs:431frontend suites/5571tests and build;
estate313selected/311producing,1738passes/2879expectedskips/0silent. These match the
paired floors exactly (estate margin2, frontend zero margin). Forecast chain and sim
lanes remain running; not claimed passed. Owned server/listener stopped, loopback
ports50389/51337 closed; disposable PG stopped. No new charge/refund or hosted write.

## All source CI complete / final memory publication

Source3342f9b0f0634c57612532b03ca915668c1bc570 all six workflows SUCCESS.
General38781322961 all11jobs:2658sim/66skip/1existingxfail,2444chain,1738estate/
2879expectedskip/0silent,431frontend suites/5571tests and build. Dedicated38781322965
passes123PostgreSQL/0skip,46/46pins,19UI and42fixturebrowsers. Other workflows:
Lighthouse38781322761, ledger38781323038, encoding38781322923, LOC38781322906.
DEV re-fetched/read back unchanged9405b91fc. Exact1221-entry DEV ledger byte prefix,
AI source/tests/other-writer log preserved; wind-owned files exact to DEV; all257
Claude refs and frozen parent7d0538c9 unchanged. Local memory audit0FAIL/14inherited
WARN/24NOTE. Owned services stopped, no held hosted migration/build/deployment.
This closing publication changes only BRAIN_RULES and canonical memory/report/evidence;
runtime and workflows remain exactly qualified3342. Keep draftPR333 and release holds.
