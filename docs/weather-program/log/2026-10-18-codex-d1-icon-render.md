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

## Independent challenge and additional upload-path checks

Reflection Beam was consulted at the owner's explicit request. Its first response exhausted its output budget and returned no answer; the second returned a review. Its disposition: stored ICON-anchored recovery is preferable to relabeling bare GFS. This is advisory review, not proof of forecast skill.

- Accepted: a nonempty but entirely invalid anchor must not suppress recovery. A shared usable-support predicate now rejects masked, invalid, negative-height and nonfinite vectors while admitting valid calm water. Three real-helper tests force invalid/nonfinite/masked anchors, and invalid stored vectors are refused.
- Already covered, now pinned explicitly: both wrapper and nested grid identities must agree; `AbortError`/aborted signals propagate before recovery; `storedIconRecovery` bypasses client recursion and makes a failed stored fetch single-shot. Two cancellation controls and a failed single-shot HTTP control pass.
- Deferred: cache run-time consistency is the independently identified D3 scope. It is not silently claimed repaired here.
- Oracle limit retained: upload hashes demonstrate changed encoded content, not correct physical forecasts or calibrated confidence. Recovery identity/provenance is asserted separately.

The browser kill control exposed a reactivation re-feed bypassing the old effect gate. Validation now also runs at the shared upload boundary. A wrapper marked ICON cannot hide a nested GFS grid. The layer's final size is 1,097 lines (net -35 against the base), correcting the earlier intermediate 1,093 count.

Fresh focused suite after these changes: 71 passed. Three mutations on checkpoint `c47575eb3` were killed and source restored byte-for-byte: removal of trend admission caused 6 assertion failures; reinstating bare-GFS fallback caused 3; removing provenance validation caused 10. The whole frontend and final browser matrix are rerun after restoration; final receipts follow below.

## Final local read-back

- Whole frontend: **438 suites / 5,757 passed / 0 failed** after source restoration.
- Production-context build (`REACT_APP_ICON_STORED_TAIL=false`): success with the existing warning backlog. Frontend lint and LOC ratchets pass; `WebGLMarineLayer.js` is 1,097 lines. Backend fatal lint, file-size and BOLA ratchets pass; CI floor staleness 36 passed; existing backend ICON extension 5 passed.
- Final browser matrix: normal trend **72/72**, forced missing-ICON-anchor stored recovery **72/72**, kill/provider and kill/recovery **1 each**, +168 boundary **1**, +241 and +288 tail controls **1 each**. Native ICON hour 0 is established before every scenario. Both hourly sweeps had correct held hours, changed resident texture hashes at every transition, and zero gate drops. Recovery retained `icon_persistence_gfs_blend` and the native persistence-anchor ID.
- The missing-anchor kill control retained the native hour 0 texture with exactly the same content hash after the failed-anchor/GFS requests completed. It did not upload a substitute; upstream model rejection can precede the layer's drop diagnostic, so a missing `__SWELL2_LAST_DROP__` alone is not treated as proof of success or failure.
- Compact receipt: `evidence/d1-icon-render-2026-10-18.json`, including the main bundle SHA-256, source hashes, per-hour held/upload hashes and test counts. Raw output and intermediate failing probes remain local, outside the public repository.

No scientific skill gain is claimed. The direct-grid scope, invented fields, unverified long-range calibration, separate D3 cache identity, absent local pygrib/uvloop, and lack of real-device acceptance remain explicit limitations. D1's source repair is qualified locally for a draft; merge and production rollout remain held.

An additional direct-grid control with 3,000 ms local weather delay passed hours 169 and 170 with correct held hours and changed texture-byte hashes. This is a delivery-under-delay check, not a production latency benchmark. Local ledger verification passed at seq 1394; memory audit returned 0 FAIL / 21 WARN / 22 NOTE. The existing overdue commitments remain open.

## Publication

Published source/receipts as `7f474df0a57de3cb420c7a2fffb692765bf36742` and read the same SHA from the remote branch. Opened and attached draft [PR #376](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/pull/376); GitHub read-back was OPEN / isDraft=true / base=dev / matching head. GitHub creation connector was unavailable, so `gh` created the draft from the prepared body; Code Review's check connector could not connect, so hosted status was read through `gh`. Hosted checks were in progress, not claimed green. Publication receipts are ledger 1395–1396. No merge or production rollout occurred.

Texture-byte hashing is enabled only by D1's explicit `hashTextureUploads: true` harness option; other scenarios retain their previous instrumentation cost. The D1 acceptance matrix is repeated with that opt-in path before the final receipt update.

The opt-in repeat passed all seven scenarios, and every positive requested/held hour, provider and upload-byte hash matched the prior matrix exactly. Receipt harness hashes and explicit re-verification metadata were updated by exact replacement; product code and compiled bundle are unchanged. Ledger 1397 records this read-back. Final publication remains draft-only; hosted checks are a separate result and merge is held.
