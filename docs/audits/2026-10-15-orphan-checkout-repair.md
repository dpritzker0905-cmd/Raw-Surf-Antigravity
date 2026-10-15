# Orphan checkout repair — verified local candidate

Recorded 2026-10-15 01:57Z (UTC). Code `46a1d1b8df37ae53355cb50a9e3f6b8b231f7e51`; branch `codex/orphan-checkout-intent`; checkout `cddb/raw-surf`. Parent `codex/booking-payment-post-repairs` remains frozen at `7d0538c9`. No push, PR, merge or deployment. This repairs new scheduled/live creation, not every Stripe purchase type or historical orphans.

## Outcome and evidence

| Boundary | Before | After / limits |
|---|---|---|
| Existing focused baseline | Parent creation/recovery matrix |77 passed before production edits. |
| Durable creation/identity | Six new controls failed: provider before durable purchase; changing/missing creation key; changed request not rejected |39 new integrity cases cover creation/recovery, including lost prepare-commit acknowledgement, failed attempt checkpoint, lost creation response, failed binding commit, stable legacy retry, changed-key rejection, owner/admin authority and unavailable-service races. |
| Recovery route/event binding | Ten new controls failed; unknown signed receipt left placeholder unbound |Owner/admin recovery and strict signed receipt attachment implemented; binding commits before a fulfillment rollback/case transition. |
| PostgreSQL | Earlier locking claims did not cover durable preparation |Actual17.11 disposable loopback cluster: **74 passed,0 failures/errors/skips**,142.63s. Eleven PostgreSQL concurrency/migration cases,39 intent cases,24 reconciliation cases. Actual server lock waits observed, including concurrent preparations and retry versus paid webhook. |
| Stripe sandbox creation | Real create succeeded but its response was deliberately discarded |Both scheduled80 and live25 test checkouts: first HTTP502, retry200, identical frozen parameters/key, same provider session identity, provider list exactly1 matching purchase each. Purchases and first-attempt markers existed before SDK. Both unpaid checkouts expired during cleanup. No card payments, charges or refunds in this qualifier. |
| Wider affected regression | Additional old tests were not part of the initial77 baseline |**197 passed,2 failed** in190.83s across199 cases. Both failures reproduce identically on the exact frozen-parent backend snapshot:1 passed/2 failed, same expected404 versus actual400/500. No broad green claim. |
| CI/hygiene | New tests must join existing lanes/floors |36 floor tests passed; tracked partition672 files:195 guards,163 chain,311 estate,2 existing exclusions,1 existing quarantine. Python lint passed;672 production Python files within800 LOC; secret precommit scan found no leaks. |

Two unchanged legacy failures: `test_sessions_payments_rollback.py::test_complete_payment_database_error_refunds_stripe_live` and `::test_complete_payment_database_error_refunds_stripe_mock`. Their old receipt/automatic-refund expectations do not pass on parent7d0538c9 either. No test was removed, quarantined or changed to hide these failures. They remain a separate broader acceptance gate. The first parent snapshot lacked the CI environment declaration; it was restored from the parent and the identical failures rerun. Both comparison runtimes report2/46 differing dependency pins and10 absent packages; exact declared/hosted acceptance is still pending.

## Durable purchase contract

`CheckoutIntent` and a pending local `PaymentTransaction` are committed with booking, participant and any partial-credit debit **before** Stripe is called. The pending session namespace is `pending:<intent UUID>`; it is not provider evidence. All completion/status entrances reject it locally, and the canonical pending-receipt scan excludes it. An attempt timestamp is committed before the SDK call, so a crash at either boundary leaves a discoverable purchase.

`Idempotency-Key` is optional for compatibility,8-128 ASCII letters/digits/underscore/hyphen; use a fresh UUID per new purchase and retain it for retries. Its stored key is hashed and scoped to the authenticated purchaser. Reuse with different request fields or purchase kind returns409 before provider access. Frozen parameters include metadata, amounts, card-only methods, callback URLs and the original expiry. Stripe key is `checkout-intent:<local UUID>`; API credentials are never stored in the intent. Metadata contains `checkout_intent_id` for provider-history reconciliation.

Legacy requests without a header use a deterministic request fingerprint. Scheduled identical requests conservatively reuse their original purchase; a deliberately new purchase for the same inputs requires a new explicit key. Live fallback also includes the intended active session. A legacy retry after that session has changed must recover the old purchase through its owner queue/resume or operator review; this batch does not add persistent client UUID handling or frontend UI.

Unknown SDK outcomes retain the durable purchase, rather than rolling back the only intent or blindly expiring/refunding. A failed initial database preparation or first-attempt checkpoint never calls the provider. A failed binding commit returns502 with the durable intent ID for recovery. Unknown outcomes beyond23h require provider-history review; no new creation after potential idempotency-key pruning. Frozen deadlines never move on retry: an unmatched creation that can no longer meet Stripe's30-minute minimum is reviewed, not silently replaced. Known session IDs are retrieved, never recreated.

Receipt attachment validates intent metadata, purchaser/purchase metadata, exact positive card amount/currency and session state/identity. Only placeholder-to-verified-ID or identical-ID replay is allowed. Binding commits before canonical fulfillment, so an unavailable booking can subsequently roll back fulfillment and still retain its transaction and reconciliation case. A paid webhook winning against an older open create response cannot regress transaction completion or expose its stale URL. After provider response, refreshed transaction/intent and booking or photographer/live locks recheck eligibility before URL exposure.

A durable partial-credit debit reserves purchaser credit, not photographer availability: existing conflict detection excludes Pending Payment bookings. Existing31-minute cancellation/expiry policy remains. Repeat expiry cleanup refunds partial credits once; a late paid receipt records one unavailable case and never resurrects the booking. Unknown receipt rows stay visible after expiry. Live joins have no partial-credit reservation in the card path. Request-a-Pro deposits, wallet purchases and subscriptions were not converted; their existing behavior is preserved, including a neighboring deposit regression control.

## Operator integration contract (backend only)

| Endpoint | Authority | Contract |
|---|---|---|
| `GET /api/payments/checkout-intents` |JWT purchaser |Own purchases only; `limit`1-100, default25; stable `after_id` cursor. |
| `POST /api/payments/checkout-intents/{id}/resume` |JWT purchaser ownership |Retries exact original purchase; success retains existing checkout response fields plus `checkout_intent_id`.409 requires review, terminal-state or availability handling;502 retains purchase recovery. |
| `GET /api/payments/reconciliation/checkout-intents` |JWT admin |Bounded intent queue using same cursor; no frozen parameters, customer email or raw payloads. |
| `POST /api/payments/reconciliation/checkout-intents/{id}/attach` |JWT admin |Body `session_id`; fresh SDK retrieval must return that exact ID and match the frozen purchase. Can attach a verified historical session after unsafe recreation window. No automatic fulfillment/refund from attachment. |

Successful creation responses preserve the initial purchase snapshot; `remaining_credits` is that snapshot, so clients must refresh current wallet state rather than treat a retried response as a live balance.

Queue item fields: `id`, `kind`, `state`, `transaction_id`, `booking_id`, `session_id`, `amount_cents` (USD), `first_attempt_at`, `last_error_type`, `created_at`, `updated_at`. Queue states are `prepared`, `creating`, `ready`, `review_required`; `ready` means receipt identity bound, not paid/fulfilled. Existing fulfillment/case records remain authoritative for payment/entitlement state. Top-level queue keys are `intents`, `next_cursor`.

Errors after persisted creation generally carry `detail.checkout_intent_id`, and where state was safely read, `detail.state` and a bounded message. A binding-commit failure intentionally does not guess durable state. Operator UI must read the queue/transaction rather than treat502 or `ready` as payment success. Cross-owner resume403; no credentials503; evidence mismatch400; expired retry window409. Admin attachment is an explicit provider-history action and does not trigger money movement. Missing-return live activation, admin frontend, cadence, alerts and operator ownership remain separate master integration work.

## Adoption, qualification and rollback boundaries

- This chat owns only PAY-ORPHAN source/tests on its child branch. Master owns later DEV adoption and non-overlapping operator integration after the held batch. No duplicate operator frontend or test implementation started. Parent7d0538c9 and Claude local refs remain unchanged; no frontend, forecast/service/scheduler source, wind decisions or scoreboard changed versus that parent. Last fetched DEV was131d5d9e; this child intentionally remains based on the payment candidate, not a wholesale import into DEV.
- Adopt the source delta after its prerequisites `a85ff76c` and `48c056a5`, reconciling current DEV contracts. Do not import this older branch's shared STATE/ledger wholesale; preserve new shared additions and rechain local actions. Recompute floors after the held batch instead of copying projected estate1687/floor1685.
- `checkout_intent_001` follows candidate `payment_reconciliation_001`. Current DEV migration graph previously had different heads. Review actual target heads and privileges before adoption/apply. Local upgrade/downgrade/column/RLS/role checks passed only in disposable schemas. No live migration or provider webhook configuration changed.
- Hosted CI, exact dependency parity, actual deployed schema, full frontend return/retry acceptance, two inherited legacy failures and broader missing-live-return/operator integration remain open. Two real SDK creation/retry checks do not certify paid/refund journeys or signed delivery from a configured hosted endpoint. Synthetic signed-webhook controls and earlier dated payment evidence are separate.
- Existing pre-repair provider orphans with no durable intent still require provider-history investigation; no historical backfill was performed. Source rollback is revert46a1d1b8 before any deployment. Do not drop an applied intent table with unresolved purchases: reconcile/export evidence first.

## Evidence receipts

- `scratch/orphan-baseline.xml`: SHA256 `ddcd0401903bbcb0549b3a1140adbf59bb429ce0680481246f06f9da4f987aaa`.
- `scratch/orphan-red.xml`: SHA256 `38fd1d81ad646bd0f7e2aa02ab380333a22df4ddd9b720842ee773a4bdb4870d`.
- `scratch/orphan-red-recovery.xml`: SHA256 `1a7593e359514bd31058589296ef84f7a8e7fe0f2c40290a9d7ac3f31842c913`.
- `scratch/orphan-crash-red.xml`: SHA256 `c2b416fea5b617972d69538e16beb49da312025fec73d554e4687cc5ef310c54`.
- `scratch/orphan-pg.xml`: SHA256 `91172056f84927027e916a014de3d1c3b231ce3bb415eab59dbf1091d6f0951d`.
- `scratch/orphan-regression.xml`: SHA256 `7fcd10276b4f2c6703ff7faae383c1c2b6a1367db002634b9be92eeffa014bd1`.
- `scratch/orphan-rollback-current.xml`: SHA256 `c7f20f644d740f39ebb53018ff69253beb641ba856143e7bcdd6a2f2bfbd48a1`.
- `scratch/orphan-rollback-parent.xml`: SHA256 `27d9eaa0094c2140cc6bd89be9643695e6d3c9449437f8f0955dacb49ef2e5e1`.
- Real SDK aggregate `scratch/orphan-stripe/verified-results.local.json`: SHA256 `356aacc0c537cfdc6f70392890c7b749bf3e3af8a0bebde84e282aa6144e108b`.

The independent reviewer ran three bounded design/code cycles. Findings about lock inversion, reconciliation rollback, stale responses and availability were incorporated. Review also caught a misplaced placeholder guard and an accidental payment-method expansion; a neighboring deposit test and scheduled/live availability controls failed before their corrections. Final static review found no additional concrete introduced defect within its scope. Execution evidence comes from this session's runs, not reviewer assertions. Some additional fault/invariant cases were written after the first slices already enforced their contract; do not label every39 control as independently observed RED.

Commands run from `backend/`, using local Python3.12 fixture runtime and `PAYMENT_TEST_DATABASE_URL` only for an owned disposable loopback database. PostgreSQL gate command: `python -m pytest tests/test_payment_postgres_concurrency.py tests/test_checkout_intent_integrity.py tests/test_payment_reconciliation.py -q`. The workflow now requires>=74 cases and zero skips. Sandbox proof used existing authorized `STRIPE_SECRET_KEY` in ignored local env with TLS verification enabled. Private helpers/credentials/CA and provider identifiers remain ignored; tracked report carries aggregate counts and hashes only.

Provider contracts: [idempotent requests and key expiry](https://docs.stripe.com/api/idempotent_requests), [Checkout creation/reference metadata](https://docs.stripe.com/api/checkout/sessions/create), [session listing](https://docs.stripe.com/api/checkout/sessions/list). No forecast-number change or SCOREBOARD gain.

## Publication qualification (2026-10-15 UTC)

Fresh pre-push controls:152 passed across checkout intent, reconciliation, booking integrity and CI floor tests; zero failures/skips in that bounded run. This does not replace the prior actual PostgreSQL74-case receipt or erase the two inherited wider-suite failures. Runtime parity remains2 differing pins/10 absent packages. Source remains46a1d1b8; publication makes no code change.

Fetched DEV131d5d9e and read open integration work: commerce PR331 and weather PR264 remain separate; coordinated DEV deployment is held for a qualified weather slice and safe window. The owner now authorizes publication and whatever is safe for DEV, while the earlier no-deploy instruction remains. Plan: publish the isolated candidate with deployment skips and adopt only confirmed documentation on a fresh DEV-based branch. Do not wholesale import this candidate or its diverged ledger. Payment code/schema/UI/runtime acceptance holds remain open.

Deployment suppression uses provider-supported `[skip render]` and `[skip netlify]` commit messages. Netlify documents that a later unskipped commit includes the deferred changes; skips do not constitute a rollout safety gate. No provider configuration, pipeline trigger or weather process is changed. Sources: [Render deploys](https://render.com/docs/deploys), [Netlify skip a deploy](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/#skip-a-deploy).

Confirmed publication: Remote read-back confirmed codex/orphan-checkout-intent at39d5e81d109ddcaed82723e7ced24ed16ca6ae5f; frozen parent7d0538c9 and all local Claude branch refs unchanged. No DEV code merge, deployment, live migration or wind verdict. Fresh bounded152 passed; receipt SHA256 3ef39ab6980ffc09431548f6e7a90fec08a1b943a189facf3982a68e9406c5d7. Prior PG74 proof and inherited2 wider-suite failures remain separate.
