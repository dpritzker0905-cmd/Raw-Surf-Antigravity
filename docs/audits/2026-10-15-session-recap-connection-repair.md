# G03 / MAP-F02: connect the session recap route

Local implementation on `codex/master-plan-recap-connection-2026-10-15`, from verified DEV `131d5d9e434124d9bf510edb9eed2e8238723313`. Worktree is the master's previously unused `task-4/raw-surf-g02-prep`. No new task or worker was created. The existing payment owner owns orphan-checkout source/tests; weather and wave code remain separate.

## Observable repair

The registered `/session-recap/:sessionId` previously mounted `PostSessionSummary` without gallery data or callbacks; it rendered null. It now resolves the signed-in profile's linked gallery using the existing APIs, validates its item/roster responses, and initializes the existing Gallery Hub consumer with that exact gallery, items, participants and session information. Existing distribution, AI-tag and manual-tag handlers receive the selected data. Live-session, booking and dispatch reference fields follow the existing gallery-list contract. Multiple linked galleries require an explicit choice instead of silently choosing a mutation target.

Empty, missing, denied and malformed responses are distinct from a successful empty roster. Retry is guarded against duplicate clicks; replacement/unmount aborts reads and ignores stale responses. Old galleries remain accessible with an explicit note about the original 48-hour summary window. The default embedded summary behavior remains; the routed view says Session Gallery because gallery retrieval alone does not verify that a session ended.

Opening recap does not automatically generate a watermark preview. Its tool remains usable, and ordinary Gallery Hub behavior is retained. The already-loaded roster is reused on initial entry; later gallery changes retain the existing participant fetch. Summary controls have meaningful accessible names and correct expanded/collapsed state. The delivery count is labeled With deliveries, matching its existing `items_distributed` calculation; no AI identity qualification is claimed.

## Mounted contracts reused

- `GET /api/galleries/photographer/{profile_id}`: collection roster, existing `backend/routes/gallery/collections_roster.py`.
- `GET /api/gallery/{gallery_id}/session-participants?photographer_id={profile_id}`: existing distribution roster.
- `GET /api/galleries/{gallery_id}/items?viewer_id={profile_id}`: existing gallery collection items.

The existing authenticated `apiClient` and App `ProtectedRoute` remain in place. No backend, authority, storage, schema, payment, weather, palette, flag, dependency or lockfile change is included. This frontend wiring does not certify existing server authorization or private-original delivery.

## Focused evidence

The real App route baseline ran eight cases and failed all eight because it never loaded or rendered recap data/states. After the connection, those eight pass. The real Gallery Hub consumer adds three theme-mode data/action/accessibility cases and one default-behavior control: **12 focused tests pass in two suites**. The consumer tests mock action/API boundaries; they prove data/callback wiring, not provider or media delivery.

A separate paired consumer check found three automatic watermark-preview writes on recap entry, with the ordinary-gallery control passing. The entry guard removes those writes while retaining the control. Initial React Router v7/Jest resolution, an omitted fixture callback and an exact heading selector that omitted its status badge were setup errors, excluded from product failure counts. The tests use the installed real core router exports through a test-local adapter; runtime dependencies/configuration are unchanged.

Node24.21.0 production compilation passes with existing warnings, private cache/output and no embedded Mapbox token. ESLint debt ratchet passes:1313 files, existing86errors/917warnings, no baseline increase. LOC ratchet passes with12 grandfathered files, no new/regressed violation. Diff, ledger/memory and staged secret readbacks are recorded in the checkpoint receipt.

## Qualification limits and release boundary

Light/dark/beach consumer DOM/actions are covered; this is not pixel, responsive-device or native mobile acceptance. Full real React/API/media journeys, image/video entitlements, provider flows, physical phones/Safari and whole-app acceptance remain unrun. G03 still has other mapped connections open; all12 launch gates remain open.

The immediate DEV plan is qualified commerce plus approved wave, with unfinished weather experiments excluded. A new experimental weather head is not required. The explicit weather-owner window acknowledgement for frontend/serviceworker replacement and automatic Render restart remains required. This recap source is independently checkpointed; it must not silently change the already-qualified PR331 head or enter a batch without exact combined-head qualification. No push, PR, merge, deployment, real customer/payment operation or setting change occurred here.

Immutable master history through1196 was replayed through the ledger appender and byte-verified before adding this branch's records. Original receipts/logs were carried without importing commerce application code. Future integration keeps one canonical chain and preserves the source fingerprints of every lane.
