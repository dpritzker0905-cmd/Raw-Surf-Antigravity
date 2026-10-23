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
  lane and is older than 330 s (the box re-reads the lane every 300 s), AND `/capabilities` reports the box blending with the
  frames' recorded constants (GFS wind rows' `wind_lane` = {enabled, feather_km, taper_hours}, `wind_lane.box_state`; unknown or
  different -> `/grid`); otherwise `/grid` serves that hour. A box with the lane off (`enabled: false`) gets `/grid` for every
  hour. A frame outside both windows is GFS on both sides and gets the stamp `/grid` would give it from the pointer's lane.
- The constants: one shared pair in code (`wind_lane.FEATHER_KM_DEFAULT` = 200 km, `TAPER_HOURS_DEFAULT` = 3 h). Render sets
  neither variable (owner, 2026-10-22), and the publisher ignores its runner's env (`frame_set_wind.pin_code_defaults`).
- The pointer never moves backwards: the pilots run re-reads L2's lane index right before writing it, and
  `write_lane_pointer` keeps a pointer that already names a newer HRRR cycle.
- Residual: `wind_lane.refresh` keeps its last lane on an L2 error or timeout, so for a while the pointer can name a lane the box
  has not loaded. The 330 s settle covers a normal re-read; `__RAW_DISABLE_WIND_STATIC_LANE_HOURS__` covers a box stuck on an
  older lane.
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
`__RAW_DISABLE_WIND_STATIC_CROP__`, `__RAW_DISABLE_WIND_STATIC_LANE_HOURS__` (lane-window hours ask `/grid`); lever `__RAW_WIND_PREFETCH_IDLE__ = false` (fetch nothing until wind is shown).
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

Setup:
- Offline only (`scn_wind_toggle.js`), on the real GFS 2026-10-22 12Z wind run with the real HRRR 18Z lane.
- Owner window 844 x 390 at dpr 2, beach theme, Waves -> Wind.
- Live-like latency injected: `/grid` 1.5 s, `/grid_series` 0.5 s + 0.25 s a frame, CDN 150 ms.
- Before the toggle, a zoom in/out and a 200 px pan (the owner's gestures).
- After the toggle, 10 steps (1 h, 3 h, a day, five days, back), then 12 held ArrowRight presses 40 ms apart.
- Builds: old = dev `d1dbeed8b`, new = this branch. One session per zoom per arm, interleaved.

Clocks:
- **view**: from the toggle or keypress to the engine holding the correct hour's 2-degree field.
- **drawn**: until that hour has been drawn on screen (a patched `engine.render`).

| zoom | old: toggle view | new: toggle view / drawn | new: step drawn p50 / p95 | new: held key p50 / p95 | backend per toggle, old -> new | backend per step, old -> new |
|---|---|---|---|---|---|---|
| z2 | 3,327 ms | 4 / 168 ms | 32 / 75 ms | 30 / 44 ms | 3 -> 0 | 0.4 -> 0 |
| z3.9 | 6,218 ms | 1 / 210 ms | 37 / 91 ms | 28 / 35 ms | 3 -> 0 | 0.8 -> 0 |
| z4.4 | 6,942 ms | 7 / 122 ms | 27 / 75 ms | 41 / 45 ms | 3 -> 0 | 0.8 -> 0 |
| z6 | never in the window | 168 / 228 ms | 44 / 112 ms | 23 / 38 ms | 2 -> 0 | 1.1 -> 0 |
| z9 | 6,081 ms | 73 / 104 ms | 34 / 81 ms | 30 / 36 ms | 5 -> 0 | 1.2 -> 0.4 (the sharpened overlay) |

- **Old build:**
  - 24 of 50 steps never reached the pressed hour's 2-degree field inside the window, and 8,259 thinned frames were drawn.
  - None of the 60 held presses reached its hour within the 40 ms gap.
- **New build:**
  - 0 of 50 steps missed, 0 wrong-label frames, 0 thinned frames, 0 blank frames.
  - 4 of 60 held presses missed the 40 ms gap (z2 1, z4.4 3).
  - 0 `/grid` or `/grid_series` calls per toggle and per step at world and mid zooms.
  - The earlier z2 1.1 s step outlier is gone (z2 step p95 75 ms) since mapped vectors are reused.
- **Against the instant contract:**
  - Tap steps: met at every zoom, at p50 ≤ 50 ms. p95 ≤ 100 ms holds except z6 (112 ms).
  - Held keys: about one rAF over the 33 ms bar at p50 for z4.4.
  - Toggle first pixel: NOT met. It is 104-228 ms against ≤ 100 ms. The data is in place in 1-168 ms; the rest is the engine's first draw after the layer mounts (PR C: warm engine, first pixel).
- **The reviewed build** (the /capabilities check, the backend restarted on it) gave the same picture in a second run:
  - toggle view 3-138 ms, drawn 128-200 ms, 0 backend calls;
  - step drawn p50 38-61 ms and p95 83-122 ms; held-key p50 28-44 ms;
  - 0 wrong labels, 0 thinned frames, 0 blank frames.
- **Lane-key mismatch** (`new-alt`: the pointer names another lane):
  - The toggle's hour (inside the lane window) goes to `/grid` as before: 4.6-8.3 s, 3-5 backend calls.
  - Steps beyond the lane window stay static (4 of 10).
  - 0 wrong labels: the safe direction, and what PR B closes.
- **Parity** (`scn_wind_static_parity.mjs`, the app's own windStaticFrames.js against the real resolver, node by node, at
  offsets 0/+1/+2 h of each frame, 69 boxes: the world box and 66 crops served, 2 at or under the 20-degree cap refused to `/grid`):
  - frames 0-20, every frame (the whole HRRR lane window, f000-f054): 1,176 comparisons, 3.04M nodes, 0 bad;
  - frames 21-109, every 4th: 4,623 comparisons, 10.75M nodes, 0 bad, max error speed 0.005 kn, direction 0, u/v 0.0076 kn;
  - the wind texture (`encodeWindTexture`'s formula) matches byte for byte in 98.9-99.0% of bytes, and by 1 LSB in the rest.

## 6. Open

- **The lane match rate.** The core lane publishes a new HRRR cycle ~4 times a day; the pilots lane republishes frames 3-4 times
  a day. From today's run times the frames' lane and the box's differ ~40% of the day (1-3 h after each new HRRR cycle), and in
  those windows the next ~48 h (the lane window) are served by `/grid` as before. The lead picked (b) as PR B (2026-10-22: a
  CI-side rebuild of the lane-window frames, the box untouched). The two options were:
  (a) run the HRRR lane ingest in the pilots lane right before the frames publish, and not in the core lane (the lane would
  update on the pilots cadence: a served-timing change, D-001); (b) a core-lane step that, after a new lane, rebuilds only the
  lane-window wind frames from the stored products (~17-19 product downloads, ~45 MB, ~4 times a day) and moves the pointer.
- Close zooms (z6, z9): the base is instant; the sharpened overlay is an on-demand product and still comes from `/grid`.
- ICON and EURO wind have no static set yet (the same publisher would take them; ICON/EURO world boxes also carry the Gulf
  fill question #461 found for marine).

## 7. Correction, 2026-10-23: the box can hold an older lane than the pointer names (live read of #468)

Section 2 assumed the box re-reads its lane every 300 s. It did not: `current_lane()` refreshed only when a wind `/grid` or
series request asked for the lane, and #468 took most of those requests away. Live on 2026-10-23, the box kept the 10-22 18Z HRRR
cycle for ~5 h after the 06Z cycle was published and pointed at. The frames (06Z) then differed from `/grid` (18Z) on 733 of
15,919 CONUS nodes, by up to 13.6 kn. Within a minute of one `/grid` request the box loaded 06Z and the same check passed node for
node. Repaired by `claude/wind-box-lane` (log `2026-10-23-claude-wind-instant-scrub.md`):
- a keeper thread re-reads the lane index every 300 s, whatever the traffic;
- the box reports the lane it holds (`GET /api/weather/wind_lane`, /capabilities `wind_lane.key`), and the client serves a
  lane-window hour only when that key equals the frames'. The pointer stays as the early warning for a new lane.
