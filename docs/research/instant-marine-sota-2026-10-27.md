# Instant, correct marine layers, round 2: tier parity, rating frames, one readout (research, 2026-10-27)

**From the researcher session, for the lead session (local_d6b521eb) and the build sessions.** Docs only: no product code, no
flag, no served number, and no request to the live backend. Round 1 is `instant-marine-sota-2026-10-26.md` (#599); this round
does not repeat it. Every claim carries a tag:

- **[measured]**: read from this repo's code at `dev` `4bd90d0d9`, or measured by the program and cited to its record.
- **[cited]**: a primary source read in this round (a research agent or this session), linked.
- **[cited-2]**: a secondary source, or the program's own notes and PR bodies.
- **[inferred]**: reasoning, not evidence.

The owner's goal (2026-10-27 16:40Z, relayed): every marine layer (waves, swell_1, swell_2, wind_waves, the surf-rating band) is
**instant**, **works perfectly**, and shows **correct data on the heatmap AND in the infobox**, for GFS, EURO and ICON, at every
zoom.

## 1. Summary

- **Round 1's cheap client levers have landed:**
  - band OFF instant (#598);
  - no blank on a model switch (#602);
  - EURO/ICON tails on the CDN (D-055, #609);
  - EURO/ICON mid-zoom crops (#601);
  - EURO step words (#610).
- **What is left is structural, and it is one pattern: zoom picks a PRODUCT, and a refusal falls back to the server.**
  - Of the tier x model x layer x band cells, only world and wide mid-zoom waves are first-class for EURO and ICON.
  - Every narrow, z7-9 or band-ON cell for them is a `/grid` round trip on the one CPU (3.1).
  - Three mechanisms make second-class cells (3.2):
    - the client re-implements the resolver's choice rule by rule;
    - the server's answer to one ask changes over time (the 2 -> 0.25 deg "sharpen" for spans up to 8 deg);
    - finer tiers end before coarser ones, with no same-model fallback.
  - The live z9 EURO stall sits in such a cell.
- **Every leader read follows one rule: zoom picks a LEVEL of one product, and the only fallback is a coarser level of the same
  product** (deck.gl `best-available`, MapLibre overzoom, NASA GIBS "Best Available", Windy's bounds rule, nullschool's one grid)
  [cited]. Section 3.4 turns that into a 7-item coverage contract a script can check (C1-C7).
- **The rating band can be a frame, not a fetch.**
  - A rated grid already carries the honest height beside the score, and the client already builds both textures.
  - Rating frames computed in CI by the server's own `apply_surf_overlay`, as a u16 score plane paired with its height frame and
    keyed by a `chain_hash`, cost ~1.6-3 MB a GFS run.
  - Band ON then goes from 4.4 s to the next frame (4.1-4.3).
- **The infobox and the map can each be honest about a different frame, silently.**
  - The client asks `/point` at the selected hour.
  - The server swaps the drawn frame's timestamp to that hour when such a file exists, else falls to other lanes.
  - Leaders sample one field for both (earth.nullschool) or name the point and validity they used (ECMWF, NWS).
  - The rule: the card follows the drawn frame, with the same words. Testable invariants I1-I5, with tolerance arithmetic per
    theme (5.3-5.4).
- **Interpolation (7):**
  - 3 h gaps are safe for height and mean direction, labelled.
  - A 6 h gap loses 22-25% of a storm peak under ANY curve; only cadence fixes it, so EURO's real 6-hourly steps to 360 h come
    first.
  - Period is never blended.
- **Perception and browser (6, 8):**
  - a held arrow key commits on every repeat (~33 a second) where a drag commits at 11 Hz;
  - the pending words should wait ~300 ms;
  - the always-on particles likely need a pause control (WCAG 2.2.2);
  - INP is now measurable in Safari (26.2).
- **The top five levers, in order:**
  1. **N1** a CDN floor at every tier, with the coverage contract and draw-success telemetry;
  2. **N3** one readout;
  3. **N2** rating frames on the CDN;
  4. **N4** every marine layer resident;
  5. **N8** request lanes keyed on the target.
  - Each has an offline acceptance test (10).
  - N1(a, b, c, f), N3(a), N4 (store) and N8 move no served number. N2 is parity-gated. N3(b) and the ingest levers are the
    owner's.

## 2. What landed since round 1 [cited-2: PR bodies]

| Round-1 lever | Status 2026-10-27 | Evidence | What remains |
|---|---|---|---|
| L1 band as a render decision | **OFF instant** (local hide, 1-185 ms, 0 blank, three themes, phone) | #598 | **ON is still `/grid surf=1`: 4.4 s live** (#609 read). Band ON still takes the store away (`staticFrames.js:497`) |
| L2 switch holds until replaced | **Done**: 0 blank frames on every offline session; 30 s bound, then "not arriving… still showing" | #602 | Words appear at 0 ms, not after ~300 ms |
| L3a tails on the CDN | **Done** (D-055): EURO waves 53/53, ICON waves / swell_1 / wind_waves 63/63; ICON past h168 0-13 ms, EURO h250-h336 ~10 ms on revisits (live read) | #597, #609 | none for world zoom |
| L3b exact crop rule | **Done** for clips wider than 30 deg (the plain set as crop source) | #601 | narrow EURO/ICON views (`crop_only_narrow`) and z7-9 EURO/ICON |
| L3c one ICON product past 168 h | the dev deploy builds `REACT_APP_ICON_STORED_TAIL=true` (the stored tail) | regression sweep, finding 7 | a build without that variable draws the client blend: a deploy-config dependency |
| L4 lanes keyed on the target | **Partial**: `flavor_toggle` supersedes a scrub fetch; the pending stamp is leased 300 ms | #598 | the general target-keyed lanes |
| L5 rating frames on the CDN | not started | - | **section 4** |
| L6 ingest the real hours | sized, not built (shared notes `ingest-proposal-L6.md`: GFS hourly +9-10 min a run; EURO to 360 h +2.5 min a cycle) | lead's notes | the owner's word (served; L6b touches the LOCKED contract) |
| L7 labelled interpolation | **words only**: EURO's 3 h "nearest" window by MODEL step | #610 | no interpolation built (section 7) |
| L8-L12 | not started | - | section 9 |

Also landed: publisher read retries and an older-run coverage gate (#603), one registration per stored object and a resolver
skip of absent objects (#590, dark), prune-protect wiring (#600, dark; its flip is in #612).

## 3. Q1: one data path per zoom tier and model

### 3.1 Today's coverage matrix (waves) [measured: code at `4bd90d0d9`; CDN audit #597; #601; #609]

"CDN" means the frame store or a CDN frame; "/grid" means a server round trip on the one-CPU box.

| Client tier | When | GFS | EURO | ICON |
|---|---|---|---|---|
| T0 world | view >= 340 deg | CDN world set, 337/337 h | CDN filled set to the lane end (D-055) | CDN filled set to the lane end (D-055) |
| T1 mid, wide | request > 15 deg (clip > 30 deg) | crop of the world set (#459) | crop of the PLAIN set (#601) | crop of the plain set (#601) |
| T2 mid, narrow | request <= 15 deg, outside a pilot box | crop, unless the server might serve a regional tile | **/grid** (`crop_only_narrow`, `marineFrameStoreRuntime.js:449,568`) | **/grid** (same) |
| T3 z7-9 in a pilot box | the GFS pilot boxes (18 sets in the #597 audit) | regional bundle 0.25 deg: 16 boxes to h115, FL + SoCal to h332; **then /grid every hour** although the world set covers the box (#597 audit) | **/grid** (`staticRegional.js:34` `REGIONAL_MODELS = ['GFS']`; `regional_tile_first.py:40`) | **/grid** (same) |
| any tier, band ON | `surf=1` | **/grid** (`staticFrames.js:497`) | **/grid** | **/grid** |

**The other layers** [measured + cited-2]:

- **swell_1 / wind_waves:** CDN world sets exist for GFS and ICON (#597 audit). The GPU store packs waves only, so these layers
  step at CDN speed, not resident speed (GPU-frames session, `AB-RESULTS-GPU-frames-session.md`). The regional resident is GFS
  waves only (`marineFrameStoreCropShow.js:302`, `isGfsWaves`).
- **EURO swell_1 / wind_waves:** no 2-deg product exists in storage at all, only the 10-deg coarse one, so every hour is /grid
  (#597 audit).
- **swell_2:** ICON has none by design (`point_resolution.py:242`). GFS swell_2 was not audited for CDN coverage in any record
  this session found. It is a hole in the matrix itself.

So, of the 3 models x 4 layers x 5 tier rows x 2 band states, the first-class cells are the GFS waves world/mid ones and, since
#601 and D-055, EURO/ICON waves at T0-T1. **Every narrow, regional or band-ON cell for EURO and ICON is a /grid cell.**

### 3.2 Why second-class cells exist: three mechanisms [measured]

1. **The client re-implements the resolver's choice, rule by rule, and refuses where it cannot prove parity.**
   - The rules so far: clip wider than 30 deg (`servableClip`), the exact regional rule (70% cover, #601), `crop_only_narrow`,
     `crop_only_set`, `icon_blend_hour` (`marineFrameStoreRuntime.js:554`), the regional set kept past its last frame (#597).
   - Each rule is correct where it refuses. But a refusal always means /grid, so each new rule adds a second-class cell.
2. **The server's answer to one ask is not stable over time.**
   - The mid tier serves the 2-deg clip at once and schedules a background "sharpen". A dwelling view then gets a 0.25-deg
     dynamic product on a later ask, for spans up to 8 deg (`mid_res_tier.py:260-297`, `MARINE_MID_REVAL_MAX_SPAN` default 8.0,
     inside EURO 240 h / ICON 168 h).
   - Its own comment records the visible cost: "z7.20→7.35 off LA flips mid↔fine = a visible color step".
   - A tie between two authoritative frames 3 h either side resolves by list order in both the index and the manifest (#597 log,
     "hidden ordering assumption").
   - A client that keys its commit rules on product identity sees a new identity for the same model hour.
3. **Finer tiers end before coarser ones, and nothing falls back to the coarser tier of the same model.**
   - GFS regional bundles end at h115 (16 boxes) or h332. ICON/EURO 0.25-deg tiles stop at 48 h and have no bundles. EURO has no
     2-deg swell products.
   - Past each end the client asks /grid, and the server answers from its mid tier: the same 2-deg global_mid the client already
     holds on the CDN.

**The z9 EURO stall (live 2026-10-27 14:00Z: h141-h155 never drawn for 15 h, every `/grid` 200 in 123-776 ms) sits in a T2/T3
EURO cell, inside the 240 h sharpen gate.** Mechanisms 1 and 2 are candidate classes for it [inferred]. The diagnosis belongs to
the z9-euro-scrub-stalls session; this round only proposes the general rule.

### 3.3 What leaders do: zoom picks a LEVEL of one product, never a different product [cited: research agent, primary sources]

| System | Unit of data | How a zoom tier is made | Missing finer data | Who picks model / region |
|---|---|---|---|---|
| earth.nullschool | one global 1-deg JSON grid per product per time ([products.js](https://raw.githubusercontent.com/cambecc/earth/master/public/libs/earth/1.0.0/products.js)) | zoom re-interpolates the same grid; grids rebuild only when date, parameter or level change ([earth.js](https://raw.githubusercontent.com/cambecc/earth/master/public/libs/earth/1.0.0/earth.js)) | a 404 shows a sticky "No Data"; nothing is substituted | the path is a function of date, hour and product |
| Windy | one z/x/y data-tile pyramid per product, with `maxTileZoom` and `bounds` ([Product.d.ts](https://unpkg.com/@windycom/plugin-devtools@3.0.5/types/client/Product.d.ts)) | levels of that product's pyramid | overzoom past `maxTileZoom` (inferred; not in the types) | by BOUNDS, not zoom: `visibleProducts` follows the map edge; a declared global `preferredProduct` takes over outside a local model ([dataSpecifications.d.ts](https://unpkg.com/@windycom/plugin-devtools@3.0.5/types/client/d.ts.files/dataSpecifications.d.ts)) |
| Ventusky | per model | - | - | "Automatic" is a fixed rule by horizon and variable (ICON first 72 h, then GFS) ([help](https://www.ventusky.com/help)) |
| WeatherLayers GL | one texture per datetime, placed by `bounds`; time blended with `image2` + `imageWeight` ([data properties](https://docs.weatherlayers.com/weatherlayers-gl/layers/data-properties.md)) | no tiles: zoom changes only the rendering | - | the caller |
| deck.gl TileLayer | tiles of one source | the level is a pure function of the viewport; `z > maxZoom` clamps to `maxZoom` ([tileset-2d.ts](https://raw.githubusercontent.com/visgl/deck.gl/master/modules/geo-layers/src/tileset-2d/tileset-2d.ts)) | `best-available`: the nearest loaded ancestor, then children, same source only ([docs](https://deck.gl/docs/api-reference/geo-layers/tile-layer)) | the source |
| MapLibre raster | tiles of one source | above `maxzoom` it draws the `maxzoom` tiles scaled ([style spec](https://maplibre.org/maplibre-style-spec/sources/)) | walks up to a parent with data; a 404 triggers the parent/child retry ([tile_manager.ts](https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/src/tile/tile_manager.ts)) | the style |
| Mapbox Raster Array | one tileset per source, one band per time step (`raster-array-band`) ([recipe](https://docs.mapbox.com/mapbox-tiling-service/recipe-specification/rasterarray.md)) | the recipe's zoom range; overzoom past maxzoom | overzoom | the style |
| NASA GIBS | one pre-generated pyramid per layer per time: `{Layer}/default/{Time}/{TileMatrixSet}/{z}/{y}/{x}` ([basics](https://nasa-gibs.github.io/gibs-api-docs/access-basics/)) | levels of that pyramid | "Best Available" is a PUBLISHED priority list (latest Standard, then NRT, then older), and versioned layers stay addressable ([advanced](https://nasa-gibs.github.io/gibs-api-docs/access-advanced-topics/)) | the server, by a published rule |
| carbonplan ndpyramid | every level regridded from the same input (`dim = 2**level * pixels_per_tile`) ([reproject.py](https://raw.githubusercontent.com/carbonplan/ndpyramid/main/ndpyramid/reproject.py)) | one deterministic function | - | the Zarr multiscales convention can record `derived_from` and `resampling_method` per level ([multiscales](https://github.com/zarr-conventions/multiscales)) |

No primary source was found for Surfline's map tiers (the LOTUS page is marketing and returned 403).

**The common rules** (the agent's synthesis, checked against the table):

1. **Zoom picks a level, never a product.** Every level comes from one source through one deterministic function.
2. **The only fallback is overzoom, or a coarser loaded level of the SAME product.** No system read fills a gap with another
   model, another run or a server recompute.
3. **The model or region choice is a PUBLISHED rule** (bounds or horizon). No component re-implements another's private rules.
4. **Identity is the address.** The same ask returns the same bytes, and new data gets a new address.
5. **The label describes what was drawn, and a missing frame is said out loud.**

Raw Surf breaks rules 1-4 [inferred]:

- zoom picks the product (T0-T3);
- a refusal falls back to `/grid`, not to a coarser level;
- the client re-implements the resolver;
- the SWR sharpen changes what one ask returns;
- the plain and filled sets are two products for one model hour.

### 3.4 The rule for Raw Surf, and a coverage contract that a script can check

**The rule** [inferred]: *every cell has a CDN floor of the same model and run, and every finer tier is a declared refinement of
that floor.*

- **The floor is the 2-deg PLAIN set** (`global_mid`), cropped to the view, at every zoom below world.
  - Not the filled set: the server never Gulf-fills a clip under 350 deg (`coarse_gulf_fill.py:186-193`, #601), so overzooming the
    filled frame would paint fill where `/grid` serves none.
  - The floor exists for every model and hour since D-055 (waves). For swell_1 / wind_waves it exists for GFS and ICON;
    for EURO it must first be ingested at 2 deg (3.1).
- **A refusal hands off to the floor, never to `/grid`.** `crop_only_narrow` / `crop_only_set` today end in `/grid`. Under the rule
  they draw the floor at once, labelled by its cell size ("2-degree model grid"). The finer product, when it lands, replaces it
  as a refinement of the same model hour.
  - This is what `/grid`'s own mid tier already serves first for spans up to 40 deg (`grid_resolver.py:400-430`). So the floor is
    not a new number, only a faster route to the server's first answer [inferred; the C2 check below proves it per cell].
- **The server's choice becomes data.**
  - Where a covering regional product may win (requests <= 15 deg, `product_selection.py:133-161`; a 70% cover,
    `grid_resolver_selection.py:61-106`), CI publishes the regional products per box and hour (authoritative or estimated) in
    the index, and the client applies one shared `select()`, tested against the same test-vector file as the resolver.
  - Today each refusal rule is a private copy of a server rule.
- **Determinism.**
  - The sharpen (`mid_res_tier.py:260-297`) is allowed only as a DECLARED refinement: same model, run and valid time, finer
    `grid_cell_deg`. The client then treats it as an upgrade of the drawn frame, never as a new frame to hold or re-request.
  - Every tie (two authoritative frames 3 h either side) gets one written rule, shared by index and manifest.
  - **Caveat: the dynamic lane is not automatically a refinement.**
    - The sharpen and the Step 1-2 dynamic cache serve an Open-Meteo product resampled to the view. That product's run need
      not equal the stored run: the 2026-10-24 regional parity failure, where the server mixed products at z7-9 (memory
      `instant-everything-2026-10-22`) [cited-2].
    - D-051's tile-first retired it inside the GFS pilot boxes. Outside them it is still live.
    - So the rule needs one of two owner choices:
      - (a) a dynamic answer counts as a refinement only when its run is stamped and equals the floor's run;
      - (b) for marine, where a CDN floor exists, the floor plus published 0.25-deg frames replace the sharpen.
    - (b) moves served numbers at z7-9 outside the boxes, so it ships dark.

**The contract** (each item has a control that must FAIL it; test TC in section 10). A script enumerates every cell, tier x model
x layer x band x hour in the lane, over a CI-published coverage file and an offline resolver replay:

| # | Invariant | Control that must fail it |
|---|---|---|
| C1 | **Floor coverage:** every (model, layer, hour) that `capabilities.py` advertises has a 2-deg plain entry whose object resolves; exceptions on a shrink-only allow-list | delete one frame's object |
| C2 | **CDN-first, total:** the shared `select()` returns `resident` or `cdn` for every cell not on a shrink-only `/grid` allow-list; a refusal reason hands off to the next coarser level | today's build: `crop_only_narrow` ends at `/grid` |
| C3 | **Same-product fallback:** a fallback keeps model, layer, run and valid time; the label names the drawn cell size and served time | pair a 2-deg floor from an older run |
| C4 | **One selector:** client and server pick the same product id from the same index (shared test vectors); the only allowed difference is a declared refinement | `__RAW_DISABLE_PLAIN_SET_CROPS__` on |
| C5 | **Determinism:** the same ask returns the same id twice, after background work drains, and with the index order shuffled | inject a tie with no rule |
| C6 | **Level consistency (report, not a gate at first):** a 0.25-deg tile, coarsened onto the 2-deg lattice, matches the 2-deg frame within one height step plus interpolation error | pair levels from different runs |
| C7 | **Drawn or said** (Reflection's addition, 9.1): every ask that gets an answer, whether a CDN frame or a `/grid` 200, ends in a frame of the asked model and hour (within the index window) on screen within the budget. Otherwise the status line names why, and a counter records the reason. A 200 that is never drawn is a counted failure, not a silent state | the z9 EURO replay (h141-h155, `/grid` 200s, never drawn) |

**Expected effect on the owner metrics** [inferred]:

- The z9-class cells (T2/T3 EURO/ICON) go from "/grid, sometimes never drawn" to a first pixel from the floor at resident speed
  (<= 17 ms after the crop is packed; the #601 mid-zoom crops measured 7-15 ms p50).
- Every refinement that later lands is labelled as such.
- **The blank-or-stuck class is gone by construction:** some frame of the right model and hour is always drawable.

## 4. Q2: the rating band ON in one frame

### 4.1 Today [measured]

- **Band ON leaves the store at every tier.** `staticEligible` returns false for `surf` (`staticFrames.js:497`: "rating grids are a
  server transform"). Live: ON took 4.4 s (#609 read), and the brief records a Render memory spike to 1,056 MB.
- **A rated grid already carries both fields.** `rating_transform_grid` writes the score into `speed` and keeps the honest height
  in `phys_speed` (`surf_rating.py:686-726`). The encoder builds two textures from it: `u_waveScoreTexture` for the band colours and
  an honest `u_waveTexture` for draw and advect (`WebGLMarineTextureEncoder.js:112-120, 786-797`). Round 1's open question
  ("does the `surf=1` JSON carry the honest height?") is answered: yes.
- **The score's inputs** (`grid_resolver_surf.py:85-161, 213-321`):
  - the served wave product;
  - per cell, the model's finest COVERING wind product within 3 h (`manifest_point_selection`, shared with the glyph's point);
  - bathymetry, the coastal test and the shore normal;
  - `RATING_LOCAL_SIZE`: a gridded p80 size climatology (an L2 blob the pilots lane rewrites);
  - `RATING_OBS_GATE`: caps a score at 69.9 unless a CONFIRMED spot within 0.35 deg, within 3 h, unlocks it (83.9 for good,
    uncapped for epic), read from the spot-ratings L2 blob behind a 300 s TTL (`rating_confirmation.py:55-64`).
  - The served lanes run both flags ON (`log/2026-09-29-sim-works-plan.md`) [cited-2].
- **Precision.** `observation_gate` rounds the score to 0.1. The GPU then sees score/10 on the 10 m height byte (`hScale = 10`,
  `WebGLMarineTextureEncoder.js:314`): about 0.39-point steps.
- **Cost of precomputing** (GPU-frames session, 2026-10-24, measured on this PC): 0.68 s per forecast hour for all 19 pilot boxes
  warm, 11 s cold once per process; an estimated 4-9 Actions minutes and 3-8 MB per model run at full horizon (shared notes
  `precompute-surf-frames-cost-estimate-2026-10-24.md`) [cited-2].

### 4.2 What leaders and formats do [cited: research agent report, URLs below]

- **No leader publishes a gridded rating raster.**
  - Surfline rates per spot, hourly, from LOTUS, and its map colours spot markers
    ([LOTUS](https://www.surfline.com/lp/whatsnew/features/lotus-swell-model); pages 403'd, so search snippets only [cited-2]).
  - Surf-Forecast.com gives 0-10 stars per break ([FAQ](https://surf-forecast.com/pages/faq)).
  - Windy and Stormglass have no ratings.
  - A coastal rating BAND is Raw Surf's own surface. Nothing to copy, so the frame design follows the height frames already proven
    here [inferred].
- **Encoding analogues:**
  - WeatherLayers marks no-data with alpha 0
    ([data sources](https://docs.weatherlayers.com/weatherlayers-gl/data-sources)).
  - GeoServer PNG-WIND uses a band as the validity mask
    ([PNG-WIND](https://docs-archive.geoserver.org/stable/en/user/community/png-wind/index.html)).
  - Mapbox MRT stores u32 with offset/scale and 2^32−1 as no-data
    ([raster MTS](https://docs.mapbox.com/mapbox-tiling-service/guides/raster-mts/)).
  - In Zarr, an empty chunk cannot be told from an unwritten one
    ([performance](https://zarr.readthedocs.io/en/latest/user-guide/performance/)), so an all-masked frame must be listed
    explicitly in the index, never inferred from absence.
- **Dense plus gzip is as small as sparse.** DEFLATE matches runs up to 258 bytes
  ([RFC 1951](https://www.rfc-editor.org/rfc/rfc1951.html)), so masked water costs almost nothing. On synthetic coastal ribbons,
  a dense gzip plane was 247 B against 248 B for a sparse index list (1,700 cells), and 1,709 B against 1,926 B at 160x120 (the
  agent's probe, `sparse_gzip_probe.py`, kept in the scratchpad) [measured, synthetic].
- **Filtering a masked score.** LINEAR filtering against masked neighbours drags an edge cell's colour toward the mask's value
  ([alpha cutouts](https://www.shawnhargreaves.com/blog/texture-filtering-alpha-cutouts.html)).
  - The standard remedy is a premultiplied value plus a validity channel, divided after the sample (RG8 is filterable:
    [glTexImage2D ES 3.0](https://registry.khronos.org/OpenGL-Refpages/es3.0/html/glTexImage2D.xhtml)).
  - GIS practice uses nearest for categorical rasters
    ([ArcGIS resampling](https://pro.arcgis.com/en/pro-app/latest/tool-reference/environment-settings/resampling-method.htm)).
  - Either one is a VISUAL change to today's band: owner A/B, kept apart from the CDN move [inferred].
- **Invalidation.**
  - Immutable content-addressed objects (`immutable`, [RFC 8246](https://www.rfc-editor.org/rfc/rfc8246.html)) under a
    short-lived index written last, as today.
  - Never overwrite in place: Supabase Smart CDN takes up to 60 s to propagate, and browsers keep about 1 h
    ([Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn)).

### 4.3 The design [inferred from 4.1-4.2; numbers are the agent's arithmetic, re-checked here]

1. **Compute through `/grid`'s own function.**
   - CI calls `grid_resolver_surf.apply_surf_overlay` on the stored product, not `rating_transform_grid` with its own wiring.
     The wind sampler, the gate, the climatology and the kill switches all live in the overlay.
   - Then it runs the publisher's existing per-node `parity()`.
   - If the gate or climatology blob fails to load, publish `unbuilt`, never a frame. Both loaders fall back silently to a
     different but valid answer.
2. **One plane, paired with its height frame.**
   - `phys_speed` is the stored product's own `speed`, so the honest height is already in the CDN height frame of the same
     product.
   - A rating frame carries the score plane only, plus the content id (sha12) of the height frame it pairs with. The client
     binds the band only when the two ids match.
   - Repeating height, direction and period would make the frames about 4x larger.
3. **Carry the score exactly as served: u16 = score x 10, 0xFFFF = not rated.**
   - `observation_gate` rounds to 0.1 (`rating_confirmation.py:64`), so u16 is exact.
   - The client's existing pack then produces the same GPU byte as the `/grid` path (score/10 on the 10 m byte), so parity is
     byte-exact by construction.
   - The agent's u8 code (`floor(2 x score) + 1`) keeps all seven levels exact, because the bucket edges are integers tested as
     `score < upper` (`surf_rating.py:36-37`). But it moves the continuous colour by up to one byte. That is a visual change
     this lever does not need.
4. **Size.** About 0.35-0.65 KB per box frame as u8. Assume up to ~2x for u16 on the rated cells only, so ~0.5-1.0 KB [inferred].
   - Per GFS run: 19 boxes x 113 frames x 0.5-1.0 KB ≈ 1.1-2.1 MB, plus the 2-deg world set (113 x 2.4-4 KB as u8, ~2x as u16)
     ≈ 0.5-0.9 MB. **About 1.6-3 MB per GFS run**, inside the 3-8 MB estimate.
   - CI: ~77 s of rating math plus 64-172 s of publishing per run (agent, from the 0.68 s/hour measurement).
5. **Key and guard.**
   - **Set level:** a `chain_hash` covering:
     - the chain modules' source;
     - every `_RATING_FLAGS` value and the overlay kill switches;
     - the codec versions;
     - static-input shas (bathymetry, shore normal, masks);
     - the climatology and spot-ratings blob shas, when their flags are on.
   - **Entry level:** the paired height frame's sha12, and the wind products actually used.
   - **Guard:** Render exposes its own `chain_hash` in `/capabilities`. On a mismatch the client uses `/grid surf=1`.
6. **Republish triggers.** A new wave run, a wind registration, a gate or climatology blob write, a deploy, or a flag flip.
   Unchanged frames upload nothing (content addressing).
7. **The flip.**
   - A separate score array pool (R8 or RG8, `UNPACK_ALIGNMENT` 1 around its uploads), so band sets never evict height sets
     from the RGBA8 pool (`maxArrays = 4`).
   - Copy the score layer on every step even with the band off: ~0.02 ms per copy, measured (`marineFrameStoreGpu.js:9`).
   - Toggle = a uniform + `triggerRepaint()`, which coalesces to one frame
     ([painter.ts](https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/src/render/painter.ts)).
   - No `/grid` dispatch for an hour with a built, key-matched entry.
   - GPU memory per 113 layers: at 2 bytes per texel (RG8), ~384 KB per 1,700-node box, 4.3 MB per 160x120 crop, 3.4-3.7 MB for the world.

**Risks** [cited agent + measured]:

- **Gate freshness.**
  - The spot-ratings blob carries user reports and is cached 300 s on Render. The climatology blob is cached 600 s and grows
    every pilots run.
  - A CDN band lags the live one by up to one republish.
  - The parity gate is defined at EQUAL blob versions. How stale a band may be is the owner's call: say so in the PR.
- **Wind choice drift.** The wind sampler picks per cell from the manifest. A regional wind tile registered after the publish
  changes what `/grid` would answer, and the key covers it only if the publisher records the wind products it used. Not
  checked: whether the sampler sees the HRRR lane.
- **A latent behaviour to copy exactly, or fix behind a flag** [measured, this session].
  - Coastal cells whose regime is `open_ocean`, `calm` or `unknown`, or whose score is <= 0, hit `continue` at
    `surf_rating.py:740-741` and `:771-772`. They keep the OFFSHORE height in metres in `speed`, with `is_valid` untouched.
  - In rating mode that channel is read as a score. Whether the client hides those cells is not verified this session.
  - The CDN encoder must reproduce today's bytes for them (parity), and any change is the owner's.

## 5. Q3: the infobox and the heatmap tell one story

### 5.1 Today: two lanes that can read two different frames [measured]

**The heatmap** draws the stored frame the index picks for the asked hour: authoritative first, nearest within +-3 h, or the held
or estimated frame past a model's range. `drawnFrameReadout` words it (#560, #587, #610).

**The infobox** asks a separate lane:

1. **It sends the drawn product id, but asks at the selection's hour.**
   - The id: `useExactPointFetch.js:204-208` (A15-09: "the infobox sampled a different product from the one on screen").
   - The hour: `valid_time` is the selection's time (`backendWeatherServiceClientPoint.js:406`), not the drawn frame's
     served time.
   - The hint is dropped entirely for views wider than 60 deg ("too-wide ⇒ coarse", `:397`).
2. **The server swaps the hint's timestamp to the asked hour.**
   - When the drawn id names 12Z and the ask is 13Z, `point_resolution.py:245-261` rewrites the id to 13Z and samples that file if
     it exists on the box's disk.
   - If it does not, the server drops the hint and runs its automatic lanes:
     - the dynamic viewport index;
     - the manifest's finest COVERING product (`choose_for_point`, `:361-368`);
     - a direct Open-Meteo point at the closest time index (`:513`).
   - So the infobox can read a different frame (another hour, another product, a finer grid) from the one drawn, for the same
     model and asked hour.
3. **The rating card** asks `/point-rating` at the settled offset: the precomputed glyph item at a catalogued spot, else
   `rate_one_spot` plus the observation gate (`pointRatingClient.js:1-14`, `MapForecastOverlay.js` `usePointRating`). That is the
   ONE FORECAST COMPOSITION chain, as required.
4. **Both sample bilinearly, but not the same numbers.**
   - The GPU filters LINEAR on 8-bit quantised heights (`WebGLMarineTextureEncoder.js:536-537`): 10 m/255 = 3.9 cm, or 16 m/255
     = 6.3 cm rounded, plus a validity mask.
   - The server samples bilinear on the stored floats, renormalised over masked corners near land (`sampler.py`, interpolation
     methods `bilinear`, `bilinear_ocean_masked`, `nearest_ocean_fallback`).
   - Each response stamps its own `served_valid_time` (`stamp_frame_honesty`).

**Consequence** [inferred]: on any off-lattice hour, held hour or estimated hour, the map and the card can each be honest about a
DIFFERENT frame. The card has no words for that today. The one thing that must differ, offshore Hs on the map vs the nearshore
BREAKING height in the card, is required by CLAUDE.md and is not the defect.

### 5.2 What leaders do [cited: research agent, primary sources]

- **earth.nullschool: one function for both.** The click readout calls the same `grid.interpolate` (bilinear on the node-registered
  grid) that colours the overlay, so the field and the readout cannot disagree
  ([earth.js](https://raw.githubusercontent.com/cambecc/earth/master/public/libs/earth/1.0.0/earth.js)). Its timeline moves only
  in the model's own 3 h steps, so every askable time is a stored frame
  ([products.js](https://raw.githubusercontent.com/cambecc/earth/master/public/libs/earth/1.0.0/products.js)).
- **Windy: two tools, said out loud.**
  - The picker reads the map tiles (reprojected, zoom-dependent). The detail forecast uses finer data, and Windy staff call the
    picker "a preview tool" ([forum](https://community.windy.com/topic/19660/basic-wind-forecast-different-from-animation)).
  - Hourly ECMWF gusts in its meteogram are linear interpolation of the 3/6-hourly values
    ([forum](https://community.windy.com/topic/32304/forecast-period-representing-the-wind-gust-value-in-ecmwf-meteogram)).
- **ECMWF meteograms name the point they used.** The nearest land or sea point of the four around it, with "ENS Land/Sea Point" in
  the title ([Confluence](https://confluence.ecmwf.int/x/y5UlK)).
- **NWS: every value carries its own validity interval.**
  - A point forecast is the nearest 2.5 km grid box
    ([NWS notice](https://www.weather.gov/media/notification/pdfs/pns09marine_points.pdf)).
  - Every gridpoint API value carries an ISO-8601 validity interval (`/PT1H`, `/PT5H`): the agent read a public
    api.weather.gov response.
  - NBM is hourly to 36 h, 3-hourly to 192 h, then 6-hourly
    ([BLEND](https://nomads.ncep.noaa.gov/txt_descriptions/BLEND_txt.html)).
- **Open-Meteo**, the point lane's last fallback, returns one nearest cell (`cell_selection`), not a bilinear value
  ([marine API](https://open-meteo.com/en/docs/marine-weather-api)). A fallback to it is a different frame identity by design.
- **Surf sites separate the two quantities by name.** Surf-forecast.com says its swell sizes are open-water heights, not breaking
  ([FAQ](https://surf-forecast.com/pages/faq)). Surfline says LOTUS is configured for surf, as opposed to deep-water swell
  (search snippet, 403 to the fetcher) [cited-2].

### 5.3 The rule: the infobox follows the drawn frame [inferred from 5.1-5.2]

| Case on the map | Infobox frame | Infobox words |
|---|---|---|
| exact stored hour | the same frame | the time only |
| nearest stored frame within +-3 h | **the same frame** (not the asked hour's) | the status line's words, verbatim ("Showing Mon 3 PM: …") |
| interpolated hour (only if the map ever interpolates, L7) | the same two frames and weights as the shader: height blended, direction from sin/cos, period from the nearer frame; the chain runs ONCE on those inputs | "between 3 PM and 6 PM" |
| estimated tail, held day-14 frame | the same frame | the map's estimated / held words, plus the hold's age |
| a model the point lane cannot serve | none: `frame_unavailable` | any offered alternative carries its own model and time words; never a silent swap to the dynamic cache, the finest covering product or Open-Meteo |

- **The surf number** is the breaking height from `surf_point` on THAT frame's offshore inputs, labelled "Surf (breaking)". The
  quality comes from the rating chain at the same frame. That is ONE FORECAST COMPOSITION unchanged: only the frame choice
  changes.
- **Any offshore number** in the card is labelled as the map's offshore value.
- **Why not "the asked hour with its own label"?**
  - It keeps two truths on screen at once, and "nearest" (hold) is about 3x worse than linear.
  - Making only the card more accurate splits the map and the card again.
  - The accuracy fix belongs in the map (L6 real hours, then L7), and the card follows it [inferred].
- **Served?** Yes: the card's numbers move at off-lattice, held and estimated hours.
  - Server: a dark flag (e.g. `POINT_FOLLOWS_DRAWN_FRAME`). When the client sends the drawn frame's id and served time, the
    server stops the timestamp swap (`point_resolution.py:245-261`) and samples exactly that product, or answers
    `frame_unavailable`.
  - Client: it sends `__MARINE_DRAWN__`'s served time and `runMs` beside the id, at every view width (today the hint is dropped
    above 60 deg).
- **A words-only step can ship first (client, ON, kill switch).** When the `/point` response's `served_valid_time` or model run
  differs from the drawn record's, the card shows its own time words ("Card: Mon 4 PM forecast · map: Mon 3 PM"). That removes the
  SILENT disagreement today, with no served number moved.

### 5.4 The invariant, with tolerance arithmetic [inferred; the agent's derivation, corrected for the floor]

- **I1, identity (the gate).** Card (model, run, served time) == drawn record, or the card shows its own words and a mismatch
  counter increments. 0 silent mismatches.
- **I2, value.** The offshore Hs the card quotes equals the GPU-sampled value at the tapped pixel's centre, within tau.
  - Let q be one height step.
  - **The dark theme (10 m scale) FLOORS** (`WebGLMarineTextureEncoder.js:346`, `Math.floor(hEnc * 255)`):
    - q = 10/255 = 3.92 cm, and the encoding error is one-sided, in [0, q).
    - tau = q = 3.9 cm against a CPU emulation of the same bytes.
    - tau ≈ 1.6q ≈ 6.3 cm on a real GPU read-back. That adds ~q/2 of filtered-output precision and 8-bit sub-texel weights
      (<= 2 x dH_cell / 512 ≈ 0.4 cm) ([texture precision](https://www.reedbeta.com/blog/texture-gathers-and-coordinate-precision/)).
  - **Light / beach (16 m) ROUND:**
    - q = 6.27 cm.
    - tau = q/2 = 3.1 cm (CPU emulation), ≈ 1.25q = 7.8 cm (GPU read-back).
  - **What I2 catches:** a half-cell registration error, 0.28-1.4 m on 0.25-deg grids near gradients. The usual cause is mapping
    texel centres node-to-node instead of at `(n + 0.5)/N`
    ([Khronos forum](https://community.khronos.org/t/what-are-the-exact-right-texture-coordinates/31234)). It also catches a
    different product on either side.
  - **Coastal pixels:** gate them only where both sides use the same masked, renormalised estimator. Report the rest.
  - **A side finding:** the dark floor biases the drawn heights low by q/2 ≈ 2 cm on average. #420 (R16F float height, draft)
    would remove it.
- **I3, composition.** The surf height is the chain's breaking height (the `rate_one_spot` reference), labelled as surf. Marine
  `point.speed` is never shown as surf.
- **I4, scrub coherence.** While the wheel moves within one drawn frame, the card's values do not change.

## 6. Q4: animation and perception while scrubbing (new beyond round 1)

### 6.1 Findings [cited: research agent; full texts read where marked]

- **Reading one frame takes about 400 ms; during a drag people see motion and trend, not values.**
  - Hypothetical outcome plots used 400 ms per frame: faster tired viewers, slower made frames hard to integrate (Hullman et al.,
    PLOS ONE 2015, [full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC4646698/)).
  - Central vision needs about 400 ms to detect a moving point symbol on a map (Krassanakis et al., JEMR 2016,
    [PDF](https://bop.unibe.ch/JEMR/article/download/2459/pdf)).
  - Searching among animated symbols degrades above 10 fps (Ge et al., IJGI 2025,
    [article](https://www.mdpi.com/2220-9964/14/8/305)) [cited-2].
  - Even at 2.5 s per frame, spatial patterns were recognised only 55-64% of the time (Cybulski 2022).
  - **So** [inferred]: during a drag, skipping to the latest frame costs the reader nothing. The label and the values must be
    exact once the wheel dwells ~300-400 ms.
- **Pacing.**
  - Slow-in/slow-out was the most accurate pacing for tracking change, over transitions of about 0.5-1.0 s (Dragicevic et al., CHI
    2011, [PDF](https://cs.au.dk/~elm/pdf/timedistort.pdf)).
  - Smooth transitions helped viewers notice change in animated choropleths (Fish, Goldsberry & Battersby 2011) [cited-2].
  - This supports eased blends for AUTOPLAY and taps, never during a drag.
- **Animation is for presentation, not analysis.**
  - Animation lost to small multiples for analysis (Robertson et al. 2008, round 1).
  - On phones, small multiples were faster in 7 of 9 tasks (Brehmer et al. 2019, [arXiv 1907.03919](https://arxiv.org/abs/1907.03919)).
  - Harrower 2003 asks for loop, step and speed controls, many small changes between frames, and exact numbers on demand
    ([PDF](https://cartographicperspectives.org/index.php/journal/article/download/cp44-harrower/pdf/2665), read in full).
  - The infobox is that "exact numbers on demand", which is why section 5 matters [inferred].
- **Anti-flash rules in shipping code.**
  - AndroidX `ContentLoadingProgressBar` waits 500 ms and then shows for at least 500 ms.
  - React throttles Suspense fallbacks by 300 ms.
  - The `spin-delay` library uses 500 / 200 ms.
  - Nielsen Norman Group: no looping indicator under 1 s; a spinner for 2-10 s.
  - **No study** was found on how long a stale frame may be held before users misread it.
- **Keyboard auto-repeat** (platform docs; the agent's table):

  | Platform | Initial delay | Repeat interval |
  |---|---|---|
  | ChromeOS | 500 ms | 50 ms |
  | Android | 400 ms | 50 ms |
  | GNOME | 500 ms | 30 ms |
  | macOS | 225 ms at the shortest setting | 30 ms at the fastest (15 ms from the command line) |
  | Windows | ~250 ms to 1 s (setting) | ~2.5 to 30 per second |

  - `keydown` is not aligned to animation frames, so the app must coalesce.
  - Under the Event Timing spec every auto-repeated keydown is its own interaction
    ([Event Timing](https://w3c.github.io/event-timing/)), so a held arrow yields 20-33 INP samples a second.
  - iOS Low Power Mode caps rAF at 30 fps by design ([WebKit 215745](https://bugs.webkit.org/show_bug.cgi?id=215745)).
- **Motion rules.**
  - Material 3 durations run 50-1000 ms, standard easing (0.2, 0, 0, 1). Apple asks for purposeful, brief, cancellable motion.
  - **WCAG 2.2.2 (Level A) likely covers the always-on crest particles:** they start on their own, run over 5 s and sit beside
    other content, so they need a pause or hide control. 2.3.3 (AAA) covers motion from interaction.
  - MapLibre's `easeTo` / `flyTo` already honour reduced motion unless `essential: true`.
- **Skills.**
  - `hyperframes:hyperframes-animation`: render as a pure function of the time sought, and never fetch at seek time. That is the
    store's design, and it argues against any seek-time `/grid`.
  - `mapbox:mapbox-data-visualization-patterns`: nothing new (as in round 1).

### 6.2 What this means in the code [measured + inferred]

- **The held arrow key commits on EVERY repeat.**
  - `ForecastWheel.js:305-315`: `onKeyDown` calls `setHour(..., { doCommit: true })` for each keydown.
  - A pointer drag commits only at 11 Hz (`:291-292`, `wheelDragCommitDue`, "Forecast commits are the render-driving prop").
  - So a held key at 30 ms repeat drives ~33 render-driving commits a second, three times the drag path's rate.
  - Lever (N5): coalesce key repeats to the latest hour per rAF, with the drag path's commit cadence, and commit the exact hour on
    `keyup` or after ~300 ms idle. Kill switch.
- **The ladder for the pending words** (inferred from the anti-flash rules):
  - nothing for 300 ms;
  - then "Loading … still showing …" as static words;
  - a looped indicator past 1 s;
  - once shown, keep it at least ~500 ms.
  - Today's words appear at 0 ms (#602, "not done").
- **Reduced motion:**
  - no value blend (0 ms);
  - the crest particles slowed or held;
  - a visible pause control for the particles (WCAG 2.2.2), default unchanged.

## 7. Q5: the mathematics of in-between hours, and what is safe to show

### 7.1 The error budget [measured: the program's hold-outs; cited: below]

| Quantity | Gap | Hold (nearest) | Linear | Clamped temporal Catmull-Rom | Real hourly frames | Safe to show? |
|---|---|---|---|---|---|---|
| Hs, mean | 3 h (GFS to f120 today, ICON, EURO to 144 h) | MAE 4.9-6.0 cm | ~1/3 of hold | 1.4-1.8 cm (15-30% under linear) | 0 | **yes, labelled "interpolated"**; or real hours (L6a) |
| Hs, storm core (top 2%) | 3 h | - | - | 4.6-8.9 cm | 0 | yes, labelled |
| Hs, storm peak retention | 3 h | - | - | >= 0.944 | 1 | yes |
| Hs, storm peak retention | 6 h (EURO past step 144) | - | 0.75-0.78 under any method | 0.75-0.78 | 1 | **no**: keep the nearest stored frame with its words (#610), or real 6 h steps to 360 h (L6b) |
| Direction (mean, energy-weighted: ECMWF `mwd`, GWAM, CMEMS `VMDR`) | <= 3 h | - | on the unit circle (sin/cos), Hs²-weighted | CR adds nothing | 0 | yes, if the ends differ by <= ~60 deg |
| Direction (PEAK: GFS `DIRPW`) | any | - | - | - | 0 | **no**: nearest step (it jumps between systems) |
| Peak period Tp | any | - | max error 9.1 s at a system switch | - | 0 | **no, never blended**: nearest step |
| Wind (u, v), for comparison | 1-3 h | vec RMSE 1.187 m/s | 0.897 | PCHIP 0.886 (best; linear under-travels on turns) | 0 | labelled (#564, draft) |

Sources:

- **Hold-outs:** memory `time-interpolation-holdout-2026-10-20` and `sota-research-2026-10-20`, the wind hold-out (shared notes
  `wind-holdout-2026-10-25/`), and the L6 proposal [cited-2].
- **Coarser sampling undervalues extremes:**
  - Dentale et al., ICCE 2016 ([article](https://icce-ojs-tamu.tdl.org/icce/index.php/icce/article/view/8122));
  - Naseef & Sanil Kumar 2017, NHESS 17:1763 ([article](https://nhess.copernicus.org/articles/17/1763/2017/nhess-17-1763-2017.html))
    [cited].
- **Tp is the inverse of the 1-D spectrum's peak**, so it jumps between partitions
  ([ECMWF](https://confluence.ecmwf.int/spaces/WLW/pages/81011862/Peak+wave+period)) [cited].
- **No primary paper** gives per-method Hs interpolation error at 3 h and 6 h. The program's own hold-out is the best evidence found
  [cited: the agent's search; this session's Hugging Face papers search found none either].

### 7.2 Why no method rescues a 6 h gap [inferred: an analytic check, the agent's, re-derived]

- **Model a storm peak** as a Gaussian in time with sigma ≈ 4.0-4.4 h. That reproduces both measured peak retentions:
  - a peak midway between samples Δ apart retains exp(−(Δ/2)²/2σ²);
  - Δ = 3 h, σ = 4.2 h gives 0.94;
  - Δ = 6 h gives 0.78.
- **A clamped interpolant never leaves the two bracketing values.** By construction it cannot restore a peak that falls between
  them.
- **So at 6 h only cadence helps:** real steps (L6b), or a learned temporal downscaler.
  - HourGlass (Ingstad et al., 2026, arXiv 2607.11457) reconstructs hourly states from 6-hourly AIFS forecasts. It notes that
    deterministic temporal downscalers "produce overly smooth fields"
    ([abstract](https://huggingface.co/papers/2607.11457)) [cited].
  - It is atmospheric, GPU-trained and server-side. Not a client lever. It is evidence that the operational answer to 6 h gaps is
    a model, not a curve [inferred].

### 7.3 The labelling rule (unchanged from round 1, now with the budget behind it)

- **Interpolate only** between two real steps of the same model and run, gap <= 3 h, height and mean direction only.
- **Never** across runs or models, into an estimated tail, or over a 6 h gap.
- **Three states, in words:**
  - a model hour;
  - "Interpolated · between 3 PM and 6 PM";
  - "Estimate · beyond EURO's model range".
- **The infobox follows the same frames and weights** (5.3), or there is no interpolation.
- **Served:** dark, with a SCOREBOARD row and the owner's word (D-001).

## 8. Q6: browser and GPU facts for instant [cited: research agent, Context7 for MapLibre / deck.gl / WeatherLayers, MDN BCD]

**Already in place, so not levers** [measured]:

- fetch priority `high` for the shown frame and `low` for prefetch (`staticFrames.js:172,572,652,782`);
- `DecompressionStream` in a worker;
- texture arrays with `texStorage3D` and a per-step layer copy of ~0.02 ms (`marineFrameStoreGpu.js:7-10`);
- Long Animation Frames telemetry (`instantTelemetry.js:232-234`);
- parallel shader compile.

**New or corrected facts:**

- **Array layers.** WebGL2 guarantees 256. In the field (web3dsurvey): Android >= 256 on 100% and >= 512 on 95%; iOS, macOS and
  Windows >= 2048.
  - The comment at `marineFrameStoreGpu.js:28` ("94-100% of devices report 2048") is optimistic for Android.
  - The 115-layer arrays stay safe. A future one-array-for-three-models layout (339) would not be safe on Android.
- **Layer pick and blends.** An array layer is chosen as `clamp(floor(r + 0.5), 0, d − 1)`, with no filtering between layers. So a
  value blend is two samples in one draw: mix the values, then apply the palette (N7, L11).
- **Codecs.** `DecompressionStream`: Chrome 80, Firefox 113, Safari 16.4, in workers.
  - Brotli: Firefox 147 and Safari 18.4, not Chrome.
  - zstd: behind a Firefox flag only.
  - So frames stay gzip (also N2).
- **Workers.** WebGL2 on `OffscreenCanvas` needs Safari 17. Decode in a worker, transfer the buffer, upload on the main thread:
  that is MapLibre's own tile pipeline too.
- **Scheduling.**
  - `scheduler.postTask`: Chrome 94, Firefox 142. `scheduler.yield`: Chrome 129, Firefox 142. Safari has neither.
  - `isInputPending` is no longer recommended (web.dev).
  - Long Animation Frames: Chrome 123 only.
  - **Event Timing reached Safari 26.2, so INP is now measurable in all three engines.**
- **Network.**
  - `fetch(..., { priority })`: Chrome 101-103 (sources disagree), Firefox 132, Safari 17.2.
  - Cloudflare honours RFC 9218 priorities on HTTP/3. Whether Supabase's Cloudflare-backed CDN passes them through is untested.
  - Chrome does not implement `Cache-Control: immutable`.
- **MapLibre GL JS.**
  - `render(gl: WebGL2RenderingContext, options)`, and `prerender` with the same signature. A custom layer may assume only blend
    and depth state, with premultiplied alpha.
  - Globe needs the provided shader prelude and `projectTile`, with subdivided geometry.
  - **Version: MapLibre v6.16.0 is current; the repo pins `^5.24.0`.** An upgrade is its own task; no lever here depends on it.
  - deck.gl's interleaved overlay shares the GL context, supports MapLibre v4.5.1, v5 and v6, and allows one overlay per map.
- **WeatherLayers GL** hides derived layers while its timeline plays and preloads every datetime before playback.
  - It supports N1's "never fetch at seek time".
  - It also supports skipping derived overlays (glyphs, labels) during a scrub, re-run on settle.

## 9. Ranked levers (round 2)

**How to read the table:**

- **Served?**
  - **no**: ships ON with a kill switch.
  - **visual**: ON with a kill switch, owner A/B.
  - **SERVED**: dark, the owner flips (D-001), with a SCOREBOARD row.
- **Owner sessions:**
  - IS = instant-scrub / GPU frames (client store, labels);
  - SF = static-frames (publisher, indexes, parity);
  - RZ = real-zooms / mid zoom;
  - PT = the point lane's owner (backend `/point`).
- **Gains** are against the instant contract: tap p50 <= 50 ms / p95 <= 100 ms, drag <= 33 ms a step, 0 blank frames,
  labelled holds.

| # | Lever | Owner symptom | Expected gain | Risk | Served? | Owner | Test | Evidence |
|---|---|---|---|---|---|---|---|---|
| **N1** | **A CDN floor at every tier, and finer tiers as declared refinements.** (a) the coverage-contract script (C1-C7), tooling only; (b) a store refusal (`crop_only_narrow`, `crop_only_set`, a regional set past its last frame) hands off to the 2-deg PLAIN crop of the same model and run, labelled by cell size, never to `/grid`; (c) the server's regional choice published as data in the index, with one shared `select()` and shared test vectors; (d) ICON/EURO tile-first + bundles for 0-48 h (scope note, section 2); (e) a refinement (the sharpen) stamped with run and cell size, so the client upgrades the drawn frame instead of holding it; (f) **draw-success telemetry** for C7: per ask, answered → drawn (ms) or the named reason, in the existing `instantTelemetry` beacon, plus a quarantine list (a frame or product that fails to draw N times is skipped for its floor, and counted) | the z9 EURO stall class; every T2/T3 EURO/ICON cell is `/grid` (3.1) | T2/T3 EURO/ICON first pixel: `/grid` 123-776 ms, or never → the floor at resident speed (<= 17 ms once packed; #601's crops 7-15 ms p50). Stuck-or-blank cells → 0 by construction. The `/grid` cell count becomes a shrink-only number | Medium. A 2-deg floor looks coarse at z9 (label it, refine fast). C4 parity needs (c) first. The dynamic-lane caveat (3.4) | (a)(b)(c) no, where C2 proves the floor equals `/grid`'s first answer; (d) no if parity; retiring the sharpen = SERVED | IS (b), SF (a, c, d), PT (e); after the z9 session's fix | TC | 3.1-3.4; deck.gl `best-available`, MapLibre overzoom, GIBS "Best Available", Windy bounds rule |
| **N3** | **One readout.** (a) The card shows its own time words whenever its served frame differs from the drawn one; (b) a dark server flag (`POINT_FOLLOWS_DRAWN_FRAME`): no timestamp swap when the client sends the drawn frame; the client sends the drawn served time and run at every width | map and card each honest about a DIFFERENT frame, silently (5.1) | Silent map/card mismatches → 0 (I1); the card's offshore value within tau of the pixel (I2) | (a) low; (b) medium: card numbers move at off-lattice, held and estimated hours | (a) no (words); (b) SERVED | IS (a), PT + IS (b) | TP | 5.1-5.4; earth.nullschool's one interpolator; NWS validity intervals; ECMWF point naming |
| **N2** | **Rating frames on the CDN, from `apply_surf_overlay` itself.** A u16 score plane (score x 10) paired by sha12 with its height frame; a `chain_hash` set key; republish on any input change; a separate score array pool; the band = a uniform + `triggerRepaint` | band ON 4.4 s; band-ON scrub on `/grid surf=1`; the 1,056 MB memory spike | ON: 4.4 s → next frame (p95 <= 33 ms) when resident. Band-ON step: `/grid` → <= 17 ms resident, <= 100 ms CDN. The box's rating work leaves the request path. ~1.6-3 MB a GFS run | Medium. Gate freshness (owner's call), wind-choice drift, the latent masked-cell behaviour (4.3); the `chain_hash` guard falls back to `/grid` | no, if parity is exact at equal blob versions; the staleness window is the owner's | SF + IS/RZ | TR | 4.1-4.3 |
| **N4** | **Every marine layer resident.** Pack swell_1 / wind_waves / swell_2 into the GPU store (waves only today), generalise the regional resident per model and layer (`isGfsWaves`), and ingest EURO swell_1 / wind_waves at 2 deg (none exists) | "all marine layers"; swell layers step at CDN speed; EURO swell layers `/grid` every hour | swell_1 / wind_waves steps: CDN 0.34-0.71 s on a miss → <= 17 ms resident; a layer toggle from the store | Low-medium. GPU memory: one world set = 181x83x4 B x 113 ≈ 6.8 MB; 12 model-layer sets would be ~81 MB, so keep the active set + 1-2 warm (the pool's `maxArrays = 4`); EURO 2-deg swell is a new product | no (store); EURO 2-deg swell ingest = SERVED (mid zoom goes from 10-deg to 2-deg) | IS; SF + ingest | TC (layer axis) | 3.1; `AB-RESULTS-GPU-frames-session.md` |
| **N8** | **Request lanes keyed on the target** (round 1 L4; only the toggle part landed in #598). An in-flight request is kept only while its target (model, layer, hour, flavour, snapped box) is still wanted, with an epoch checked at commit. A superseded `/grid` is detached, at most 1 | far jumps waiting on a stale target; the stranded fetch; any `/grid`-tier cell (N1 shrinks those, it does not remove them) | the next target's request starts within 1 frame instead of after a stale round trip (seconds); 0 commits from a stale epoch | Medium-high: the dispatch core | no | IS | T4 (round 1) | round 1 6.3 |
| N5 | **Scrub motion and wording rules** (section 6): pending words only after ~300 ms, an indicator past ~1 s, held at least ~500 ms once shown; a pause control for the particles (WCAG 2.2.2); held-key repeats coalesced to the latest hour per rAF; a hard cut while dragging, and a <= 100 ms data-space blend only on release (L11, A/B); `prefers-reduced-motion`: no blend, particles slowed or held | pending words at 0 ms (#602); a held arrow commits on EVERY repeat (~33/s, `ForecastWheel.js:305-315`) where a drag commits at 11 Hz (`:291-292`); the particles have no pause control (WCAG 2.2.2) | Pending words on a resident step → 0; key-repeat steps absorbed at the platform repeat rate (~30 steps/s) with one commit per frame | Low; the blend is visual (A/B) | no / visual | IS | T5 (below) | section 6 |
| N6 | **Real model hours** (round 1 L6, sized in shared notes `ingest-proposal-L6.md`). Section 7 says a 6 h gap is fixed only by cadence: **L6b first** (EURO real 6-hourly to 360 h, ~2.5 min a cycle) | "nearest stored" past EURO step 144; blended EURO tail | 16-18 real EURO steps replace the blend; peak retention 0.75-0.78 → 1 at those steps | LOCKED contract (L6b); ingest time | SERVED | SF + ingest | T6b (L6 note) | 7.1-7.2 |
| N7 | **Labelled 3 h interpolation in the shader** (round 1 L7), with the infobox on the same frames and weights (N3b). Needs the shaders to read the texture array directly (GLSL ES 3.00 `sampler2DArray`; today GLSL ES 1.00 with pinned rewriters, and a per-step layer copy of ~0.02 ms) | "nearest stored" on 2 of 3 hourly steps | Off-lattice Hs MAE 4.9-6.0 → 1.4-1.8 cm, labelled | The shader port; the card must follow, or no interpolation | SERVED (dark) | IS + PT | T7a-c (round 1) | 7.1, 7.3 |

**The order is N1, N3, N2, N4, N8, then N5-N7** (the table's row order; the IDs are kept stable across drafts) [inferred, with
Reflection's review in 9.1]:

- **N1 first.** It is the general form of every live "stuck" or "slow at this zoom" report this program has logged: z8 ICON
  toggles, the GFS regional past day 5, z9 EURO.
  - Its parts (a)-(c) and (f) are client, index and telemetry work that move no served number.
  - Ship the contract script (a) and the telemetry (f) FIRST, as the gate: they measure the gaps before the floor hand-off (b)
    changes anything.
  - Ship it after the z9 session's fix, so that fix's regression case joins TC.
- **N3 second.** "Correct data in the infobox" is the owner's explicit ask. Its words-only half (a) is cheap and ends the silent
  disagreement now. Its served half (b) waits for the owner.
- **N2 third.** It is the only path to an instant band ON, and it takes the heaviest per-request work off the one CPU. It needs
  the `chain_hash` equality between CI and the server measured first.
- **N4 fourth.** It finishes "every marine layer" once N1's floor exists for those layers.
- **N8 fifth.** Every cell that N1 leaves on `/grid` still needs the request lanes to never wedge.
- **N5** is polish on a path that already never blanks (#602).
- **N6 and N7** matter as much for "correct data", but they wait on the owner (served numbers; N6b touches the LOCKED contract).

### 9.1 Reflection (Beam) review, once, on selected context (no secrets) [cited-2: model output, advisory]

The review was asked to be adversarial on N1-N8 and given the measured state above.

- **Most dangerous assumption:** that CDN, server and CI reference the same run, and that a successful `/grid` or index entry
  means the frame is actually drawable. The z9 EURO case already contradicts this. **Adopted:** C7 "drawn or said", and N1(f).
- **Missed lever:** draw-success telemetry, quarantine of undrawable frames, and explicit stale-run reporting. **Adopted** as
  N1(f).
- **Ranking:** correctness (N3) before the rating frames (N2), and the request lanes (N8) above polish (N5). **Adopted.**
- **Missing measurements it named, now owed by the builders:**
  - CDN hit rate by tier, model and hour;
  - frame age at draw;
  - refusal reasons;
  - sharpen acceptance rate;
  - CI-vs-server `chain_hash` equality and the band's `/grid` fallback rate;
  - readout error by theme;
  - client memory and eviction hit rate by device class.
- **Not adopted:**
  - The claim that N4 would worsen the 1,056 MB spike: that spike was on the server; N4 spends client GPU memory.
  - The claim that the infobox stays inconsistent "in light mode" under N7: it read "dark" (the flag state) as the theme.

## 10. Acceptance tests (offline only)

**Rules carried from round 1 and the regression sweep:**

- Offline only: `serve_synthetic.py` or the real resolver under TestClient, a local CDN copy, Playwright scenarios in
  `frontend/scripts/offline-backend/`. Never the live box.
- REAL frames for every arm.
- Build the SPA with `REACT_APP_ICON_STORED_TAIL=true`, as the dev deploy does (regression sweep, finding 7).
- Read the app's anchor from `__RAW_SELECTED_FRAME__.labelMs − hour`, never `valid_time − hourOffset` (sweep, finding 3).
- Measure an idle two-rAF first; above ~40 ms report counts only.
- A timing claim needs a same-window control build.
- Every test has a kill-switch arm that must FAIL it.

### TC (N1): the tier x model x layer x hour coverage contract

- **Script:** a new `coverage_contract.mjs`.
  - Read `latest.json` and every set and bundle index from a local CDN copy.
  - Probe views:
    - world;
    - z4.6 Florida (T1);
    - z6.5 Biscay, outside a box (T2);
    - z8 Florida, in a box (T3);
    - z9 Bay of Bengal, outside every box (T2).
  - For each view, model, layer (waves, swell_1, swell_2, wind_waves), band state (off, on) and hour 0..336:
    1. call the client's own pure path decision (the same functions `tryShowStoredFrame` and `staticEligible` use, with a stub
       engine) and record `resident | cdn | grid`;
    2. record the product id that path would draw;
    3. ask the offline resolver at the same box and hour, and record its product id. Run its background tasks to completion,
       then ask again and record the second id.
- **Output:** a JSON matrix plus a count per class. The doc's section 3.1 table is its first expected output.
- **PASS** (ratchet):
  - **C1:** the count of `grid` cells not on a written allow-list never grows, and the allow-list only shrinks.
  - **C2:** every `cdn`/`resident` cell's product id equals the resolver's first id.
  - **C3:** the resolver's second id equals the first, or is a declared refinement (same model, run and valid time, finer
    `grid_cell_deg`).
  - **C4:** every fallback cell draws the same model and run at a coarser tier, never another model.
  - **C5:** the second id equals the first with the index order shuffled.
  - **C7** (browser, `scn_instant_contract.js` extended): every answered ask is drawn within the budget or the reason is
    counted, and 0 "answered, never drawn" asks. Include the z9 session's repro of EURO h141-h155 once it exists.
- **Controls:**
  - The kill `__RAW_DISABLE_PLAIN_SET_CROPS__` must move the T1 EURO/ICON cells back to `grid`.
  - An injected index that lists a frame with `path: null` must count as `grid`.

### TR (N2): band ON from the CDN, numbers unchanged

1. **Publish offline:** rating sets for the 2-deg global_mid (mid zoom) and the pilot boxes, all three models, from a REAL stored
   run, through the same `apply_surf_overlay` chain, with `RATING_LOCAL_SIZE=1` and `RATING_OBS_GATE=1` as served.
2. **Parity:** node by node against `/grid surf=1` from the offline resolver at every published hour, at EQUAL blob versions
   (climatology and spot-ratings ETags recorded in both).
   - PASS: 0 score differences, mask exactly equal, and the bytes the client packs equal the encoder's bytes from the JSON.
   - Controls: a perturbed wind field, and a different spot-ratings blob, must each fail.
3. **Client:** band ON and OFF 50 times at z4.6 and z8, three models, three themes, desktop and phone, with every `surf=1` /grid
   held 20 s by the mock.
   - PASS: ON and OFF each paint by the next rAF (p95 <= 33 ms) when both layers are resident.
   - PASS: 0 `surf=1` asks for listed hours.
   - PASS: band-ON scrub step p95 <= 17 ms resident, <= 100 ms from the CDN.
   - Control: kill arm = today's 4.4 s ON.
4. **Once, live** after the owner's word: one 3-box parity read on the real resolver, health probed before and after.

### TP (N3): one readout

- **Harness:** a new `scn_one_readout.js`.
  - Tap 7 sites (the `marine-card-matrix` fixture's: coast, open ocean, enclosed sea, near the antimeridian) at hours on the
    lattice, off the lattice, in the estimated tail and in the day-14 hold.
  - Run it for 3 models x waves / swell_1 / wind_waves.
- **Record:**
  - the drawn record (`__MARINE_DRAWN__`: model, `runMs`, served time, product id);
  - the `/point` response's `served_valid_time`, `product_id` and `model_run_time`;
  - the card's time words and the status line's words;
  - the GPU-sampled height at the tap pixel (one-pixel read-back of the height byte, decoded with `u_heightScale`).
- **PASS:**
  - **I1 frame identity:** the card's (model, run, served time) equals the drawn record's, OR the card shows its own time words.
    0 silent differences.
  - **I2 offshore value:** where the card quotes an offshore Hs or a swell component, |card − GPU sample| <= tau (section 5.4).
    - Dark: 3.9 cm (CPU emulation) or 6.3 cm (GPU read-back).
    - Light / beach: 3.1 cm or 7.8 cm.
    - Gated on cells whose four corners are valid. Masked-corner cells are reported, not gated.
  - **I4 scrub coherence:** card values unchanged while the wheel stays within one drawn frame.
  - **I3 surf height:** the card's surf height equals the `/point` breaking height from `surf_point`, and is labelled as surf,
    never as the offshore Hs.
  - **I5 rating:** the rating card's served time equals the card's.
- **Control:** today's build must show at least one silent I1 difference at an off-lattice hour (the timestamp swap), or the test
  is not seeing the case.

### T5 (N5): held keys, pending words, reduced motion

- **Harness:** `scn_instant_contract.js` plus a held-key driver.
  - `keydown` with `repeat: true` every 30 ms and every 50 ms, for 3 s.
  - Then `keyup`, then 2 s idle.
  - Each case is run on a resident set and on a set whose frames the mock delays 0.2 / 0.8 / 2 s.
  - Desktop and phone, three themes, and `prefers-reduced-motion: reduce`.
- **Record:**
  - render-driving commits per second;
  - the drawn hour per rAF against the wheel's hour;
  - the time to the exact hour after `keyup`;
  - the first appearance and duration of the pending words;
  - long animation frames.
- **PASS:**
  - commits <= 1 per rAF, and <= the drag path's 11 Hz while held;
  - drawn hour = the wheel's latest hour within 1 rAF on a resident set;
  - the exact hour on screen <= 100 ms after `keyup`;
  - pending words never shown on a resident step, never before 300 ms, and shown >= 500 ms once shown;
  - under reduced motion, 0 blended frames;
  - 0 blank frames throughout.
- **Control:** today's build must show ~33 commits a second on the 30 ms arm.

## 11. Not found, unverified, and open

**No primary source found for:**

- Surfline's map tiers (marketing only, 403).
- Windy's overzoom past `maxTileZoom` (inferred, not in the plugin types).
- Whether Windy's map interpolates in time.
- Per-method Hs interpolation error at 3 h and 6 h gaps in any paper. The program's hold-out stands as the best evidence.

**Not read in full:** the Dentale et al. and NBM PDFs (excerpts and abstracts only), and MDPI *Oceans* 7(2):35 (403).

**Unverified in code this session, owed before building:**

- Whether the rating's wind sampler sees the HRRR wind lane (N2 key).
- Whether the client hides the coastal cells that keep their offshore height in the score channel (`surf_rating.py:740-741,
  771-772`; N2).
- GFS swell_2 CDN coverage (3.1).

**Not this round's:** the cause of the z9 EURO h141-h155 stall (the z9-euro-scrub-stalls session).

**Open for the owner:**

- **N1:** for the dynamic lane, (a) accept it as a refinement only when its run equals the floor's, or (b) replace the sharpen with
  published 0.25-deg frames (SERVED).
- **N2:** how stale a CDN band may be against the live observation gate (one republish cycle).
- **N3b:** the card follows the drawn frame (SERVED).
- **N4:** EURO 2-deg swell_1 / wind_waves ingest (SERVED: mid zoom goes from 10-deg to 2-deg).
- **N6 / N7:** real hours and labelled interpolation (round 1's L6 / L7).

## 12. Method and tools

- **Code:** read at `dev` `4bd90d0d9` with Grep and Read. Every `file:line` above was opened this session.
- **Program record:** round 1 (#599) and its log, REGRESSION-MATRIX and the regression-sweep log, the CDN coverage log (#597),
  the PR bodies of #590 #597 #598 #600 #601 #602 #603 #609 #610, and memory `instant-everything-2026-10-22`.
- **Shared notes:**
  - `AB-RESULTS-GPU-frames-session.md`;
  - `C-LABEL-AND-INTERPOLATION-PROPOSAL.md`;
  - `ingest-proposal-L6.md`;
  - `PILOT-TILE-TOGGLE-SCOPE-2026-10-25.md`;
  - `precompute-surf-frames-cost-estimate-2026-10-24.md`;
  - the flag-register addendum.
- **Four parallel research agents**, one per question group: tiers, rating frames, point/field consistency, perception and
  browser facts.
  - They used WebSearch / WebFetch, raw GitHub sources, Context7 (MapLibre, deck.gl, WeatherLayers) and the skills
    `hyperframes:hyperframes-animation`, `mapbox:mapbox-data-visualization-patterns` and `modern-web-guidance:modern-web-guidance`.
  - They read four papers in full through a local PDF text extractor.
  - Their full reports, with a URL per claim, are in this session's scratchpad: `r2-agent-tiers.md`, `r2-agent-rating.md`,
    `r2-agent-point.md`, `r2-agent-perception-browser.md`, and `sparse_gzip_probe.py`.
  - This session re-checked every code claim they made. Corrections are marked in the text: the PLAIN floor, the u16 score, and
    the dark theme's floor rounding.
- **Paper search:** the `huggingface-skills:huggingface-papers` skill (the HF papers search API, four queries). One relevant hit:
  HourGlass, arXiv 2607.11457.
  - Elicit's paper search was refused (plan), and Semantic Scholar returned 429 to the agents.
  - The Consensus connector failed to connect this session.
- **Reflection (Beam):** one adversarial review on selected context, no secrets (9.1).
- **Box load:** no request to the Render box or the dev site. The PC was heavily loaded (shell calls took 1-3 minutes), so no
  timing was measured this session. Every number above is from the record or from arithmetic.
