# Static wind frames: instant wind on toggle and scrub (2026-10-22)

Owner, 2026-10-22 17:13 EDT: "Just from my visual checks, the marine instant scrub is improving vastly. I did notice however,
wind is not immediately instant scrub upon toggling over to that layer. However it does work after a little while."

## 1. Why wind was slow (each claim with its instrument)

- Wind had no CDN frames. The toggle asked the 1-CPU box for the 2-degree world base (`/grid`, global_mid, 2.4 MB of JSON)
  and the viewport clip of the same product, then a `/grid_series` page per 48 hours (~10-25 s of the box each).
- Until a page landed, every keyboard step was a debounced (150 ms) `/grid` round trip ("Cache miss for wind at hour +6h.
  Fetching immediately..."). When the pages landed, steps were instant but drew the series' THINNED world (46 x 21, 8-degree
  cells), coarser than the 2-degree field `/grid` serves, and the next viewport fetch replaced it.
- The owner's "fetch storm" at hour 0 is the fetch loop re-entered by zoom and pan events while the toggle settles
  (moveend, zoomstart, dragstart; `scn_wind_toggle.js` GESTURE phase).
- At the owner's zooms (z2, z3.9, z4.4 in an 844 x 390 window) `/grid` answers wind with the global_mid clip; only boxes at or
  under 20 degrees (z6, z9) are sharpened to an on-demand dynamic product (`mid_res_tier`, `WIND_MID_REVAL_MAX_SPAN`).
  Measured on the offline real store: 156, 80, 42 and 26-degree boxes -> global_mid clips; a 14-degree box -> a dynamic product.

## 2. What ships

**Publisher** (`backend/services/frame_set_wind.py`, `frame_set.SETS` last, the pilots lane, beside the marine sets):
- GFS wind global_mid (3-hourly f000-f336, 113 frames, 181 x 83), RSWF v1 with two new field ids:
  `speed` (u16, 0.01 kn, the unit in the index meta; height's 1 mm u16 tops out at 65.5) and `lane_weight` (u16, only when HRRR touched the frame).
- **The HRRR lane (D-017).** `/grid` runs `wind_lane.apply_wind_lane` on every GFS wind grid it serves, blending HRRR into
  CONUS for the HRRR cycle's 48 h. A frame of the stored product would not equal `/grid` there. So every frame is the stored
  product WITH THE LANE APPLIED by the same function and the lane the box loads (L2 `wind_lane/index.json`), checked node by node;
  the index records the lane, and its key is part of each frame's source identity (a new lane rebuilds the set; frames the
  lane does not touch keep their bytes and path). `wind_lane.lane_use` is now the one function both the served blend and the
  publisher use to decide which nodes HRRR touches.
- **The lane pointer.** `v1/wind_lane.json` (no-cache, in the frames bucket) names the lane L2 holds; it is written by the core
  lane's HRRR lane ingest after each publish and by the frames publisher. Its `written_at` is kept while the key is unchanged.

**Client** (`windStaticFrames.js`, `windFramePrefetch.js`, `windStaticEngine.js`; seams in `backendWindServiceClient.js`,
`windGridSeries.js`, `WeatherEngine.js`):
- Seam A: a WORLD box, or a viewport box over the 20-degree sharpen cap (and at most the client's own 180-degree band, no
  antimeridian, no regional wind tile that could win), is answered from the frame (a clip by `staticFrameCrop.midClipWindow`,
  the server's own arithmetic), with `/grid`'s lane stamp rebuilt for the clip from the `lane_weight` plane.
- The lane check: a frame inside either lane's window (or carrying HRRR) is served only when the pointer names the frames' own
  lane and is older than 330 s (the box re-reads the lane every 300 s); otherwise `/grid` serves that hour. A frame outside both
  windows is GFS on both sides and gets the stamp `/grid` would give it from the pointer's lane.
- The scrub paths (drag, keyboard step, warm commits, the base-first commit) take the hour's world frame synchronously from
  bytes already here before the thinned series; a step whose grid is already here is committed on the press (no 150 ms
  debounce), and the next likely hours (+-1, +-3, +-24 h) are built in idle time.
- The world series pages are not asked for while static frames can serve every hour of a page.
- Idle prefetch while ANOTHER layer is shown (the marine frame store's policy, #437/#455/#457): desktop fills the whole run
  nearest the cursor first, 2 requests in flight (4 with wind shown), after 8 s; a desktop reading 3g fills (D-048); phones,
  Save-Data, 2g and coarse pointers fetch nothing until wind is shown, then a +-4 frame window.

**Kills** (read per call): `window.__RAW_DISABLE_WIND_STATIC_FRAMES__` (wind only), `__RAW_DISABLE_STATIC_FRAMES_SETS__ =
['GFS/wind/wind/global_mid']`, the global `__RAW_DISABLE_STATIC_FRAMES__`; `__RAW_DISABLE_WIND_PREFETCH__`,
`__RAW_DISABLE_WIND_INSTANT_STEP__`, `__RAW_DISABLE_WIND_PREBUILD__`, `__RAW_DISABLE_WIND_SERIES_STATIC_SKIP__`,
`__RAW_DISABLE_WIND_STATIC_CROP__`; lever `__RAW_WIND_PREFETCH_IDLE__ = false` (fetch nothing until wind is shown).
Publisher: `FRAME_SETS` without the wind key; core lane pointer: `WIND_LANE_POINTER=0`.

## 3. No served number moves

Every frame passes the publisher's parity gate against the lane-applied product (speed 0.005 kn, direction 0.005 deg, u/v
0.006 + 1e-4 x speed, validity exact). Offline against the real resolver (the real 2026-10-22 12Z run and the real 18Z HRRR
lane, `scn_wind_static_parity.mjs`): see section 5. The wind texture built from both (`encodeWindTexture`'s formula) is
byte-identical in 99.0% of bytes and differs by exactly 1 LSB in the rest (the 0.01 kn step at a byte edge, as on the marine
path). Lossless u/v (i32) would remove that and double the frame (~110 KB).

## 4. Cost

- **Egress:** ~51 KB a frame, 113 frames: **5.79 MB per run** (measured on the real run). A desktop session that keeps the map
  open ~1 minute downloads the run once per run (immutable, HTTP-cached); a phone downloads only what wind steps ask (~0.5 MB
  for a +-4 window). GFS waves is ~6.3 MB per run, so a desktop that opens waves and never wind now downloads ~12 MB per run
  instead of ~6.3 MB. At Supabase Pro's 250 GB of cached egress that is ~20,000 such desktop sessions a month.
- **Storage:** current + previous run ~11.6 MB plus ~0.1 MB of index.
- **Publish:** ~0.25 s a frame (lane, encode, parity), ~30 s per run, inside `FRAME_PUBLISH_BUDGET_S`; one 4.5 MB lane read.
- **Box:** zero `/grid` and zero `/grid_series` for a wind toggle and scrub at world and mid zooms while the lane matches.

## 5. Measured (offline, the real run; evidence `docs/weather-program/evidence/wind-instant-scrub-2026-10-22.json`)

(Filled in from the interleaved run: old build vs new build vs new build with the wind kill.)

## 6. Open

- **The lane match rate.** The core lane publishes a new HRRR cycle ~4 times a day; the pilots lane republishes frames 3-4 times
  a day. From today's run times the frames' lane and the box's differ ~40% of the day (1-3 h after each new HRRR cycle), and in
  those windows the next ~48 h (the lane window) are served by `/grid` as before. Two ways to close it, for the lead / owner:
  (a) run the HRRR lane ingest in the pilots lane right before the frames publish, and not in the core lane (the lane would
  update on the pilots cadence: a served-timing change, D-001); (b) a core-lane step that, after a new lane, rebuilds only the
  lane-window wind frames from the stored products (~17-19 product downloads, ~45 MB, ~4 times a day) and moves the pointer.
- Close zooms (z6, z9): the base is instant; the sharpened overlay is an on-demand product and still comes from `/grid`.
- ICON and EURO wind have no static set yet (the same publisher would take them; ICON/EURO world boxes also carry the Gulf
  fill question #461 found for marine).
