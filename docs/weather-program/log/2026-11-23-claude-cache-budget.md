# 2026-11-23 · one byte budget across the map client's caches (claude, branch `claude/frame-cache-budget`)

Client-only perf fix: no served number, no fetch rule, no commit rule changes. ON, kill `window.__RAW_DISABLE_CACHE_BUDGET__ = true`.

## Ask

- **The lead** (P1 from the Fable inspection, `SOTA-GAP-INSPECTION-2026-11-23.md` pass 5): "The JS heap goes from 106 MB after
  load to 1.8–2.1 GB at the end of cycle 1, then rests at 0.8–1.1 GB ... it's an unbounded or oversized cache, not a leak. On a
  phone this would crash the tab."
- **What done looks like** (the lead):
  1. measure which caches hold it;
  2. put a total byte budget across caches (an LRU by bytes, not entry count), smaller on handheld devices, evicting off-screen
     models and layers first;
  3. keep instant scrub for the current layer and model.
- **How to ship and test it:** ON with a kill switch; offline replay only; heap before/after for the same flow on desktop plus a
  375 px emulation, with scrub latency; the design put to SubQ, Reflection and LongCat; both Jest trees twice, the build, the eslint
  ratchet; a PR to dev.

## Instruments (committed with this PR)

- **`frontend/scripts/offline-backend/scn_heap_cycle.js`: the inspection's flow, offline.**
  - **The flow:** for each of GFS, EURO and ICON × Waves, Swell, Wind, Gusts, Currents, Satellite and Air Temp, select the layer,
    PageUp ×14 (450 ms apart), then Home.
  - **Data:** a synthetic store plus a local CDN. The raster sets (gusts, currents, cloud, temperature) come through a capped,
    disk-cached proxy of the public frame bucket, so each object is fetched once. The live backend is never touched.
  - **Readings after each cycle:**
    - `usedJSHeapSize` (what the inspection read);
    - the retained heap after a forced GC (CDP `HeapProfiler.collectGarbage` + `Runtime.getHeapUsage`, JS heap and ArrayBuffer
      backing apart);
    - a 1 s peak sampler;
    - the budget's own report.
  - **Scrub latency:** per marine step, the key to the resident at that hour. Also the TRUE latency, from a page-side log of every
    resident change, so a late frame is timed rather than counted as missing.
- **`frontend/scripts/offline-backend/heap_census.cjs`: who holds the bytes.**
  - It streams a `.heapsnapshot` of any size into typed arrays (no `JSON.parse`).
  - It charges every object to the nearest closure variable, or `window` property, on its shortest path from the root.
  - In an UNMINIFIED build, a module-level cache is named by its variable.
  - Positive control: a planted 46 MB `bigCache` was attributed as `ctx:bigCache` 46.2 MB.

## Who held the heap (dev 70e3efef1, desktop, after one cycle; the census on an unminified build)

- **Readings:**
  - `usedJSHeapSize` 1,014-1,031 MB;
  - retained after a forced GC ~950 MB (JS 376-410 + ArrayBuffer backing 529-562);
  - the census's self total 985 MB.

| holder | MB | bound before this PR |
|---|---|---|
| `window.__DECODED_OM_TILES__` (decoded .om fields; only the infobox reads them, each card gated on its own layer) | 280 | 150 entries FIFO; each field stored twice on the main thread (direct + its own BroadcastChannel echo, a structured clone) |
| frame-store runtime `rt` (CPU side of the GPU frame store) | 92 | `enforceBudget` coded, never called |
| `_perModelHourCache` + `vecs` (the lazy truth-tag closure keeps a second vectors array) | 91 + 29 | 50 keys |
| `_seriesCache` | 91 | 48 pages, count only (PF02's byte cap is behind a build flag that is off) |
| raster `_fields` + `_anchors` | 65 + 34 | 6 + 4 entries |
| wind (`WIND_CACHE` uncapped, `windGridResponses`, engine) | ~64 | none / 16 |
| staticFrames `_lru` | 19 | 12 |
| .om decoder library (WASM 66 + states 30) | 96 | not ours |

## The fix

- **The budget: `cacheBudget.js` + `cacheBudgetAdapters.js` + `decodedOmBudget.js`.**
  - One byte budget across the decoded .om fields, raster fields and anchors, marine series pages, per-hour grids, frame-store sets
    and wind grids.
  - Each adapter lists `{ key, bytes, model, layer, lastUse, pinned, id }` in O(1) per entry and never builds a lazy series frame.
  - When over budget, one coalesced idle pass drops entries down to 80%:
    1. off-screen first;
    2. then on-screen entries that are not pinned;
    3. within a class by rebuild cost per MB, then least recently used.
  - The cost ladder: 0 decoded copies, 1 raster, 2 series and store sets, 3 per-hour /grid grids, 4 wind grids.
  - Pins: the active view's working set.
  - Aliases count once (by id).
  - Small devices get a reserve: the most recent 32 MB of cost-4 off-screen entries go after the on-screen ones.
- **Budgets:** 192 MB desktop, 128 MB handheld (`isHandheldDevice` or `deviceMemory <= 4`).
  - Levers: `__RAW_CACHE_BUDGET_MB__`, `__RAW_CACHE_RESERVE_MB__`.
  - Telemetry: `window.__RAW_CACHE_BUDGET__.report()` gives bytes per cache, pinned and on-screen apart, drops by cache and class,
    and a ring of passes with their duration.
- **Root fixes:**
  - the .om echo no longer stores a second copy;
  - the frame store's sets are dropped whole, through the same path that releases their GPU array.
- **The active view:** `useWeatherState` tells the budget the model, layer and hour.

## Review (the lead's ask; the owner approved each send)

- **Round 1, the design.**
  - LongCat, Reflection and SubQ each replaced my 15 s wall-clock guard with explicit pins.
  - They asked for cheapest-first within a class, identity dedupe, a synchronous `drop()` returning freed bytes, the kill switch read
    per pass, an enforce after registration, recency stamped on read, and calibration.
  - All were adopted.
- **Round 2, the measured outcome and the fix choice.**
  - SubQ and Reflection agreed:
    - ship desktop as is;
    - on phones, keep a capped reserve of small, slow-to-rebuild wind grids ahead of the active layer's non-pinned prefetch;
    - 128 MB as the handheld floor;
    - report completion and censored latency;
    - check the byte accounting.
  - All were adopted (the reserve is above; the replay prints completion and censored percentiles; the calibration is below).
  - The LongCat submit failed on the network ("billing outcome may be uncertain"). Not retried.

## Measured: the same build, budget ON vs killed (`__RAW_DISABLE_CACHE_BUDGET__`); the inspection's flow, 2 cycles per session

- **Retained after a forced GC (JS + ArrayBuffer), cycle 1 / cycle 2, final build:**
  - desktop ON **330 / 352 MB** vs killed 884 / 1,003;
  - phone (375 px, handheld) ON **286 / 339 MB** vs killed 779 / 946.
- **Across the four ON/killed desktop runs:** ON 330-417 / 333-408 MB vs killed 834-925 / 1,003-1,097.
- **`usedJSHeapSize` (the inspection's reading):**
  - desktop ON 471-533 MB vs killed 937-1,162;
  - phone ON 295-370 MB vs killed 842-1,150.
  - Peak without GC: desktop ON 790-990 MB vs killed 870-1,100 (transient garbage); phone ON 375-512 MB vs killed 520-674.
- **True scrub latency** (key to the frame drawn at that hour, logged per render; p50 / p95 ms over steps reached, plus the number
  reached), final build:

| | phone ON | phone killed | desktop ON | desktop killed |
|---|---|---|---|---|
| marine (active layer), cycle 1 | 24 / 63, 65 of 84 | 20 / 78, 65 | 22 / 300, 74 | 23 / 396, 73 |
| marine, cycle 2 | 23 / 50, 65 | 20 / 50, 66 | 22 / 287, 74 | 23 / 289, 81 |
| raster, revisit (cycle 2) p50 | 177 | 137 | 236 | 172 |
| wind, revisit (cycle 2) p50 | 66, 22 of 42 | 7,907, 27 | 75, 33 | 66, 23 |

- **The marine scrub on the active layer and model is unchanged.**
- **A raster layer the user left is ~40-60 ms slower at p50 on its revisit**: its fields were dropped while off-screen, the intended
  trade.
- **Earlier builds, kept for the record:**
  - A 64 MB handheld budget dropped the active view's own entries (91 per cycle, pinned over budget 9 times) and doubled the
    marine p95.
  - A cost ladder where wind grids were as cheap as raster fields made desktop wind revisits ~7.8 s; the ladder fixed desktop.
  - Strict off-screen-first left phone wind revisits at ~7.8 s; the reserve fixed them.
- **Pre-existing, not from this PR:**
  - A COLD wind step costs ~7.8 s in every arm, budget or not.
  - EURO Swell (no frame store) is ~230-290 ms a step and noisy in both arms (one killed run never reached any of its 28 steps).
  - Long tasks per cycle vary run to run in both arms (ON 0.6-7.9 s, killed 0.5-7.8 s); no consistent growth.
- **Calibration** (fix build, unminified, census vs the budget's own report, after one cycle):
  - raster fields 47.5 vs 47.5 MB;
  - frame store 37.2 vs 39.1;
  - per-hour grids 18.3 vs 16.5 (including the closure's `vecs`);
  - wind 32.7 vs 26.9.
  - The series page cannot be checked this way: its frames are shared with the engine's resident grid, which first-path
    attribution charges instead.
  - Estimates err high, i.e. eviction comes earlier, never later.

## Not done, and follow-ups
- **Not measured:** a real phone; iOS Safari; the live box (never load-tested). One machine; n = 1-4 sessions per arm.
- **The cold wind step (~7.8 s)** is the real cost behind a cold wind revisit.
- **Packed typed-array marine frames** (the lead's pass-10 lead): the per-hour and series grids are ~160 B per cell as objects.
  That changes the engine's grid interface; a PR of its own.
- **Not under the budget:** `windGridSeries` pages, `windStaticFrames` raw bytes, staticFrames `_lru` (12 entries; 19 MB measured),
  and the .om library's own states.
