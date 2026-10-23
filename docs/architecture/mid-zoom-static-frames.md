# Instant scrub at the zooms people use: static crops, the store's crop show, regional sets (2026-10-22)

Owner, 2026-10-22: "I am not seeing the heatmaps serving instant scrubbing changes yet ... open a subagent to further diagnose
and resolve the instant scrub issue." This document holds the diagnosis, what PR 1 changes, and the plan for what follows.
Numbers are offline on the REAL published run (the 115 GFS waves frames of `v1/gfs/marine/waves/global_mid/index/20261022T060000Z`,
copied from the public bucket, every sha256 verified) served by the real backend app (`serve_synthetic.py --real-frames`),
unless a line says live.

## 1. Diagnosis (each claim with its instrument)

**A. Static frames never served the zooms people use.** `staticEligible` required a request box spanning 340 degrees or more.
At z3-z9 the map asks `/grid` and `/grid_series` for its VIEWPORT, so neither static seam ran and every step went to the 1-CPU
box. Measured (`scn_zoom_scrub.js`, today's dev bundle):

| view | zoom | resident | correct frame p50 / p95 | backend per step |
|---|---|---|---|---|
| desktop 1280 x 800 | 2, 3, 4 | world 181 x 82 | 3-7 / 16-17 ms (store) | 0 |
| desktop | 5 | 25 x 21 clip | 6 / 273 ms | 0.5 `/grid` |
| desktop | 7 | 11 x 10 regional | 519 / 1,646 ms | 1.0 |
| desktop | 9 | 9 x 9 regional | 8 of 10 steps never correct in 8 s | 5.1 |
| owner-sized 844 x 390 | 3.9 | 31 x 21 clip (his console's grid) | 275-306 ms per far step | 0.5 `/grid` |

The owner's console (z3.5-4.4, 27 x 20 / 29 x 20 / 31 x 21) is the owner-sized row: a ~28 x 14 deg viewport, which the resolver
answers from `global_mid` clipped (`grid_resolver` Step 3.6, `mid_res_tier.try_serve_mid_res_tier`). Offline the backend is fast;
live, each of those steps waits on the box (seconds under load).

**B. The no-downgrade guard refuses a same-hour world frame over a covering clip** (`marineEngineDecisions.isCoarseGlobalGrid`
calls any world grid with cells over 1 deg "coarse", so the 2-deg world frame counts as a downgrade from a 2-deg crop of the SAME
product). True, but it is not what stops the store: a store show never passes the guard. The store refuses because its resident
check needs the engine texture to be the world frame's size (`noteCommitted` records `dims_differ`, every step then misses with
`resident_not_this_set`; measured 9 of 14 shows per session at z5). On a scrub (a different hour) the guard does not apply at all:
a world series frame DOES replace a clip, and the exact clip then replaces it again (two commits, two masks per step).

**C. A fixed 150 ms debounce.** A step whose hour is not in the series cache goes `timeline_scrub_deferred` -> a 150 ms timer
(`useMarineDataFetcherCore.enqueueMarineUpdate`) -> the per-hour fetch. With the backend out of the way (PR 1) that timer is most
of what remains of a mid-zoom step (190 ms measured = 150 + ~40).

**D. At mid zoom the series and the exact frame are DIFFERENT products of the same field.** A series page over 15 deg asks the
WORLD box (`marineBboxGeometry.normalizeRequestBbox`), so the series serves the world frame (already static), while the exact
`/grid` asks the viewport (up to 40 deg) and gets the clip. Per step the world frame (series, instant) and the clip (exact) take
turns as the resident, and a same-hour world frame arriving after its clip is refused (the owner's "No-downgrade: kept resident
27x20 ... rejected 181x82 at zoom 3.9"). Only a 12-15 deg series page is itself a clip; it now gets its own key
(`staticFrames.staticCropPageKey`) so it never stands in for another page.

**E. The server's clip cache makes the clip extent depend on request history.** `mid_res_tier._CLIP_CACHE` is keyed by the
SNAPPED box: a second request with the same snapped box but another span gets the first request's padded window (seen offline:
`-103.8705` where the request's own arithmetic gives `-103.8706`). Same lattice in that case; in general an edge row or column can
differ, never a node value. The client mirror is deterministic per request, which is the right reference.

## 2. The result (offline, the real run; evidence `docs/weather-program/evidence/mid-zoom-instant-scrub-2026-10-22.json`)

Steps whose resident is a clip (the band where the store used to miss), time from the key press to the correct frame on the GPU:

| view, zoom | before p50 / p95 | after p50 / p95 | `/grid` per step | mislabelled frames |
|---|---|---|---|---|
| owner-sized, z3.9 (31 x 21 clip) | 275 / 306 ms | **7 / 26 ms** | 0.5 -> 0 | 0 |
| owner-sized, z4.4 (26 x 19) | 277 / 300 ms | **5 / 49 ms** | 0.5 -> 0 | 0 |
| owner-sized, z4.8 (21 x 15) | 259 / 261 ms | **2 / 28 ms** | 0.5 -> 0 | 0 |
| desktop, z5 (25 x 21) | 252 / 273 ms | **5 / 26 ms** | 0.5 -> 0 | 0 |

The store's crop show killed (`__RAW_DISABLE_FRAME_STORE_CROP__`) leaves 184-195 ms p50 (the 150 ms debounce plus the static
crop): crops remove the backend, the crop show makes it instant. World zooms are unchanged (p95 16-17 ms). Offline the backend
answers in tens of ms; live each of the before steps waited on the 1-CPU box. Residuals: desktop z6 (12-15 deg views: the
series' own clip and the exact clip are cut from different boxes and take turns, p95 212 ms) and z7-9 (regional tiles, section 6).

## 3. Static crops (no served number changes)

`staticFrameCrop.js` mirrors the mid tier's clip step for step (get_snapped_bbox, the proportional pad, clip_lattice) and both
static seams answer such boxes with a crop of the pinned frame. It is used only where the resolver provably answers from
`global_mid` (span over 12 and at most 40 deg, no antimeridian crossing, no regional tile in the products manifest that the
request is not wider than; for a model other than GFS no overlapping regional tile at all, because an estimated item is served
whatever the width and ICON / EURO carry estimated regional tails; no manifest = no crop). Crop series pages get their own key (D). Kill:
`window.__RAW_DISABLE_STATIC_MID_CROP__ = true`.

Parity (`scn_static_crop_parity.mjs`, the app's own modules against the real backend over the published run): 382 crop requests
on both seams, 206,860 nodes, **0 bad, 0 metadata mismatches, max error 0**; the rules never claimed a crop the backend did not
answer from `global_mid` (0 of 382), and refused 93 boxes it did answer that way (spans over 40, near tiles: safe, they ask
`/grid` as before). Within the 40-deg band the server never thins a series page (80,000-vector budget), so a full-resolution crop
IS its `/grid_series` frame.

## 4. Step 2 as briefed (teach the guard) is NOT done, on purpose

Accepting a same-cell world frame over a covering clip would let the series' world frame and the exact clip of the SAME hour
replace each other on every step (D), with a mask switch each time: the ping-pong the guard exists to stop. Today the guard's
refusal is what keeps the clip once it is in, and with the store's crop show (section 4) a step puts the next hour's clip on
screen before the series' world frame arrives, which the guard then refuses (same hour, a covering clip). So the guard stays as
it is, and the store is taught clips instead.

## 5. The store's crop show (exact bytes)

A world texture's sub-rectangle is NOT the encoded clip: land extrapolation (2 rings) and direction dilation (unbounded BFS) read
neighbours. Measured on the real frame over 295 crops: 9,550 of 142,817 texels differ (6.7 %); every ocean or near-ocean
difference lies within 2 cells of the crop edge, the rest is deep land. With the smallest pad that edge band can reach the
viewport's last half-cell, so a copy is not exact. The crop show therefore PACKS the clip (`marineFrameStoreCrop.packWindow`:
`packStaticFrame` on the window of the parsed planes, ~600-2,000 cells), uploaded with `texSubImage2D` into the resident texture;
pinned byte-identical to the encoder on both static lanes (5 windows x 3 themes).
- `noteCommitted`: a committed grid that is an exact window of the frame lattice (before the engine's trim, which the pack repeats)
  records the window; the clip becomes the store's resident once its own window pack exists AND the engine holds it (texture size
  and trimmed bounds; a commit the guard refused is never taken for it). Checked against the engine again at every step.
- Packs are built as frames are parsed while a window is resident (the store's prefetch and fill, #422's own loads), from local
  bytes for the stored frames nearest the cursor when a new window appears, and on a miss through `loadFrameParsed` with the
  existing deferred show. A small LRU keyed set | valid time | window holds them.
- Kill: `window.__RAW_DISABLE_FRAME_STORE_CROP__`. The runtime hooks are six marked lines; the instant-scrub session (#458 rewrites
  the same runtime) was told which.

## 6. Regional static sets (zoom ~7 and closer)

Where a regional tile covers the request (z7+ on a desktop over the 18 pilot boxes), the resolver serves the tile clipped to the
SNAPPED box (Step 3, `filter_grid_to_bbox(get_snapped_bbox(bbox))`, data-extent clamp, no pad). The crop mirror generalises
(another lattice, no pad), so the same machinery serves them once the tiles are published as sets.

**Publish.** The pilots lane already has every regional product on disk (`forecast-ingest-pilots.yml`, where
`publish_frame_images.py` runs since #422), and the GFS pass slices one whole-globe NOAA download per box. A set per
(model, layer, region): `GFS/marine/waves/<region_id>`, same RSWF v1 codec, same index and `latest.json`, parity-gated node by
node at publish. Worldwide regions refresh every 32 h (the rotation), so each region pins its own run.
- Shape (proposed by the static-frames session, 2026-10-22; the lead or the owner decides): ONE immutable bundle per regional
  set per run, because ~131 map sets x per-frame objects would not fit the publish budget. The bundle is the concatenation of
  the per-frame gzip members, each byte for byte the per-frame object (RSWF v1, mtime 0). The run index lists each frame as
  {valid_time, is_estimated, offset, length, sha12}; an unbuilt frame has offset null and falls back to `/grid`. The client
  inflates member by member, so frame identity and the existing codec and `packWindow` are unchanged. Paths:
  `v1/<model>/marine/<layer>/<region_id>/<run>/bundle-<sha12>.bin`; `latest.json` gets one entry per set key; the bucket keeps
  the current and the previous bundle. HTTP Range reads of one member are a later option (not verified on the CDN).
- The tile rule on the client mirrors the slack exactly: the server yields to a tile while the request is at most tile + 0.05
  deg on BOTH axes (pinned by `scn_static_crop_parity.mjs`'s edge boxes against the real resolver).

**Budget** (world frames measure 3.7 bytes per cell gzipped: 55.4 KB / 15,023 cells).

| | cells per frame | KB per frame | one run, 113 frames | one run, hourly (337) |
|---|---|---|---|---|
| smallest box (azores) | 408 | 1.5 | 0.17 MB | 0.5 MB |
| florida_east_coast | 725 | 2.7 | 0.3 MB | 0.9 MB |
| largest (brazil_east) | 5,917 | 21.9 | 2.5 MB | 7.4 MB |
| all 18 boxes (14 pilots + 4 GFS-only) | ~31,000 | ~115 | 13 MB | 39 MB |

Storage: the current and the previous run, per layer: 26-78 MB for GFS waves (the bucket holds the world run at 6.3 MB). Egress per
session: only the regions viewed; a full scrub in one region is 0.2-7.4 MB, in the typical box under 1 MB, less than the world run.
Supabase Pro's 250 GB cached egress covers ~250,000 such sessions a month.

**Client.** Set choice by tile (the manifest's coverage, the same rule the resolver applies: request inside the tile, not wider),
the crop mirror on the tile lattice, and the store's crop show. Not covered: zooms outside the boxes (the dynamic lane builds a
0.25-deg product per viewport from Open-Meteo), which stay on `/grid`. A global 0.25-deg tile pyramid from the same NOAA download
(about 400 ocean tiles of 10 x 10 deg, ~6 KB each per frame) would cover them, but it changes the close-zoom source outside the
boxes (Open-Meteo dynamic -> NOAA tiles): a served-number change, owner decision first (D-001).

## 7. Pass 2 (2026-10-22 evening): the zoom-out release, the desktop build-ahead, and what desktop z6 really was

**A. Zoom-out after scrubbing on a clip (the owner's console, dev 8b396b11).** Scrubbing at z4.45 keeps the 2-degree clip resident
(section 5, by design). The owner then zoomed out to z3.25: "No-downgrade: kept resident 31x20; rejected 181x82", the render backstop
re-drove 11 times, and the world frame landed ~35 s later when the self-heal fired at z3.0. Reproduced offline by `scn_zoom_out.js`:
on dev the clip stays for the whole watch with 80 % (z3.25) or 95 % (z3.6) of the view covered. Two old rules, each fixed behind its
own kill (`marineZoomOutRelease.js`):
- `WebGLMarineLayer`'s duplicate-upload skip compared a commit with the layer's OWN last upload. A frame-store show writes the engine
  directly, so after a show that record no longer describes the engine, and the zoom-out's world frame for the same hour matched the
  layer's earlier upload of it and was skipped (offline trace: `data_committed` 15,023 vectors, no `setWaveData`, the dup counter +1;
  live: "chain died after orchestratorCommit (37s silent)"). Fix: while the engine's resident came from a store show, no commit is a
  duplicate (`layerUploadIsStale`; kill `__RAW_DISABLE_STORE_SHOW_RESYNC__`).
- The no-downgrade guard keeps a regional resident against a coarse world frame while it covers >= 60 % of the view. Right for a
  0.25-deg tile; wrong for a clip of the 2-degree field itself (the world frame carries the same node values plus the rest of the view).
  Fix: a world frame no coarser than the clip, same model, no rating protection, replaces it unless the clip covers the WHOLE view
  (`clipNeedsFullCover`; kill `__RAW_DISABLE_CLIP_COVER_RELEASE__`). While scrubbing the padded clip covers the view, so section 4's
  no-ping-pong refusal still holds; tiles, the 10-deg coarse field, other models and rating grids keep the 60 % rule.
- It composes with #458's stash supersede (a store show clears a stashed reject of ANOTHER frame, keeps one of the same product):
  measured on #458 + the fix, the world frame was on screen by the end of the zoom in 4 of 4 sessions.

**B. Desktop build-ahead.** On a desktop that fills the run (`idleFillBlocker()` null) a new window's packs are now built for EVERY
stored frame (`cropAheadCount`, 144 cap under the 160-pack LRU), on two idle chains (`cropAheadChains`); phones, Save-Data, 2g and
hidden tabs keep +-24 / +-8. Kill `__RAW_DISABLE_CROP_AHEAD_RUN__`. Measured build rate with warm bytes: ~28 packs/s on one chain
(the run in ~4 s). Re-centring the queue on the cursor at each step was tried and removed: it pushed Home's frame back and a Home step
fell to the series world frame (a different hour, so the guard let it replace the clip).
- Harness caveat: Playwright's `page.route` disables the browser HTTP cache, so in the harness (and in the live read, which used the
  same door) every pack build re-downloads its frame. A real browser serves those re-reads from cache (frames are
  `public, max-age=31536000, immutable`, CDN HIT on GET; a HEAD answers `private, no-cache`, so read cache headers with GET).

**C. Desktop z6 "two clips taking turns" was the offline store, not the client.** With `--layers waves` only, the map's swell and
wind-wave series fell to the coarse preview, whose background revalidation built a dynamic 1-deg product for the series box, and the
dynamic cache (resolver Steps 1-2) then answered the waves series ahead of the mid tier: a 14 x 10 1-deg frame alternating with the
17 x 14 2-deg clip. Production publishes global_mid for all four GFS marine layers; with them, dev holds the 17 x 14 clip steady at z6.

**D. Instrument note.** `scn_zoom_scrub.js` computes each step's expected frame from the anchor at session start; a session that
crosses an hour's :30 (the anchor rounds) reports correct frames as mislabelled. Exclude sessions flagged `anchorRolled` (one did:
1,521 "mislabelled" frames; 8 re-runs away from :30 showed 0 on both builds).

**Measured** (offline, the real run, dev d1dbeed8b vs this branch on it; `docs/weather-program/evidence/mid-zoom-pass2-2026-10-22.json`;
40 sessions, 0 missed steps, 0 mislabelled frames, no session across :30):

| flow | dev | pass 2 | pass 2, one kill on |
|---|---|---|---|
| zoom-out z4.45 -> 3.25 / 3.6 (owner window) | clip stays the whole 15 s watch (80 / 95 % of the view), 4 of 4 | world frame on screen by the end of the zoom, 4 of 4 | clip release killed: stuck, 4 of 4; layer resync killed: fine, 4 of 4 (the same-product stash, which #458 keeps) |
| owner scrub z3.9 / z4.4, correct frame p95 | 52 / 56 ms | 15 / 15 ms | build-ahead run killed: 46 / 43 ms |
| desktop scrub z5 / z6, p95 | 51 / 40 ms | 16 / 15 ms | build-ahead run killed: 62 / 43 ms |
| crop packs not ready, per session | 3-6 | 0-1 | 3-6 |

Gates: Jest map + `src/tests` 5,470 pass (2 suites fail only in the dot-free copy: they read `program/` and `backend/` files);
mutants caught (the guard line, the layer wiring, the full-run count, the chain count); ESLint ratchet exit 0; LOC ratchet 0 regressed.

## 8. Regional bundles, the client (2026-10-23)

The map OPENS at zoom 9 over the Florida east coast. The lead's live read (16:33Z) measured ~34 s of `/grid_series` work on the
1-CPU box per load there: three waves pages (5.1 / 3.9 / 1.2 s) and the swell_1 / swell_2 / wind_waves prefetch pages (6.3 / 6.6 /
11.1 s). The publisher writes each pilot box's run as ONE bundle (#467 waves, #486 the three swell trains); `staticRegional.js` reads
it. Kill: `window.__RAW_DISABLE_REGIONAL_BUNDLES__ = true`.

**Contract** (agreed with the static-frames session, approved by the lead): `latest.json` lists each set
`GFS/marine/<layer>/<region_id>` with its run index and bundle; the client fetches the bundle once (an LRU of 6), slices a frame
(`offset`, `length`), checks `sha12` over the GZIP slice, inflates it, and decodes it with the world codec. Only a box the tile
FULLY covers reads it: the Step 3 window (`get_snapped_bbox`, the data-extent clamp, `clip_lattice`, no pad) must cover the request
with margin 0, the server's own `partial_coverage` test. A partial cover is `regional_partial` and sharpened dynamic on the server,
so it stays on `/grid` (Decision 3: every dynamic-cache answer over a tile in the Render logs was such a partial cover). The tile is
the one Step 3 picks (smallest containing tile; an exact tie goes to `/grid`). A cheap counter, `dynamicOnCovered`, notes any dynamic
`/grid` answer on a box a bundle covers (expected 0).

**Two fixes found by measuring, not by reading:**
- *The opening race.* The tile list is the products manifest. `/grid` awaits it before deciding; the series pages decided
  synchronously, and at the opening every page (the viewed one, the scrub prewarm's, the hour-0 mini) was decided at ~3 s, ~1.5 s
  before the manifest landed, so all of them queued to `/grid_series` (decision trace: 11 picks `manifest_not_loaded`). A page whose
  box a regional bundle could answer now waits for the manifest, bounded at 3 s, BEFORE the page dedup, so waiters resume one by one
  (`regionalSeriesWait`; kill `__RAW_DISABLE_REGIONAL_MANIFEST_WAIT__`). Superseded by the review fixes below: the hour-0 mini is
  never held, and once `latest.json` is read the tile is picked from the pilot boxes, so nothing waits.
- *Day jumps.* The static series fill is windowed (+-4 steps) because a world frame is ~15k vectors. A regional frame at the owner's
  z9 is 13 x 9, sliced from a bundle already in memory, so a small regional page fills every hour (viewed page <= 1,200 nodes a
  frame, any background page <= 300; `regionalFullPage`, kill `__RAW_DISABLE_REGIONAL_FULL_PAGE__`). Windowed, a jump to +172 h went
  to the per-hour path at 170-220 ms; whole, 26-40 ms.

**Parity** (`scn_regional_client_parity.mjs`, the app's own modules against the offline resolver, the 8 Florida / SoCal sets; seeded
z7-9 boxes plus each tile's exact box, 0.01 deg inside it and 0.5 deg past an edge): every layer, 30 claimed of 230 asks, 11,554
`/grid` + 5,620 `/grid_series` nodes, 0 bad, 0 metadata mismatches (product, served time, scope, mode, requested / query / served
bbox, coverage, partial_coverage), 0 false claims, 0 refused full covers, every sha12 good; waves on 300 boxes: 56 claimed, 25,336
nodes, 0 bad. `requested_bbox` is the SNAPPED box, as `filter_grid_to_bbox` stamps it (the first run's only mismatch). Positive
control: swell_1 keys pointed at the waves bundles -> 5,374 bad nodes, exit 1.

**Measured** (offline, the real waves run plus synthetic swells; `docs/weather-program/evidence/regional-bundles-client-2026-10-23.json`;
no session across :30):

| z9 Florida, centre -80.6, 28.1 (the live box) | regional bundles (ships) | `__RAW_DISABLE_REGIONAL_BUNDLES__` |
|---|---|---|
| owner view, marine `/grid` + `/grid_series` asks per load | **0** (2 of 2 sessions) | 10-11, 30.0-34.9 s of backend time |
| desktop view | **0** | 11, 32.7 s |
| step to the exact frame, worst of 10 steps | 40-45 ms | 39-47 ms |
| mislabelled frames | 0 | 0 |
| the view crossing the tile's -79 edge (partial cover) | same as the kill (9 asks): no bundle read | 9 asks |

**Not yet:** the frame store does not take regional sets (`getPinnedIndexSync` keeps them out); boxes outside the pilot boxes stay
on the dynamic lane (section 6).

**Review fixes (2026-10-23 evening; the lead's review of `b482566c`, 8 findings, each verified in the code first):**

| finding | fix | test that fails without it |
|---|---|---|
| 1. failures never cached; every failure reported as 404 -> stale pin -> forced `latest.json` per hour | failure cache per bundle path with backoff (5 s doubling to 120 s); the real status passed on (0 for network / CORS / timeout, `backoff` inside it); only a real 404 / 400 re-pins | 429 backoff, CORS, 404-vs-429 stale mark, page backoff |
| 2. a page that served nothing still claimed the page | cover checked once on the set's lattice before the loop; a bundle failure before the first frame returns null (the page asks `/grid_series`); background pages and the hour-0 mini need a pinned, servable page (`regionalPageServableSync`) | failed page not claimed (unit + loader) |
| 3. no fetch timeout | 15 s abort on the bundle fetch | the timeout test |
| 4. the manifest wait delayed the first frame and gave no saving with a late manifest | the hour-0 mini is never held; only boxes inside a pilot box wait; and once `latest.json` is read a box inside a pilot box is picked from that box (the pilot boxes do not overlap: backend-test-banned; `PILOT_BOXES` pinned to `pilot_regions.py`; the set listed = written from that tile), so nothing waits | hour-0 not held, late manifest served, pilot pick |
| 5. static pages escaped `SERIES_MAX` | the same eviction on static commits | 60 pages -> <= 48 |
| 6. dynamic cache keyed on the snapped box, ahead of the tile | a box is claimed only if its SNAPPED box also lies inside the data: no partial cover shares its key | fractional-edge window + loader test; parity below |
| 7. a re-pin mid-fill mixed runs on a page | one index per fill; frames carry `static_index`; a frame of another run clears the page | run-mixing test |
| 8. gzip error unhandled; sha12 failed open without `crypto.subtle` | errors caught at the loader; no digest = refused (fail closed) | gzip / missing-digest test |

Mutants: 12 guards removed one at a time, 12 caught (`evidence: review_fixes.mutants`).

*Finding 6 reproduced offline* (`scn_regional_client_parity.mjs SAMEKEY=1`, us_southeast_midatlantic: coverage east -74.4, last node
-74.5; north 37.5). A full-cover box snapping past the data is first served from the tile (`regional`). After ONE partial-cover ask
under the same snapped key, the server serves it from a dynamic product (`viewport_gfs_marine_waves_..._-77.00_33.00_-74.00_36.00`).
The previous rule would have answered from the bundle; the new rule refuses such boxes. Parity on Florida + that tile: 283 asks,
0 bad, 0 metadata mismatches, 0 false claims.

*Measured after the fixes* (owner view, z9 Florida, the live box; `LAT_PRODUCTS` delays the products manifest as the live read saw it):

| | regional (ships) | kill switch |
|---|---|---|
| manifest 4 s late: first frame | **0.5-1.1 s** | 1.6-2.4 s |
| manifest 4 s late: marine `/grid_series` asks, backend time | **0, 0 s** | 4, 18.6-21.7 s |
| manifest on time: first frame | 1.3-1.4 s | 1.4-1.8 s |
| manifest on time: asks, backend time | 3 one-frame minis, 0.4 s | 9, 30-31 s |
| worst step to the exact frame / mislabelled | 38-50 ms / 0 | 40-52 ms / 0 |

Before the pilot pick the late-manifest case served nothing (every page waited 3 s and then asked `/grid_series`), as the review
predicted.

