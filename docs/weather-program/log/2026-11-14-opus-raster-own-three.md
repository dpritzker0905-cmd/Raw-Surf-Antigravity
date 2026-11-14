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
