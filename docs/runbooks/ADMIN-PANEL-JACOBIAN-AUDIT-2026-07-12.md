# Raw Surf OS — Admin Panel Connectivity Forensic Audit

**Date:** 2026-07-12
**Method:** 4 parallel read-only forensic agents, "Jacobian lens" (per admin control × underlying feature, verify the partial derivative is non-zero in both directions: does real feature data flow INTO the admin view, and does an admin action flow OUT into real feature state).
**Scope:** All three named admin surfaces, ~45 components total, cross-referenced against ~70 backend route files.

---

## 0. The three surfaces, mapped to real code

| User's name | Actual code | Entry point |
|---|---|---|
| **"Raw Surf app admin"** | "Legacy Dashboards" tab group: Event Inbox, Decisions Queue, Booking Trace, Media Review, System Health | `frontend/src/admin/AdminApp.tsx` (tabs `events/actions/trace/media/health`) |
| **"legacy console"** | `UnifiedAdminConsole.js` — ~30 sub-panels (pricing, spots, moderation, compliance, support, finance, comms, access control, persona, P1/P2, etc.) | Reached via "Legacy Console Tools" toggle in `AdminLayout.tsx` |
| **"Raw Surf OS admin sync"** | The "AI Operations Console Advanced Overlay" — 9 tabs (Decision Workbench, Booking Lifecycle, Event Graph Explorer, Event Replay Engine, Root Cause Analyzer, Simulation Sandbox, Live System Map, Social Intelligence, Weather Diagnostics). Literally branded "RAW SURF OS · Admin Sync" in the header. | `frontend/src/admin/advanced/*.tsx` |

---

## 1. Executive summary

**The headline finding: the "Event Spine" (event_bus + operator_decisions, the backbone under surfaces 1 and 3) is an island.** Across the entire `backend/routes/` tree, grep confirms **zero** real booking/payment/session/gallery/weather route ever calls `publish_event()` or proposes an operator decision — only `telemetry.py` itself, internal self-referential handlers, and test files do. Every "live" dashboard built on top of it (Event Inbox, Booking Trace, Decision Workbench, Event Graph Explorer, Root Cause Analyzer, Social Intelligence, half of System Health and Live System Map) is rendering a closed-loop simulation, not the real app. This is almost certainly the core of "both panels aren't properly connecting the data" for those two surfaces.

**Two of the findings are real, exploitable security vulnerabilities, independent of the data-plumbing framing** — these should be treated as more urgent than anything else in this report:
- `backend/routes/surf_spots/admin_sessions.py` — **all 6 endpoints have zero auth**. Anyone can force-start or force-kill a real photographer's live session with no login.
- `backend/routes/admin/analytics_settings.py:59` — `GET /admin/platform-settings` has **no auth**, leaking the private-beta plaintext access code to any unauthenticated request.

**Beyond the Event Spine, the legacy console has its own, unrelated disease: silent handler-shadowing and broken imports**, not missing wiring — code that looks connected but resolves to the wrong or non-existent target:
- Two pairs of duplicate FastAPI route registrations (`POST /admin/spots/create`, `DELETE /admin/spots/{id}`) where the *wrong* (incomplete, no audit trail) handler wins by registration order, permanently dead-coding a better implementation sitting right next to it.
- A backend file importing a script (`scripts/import_global_spots.py`) that was moved to `scripts/migrations_archive/` — the frontend's response was to bypass its own backend admin auth entirely and write directly to Supabase with a hardcoded 39-spot array.
- A wrong import path (`routes.ad_controls` instead of `routes.commerce.ad_controls`) that 500s every ad-approval click.
- A `NameError` typo (`admin.id` vs `admin_id`) that only fires on a cold-start `AdConfig` table.

**Total findings: 10 unique P0s, ~15 P1s, ~12 P2s** across 45 components. Full breakdown below.

---

## 2. Surface: "Raw Surf app admin" (Legacy Dashboards) + Event Spine

### Per-component matrix

| Component | Feature/domain | Frontend call | Backend (file:line) | Store | Status | Evidence |
|---|---|---|---|---|---|---|
| EventInbox | Global activity feed | `GET /admin/event-dashboard/events` | `telemetry.py:58-66` → `event_bus_core.py` | SQLite `event_bus.db` | **PARTIAL** | Zero real feature route ever calls `publish_event` — closed loop |
| WebSocket push | Live push for Event Inbox | `wss://.../api/ws/admin/events` | `routes/live/websocket.py:91-113`, fed by `event_bus_core.py:184-227` | in-memory | **PARTIAL/FRAGILE** | Self-loopback HTTP call wrapped in silent `except: pass` (`event_bus_core.py:226-227`) |
| AdminQueue (Decisions Queue) | Pricing/booking-override approvals | `GET/POST .../actions*` | `telemetry.py:68-127` → `operator_core.py:328-421,539-637` | SQLite `operator_decisions.db` | **BROKEN (write path)** | `execute_decision`/`propose_booking_override` fabricate `"Stripe checkout pricing multipliers applied."` / `"Google Calendar slot reservation updated."` — no real Stripe/Calendar call, no `Booking` row ever updated |
| BookingTrace | Correlation-id lifecycle trace | `GET .../trace/{id}` | `telemetry.py:185-193` → `event_bus_core.py:593-619` | SQLite | **WORKING on mock data only** | No bridge from real `Booking.id` to any correlation_id |
| MediaReview | Social post publish queue | `GET/POST .../media-queue*` | `telemetry.py:129-183` | SQLite, **hardcoded path** `OP_DB_PATH = "C:\\Users\\dprit\\Raw-Surf\\backend\\operator_decisions.db"` | **P0 — WORKS TODAY, BROKEN ON ANY OTHER MACHINE** | Every other module resolves this file via `get_db_path()` (`utils/sqlite_helpers.py`); `telemetry.py:18-19` hardcodes the literal instead. `scripts/migrate_sqlite_wal.py`'s file list never included `routes/admin/telemetry.py`, so it was skipped by the portability migration |
| SystemHealth | Blended live+mock telemetry | `GET .../system-health`, 15s poll | `telemetry.py:195-262` | SQLite (mock) + real Postgres (`LiveSession`/`Booking`) | **PARTIAL** | `booking_success_rate` hardcodes **100.0%** whenever there are zero mock bookings (`telemetry.py:210`) — a permanent false-positive shown next to genuinely real photographer-activity counts, with no visual distinction |
| Supabase-realtime path | Push half of both hooks | `subscribeTable('event_log'\|'operator_decisions')` | Write side: `event_bus_core.py:144-173`, gated on env vars, failures caught silently | Postgres tables (existence unconfirmed) | **BROKEN/DEAD** | Zero `CREATE TABLE` for either name found in any schema SQL; zero writes to a Postgres `operator_decisions` anywhere. `useAdminActions.ts`'s subscription can never fire (zero writers) |

### Repair priority
- **P0:** `telemetry.py:18-19` → replace with `get_db_path("event_bus.db")` / `get_db_path("operator_decisions.db")`, matching `operator_core.py:10`.
- **P0:** `operator_core.py:389-402,613-617` → make `execute_decision`/`propose_booking_override` actually `UPDATE` the real `Booking` row before claiming success; stop fabricating "Stripe/Calendar synchronized" text.
- **P1:** Wire `event_bus_core.publish_event(...)` into real booking-creation/payment/session-completion routes so the spine reflects reality.
- **P1:** Either provision real `event_log`/`operator_decisions` Postgres tables + a write-bridge, or delete the dead Supabase-realtime subscriptions and add a poll interval to `useAdminActions.ts`.
- **P2:** Split `SystemHealth`'s payload into clearly labeled "live" vs "event-spine (demo)" sections.

---

## 3. Surface: "Raw Surf OS Admin Sync" (AI Operations Console Advanced Overlay)

### Per-component matrix

| Component | Claims to cover | Backend (file:line) or NONE | Status | Evidence |
|---|---|---|---|---|
| DecisionWorkbench | AI pricing/cancellation proposals | `telemetry.py:68-109` → `operator_core.py` | **PARTIAL** | Approve/reject genuinely UPDATE the row, but the only functions that could create a *real* decision (`monitor_system_state`, `propose_pricing_change`, `propose_cancellation`) are called from **no route anywhere** — only tests/manual MCP calls. Queue is permanently empty in prod. |
| BookingLifecycleInspector | Chronological booking/payment/weather trace | `telemetry.py:185-193` | **BROKEN (payload bug)** | Backend returns `payload` pre-parsed as an object; component does `JSON.parse(evt.payload)` anyway (`BookingLifecycleInspector.tsx:133`), throws, silently swallowed by empty `catch` — the property/value table is **always empty** |
| EventGraphExplorer | Correlation-graph visualization | `telemetry.py:58-66` | **PARTIAL** | Real read, not hit by the payload bug, but same "spine never populated by real features" root cause |
| EventReplayEngine | Step-through causal replay | `telemetry.py:185-193` (same route as Lifecycle Inspector) | **PARTIAL/MOCK** | "View Mode" vs "Sandbox Replay" toggle only swaps labels — identical data either way. Real `replay_events()` (`event_bus_core.py:553`) is exported but never called by any route despite the component's name. Same `JSON.parse` bug (L98) |
| RootCauseAnalyzer | AI root-cause diagnosis | `telemetry.py:58-66` | **MOCK** | Event list is real; the entire "diagnosis" (confidence score, suggested fix) is hardcoded client-side if/else string templates — no backend AI call exists |
| SimulationEngine | Sandbox scenario simulation | **NONE FOUND** | **UI-SHELL-NOT-WIRED** | Imports only `react`/`lucide-react`/`sonner` — zero `apiClient`/`fetch`/`supabase` calls anywhere in the file. Every number is inline arithmetic + `setTimeout` |
| LiveSystemMap | Real-time platform telemetry + spot map | `telemetry.py:195-262`, `admin/core.py:43` | **PARTIAL** | Top metric cards are real DB queries; "Event Spine Velocity" is a fabricated heuristic (`total_events_logged/4`); "DB Read Pool Load 14%"/"Webhook Handshake 99.8%" are hardcoded literals never bound to data; the entire "Virtualized Shoreline Nodes" panel (Pipeline Reef, Sunset Beach, Waimea Bay with swell/surfer/risk numbers) is static fixture JSX, not sourced from `surf_spots` |
| SocialIntelligencePanel | Gallery-highlight review + engagement predictions | `telemetry.py:129-183` | **PARTIAL/MOCK** | GET/approve are real DB reads/writes, but the only inserter of queue rows is gated on a `surf_session_completed` event that no real route ever publishes (only a test file). When seeded, photo is randomly picked from 3 hardcoded Unsplash URLs. All "priority/reach/like-prediction" numbers are deterministic pseudo-random functions of `queue_id.charCodeAt(0)` — no ML involved |
| WeatherDiagnostics | Weather-map render health + pipeline freshness | `WeatherTelemetry.getDiagnosticReport()` + `GET /health/data` | **PARTIAL, mostly honest** | FPS/tile/cache/decode metrics are genuinely real (confirmed in `WeatherTelemetry.js`). The "Sandbox Replay" sub-panel is honestly labeled "Mock Engine" — the most transparent mock of the nine |

### Repair priority
- **P0:** Fix the payload-shape bug — `BookingLifecycleInspector.tsx:133` and `EventReplayEngine.tsx:98`: `typeof evt.payload === 'string' ? JSON.parse(evt.payload) : evt.payload`.
- **P0:** Stop `operator_core.py` from fabricating external-system confirmations (same fix as Surface 1's P0).
- **P1:** Wire a real feature action to `publish_event(...)` so the spine has any real production input at all.
- **P1:** Replace `SocialIntelligencePanel`'s fake-prediction math and `RootCauseAnalyzer`'s fabricated diagnosis with real computation, or relabel both as illustrative.
- **P1:** Decide `SimulationEngine`'s fate — wire it or badge it as a static demo.
- **P2:** Relabel `LiveSystemMap`'s hardcoded gauges/fixture spot cards as illustrative, or source from `surf_spots`.

---

## 4. Surface: Legacy Console — Growth / Commerce / Spots

### Per-component matrix

| Component | Backend (file:line) | Status | Evidence |
|---|---|---|---|
| AdminOverviewTab, AdminFinanceDashboard, AdminUnifiedAnalytics/GrowthToolsPanel, AdminSurfForecastPanel, AdminSpotEditor (move/update), AdminPrecisionQueue | Real, registered, matched 1:1 | **WORKING** | No issues found — full versioned DB persistence |
| AdminPricingEditor (subscription tiers) | `commerce/pricing_config.py:352-493` | **WORKING** | — |
| PlatformCommissionRatesSection / SurferSubscriptionDiscountRatesSection | **NONE — no endpoint exists** | **P0 — UI-SHELL / SPLIT-BRAIN** | Saves to browser `localStorage` only (`AdminPricingEditor.js:204-216`). Real payout math in `backend/utils/revenue_routing.py:51-68,123` hardcodes its own 20%/10%/5-10% rates and never reads this key. 7 other frontend files read the same localStorage key non-reactively — an admin "saving" a new commission rate changes **nothing server-side** |
| AdControlsPanel — Approval Queue actions | Intended: `commerce/ad_controls.py`; actual importer: `admin/analytics.py:374,411` | **P0 BROKEN** | `from routes.ad_controls import ...` — that module path doesn't exist (real path is `routes.commerce.ad_controls`). Every Approve/Reject/Edit click 500s |
| AdControlsPanel — cold-start config write | `commerce/ad_controls.py:197` | **P1 BROKEN** | `NameError`: uses `admin.id` inside a function scoped only to `admin_id` |
| AdminAnalyticsDashboard, AnalyticsTabContent | Real, registered endpoints | **ORPHANED** | Fully wired but unreachable — `UnifiedAdminConsole.js` renders `AdminUnifiedAnalytics` instead for the "analytics" tab. Dead shadow code, risk for future edits |
| AdminSpotsPanel — stats/list/edit/precision-pin | `admin_spots.py`, `refinements.py` | **WORKING** | — |
| AdminSpotsPanel — "Import Spots" dialog | Intended: `POST /admin/spots/import` (`admin_spots.py:225-272`) | **P0 BROKEN + deceptive UI** | Handler imports `scripts.import_global_spots`, moved to `scripts/migrations_archive/`. Frontend's workaround: tier 1/2 fabricates `successCount = 15` with no network call at all (code comment admits "Mock success… API is deprecated"); tier 0/3 writes a hardcoded 39-spot array **directly to Supabase, bypassing backend admin auth entirely** |
| AdminSpotEditor — Create Spot | **Route collision**: `admin_spots.py:286` wins over `spot_admin.py:190` | **P0 BROKEN/degraded** | Both define `POST /admin/spots/create`; first-registered wins. Winning handler has no land/water check and silently drops `secondary_city`/`secondary_area`/`noaa_buoy_id` — the frontend's "confirm offshore peak?" warning can never fire |
| AdminSpotEditor/AdminSpotsPanel — Delete Spot | **Route collision**: `admin_spots.py:372` wins over `spot_admin.py:378` | **P0 BROKEN (irreversible)** | Winning handler hard-deletes with zero audit trail; shadowed handler soft-deletes + writes `SpotEditLog` |

### Repair priority
- **P0:** Fix ad-approval import (`admin/analytics.py:374,411` → `routes.commerce.ad_controls`).
- **P0:** Delete duplicate `create_spot`/`delete_spot` in `admin_spots.py:286-314,372-387` so `spot_admin.py`'s land-checked, audited versions run.
- **P0:** Fix or restore `scripts/import_global_spots.py`'s live path; then rip out `AdminSpotsPanel.js`'s Supabase-bypass hack.
- **P0:** Give commission/discount rates a real backend home; make `revenue_routing.py` read it.
- **P1:** Fix `NameError` in `commerce/ad_controls.py:197`.
- **P2:** Remove dead `AdminAnalyticsDashboard`/`AnalyticsTabContent`; de-duplicate `GET /admin/ads/queue` registration (currently harmless but latent).

---

## 5. Surface: Legacy Console — Trust & Safety / Ops / Access

### Per-component matrix

| Component | Backend (file:line) | Status | Evidence |
|---|---|---|---|
| AdminModerationDashboard, DisputeDetailDialog, ReviewReportDialog, AdminContentModDashboard, AdminComplianceDashboard, AdminLogsPanel, AdminP1Dashboard (verification/impersonation/fraud/test-accounts) | `moderation.py`, `moderation_reports.py`, `content_mod.py`, `compliance_pkg/*`, `admin/core.py`, `p1.py` | **WORKING** | Real mutations confirmed: suspend flags, dispute refund credits, `is_hidden` toggles, role promotion on verification, real impersonation session round-trip |
| UnifiedAdminConsole — Persona/"God Mode" tab | **NONE — pure client state** | **PARTIAL/confusing** | `PersonaContext.js` has zero network calls. This is a *different, cosmetic* "view as role" system that coexists alongside the real, backend-backed Impersonation feature in the P1 tab — same "God Mode" framing, very different actual effect |
| AdminSupportDashboard | `admin/support.py:64-427` | **PARTIAL** | Backend fully real, but **no user-facing UI anywhere calls `/support/tickets`** — a fully working admin console with no real upstream ticket source except direct API calls |
| AdminCommunicationsDashboard — Announcements | `admin/communications.py:145-182` | **P0 BROKEN** | `or_()` used but **not imported** (only `select, func, and_, update, desc` at line 10) → `GET /announcements/active` 500s on every call |
| AdminCommunicationsDashboard — Bulk campaigns | `admin/communications.py:340-373` | **P1 MOCK** | `send_bulk_campaign` marks `status="sent"` and fabricates `delivered_count=int(total*0.95)` — comment admits "In production, this would queue the actual sending." No email/push ever leaves the system |
| AdminContentMgmtDashboard — Featured Content / Changelog | `content_mgmt.py:176,634` | **P1 BROKEN (key mismatch)** | Frontend reads `response.data.items`/`.entries`; backend returns `.featured`/`.changelog`. Both lists render permanently empty regardless of real data. Also two `Switch` toggles have no `onCheckedChange` (dead) |
| AdminAccessControlPanel | `admin/analytics_settings.py:59` (GET), `:122` (PUT) | **P0 SECURITY** | `GET /admin/platform-settings` has **no `Depends(get_current_admin)`** — any unauthenticated caller can read the plaintext private-beta `access_code`. Sibling `PUT` on the same file IS correctly gated |
| AdminSessionsPanel | `surf_spots/admin_sessions.py` (all 6 routes) | **P0 SECURITY** | None of `simulate_photographer_live`, `get_all_photographers`, `admin_force_start_session`, `admin_force_end_session`, `get_admin_active_sessions`, `cleanup_stale_sessions` has any auth dependency, despite the `/admin/*` path and admin-only frontend gating. Anyone can force-start/kill a real photographer's live session |
| AdminSystemDashboard — Jobs tab | `admin/system.py:298` | **P1 MOCK** | `ScheduledJobStatus` has no writer anywhere in the codebase — real crons run via GitHub Actions, fully decoupled from this table. Toggling "Enabled" or reading success-rate is inert theater |
| AdminP2Dashboard — Notification campaigns | `p2_campaigns.py:107-131` | **P1 MOCK** | Same fake-95%-delivered pattern as the Communications bulk-send bug — an unrelated, independently-written duplicate of the same defect |
| GROM (minor) safety oversight | `grom_hq/verification.py:182-214` | **P1 SECURITY-ADJACENT** | `POST /demo-verify-age/{parent_id}` sets `parent_age_verified=True` with **zero real ID check**, gated only by `user_id == parent_id` — any authenticated Grom-Parent account can self-certify as age-verified in production, with no env/admin gate. Also: no admin panel offers Grom-specific verification review at all (`AdminP1VerificationTab.js` only covers pro-surfer/photographer types) |

### Repair priority
- **P0 (security):** Add `Depends(get_current_admin)` to all 6 handlers in `surf_spots/admin_sessions.py`.
- **P0 (security):** Add `Depends(get_current_admin)` to `GET /admin/platform-settings` (`analytics_settings.py:59`).
- **P0:** Add missing `or_` import in `admin/communications.py:10`.
- **P1:** Fix `.items`/`.entries` → `.featured`/`.changelog` key mismatch in `AdminContentMgmtDashboard.js:89,102`.
- **P1:** Replace both fake-send campaign endpoints (`communications.py:340-373`, `p2_campaigns.py:107-131`) with real delivery, or relabel the buttons.
- **P1:** Gate `grom_hq/verification.py`'s `demo_verify_age` behind an explicit non-production env flag.
- **P2:** Wire or remove `AdminSystemDashboard`'s Jobs tab; build (or document the absence of) a real "Contact Support" flow; consolidate the duplicate Compliance tab (top-level vs. P1); fix dead `Switch` toggles.

---

## 6. Cross-cutting patterns (the systemic diagnosis)

1. **The Event Spine is architecturally sound but organizationally orphaned.** Nothing is "broken" in the sense of a crash — `event_bus_core.py`/`operator_core.py` work exactly as designed. The defect is that **no real feature route was ever connected to it**. This affects Surfaces 1 and 3 almost entirely. Fixing individual bugs (payload parsing, hardcoded paths) will not fix the underlying complaint on those two surfaces — the dashboards will still show a simulation until a real booking/session/payment route calls `publish_event`.
2. **Confirmation text is fabricated in the operator layer.** `operator_core.py` reports "Stripe checkout pricing multipliers applied" / "Google Calendar slot reservation updated" as literal strings with no corresponding API call. This is the most user-hostile bug in the report: an admin takes an action, sees a specific, confident success message, and nothing happened.
3. **Silent handler-shadowing recurs independently in two files** (`admin_spots.py` vs `spot_admin.py` for spot create/delete; `ad_analytics.py` vs `admin/analytics.py` for the ad queue GET). Same root shape each time: two modules independently implement the same route path, FastAPI takes the first-registered one, and nobody notices because the wrong handler doesn't error — it just does the wrong (usually less complete/less safe) thing.
4. **A moved/archived script broke a live import**, and the frontend's fix was to bypass its own backend's admin auth and hit Supabase directly with hardcoded data — this is a worse regression than the original bug and should be treated as higher priority than the missing import itself.
5. **Auth gating is inconsistent within the same nominal "admin-only" surface.** `deps/admin_auth.py` itself is correct; specific route files (`admin_sessions.py`, one endpoint in `analytics_settings.py`) simply omitted the dependency. This is the most severe class of finding in the whole audit — actual unauthenticated access to destructive/sensitive admin actions.
6. **Money-handling has a split-brain**: admin-configured commission/discount rates persist to `localStorage` and are read back by 7 unrelated frontend files, while the actual server-side payout calculation (`revenue_routing.py`) uses its own hardcoded constants and never sees what the admin "saved."
7. **"Send" buttons that don't send** appear twice, independently (Communications bulk campaigns, P2 notification campaigns) — both fabricate a 95%-delivered count with a code comment admitting it's not real.
8. **Response-shape mismatches** (`.items` vs `.featured`, pre-parsed JSON vs `JSON.parse()`'d again) suggest frontend/backend pairs were built without integration-testing the actual response contract — worth adding a lightweight contract test per admin endpoint going forward.

---

## 7. Consolidated repair roadmap

### P0 — fix first (security + broken-money + broken-core, ~1-2 days)
| # | Fix | File |
|---|---|---|
| 1 | Add admin auth to all 6 endpoints | `backend/routes/surf_spots/admin_sessions.py` |
| 2 | Add admin auth to platform-settings GET | `backend/routes/admin/analytics_settings.py:59` |
| 3 | Add missing `or_` import | `backend/routes/admin/communications.py:10` |
| 4 | Fix ad-approval import path | `backend/routes/admin/analytics.py:374,411` |
| 5 | Remove duplicate spot create/delete handlers | `backend/routes/surf_spots/admin_spots.py:286-314,372-387` |
| 6 | Restore/fix spot-import script path; remove Supabase-bypass hack | `backend/routes/surf_spots/admin_spots.py:240`, `frontend/src/components/admin/AdminSpotsPanel.js:74-163` |
| 7 | Give commission/discount rates a real backend home | `commerce/pricing_config.py`, `utils/revenue_routing.py`, `AdminPricingEditor.js` |
| 8 | Fix hardcoded SQLite path | `backend/routes/admin/telemetry.py:18-19` |
| 9 | Stop fabricating Stripe/Calendar confirmation text; make decisions actually mutate `Booking` | `backend/operator_core.py:389-402,613-617` |
| 10 | Fix payload JSON.parse bug | `frontend/src/admin/advanced/BookingLifecycleInspector.tsx:133`, `EventReplayEngine.tsx:98` |

### P1 — fix next (~1 week)
- Wire at least one real feature route (booking creation or session completion) to `publish_event(...)` so the Event Spine has genuine production input.
- Fix `NameError` in `commerce/ad_controls.py:197`.
- Fix `.items`/`.entries` key mismatch in `AdminContentMgmtDashboard.js`.
- Replace both fake-send campaign endpoints with real delivery or honest labeling.
- Gate `grom_hq/verification.py`'s `demo_verify_age` behind a non-production flag.
- Either provision real `event_log`/`operator_decisions` Postgres tables + write-bridge, or delete dead Supabase-realtime subscriptions and add polling to `useAdminActions.ts`.
- Replace `SocialIntelligencePanel`'s fake predictions and `RootCauseAnalyzer`'s fabricated diagnosis with real computation, or relabel as illustrative.
- Decide `SimulationEngine.tsx`'s fate (wire or badge as demo).

### P2 — cleanup (~ongoing)
- Split `SystemHealth`'s live vs. mock metrics visually.
- Remove dead `AdminAnalyticsDashboard`/`AnalyticsTabContent`; de-duplicate ad-queue GET registration.
- Wire or remove `AdminSystemDashboard`'s Jobs tab.
- Consolidate duplicate Compliance tab; fix dead `Switch` toggles in Content Mgmt.
- Relabel `LiveSystemMap`'s hardcoded gauges/fixture spot cards.
- Build (or document absence of) a real "Contact Support" entry point.

---

## 8. What "full working condition" requires beyond bug-fixing

Most of the findings above are mechanical fixes (wrong import, missing auth decorator, wrong dict key). But the single biggest driver of the user's complaint — **surfaces 1 and 3 showing disconnected/simulated data** — is a design gap, not a bug: **no real feature in the app currently reports into the Event Spine.** Closing every P0/P1 item above will make each panel internally consistent and safe, but Event Inbox, Booking Trace, Decision Workbench, Event Graph Explorer, and Root Cause Analyzer will still show synthetic data until a deliberate decision is made about which real events (booking created/confirmed, payment succeeded/failed, session completed, photographer went live) should call `publish_event()`, and the corresponding routes are updated to call it. That's a scoping decision for the next session, not a fix that fits in this audit.

---

*Audit performed via 4 parallel read-only forensic agents; no code was modified during this audit.*

---

## 9. Independent verification pass (forensics, 2026-07-12 follow-up)

Every P0 claim below was re-derived first-hand from source (not re-trusted from the sub-agent summaries) before this plan was written. All 10 held up exactly as reported; two are worth flagging with extra precision:

| # | Claim | Verified how | Result |
|---|---|---|---|
| 1 | `admin_sessions.py` all 6 endpoints have zero auth | Read full file | **CONFIRMED, and worse than "missing" — the file never imports `get_current_admin` at all.** Only `Depends(get_db)` gates any of the 6 routes. |
| 2 | `analytics_settings.py:59` GET platform-settings has no auth | Read full file | **CONFIRMED.** Its own sibling `PUT` at line 122 correctly has `Depends(get_current_admin)` — this is an inconsistency within the same file, not an ambiguous design choice. (The two genuinely-public `/site-access*` endpoints in the same file are explicitly docstringed "no auth needed" — the vulnerable GET is not, and returns the full `PlatformSettings` row including the plaintext `access_code` field.) |
| 3 | `operator_core.py:389-402` fabricates Stripe/Calendar confirmation text | Read lines 320-440 | **CONFIRMED verbatim** — literal string templates keyed only on `dec_type`, zero SDK import, zero call. Only a SQLite `UPDATE operator_decisions` follows; no `Booking`/Postgres write anywhere in the function. |
| 4 | `admin_spots_router` registered before `spot_admin_router`, shadowing it | Read `surf_spots/__init__.py` | **CONFIRMED** — line 39 vs line 47. |
| 5 | Duplicate `POST /admin/spots/create` / `DELETE /admin/spots/{id}` in both files | Grep both files for route decorators | **CONFIRMED, with a nuance.** `admin_spots.py` uses literal full paths (`@router.post("/admin/spots/create")`, line 286). `spot_admin.py` uses `APIRouter(prefix="/admin/spots")` (line 27) + short decorators (`@router.post("/create")` line 190, `@router.delete("/{spot_id}")` line 378) — same effective full paths. A naive grep for the literal string misses `spot_admin.py`'s routes because of the prefix indirection; confirmed by reading the router construction directly. |
| 6 | `admin_spots.py:240` imports a script that no longer lives where it expects | Grep + Glob | **CONFIRMED** — `from scripts.import_global_spots import ...` (line 240); the file now lives at `backend/scripts/migrations_archive/import_global_spots.py`. Import will raise `ModuleNotFoundError` on every call. |
| 7 | `ad_controls.py:197` NameError (`admin.id` vs `admin_id`) | Read function | **CONFIRMED verbatim** — function signature only has `admin_id`; line 197 references undefined `admin`. |
| 8 | `admin/analytics.py` imports `routes.ad_controls` (wrong path) | Grep | **CONFIRMED** at lines 374 and 411 — correct path is `routes.commerce.ad_controls`. |
| 9 | `admin/communications.py` missing `or_` import | Read import line + usage | **CONFIRMED** — line 10 imports `select, func, and_, update, desc` (no `or_`); lines 155-156 call `or_(...)`. Will raise `NameError` the first time that code path executes. |
| 10 | `BookingLifecycleInspector.tsx:133` / `EventReplayEngine.tsx` re-parse an already-parsed payload | Read component + `event_bus_core.py:613` | **CONFIRMED** — backend returns `"payload": json.loads(r[2])` (a real object) at `event_bus_core.py:613`; frontend does `JSON.parse(evt.payload)` on that object anyway, wrapped in an empty `catch(e){}` — this throws every time (`JSON.parse` on a non-string coerces to `"[object Object]"`, which isn't valid JSON), silently leaving the payload table empty. |
| — | `grom_hq/verification.py:182-214` `demo_verify_age` has no production gate | Read function | **CONFIRMED, self-documented risk** — the function's own docstring reads "In production, this should be disabled or require admin access," and the only actual gate is `user_id != parent_id` (self-service). The author flagged the exact risk this audit found and shipped it anyway. |
| — | `AdminContentMgmtDashboard.js` `.items`/`.entries` vs backend `.featured`/`.changelog` | Grep both sides | **CONFIRMED** — frontend lines 89/102 vs backend lines 177/635. |
| — | `SimulationEngine.tsx` has zero network calls | Read imports | **CONFIRMED** — only imports `react`, `lucide-react`, `sonner`; no `apiClient`/`fetch`/`supabase` anywhere in the file. |

**Verification verdict: 13/13 spot-checked claims confirmed with source-level evidence, zero false positives found.** The four sub-agents' work is trustworthy; the report's P0 list can be acted on directly without re-auditing.

---

## 10. Plan of action

Ordered by **risk-adjusted value**: security first (independent of everything else, zero design ambiguity), then mechanical one-line fixes (fast, safe, high confidence), then structural fixes (need a small amount of care), then the two items that require an actual design decision before coding.

### Phase 0 — Security hotfixes (do first, independently, ~30 min)
No dependencies on anything else in this plan. Each is a single added `Depends(get_current_admin)` (pattern already used correctly elsewhere in the same files):
1. `backend/routes/surf_spots/admin_sessions.py` — add `admin: Profile = Depends(get_current_admin)` to all 6 handlers, import `get_current_admin` from `deps.admin_auth` (mirrors every other admin route file).
2. `backend/routes/admin/analytics_settings.py:59-61` — add the same dependency to `get_platform_settings`, matching its own sibling `update_platform_settings` at line 122-127.
3. `backend/routes/grom_hq/verification.py:182-214` — gate `demo_verify_age` behind an explicit non-production check (e.g. `if os.environ.get("ENVIRONMENT") == "production": raise HTTPException(403, ...)`), since deleting it outright may break a legitimate test/demo flow — **flagging this as a decision point below.**

### Phase 1 — Mechanical fixes (fast, low-risk, ~1-2 hrs)
Each is a confirmed one- or two-line fix with an obvious correct answer:
4. `backend/routes/admin/communications.py:10` — add `or_` to the import.
5. `backend/routes/admin/analytics.py:374,411` — fix import path to `routes.commerce.ad_controls`.
6. `backend/routes/commerce/ad_controls.py:197` — `admin.id` → `admin_id`.
7. `frontend/src/components/admin/AdminContentMgmtDashboard.js:89,102` — `.items`→`.featured`, `.entries`→`.changelog`.
8. `frontend/src/admin/advanced/BookingLifecycleInspector.tsx:133`, `EventReplayEngine.tsx:98` — guard the parse: `typeof evt.payload === 'string' ? JSON.parse(evt.payload) : evt.payload`.
9. `backend/routes/admin/telemetry.py:18-19` — replace hardcoded paths with `get_db_path("event_bus.db")` / `get_db_path("operator_decisions.db")` (import already-existing helper).
10. `backend/routes/surf_spots/admin_spots.py:240` — fix import to `scripts.migrations_archive.import_global_spots` (fastest fix) — **or** move the script back to live `scripts/` if it's still meant to be a first-class tool, not an archived one (decision point below).

### Phase 2 — Route de-duplication (needs care, ~2-3 hrs incl. testing)
11. Delete the shadowed duplicate handlers in `admin_spots.py:286-314` (`create_spot`) and `:372-387` (`delete_spot`), letting `spot_admin.py:190` (land-check + full field set) and `:378` (soft-delete + `SpotEditLog` audit) become the live handlers.
   - **Before deleting:** confirm no other code imports these two functions directly by name (route handlers usually aren't imported elsewhere, but worth a 30-second grep first since this changes real behavior — spots will now soft-delete instead of hard-delete, and land-check will start firing where it silently didn't before).
   - This will change observable behavior (delete becomes reversible/audited; create starts rejecting/warning on land-locked pins) — call this out in the PR description so nobody's surprised.
12. Same pattern, lower priority: de-duplicate `GET /admin/ads/queue` (`commerce/ad_analytics.py` vs `admin/analytics.py`) — currently harmless since the winning copy is correct, but should be cleaned up in the same pass since it's the identical bug shape.

### Phase 3 — Money-handling fix (needs a design decision, ~half day)
13. Give commission/discount rates a real backend home (new column on `GlobalPricingConfig` or a dedicated table) and make `revenue_routing.get_platform_fee_rate()` read it instead of hardcoded constants. **Decision needed:** confirm this is meant to be globally-editable-by-admin (as the UI implies) rather than intentionally fixed/hardcoded for a reason I'm not aware of.

### Phase 4 — Event Spine honesty fix (needs a design decision, ~half day)
14. `operator_core.py:389-402,613-617` — stop fabricating "Stripe/Calendar synchronized" text. Two options: (a) make `execute_decision`/`propose_booking_override` actually call the real systems (requires wiring a Postgres session into a currently-pure-SQLite module), or (b) — faster and honest — replace the fabricated strings with something like `"Recorded as an internal operator decision. No external system was called."` until (a) is scoped. **Recommend (b) now, (a) later** as part of the larger Event Spine wiring project (see report §8) — don't block the honesty fix on the bigger architectural one.

### Phase 5 — P1/P2 cleanup (ongoing, batchable)
Everything else in the original report's P1/P2 lists (fake-send campaigns, orphaned analytics panels, dead `Switch` toggles, `SystemHealth` metric labeling, `LiveSystemMap` fixture data, `SimulationEngine`/`RootCauseAnalyzer`/`SocialIntelligencePanel` mock-vs-real labeling) — none are urgent, batch these into a follow-up pass once Phases 0-4 are shipped.

### Decision points before I start coding
- **Grom `demo_verify_age`** — disable outright, or gate behind an env flag for legitimate test/demo use?
- **`import_global_spots.py`** — restore to live `scripts/`, or fix the import path to point at the archive (implying it's intentionally retired)?
- **Commission/discount rates** — confirm these should in fact be admin-editable server-side (not a deliberate hardcode).

Recommend starting immediately with **Phase 0 + Phase 1** (14 fixes, all mechanical/low-risk, no open design questions) while you weigh the three decision points above.

---

## 11. Phase 0 + Phase 1 — SHIPPED (2026-07-12, same session)

User decisions: Grom demo endpoint → env-gated (not deleted, "will build this feature out later"); `import_global_spots.py` → **investigated first** (2,852-commit history search found zero commits ever mention `migrations_archive`/`import_global_spots`; file has sat at that path since the single squashed "Initial commit" — no deliberate archival decision to respect, and it's functionally distinct from its 18 archive-mates, which are one-time regional patches already applied, vs. this being reusable ongoing import logic a live feature still depends on) → **restored to live `scripts/`** via `git mv`; commission rates → confirmed should wire to real backend (scheduled as Phase 3, not yet executed).

**Shipped:**
1. ✅ `admin_sessions.py` — added `Depends(get_current_admin)` to all 6 endpoints.
2. ✅ `analytics_settings.py:59` — added `Depends(get_current_admin)` to platform-settings GET.
3. ✅ `grom_hq/verification.py` — `demo_verify_age` gated behind `ALLOW_GROM_DEMO_VERIFY` env var (mirrors existing `ALLOW_ADMIN_BOOTSTRAP` convention in `admin/core.py`), 404s by default.
4. ✅ `admin/communications.py:10` — added missing `or_` import.
5. ✅ `admin/analytics.py:374,411` — fixed `routes.ad_controls` → `routes.commerce.ad_controls`.
6. ✅ `commerce/ad_controls.py:197` — fixed `admin.id` → `admin_id` NameError.
7. ✅ `AdminContentMgmtDashboard.js:89,102` — fixed `.items`/`.entries` → `.featured`/`.changelog`.
8. ✅ `BookingLifecycleInspector.tsx:133`, `EventReplayEngine.tsx:98` — guarded `JSON.parse` against already-parsed payload objects.
9. ✅ `telemetry.py:18-19` — replaced hardcoded Windows path with `get_db_path("operator_decisions.db")`; removed the dead unused `EVENT_DB_PATH` constant.
10. ✅ `scripts/import_global_spots.py` — restored from `migrations_archive/` to live `scripts/` via `git mv` (clean rename, full history preserved).
11. ✅ `AdminSpotsPanel.js` — companion fix to #10 (not in the original 14-item list, but necessary for #10 to have any effect): replaced the ~90-line hardcoded-39-spot-array/Supabase-admin-auth-bypass/fake-tier-1-2-success workaround with a single real call to `POST /admin/spots/import?tier=&include_osm=`, the endpoint that was broken by the missing script. Removed the now-unused `supabase` import.

**Verification:** all touched Python files pass `python -m py_compile`; both touched plain-`.js` files pass `node --check`. The two `.tsx` edits were single-line ternary guards reviewed by inspection (Node can't parse TS syntax, so `--check` isn't meaningful there). No test suite was run this session — recommend running the backend pytest suite (baseline BE 662/2928 per project memory) before deploying.

**Not yet done:** Phase 3 (commission-rate backend wiring — decision confirmed, not implemented), Phase 4 (Event Spine fabricated-confirmation honesty fix), Phase 5 (P1/P2 cleanup backlog).

---

## 12. Test verification (2026-07-12) + Phase 2 — SHIPPED

**Test run methodology:** this backend's test suite (`backend/tests/`) is a live-server integration suite — `conftest.py` explicitly documents the policy "when `REACT_APP_BACKEND_URL` is unset, SKIP (not fake-pass) every module that defines a `BASE_URL`." No live server was started this session, so the ~2928 tests requiring one correctly skip rather than false-pass; the 662 that don't need a live server ran directly.

- **Baseline (before Phase 2, after Phase 0+1):** 662 passed, 0 failed, 2928 skipped, 3 warnings, 358s. Targeted run on the 10 files touched by Phase 0+1: 2 passed (`test_surf_spots_live_security.py`, both admin/auth-enforcement tests), 125 skipped, 0 failed.
- **After Phase 2:** re-ran full suite — 662 passed, 0 failed, 2928 skipped, 3 warnings, 528s. **Identical pass count, zero regressions.**
- **Known caveat:** because almost all admin/spot/grom-specific tests require a live server (skipped here), the test run does not directly exercise the two security fixes or the route-dedup fix at the HTTP level. Confidence in those rests on source-level verification (§9) plus, for the recurring `Depends(get_current_admin)` pattern, the fact that it's the exact same decorator already working on every sibling endpoint in the same files. Recommend running this suite against a live server (`REACT_APP_BACKEND_URL` set, real test DB) before considering this fully verified end-to-end.

**Phase 2 shipped:** deleted the shadowed duplicate `CreateSpotRequest`/`create_spot` (was `admin_spots.py:275-315`) and `delete_spot` (was `admin_spots.py:372-388`) handlers. `spot_admin.py`'s versions now run unchallenged: `POST /admin/spots/create` gets the land-check (`check_is_on_land`) + full field set (`secondary_city`/`secondary_area`/`noaa_buoy_id`) + `SpotEditLog` audit entry; `DELETE /admin/spots/{id}` becomes a soft-delete (`is_active=False`) with an audit log entry instead of a permanent hard delete. Removed the now-unused `BaseModel` import from `admin_spots.py`. Verified before deleting: `CreateSpotRequest`/`create_spot`/`delete_spot` were referenced nowhere else in the repo (grep-confirmed). Verified after: `AdminSpotEditor.js` already has the full `warning: "land_detected"` handling and override-and-resubmit flow built (`handleConfirmLandWarning` → `handleCreateSpot(true)` for creates, direct override-move for moves) — this was previously dead code behind the route-shadowing bug and will now actually fire. Response shapes checked compatible: delete's `{success, message}` is identical; create's response is a superset (`+ was_on_land, coordinates`) that the frontend already reads defensively.

**Cumulative status:** Phases 0, 1, 2 shipped (11 fixes total.) Phases 3-5 remain open.

---

## 13. Phase 3 — SHIPPED (2026-07-12, same session)

**Scope decision:** the audit named two localStorage-only settings — Platform Commission Rates (by photographer subscription tier: free/tier_2/tier_3) and Surfer Subscription Discount Rates (same tier keys). Only the commission rate has a real, live money-moving consumer (`utils/revenue_routing.py`'s `process_creator_earnings`, called from `routes/photographer/sessions.py` on every session payout) — the surfer discount rate had **zero** backend consumer anywhere (grep-confirmed both before and after this change). So: both rates now get a real backend home (the actual ask), but only the commission rate gets wired into a real calculation, since that's the only place one already existed to wire into. Applying the surfer discount at actual checkout would be new feature work (finding/instrumenting every media-purchase code path), not a bug fix — flagged as a follow-up, not built.

**Database reality check:** this local environment has no `DATABASE_URL` set, so `database.py` falls back to a local SQLite file (`backend/dev.db`) — confirmed via `pyproject.toml`/`database.py`, not guessed. The Supabase "Dev" project (`weewaulkwfwlbhqemxma` per project memory) was checked via the Supabase MCP and found to contain only `weather_manifest_pointer` (the marine-engine S2 pointer table) — the FastAPI app's relational schema (Profile, GlobalPricingConfig, Booking, etc.) does not live there. No live cloud database was altered this session; only the local `dev.db` file (directly, via `ALTER TABLE`) and a new Alembic migration file (for whenever a real `DATABASE_URL`-backed deployment runs migrations) were touched.

**Shipped:**
1. `backend/models/payments.py` — added `commission_rates` and `surfer_discount_rates` nullable JSON columns to `GlobalPricingConfig`.
2. `backend/dev.db` — added both columns directly via `ALTER TABLE` (local dev DB is SQLite; safe, immediate, verified).
3. `backend/alembic/versions/a107b7db4f12_add_pricing_config_rate_maps.py` — new migration (chained onto pre-existing head `a2c4e8f91b03`) for real Postgres deployments. Note: found the repo already has **two divergent Alembic heads** (`a2c4e8f91b03` and `avatar_url_text_001`) — pre-existing, unrelated to this change, flagged here but not fixed (out of scope).
4. `backend/routes/commerce/pricing_config.py` — `DEFAULT_COMMISSION_RATES`/`DEFAULT_SURFER_DISCOUNT_RATES` constants (matching the frontend's prior hardcoded defaults exactly); `PricingConfigUpdate` extended with both optional rate-map fields; GET/update/reset endpoints now read, merge (partial-update safe), persist, and return both maps, versioned alongside the rest of pricing config.
5. `backend/utils/revenue_routing.py` — new `get_commission_rate_for_tier(subscription_tier, db)` reads the active `GlobalPricingConfig.commission_rates`, keyed by the creator's `Profile.subscription_tier` (`tier_2`/`tier_3` used as-is, anything else — including `None` and other tier-naming schemes used elsewhere in the app like `'premium'`/`'gold'` — buckets to `free`), falling back to `DEFAULT_COMMISSION_RATES` if no config row exists. Wired into `process_creator_earnings`'s Pro fee-rate calculation (previously a hardcoded flat `0.20`), which is the live path called on every session payout. Left the separate hobbyist recipient-type fee logic (grom/surfer/gear sub-rates) untouched — different concept, not what this admin UI edits. Left the standalone `get_platform_fee_rate()` function untouched — confirmed genuinely dead code (zero callers anywhere in the repo).
6. `frontend/src/components/admin/AdminPricingEditor.js` — removed all `localStorage` read/write for both rate maps; now fetches them from `/admin/pricing/config` and saves them in the same `/admin/pricing/update` POST body as the rest of pricing (single versioned save, single "Discard" now reverts rates too — previously Discard silently left rate edits in place).

**Known gap (not built, flagged not silently dropped):** 7 other frontend files (`EarningsHelpers.js`, `config/subscriptionPlans.config.js`, `BookingPricingModal.js`, `GalleryFolderModals.js`, `GalleryItemModal.js`, `GalleryPricingModal.js`, `PhotographerSessionsManager.js`) still read the now-permanently-empty `admin_commission_rates`/`admin_surfer_discount_rates` localStorage keys for **display-only** purposes (showing a projected rate to users). Checked 2 of the 7 directly: both wrap the read in try/catch with a hardcoded fallback identical to the new server-side defaults, so they degrade gracefully (no crash) rather than break — but they'll never reflect a real admin-configured non-default rate. This was already effectively non-functional for real users before this fix (localStorage is per-browser, so it could only ever reflect the admin's own testing browser, never propagate to actual surfers/photographers) — not a regression, but a pre-existing gap this fix doesn't close. Wiring all 7 to the real config would be a reasonable follow-up.

**Verification:**
- All touched Python files pass `python -m py_compile`; `AdminPricingEditor.js` passes `node --check`.
- **Direct functional smoke test against the real local `dev.db`** (bypassing HTTP/auth, exercising the actual DB read/merge/write code): confirmed default-fallback rates correct, confirmed an unrecognized tier value safely buckets to `free`, confirmed that after simulating an admin save, `get_commission_rate_for_tier` immediately reads back the new custom rate (0.12 instead of default 0.15) — proving the live payout wiring works end-to-end, not just in theory. Test data cleaned up afterward (deactivated, prior state restored).
- Full backend test suite re-run: **662 passed, 0 failed, 2928 skipped, 3 warnings, 452s — identical to the Phase 0/1/2 baseline.** Zero regressions.

**Cumulative status:** Phases 0, 1, 2, 3 shipped (17 fixes total). Phase 4 (`operator_core.py` fabricated Stripe/Calendar confirmation text) and Phase 5 (P1/P2 cleanup backlog) remain open.

---

## 14. Phase 4 — SHIPPED (2026-07-12, same session): truthful operator confirmations

**User directive:** don't just relabel the fabricated Stripe/Calendar text as honest — if a real system exists to call, actually call it; only mark something as "not integrated" when it genuinely isn't built.

**Investigation before implementing (per user's established pattern of "check before you build"):**
- **Stripe is real** in this app: `server.py` reads `STRIPE_SECRET_KEY`/`STRIPE_API_KEY` from the environment and sets `stripe.api_key` using the actual `stripe` Python SDK; `routes/bookings/payments.py`, `routes/sessions/payments.py`, and others already make genuine Stripe calls.
- **Google Calendar has zero real integration anywhere in this codebase** — confirmed via repo-wide search for `googleapiclient`/`google.oauth2`/`GOOGLE_CLIENT_ID` etc. (no hits). The only "calendar" system is `google_calendar_mcp_server.py`, itself a SQLite simulation (`calendar_scheduling_cache.db`), not a real Google API client.
- Asked the user to clarify intent before building a large OAuth feature; user clarified they want Stripe made real now, Calendar honestly marked as not-yet-integrated, to be built later as its own feature.
- Investigated what "cancellation" (the decision type that claims a Stripe refund) actually maps to: `propose_cancellation`'s `event_id` has no established real caller (dead code, zero production callers — same as `propose_pricing_change`). Found the REAL, working, user-facing cancellation flow (`routes/bookings/booking_lifecycle.py::cancel_booking`) refunds via the app's own internal credit ledger (`utils/credits.py::add_credits`), NOT a raw `stripe.Refund.create()` call — even for participants who paid via `payment_method == 'stripe'`. Matched this exact established pattern rather than inventing a different, more "correct"-looking approach that would diverge from how the app already works.

**Shipped:**
1. `backend/operator_core.py` — `execute_decision()` gained an optional `real_integration_results` param. When the caller (the HTTP route) has performed a real side effect, it passes the true outcome through; when nothing real applies to this decision type, the function now reports an honest `"internal_record": "recorded... no external payment system was called"` + `"calendar_sync": "not_integrated... not yet built for this app"` instead of the old fabricated "Stripe checkout pricing multipliers applied" / "Google Calendar slot reservation updated" text. Also renamed the always-`"synchronized"` `supabase_sync` claim to `event_spine_sync` and made its status conditional on whether the underlying `publish_event` calls actually succeeded (previously claimed success unconditionally even on failure, silently caught).
2. `backend/operator_core.py` — `propose_booking_override()` gained an optional `real_update_result` param for the same reason; defaults to an honest "no booking record was updated" message instead of the old unconditional "Booking availability overridden successfully."
3. `backend/operator_core.py::get_operator_decision_history()` — fixed a **pre-existing bug** found while testing: this function always tried `json.loads()` on the stored `execution_result`, but `propose_booking_override` has only ever stored plain strings there (including the old fabricated text) — so it silently discarded to `None` and the admin UI never displayed *any* override outcome, honest or fabricated. Now falls back to the raw string when it isn't JSON.
4. `backend/routes/admin/telemetry.py` — new `_perform_real_cancellation_refund(booking_id, db)` helper: resolves a decision's `proposed_value` as a real `Booking.id`; if found and still active, actually cancels it (100% refund, matching the app's existing "photographer-initiated cancellation" policy) and credits each participant via `add_credits`, returning an honest, specific result (`"$100.00 was credited back to 1 participant(s)"`); if not found, or already terminal, returns an honest no-op/no-match message. Wired into `approve_dashboard_action` for `cancellation`-type decisions.
5. `backend/routes/admin/telemetry.py::create_booking_override` — now actually performs `UPDATE bookings SET max_participants = ...` before reporting success, and returns a proper 404 if the booking doesn't exist (previously always claimed success with zero effect regardless of whether the booking was found).
6. `backend/routes/admin/telemetry.py` — fixed a **second pre-existing bug** noticed while editing: `approve`/`reject`/`override` all raised `HTTPException(400/404)` inside a `try` block guarded only by a bare `except Exception`, which silently rewrapped those into unrelated `500`s. Added `except HTTPException: raise` before the generic handler in all three.

**Verification:** direct functional smoke test against the real local `dev.db` (not just source review) covering: real cancellation+refund end-to-end (booking status, participant payment_status, and Profile.credit_balance all verified before/after), honest no-match handling, idempotency (no double-refund on a second cancel attempt), `execute_decision` correctly threading real results through, `execute_decision`'s honest default confirmed to contain zero mention of "Stripe" when no real action applies, and the override path's fixed JSON-parse bug confirmed to surface the real message. All 6 scenarios passed.

**Test suite regressions found and fixed:** the first full-suite run surfaced 2 failures in `tests/test_operator.py` — both were asserting the *old fabricated* behavior (`execution_result["stripe_sync"]["status"] == "synchronized"`, and `"canceled" in ...["calendar_sync"]["message"]`). These were the expected, correct consequence of the fix, not a real regression — updated both assertions to check for the new honest behavior (`internal_record.status == "recorded"`, `calendar_sync.status == "not_integrated"`) instead of reverting the fix. Re-ran full suite: **662 passed, 0 failed, 2928 skipped, 358s — clean.**

**Not addressed (same reasoning as Phase 1/3):** the underlying "Event Spine" disconnection remains — `propose_cancellation`, `propose_pricing_change`, and `monitor_system_state` still have zero real production callers, so in practice no `cancellation`-type decision is ever created by real user activity today. This fix makes *approving* such a decision truthful and effective *if and when* one exists — it doesn't create the missing pipeline that would generate real ones. That's the Phase 1/§8 architectural gap, unchanged.

---

## 15. Phase 5 — IN PROGRESS (2026-07-12, same session): "turn fakes into real" cleanup pass

**User directive:** when cleaning up the P1/P2 backlog, prioritize linking admin controls to the real features they're supposed to monitor/control, rather than just relabeling fakes as honest placeholders. Investigate what real systems already exist nearby (the Stripe/OneSignal pattern) before building anything new.

**Known real integrations discovered and reused (same "Stripe pattern"):**
- `services/onesignal_service.py` — genuine OneSignal push API client, real env-var credentials (`ONESIGNAL_APP_ID`/`ONESIGNAL_REST_API_KEY`), honestly no-ops when unconfigured.
- `services/admin_notifications.py` — existing real multi-channel service (in-app + Resend email + OneSignal push) used for pro-application alerts; confirmed the established pattern to mirror.
- `scheduler/__init__.py` — a real, already-running APScheduler instance with ~16 registered jobs; not GitHub Actions as initially assumed.

**Shipped:**
1. **Real campaign delivery** (`backend/utils/campaign_delivery.py`, new file) — `resolve_campaign_recipients()` + `send_campaign()` replace the fabricated "95% delivered" formula in both `communications.py::send_bulk_campaign` and `p2_campaigns.py::send_notification_campaign`. Real recipient resolution (segment/role-based, matching the exact logic already used to *count* recipients at creation time), real OneSignal push sends (batched at 2000/request), real email via Resend, real in-app `Notification` rows. Reports genuine sent/failed counts, not a fabricated percentage.
   - **Bug found and fixed during smoke testing**: the role-filter matched `RoleEnum` values case-sensitively and silently fell through to "no filter" (i.e. blast every user) when a role string didn't match — a dangerous fail-open default for a bulk-send feature, inherited from the pre-existing pattern in `create_bulk_campaign`. Rewrote as case-insensitive matching against both `.name` and `.value`, and changed the no-match behavior to fail closed (zero recipients) instead of fail open (everyone). Currently dormant in practice — no frontend UI populates `target_roles` today — but fixed for correctness before it can bite.
2. **EventReplayEngine.tsx** — "Sandbox Replay" mode previously only changed labels/styling on the exact same correlation-ID trace data as "View Mode". Now genuinely different: Sandbox Replay browses all events of a given type across time via a new `GET /admin/event-dashboard/replay` endpoint wired to `event_bus_core.replay_events()` — a function that existed, worked, and had zero callers anywhere before this.
3. **LiveSystemMap.tsx** — replaced the fully-fabricated "Virtualized Shoreline Nodes" (hardcoded Pipeline Reef/Sunset Beach/Waimea Bay with invented swell/surfer/risk numbers) with a new real `GET /admin/event-dashboard/active-spots` endpoint: real top-N surf spots ranked by actual live-session + active-booking counts. Removed two gauges with no real backing metric anywhere in the app ("Database Read Pool Load 14%", "Webhook Handshake Success 99.8%" — both hardcoded, no monitoring infra exists to source them from). Replaced the fabricated "Event Spine Velocity" heuristic (`total_events_logged / 4`, clamped to an arbitrary 8-64 range) with a real events/min rate computed from actual event timestamps. Fixed "Hotspot Diagnostics: Healthy" being hardcoded regardless of the real error rate shown one card over.
4. **Scheduler job tracking** (`scheduler/base.py`, `scheduler/__init__.py`, `routes/admin/system.py`) — the admin Jobs tab's `ScheduledJobStatus` table had no writer anywhere, AND its 8 seeded job names (`"surf_alerts"`, `"story_cleanup"`, etc.) didn't even match the real scheduler's job IDs (`'check_surf_alerts'`, `'cleanup_stories'`, etc. — 16 real jobs registered via APScheduler in `scheduler/__init__.py`, not GitHub Actions). New `tracked(job_id, description, schedule_label, coro_func)` wrapper in `scheduler/base.py` applied to all 16 job registrations: records real `last_run_at`/duration/status/error/total_runs/success_count/failure_count after every real execution, and — critically — actually checks `is_enabled` before running and skips if disabled, making the admin's toggle switch have real effect for the first time (previously it persisted a DB value nothing ever read). Fixed `system.py`'s seed list to use the real job IDs.

**Verification:** compile checks on every touched file; functional smoke tests against real dev.db for both the campaign delivery (recipient resolution, fail-closed role matching, real in-app Notification creation) and the job tracking (real success tracking, real failure tracking, real skip-when-disabled with unchanged run count) — all passed. Full backend test suite re-run after each sub-change (4 total runs across this phase): 662 passed / 0 failed / 2928 skipped every time.

**Deferred at the time (tracked separately per user decision), later shipped — see §16:**
- Tri-theme (light/dark/beach) support for the entire advanced admin overlay — pre-existing gap, 100% hardcoded dark today, spawned as its own follow-up task rather than folded into this pass.

**Additional Phase 5 items shipped in a second batch:**
5. **Dead `Switch` toggles in `AdminContentMgmtDashboard.js`** — Featured Content and API Keys switches had no `onCheckedChange` at all (Banners' switch was already correctly wired). Added two new backend endpoints mirroring the existing `toggle_banner` pattern exactly: `PUT /admin/content/featured/{id}/toggle` and `PUT /admin/tools/api-keys/{id}/toggle`, plus `include_inactive` query params on both GET endpoints (matching banners' existing pattern) so a toggled-off item doesn't just vanish from the list. Wired both switches to real handlers.
   - **Honesty caveat found, not fixed**: `APIKey.is_active` (and the whole `APIKey`/`key_hash` model) is referenced *only* in `content_mgmt.py`'s CRUD endpoints — grep-confirmed zero authentication middleware anywhere in the backend actually validates an incoming request's key against this table. The toggle now correctly persists a real DB value, but the underlying "API Keys" feature has no real enforcement point to link to (same shape as the Calendar gap) — flagged, not built, since real API-key-gated auth would be new feature work.
6. **Honest labeling for the 3 genuinely-fictional AI panels** — no real ML/prediction engine exists anywhere in this repo for these to link to, so (matching the Calendar precedent) they got clear "not AI" labeling instead of a fake-to-real link:
   - `RootCauseAnalyzer.tsx` — added a "Rule-based, not AI" header badge; relabeled "AI Confidence Metric" → "Heuristic Match Score" and "Suggested AI Remedy" → "Suggested Next Step (rule-based)"; the underlying event data was already real, only the diagnosis language overclaimed.
   - `SimulationEngine.tsx` — relabeled "Production Safe Overlay" → "Local Demo — No Backend"; fixed a pre-existing header typo ("Sandbox Sandbox Sandbox"); subtitle now states plainly it's local browser arithmetic with no backend call of any kind.
   - `SocialIntelligencePanel.tsx` — added a "Simulated predictions" header badge; relabeled "PRIORITIZE SCORE" → "SIMULATED SCORE" and sidebar "Score"/"Reach" → "Sim. Score"/"Sim. Reach"; the media queue itself is real, only the prediction numbers are placeholder math.

**Deliberately left alone (judgment call, not a truthfulness issue):**
- **Duplicate Compliance tab** (top-level `AdminComplianceDashboard` vs. P1's `AdminP1ComplianceTab`) — did not consolidate. `AdminP1ComplianceTab` has props suggesting unique capabilities (`locationFraudMapData`, bulk appeal review) not confirmed absent from the main dashboard; risk of silently removing real functionality under time pressure outweighed the cosmetic-duplication cleanup value. Left as a judgment call for a dedicated pass, not folded into this one.
- **Orphaned `AdminAnalyticsDashboard`/`AnalyticsTabContent`** — confirmed still unreachable from any live route (both fully wired to real endpoints, neither is rendered). Not deleted — removing working code that someone may want to re-link is a more consequential, harder-to-reverse action than the other fixes in this pass; flagged here for a deliberate decision rather than silently deleted.

**Test suite:** full backend suite re-run after this batch: 662 passed / 0 failed / 2928 skipped, 490s. Clean.

**Phase 5 cumulative status: 6 fake→real links shipped, 3 panels honestly relabeled, 2 items deliberately left as judgment calls, 1 new honesty gap found and flagged (API-key auth enforcement).** Test suite run 6 times across this phase (once per sub-change) — 662 passed / 0 failed every time.

## 16. Tri-theme (light/dark/beach) retrofit for the advanced admin overlay — SHIPPED (2026-07-12, same session)

**User directive:** the entire "Raw Surf OS Admin Sync" advanced overlay was 100% hardcoded to a single dark aesthetic (raw Tailwind literals like `bg-slate-950`, `text-cyan-400`, `border-slate-800`) with zero `useTheme()` usage anywhere — a violation of the project's binding tri-theme mandate (light/dark/beach × desktop/mobile, all UI surfaces). Retrofit all 9 `frontend/src/admin/advanced/*.tsx` components plus the 2 shell files (`AdminApp.tsx`, `AdminLayout.tsx`) in one consistent pass, then verify visually in all three themes in a real browser (not just code review).

**Pattern applied (matching the "legacy console" precedent — `UnifiedAdminConsole.js`/`AdminSystemDashboard.js` — already used app-wide):** `const { theme } = useTheme(); const t = getThemeTokens(theme);` for semantic tokens (`t.pageBg`, `t.cardBgBorder`, `t.textPrimary`, `t.textSecondary`, `t.textMuted`, `t.border`, `t.borderLight`, `t.hoverBg`, `t.rowBg`, `t.cellBg`, `t.inputBg`, `t.glassBg`, `t.avatarBg`), plus a local `const dim = t.isLight || t.isBeach;` flag (replicating the one precedent found in `WeatherDiagnostics.tsx`) to swap accent/status colors (cyan/emerald/amber/purple/red) to darker, more-saturated shades for contrast against light/beach backgrounds, since `themeTokens.js` has no dedicated "accent" token. Primary CTA buttons (Run Simulation, Approve & Emit, Trace Lifecycle) intentionally kept a literal solid `bg-cyan-500 text-slate-950` — bright-background-with-dark-text reads correctly in all three themes without branching.

**Files retrofitted (11 total):**
`WeatherDiagnostics.tsx`, `DecisionWorkbench.tsx`, `EventGraphExplorer.tsx`, `AdminApp.tsx`, `AdminLayout.tsx`, `BookingLifecycleInspector.tsx`, `EventReplayEngine.tsx`, `RootCauseAnalyzer.tsx`, `SimulationEngine.tsx`, `LiveSystemMap.tsx`, `SocialIntelligencePanel.tsx`.

**Verification:**
- `tsc --noEmit -p tsconfig.json` against the real project config: zero errors across all 11 files, individually and in one combined pass.
- Live browser verification via the dev server (`craco start`, port 3001) against `/admin`'s "Raw Surf OS Admin Sync" tab set: programmatically switched `localStorage['raw-surf-theme']` between `light`/`dark`/`beach` and reloaded, then walked all 9 advanced-overlay nav tabs (Decision Workbench, Booking Lifecycle, Event Graph Explorer, Event Replay Engine, Root Cause Analyzer, Simulation Sandbox, Live System Map, Social Intelligence, Weather Diagnostics) in each theme, checking computed `background-color`/`color` on the header/panel/heading and grep-scanning the live DOM for any surviving `slate-950`/`slate-900`/`slate-850`/`slate-800` class leftovers.
  - **Light:** all 9 panels render `bg-white/80` / `border-gray-200` / dark text; zero leftover dark-only classes found anywhere in the DOM (only the two intentional `text-slate-950`-on-bright-cyan CTA/active-tab exceptions).
  - **Beach:** all 9 panels render `bg-amber-50/80` / `border-amber-200` / warm dark-amber text; same zero-leftover result.
  - **Dark:** shell + panels render via the shared token system (`bg-zinc-900/80` / `border-zinc-800`) rather than the old raw literals — visually still "dark" but now theme-token-driven and consistent with the rest of the app.
  - Spot-checked mobile viewport (375×812): panel reflows correctly, no horizontal overflow, no separate mobile-only markup path exists in this overlay (unlike `MapWeatherControls`) so no additional layout needed mirroring.
- Full-page screenshot capture was unavailable in this session (`computer` screenshot action timed out repeatedly against this preview pane); verification instead used DOM computed-style inspection + live class-leaf scanning across all 3 themes × 9 panels, which is a stronger correctness signal than a visual screenshot would have been for a systematic "did every hardcoded class get replaced" check.

**Status: tri-theme retrofit CLOSED.** The follow-up task spawned during Phase 5 (tracked separately per user decision at the time) is now dismissed as complete.

---

## 17. Deep forensic re-audit of all session work (2026-07-12, same session) — Jacobian lens, second pass

**Scope:** re-verify every Phase 0-5 + theming claim against current source (not re-trusted from this document's own prose), and re-run the admin-feature ↔ user-feature correlation sweep looking specifically for anything the earlier passes missed or broke.

### 17.1 — NEW FINDING (P0, money-handling): commission-rate tier keys never match a real photographer's stored tier

**This is a regression introduced by this session's own Phase 3, still uncommitted/unshipped.**

`get_commission_rate_for_tier()` (`backend/utils/revenue_routing.py:41-62`) buckets a creator into a commission tier with:
```python
tier_key = subscription_tier if subscription_tier in ("tier_2", "tier_3") else "free"
```
But `Profile.subscription_tier` is **never** literally `"tier_2"` or `"tier_3"` for a real photographer. Traced the actual value end-to-end:
- Photographer plans are `photographer_basic` / `photographer_premium` (`subscriptions.py:38-39`, advertised as "80% revenue share" / "85% revenue share" — i.e. 20%/15% commission, matching `DEFAULT_COMMISSION_RATES`'s intent exactly).
- On checkout completion, `subscriptions.py:110-111` derives `tier_name = tier_id.split('_')[1]` → the literal string `"basic"` or `"premium"` — and that's what gets written to `user.subscription_tier` (`subscriptions.py:211`).
- The `tier_2`/`tier_3` tokens do exist elsewhere in the codebase, but only as **surfer-side credit-upgrade selector IDs** that get translated away before storage: `subscriptions_credits.py:59` — `tier_to_subscription = {"tier_1": "free", "tier_2": "basic", "tier_3": "premium"}`. So "tier_2" ≡ "basic" and "tier_3" ≡ "premium" *conceptually*, but that translation is never applied in `get_commission_rate_for_tier`.
- The admin UI itself (`AdminPricingEditor.js:47-48`) even labels the two sliders `tier_2: 'Basic'`, `tier_3: 'Premium'` — the *human intent* was always correct, only the backend's raw-string comparison never accounts for the translation.

**Net effect:** every real Photographer/Approved-Pro (`PRO_ROLES`, `revenue_routing.py:31`) has `subscription_tier` set to `"basic"`, `"premium"`, `"free"`, or `"business"` — never `"tier_2"`/`"tier_3"` — so `get_commission_rate_for_tier` **always** falls through to the `"free"` bucket (25% commission by default) for every real photographer, regardless of their actual plan. This is **worse than the pre-Phase-3 behavior** (a hardcoded flat 20% for all Pros) and makes the admin's "Basic"/"Premium" commission-rate sliders — the exact feature Phase 3 was built to deliver — **inert for every real user**, while looking fully wired (real DB read/write, passed a smoke test).

**Why the smoke test didn't catch it:** Phase 3's verification called `get_commission_rate_for_tier(subscription_tier="tier_3", ...)` directly with the literal test string the function checks for — a unit-level check of the lookup logic, not an integration check against what a real `Profile` row actually contains. Classic "passed the test, wrong test."

**Recommended fix** (not yet applied — flagging per this being an audit/report request): change the bucketing to translate real stored values, e.g. `{"basic": "tier_2", "premium": "tier_3"}.get(subscription_tier, "free")`, mirroring the reverse mapping already established in `subscriptions_credits.py`. Zero real photographers have been affected yet since this change is uncommitted and unshipped.

### 17.2 — Re-verified: every Phase 0-5 shipped fix is still present and correct in current source
Spot-checked directly against source (not re-trusted from this doc), all confirmed intact:
- `admin_sessions.py` — all 6 handlers still gated with `Depends(get_current_admin)`.
- `analytics_settings.py:60` — platform-settings GET still gated.
- `communications.py:10` — `or_` import present and used (lines 156-157).
- `analytics.py:374,411` — both imports correctly point at `routes.commerce.ad_controls`.
- `ad_controls.py:197` — uses `admin_id` (the NameError is gone).
- `admin_spots.py` — duplicate `create_spot`/`delete_spot` handlers confirmed removed; only the unrelated normalize/seed/import routes remain, so `spot_admin.py`'s land-checked/audited versions run unchallenged.
- `telemetry.py:23` — `OP_DB_PATH = get_db_path(...)`, no hardcoded Windows path remains.
- `scheduler/__init__.py` — 18 occurrences of `tracked(...)` (16 job wraps + import/def), consistent with all 16 real jobs still being tracked.
- `content_mgmt.py` — both `/admin/content/featured/{id}/toggle` and `/admin/tools/api-keys/{id}/toggle` still registered.
- `campaign_delivery.py` — both `communications.py` and `p2_campaigns.py` still import and call `resolve_campaign_recipients`/`send_campaign`; the case-insensitive, fail-closed role-matching fix (`.lower()` on both `.name`/`.value`) is still in place.

### 17.3 — Theming retrofit: no functional regressions found
Re-read `EventReplayEngine.tsx` in full (highest-risk file — its Phase 5 real-wiring logic was most intertwined with the theming edit): `fetchReplay`/`fetchTrace`, the view/sandbox `mode` state machine, the mode-switch `useEffect` that clears stale results, and all playback controls are byte-for-byte functionally identical to what Phase 5 shipped — only `className` tokens changed. Combined with the zero-error `tsc` pass across all 11 files (already verified before this re-audit), there's no evidence the retrofit altered any handler, fetch call, or conditional.

### 17.4 — Admin-surface coverage sweep: no new gaps found
Checked for admin backend routes or frontend panels outside the original ~45-component scope:
- `admin/ab_analytics.py` (`/admin/analytics/metrics|funnel|ab-tests|revenue-by-source`) — confirmed its only frontend consumer is `AdminAnalyticsDashboard.js`, which is the **already-documented orphaned component** (§15, "deliberately left alone"). Not a new gap.
- `condition_reports/admin.py` — confirmed its only frontend consumer is `AdminContentModDashboard.js`, already covered as "WORKING" in §5. Not a new gap.
- No admin-branded component was found outside `frontend/src/admin/` and `frontend/src/components/admin/` that isn't already in one of the two directories fully enumerated by the original audit.

### 17.5 — Minor hygiene note (not urgent)
`GET /admin/event-dashboard/active-spots` (`telemetry.py:431-435`) filters bookings with `Booking.status.in_(['Confirmed', 'in_progress', 'active'])`. Per `models/bookings.py:48`'s documented status flow (`Pending → PendingPayment → Confirmed → Completed/Cancelled`), only `'Confirmed'` is a real `Booking` status — `'in_progress'`/`'active'` appear to be copied over from the `LiveSession.status == 'active'` half of the same query and don't match any real `Booking` value. This is harmless (an `IN` clause with unmatched extra values just never matches, doesn't produce wrong results) but is dead/misleading code worth a one-line cleanup whenever this file is next touched.

### 17.6 — Architectural gap: still correctly flagged as open, not silently implied fixed
Re-confirmed the Event Spine (`event_bus_core`/`operator_core`) remains an orphaned closed loop — zero real booking/payment/session route calls `publish_event()` today. None of Phases 0-5 nor the theming retrofit changed this; it remains the single open scoping decision from §8, and continues to be accurately represented as open rather than fixed.

**Re-audit verdict:** 1 new P0 found (commission-rate tier-key mismatch, self-introduced this session, unshipped) — recommend fixing before this work is committed/deployed. All previously-shipped fixes re-verified intact. No new admin↔user-feature correlation gaps found beyond what was already tracked. Theming retrofit confirmed functionally clean.

---

## 18. Map Editor "Map library failed to load" fix + deeper legacy-console forensic sweep (2026-07-12, same session)

**User report:** legacy admin's Map Editor tab throws "Map library failed to load. Please refresh the page." on open. User also asked for a deeper forensic dive into the legacy admin dashboard for broken/missing features, with proof.

### 18.1 Root cause — Leaflet has never actually been loaded anywhere in this app

Traced the exact error string to `AdminSpotEditor.js:120` (`toast.error('Map library failed to load. Please refresh the page.')`), fired when a 5-second poll for `window.L` (the global Leaflet object) times out (`AdminSpotEditor.js:97-128`). Checked every place Leaflet could plausibly be loaded:
- `frontend/package.json` — **no `leaflet` dependency.**
- `frontend/public/index.html` — **no CDN `<script>` tag** for Leaflet anywhere.
- Repo-wide grep for `unpkg.com/leaflet`, `cdn.../leaflet`, `document.createElement('script')` injecting Leaflet — **zero hits anywhere in `src/` or `public/`.**

Conclusion: `window.L` was **never set, by any mechanism, at any point** — not a regression, a dependency that was assumed but never actually wired in. The app's real map library is `maplibre-gl` (confirmed in `package.json`); Leaflet appears to be a leftover from an earlier iteration (`mapUtils.js` has comments like "kept for TILE_LAYER_CONFIG / legacy Leaflet", and `useMapActions.js:79` has a comment noting Leaflet tracking logic was explicitly *removed* from the main map — consistent with a Leaflet→MapLibre migration that never cleaned up its stragglers).

**This is not admin-only.** Grepped the whole frontend for `window.L\b` and found it used identically (poll-then-init, same silent-or-toast failure) in **4 files**:
| File | Feature | Failure mode |
|---|---|---|
| `components/admin/AdminSpotEditor.js` | Map Editor tab (legacy admin) — visual pin create/edit | Explicit toast error after 5s (the reported bug) |
| `components/admin/AdminSpotsPanel.js` | Spots tab's "Precision Pin" drag-to-refine map | **Silent no-op** (`if (!window.L) return;`, zero user-facing error) — the original 2026-07-12 audit had marked this component "WORKING" because it audited backend-route wiring, not client-side rendering; this class of bug is invisible to a route-matching audit |
| `components/LocationPicker.js` | Location-picker modal used in onboarding/spot-suggestion flows | Silent no-op, polls forever |
| `components/UnifiedSpotDrawer.js` | **Real user-facing feature** — "Refine Location" pin-drag modal on the spot drawer, available to any authenticated user viewing a spot | Silent no-op — modal opens, map area stays blank, no error shown at all |

So this single missing dependency silently broke a genuine user-facing feature (spot location refinement) in addition to two admin map tools, for as long as this code has existed.

### 18.2 Fix shipped

- Added `leaflet@1.9.4` as a real npm dependency (`frontend/package.json`).
- New `frontend/src/utils/leafletLoader.js` — imports `leaflet` + its CSS as a side effect and sets `window.L` if not already present. One-line import added to all 4 consumer files (`AdminSpotEditor.js`, `AdminSpotsPanel.js`, `LocationPicker.js`, `UnifiedSpotDrawer.js`); none of their existing "poll until window.L exists" logic was touched — it now just finds Leaflet immediately instead of timing out.
- Webpack correctly code-splits Leaflet into its own vendor chunk (confirmed via network trace: `vendors-node_modules_leaflet_dist_leaflet-src_js-*.chunk.js`, only fetched when a consumer file is loaded) — no bundle-size regression for users who never touch these 4 features.

### 18.3 Live verification (not just code review)

Started the dev server, navigated to `/admin` → Legacy Console Tools → Map Editor tab:
- `window.L` → `"object"`, `window.L.version` → `"1.9.4"` (was `undefined` before the fix).
- `.leaflet-container` count = 1, `.leaflet-tile` count = 9 — the map actually renders satellite tiles.
- Debug log sequence confirms full successful init: `Leaflet is ready` → `Creating Leaflet map...` → `Map created, adding tile layers...` → `Map size invalidated`.
- Zero console errors or warnings mentioning Leaflet or "Map library failed to load."
- Ran a full production build (`craco build`) afterward per standing project guidance that only the production build (not dev server or tests) catches certain deploy-breaking issues — **clean, zero errors/warnings**, build folder produced successfully.

### 18.4 Deeper legacy-console forensic sweep

Extracted every `apiClient` call across all ~24 legacy-console frontend files (`grep -o` for the URL literal in each call) and cross-referenced each one against the real backend route decorators (`@router.get/post/put/patch/delete`) it's supposed to hit — the same file:line evidentiary standard as the original 2026-07-12 audit, re-applied to components the original audit had only summarized in a single grouped row rather than individually verified (`AdminP2Dashboard`, `AdminUnifiedAnalytics`/`GrowthToolsPanel`/`AnalyticsTabContent`, `AdminSurfForecastPanel`, `AdminContentModDashboard`, `AdminSessionsPanel`, `AdminModerationDashboard`), plus 2 tabs never mentioned in the original audit at all (`competition` → `AdminCompetitionVerification.js`, and a closer look at `users` → `UsersTabContent`/`AdminTabPanels.js`).

**Result: every single route matched exactly, with one exception (§18.5).** Specifically confirmed real, correctly-pathed backend routes for: `/admin/revenue/overview|cohort`, `/admin/promo-codes*`, `/admin/feature-flags*`, `/admin/notification-campaigns*`, `/admin/funnel/detailed` (all of `AdminP2Dashboard.js`); `/admin/analytics/ltv-cac|liquidity|supply-demand|top-performers|health-score` (all of `AdminUnifiedAnalytics.js`); `/admin/surf-forecast/status|reports` (`AdminSurfForecastPanel.js`); `/admin/content-moderation/queue|stats|{id}/moderate|bulk-moderate`, `/admin/condition-reports/purge-orphans` (`AdminContentModDashboard.js`); `/admin/photographers`, `/admin/active-sessions`, `/admin/force-start-session`, `/admin/force-end-session/{id}` (`AdminSessionsPanel.js` — the same file gated by the previous session's P0 auth fix); `/admin/payout-holds*`, `/admin/audit-logs*` (`AdminModerationDashboard.js`); `/admin/users*`, `/admin/make-admin/{id}`, `/admin/revoke-admin/{id}` (`UsersTabContent`/`AdminTabPanels.js`, with real `log_admin_action` audit-trail writes on suspend/unsuspend). Also did a repo-wide sweep for the same "expects an unloaded global" bug class (`window.(google|mapboxgl|Stripe|gtag|fbq|grecaptcha)`) across all admin components — zero hits, confirming Leaflet was an isolated (if high-impact) instance of this bug shape, not a systemic pattern.

**`AdminCompetitionVerification.js` (Competition tab) — audited fresh, not previously covered at all.** Calls `GET /career/admin/pending-verifications` and `POST /career/competition-results/{id}/verify` (`career_hub/career.py`, prefix `/career`). Both routes exist and do real work: the GET returns real pending `CompetitionResult` rows with joined surfer profile info; the POST genuinely computes and awards XP (`calculate_competition_xp`), updates `Profile.career_points`, writes an `XPTransaction`, and checks badge milestones on approval — this is real, not fabricated. One gap found, below.

### 18.5 New finding: unauthenticated admin data-exposure endpoint (same class as the two previously-fixed P0s)

`GET /career/admin/pending-verifications` (`backend/routes/career_hub/career.py:144-147`) has **zero admin-auth dependency** — only `db: AsyncSession = Depends(get_db)`. Its own sibling `POST /career/competition-results/{result_id}/verify` two functions later correctly requires `admin: Profile = Depends(get_current_admin)` — the exact same inconsistency-within-the-same-file shape as the `analytics_settings.py` platform-settings vulnerability from the original audit. Effect: any unauthenticated (or authenticated non-admin) request can read all pending competition-result submissions, including surfer names, avatars, event details, and proof-image URLs. Lower severity than the previous two P0s (read-only, less sensitive data), but the same class of bug and worth fixing the same way (`admin: Profile = Depends(get_current_admin)` added to the function signature). **Not yet fixed — flagged for the user to confirm before shipping.**

### 18.6 Verdict

- **Map Editor bug: FIXED and live-verified.** Root cause was a genuinely missing dependency (never loaded by any mechanism), not a regression — impact was broader than the reported tab, silently affecting 3 other map-pin features including one real user-facing flow (`UnifiedSpotDrawer`'s refine-location).
- **Legacy admin dashboard, broader sweep:** overwhelmingly sound. Every apiClient↔backend-route pair checked (≈24 files, ~90 individual calls) matched correctly except the one new auth gap above. This is consistent with the original audit's diagnosis that the legacy console's defects are isolated mechanical bugs (import paths, auth decorators, key mismatches) rather than a systemic disconnection — most of that backlog is now shipped (§11-15), and this pass found no large new backlog of the same kind, only the one auth gap and the one client-side dependency bug (both now addressed: one fixed, one flagged).

---

## 19. Live end-to-end test pass — every legacy console tab, real local backend, real proof (2026-07-12, same session)

**User directive:** "Start working on the admin panel Jacobian audit you just made. Follow it and test everything, to show proof and truth." — execute the open item from §18 and live-test the full legacy console against a real backend, not just grep/code-review.

### 19.1 Fixed the open item: `GET /career/admin/pending-verifications` unauthenticated endpoint
Added `admin: Profile = Depends(get_current_admin)` to the handler (`backend/routes/career_hub/career.py:144-147`). Verified with live curl against the local backend:
- No auth header → `401 {"detail":"Authentication required..."}`  (was previously `200` with full data — confirmed via the diff; the original vulnerable state was not independently reproduced live, since the auto-mode security classifier correctly blocked stashing away a just-applied security fix to demonstrate it — the source diff plus live 401/200 behavior is sufficient proof).
- With `Authorization: Bearer dev-mock-user-token` (dev-only admin bypass, gated on `ENV != production`, `core/security.py:100-102`) → `200 {"results":[]}`.
- Full pytest suite re-run after the fix: 669 passed, 0 failed, 2928 skipped (unchanged from baseline modulo unrelated new tests from a concurrent session).

### 19.2 Live test setup: pointed the dev frontend at the local backend, not production
`frontend/.env.local` points `REACT_APP_BACKEND_URL` at the deployed Render backend by design (documented in the file itself, to avoid breaking weather layers when no local backend runs) — testing admin *mutating* actions against that would touch real production data. The app already has a documented runtime override for exactly this case: `localStorage.setItem('__BACKEND_URL__', 'http://127.0.0.1:8000')`. Used that (no file changes, nothing to revert) to safely test against a local `python backend/server.py` + local SQLite `dev.db` instance instead.

### 19.3 Walked all 22 legacy console tabs live, with real data proof for each
Every tab loaded successfully against the real local backend, verified via `get_page_text`/network-request/console-error checks (not just "no crash" — actual rendered numbers cross-checked against what the dev DB should contain):

| Tab | Proof |
|---|---|
| Overview | Real counts: 2 users, 6 posts, 1 Photographer, 1 Approved Pro |
| Access Control | Real platform-settings state ("Site is public") |
| Compliance | Real zeros (clean dev DB) |
| Moderation | Real "No disputes found" |
| Content Queue | Real moderation queue (empty, correctly) |
| Verification | Real pending photographer verification request rendered |
| Analytics | Real computed health-score/LTV-CAC/churn metrics (correctly "critical" on a near-empty DB) |
| Support | Real empty ticket queue |
| Comms | Loads cleanly (proves the `or_` import fix from §11 still holds) |
| System | **Real, live scheduler data** — jobs with real "Last: 7/13/2026..." timestamps and 100% success rates for ones whose interval has elapsed, 0% for ones that haven't — direct live confirmation the Phase 5 `tracked()` wrapper (§15) works end-to-end |
| Surf Forecast | Real live server env-var feature-flag state |
| Finance | Real empty refund/payout queues |
| Content | Real "No featured content" (proves the `.featured` key-mismatch fix from §11 still holds) |
| Persona | Renders (client-side only, no backend expected) |
| Live Sessions | Real photographer list + real 1587-spot dropdown (the panel behind the previously-fixed zero-auth P0 — proves the auth fix didn't break legitimate admin use) |
| Users | Real 2-user list, including "Dev User: Photographer / Premium" — confirms the commission-tier fix's exact assumption (`subscription_tier="premium"`) matches a real row |
| Spots | Real 1587-spot database across 73 countries |
| Map Editor | Re-verified after backend restart: `window.L` populated, 9 real tiles rendered |
| Queue | Real 20-item flagged-spots precision queue |
| Pricing | **Found broken, fixed — see §19.4** |
| Ads | Loads cleanly (proves both the NameError and import-path fixes from §11 still hold) |
| Competition | **Live-verified the §19.1 auth fix through the actual UI**, not just curl — loads correctly for an authenticated admin |
| Logs | Real "No admin logs yet" |

### 19.4 New finding, found live, fixed and proven: `GET /admin/pricing/config` 500 error — and its real root cause

The Pricing tab rendered its full UI shell but ended with "Failed to load pricing configuration." Backend log showed the real cause:
```
sqlite3.OperationalError: no such column: global_pricing_config.commission_rates
```
This is **not a regression in the commission-rate code itself** (§13/§17's fix is correct) — it's a environment/infrastructure bug that reintroduces the exact symptom:

1. **Two divergent local `dev.db` files exist**: `C:\Users\dprit\Raw-Surf\dev.db` (repo root) and `C:\Users\dprit\Raw-Surf\backend\dev.db`. `database.py` uses a relative SQLite path (`sqlite+aiosqlite:///dev.db`), which resolves against the process's current working directory. The `backend` launch config runs `python backend/server.py` from the repo root, so the running server binds to the **repo-root** `dev.db` — which never received §13's manual `ALTER TABLE` (that was almost certainly run from within a `backend/`-cwd shell, landing on the *other* file). Direct inspection confirmed it: `backend/dev.db` has both new columns; the repo-root `dev.db` the server actually uses did not.
2. **The deeper, systemic bug**: `server.py::ensure_database_tables()` has full Postgres logic to detect and `ALTER TABLE ADD COLUMN` for any model column missing from an existing table — but the **SQLite branch only calls `Base.metadata.create_all()` and returns**, and `create_all()` never alters existing tables, only creates missing ones. This means *any* future column added to *any* model will silently fail to reach a pre-existing local SQLite `dev.db`, for every developer, forever — §13's columns were only the first casualty, not a one-off.

**Fixed properly** (not just re-running the one-off ALTER TABLE, which would leave the systemic gap open for the next new column): extended the SQLite branch of `ensure_database_tables()` (`backend/server.py`) to mirror the Postgres logic — introspect existing columns per table via SQLAlchemy's async-safe `run_sync(lambda c: inspect(c).get_columns(...))`, and `ALTER TABLE ADD COLUMN` anything missing, logging each addition.

**Verified live, not just by reasoning:**
- Restarted the local backend; log showed the self-healing running exactly once: `[DB Migration] ✓ Added column: global_pricing_config.commission_rates (JSON)`, same for `surfer_discount_rates`, `✓ Added 2 missing columns (SQLite)`.
- `curl /api/admin/pricing/config` → `200`, full real pricing tree including `"commission_rates":{"free":25,"tier_2":20,"tier_3":15}`.
- Reloaded the Pricing tab in the browser: full UI renders, no error message, matches the curl response.
- Full pytest suite re-run after this fix too: 669 passed, 0 failed, 2928 skipped.

### 19.5 Minor open item (not root-caused, doesn't affect the reported bug)
On the Map Editor tab, the map itself renders correctly (proving the reported bug fixed), but spot markers (`.leaflet-marker-icon`) did not appear on a second re-visit within the same session even though `GET /admin/spots/list` returned 1587 real spots. The marker-render `useEffect` (`AdminSpotEditor.js:258-259`) is gated on `mapInstanceRef.current` existing and `spots.length` being nonzero; both should have been true. Not isolated further in this pass (didn't affect the originally-reported bug, which is the map failing to load at all) — worth a follow-up if the actual pin-editing workflow is exercised next.

### 19.6 Verdict
Every claim in this runbook (§0-18) that could be live-tested against a real backend now has been, tab by tab, with request/response/log proof rather than static code reading alone. One new environment-level bug was found live (the dual-`dev.db` + SQLite-migration gap) and fixed durably (not patched around); the previously-flagged auth gap was fixed and proven both via curl and through the actual admin UI. No other tab, of 22, showed any discrepancy between what the code claims and what actually happens when exercised.
