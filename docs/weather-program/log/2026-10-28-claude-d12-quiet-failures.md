# 2026-10-28 (claude, side session of the lead): D12, intentional aborts logged as errors, and a removed map asked for its layers

Branch `claude/d12-oceanmask-null` from dev c1ffa46be. Client only, ON. Kill switches:
- `window.__RAW_DISABLE_ABORT_LOG_DOWNGRADE__ = true`: aborts are logged with console.error again.
- `window.__RAW_DISABLE_MASK_MAP_GONE_GUARD__ = true`: OceanMask asks the map for its layers without checking it is still there.

## Ask

The lead's offline erratic fuzzer (fc033f5c1, at 4bd90d0d9):
- intentional aborts logged with `console.error`, over 100 per batch;
- one page error: `getLayer` of null in OceanMask's deactivation timer (~785), after Wind on plus a WebGL context loss.

## Cause

- **Aborts.** In six seeded dev sequences offline (`fz_rnd_dev`), the top console error was "[Backend Weather Service] Grid fetch
  error: signal is aborted without reason" (15), then "ICON extended point emulation failed: AbortError" and "Wind grid fetch error:
  signal is aborted". A newer ask cancels the one in flight on every scrub step, pan and switch. The Copernicus client already logs
  its aborts benignly (its note: a console.error trips WeatherTelemetry's interceptor into a false "model_error" in the HUD).
- **The page error.** MapLibre's `map.getLayer(id)` is `this.style.getLayer(id)`; `style` is null once the map is removed. The
  deferred hide (1200 ms) and the styledata reposition callback ran against such a map (run-s16: "Cannot read properties of null
  (reading 'getLayer') at fa.getLayer").

## Fix

- `marineQuietFailures.logFetchFailure(err, message, ...extra)`: `console.debug` for an abort (`AbortError`, or a message naming an
  abort), `console.error` otherwise. Used by the grid fetch, the ICON extended point and the wind grid fetch.
- `marineQuietFailures.maskMapGone(map)`: no map, no style, or `_removed`. OceanMask's deferred hide and its reposition frame
  callback return first. OceanMask stays at 904 lines.

## Tests

- New: `marineQuietFailures.test.js` (7): abort detection (the fuzzer's three messages; HTTP errors stay errors), debug vs error
  logging and the kill, the three call sites in source, `maskMapGone` and its kill, OceanMask's two call sites in source, and the
  removed-map hide: the old code throws MapLibre's exact error, the guarded one returns.
- The module is new, so dev fails all 7 (red by construction); the removed-map test carries its own positive control.
- Neighbouring suites (OceanMask, the weather/wind/Copernicus clients): 11 suites, 166 tests, all pass.

## Offline before/after (the fuzzer's generator, the same store and CDN, `serve_synthetic_selector.py`)

| seed | arm | page errors | console errors (aborts among them) |
|---|---|---|---|
| 16 (Wind on, then a WebGL context loss: the fuzzer's page-error run) | dev ea9608095 (main.953ceb74) | 1: "Cannot read properties of null (reading 'getLayer')" | 0 |
| | fix (main.3c5bb0ea) | 0 | 2 (0): two HTTP failures |
| 129 (phone, random) | dev | 0 | 11 (1) |
| | fix | 0 | 10 (0): the HTTP failures and point errors that are real |

- **Scale on dev.** The six seeded sequences of the D1 runs (`fz_rnd_dev`, `dev2`, `dev3`) logged 60, 44 and 46 console errors, of which 19, 5 and 5 were aborts. Those aborts are now debug lines.
- **Not changed.** HTTP failures and the ICON extended point's real errors (e.g. "ICON point extended estimate requires…") stay `console.error`.

