# 2026-11-13 Fable (animation lane): the land file no longer comes back to the page from the worker

Client only, ON, kill `window.__RAW_DISABLE_LAND_WORKER_LOADER__ = true` (the plain URL of #861, as before). No served number.
Second step of #861 (`2026-11-13-fable-land-source-url.md`).

## What was left after #861
#861 gave the ocean mask's GeoJSON source the land file's URL, so the page stopped copying the land object TO the worker. But
maplibre-gl 5.24 sends a URL-loaded GeoJSON BACK to the page in its `loadData` reply (`geojson_worker_source.ts`: "Send data only
if it was loaded from a URL"; `geojson_source.ts` keeps it in `_data`). The page decodes that reply on its own thread. Offline
app harness, #861 build, phone profile (390x844, dpr 3, CPU 4x), waves toggle: the two land replies (50 m, 10 m) cost 435 ms of
decode + 831 ms of handling in all, 706 ms in the worst; CPU profile of the same window: `actor.receive` 317 ms self, the
library's `deserialize` walk 460 ms self. Everything else at the toggle was small (4 basemap tile reloads: 93 ms in all).
Nothing on the page reads the source's copy (no `getBounds` / `updateData` on `ocean-mask-source`; grep).

## The change
- `frontend/public/land-worker-loader.js` runs inside the map workers (`maplibregl.importScriptInWorkers`). It registers a
  worker-side protocol `rawland://<encoded absolute file URL>`: fetch the file in the worker, hand the tiler a FeatureCollection
  whose `features` is not enumerable. The tiler reads `.features` directly; the library's reply serialiser walks enumerable keys
  only, so the reply is `{type}`.
- `landMaskSource.js`: `startLandWorkerLoader(lib)` (once per page; states off / loading / ready / failed) and `landSourceData`
  gives `rawland://...` once the script is in the workers; before that, or if it fails to load, the plain URL (#861). A failure
  inside the worker is a source error, which the existing `armLandSourceFallback` answers with the object.
- `mapUtils.getSharedLandGeoJSON` starts it when the land file is first fetched.

## A fault found on the way, and fixed before this was pushed
The first build started the loader BEFORE `ensureMapLibreInit()` had called `setWorkerUrl('/maplibre-gl-worker.js')`. The library
builds its worker pool on the first message, so the pool became the bundled default worker, which in this build fails every
`setLayers` ("a is not defined"; the reason for v197's local worker file). Result in the offline app: no basemap, no land mask,
`querySourceFeatures('ocean-mask-source')` = 0 (49 with the kill), and NO error reached the fallback. The bare-page lab did not
show it (it uses the library's own dist build). Fix: `ensureMapLibreInit()` first, pinned by a test. Lesson: a bare-page lab
proves the mechanism, not the app; the app run with feature counts and a screenshot is what caught this.

## Measurements (all offline or bare page; this machine; compare within a table only)
App harness (`scn_worker_messages.js`, waves toggle, the 10 m file), page-thread cost of the land `loadData` reply:

| | loader on (decode + handling) | kill (= #861) |
|---|---|---|
| phone profile, run 1 | 0 + 13 ms | 262 + 521 ms |
| phone profile, run 2 | 0 + 6 ms | 242 + 505 ms |
| desktop | 0 + 1 ms | 37 + 111 ms |

Mask tiles are the same in both arms (4 tiles 3.04 MB phone; 6 tiles 4.06 MB desktop); `querySourceFeatures` 49 = 49 (desktop),
32 = 32 (phone). Land tiles back after the toggle, phone: 1.9 / 2.3 s (on) against 4.2 / 3.4 s (kill) in this scenario.
The app's WORST long animation frame over the whole toggle did not move measurably in 2 runs per arm (desktop 388 / 346 on, 289 /
363 kill; phone 913 / 1070 on, 621 / 1418 kill): other toggle work is as long, and run-to-run spread is larger than the gain.

Bare page (`land-cache-lab/run.js`, system Chrome, HTTP cache ON, 10 m file, cold / warm twice), worst frame gap in ms:

| | worker loader | URL (#861) | object (before #861) |
|---|---|---|---|
| CPU 4x | 107 / 95 / 112 / 101 | 708 / 928 / 811 / 792 | 2159 / 2273 / 2044 / 1557 |
| no throttle | 34 / 18 / 34 / 24 | 178 / 114 / 187 / 193 | 355 / 261 / 249 / 230 |

Land drawn, CPU 4x: 1295-1406 ms (loader), 2204-2790 (URL), 2967-3701 (object). The page is still, and the screenshot hash is
the same in all 24 runs. In the app (animated water), among pixels that are still across two kill runs, the loader runs differ
only inside the animated water and the panels over it; land and coastline are identical (difference map, scratch).

## Tests
+11 in `landMaskSource.test.js` (when `rawland://` is used; once per page; a failed script; the kill; the fallback; the start
order in mapUtils; the worker script run as the worker runs it; three pins on the library behaviours it relies on). Kill listed
in `killSwitch.inventory.test.js`.

## Not done / not verified
- A real phone, Safari, Firefox. The deploy (Netlify) serving `/land-worker-loader.js`: not checked; no CSP is set on deploys.
- A silent failure of the mechanism (the tiler seeing no features) would leave the land unmasked with no error. Covered only by
  the three library pins and the offline run; there is no runtime check.
- The 10 m file is still parsed on the page for the engine's own mask.
