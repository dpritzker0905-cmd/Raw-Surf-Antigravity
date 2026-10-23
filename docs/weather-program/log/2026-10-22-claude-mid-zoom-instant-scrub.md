# 2026-10-22 (claude, mid-zoom instant scrub, a subagent of the lead): instant scrub at the zooms people use

Written 2026-10-22T16:45Z. Branch `claude/eloquent-almeida-a2627f` from dev `95ca652a5`. Design and plan:
`docs/architecture/mid-zoom-static-frames.md`. Evidence: `evidence/mid-zoom-instant-scrub-2026-10-22.json`.

## Ask
The owner, through the lead: "I am not seeing the heatmaps serving instant scrubbing changes yet ... open a subagent to further
diagnose and resolve the instant scrub issue." His console (dev bundle 9ecac552, GFS waves, z3.5-4.4): 27 x 20 / 29 x 20 /
31 x 21 grids (clips of global_mid), "[SCRUB] [BACKEND CACHE] Instant re-index", no frame-store or static-frame activity.

## Instruments (new)
- `serve_synthetic.py --real-frames <bucket copy>`: the store holds the REAL published GFS waves run (115 frames copied from the
  public bucket, every sha256 checked against the index), so `/grid` clips the very numbers the CDN frames carry.
- `scn_static_crop_parity.mjs`: the app's own modules against that backend, node by node, on both seams.
- `scn_zoom_scrub.js`: one open per (zoom, arm), the owner's steps, per step the time to the correct frame and to the label,
  backend requests, mislabelled frames (must be 0), resident dims; the store and static-frame counters per session. Views:
  desktop 1280 x 800 and `owner` 844 x 390 (MapLibre sizes the world at 512 x 2^z px, so that window at z3.5-4.4 gives the
  owner's exact clips: 31 x 21 at z3.9, 26 x 19 at z4.4).

## Found (each in the design doc, section 1)
- A (confirmed): static frames served world boxes only (340-deg span); viewport boxes at z3.9-7 went to the backend.
- B (confirmed in code, but not the blocker): the guard refuses a same-hour world frame over a covering clip. The store never
  passes the guard; it refused because its resident had to be world-sized (`resident_not_this_set`, 9 of 14 per session).
- C: a fixed 150 ms debounce on a series miss (`timeline_scrub_deferred`).
- D: at mid zoom the series serves the WORLD frame (series pages over 15 deg ask the world box) while the exact `/grid` serves the
  clip, so the two take turns as the resident and a same-hour world frame after its clip is refused (the owner's "rejected
  181x82"). Only a 12-15 deg series page is a clip; it gets its own key.
- E: the server's clip cache (keyed by the snapped box) makes the clip extent depend on request history; never a node value.
- At open, mid zoom first shows the WORLD frame (store steps instant), and only a later trigger commits the viewport clip; from
  then on every step missed the store.

## Changed
1. `staticFrameCrop.js` + both static seams: a viewport box the resolver answers from `global_mid` is served as a crop of the
   static frame (kill `__RAW_DISABLE_STATIC_MID_CROP__`); crop series pages get their own key. Parity: 382 crops, 206,860 nodes,
   0 bad, 0 metadata mismatches.
2. `marineFrameStoreCrop.js` + small hooks in `marineFrameStoreRuntime.js`: the store shows a resident clip's window of the next
   frame, packed exactly (kill `__RAW_DISABLE_FRAME_STORE_CROP__`). Pinned byte-identical to the encoder on both lanes, 5 windows x
   3 themes; a control shows a world-texture cut is not.
3. Step 2 as briefed (the guard accepting a same-cell world frame over a clip) NOT done: it would ping-pong world and clip each
   step with a mask switch; with both seams answering the same clip there is nothing to let through.

## Measured (offline, the real run; `evidence/mid-zoom-instant-scrub-2026-10-22.json`)
Steps whose resident is a clip, key press to the correct frame on the GPU:

| view, zoom | before p50 / p95 | after p50 / p95 | `/grid` per step | mislabelled frames |
|---|---|---|---|---|
| owner-sized, z3.9 | 275 / 306 ms | 7 / 26 ms | 0.5 -> 0 | 0 |
| owner-sized, z4.4 | 277 / 300 ms | 5 / 49 ms | 0.5 -> 0 | 0 |
| owner-sized, z4.8 | 259 / 261 ms | 2 / 28 ms | 0.5 -> 0 | 0 |
| desktop, z5 | 252 / 273 ms | 5 / 26 ms | 0.5 -> 0 | 0 |

Crop show killed: 184-195 ms p50 (the 150 ms debounce plus the static crop). World zooms unchanged (p95 16-17 ms). Residuals:
desktop z6 (two clips from different boxes take turns, p95 212 ms) and z7-9 (regional tiles: plan in the design doc, section 6).

## Gates
- Jest: the crop, store, static and series suites 169/169 plus the new series test; the whole map + `src/tests` tree 4,955 pass,
  the 3 suites failing in the dot-free copy all fail on files outside it (`e2e/`, repo-root reads), none on this change.
- Mutants caught: a one-cell window offset (15 tests), `engineHolds` always true (2), the pad fraction 0.5 -> 0.6 (3).
- ESLint ratchet exit 0; LOC ratchet 0 regressed; secret scan clean.

## Owed
- ONE live read on the dev site after the merge deploys (the owner's z3.9-4.4 at his window size; `/api/health` before and after):
  `__RAW_STATIC_FRAMES__.crops` rising, `__RAW_FRAME_STORE__.crop.shows` rising, no `/grid` per step at those zooms.

## No served number changes
Crops are the resolver's own clip of the same product (parity 0 bad); the store's crop show writes the encoder's own bytes for
the clip. No SCOREBOARD row: nothing served moves.

# Pass 2 (2026-10-22 evening; branch claude/mid-zoom-pass2)

## Ask (the lead, after #459's live read)
(1) Wider build-ahead on desktop only, where it costs no egress; phones, Save-Data and 2g keep today's. (2) The desktop z6 residual:
measure on the real run first, fix the smallest cause. Added mid-pass: the owner's ZOOM-OUT defect (dev 8b396b11, beach: after a z4.45
scrub, a zoom-out to z3.25 kept the 31 x 20 clip; 11 backstop re-drives over ~35 s; self-heal only at z3.0).

## Found (design doc section 7)
- Zoom-out: two old rules. WebGLMarineLayer's dup-upload skip trusts its own last upload, which a frame-store show makes stale (the
  zoom-out's world commit never reached the engine offline); and the guard holds a 2-deg clip against the same-field world frame down
  to 60 % coverage. #459 made the clip resident at mid zoom, so the zoom-out hit both often; the rules predate it.
- Build-ahead: a far jump right after a new window misses when its frame is beyond +-24 or not yet packed; warm build rate ~28 packs/s.
- Desktop z6 residual: an artefact of a waves-only offline store (dynamic 1-deg products answered the series). With all four GFS
  marine layers, dev holds the 17 x 14 clip steady at z6.
- Instruments: Playwright routing disables the HTTP cache (pack builds re-download in the harness and in the live read); a scrub
  session crossing :30 mislabels correct frames (anchor at session start).

## Changed
- `marineZoomOutRelease.js` (new): `layerUploadIsStale` (wired in WebGLMarineLayer's `alreadyResident`; kill
  `__RAW_DISABLE_STORE_SHOW_RESYNC__`) and `clipNeedsFullCover` (one line in the guard's coverage test; kill
  `__RAW_DISABLE_CLIP_COVER_RELEASE__`). marineEngineDecisions.js 790 -> 792 lines (cap 800).
- `marineFrameStoreCrop.js`: `cropAheadCount` (every stored frame where the run fills, cap 144), `cropAheadChains` (2 there, 1
  elsewhere), `cropAheadOrder`; `marineFrameStoreCropShow.js` builds the queue from them (factory gains `idleFillBlocker`); kill
  `__RAW_DISABLE_CROP_AHEAD_RUN__`. Cursor re-centring tried and removed (it pushed Home's frame back).
- Instruments: `scn_zoom_out.js` (new), `scn_zoom_scrub.js` (`REQLOG`, `noaheadrun`, `mid`), README rows.

## Measured (offline, the real run, dev d1dbeed8b vs this branch on it; `evidence/mid-zoom-pass2-2026-10-22.json`)
40 sessions, 0 missed steps, 0 mislabelled frames, no session across :30:

| flow | dev | pass 2 | pass 2, one kill on |
|---|---|---|---|
| zoom-out z4.45 -> 3.25 / 3.6 (owner window) | clip stays the whole 15 s watch (80 / 95 % of the view), 4 of 4 | world frame on screen by the end of the zoom, 4 of 4 | clip release killed: stuck, 4 of 4; layer resync killed: fine, 4 of 4 (the same-product stash, which #458 keeps) |
| owner scrub z3.9 / z4.4, correct frame p95 | 52 / 56 ms | 15 / 15 ms | build-ahead run killed: 46 / 43 ms |
| desktop scrub z5 / z6, p95 | 51 / 40 ms | 16 / 15 ms | build-ahead run killed: 62 / 43 ms |
| crop packs not ready, per session | 3-6 | 0-1 | 3-6 |

Gates: Jest map + `src/tests` 5,470 pass (2 suites fail only in the dot-free copy: they read `program/` and `backend/` files);
mutants caught (the guard line, the layer wiring, the full-run count, the chain count); ESLint ratchet exit 0; LOC ratchet 0 regressed.

## Owed
- ONE live read on the dev site after the merge deploys: the owner window, a z4.45 scrub then a zoom-out to z3.25 (the world frame
  lands at the end of the zoom, no "kept resident" line), and z3.9 scrub steps (crop shows, no `crop_not_ready`); `/api/health` before
  and after.

## No served number changes
The guard and the layer decide WHICH served frame is drawn (the world frame of the same product, or a fresh upload of the same
bytes); the build-ahead packs the same frames earlier. No SCOREBOARD row.

## 2026-10-23 (18:45Z): regional z7-9 bundles, the client (the lead's brief after #465's live read)

**Why.** The map opens at z9 over florida_east_coast and one load cost ~34 s of `/grid_series` box work (the lead's live read,
16:33Z). Contract agreed with static-frames (#467 / #486 bundles); Decision 3 amendment: only boxes a tile FULLY covers.

**Changed.**
- `staticRegional.js` (new): tile pick (Step 3's smallest containing tile, tie -> /grid), the Step 3 window on the tile lattice
  (`latticeWindow`, factored out of `staticFrameCrop.js`), bundle fetch + slice + sha12 on the gzip slice + inflate, the Step 3
  JSON shape (`requested_bbox` = the snapped box), the `dynamicOnCovered` counter, telemetry `window.__RAW_STATIC_REGIONAL__`, an
  opt-in decision trace. Layers: GFS waves, swell_1, swell_2, wind_waves.
- `staticFrames.js`: both seams branch to the regional set for a box inside a pilot tile; the frame store keeps regional sets out.
- `marineSeriesStatic.js` + two call lines in `marineGridSeries.js`: the bounded manifest wait at the opening, and whole-page fills
  for small regional boxes (both measured as needed, see below). `backendWeatherServiceClient.js`: one line feeds the counter.
- Instruments: `scn_regional_client_parity.mjs` (new, `LAYER`), `scn_zoom_scrub.js` (`noregional` arm, `marineAll` per layer over
  the whole session, `REGTRACE=1`).

**Found by measuring.** (1) At the harness's default centre (-79.5) the view crosses the tile's -79 edge: a partial cover, correctly
not served; the live box is -81.65..-79.58 (centre -80.6, 28.1). (2) With the client on, only the `/grid` seam hit: every series page
was decided at ~3 s, before the products manifest landed (trace: 11 picks `manifest_not_loaded`), and queued to `/grid_series`.
Fixed with a bounded wait before the page dedup. (3) Then 0 backend asks, but day jumps took 170-220 ms: the windowed fill (sized for
15k-vector world frames) left page 1 to the per-hour path, and the scrub prewarm decides pages 1-2 at ~3.6 s before a focus exists.
Fixed with whole-page fills for small regional boxes (background pages too, <= 300 nodes a frame).

**Measured** (offline; `evidence/regional-bundles-client-2026-10-23.json`): parity 0 bad / 0 meta on every layer, positive control
fails as it must; z9 owner and desktop views: 0 marine backend asks per load (kill arm: 10-11 asks, 30-35 s), steps 26-45 ms vs
27-47 ms, 0 mislabelled frames; the partial-cover view behaves exactly as the kill arm.

**No served number changes.** The bundles are the stored tiles' bytes (parity at publish and here); which source answers changes,
not the values. Ships ON with the kill switch. No SCOREBOARD row.

**Owed.** ONE live read after the 19:45Z pilots publish lists the Florida sets: the opening view at z9 (0 `/grid_series` for the
marine layers, `__RAW_STATIC_REGIONAL__.series` > 0, `dynamicOnCovered` 0), `/api/health` before and after.

**Follow-up seen, not fixed here.** At the partial-cover centre (-79.5) both arms miss the Home step's exact frame (`exactMs` null),
as earlier dev runs did: pre-existing, outside this change.

## 2026-10-23 (20:00Z): #491 review fixes (the lead's 8 findings on b482566c)

Every finding was checked in the code before fixing; all 8 held. Fixes and the test that fails without each (12 mutants, 12 caught):
- **1:** failure cache with backoff, the real status, no re-pin from a cached failure;
- **2:** an unservable or failed page is not claimed;
- **3:** a 15 s fetch timeout;
- **4:** the hour-0 mini is never held, and once latest.json is read a box inside a pilot box is picked from it before the manifest
  (non-overlapping boxes, pinned to pilot_regions.py), so nothing waits;
- **5:** static pages bounded by SERIES_MAX;
- **6:** a box is claimed only if its snapped box is inside the data;
- **7:** one run per page;
- **8:** gzip errors caught, sha12 fails closed.

**Finding 6 reproduced offline** on us_southeast_midatlantic. After one partial-cover ask, the server answers the same snapped key's
full cover from a dynamic product. The previous rule would have served the bundle there; the new one refuses.

**Measured** (owner z9, the live box), regional vs kill:
- manifest 4 s late: first frame 0.5-1.1 s vs 1.6-2.4 s; 0 vs 4 series asks; 0 vs 19-22 s of backend time;
- manifest on time: 1.3-1.4 s vs 1.4-1.8 s; 3 one-frame minis (0.4 s) vs 9 asks (30-31 s).
- Before the pilot pick, a late manifest saved nothing, as the review predicted.

Evidence: `evidence/regional-bundles-client-2026-10-23.json` (`review_fixes`).

**Owed (unchanged):** one live read on the fixed head after the 19:45Z publish, with time to first frame and the request counts.

## 2026-10-23 (20:45Z): #491 second round (Reflection's parameters via the lead, platform notes, the 19:44Z saturation)

**Adopted:**
- backoff 30 s -> 2 min -> 10 min -> 30 min with Retry-After;
- 404/400 and sha12 mismatches are dead paths that re-pin once;
- 1.5 s manifest wait;
- fetch priority high (viewed page, /grid seam) and low (background);
- an all-miss regional page returns to /grid_series;
- no regional tile without crypto.subtle + DecompressionStream (nothing downloaded);
- surf mode, ICON and EURO never claimed (two guards, the combined mutant caught).

**Deviation:** the 8 s timeout is a floor; a bundle gets its size at 150 KB/s when that is longer (brazil_east ~2.5 MB would abort
at a flat 8 s on a slow link).

**Mutants:** 21 guards, 21 caught.

**Measured on the merge target** (full dev tree ceeeaf361 + branch; owner z9):

| | first frame | marine backend asks |
|---|---|---|
| manifest on time (regional) | 0.8-1.1 s | 0 |
| manifest on time (kill) | 2.4-3.9 s | 7 (40-43 s) |
| manifest 4 s late (regional) | 0.8-0.9 s | 0 |
| manifest 4 s late (kill) | 1.7-6.4 s | 4-6 (39-59 s) |

The on-time case lost its 3 one-frame minis: once latest.json is read every page is owned. Worst step 37-41 ms, 0 mislabelled.

## 2026-10-23 (20:54Z): #491 live read (the owed commitment), split into valid counts and unmeasured timing

**Setup.** The lead ran it from a signed-in browser with my read-only snippet. The private-beta gate keeps my harness off the hosted site. Dev site 2d7c062c (#491); health 0.46 s before, 0.63 s after; one scenario (the z9 Florida opening view, Waves on, four steps).

**Valid (counts):**
- **Waves:** one /grid_series, the hours=1 mini at 173 ms, and no full pages. The 16:33Z read had three waves pages at 5.1, 3.9 and 1.2 s.
- **Regional client:** one bundle (323,940 B), 109 series frames, 108 slices, 4 hours outside the run, dynamicOnCovered 0.
- **Other layers:** no swell, wind-wave or /grid marine asks in the ~35 s window. latest.json listed only the Florida waves set, and the swell layers asked nothing in that window.
- **First frame source:** the series path, 11x13.

**Not measured:**
- first-frame time (5,664 ms) and step times (1-2 s): the automation window ran rAF at ~1 Hz;
- the bundle download: served from the HTTP cache after an earlier click.

Time to first frame stays on the offline arms (0.8-1.4 s vs 1.4-3.9 s without bundles) until a real-browser read.

**Observation:** every tile pick in the trace was the pre-manifest pilot pick. The products manifest never reached the tile reader during the read, so without the review's pilot pick the bundle would not have served. Likely cause: in this flow nothing fetches the manifest. There was no marine /grid ask, and latest.json was already read, so no wait triggered it. That's not proven.

Evidence: `evidence/regional-bundles-client-2026-10-23.json` (`live_read_491`).

## 2026-10-23 (22:10Z): the regional client goes DARK by default (live parity failed)

**What happened:** static-frames' live bundle-vs-/grid_series parity for florida_east_coast failed. The lattice differs, 465 of 585 sub-box nodes are bad, and 8 metadata fields mismatch (sha12 fine). Offline it passed.

**Why dark:** the server may serve another product there, and #491 is live and ON. That makes the bundle a served-number change under D-001.

**Change (one commit):** `regionalBundlesOn()` now needs `window.__RAW_ENABLE_REGIONAL_BUNDLES__ === true` (`REGIONAL_BUNDLES_DEFAULT_ON = false`); the kill still wins. Tests and offline tools opt in.

**Checks:** Jest 5,738 pass (3 copy-only failures); ESLint exit 0; floor +1 test.

**Owed:** flip back after static-frames names the served product and the live parity passes.
