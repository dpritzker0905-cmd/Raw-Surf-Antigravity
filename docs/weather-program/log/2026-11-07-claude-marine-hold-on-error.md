# 2026-11-07 - Claude: marine map holds the last good frame on fetch errors

Trigger: Render backend srv-d7fhiu7lk1mc73debje0 was OOM-killed at 22:25:19Z (2Gi) and back at 22:25:59Z. Every API call
returned 502 (CORS-less, so the browser logged CORS errors), then `[WebGLMarineEngine-Clear]` fired and the wave heatmap
and particles went blank.

## Callers of `WebGLMarineEngine.clearBuffers` (the only place that prints `-Clear`)
- `WebGLMarineCustomLayer.js:192` per-frame, inactive layer (deliberate; transition hold exists).
- `WebGLMarineLayer.js` deactivate toggle-off (deliberate), `unsupported_layer` (deliberate), and
  `non_renderable_terminal` (~line 985). **The last one is the failure path**: a failed fetch commits
  `fallback_safe_zero` / `abort_recovery` (`marineControllerCache.createFallbackSafeZeroGrid`, `useMarineDataFetcherHelpers`),
  which is non-renderable. The existing holds (transition flags, same-target, switch-hold) are skipped when the resident is
  regional at a global viewport, or when the signature is empty, so the branch fell through to the clear.
- `WebGLMarineEngine.js:264` (encode threw) and `disposeEngine` (unmount): unchanged, legitimate.

## Fix (ON, kill switch `window.__RAW_DISABLE_MARINE_HOLD_ON_ERROR__`)
`marineTransitionCoordinator.shouldHoldFrameOnFetchError` + `isFetchFailureCommit`; `WebGLMarineLayer.js` calls it at the top of
the non-renderable branch (after the unsupported-layer and scrub returns). A commit that carries a fetch-failure marker keeps the
resident frame whatever the viewport or switch state. A renderable commit, layer-off, unsupported layer and unmount are untouched.
Telemetry: `__MARINE_ERROR_HOLD_COUNT__`, diagnostics reason `error_hold`. No served number changes.

## Retries (checked, not changed)
`scheduleFailRetry` (`marineGridSeries.js:92`) already caps at 4 retries per page key on 1.2/2.4/4.8/9.6 s. Sibling warms use
distinct keys, so 4 layers x 3 pages can still send up to 48 re-asks in ~17 s at a down server, in lockstep. Jitter was tried
and dropped: the retry tests pin exact delays. Follow-up if wanted: shared "server down" gate plus jitter, with those tests updated.

## Tests
`marineHoldOnError.test.js` (+1 suite / +3 tests): a 502 / reject / abort-recovery sequence never asks for a clear; deliberate
cases are not error holds; kill switch restores the old path. Frontend floor 643/8418 -> 644/8421. Kill-switch inventory updated.
