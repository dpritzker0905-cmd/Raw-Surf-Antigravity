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
