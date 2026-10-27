# G02 next slice: durable checkout intent and missing-return recovery

Prepared from immutable candidate `7d0538c9d403b511103367532d77cf2f00860740` against verified remote DEV `131d5d9e434124d9bf510edb9eed2e8238723313`. This is bounded source/fixture preparation, not a payment repair, runtime test or gate closure.

## Current evidence and reuse boundary

The remote payment candidate remains at 7d0538c9, is not an ancestor of DEV, and its existing isolated checkout is clean. No matching payment owner task was identified in the current 50-task listing; ownership remains unconfirmed. Do not edit that checkout or assume it is unowned.

[Immutable source-contract receipt](evidence/2026-10-15-g02-preparation/source-contracts.json) records Git-blob SHA256 and AST call locations for five files. In the scheduled creator, provider creation is at lines147-148 and `commit_checkout` at182; the live creator uses provider creation at160-161 and `commit_checkout` at192. The helper's database commit is at14. Scheduled `flush` at126 is not a durable commit. These are source-order observations, not a newly executed crash reproduction.

Reuse the candidate's provider-bound scheduled fulfillment, live callback validation, transaction/refund locking, bounded admin recovery scan and durable refund-case intent. Its scan records `live_callback_missing` for a paid live transaction; generic webhook completion is not evidence of live participation. Current candidate source includes recovery queue/scan/refund routes, superseding the older initial-report statement that those backend components were absent. The operator UI, notification/ownership journey and missing-return entitlement remain unaccepted. No frontend literal references to the known reconciliation route names were found in the candidate; that search alone does not prove the absence of every possible indirect integration.

The next implementation boundary is **PAY-ORPHAN first**, followed by **PAY-RECOVERY**. Adopt only reviewed candidate paths onto the eventual qualified DEV baseline. Do not wholesale-import its older branch or repeat its existing payment/post fixes. Authority/access changes, provider configuration, real payments and customer changes are outside this lane's present implementation authorization.

## Offline acceptance matrix to implement after ownership confirmation

Use a deterministic provider double and isolated database; never target shared DEV or a live provider. Assert persisted rows and provider-call history, not only response strings.

| Case | Fault / ordering | Required observable result |
|---|---|---|
| I01 | Intent commit fails before any provider call | Zero provider creations; no checkout URL or false paid state; no stranded credit debit. |
| I02 | Crash after durable intent, before provider call | Pending intent is discoverable and retryable with the same purchase identity/key and unchanged amount/currency/owner/session. |
| I03 | Provider creates checkout, response is lost | Durable unknown-outcome intent remains discoverable; retry uses the same provider key/parameters and binds the same checkout, without a second credit debit. |
| I04 | Crash after provider response, before local binding | Recovery binds verified provider identity to the existing intent; no fabricated success or lost paid object. |
| I05 | Same-request repeat / concurrent retry | One purchase identity and one entitlement or recoverable case; no double wallet, escrow, notification or refund effects. Different payload under the same key is refused. |
| I06 | Known provider failure / known local binding failure | Reuse bounded existing compensation when the checkout identity is known; unknown outcomes stay explicit and recoverable. Do not claim exactly-once remote execution. |
| R01 | Signed verified paid event, no browser return, live session available | Exactly one verified live entitlement, or one durable operator-visible case with an accountable owner. No dependence on the browser callback to discover payment. |
| R02 | Paid event after session ended / booking cancelled / entitlement duplicate | Preserve terminal state; one durable actionable case. No automatic unqualified refund or revived participation. |
| R03 | Case listing / bounded scan / refund UI | Use existing admin authority, pagination, actual result counts and explicit pending/error/terminal states. Preserve denied and repeated-click behavior; no invented recovery success. |
| R04 | Refund timeout / retry / provider pending / stale idempotency window | Retain existing durable refund intent and fixed key; pending stays pending, unknown old outcomes require review, terminal success cannot regress. |
| R05 | Wrong receipt owner/session/amount/currency or unpaid/unsigned event | No entitlement, wallet movement, refund or untrusted reconciliation case. Preserve existing negative controls. |
| R06 | Notification/operator follow-through | Persist accountable case identity and truthful notification/result state; distinguish in-app persistence from unverified external delivery. |

Resolve the minimal intent storage representation and retry identity against existing models before adding a schema patch. A migration is not presumed necessary. User credit reservation, price binding, session eligibility and expiry must retain candidate behavior while remote calls are separated from durable local state.

## Dependency order and remaining verification

1. Complete the current qualified combined batch on a bounded weather checkpoint/window; the entire weather program need not finish.
2. Confirm payment candidate ownership and scoped adoption. Choose an isolated next-slice worktree from the newly verified DEV source; preserve commerce/wave/weather immutable receipts.
3. Run meaningful failing-before/passing-after fault-injection controls for I01-I06 on exact scheduled/live consumer functions, then add missing-return/operator cases R01-R06 without duplicating already qualified tests.
4. Separately qualify concurrency/schema behavior on a named disposable PostgreSQL environment and final-head provider sandbox when that environment is available and authorized. Historical reported passes are not current runtime qualification.
5. Qualify the React create/return/cancel/pending/refund/operator journeys in light/dark/beach and responsive/focus states. Provider, notification, private media and deployment identities remain separate acceptance claims.

G02 and all twelve whole-launch gates remain open. This preparation can progress without weather GPU/browser work or shared-service load; implementation ownership and runtime qualification are the real dependencies.

## Existing payment owner identified and independently assigned

2026-10-15T01:34:48Z: Supported task read identifies Audit Raw Surf App, task01a128aa-e10f-7353-b2bf-c56fa736d8a4, as the existing cddb/payment-candidate owner. Its original completed handoff names7d0538c9. A fresh direct user instruction in that task assigns the orphan-checkout release hold, isolated before/after verification, memory/lessons and no deploy. The owner is active on a child branch and plans durable purchase identity, frozen provider parameters/credit reservation, stable retry keys, unknown-outcome recovery and safe-window refusal. Exact new branch/head/file scope and qualified handoff remain pending. Master sent a read-only adoption/ownership request, then confirmed that the existing owner owns PAY-ORPHAN implementation/tests. No duplicated payment test/probe is warranted.

Master created separate raw-surf-g02-prep worktree under this task workspace, branch codex/g02-checkout-intent-prep-2026-10-15 at verifiedDEV131d5d9e. Its tracked tree is unchanged; the proposed lost-response probe is unwritten/unrun. Reserve this isolation for non-overlapping recovery/operator integration after the owner supplies a stable contract and qualified checkpoint. The existing candidate and active owner checkout remain untouched.
