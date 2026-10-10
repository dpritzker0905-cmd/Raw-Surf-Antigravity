# 2026-10-09 · The hurricane eye still moved on a zoom stop: a 2-deg clip replaced the finer box

Owner, on live dev after #293 (the HRRR lane) and #295: "investigate the zoom eye of storm movement again, its still
happening as I test live dev", with a console log (GFS, valid 2026-10-10T00Z, the Gulf storm). In the log the engine
files four grids as its "fine overlay", one after another:
- 29x24 (696 vectors) and 18x13 (234, the `viewport_..._-95.00_24.00_-78.00_36.00` box);
- also 19x15 (285) and 15x11 (165).

## Not the model mix-up this time

#287 / #293 removed the two-upstream cause: HRRR is blended on every GFS tier. What remains is the sampling lattice.
- **Tiers (code map).** For a wide view (spans ~20-180°, about z3-6) the server answers with the 2° WORLD grid clipped to
  the box (`mid_res_tier.filter_grid_to_bbox`: the base's own nodes, no resampling). Narrower views get an Open-Meteo
  `gfs_global` box at 1° (area ≤ 400 deg²), 0.5° (≤ 100) or 0.25° (≤ 25), point-queried at its lattice nodes. The HRRR
  lane is sampled onto whichever lattice is served. No tier averages.
- **Filing (engine).** The commit gate passes any grid that covers the view. `setWindData` refused a coarser grid only
  when it lay inside the resident fine box. A 2° clip of a WIDER view is not inside it, so it replaced the 1° box, and
  the next delivery filed the box again. Last arrival wins.
- **Live read** (my own tab, one short session, health probed): at z6.6 the resident overlay was a 1° box (20x12, -98..-79
  / 24..35). One stop out (z5.6), the delivery log filed a 20°-wide grid and then the 19°-wide box as "fine", ~20 ms
  apart: the swap.

## How much it moves the eye (eye bench, the real engine on the GPU, offline)

The same 0.5° storm (fixture `eye-2026-10-09-gfs-native.json`) drawn at another lattice:

| tier vs the 0.5° grid | eye centre | weakest wall | eye area |
|---|---|---|---|
| 1°, every 2nd node | 16.7-17.1 km | -12 kn | x4.5 |
| 1°, every 2nd node, the other phase (a box snapped one node over) | 25 km | -8 kn | x3.8 |
| 1°, 2x2 mean of u/v | no closed eye (the peak falls 78 → 62 kn) | | |
| 2° clip | no closed eye (the positive control) | | |
| null: same data, other box / other zoom | 0-0.3 km | 0 | x1 |

## Fix (client only; no served number moves)

`windOverlayKeep.baseClipKeepsFine`, asked by `WebGLWindEngine.setWindData` before it files a coarser grid. A grid no
finer than the resident world base (within 1.3x) never replaces a fine overlay that is clearly finer (1.3x). It carries
only the base's own nodes, and the base keeps drawing them around the finer box. Verdict: `noop_base_clip` (counted in
`window.__WIND_LAYER_DELIVERY__.verdicts`). Kill: `window.__RAW_DISABLE_WIND_CLIP_KEEP_FINE__`. With no finer overlay
resident, the clip still files as before. A 1° box still replaces a 0.5° one: it carries data the base lacks. The engine
file shrinks by one line (the LOC ratchet).

Eye bench, the zoom-out swap (a finer box resident, then the 2° clip of a wider view arrives), z5.5 / 6 / 6.5:

| resident | with the fix | kill switch (positive control) |
|---|---|---|
| 0.5° box | 0 km, 0 kn, x1 (`noop_base_clip`) | the clip is filed; no closed eye |
| 1° box | 0 km, 0 kn, x1 (`noop_base_clip`) | the clip is filed; no closed eye |

Tests: `windTwoTexture.test.js` (filing on a real 2° base: the owner's 18x13 box vs the live 13x14 clip, kill, a 1° box
over a 0.5° one, no resident overlay); `windOverlayKeep.test.js` (the rule, the kill, the antimeridian, wiring).

## Still open (not in this fix)

- **Zooming IN still refines the lattice** (1° → 0.5° → 0.25°). Each step is finer, so the eye converges, but it can
  still move by up to half a cell (~25 km at 1°). Zooming OUT from a 0.25° box to a covering 1° box moves it back.
  Holding one lattice for the storm across zooms needs either a three-level texture hierarchy (base, mid, fine) or
  serving the storm region at one spacing at every zoom: a design for the owner, not a patch.
- **Different GFS cycles in one picture.** The 2° world grid comes from NOAA's cron cycle and the boxes from
  Open-Meteo's latest run; compare their `run_time` in a trace.
- **Health after the live session read 10-12 s** (0.4-0.8 s before). A fresh map load costs three world series pages.
