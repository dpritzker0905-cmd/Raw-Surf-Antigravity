# 2026-11-13 Fable (animation lane): the worker-message cost at the waves toggle is ONE message; the land source is given a URL

Follows `2026-11-13-fable-gpu-cost-and-mask-upload.md`, which left "about 2.8 s of map-library worker messages on a throttled
phone at the waves toggle, payloads not identified". The coordinator's brief (2026-11-13 02:51 EST): "Trace which messages they
are: source updates, setData calls or tile reloads. Find the smallest change that avoids them, measure before and after, and keep
it behind a kill switch." Client only; no served surf number moves.

## Tool
`frontend/scripts/offline-backend/scn_worker_messages.js`: wraps every Worker the page creates. For each main-to-worker request it
records the type, the source, a byte estimate and the duration of the `postMessage` call; for each reply, the bytes, the time the
browser takes to decode it and the time the library's handler takes. Offline (synthetic backend, replay cache).

## What flows at the waves toggle (desktop 1280 x 800, zoom 3.2; phone = 390 x 844, CPU 4x)
| message | count | main-thread cost, desktop | phone |
|---|---|---|---|
| `loadData` for `ocean-mask-source` (the land GeoJSON, sent as an OBJECT) | 1 | **274 ms in one postMessage** | **1360 ms** |
| `loadTile` replies for `ocean-mask-source` (4.1 MB / 3.0 MB) | 6 / 4 | decode 1 + handler 7 ms | 10 + 41 ms |
| `reloadTile` replies for the basemap `composite` source (2.8 MB / 1.7 MB) | 6 / 4 | 7 + 10 ms | 13-26 + 88-92 ms |
| `updateLayers`, glyph requests | few | about 0 | about 0 |

- **The cost is in SENDING, not receiving.** The profile line in the earlier log (`actor.ts:103`) is `sendAsync`. All replies
  together cost about 25 ms on desktop and 150-200 ms on the phone.
- **The basemap tiles are reloaded** (adding the two inland-water layers on the basemap's vector source makes the library
  re-parse its visible tiles). Real, but about 100 ms of main thread on the phone: not the target.
- **The one message is the land object.** In these runs it was the 18 MB 10 m Natural Earth file, not the 2.7 MB 50 m one:
  `OceanMask` upgrades its mask to 10 m the first time the map is at zoom 8 or closer, whether or not a marine layer is on, and the
  harness opens the map zoomed in. The app opens at zoom 7, and going to a spot flies to zoom 14, so a session that has looked at
  any spot is in this state. With the 50 m object (one run where the 10 m file had not arrived) the same call took 32 ms on desktop.

## The change: `landMaskSource.js` (ON; kill `window.__RAW_DISABLE_LAND_SOURCE_URL__`)
The GeoJSON source is given the land file's URL instead of the parsed object, so the library sends a string and its worker
fetches and parses the file. `mapUtils` now records which URL each shared loader actually read (50 m or its 110 m fallback; the
local 10 m copy or the CDN). `OceanMask` uses the URL only when its mask kept every feature of that file (the mask keeps polygons
only; both shipped files are polygons only, pinned by a test; no mask layer reads a feature property). Applied at the two places
the object was handed over: `addSource`, and the 10 m upgrade's `setData`. If the worker cannot load the file, the source's error
hands it the object once (`armLandSourceFallback`). The last-resort remote fallback at mount is unchanged.

## Result (same build, the change against its own kill; three alternating pairs each)
| | URL | object (kill) |
|---|---|---|
| desktop: the `loadData` postMessage, ms | 0 / 0 / 0.1 | 234.6 / 253.2 / 247.6 |
| desktop: worst long frame in the toggle, ms | 517 / 517 / 528 | 685 / 589 / 647 |
| phone: the `loadData` postMessage, ms | 0.4 / 0.3 / 0.9 | 1364.6 / 1450.1 / 1419.2 |
| phone: worst long frame in the toggle, ms | 2397 / 2294 / 2341 | 3081 / 3350 / 3239 |
| phone: land tiles back, ms after the toggle | 8721 / 6586 / 8280 | 5268 / 5456 / 5256 |
| desktop: land tiles back, ms after the toggle | 3234 / 2951 / (685, 50 m run) | 2878 / 2126 / 2793 |

- **Same mask.** Same number of land tiles (6 / 4) and of rendered land features (49 / 32) in both arms. Screenshots at the
  English Channel (zoom 5): every pixel that is still between two object runs and differs in the URL run is animated water or
  translucent chrome over it; the land and the coastline are identical (`where.png`, scratch).
- **The cost: the land fill arrives later in the harness** (about 0.1-0.8 s on desktop, 1.3-3.4 s on the phone). The harness
  routes every request, which turns the browser's HTTP cache off, so the worker's fetch of the 18 MB file is a full re-delivery
  there. In a real browser the file was read moments earlier by the page (CDN: 4.6 MB brotli, `max-age=604800`, CORS `*`), so the
  fetch should be a cache read. **That is not measured.** If the cache misses, the worker downloads 4.6 MB again.
- **Total long-frame time is not a usable metric on the throttled phone**: it equals the observation window (about 15 s of 16 s)
  in both arms because every frame is long at 8 fps. The earlier log's "the toggle as a whole is not faster" rested on it. The
  worst single frame is the number that moves.
- Not counted above: the library's own deep copy of the object before the postMessage (990 ms in the earlier phone profile),
  which the URL also avoids; it was not re-profiled.

## Tests
+13 in `landMaskSource.test.js` (when the URL is used, the kill, the error fallback and its disarm, which file each loader
reports, the two shipped files hold polygons only, the two `OceanMask` sites). Kill in the inventory (TESTED). 338 passed locally
across the 19 neighbouring suites before the 10 m extension; 87 across 6 after it. `check_eslint.js` passes.

## Not measured
A real phone; a real browser cache (see above); Safari and Firefox; memory; the zoom-8 upgrade's `setData` on its own (the same
code path, measured only through the toggle); a style reload (theme switch), which re-adds the source through the same call.

## Not done
The basemap tile reload at the toggle (about 100 ms on the phone). The 10 m file is still downloaded and parsed on the main thread
for the engine's own mask whenever the map is at zoom 8 or closer, marine layer or not.

## Addendum (same day, 03:58 EST): the later land fill was the harness; with the browser cache ON the URL is not later
The coordinator asked for the real-cache case, outside the routing harness. The app cannot run unrouted (it would call the live
backend), so this isolates the mechanism: `frontend/scripts/offline-backend/land-cache-lab/` is a bare page with the app's
map-library build that reads the 10 m CDN file the way the page does (`fetch` + `json`), waits 1.5 s, then adds a GeoJSON source
with either the file's URL or the parsed object, plus one fill layer, at the same view (1280 x 800, zoom 3.2). System Chrome,
headless, a persistent profile, no request routing: cold = a new profile, warm = the same profile relaunched. Two runs per cell.

| ms after `addSource` | URL, cold | URL, warm | object, cold | object, warm |
|---|---|---|---|---|
| desktop: land drawn | 2677 / 2456 | 2593 / 2498 | 2275 / 2202 | 2249 / 2204 |
| desktop: worst frame gap | 332 / 269 | 228 / 221 | 574 / 589 | 589 / 643 |
| CPU 4x: land drawn | 3542 / 3187 | 3543 / 3219 | 4510 / 4105 | 4419 / 4532 |
| CPU 4x: worst frame gap | 1062 / 920 | 1026 / 910 | 2874 / 2555 | 2768 / 2933 |

- **Desktop: the URL draws the land 0.2-0.4 s later** and the worst frozen frame is about 0.25 s instead of 0.6 s.
- **CPU 4x: the URL draws the land 0.9-1.3 s EARLIER** and the worst frozen frame is about 1.0 s instead of 2.8 s. The seconds of
  delay in the app harness were the harness re-delivering the file with the cache off.
- **Cold equals warm in the URL arm**, though the page's own fetch of the file took 0.8-0.9 s cold (4.57 MB transferred) and
  0.33-0.48 s warm (0 bytes transferred): the worker's fetch right after the page's is a cache read even in a brand-new profile.
  This is inferred from the timing; the worker's request itself was not visible to the page's network log.
- Limits: a bare page, not the app (no basemap, no wave engine competing for the main thread); desktop Chrome only; the CPU
  throttle may not slow the worker thread the way a real phone would; a real phone's smaller HTTP cache is not tested (the
  entry is 4.6 MB).
