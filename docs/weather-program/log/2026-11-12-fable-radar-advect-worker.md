# 2026-11-12 · Fable · radar nowcast off the main thread

Branch `fable/radar-advect-worker` from dev `844782d6c`. Draft PR only, nothing merged. Client only: no served number, palette,
shader or markup changes, so no SCOREBOARD row. Same lane as `log/2026-11-11-fable-layer-animation.md` (#793), whose profile
named this as the radar item; the owner picked it on 2026-11-12 ("Pick the piece that is the best path toward state of the art").

## What changed

The advection nowcast (the frames after "now" on the radar layer) is a maplibre protocol handler, `advect-rv://`. For each tile it
fetched and decoded up to 18 observed RainViewer tiles, estimated the echo motion, warped the latest tile, PNG-encoded it and
handed the bytes to maplibre, which decoded them again. All of it ran on the main thread.

| Change | Module | Kill switch |
|---|---|---|
| The whole per-tile job runs in a worker and answers with a decoded `ImageBitmap`, which maplibre 5.24 uses as is (no PNG encode, no second decode) | `radarAdvectWorker.js`, `radarAdvectClient.js`, `radarAdvectWorkerFactory.js` | `window.__RAW_DISABLE_RADAR_ADVECT_WORKER__ = true` (main-thread warp + PNG, as before) |
| The per-tile pipeline moved, verbatim, out of `radarTileRecolor.js` into one module both paths call | `radarAdvectCore.js` | none (same arithmetic; pinned by tests) |
| A request maplibre aborts is cancelled in the worker (the main-thread path never looked at the abort signal) | `radarAdvectClient.js`, `radarAdvectWorker.js` | the same kill |

Fail-open: no `Worker` / `OffscreenCanvas`, a worker that reports it cannot do the job, or a worker script error all drop to the
main-thread path, for good in that page. An expired observed tile still gives a transparent tile, never a frozen echo.
Telemetry: `window.__RAW_RADAR_ADVECT_WORKER__` (`state`, `tiles`, `cached`, `blank`, `cancelled`, `fallback`, `ms[]`).

**Not changed:** the motion estimate, the warp, the frame list, the recolor handlers (HRRR, DWD, lightning: they still encode on
the main thread, a separate change), the frame hold and hard cut, the other `__RAW_RADAR_ADVECT_*` levers (passed to the worker).

## Evidence (offline: built client over `serve_synthetic.py`, RainViewer replayed from the 2026-11-11 record, `scn_radar_worker.js`)

Main-thread Long Animation Frames, total ms (blocking ms). "toggle" = radar switched on and 9 s of settling (the nowcast tiles
load here); "scrub" = six ArrowRight steps 700 ms apart and 2.5 s after. Phone = 390 x 844 dpr 3, CPU throttled 4x. Desktop =
1280 x 800, no throttle. The before arm is the same build with the kill switch set.

| view, theme | toggle before | toggle after | scrub before | scrub after |
|---|---|---|---|---|
| phone dark, run 1 | 7876 (1737) | 2973 (826) | 1420 (661) | 1236 (333) |
| phone dark, run 2 | 8679 (2165) | 2898 (1093) | 3949 (1092) | 942 (307) |
| phone dark, run 3 | 8556 (1629) | 1648 (392) | 2809 (818) | 1554 (390) |
| phone light | 8517 (1870) | 2667 (722) | 3350 (951) | 1472 (335) |
| phone beach | 8684 (2268) | 2046 (686) | 2234 (725) | 1003 (369) |
| desktop dark | 765 (19) | 71 (0) | 337 (118) | 0 (0) |
| desktop light | 442 (2) | 59 (0) | 204 (89) | 0 (0) |
| desktop beach | 517 (13) | 0 (0) | 364 (146) | 0 (0) |

- Phone toggle: 7.9-8.7 s of long frames before, 1.6-3.0 s after, in every run and theme. Phone scrub: lower in every pair, but
  the before arm ranges 1.4-3.9 s across three runs, so the scrub effect size is not pinned.
- Worker telemetry: 32 tiles (phone) / 80 (desktop) served, 0 fallbacks, 0 blank on phone. Worker time per tile on the throttled
  phone: about 0.9-1.3 s for the first 16 (decode + estimate), 4-9 ms for the next 16 (decoded tiles and motion reused).
- The worker also fetched less: 73 RainViewer requests against 198 on the main-thread path (one decode per observed tile).
- Pixels: the same RGBA through the old route (canvas -> PNG -> bitmap) and the new one (ImageData -> bitmap) reads back identical
  in headless Chromium (0 of 65,536 pixels differ, random colour and alpha). Unit tests pin that the RGBA fed to either route is
  the same. End screenshots differ between arms by 1.8-14.6 % of pixels, but two runs of the SAME arm differ by 1.5-5.7 %, so
  the screenshots do not separate the arms; the light and beach phone pairs (14.5 %) are above that floor and were not explained.
- **Not measured:** Safari and Firefox (pixel identity and worker support are Chromium-only evidence; older Safari has no
  OffscreenCanvas and takes the fallback by design), a real phone, the live site, memory (the worker keeps up to 256 decoded
  tiles and 64 warped tiles; the main-thread path kept 256 decoded tiles and 256 PNGs), and the desktop replay missed 18-44
  tiles that the 2026-11-11 record never held (same viewport both arms, so both arms saw blanks there).

## Tests and gates

- +1 suite / +20 tests (`radarAdvectWorker.test.js`): core equals the direct `radarAdvection` calls on all three warp branches,
  motion estimated once per pair, worker protocol (bitmap, cache, relative `/rv/` paths, blank, cancel, unsupported), client
  fallbacks and abort, and the kill through the real `advect-rv` handler. Floor fragment
  `.github/ci-floors.d/fable-radar-advect-worker.frontend.json`. The kill is in `killSwitch.inventory.test.js` (TESTED).
- Local: 668 of 670 suites; the two failures are 5 s timeouts in files this change does not touch
  (`AdminSupportDashboard.pagination`, `netlifyIconStoredTailScope`). Hosted CI is the authority.
- `check_eslint.js`: no rule over baseline. `wind-color/check.mjs`: 0 red lines (colour-blind part skipped: no local coloraide
  venv). File sizes: 0 violations (`radarTileRecolor.js` 594 -> 509). Build ok; the worker is its own chunk.

## Outside tools

Context7 (maplibre-gl-js docs): a protocol handler may return an `ImageBitmap` for an image request, "used as is"; confirmed in
the installed 5.24.0 source (`isImageBitmap(response.data)`). The ordering that put this first is in the 2026-11-12 research
note (Reflection, SubQ, Context7, papers) in the session notes folder; Reflection and SubQ ranked rain/pressure own-frames first.

## Open

- Recolor handlers (HRRR / DWD / lightning) still decode, recolor and PNG-encode on the main thread.
- The worker runs tiles one after another; a second worker or a per-tile time budget was not tried.
