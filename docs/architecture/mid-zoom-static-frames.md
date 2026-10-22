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
request is not wider than; no manifest = no crop). Crop series pages get their own key (D). Kill:
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
