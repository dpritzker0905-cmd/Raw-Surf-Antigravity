# D1: ICON far-hour delivery — Codex

## Scope and owner direction

Owner approved fixing both D1 failure paths, proving held-hour and upload-content changes offline, and opening a draft against dev; merging is held. Subsequent owner direction rejected bare-GFS fallback and asked to examine the existing scientific extension system. The implementation therefore recovers an existing stored ICON-anchored estimate when the browser's ICON anchor is missing. It does not relabel raw GFS as ICON.

Base: dev `62021d59f`. Draft #264 at `de490d11f` contains no frontend files. Its backend cycle-ceiling and provenance changes are separate from this client gate repair.

## What the deeper trace established

- `icon_marine_extension.py` already precomputes the 168–336 h ICON extension for waves, swell_1 and wind_waves, on coarse and mid grids. It selects the last native ICON product and a matching GFS anchor/target, invokes the existing estimator, and records `icon_persistence_gfs_blend` with `persistence_anchor_product_id` and contributor times.
- The existing height calculation blends ICON persistence with an ICON-anchored GFS increment: `trend = max(0, ICON_anchor + GFS_target - GFS_anchor)`. This is different from substituting the GFS target. Direction uses circular blending and invalid support is masked. None of that calculation changes here.
- The browser's legacy <=240 h path uses that family of calculation, but its `gfs_trend` tag was rejected by the renderer. If its ICON anchor was absent it returned the unmodified GFS target, which the model guard also rejected.
- The browser's >240 h path is a separate GFS/EURO blend with an ICON continuity offset decaying to zero by 288 h. This PR does not rebuild that locked blend or change D-003 secondary swell.
- The stored path was already enabled on dev only under D-016. Recovery here selects it only after the legacy ICON anchor fails; the build-time switch's normal scope stays unchanged.
- The skill ledger currently uses leads 24/48/72. Existing extension tests establish generation and provenance, not day-8–14 predictive skill. The estimator's confidence and weights are programmed schedules, not newly measured calibration. A claim of scientific accuracy over that horizon still needs independent verification against observations.

## Repair and boundaries

The renderer's provider/model/layer gate is extracted into `marineGridValidation.js`. It accepts the client's ICON trend tag while retaining model and component checks. `WebGLMarineLayer.js` shrinks from 1,132 to 1,093 lines.

Missing ICON anchors trigger one direct request for the already stored ICON estimate, bypassing recursive client estimation. Recovery requires ICON identity, the requested layer/time, estimated/non-authoritative status, an ICON persistence-anchor ID and timestamp, and usable vectors. Missing or contradictory provenance rejects the recovery; raw GFS is not delivered under ICON. Forecast calculations and backend served values are unchanged; this is delivery/source validation, so no served-number SCOREBOARD gain is claimed.

Kill: `window.__RAW_DISABLE_ICON_FAR_HOUR_RENDER__ = true`. It restores the old trend rejection and old missing-anchor model rejection. It does not promote a GFS texture.

## Verification in progress

Fresh full frontend: 438 suites / 5,748 tests passed. Focused package: 62 tests passed. Existing backend ICON extension generation/provenance: 5 passed (local Python lacks pygrib/uvloop; no claim of environment parity). Production-context bundle built with `REACT_APP_ICON_STORED_TAIL=false`; frontend lint and repository LOC ratchets passed.

The strengthened `scn_icon_far.js` selects the direct-grid path with `window.__MARINE_SERIES__ = false`, because cached three-hour series frames bypass the client estimator and snap to nearby hours. It asserts engine-held hour and a hash of the typed bytes sent to the engine's resident wave texture, not the parity diagnostic. The first series-enabled probe retained a nearby 170 h series frame at the 171 h request; it is retained as a limitation, not counted as a D1 pass. No series-cache repair is included.

The final direct-grid trend run passed every integer hour 169–240 (72 steps), with a new texture upload and changed content hash at every transition, provider `gfs_trend`, and no gate drop. Missing-anchor recovery and kill/native/tail controls follow below when read back. The synthetic field is invented; these browser runs do not measure real forecast accuracy or device performance.

The harness proxies weather GETs to the local synthetic backend and blocks external sockets; RainViewer is now explicitly aborted. No live map, mutation endpoint, production data, flags or settings were exercised.
