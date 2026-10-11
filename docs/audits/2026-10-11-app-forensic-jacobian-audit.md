# Raw Surf: whole-app forensic and Jacobian audit

Audit requested October 10, 2026 (America/New_York); evidence gathered October 11 UTC. Source baseline: `e0af8885df558032437df7a53a0ad9ba683850e1`. Author: Codex. Scope: read-only application investigation, followed by authorized documentation and memory updates. No application code, configuration, database records, deployments, flags, or served numbers changed.

## Assessment

Raw Surf has a substantial implemented product: accounts, booking and media marketplaces, social and crew features, live sessions, administration, and an unusually developed weather engine. It is not yet defensible to call the entire product production-verified. The main weakness is the connection between a feature's visible promise and its authoritative result: provider-confirmed money, authenticated ownership, actual image inference, effective alert preferences, complete exports, and correct forecast identity.

Prioritize financial integrity and ownership before adding breadth. Consolidate the existing integration paths before replacing frameworks or adding more memory providers. Weather has much stronger evidence discipline than several commercial features, but its current data-health warnings, slow historical request samples, unfinished acceptance work, and pending branches remain material.

This is an estate-wide inventory with selective deep forensic verification, not a claim that every route was exercised. No feature percentage or universal green status is assigned where evidence does not support it.

## Evidence and limits

| Evidence | What it establishes | What it does not establish |
|---|---|---|
| Source and router assembly at the baseline SHA | Reachable implementation, dependencies, missing causal links | Successful deployment behavior for every route |
| Offline controls using extracted function bodies, mocked database/provider boundaries | Specific local behavior and counterexamples without touching users | A live exploit, full integration test, or production transaction |
| Read-only health, service-worker and GitHub observations | Timestamped deployment and workflow facts | Sustained availability, every device, or future status |
| PR descriptions and prior logs | Reported work and remaining acceptance obligations | Independent reruns of their test claims |
| Memory audit and ledger self-tests | Structural consistency and tamper detection | Truth of every remembered claim or closure of commitments |

Inventory: 65 frontend route declarations, 1,289 frontend source code files including tests, 229 Python files under backend routes, and 994 decorated handler declarations. These are static counts, not mounted endpoint counts. There are 667 backend `test_*.py` files and 408 frontend `.test.js` files; file counts are not coverage or passing-test totals.

Local frontend dependencies and Python test/application dependencies were unavailable. No full local build, pytest suite, or authenticated browser/device journey was run. Existing hosted evidence was inspected instead. No live payment, authorization attack, notification, map load test, or mutation was attempted. Raw historical logs containing credential-like material were not copied into this report.

## Deployment and active work

Read-only observations around 2026-10-11 01:56-02:00 UTC:

| Surface | Observed state | Interpretation |
|---|---|---|
| Backend `/api/health` at 01:56:15 UTC | Version ends `e0af8885`; healthy; database connected; 147 tables; uptime about 5 h 20 m | Backend baseline matches this source snapshot; health is a point observation |
| Memory | RSS 745.3 MB, peak 902 MB, reported limit 2,048 MB | Current capacity differs from the old 512 MB architecture note; no leak verdict from one sample |
| Request telemetry | 5,378 requests since restart; zero reported 5xx; p95 bucket upper bound 500 ms; p99 upper bound 2,500 ms; max 22,046.2 ms | Cumulative, bucketed telemetry, not exact percentiles or a fresh benchmark |
| Slow sampled routes | `grid_series`: 11 calls, average 11,955.7 ms, max 22,046.2 ms, six over 10 s; spot details: 11 calls, average 4,423 ms, max 10,902.7 ms | Investigate route-specific latency under controlled conditions; no attribution to Claude's current change |
| `/api/health/data` around 01:57 UTC | `warn`; fresh precomputed ratings with six frames; ICON marine and EURO marine mixed-cycle conflicts; ICON weather mixed-cycle missing | Service health and data health are different claims; successful scheduled jobs do not erase these warnings |
| Dev frontend service worker | `BUILD_VERSION=e0af8885` | Matches source baseline |
| Production frontend service worker | `BUILD_VERSION=fc140024` | Separate frozen production lineage; commit dated September 25, 2026. Do not treat dev acceptance as production acceptance |
| Hosted dev E2E [run 38084203665](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/38084203665) | Failure at this baseline; E2E step timed out after 40 min at October 10 21:20:30 UTC | Logs included Firefox WebGL context, auth, WebSocket and booking errors. Root cause unresolved; not proof that one wind change caused it |
| Marine nightly [run 38053781558](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/38053781558) | Success at older `541117de` | Useful prior evidence, not current-head certification |

**Claude's wind work stays pending.** The owner reported at approximately 01:55 UTC that Claude was working on weather-sim wind and needed approximately 2.5 more hours for a polling event before a verdict. The exact job, start time and deadline were not established. This audit does not treat that estimate as completion, schedule another poll, or pass/fail Claude's work.

At inspection, [PR #311](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/pull/311), head `92fc8752974c2208a64ef844cef763b444eb7135`, was open with green listed source checks. It proposes default-off light-theme candidates. Its own body still required scanner results and actual-app evidence, including real basemap and phone coverage. This is independently observed related work, not proof that its scanner is the owner's exact polling event. Existing dev light/beach glow is off following #310. Preserve the current work and wait for its evidence before any verdict or default change.

[PR #264](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/pull/264), head `de490d11f0096e0d7aecf186198d09012bed6c46`, also remained open. It contains weather frame, storage, composition, provenance and default-off physics/rating work. Its reported controls and green listed source checks are not merged repairs or fresh independent acceptance. Its E2E, actual compressed storage/readback, manifest/concurrency and live/device obligations must remain explicit. Do not copy its divergent action ledger wholesale into this branch.

## Feature standing

“Implemented; unverified journey” means source exists but the full role/provider/device journey was not certified here. “Partial” identifies a confirmed missing link. Every row states the next acceptance or improvement; these are recommendations, not changes made.

| Feature | Standing and evidence | Improvement / missing link / upgrade |
|---|---|---|
| Accounts, login and roles | Implemented in `routes/auth_pkg`, `core/security`; current strict identity helper improves on older audit claims | Role-by-role route enforcement and expired/revoked-token journeys; do not equate a safe helper with every caller being safe |
| Profiles, surfer passport and quiver | Implemented in `routes/profiles`; passport data feeds matching | Verify private/public field boundaries, ownership and deletion; separate profile facts from inferred preferences |
| Photographer profiles, availability and discovery | Implemented in `routes/photographer` and `explore_discover` | Exercise availability overlap, timezone, booking and payout chain; instrument slow spot-detail calls |
| Scheduled bookings | Partial: substantial CRUD/participants/escrow implementation; payment confirmation defect F01 | Provider identity, amount, currency and actor must bind to the same booking before confirmation |
| Crew / split bookings | Implemented; unverified complete journey | Concurrent participant payment, cancellation, partial refund and capacity acceptance; one authoritative money ledger |
| Live sessions and joining | Implemented; checkout creation calls the simulated helper while other completion paths are stricter | Reconcile creation/completion contracts, expiry, capacity, reconnect and duplicate callback behavior |
| Checkout and wallet/credits | Partial: local MCP checkout is simulated in a reachable application path, F01 | Real provider receipts, atomic idempotency, reconciliation; test mode must be explicit and isolated |
| Escrow, photographer payouts and payment retries | Partial: admin paths can report success without provider execution, F03 | Pending/submitted/settled/rejected states backed by receipts; immutable reconciliation evidence |
| Subscriptions and billing | Implemented in `routes/subscriptions_billing`; not fully provider-tested here | Renewal, cancel, webhook replay, failed-payment recovery and entitlement refresh acceptance |
| Weather subscription access | UI policy centralized in `LayerAccessResolver`; weather APIs sampled have no equivalent tier dependency | Decide whether limits are UX policy or data-access security. If security is intended, derive both sides from one policy, F10 |
| Posts and social feed | Implemented; owner checks in sampled edit/settings/delete routes trust caller-supplied identity, F02 | Enforce authenticated actor at the actual route and ownership boundary; preserve legitimate cross-user read access |
| Follow, reactions, reviews and short-form content | Implemented in `social`, `reviews_pkg`, `content`, `posts`; unverified journey | Blocking/privacy propagation, abuse controls, pagination and ownership matrix |
| Crew/community and invitations | Implemented in `routes/crew`; unverified journey | Invitation acceptance/revocation, role changes and private crew content need cross-role acceptance |
| Messages and conversations | Implemented; historical identity repairs exist | Verify membership on read/write/upload and reconnect, delivery acknowledgements and blocked-user behavior at current head |
| Live sockets, presence and dispatch | Implemented; authenticated socket identity exists; internal broadcast has conditional fallback risk, F08 | Fail closed when the internal secret is absent; room authorization, retry/dedup and multi-worker behavior |
| Notifications and push | Implemented; persisted notification and push paths exist | Durable outbox and delivery receipt/retry semantics; avoid treating DB insertion as device delivery |
| Surf alerts | Partial: height/cooldown and atomic claim implemented; saved time/tide/condition/email preferences not fully consumed, F05 | Connect every exposed preference to evaluation and delivery, with timezone and missing-data behavior |
| Uploads, media and galleries | Implemented in `uploads`, `gallery`; unverified provider journey | Upload receipt to durable original/preview, ownership, media access, purchase and deletion acceptance |
| Surfer gallery and claims | Implemented review/claim surfaces; inference input is unreliable in sampled paths, F04 | Keep human confirmation and verified ownership before entitlements; trace inference provenance into each claim |
| AI photo analysis, face/tag suggestions and lineup matching | Partial: sampled paths infer from filename/description, not pixels, F04 | Real image inference, measured precision/recall and abstention; distinguish candidate suggestions from identification |
| Gallery purchases and downloads | Implemented; full money-to-entitlement journey unverified | Paid receipt to exact asset/version/license, duplicate webhook, refund and revoked-access acceptance |
| Gear hub / affiliate store | Partial: credits debited before external fulfillment evidence, F06 | Reserve then settle against partner receipt; expire/release reservation and prevent concurrent double spend |
| Grom HQ / guardian flows | Implemented in `grom_hq`; not child/guardian-role certified here | Explicit guardian permissions and lifecycle, restricted messaging/media visibility; high-priority role matrix |
| Career hub / opportunities | Implemented in `career_hub`; unverified journey | Opportunity owner to applicant to status notification, privacy and dead-end CTA acceptance |
| Surf spots and exploration | Implemented in `surf_spots`, `explore_discover` | Stable spot identifiers across map, alerts, booking and forecast; pagination, duplicate spots and slow-detail analysis |
| Condition reports and calibration | Implemented in `condition_reports` and weather pipeline | Verified observer/time/location provenance, held-out accuracy, bias controls; observations must not silently become truth |
| Strava | OAuth integration and recent authority repair documented; no fresh connected-account round trip here | State validation, refresh/revocation, disconnect and correct user-to-activity mapping acceptance |
| Forecast ingest and storage | Operating scheduled workflows; current data health warns on three lanes | Atomic manifest publication, cycle coherence, durable upload acknowledgement and reader validation; PR #264 pending |
| Point forecasts, ratings and nearshore physics | Canonical chain defined and many controls documented; blanket forecast skill not established | Paired values across point/hub/sim, valid-time provenance, regional held-out validation; owner-gated numerical changes |
| Marine grids and timeline playback | Implemented with extensive controls; decimation bounds and cache identity failures reproduced offline, F07 | Preserve point coordinates after decimation; include served frame identity; current-head browser playback acceptance |
| Wind simulation and light/beach/dark rendering | Active development; #311 and owner's polling event pending | Wait for exact-run evidence, moving map on real basemap, all themes and target devices before a verdict |
| Admin console and analytics | Broad implementation, legacy/new surfaces coexist; finance has false-success paths | Define authoritative metrics and event provenance; distinguish dormant mock components from mounted dashboards |
| Data export and deletion | Partial: export references nonexistent booking model field and caps messages, F09 | Schema-correct complete export; define deletion across DB, media, provider records and app semantic memory |
| Themes, responsiveness and accessibility | Shared theme work exists; sampled loaders/modal hardcode dark surfaces | Audit all three themes, keyboard, focus, contrast, reduced motion and mobile journeys; no overall compliance claim |
| PWA/service worker and release delivery | Both frontend versions observable; production differs from dev | Release manifest showing frontend/backend/schema/flags; staged acceptance and explicit owner-controlled unfreeze |
| Observability, jobs and tests | Health telemetry, 20 scheduler jobs, CI and substantial test inventory exist | Current-head E2E recovery, data-health gates, provider receipts and a small complete journey suite; successful job != healthy output |
| Application personalization memory | Standalone semantic service exists; production app callers not established, F11 | Authenticated user boundary, embedding provenance, retention and feedback-to-recommendation links before claiming learning |
| Developer memory and lessons | Canonical git ledger passes integrity checks; 13 overdue commitments and stale parallel summaries | Evidence-based closure, fresh pointers, available-tool inventory and no secrets in memory; preserve pending work |

Source directories above are under `backend/` unless otherwise stated. Feature presence was checked against current routes, frontend routing and historical feature documentation; maturity labels deliberately do not inherit old “Live” or “Complete” badges.

## Confirmed findings, ordered by consequence

### F01 — Payment confirmation is not reliably tied to paid provider evidence — critical

Evidence: [booking checkout](../../backend/routes/bookings/stripe_checkout.py), especially creation around line 153 and confirmation around line 210; [MCP checkout helper](../../backend/stripe_mcp_server.py) around line 84; [live-session join](../../backend/routes/sessions/join.py) around line 172; [client confirmation](../../frontend/src/components/BookingPaymentSuccess.js).

The checkout helper generates simulated local sessions. The scheduled-booking success route has no authenticated-user dependency. Its emulation branch assumes payment success before attempting its local lookup and tolerates lookup failure. The other branch checks provider paid status but does not establish the complete booking/actor/amount/currency binding. A matching local transaction is optional before booking and escrow state are confirmed.

Offline control: the extracted confirmation function with a fake booking priced at 100, no transaction, a deliberately failing local lookup, and no provider call returned success, confirmed the booking, set escrow to 80, and committed once. An unpaid provider-style control returned HTTP 400 with no commit. This is local behavioral proof, not a live transaction or exploit.

Repair acceptance: only provider-verified, correctly bound, idempotent events can move money or confirm bookings; unpaid, mismatched, duplicate and out-of-order cases must leave state correct. Trace credits, escrow, participants and notifications from that single event.

### F02 — Sampled post mutations trust a supplied owner ID — high

Evidence: [post management](../../backend/routes/posts/management.py), settings/edit/delete around lines 23, 63 and 111; parent router assembly was checked. These handlers compare post ownership to a request-supplied user ID without binding it to authenticated identity.

Offline control: supplying the matching owner identifier changed settings and committed once; a different identifier returned HTTP 403 and did not commit. The control demonstrates an owner-ID comparison, not authentication.

The existing BOLA scanner reports 269 routes matching its missing-auth-marker heuristic, equal to its baseline, and therefore exits successfully. This is 269 review candidates, not 269 proven vulnerabilities. The heuristic misses some body-based identities and cannot prove correct ownership merely because an auth marker exists. Prioritize concrete route traces and negative cross-user controls.

### F03 — Admin payout and retry actions can announce success without payment execution — high

Evidence: [admin finance](../../backend/routes/admin/finance.py), payout batch around line 299 and retry around line 380. Admin authentication exists. The payout path marks the batch completed with recipients successful while the actual provider execution remains a future-work comment; retry uses a simulated success value.

This can mislead authorized operators about settlement. A request accepted by an admin screen is not a paid photographer or recovered invoice. Require provider references and reconciliation before a settled/success state; preserve pending or unsupported status otherwise.

### F04 — Sampled AI identification is metadata heuristics presented as vision — high

Evidence: [vision helpers](../../backend/routes/ai/ai_vision.py), [tagging routes](../../backend/routes/ai/ai_tagging.py), [classifier](../../backend/cloudinary_mcp_server.py), [lineup matching](../../backend/services/ai_lineup_match.py).

The inspected paths pass filename/description text into a keyword classifier and return confidence without reading image pixels. The lineup service's opening description claims vision, but its actual implementation imports the same classifier; participant attributes are inserted into the description and then matched against that description. That is circular evidence.

Offline controls: a blank filename produced zero people; an action-word filename produced a surfing result; invalid base64 still produced a person; two supplied candidate profiles received two high-confidence suggestions without image bytes being read. These conclusions are scoped to the inspected analysis/tagging/lineup paths, not every AI-related file.

Use a real image model with version and input provenance, calibrated thresholds, negative controls, consent/visibility boundaries and human confirmation before ownership or financial consequences. Metadata heuristics may assist search if honestly labeled.

### F05 — Several saved surf-alert preferences do not affect delivery — medium

Evidence: [alert schema and persistence](../../backend/routes/surf_data/alerts.py) around lines 67-125, [scheduler](../../backend/scheduler/surf_alerts.py), [delivery service](../../backend/services/surf_alert_delivery.py), [alert UI](../../frontend/src/components/alerts/SurfAlertModal.js).

Time windows, tide states and preferred conditions are stored but not consumed by the inspected match/delivery path. Email preference is stored, while the scheduler's delivery implementation is push-oriented. Height thresholds, active status, cooldown and an atomic notification claim are positive implemented controls. The service explicitly notes the missing producer contract and lack of a durable outbox.

Acceptance: vary each user-facing preference independently and demonstrate the intended change in eligibility/delivery, with local time and missing tide data covered. A successful save is not proof that a preference works.

### F06 — Gear credits are spent before partner fulfillment is established — high

Evidence: [gear hub](../../backend/routes/commerce/gear_hub.py) around line 200. The route subtracts credits, creates a purchase in a clicked state, and returns an affiliate URL for the user to finish elsewhere. No supplier receipt is required before the debit in this path; row locking and an idempotency key are not apparent here.

This is an incomplete fulfillment contract, not proof of a particular failed customer order. Define whether credits purchase a voucher, discount or physical item, then reserve and settle against that deliverable with concurrency and cancellation controls.

### F07 — Forecast sampling geometry and frame cache identity have separate defects — high

Evidence: [decimation](../../backend/services/weather_pipeline/series_vector_budget.py), `_decimate_frame` around line 253; [coarse key](../../frontend/src/components/map/marineEngineDecisions.js), `coarseBaseKey` around line 734; [engine reuse](../../frontend/src/components/map/WebGLMarineEngine.js), around lines 407-414.

Offline geometry probe: an 181-column by 83-row point grid spanning south -80 to north 84 at two-degree spacing, decimated by stride four, retains a last latitude of 80 but still advertises north 84. Client linear interpolation against unchanged bounds places the sampled equator at 2 degrees north. This is a synthetic control demonstrating coordinate drift, not a claim that every live grid shifts by two degrees.

Offline cache probe: two otherwise identical coarse frames with different run/served-valid timestamps produce the same key at the same hour offset; changing hour offset changes the key. The engine reuses a matching key. A stale on-screen frame was not reproduced in this audit. Include actual served frame identity, not only relative offset/dimensions/model, and coordinate with pending #264 rather than treating it as already merged.

### F08 — Internal broadcast has an unsafe missing-configuration default — conditional high

Evidence: [live WebSocket routes](../../backend/routes/live/websocket.py), internal-token initialization near line 17 and broadcast handler around line 535. The environment variable has a fixed source fallback and the endpoint does not fail closed simply because the environment variable is absent. No fallback value is reproduced here.

Deployment configuration was not inspected, so this is a conditional source risk, not a confirmed live exposure. Require `INTERNAL_BROADCAST_TOKEN` from the environment and fail closed if absent; retain room authorization and request limits. Do not store its value in memory.

### F09 — Data export has model drift and silent truncation — high

Evidence: [export handler](../../backend/routes/compliance_pkg/gdpr.py), booking filter around line 87 and message limit around line 104; [booking model](../../backend/models/bookings.py).

The export query references `Booking.surfer_id`; the current model defines `creator_id`, with no matching alias found. For an existing profile reaching this query, source predicts an attribute error. This was not invoked against live data. Sent messages are also capped at 500 without an export continuation mechanism in this handler.

Validate complete exports against the current relational model and an account with more than 500 messages. Map deletion to media, financial retention rules, app semantic memory and external processors explicitly. This is a technical completeness finding, not legal certification.

### F10 — Weather plan limits currently express frontend policy — decision needed

Evidence: [LayerAccessResolver](../../frontend/src/components/map/LayerAccessResolver.js) and [weather routes](../../backend/routes/weather.py). The frontend centrally controls horizon/model access; sampled weather data routes do not enforce the same authenticated subscription tier.

Clarify whether that is an intentional discovery/UX restriction or a commercial access guarantee. If the latter, enforce a shared policy at the server boundary while retaining one policy definition; do not create competing entitlement logic. No live bypass request was made.

### F11 — Application semantic memory lacks a demonstrated learning loop — medium

Evidence: [semantic memory MCP service](../../backend/semantic_memory_mcp_server.py), embedding around line 39 and retrieval around line 122. Retrieval filters by `user_id`, a useful partitioning control. It then loads candidate rows and ranks them in Python. Embeddings can silently fall back from an external model to a local hash vector without stored model/version/fallback provenance, making similarity incomparable across spaces.

The tool's user-ID parameter is not itself authenticated caller identity. Source search did not establish production application callers linking this service, the world-model MCP and recommendations into a user feedback loop. That does not rule out external MCP use. Do not call it live personalization or verified learning solely because the tools exist. Add consent/authentication, embedding-space identity, migration/reindex rules, deletion/retention and measured recommendation outcomes before expanding storage technology.

## Jacobian lens: which inputs actually move which outcomes?

Here “Jacobian” means a qualitative dependency and sensitivity map: for each intended output, ask which input can change it, which should not, and whether the expected path is missing. No numerical full-system derivative or model accuracy score is claimed.

| Input changed | Intended output | Observed sensitivity / defect | Acceptance control |
|---|---|---|---|
| Actual provider payment | Booking confirmation, escrow, paid participation | Simulated branch can confirm without provider evidence | Unpaid/mismatched/duplicate events cannot create paid state |
| Authenticated actor | Permission to edit another person's post | Sampled handlers depend instead on supplied owner ID | Same payload under another identity must fail |
| Image pixels | Detected surfer / matching confidence | No pixel path in inspected helpers; filename and candidate description dominate | Same metadata, different images; unrelated identities and blank images abstain |
| Alert time/tide/condition preferences | Alert eligibility | Missing dependency in inspected matcher | One-at-a-time preference perturbations change eligibility as specified |
| Partner fulfillment receipt | Settled gear credit debit | Debit occurs before receipt | Failed/abandoned handoff releases reservation |
| Forecast run and valid time | Displayed coarse frame | Key unchanged for changed timestamps at fixed offset | New valid frame invalidates/replaces old cache even at same offset |
| Decimation stride | Payload size only, same geographic samples | Coordinates drift when bounds still imply unsampled endpoint | Coordinate equality of every retained sample |
| Ingest success | Complete, coherent forecast product | Workflow green can coexist with data-health warning | Gate on reader-visible coverage, cycles and acknowledged storage |
| Memory write | Better future decision | Integrity passes despite stale claims and overdue checks | Fresh source-backed retrieval and linked closure evidence |
| Wind styling candidate | Legibility on moving real map | Current candidate outcome still pending | Exact-run scanner plus owner/device/app evidence, no premature verdict |

Highest fan-out dependencies are authenticated identity, payment/event identity, forecast time/model/geometry, and provenance. Fixing these boundaries improves many features at once. Adding features on top of ambiguous identity or false success multiplies the uncertainty.

## What needs linking

1. **Money:** checkout creation → provider receipt → verified event → ledger/escrow → participant entitlement → media/session access → payout/refund reconciliation. Reuse one authoritative state transition contract across scheduled and live sessions, galleries and subscriptions.
2. **Identity:** token → current actor → membership/ownership → route action → audit event. Trace router assembly and every mutation, not only the central helper.
3. **Weather truth:** stored product + model/run/valid time → geometry → point/sim/rating → client cache/frame → legend/label/alert. Share canonical composition and expose provenance where it changes a user's decision.
4. **Delivery:** persisted notification → durable outbox → provider attempt → device/email receipt or retry. Preserve deduplication and do not mark delivery merely because a row exists.
5. **AI/media:** uploaded image bytes → versioned inference → candidate score → human confirmation → claim/entitlement. Keep generated suggestions separate from verified ownership.
6. **Learning:** observation → reproducible evidence → decision/lesson → canonical state → next-session retrieval → measured result. App-user personalization is a separate data system with separate privacy boundaries.
7. **Release:** exact frontend SHA + backend SHA + schema + flags → exact-run tests → staged app acceptance → owner-approved production release. Current dev and frozen production must not share an undifferentiated “live” label.

## Memory and lessons review

The strongest memory is `docs/weather-program/`: append-only session logs and lessons, decisions, scoreboard, a hash-chained action ledger, and explicit verification requirements. The audit read its current state, relevant decisions and accumulated lessons, including the latest visual lessons: sample the whole ramp, check real backgrounds, preserve kill controls, and do not promote still-image preference into a moving-map verdict.

Fresh checks: `memory_audit.py --docs-only` returned **0 FAIL, 13 WARN, 13 NOTE**. Both ledger tamper self-test and memory-audit self-test passed after assigning a writable workspace temporary directory. The 13 warnings are overdue commitments **149, 217, 266, 282, 291, 298, 299, 309, 313, 318, 333, 860 and 957**. They were not closed by this audit. They span held-out skill, archived data recovery, fallback labels, independent guard checks, deployed readbacks and live acceptance. Close them only with corresponding evidence and `fulfills` linkage, or record an explicit decision that changes the obligation.

Memory gaps:

- `memory/FEATURE_REFERENCE.md` is an April 9 snapshot; `memory/PRD.md` and `memory/AUDIT.md` contain historical completion claims. They are navigation/history, not current certification.
- `.codebase-memory/adr.md` still opens with a 512 MB / scheduler-ingestion / proxy-centric architecture, contradicted by the current canonical ingest chain and live 2,048 MB limit. A dated pointer is safer than silently rewriting its history.
- Older deep-audit claims about the identity helper are stale: the present helper is strict. The confirmed defects here are actual callers. Never carry an old vulnerability forward without tracing the current code.
- `BRAIN_RULES.md` contains conflicting guidance: mock credential fallback, an independent world-model rating formula, assumed installed memory systems, and a direction to retrieve a tracing credential from episodic memory. These require explicit dated corrections aligned with `CLAUDE.md` and public-repository secret rules.
- Trevec/Mind/Memstate tools were not exposed in this session; Tree Ring skill guidance was read but no local Tree Ring CLI/store was available. No unsupported claim of semantic recall, write receipt, or cross-machine sync is made.
- The developer ledger is not the application's user memory. SQLite semantic rows and a list of MCP tools do not prove feedback reaches recommendations, or that deletion reaches those rows.

Memory updates accompanying this report add a session log, new lessons, a scoped STATE entry, dated historical pointers and BRAIN corrections. They preserve existing history and pending work. No scoreboard gain is claimed because no served number changed. Updates are local until reviewed and merged; concurrent branches must reconcile the ledger through its append-only protocol.

## Upgrade order and acceptance

| Priority | Work package | Done means |
|---|---|---|
| First: integrity | Payment confirmation, post ownership, admin settlement truth; inspect internal-token configuration | Negative and replay controls at mounted routes; no false paid/success state; authenticated authorization proven |
| Next: promised behavior | AI truthfulness, alert preferences, gear fulfillment, complete export | Every exposed control affects the promised result; failures and uncertainty visible; provider/record evidence retained |
| Next: weather acceptance | Data-health lane warnings, frame identity/geometry, exact-head E2E, #264/#311 evidence | Reader-visible coherent products, paired frame controls, real-app/device acceptance; owner's polling work resolved by its actual evidence |
| Then: architecture | Shared event contracts, durable outbox, typed API schemas, canonical entitlement policy | Fewer duplicate state machines; contract controls across producer and consumer; reliable replay/recovery |
| Then: scale and experience | Profile/spot query performance, workload isolation, theme/a11y coverage, framework modernization | Measurements justify each change; staged regression evidence on user journeys |
| Continuous: learning | Fresh pointers and evidence-linked obligations; measured app personalization | A future session can reproduce why a claim is true, and a user can control their retained data |

Two dependency upgrades merit a separate scoped proposal. The frontend still uses Create React App tooling; React officially deprecated CRA and provides migration guidance ([React announcement](https://react.dev/blog/2025/02/14/sunsetting-create-react-app)). Plan a build-tool migration only after establishing reliable journey tests. The backend pins `python-jose==3.3.0`; maintainer release 3.4.0 includes fixes for CVE-2024-33663 and CVE-2024-33664 ([maintainer release](https://github.com/mpdavis/python-jose/releases/tag/3.4.0)). The app's algorithm allowlist affects exploitability; the pin alone is not proof of an exploitable deployment. Resolve a supported patched dependency set and run auth controls before rollout.

No framework rewrite, new memory platform, provider purchase or deployment is required to accept this audit. The highest-value next work is to make existing feature promises provably true.
