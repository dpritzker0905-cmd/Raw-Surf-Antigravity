# 2026-11-01 (claude, rating-frames session): item 10, the Surf Rating band and the swell layers from CDN frames (DARK)

Branch `claude/quizzical-montalcini-ba44c1`, cut from dev 340e70c07, merged with dev 69b4f4595 (#664). Started by the lead
(local_d6b521eb). Local commits only: pushes were held for Codex's PR664 when the task started. Draft PR to dev once the lead
says pushes are OK.

## Ask (the lead, relaying the owner's "instant everywhere" item 10)

Make turning the Surf Rating band ON, and scrubbing `swell_1` / `swell_2` / `wind_waves`, draw from precomputed CDN frames instead
of `/grid`. Rating values must be byte-for-byte what `/grid?surf=1` serves, through the ONE FORECAST COMPOSITION chain, with a
parity test against `/grid`. The client read path ships ON with a kill switch only if it changes no served number. Anything that
changes a served number ships DARK. CI publishing may be built; the lead turns it on.

## What was built

- **Publisher** (`backend/services/frame_set_rating.py`, `frame_set.publish_set`, `publish_frame_images.py --only rated`). One
  set per world set, `<model>/marine/<layer>/global_mid_rated` (GFS waves/swell_1/swell_2/wind_waves, ICON waves/swell_1/wind_waves,
  EURO waves).
  - Each frame is the stored product rated **by the served overlay itself** (`grid_resolver_surf.apply_surf_overlay`), not a copy.
  - The overlay skips any extent of 350 deg or more, so the world product is rated as two sub-350 halves and merged. The transform
    is per cell (`rating_transform_grid`), so this equals rating any crop.
  - Frame = the stored product's four planes, byte-identical to the plain frame's, plus a u32 RATING plane (`frame_binary` field 9):
    0 untouched, 1 masked (is_valid false, phys_speed = height), k + 2 rated (speed = k / 10000, phys_speed = height). A node the
    code cannot carry exactly refuses the hour (`unbuilt: rating_refused`, /grid serves it).
  - The rating reads the ASK time twice: the wind product per cell (finest covering within 3 h) and the gate's confirmed spots. Each
    frame lists `ask_offsets_h`, the asks (-3..+3 h) whose wind choice (`choose_for_point`, reduced exactly to the candidates that
    can win a cell) and confirmed set equal the frame's own. With 3-hourly wind that is -1, 0, +1.
  - A wind product the sampler needs that is not on the runner's disk refuses the hour.
  - Carry-over key per frame: the chain (every env value it reads, the climatology identity, a hash of the chain's source files and
    bundled data) plus the ask signatures at all seven offsets. The index records the chain identity (`rating_chain`) with the gate
    blob's identity.
  - `grid_resolver_surf.confirmed_spots()` is a verbatim extraction from `_build_observation_gate` (no served change).
  - CI: its own step in `forecast-ingest-pilots.yml` after the frames step, **off unless repo variable `FRAME_RATING_SETS=1`**, budget
    `FRAME_RATING_BUDGET_S` (600 s), chain env set equal to precompute.yml / Render (`RATING_LOCAL_SIZE=1`, `RATING_OBS_GATE=1`,
    `SHORE_NORMAL_BEARING_RADIUS_KM=3.0`).
- **Client** (`staticRatingFrames.js`, two lines in `staticFrames.js`, `staticFrameCodec.js`). A surf ask is served from the rated set
  only for a crop box `/grid` answers from global_mid (`midCropRulesPass`), minus boxes the surf-only regional preference could
  hand a tile (`pick_surf_regional_override`: request <= 15 deg either way overlapping a regional tile), at a listed ask offset.
  World boxes, z7-9 regional tiles, other offsets, unbuilt hours and the series lane keep `/grid` / `/grid_series`.
  **DARK**: on per browser with localStorage `__RAW_RATING_FRAMES__='1'` or `window.__RAW_RATING_FRAMES__ = true`, per build with
  `REACT_APP_RATING_FRAMES=true`; kill `window.__RAW_DISABLE_RATING_FRAMES__ = true`. Telemetry `window.__RAW_STATIC_FRAMES_RATED__`.
  - Why dark although parity is exact: the gate (spot-ratings blob, 300 s TTL on Render) and the size climatology (600 s) are read
    once per publish, so a CDN band can lag the box by up to one republish. How stale a band may be is the owner's call (D-001).

## Measured (offline only: real backend app on a synthetic store, `serve_synthetic.py --land-mask 1`; no live load)

### Parity vs the real `/grid?surf=1` (`scn_rated_crop_parity.mjs`, the app's own modules)

| Set | Asks claimed | Nodes (rated) | Bad | Metadata mismatches | Plain-frame control (bad) | Refused-offset control |
|---|---|---|---|---|---|---|
| GFS waves | 318 | 165,991 (13,684) | 0 | 0 | 124,737 | none (3-hourly frames and wind: no refused asks) |
| EURO waves | 312 | 174,414 | 0 | 0 | 131,616 | 40 asks, 7 bad nodes (the offsets matter) |
| ICON swell_1 | 216 | 120,441 | 0 | 0 | 88,842 | 2 asks, 0 bad (exit 1 on the strict "control must find" rule only) |

Rated speed is compared EXACTLY; phys_speed and the other fields at the frame's quantisation (height 0.5 mm). Publish: 115/115
GFS frames, 99/99 EURO, 0 refused, 0 parity_bad, ~16 KB a frame (1.6-1.8 MB a run per set), ~1.5-2 s a world frame on this loaded
PC (a set ~3-4 min).

### Band ON (`scn_band_toggle.js SCN=on`, z4.6 desktop dark, one build interleaved A/B; backend `--dynamic 1`)

Three centres (Florida -80.6,28.1; SoCal -120,34; Sydney 150,-33) x 3 rounds, arms interleaved A B / B A from build-after; plus
build-before once per centre. "Rating grid" = click to the first animation frame with a rating grid resident; "painted" = the band
actually drawn (`__RAW_GPU__.ratingBand.active`). 12 s watch per session.

| Arm | Sessions | Rating grid p50 / p95 (min-max) | Painted | surf asks to the box in the first 5 s | Blank frames |
|---|---|---|---|---|---|
| build-before (today) | 3 | 3,390 / 7,479 ms (1,838-7,479) | 0 of 3 | 3 | 0 |
| build-after, lever off (= today) | 9 | 5,111 / 9,695 ms (3,155-9,695) | 0 of 9 | 9 | 0 |
| build-after, `__RAW_RATING_FRAMES__` | 9 | **123 / 177 ms** (105-177) | 0 of 9 | **0** | 0 |

The /grid arms wait behind the box's own series pages (one process). One rated session made a later surf ask at 8.5 s (a re-ask, not
the band ON). No arm PAINTED the band at z4.6 within 12 s: see Found.

### Swell steps

`scn_instant_contract.js`, PLAN `R,R,R,PU,J:29,J:126,D:12,R,R,PD`, dark desktop, z2 and z4.6, one round each build (round 2
stopped to free the machine). Swell code is unchanged by this branch, so before/after is a no-regression check.

| Model / layer | build-before step p95 (z2 / z4.6) | build-after step p95 (z2 / z4.6) | Backend /grid asks during the steps |
|---|---|---|---|
| GFS swell_1 | 199 / 171 ms | 190 / 178 ms | **0** (every step a CDN frame) |
| GFS wind_waves | 197 / 148 ms | 185 / 177 ms | **0** |
| GFS swell_2 | harness "missed 9/9" (frames labelled "nearest stored forecast", not called exact) | same | **0** |
| ICON swell_1 / wind_waves | not run | 3,558 / 2,936 and 3,472 / 2,972 ms, via /grid | yes: see below |

- **GFS swell already draws from CDN frames on every step** (0 backend asks). What is left is 130-190 ms per step because the GPU
  frame store packs WAVES only (`marineFramePack.packStaticFrame`, `getPinnedIndexSync`): lever N4 (pack swell_1 / swell_2 /
  wind_waves into the store) takes these to resident speed. Not built here.
- The ICON rows are a harness setting, not a live reading: this backend ran without the targeted Gulf fill, so the client correctly
  refuses ICON's plain world frames (`serveTimeFillAtWorld`). Live has had the fill ON since D-052. Re-run with
  `MARINE_GULF_FILL_MID_TARGETED=1` on both the backend and the publisher before quoting ICON.
- EURO swell has no 2-deg product at all (10-deg coarse only): a new served product, the owner's call.
- Rated sets now exist for GFS swell_1 / swell_2 / wind_waves and ICON swell_1 / wind_waves, so a band ON over a swell layer reads
  the CDN too (parity measured on ICON swell_1).

## Found

- **The band never paints from a 2-deg rating grid.** `marineRatingBandRes.js` (the owner's 2026-10-25 manual test) holds the band
  at cells of 1.0 deg and up and says "Surf ratings paused: the detailed rating grid for this view is still loading." So a rated
  global_mid crop gives the rating grid at once, but painting the band still waits for a <= 0.5-deg rating grid: a regional tile
  (z7-9 in a pilot box) or the box's dynamic 0.25-deg viewport product. Item 10's "band ON instant" therefore needs FINE rated
  frames: rated regional bundles for the GFS pilot boxes (0.25 deg, `frame_set_bundle` + the regional client) first. Outside the
  boxes, the painted band comes from the dynamic lane, which has no stored product to publish.
- Python 3.14 on this PC has no numpy, so `bathymetry` falls back to "coastal everywhere" there. Run the publisher and the harness
  with `backend/.venv` (3.12), as CI does.

## Part 2 (11-02 ~01:30Z, "Build bundles here"): the RATED REGIONAL bundles, what the band paints from

- **Publisher:** `frame_set_rating.rated_regional_sets()` = every GFS regional bundle set (`frame_set_bundle.REGIONAL_SETS`) with the
  rated variant, key `GFS/marine/<layer>/<region>_rated`. `publish_bundle_set` passes the run's `ChainInputs` to `publish_set`.
  The rated step publishes the regional waves bundles FIRST, then the world GFS waves set, then the other regional layers, then the
  other world sets (`rated_publish_sets`). Off with `FRAME_RATING_REGIONAL=0`. Fixed on the way: a tile entirely on one side of 0 deg
  (all US boxes) had an empty half and every frame refused (`min()` of nothing). Offline: florida_east_coast / us_west_coast_socal
  waves and FL swell_1, 115/115 frames each, 0 refused, 0.2-0.4 MB a bundle, 11-25 s a set.
- **Server, DARK (a served-number change):** `MARINE_REGIONAL_TILE_FIRST_SURF` (Render, default '0', registered in `_RATING_FLAGS`).
  With `MARINE_REGIONAL_TILE_FIRST=1` it lets surf asks follow the tile-first rule, so `/grid?surf=1` in a box the stored tile fully
  covers is rated on that tile, never a warm dynamic-cache product (another lattice, possibly another run). Today surf is excluded
  from tile-first, so a rated bundle could not equal `/grid` wherever the dynamic cache is warm. `/capabilities` reports it on GFS
  marine rows (`regional_tile_first_surf`).
- **Client:** `staticRatingFrames.ratedRegionalTile` = `pickRegionalTile` + `_rated`, only while the lever is on AND /capabilities
  reports the flag. The ask goes through the existing regional seam (`tryStaticRegionalGrid`, passed in), after its own check that the
  frame is built and rated for this ask hour. Rated keys stay out of the GPU store's regional crop show.

### Rated regional parity vs `/grid?surf=1` (`scn_regional_client_parity.mjs RATED=1`, backend with both flags, `--dynamic 1`)

| Layer | Boxes claimed | Nodes (rated) | Bad | Claimed but the backend did not serve the full tile |
|---|---|---|---|---|
| waves (FL + SoCal) | 27 | 13,463 (7,045) | 0 | 0 |
| swell_1 (FL) | 12 | 4,452 (3,223) | 0 | 0 |

Rated speed is compared exactly. The flag-off control is `test_regional_tile_first.py`: with surf alone the dynamic cache answers.

### Band ON PAINT inside the pilot boxes (z8, one build `build-after2`, interleaved)

Florida (-80.6, 28.1) and SoCal (-118.5, 33.7) x 3 rounds, A B / B A. Arm today = backend tile-first on, surf flag off, lever off;
arm rated = backend with both flags, lever on. "Painted" = `__RAW_GPU__.ratingBand.active` with a rating grid resident. 10 s watch.

| Arm | Painted | Paint p50 / p95 (max) | Rating grid p50 | Box surf asks in the first 5 s | Blank frames |
|---|---|---|---|---|---|
| today (`/grid?surf=1`) | 5 of 6 (one not within 10 s) | 7,696 / 8,685 ms (8,685) | 7,679 ms | 1-2 every session | 0 |
| rated bundles | **6 of 6** | **136 / 702 ms** (702) | 119 ms | **0** | 0 |

The 702 ms one (SoCal round 2) held its first 2-deg frame for ~430 ms before the bundle landed (a cold bundle fetch). The rated
sessions' later surf asks (one each, after 5 s) are re-asks outside the band ON.

## Not done / owed

- Outside the pilot boxes the painted band still comes from the box's dynamic 0.25-deg lane (nothing stored to publish): a decision.
- The flips, both the owner's: Render `MARINE_REGIONAL_TILE_FIRST_SURF=1` (a served-number change), then the client lever; repo
  variable `FRAME_RATING_SETS=1` (the lead).
- The swell GPU-resident lever (N4: the frame store packs waves only) and EURO 2-deg swell (a new served product): not built.
- Ledger `pr_open` line when the PR opens; the live read after the lead sets `FRAME_RATING_SETS=1` and the owner decides staleness.
