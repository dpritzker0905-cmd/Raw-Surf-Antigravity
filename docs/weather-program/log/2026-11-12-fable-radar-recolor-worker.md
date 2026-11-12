# 2026-11-12 · Fable · radar recolor tiles off the main thread (stacked on #807)

Branch `fable/radar-recolor-worker`, on top of `fable/radar-advect-worker` (#807, the nowcast warp in a worker). Draft PR only,
nothing merged. Client only: no served number, palette, shader or markup changes, so no SCOREBOARD row. The owner, 2026-11-12
09:02 EST: "Do the radar recolor worker while we wait" (for the first pressure frames to publish).

## What changed

The `hrrr-rv://`, `dwd-rv://` and `ltg-flash://` protocol handlers fetched each tile, decoded it, recolored it, blurred it and
PNG-encoded it on the main thread, and maplibre then decoded the PNG again.

| Change | Module | Kill switch |
|---|---|---|
| Those tiles are fetched, decoded, recolored and softened in the #807 worker, which answers with a decoded `ImageBitmap` | `radarAdvectWorker.js` (`kind: 'recolor'`), `radarAdvectClient.js` (`recolorTileOffThread`), `radarTileRecolor.js` | `window.__RAW_DISABLE_RADAR_RECOLOR_WORKER__ = true` (main-thread recolor + PNG, as before) |
| The pixel transforms moved, verbatim, into one module both paths call; `radarTileRecolor.js` re-exports every name | `radarRecolorCore.js` | none (same arithmetic; pinned by tests) |

- Lightning strike cores found in the worker are sent back and recorded in the main thread's registry, as before.
- The worker keeps each tile's SOURCE bytes for 10 minutes (up to 160), not the recolored pixels: a re-ask skips the WMS render
  and redoes the recolor off-thread. `__RAW_RADAR_TILE_CACHE__` hits and misses still count; `__RAW_RADAR_TILE_CACHE_OFF__` and
  `__RAW_RADAR_SMOOTH_DISABLED__` are passed through.
- Fail-open: a tile the worker cannot fetch or decode goes to the main-thread path for that tile (which keeps its own
  fail-open: the original bytes). A worker whose canvas has no blur filter is not asked for recolor tiles again. No worker at
  all, or the kill: the main-thread path.

## Where this matters (and where it does not)

- In a default US radar session these handlers do almost nothing: the nowcast frames come from `advect-rv` (#807), HRRR far
  frames are off unless advection cannot run, and lightning rides a direct viewport fetch, not the tile protocol. The
  2026-11-11 phone profile had `radarTileRecolor.js` at 98 ms of 7,973 ms.
- They carry the forecast frames in Europe (DWD, for EURO and ICON) and the HRRR fallback. Those are the sessions this helps.

## Evidence (offline: built client over `serve_synthetic.py`, `scn_radar_worker.js`)

HRRR far frames forced on (`__RAW_RADAR_HRRR_FAR__ = true`), phone 390 x 844 dpr 3, CPU 4x, dark. The 32 HRRR tiles were
recorded once from the public IEM WMS, then replayed. Main-thread Long Animation Frames, total ms (blocking ms); before = the
same build with the kill set.

| pair | toggle before | toggle after | scrub before | scrub after |
|---|---|---|---|---|
| 1 | 1557 (547) | 1137 (298) | 1606 (282) | 661 (258) |
| 2 | 335 (125) | 227 (70) | 715 (105) | 403 (86) |
| 3 | 400 (127) | 242 (82) | 755 (93) | 390 (61) |

- Lower in every pair; about half on the scrub. Pair 1 is noisier than 2 and 3 in both arms (not explained), so the size of the
  gain is not pinned.
- Worker telemetry: 32 tiles recolored, 0 fallbacks, 205-490 ms each on the throttled phone.
- With the tiles missing from the replay (the first run, before recording), all 80 asks came back `tileError` and the
  main-thread path served them: the per-tile fallback, exercised for real.
- Pixels: the old route (canvas -> blur -> PNG -> bitmap, main thread) and the new one (canvas -> blur ->
  `transferToImageBitmap`, in a real Worker) read back identical in headless Chromium at blur 0, 1.0 and 1.5 px (0 of 262,144
  pixels differ; the canvas blur filter works in a Chromium worker).
- **Not measured:** the DWD path in a browser (no European tiles in the record; it shares everything but the transform, which
  is unit-tested), lightning tiles through the protocol (the app does not request them), Safari and Firefox (a worker without
  the canvas blur filter falls back by design, so those may see no change), a real phone, memory, three themes (the change
  draws the same pixels; only dark was run).

## Tests and gates

- +1 suite / +13 tests (`radarRecolorWorker.test.js`): the worker job for each transform against `radarRecolorCore`, blur and
  `smoothOff`, source cache and `cacheOff`, `tileError`, no-filter, cancel; the three handlers through the real registration,
  strikes reaching the registry, the kill, per-tile fallback, abort. Floor fragment
  `.github/ci-floors.d/fable-radar-recolor-worker.frontend.json` (on top of #807's +20 / +1). Kill in the inventory (TESTED).
- `scn_radar_worker.js` gains `FLAGS`, `KILL` and `RR_MODE`.
- Local gates: see the PR body (full Jest tree, ESLint ratchet, file sizes, build).
