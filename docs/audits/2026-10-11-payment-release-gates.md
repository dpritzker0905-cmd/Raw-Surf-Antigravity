# Payment release gates — 2026-10-11

Local implementation: `48c056a5`, isolated branch `codex/booking-payment-post-repairs`, following payment repair `a85ff76c` and ownership repair `5395e184`. **NOT DEPLOYED; release remains held.** Claude's weather-sim wind experiment is excluded and pending owner-reported polling evidence. No forecast code, served forecast number, flag, live database, push or deployment changed.

## Verified status

| Gate | Evidence | Result and limits |
|---|---|---|
| PostgreSQL concurrency | Actual disposable loopback PostgreSQL 17.11; 7 concurrency/migration cases plus 24 recovery cases: **31 passed, 0 skipped**, 452.15s | Local gate passed. Actual `pg_stat_activity` Lock waits observed for callback and competing-writer controls. Hosted Linux CI pending. |
| Stripe sandbox backend journey | Four actual hosted test-card checkouts, real SDK retrievals, actual signed CLI-forwarded webhooks, actual owner return callbacks | Four webhooks HTTP200; scheduled and live entitlements fulfilled once; cancelled/ended purchases persisted cases and were refunded. This uses an isolated route harness and minimal HTML, not the full React frontend or hosted deployment. |
| Durable recovery | Admin-only case list, bounded stable-cursor scan, receipt-bound manual refund intent and outcome handling | Implemented and verified locally. Does not close orphan checkout creation, automated live fulfillment, operator UI or scheduling integration. |
| Earlier repairs and CI floors | Payment integrity, post-management authority and floor suite | **115 passed**, 68.07s. Earlier 53 payment cases and 26 ownership cases retained. |
| Hygiene | Touched Python E9/F63/F7/F82 lint; diff check; tracked lane partition; backend size gate; precommit secret scanner | Passed. 671 tracked test files partitioned (195 guards, 163 chain, 310 estate, 2 excluded, 1 existing quarantine). 670 Python files within 800 LOC, 0 violations. |
| Runtime parity | Repair interpreter reports 2/46 differing pins and 10 absent declared packages | Local evidence only; exact declared environment and hosted final-head acceptance still required. |

## Before and after

Baseline recovery controls first returned 15 failures: verified unavailable receipts had no durable cases, signed scheduled events returned409 instead of acknowledging recorded recovery, and recovery endpoints were absent. Two initial fixture assertions had shape mistakes and were corrected; they are not counted as product failures. Final recovery matrix has 24 passing behavioral cases on PostgreSQL.

A verified receipt that cannot acquire an eligible booking/live entitlement now rolls back entitlement work, locks the transaction, validates identity/amount/currency, and persists one unique case per transaction/session. Receipt arrival alone never moves money. Signed scheduled webhooks acknowledge200 only after that case commits; owner callbacks retain explicit409 recovery status. Real typed live fulfillment failures use durable review cases rather than blind automatic refunds. Emulator behavior stays confined to its existing development path.

An admin can scan pending transactions. Eligible scheduled receipts use the same atomic fulfillment helper; missing live callbacks create review cases. Pagination advances over immutable transaction IDs so successful fulfillment cannot shrink the result set underneath an offset. A concurrent fulfilled transaction cannot acquire a false new case.

An admin refund first requires an unavailable/appropriately reviewed entitlement, a fresh bound provider receipt, and a durable refund intent committed before the provider call. Retries reuse fixed intent/amount and the same case idempotency key. Known refunds are retrieved; unknown outcomes remain pending. Unknown outcomes older than23h require provider-history review rather than a new side effect after potential key expiry. Only matching provider `succeeded` evidence records Refunded; pending/failed/mismatched evidence cannot falsely settle. An older pending response cannot downgrade a newer terminal success. Once refund intent is durable, changing service availability cannot block outcome reconciliation; fulfilled transactions still require review.

Three bounded fresh-context same-model review cycles found and drove fixes for stale refund downgrade, inconsistent profile/session lock order, live automatic-refund fallthrough, false cases after concurrent fulfillment, pending-refund eligibility changes and shrinking-set pagination. Final cycle inspected the two final fixes from exact supplied snippets because its shell reads stalled; no additional actionable finding within that scope. No broader release or wind certification is inferred.

## Real sandbox read-back

| Purchase | Actual backend/provider outcome | Verified invariants |
|---|---|---|
| Scheduled:100 price,20 partial credits,80 card | Confirmed; held escrow80; return/status repeats200 | One credit funding/debit pair; wallet60. |
| Same amounts, cancelled before card payment | Booking stays Cancelled, no escrow/card funding; one case; actual80 refund succeeds | Provider Refund.list shows exactly one matching succeeded refund. Repeating admin refund returns identical refund ID. |
| Live participation:25 card | One participant and Completed transaction | Return repeat200 with already-activated message; no second participant. |
| Live checkout:25 card, session ended before card payment | No new participant; one case; actual25 refund succeeds | Provider Refund.list shows exactly one matching succeeded refund. Repeat admin refund returns identical refund ID; later owner return400 refunded. |

Final aggregate: four signed completed-event deliveries200, two resolved cases, one live participant, wallet60 and five credit ledger entries (scheduled funding/debit plus cancellation partial-credit debit/refund). Provider read-back independently verified both refund counts, amount, currency and succeeded status. No real money or real card used. Existing authorized sandbox key was transferred securely to gitignored `backend/.env`; neither credential values nor raw provider payloads are in this report.

Local ignored evidence: `scratch/payment-postgres-gates.xml`; `scratch/stripe-journey/verified-state.local.json` SHA256 `40ef80935edfc1fd9a3b3d3b176201f785dd54d8986fb6966da92e8c579ab775`; provider aggregate `provider-refund-verification.local.json` SHA256 `92e2e9b7ce9ec35d353b0a52bccbaefc63ff158cbbc913cfa2556082e80e6b90`; screenshot `refunded-receipt.jpg` SHA256 `cb83a0f9f740eafae75c74f61d76e48d5d93d4b3c168f469f6c43829c6a6d238`. These are local evidence pointers, not durable hosted receipts. The sandbox helper loaded the commit's fulfillment/refund behavior before the last cursor/eligibility refinements; those refinements are separately qualified by the final31-case PostgreSQL run. No exact-final-head full provider certification is claimed.

Early qualifier runs are excluded: an incorrect helper signing-secret override produced webhook400; SQLite's persisted naive booking time versus aware input failed a second create. The helper secret was corrected and all four qualifying journeys rerun on PostgreSQL. The SQLite date compatibility issue remains a follow-up in `routes/bookings/crud.py`; no change to that file.

## Remaining release plan

1. **Durable checkout creation/orphan recovery — release hold.** Both purchase paths create a provider session before committing local intent. A lost creation response or process crash can leave a provider object without a recoverable local transaction; known-session commit failure expiry is only a best-effort compensator. Persist a purchase/request identity before creation, reuse provider idempotency with fixed parameters, recover provider identity after unknown results, and explicitly reconcile expired idempotency windows. Verify forced process/crash boundaries before/after create, unknown response and failed compensating expiry; prove one checkout, one credit reservation and an operator-visible outcome. Current scan cannot find receipts with no local intent.
2. **Hosted/runtime/migration qualification — release hold.** The new PR/manual PostgreSQL workflow requires >=31 tests and rejects skips. It has not been pushed or run remotely. Reinstall the declared Python3.12 environment and run all affected gates on the final head. The repository already has multiple Alembic heads; the new revision follows `2fd2888a0987`. Verify the target database's actual heads, backup and explicitly apply `payment_reconciliation_001` before code can record cases. Local test executes upgrade/downgrade and checks column parity/RLS/public-role denial, not the full hosted migration history. No live schema action taken.
3. **Provider/UI acceptance — release hold.** Rerun actual final-head backend sandbox journey after durable creation repair, then test the full React create/return/cancel and pending/refund states. Local minimal HTML is sufficient evidence of backend/Stripe linkage only. Do not require credentials in pull-request CI.
4. **Operational recovery linking.** Link case list/scan/refund to an admin-only operator interface with explicit evidence/review, bounded retry handling, alerts and owner responsibility. Missing live callbacks currently need owner return or manual case review; generic live webhooks alone do not activate participation. Add a safe shared live transition before automated sweep/fulfillment. Decide cadence only after credentials and operator policy are verified; no live sweep or recurring job installed.
5. **Local SQLite date compatibility.** Normalize booking conflict timestamps consistently and add the two-booking create control. PostgreSQL qualification passed; this is a separate development-path follow-up.

### Reproduce locally

Use `PAYMENT_TEST_DATABASE_URL` only for a disposable loopback database named with prefix `rawsurf_payment_gate`; fixture creates/drops per-test schemas. From `backend/`, run `python -m pytest tests/test_payment_postgres_concurrency.py tests/test_payment_reconciliation.py -q --junitxml=payment-gates.xml`. Never point this fixture at production. Use declared Python3.12 dependencies, `TESTING=1`, `PYTHON_DOTENV_DISABLED=1`, random local `SECRET_KEY` and isolated `DATABASE_URL`. Qualification requires31 cases, no failed/error/skipped cases.

Real Stripe qualification needs `STRIPE_SECRET_KEY` test/sandbox credentials in gitignored local env, real signed CLI forwarding and real Checkout UI test-card submission. Confirm sandbox mode before submission; verify provider refund history as well as local responses. Provider contracts: [test cards](https://docs.stripe.com/testing), [CLI signed forwarding](https://docs.stripe.com/cli/listen), [idempotency expiry](https://docs.stripe.com/api/idempotent_requests), [refund API](https://docs.stripe.com/api/refunds/create).

Rollback for undeployed code: revert isolated `48c056a5`. No automatic migration rollback after real cases exist: export/reconcile pending money outcomes first; dropping the table would destroy recovery evidence. No SCOREBOARD gain: this changes payment integrity, not forecast science.
