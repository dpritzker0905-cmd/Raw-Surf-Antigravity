# 2026-11-14 — Opus, move 3: fog, air temp and water temp from our own raster frames (branch `opus/raster-own-three`)

Owner, 23:35 EST (via the director): "improve the fog, air temp, and water temp along with the others, so that all lanes are upgrades
and instant". Director: frame sets on the CDN read by the client frame store (no Open-Meteo `.om` hour per scrub step), the server half
by the frame-carry session (#888, merged sets dark by repo variable), the client half here; D-052 per layer: one question per layer
with evidence; the no-regression rule: a layer moves to own frames by default only where its set is at least as fine as today's
`.om` grid.

## What the client does (this branch)

| Layer | Own set(s) | `.om` today | Default |
|---|---|---|---|
| fog | GFS VIS 0.25 deg, for every model | ncep_gfs025 for every model | **ON** (equal grid) |
| water temp EURO | ECMWF skt 0.25 deg | ifs025 | **ON** (equal grid) |
| water temp ICON | GFS skin T 0.25 deg (the fill) | blank (DWD ICON has no skin temperature) | OFF, question to the director |
| water temp GFS | GFS skin T 0.25 deg | gfs013 (0.117 deg) | OFF (coarser) |
| air temp GFS | 0.5 deg + ETOPO downscale | gfs013 (0.117 deg) | OFF, visual-parity comparison below |
| air temp EURO / ICON | 0.5 deg | ifs025 / dwd_icon | OFF until native-grid sets |

Parity built in: each layer's colour is the .om path's own scale object at the shader's lookup (fog 31.25 m: the .om path smooths the
visibility scale to 16 steps per interval; water temp = the library SST scale, breakpoints = air temp's), the slot opacity ramps and the
water street-zoom fade pinned to MapWebGL, water temp's decode-time land fill (the .om path's `applyWaterTempLandFill` against the same
Natural Earth mask, `landCellMaskReady`), water temp anchored below the ocean mask. Fixed in passing: the GFS-terrain downscale is now
GFS only and cleared on a model switch (a GFS -> EURO switch would have kept GFS's terrain correction on EURO's field); a missing
elevation asset (the owner's 400 on dev, 23:53 EST) is asked at most once per 10 min (kill `__RAW_DISABLE_DZ_UNPUBLISHED_CACHE__`).
Kills: `__RAW_DISABLE_RASTER_OWN_FOG__`, `__RAW_DISABLE_RASTER_OWN_WATER_TEMP__`, `__RAW_DISABLE_RASTER_OWN_TEMPERATURE__`.

## PRE-REGISTERED comparisons (written 2026-11-14 ~05:15Z, before any image or number of the after arm is looked at)

**Instrument:** the raster lab (`frontend/scripts/raster-lab/lab.js`, now with per-step `why`: the drawing path and the own-frames
refusals; `summarize.js` adds the slow-step causes). Offline: `serve_synthetic.py` backend, a dev build, the `.om` host through the
record/replay cache, own frames from #888's offline publish served as the CDN stand-in. No live backend.

**1. Scrub (every layer, before = `.om` path via the layer's kill; after = own frames):** desktop and phone (lab phone profile,
CPU x4), GFS / EURO / ICON as each layer's defaults apply, z2 and z6, 10 single steps + a long jump per combo. Gate (the raster lab's
contract): **step p50 <= 50 ms and p95 <= 100 ms, 0 stale and 0 blank frames**, after arm; the before arm is reported beside it.

**2. Visual parity, fog and EURO water temp (ON by default):** the same hour, same view, both arms, z5 / z7 / z9, desktop and phone, dark
theme: screenshot pairs. Pass = no visible coarsening or colour shift judged side by side, plus a numeric read of the drawn field: the
own-frames field and the decoded `.om` field sampled at the same 200 ocean points (`probe_field_parity.js`-style) differ by at most one
colour step of the layer's scale at >= 95 % of points.

**3. Visual parity, GFS air temp (OFF; the director's no-regression question):** as 2, at the coastal views z5 / z7 / z9 (Southern
California, the Gulf of Maine, the Bay of Biscay), desktop and phone. Pass = no visible coarsening of coastlines and terrain gradients
against `.om` gfs013. A coarser-looking field does not ship ON even if faster.

**4. ICON water temp fill (OFF; the director's question):** today's blank ICON view vs the GFS 0.25 deg fill, with the attribution the
status line and legend show for it (the model credit must name GFS for the fill), plus its scrub numbers.

Each layer's question to the director carries: scrub before/after (desktop + phone), the screenshot pairs, the numeric parity read, and
the kill tested (the kill's OFF-path unit test, and the before arm itself is the kill set).

## 2026-11-14 08:34Z: final measurement, gate as written, vote split: DEFAULT-OFF pending David

Instrument: raster lab (`frontend/scripts/raster-lab/lab.js`), offline only.
- Synthetic backend; #889's build `main.cdfc1a8e`. The later commits only move code (LOC split) and flip the defaults.
- Frame-carry's #888 offline publish served as the frame CDN; replay cache clock pinned at 05:16:50Z.
- Own arm vs the same build with `__RAW_DISABLE_RASTER_OWN_FRAMES__` (the kill = the .om path).
- Fresh load per combo, z2 and z6, frame-changing steps only.
- "pre" = the PRE-REGISTERED rAF sampler. "post" = a post-render diagnostic, added and kept apart: own frames are cut inside
  MapLibre's draw, which runs after the rAF sample in the same frame.

Lab defects found and fixed, both arms alike, disclosed:
- The phone timeline drawer is inert until opened (the lab opens it).
- The expected frame was computed from the running clock (now: the clock when the target was set).

**Desktop.** Own vs kill.

| ON candidate | toggle | step p50 / p95 | long jump |
|---|---|---|---|
| fog | 322-355 ms vs 3.8-4.1 s | 29 / 69 vs 88 / 917 ms | 129-146 ms vs 1.5-1.7 s |
| EURO air temp | 308-429 ms vs 5.1-5.2 s | **53** / 71 vs 75 / 96 ms (n=6) | 156-249 ms vs 1.5-1.6 s |
| EURO water | 834-935 ms vs 4.3-4.9 s | 46 / 59 vs 76 / 120 ms (n=6) | 304-333 ms vs 1.8-1.9 s |

| ON candidate | stale on steps, pre / post (kill, pre) | cold-load frames before the first own frame (pre / post) |
|---|---|---|
| fog | 20 / 0 (kill 227) | 12 / 10 |
| EURO air temp | 4 / 0 (kill 17) | 13 / 11 |
| EURO water | 5 / 0 (kill 17) | 17 / 15 |

**Phone** (4x CPU). Own vs kill.

| ON candidate | toggle | step p50 / p95 | long jump |
|---|---|---|---|
| fog | 1.7-1.9 s vs 6.0-6.5 s | 281 / 342 vs 331 / 1312 ms | 454-466 ms vs 2.5-2.7 s |
| EURO air temp | 1.9-2.4 s vs 7.4-8.2 s | 269 / 410 vs 292 / 399 ms | 420-492 ms vs 2.7-2.8 s |
| EURO water | 2.5-3.7 s vs 8.7-9.5 s | 214 / 289 vs 319 / 332 ms | 864-953 ms vs 3.7-4.1 s |

| ON candidate | stale on steps, pre / post (kill, pre) | cold-load frames before the first own frame (pre / post) |
|---|---|---|
| fog | 17 / 0 (kill 114) | 4 / 2 |
| EURO air temp | 5 / 0 (kill 22) | 4 / 2 |
| EURO water | 6 / 0 (kill 21) | 4 / 2 |

Blank frames 0 and timeouts 0 in every row.

The null control (GFS and ICON, OFF, identical code in both arms) holds on desktop, e.g. GFS air temp step p50 945 vs 950 ms. On
phone it is noisy, up to about +-40% on slow .om steps (GFS water 2.7 vs 4.1 s): the phone step-p50 differences of 10-30% are not
outside the noise, while the toggle (3-4x) and long-jump (4-6x) gains are.

**Gate, as written (comparison 1):**
- Step p50 <= 50 ms: NOT met by EURO air temp on desktop (53 ms, n=6); NOT met by any layer on phone, in either arm.
- p95 <= 100 ms: met on desktop, not on phone.
- 0 stale: NOT met by the pre-registered sampler (1 per frame-changing step); the post-render reading is 0.
- 0 cold-load frames: NOT met (desktop 10-17, phone 2-4 post).

Comparisons 2-4 (visual parity, GFS air temp coastal, ICON fill) were not run tonight. The GFS one waits for `elevation_dz_v1.json`.

**Vote (the director, 08:31Z):** Reflection "no" (the pre-registered gate is not fully met; ship default-off and wait for the
owner); SubQ "yes" (0.93). David's rule needs both, so fog, EURO air temp and EURO water ship **DEFAULT-OFF pending David**:
- `DEFAULT_ON_LAYERS` = satellite, pressure; `DEFAULT_ON_MODELS` = {}.
- Kept: the per-layer kills, the lever (preview: `__RAW_RASTER_OWN_FRAMES__ = 'fog,water_temp,temperature'`), the handover, the
  same-frame commit and the unpublished-set fallback.
- Turning them on is one line each in `ownRasterFrames.js`.

**Phone profile (for the next batch):**
- Each step re-renders a large part of the app tree (spot markers, location name, toLocaleTimeString chips). The .om path pays this
  too: the kill-arm key task is 90-150 ms.
- Our readout publish runs ahead of our draw: key-to-shown 180-265 ms, 105-165 ms with the readout killed.
- EURO water decode plus land fill: 570-960 ms per frame on the main thread.
- Filed as next-batch items: take non-critical re-renders off the scrub step; move raster decode and land fill into a worker.
