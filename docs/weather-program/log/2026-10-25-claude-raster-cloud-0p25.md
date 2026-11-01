# 2026-10-25 · claude · cloud cover at 0.25 deg (dark)

The owner (2026-10-25, relayed by the lead) approved the resolution plan: "Go with your recommendation if that is state of the art".
The recommendation was cloud at 0.25 deg, and temperature at 0.5 deg plus elevation downscaling (its own PR). The evidence for the
call is in shared notes `raster-resolution-2026-10-24/`. At 0.5 deg, cloud edges, which are close to 0 or 100 % per cell, draw as
one-cell steps.

## What
- **Publisher** (`frame_set_raster.py`): a spec-level `grid` ('0p5' by default, so every existing set is byte-identical; '0p25' =
  NCEP's own 0.25-deg grid, every point, 1440 x 721, bounds -180..179.75 / -90..90, south row first, 180W first). It is threaded
  through the plane builder (`stride`), `build_frame` (bounds) and the index (`grid`).
- **New spec:** `cloud_cover_0p25`, the same instantaneous TCDC entire atmosphere. Set `GFS/weather/cloud_cover/global_0p25`, opt-in
  `FRAME_RASTER_CLOUD_0P25=1`, with its own workflow step (15-minute timeout). The 0.5-deg set stays publishable.
- **Client:** the satellite layer's set key moves to `global_0p25` (in `STATIC_SETS` too). The shader and the wrap test already take
  the grid from each frame. Dark as before.
- **Test:** shape, every-point mapping from 180W south-first, one byte per node, the index grid, the set key, off by default.
  Chain floor +1.

## Measured
Real GFS 2026-10-25 12Z TCDC, both sets published locally from the SAME cycle with this branch's publisher
(`raster_real_run3.py`: the module's selector, plane, parity and index; curl + ecCodes for the download and decode).

| set | frames | total | per frame | parity | build |
|---|---|---|---|---|---|
| 0.5 deg | 113 | 12.5 MB | 0.111 MB | 0.5 % (the 1 % code) | ~45 s |
| 0.25 deg | 113 | 44.8 MB | **0.397 MB** | 0.5 % | 41 s |

Paired toggle and step timing. Two builds: this branch (0.25) and dev + #558 (0.5). Alternated twice each, dark and light, on the
real clock against one local CDN holding both sets. `probe_own_frames.js LAYER=satellite`, North Atlantic z3.

| arm | toggle (median of 4) | steps p50 / p95 (n = 24) | +96 h jump (median) | bytes, 14 frames | decode per frame |
|---|---|---|---|---|---|
| 0.5 deg | 290 ms | 31.5 / 44 ms | 85 ms | 1.53 MB | 1.0 ms |
| 0.25 deg | 386 ms | 32 / 44 ms | 101.5 ms | 5.48 MB | 4.7 ms |

- Steps are unchanged: the window prefetch hides the bigger frames.
- The toggle and the jump cost about 0.1 s more on a local CDN; a phone on a slow link pays the 3.6x bytes.
- GPU: a resident frame is 1440 x 721 R32F = 4.2 MB (1.0 MB at 0.5). RESIDENT_MAX 6 means up to 25 MB.
- Open-Meteo requests: 0 in every run.

Same-run still (GFS 10-24 18Z, valid 25 Oct 00Z, North Atlantic): shared notes `cloud-resolution-same-run-0p25.png`. 0.5 deg,
0.25 deg and .om side by side in dark and light. At 0.25 deg the edges are smooth and the small cellular clouds survive, close to
.om's 13 km.
