# 2026-10-23 (claude, GPU-frames session): boot prewarm, fetch priority, explicit SW bypass, bundle cache headers

Written 2026-10-23. Branch `claude/frame-fetch-priority`, first from dev `ff5b7066f`, then merged with dev `e7fc9efda`.
Evidence: `evidence/boot-prewarm-2026-10-23.json`. Client only. No served number changes. Each change is ON with a kill switch.

## Ask
- The lead, 2026-10-23: client perf and robustness items from the skills audit: "ship ON, each with a kill switch,
  offline-measured, then one live read." Items 1, 2 and 4 are in this PR. Item 3, field telemetry, is a separate branch.
- After the live trace of dev, the lead wrote: "THEN open your prewarm work as a PR. First Waves frame ~1.45 s -> ~0.67 s p50
  offline is a good win."

## Change
**Fetch priority (item 1)** is in `staticFrames.js`, `marineFramePrefetch.js`, `marineFrameStoreRuntime.js` and
`marineFrameStoreCropShow.js`.
- **'high'** goes to the frame on screen: seam A's exact frame, a crop commit or show miss, and the first two prefetch slots.
- **'low'** goes to the warm sets, the run fill, crop build-ahead and the boot prewarm.
- The worker forwards the priority to its own `fetch`. A test runs the worker's real source in a fake worker scope.
- Kill: `__RAW_DISABLE_FETCH_PRIORITY__`.
- **Chrome 154 trace, before building:** a dedicated (Blob) worker's fetch gets the same scheduling priority as the main
  thread's: low -> Low, none -> High, high -> High. The probe is `probe_fetch_priority.js`.
  - It does not show a bandwidth effect: a local HTTP/1.1 server cannot. That needs HTTP/2-3, so it is the live read.

**Boot prewarm (item 2)** is `staticFrames.prewarmStaticFrames`, called at MapPage mount.
- It spawns the inflate worker, reads `latest.json` and pins the persisted model's waves index.
- In idle time it loads the current hour's frame and builds its vectors, at 'low' priority.
- It runs once per page load. It skips Save-Data, 2g, and the EURO/ICON world sets (#461).
- Kill: `__RAW_DISABLE_STATIC_FRAMES_PREWARM__`.
- `index.html` gains `<link rel="preconnect" href="%REACT_APP_SUPABASE_URL%" crossorigin>`. The deployed bundle bakes in
  the project origin (read 2026-10-23).

**Service-worker bypass and the HTML shell (item 4)** are in `public/service-worker.js` and `public/_headers`.
- The SW now leaves Supabase `/storage/v1/object/public/(weather-frames|weather-products|*-frames)/` alone, by host + prefix.
  Before, it skipped them only because the name holds `/weather`.
- `/index.html` is `no-cache`, not `no-store` (no-store keeps the page out of the back/forward cache).
- **Finding, read on dev 2026-10-23:** the catch-all `/*  Cache-Control: no-cache` rule won over `/static/js/*` and
  `/static/css/*` `immutable` on Netlify.
  - The deployed `main.*.js` read `Cache-Control: no-cache`, so every load revalidated every hashed chunk.
  - A 304 cost 347 ms from here, serial for the lazy map chunk.
  - `/index.html` was never actually served `no-store`.
  - The catch-all now sets no Cache-Control and keeps `X-Content-Type-Options: nosniff`.

## Evidence
- **First Waves click, offline** (`scn_first_waves.js`):
  - Setup: one production build, the synthetic GFS waves run (115 frames, 3-hourly) published as CDN frames, 340 ms per CDN
    object, desktop at z3.2, 3 rounds per arm interleaved, a fresh browser each.
  - Click 3 s after the map is up: first full-resolution frame p50 **660 ms on vs 1491 ms killed** (max 844 vs 1575).
  - Click as soon as the map is up: p50 **670 vs 1432 ms** (max 813 vs 1635).
  - The killed arm also asked `/grid_series` once after the click. The on arm asked the backend nothing.
  - Caveat: the probe's static-frame flag read false on both arms, so this does not say which path drew the frame. The
    number is click-to-frame either way.
- **Tests:** 123 tests across the frame-store, static-frame and SW suites are green. Mutants: 17 of 17 killed. The
  mutants are each kill switch removed, each priority dropped or flipped, prewarm's once / Save-Data / eligibility
  rules, the SW rule, and both header rules.

## Not done, owed
- **The one live read after deploy:**
  - frame requests' priorities in a trace (HTTP/2-3, the bandwidth effect);
  - `main.*.js` served `immutable`;
  - the first Waves frame on the owner's window.
- `windStaticFrames.js` (#468, the wind session's file) still fetches at the default priority. Left alone. Told the lead.
