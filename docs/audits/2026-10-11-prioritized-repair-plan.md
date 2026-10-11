# Raw Surf prioritized repair plan

Prepared October 10, 2026, America/New_York; recorded October 11 UTC. Based on [the original audit](2026-10-11-app-forensic-jacobian-audit.md) and the subsequent [counteraudit](2026-10-11-counteraudit.md). Application baseline `e0af8885`; no code changes authorized or performed by this plan. All actions below are proposed work, not completed repairs or scheduled commitments.

## Order of work

**First protect paid state and authenticated ownership. Then remove false success and unsupported feature promises. Repair export and alert completeness next. Treat weather correctness as its own coordinated lane, and leave framework/personalization expansion until the existing journeys are reliable.**

The counteraudit changes the approach: reuse existing webhook, wallet, identity, alert and cache safeguards. It does not justify rebuilding those systems. “Verified” below is an acceptance requirement for future repairs; it does not mean these checks have already passed.

Priority meanings: **P0** = confirmed integrity defect to address first; **P1** = next functional repair or urgent configuration decision; **P2** = bounded investigation/feature completeness; **P3** = later modernization. These are work-order labels, not claims of a live incident. Conditional priority is stated where usage or exposure is unknown.

| Order | Repair | What it affects | Verification required before calling it fixed |
|---|---|---|---|
| 0, alongside first fixes | **R00: establish exact repair baseline and protect regression controls** | Confidence in every subsequent patch | Pin source/front/backend/schema/flags; classify tests by actual behavior vs route existence; reproduce each defect on its affected mounted path; record old E2E failure separately from new results |
| 1 — P0 | **R01: authoritative booking payments** | Scheduled bookings, live checkout creation/completion, participants, credits, escrow, notifications | No unpaid/unbound event writes; correct paid event fulfills once under retries/concurrency; existing webhook/wallet controls remain green |
| 2 — P0 | **R02: bind post actions to authenticated actor** | Post settings/edit/delete and legitimate admin moderation | Missing/invalid token and foreign identity denied before mutation; real owner succeeds; real admin deletion still succeeds |
| 3 — P1 if used; otherwise P2 | **R03: stop false payout/retry success** | Admin finance records, photographer expectations, reconciliation | No provider receipt or approved external reconciliation means no settled/success state; rejection/timeout/retry and duplicate-submit controls |
| Parallel check — P1 | **R04: internal broadcast configuration and fail-closed behavior** | Notifications/event delivery and internal MCP sender | Missing/empty/wrong configuration rejected; configured sender and receiver communicate; never print token values |
| 4 — P1 while redemption enabled | **R05: make gear credits buy a defined deliverable** | Gear balance, purchase history, partner handoff | Owner-approved goods/voucher/discount contract; abandoned/rejected/repeated/concurrent handoffs cannot consume unearned credits |
| 5 — P1 containment; P3 new inference | **R06: honest AI suggestions and claims** | Photographer tagging, gallery distribution and pending claims | Heuristics cannot produce asserted identification or automatic claim records; safe unavailable/manual-review paths stay intact; model rollout has separate evidence |
| 6 — P2, promote for an active obligation | **R07: complete data export** | Admin export, booking membership, message history | Real mapped-model export for creator, photographer and crew-only member; over 500 messages complete; no unrelated private rows or secret fields |
| 7 — P2 | **R08: make all supported alert preferences effective** | Manual/scheduled alerts, push, in-app and optional email | Time/tide/condition perturbations change eligibility as specified; timezone/DST/missing data and concurrent preference changes; working cooldown/push controls preserved |
| Separate weather lane — P1 geometry; P2 cache investigation | **W01: geographic/frame correctness and data acceptance** | Marine grid thinning, playback, point alignment and forecast provenance | Retained-coordinate parity at both thinning sites; organic and seed cache cases; current reader-visible product checks; no pending wind verdict inferred |
| Decision first — P2 | **R09: forecast entitlement contract** | Pricing promises, guest/free/paid access and forecast APIs | Decide UX vs server access policy; if enforcement is required, one shared policy with role/tier/horizon boundary tests |
| P2 discovery; P3 activation | **R10: app memory correctness and developer memory closure** | Semantic recommendations, privacy/retention, future session decisions | Establish actual consumers; compatible embedding provenance; scoped data lifecycle; evidence-linked overdue closures without invented fulfillment |
| Alongside auth, then P3 | **R11: dependency risk, performance, UI and remaining journeys** | Runtime security, release tooling, responsiveness, accessibility, remaining feature inventory | Triage patched auth dependency separately; controlled performance samples; all-theme/role/device journeys; migrate build tooling only after stable regression coverage |

Do not read row order as “wait for every earlier task before investigating the next.” Auth, finance and configuration checks can be isolated. Shared financial transitions must have one owner/reviewer to avoid conflicting fixes. W01 and Claude's wind lane have a separate collision check.

## First repair batch: R00–R04

### R00 — Evidence baseline and release gates

Owner role: repair lead + QA. Dependencies: none. This is preparation alongside the first fixes, not a weeks-long prerequisite.

- Record the exact application revision and affected route registrations. Before implementation, refresh deployed frontend/backend revisions and configuration **presence**, plus the existing PR scopes. This plan's earlier live readings are historical snapshots.
- Use actual mounted routes and a real transaction-capable test database with provider/network doubles. Unit-level extracted functions locate bugs but cannot establish middleware, dependency or transaction correctness. Never run legacy tests against live customers merely because their names say “test.”
- Reuse `test_audit_stripe_authority.py`, `test_audit_payment_fulfillment.py`, `test_payment_route_caller_binding.py`, `test_actor_route_binding.py`, `test_audit_identity_evidence.py` and `test_audit_alert_delivery.py` where relevant. Read their scope; existence or old results do not make the new path covered.
- Pin expected status, ledger/row changes and provider calls. Include a valid-success control as well as rejected cases. Demonstrate the regression check fails on the affected pre-fix implementation and passes after the repair.
- Diagnose the exact-head E2E timeout separately. Do not attribute it to Claude's work or demand a broad rewrite from one timeout. Before a release, satisfy required current-head checks and target browser journeys; any exception must follow the existing explicit owner-waiver rules, never an implicit “known flaky” dismissal.

Exit: each first-batch defect has a bounded reproduction, an affected-path list and explicit expected outcomes; no live data modified during diagnosis.

### R01 — Booking payment integrity

Owner role: backend payments + frontend checkout. Affects `routes/bookings/stripe_checkout.py`, the two application callers of the simulated Stripe helper, booking success UI, and existing canonical fulfillment contracts.

1. First prevent simulated/missing/unbound provider evidence from confirming a booking, creating paid participation, recording held escrow or sending success notifications. If a provider is unavailable, return an honest unavailable/pending result rather than simulating success.
2. Reconcile checkout creation and completion with actual provider sessions. Keep provider **test mode** usable in an isolated test environment; identifier prefixes are not a payment-verification mechanism.
3. Bind verified evidence to the expected transaction, booking, user, amount, currency and current booking state. Define who can read completion status. Browser redirects should not be an independent authority for settlement; retain the canonical signed webhook and a consistent status/fulfillment contract.
4. Make the affected transition atomic and idempotent across callback/webhook/status races. Reuse the wallet's transaction-claim pattern where compatible; do not route a booking payment into wallet top-up accidentally.

Acceptance: no transaction; unpaid event; unrelated paid session; wrong actor/booking/amount/currency; cancelled booking; expired session; provider timeout; duplicate/out-of-order events; simultaneous webhook/status reads; commit failure and retry. Invalid cases produce no inappropriate financial, participant or notification mutation. Valid paid completion has one logical fulfillment, correct monetary totals and balanced ledger effects. Use PostgreSQL for concurrency qualification; SQLite alone cannot prove production locking. Do not claim exactly-once network delivery—prove idempotent durable effects under at-least-once input.

Preserve: canonical signature verification, wallet fulfillment and legitimate subscription/gallery event routing. Release evidence: isolated provider test-mode journey from checkout through persisted booking/escrow and readback, followed by approved staged release checks. No real-customer payment is part of acceptance.

### R02 — Authenticated post authority

Owner role: backend identity/social + frontend caller compatibility. First scope is the three confirmed settings/edit/delete routes; expand to the scanner candidates by risk, not an assertion that all 269 are vulnerabilities.

Use authenticated identity for action authority; validate or ignore legacy actor fields consistently with current API conventions. Preserve genuine admin deletion and legitimate ownership semantics. Do not rely on frontend login guards or simply add a token parameter without binding it to the resource.

Acceptance matrix on assembled routes: absent token, invalid/expired token, foreign valid token plus owner's ID, foreign valid token plus an admin ID, real owner, real admin, missing resource. Rejected callers cannot mutate state; successful callers receive expected persisted results. Verify frontend calls still work without weakening backend checks. Review high-consequence neighboring mutations next: money, private media, guardians, crew membership and messaging.

### R03 — Truthful operator settlement

Owner role: finance feature owner + backend payments. Priority is urgent if these screens inform actual settlement; actual operational use is not established by this audit.

First stop unconditional “completed/recovered” state and success counts. Then choose the supported workflow: provider execution with receipts, or a documented externally settled transaction reconciled by an authorized operator. Do not introduce a new money-moving integration merely to make a button appear functional.

Acceptance: provider not configured, not called, rejects, times out, returns pending, settles, duplicate submission, and crash between provider result and database persistence. Submitted/pending differs from settled; amounts/recipient totals reconcile; receipts bind to the right operation; repeated clicks cannot create duplicate payouts. Provider-call spies must distinguish no-call from successful call. Admin authorization remains enforced. Failed-payment rows must be sourced from actual records, not synthetic success logic.

### R04 — Broadcast configuration boundary

Owner role: backend/platform. First inspect whether `INTERNAL_BROADCAST_TOKEN` is configured at both sender and receiver without revealing its value; deployed exposure is currently unknown.

Plan a paired change to `routes/live/websocket.py` and `event_bus_core.py`: no hardcoded fallback, missing/empty configuration fails closed, legitimate configured traffic works. Verify wrong/missing credentials cannot broadcast, and valid messages reach only the intended room under existing authorization. Include restart/config-loading behavior. If valid configuration already protects deployment, rank the source hardening below the confirmed payment/identity defects.

## Second batch: complete existing feature promises

### R05 — Gear fulfillment contract

Owner role: product + commerce/backend. Dependency: decide whether credits purchase an item, voucher, discount or another explicitly described benefit. This decision is needed before selecting reservation/settlement semantics, not before preparing this plan.

Do not treat visiting an affiliate URL as the deliverable. For a transactional redemption, use a reservation and settle only against proof of the agreed benefit; support expiration/release and idempotent acknowledgment. If partners cannot support that, propose a truthful non-spending handoff until fulfillment exists. Preserve JWT-derived identity—the counteraudit disproved a missing-query-identity theory.

Verify abandonment, browser closure/popup blocking, retry, expired reservation, partner rejection, duplicate acknowledgment and two simultaneous redemptions. Check balance conservation, purchase state and recovery without assuming physical delivery is the settlement event. No historical user balances should be adjusted without a separate evidence-backed reconciliation plan.

### R06 — AI containment before AI expansion

Owner role: media/backend + photographer UX. Preserve the existing unavailable identity service, find-me boundary and manual gallery review.

Remove the unsupported inference claim from the remaining photo-analysis/suggestion and lineup producers; return honest capability status or explicitly non-identifying metadata labels. Ensure the same heuristic cannot create pending identity claims through a second route. Keep deliberate, authorized manual tagging distinct from automatic suggestions.

Verify every identified frontend consumer, no-image/invalid-image inputs, changed filenames with identical bytes, changed images with identical metadata, unrelated candidate profiles and missing provider capability. Without actual inference, no asserted identity confidence or automatic identity-claim write; manual review still works. Preserve ownership authorization and do not delete historical claims without review. A later model project needs labeled evaluation data, precision/recall and abstention targets agreed before activation, plus privacy and cost constraints. No vendor choice is required for containment.

### R07 — Complete export

Owner role: backend data/compliance feature. The confirmed route is admin-only. Promote urgency if an actual user export request or deadline exists; none was established here.

Correct model joins, including creator, photographer and crew-only participant membership; do not merely rename `surfer_id` to `creator_id`. Define export data categories and return all eligible rows through streaming/pagination or a complete generated artifact, not a silent 500-message cutoff. Review per-row fields so another participant's private data and secrets are excluded. Account deletion is a separate lifecycle inventory, not a claimed consequence of fixing export.

Verify real ORM mappings, all three booking relationships, zero-data account, more than 500 messages, duplicate membership, cross-user exclusion and large export resource behavior. Compare expected IDs/counts with an independently constructed fixture manifest; test download completion and admin authorization. Keep any required financial record retention decision separate from deletion mechanics.

### R08 — Effective alert preferences

Owner role: forecast product + notifications/backend. First specify which preferences are supported, their AND/OR semantics, spot-local timezone, DST handling, tide/condition source and stale/missing-data behavior. Unsupported controls must not silently promise filtering. API email settings need explicit supported/unavailable semantics even though the inspected modal does not expose an email toggle.

Add effective matching to the shared manual/scheduled delivery path, preserving height validation, active status, atomic claim, cooldown, push opt-out and in-app persistence. Revalidate preferences/active state after forecast I/O so a concurrent edit cannot trigger an obsolete match. Durable retry/outbox design is a later bounded addition; avoid claiming provider exactly-once delivery.

Verify each preference independently; combinations; spot-local midnight and DST; missing/stale tide; height zero versus unknown; preferences changed while awaiting forecast; manual/scheduled races; push off; email unsupported/unavailable; commit failure; push failure and retry. Assert notification persistence before provider delivery and no duplicate durable alert for the same eligibility/cooldown event.

## Separate weather lane: W01

Owner role: existing weather repair owner + rendering reviewer. **Not Claude's pending wind acceptance task.** Dependencies: refresh #264's actual scope/head and check overlapping files/flags; keep numerical changes behind existing owner-controlled gates. A plan does not authorize a merge or flag change.

1. **Geometry, P1:** preserve the geographic coordinates of retained samples at both `series_vector_budget._decimate_frame` and `grid_series_helper` build-time decimation. Choose a representation that handles removed endpoints and the semantics of both stride and peak-preserving thinning; do not blindly replace every bound or alter the client convention. Test divisible/nondivisible rows/columns, antimeridian wrapping, missing cells, both thinning modes and actual client mapping. Confirm stored source products are not mutated through shared references. The fresh +2-degree control must fail before and pass after; the aligned negative control must remain aligned.
2. **Cache, P2 pending reproduction:** test the organic capture and staged-seed paths independently with same-offset/new-valid-time and same-valid-time/new-run data. Assert encoded/rendered field identity, not just a different string key. Preserve model/layer/rating-flavor partitioning, valid-time refresh, finer-grid upgrades, exact-grid holds and bounded cache size. If an outer guard prevents a suspected path, narrow or close that subcase with evidence before patching it.
3. **Data acceptance:** recheck the previously warned lanes by model, cycle, horizon and reader-visible object. A new green ingest run is insufficient; require coherent manifests, acknowledged durable objects and consistent point/grid/series provenance. Diagnose data issues independently from shader style or wind polling.
4. **Qualification:** source controls first, then coordinated low-load dev readback and exact-head browser playback/geometry checks. Record paired before/after served effects in SCOREBOARD when required. Existing health, compute and live-load restrictions still apply.

**Claude lane W-CLAUDE: pending, excluded.** Preserve the owner's reported polling window; do not infer completion from elapsed time. No scanner duplication, synthetic verdict, default/theme change, workflow dispatch or message to Claude. Before scheduling any shared weather validation, identify the exact ongoing work and avoid overlap. When its actual evidence is supplied, review its exact revision and acceptance separately; this plan creates no polling automation or timed commitment.

## Decisions and later upgrades

### R09 — Forecast access promise

Product must decide whether advertised paid horizons/model access imply server-enforced exclusivity or UI-only access. If enforcement is required, express one policy consumed by both frontend and backend rather than another tier table. Verify guest/free/each paid tier, expiry/downgrade, model, horizon boundary, cache separation and public discovery behavior. Do not remove legitimate guest discovery or change prices as an incidental repair.

### R10 — Memory correctness and closure

For app memory, establish which process actually uses the stdio service and under whose authority. Before activating or expanding it, record embedding model/space/dimension/fallback provenance, prohibit incompatible comparisons, define reindex behavior and retention/deletion, and test remote-success -> local-fallback -> remote-recovery with no cross-user leakage. No new vector database or “learning” claim until a real consumer and measurable outcome exist.

For developer memory, preserve the canonical ledger, append lessons/corrections, and reconcile the 13 overdue commitments against their exact obligations. Link completion evidence using the ledger's fulfillment mechanism; source similarity is not closure. Pending Claude work remains pending. Keep a short current index into historical evidence rather than creating another competing source of truth. These planning documents are local until reviewed/merged.

### R11 — Upgrade only after preserving behavior

- **Auth dependency risk:** review the previously identified `python-jose` pin against maintainer fixes and the application's allowed algorithms. Isolate the security dependency update from a framework migration; verify valid/invalid/expired tokens, allowed algorithms and rollback compatibility. A vulnerable version number is not a live exploit finding.
- **Journey coverage:** after the first batches, cover the remaining implemented-but-unverified paths: signup/profile/passport; photographer availability; crew invite/split/cancel/refund; live join/reconnect/capacity; gallery purchase/download/refund; messaging/blocking; guardian restrictions; career application/status; Strava connect/refresh/disconnect; subscription renewal/cancel/downgrade. Specify actor, resource, payment and notification outcomes for each. Do not convert a feature inventory into a pass badge.
- **Performance:** collect controlled representative route samples and query traces before adding caches, changing indexes or splitting workloads. Earlier eleven-call samples identify candidates, not a capacity model or leak diagnosis. Keep heavy weather loads coordinated with the weather owner.
- **Experience:** cover light/beach/dark, desktop/mobile, keyboard/focus, reduced motion and loading/error states. Exclude Claude's in-flight wind design from generic restyling.
- **Build tooling:** migrate deprecated CRA tooling only after the critical journeys are reproducibly guarded; keep behavior, environment variables, routing and service-worker/update semantics explicit. No general React rewrite is justified by these findings.

## Completion record for every repair

Each future repair should record: exact before/after revision; finding/subcase addressed; affected producers and consumers; failed-before/passed-after positive and negative controls; current required CI; authorized staged readback; known limitations; rollback that does not reintroduce false paid/authorized state; and evidence-linked memory update. Financial corrections need reconciliation rather than silent rollback of already settled real transactions.

The first reviewable implementation batch should be **R01 + R02 as separate small changes, with R03 containment and R04 configuration verification alongside them**. That addresses the best-supported integrity risks without touching Claude's pending wind work or embarking on an application rewrite.
