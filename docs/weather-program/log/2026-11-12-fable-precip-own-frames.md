# 2026-11-12 Fable (animation lane): precipitation on our own frames, part 1 (ingest, OFF)

The owner, 2026-11-12: "Yes, build it", answering "Build precipitation on our own published frames next, as we did for
pressure?". Why: precipitation is now the slowest layer to scrub (see the measurement below) and, like pressure before
#812, it draws through the Open-Meteo tile library, whose per-tile whole-field copy is not tunable.

## Measured before (offline, dev `59a7fa0c`, dark theme, ONE run per cell; `scn_layer_anim.js` + `anim_frames.py`)
| run | toggle first / full ms | blank frames | step settle p50 / max ms | rAF p95 scrub ms | long-task ms toggle / scrub |
|---|---|---|---|---|---|
| radar desktop | 66 / 166 | 0 | 417 / 2573 | 17.6 | 121 / 0 |
| radar phone (CPU 4x) | 531 / 4185 | 0 | 292 / 348 | 158.0 | 3437 / 3631 |
| rain desktop | 137 / 3224 | 0 | 547 / 2018 | 32.8 | 314 / 491 |
| rain phone (CPU 4x) | 95 / 1129 | 0 | 744 / 2139 | 93.0 | 2444 / 2186 |

Against the 2026-11-11 baseline (`bdd5c4b30`): radar phone blank frames 273 -> 0 and toggle 2159 -> 531 ms (the radar
worker PRs). Rain's scrub step is the worst cell on both viewports.

## What this part adds (nothing a user sees: the set is off and no client reads it)
- `frame_binary`: field 10 `precip_mm_h` (u16, 0.01 mm/h, code 0 = no data; tolerance 0.005 mm/h). The browser codec
  reads field descriptors from the frame, so it decodes the new field unchanged.
- `frame_set_raster`: set `GFS/weather/precipitation/global_0p25` (1440 x 721, every point), hours f001-f120 hourly then
  3-hourly to f336 (192 frames; no f000). Source `GfsPrecipSource`.
- Workflow step "Publish raster static frames (GFS precipitation; off unless FRAME_RASTER_PRECIP=1)".

## What a frame holds, and why
The amount that fell in the step BEFORE the frame's time, as mm/h (past f120 the mean over the 3 h before it): the same
meaning as the Open-Meteo `precipitation` field the layer draws today. GFS has no such message. Its APCP is a running
total inside a 6-hour bucket (f007 "6-7 hour acc", f012 "6-12 hour acc"), so a step = this hour's bucket total minus the
previous hour's, and the bucket's first step is its total alone. Two byte ranges at most, both NCEP's own fields. Not
used: the instantaneous PRATE (a model-timestep rate, spikier than an hourly amount and a different meaning from what the
layer shows) and the run total "0-N hour acc" (differencing large totals loses packing precision at long leads).

## Evidence (real cycle 2026-11-12 12Z, read from NOAA's public bucket; decoded locally with eccodes 2.50)
| hour | world max mm/h | world mean mm/h | cells > 0.1 mm/h | max abs diff vs NCEP's PRATE mean for the same step |
|---|---|---|---|---|
| f007 (bucket's first step) | 41.62 | 0.0967 | 15.5 % | 0.055 |
| f008 (a difference) | 29.31 | 0.1002 | 15.9 % | 0.090 |
| f126 (3-hour step, a difference) | 54.17 | 0.1094 | 18.7 % | 0.034 |

No negative value after the clamp. One encoded frame (f126): 2,076,576 bytes raw, 273,822 gzipped, parity 0 bad nodes,
max abs error 0.005 mm/h. Estimated per cycle: 192 frames x ~274 KB = about 53 MB, two cycles retained; about 350 byte
ranges (pressure's 113 built in 6.4 s).

## Tests
`tests/test_frame_set_raster_precip.py` (7) and the codec tolerance pin (+1): 34 passed in the two files; the other raster,
entitlement and workflow-condition suites: 64 passed (a local venv that is not the declared CI environment).

## Not measured / not done
- A real publish (step time, bytes, coverage): needs `FRAME_RASTER_PRECIP=1`, the owner's call.
- The client half (draw rain from these frames behind a dark lever, legend, credit, kill switch, three themes, the
  before/after): next PR. EURO and ICON precipitation: not in this set; those models stay on the present path.
- Second opinions (Reflection, LongCat): not yet taken for this PR.

# Part 2 (same day): the client draws rain from these frames, DARK

## What changed
- `ownRasterFrames.js`: `OWN_RASTER_SETS.rain` (GFS only, field 10, mm/h). DARK: drawn only behind the lever
  `window.__RAW_RASTER_OWN_FRAMES__ = 'rain'`; kill `window.__RAW_DISABLE_RASTER_OWN_RAIN__ = true`. EURO and ICON have no
  set, so with those picked the layer stays on the .om path.
- `staticFrames.js`: the set key added to `STATIC_SETS` (33 sets). Without it the lever did nothing and no miss was counted
  (found by the first offline run); `ownRasterSets.contract.test.js` now fails any own-frames set the reader does not know.
- `ownRasterLayer.js` / `useOwnRasterFrames.js`: `RAIN_LUT` (0..60 mm/h in 0.02 steps) built from the app's own
  `precipitation` ramp, and `RAIN_OPACITY_STOPS` = the .om rain slots' stops. `MapWebGL.js`: the hook, and rain left out of
  the .om path while engaged. Legend credit ("NOAA GFS") and the time readout follow from the shared own-frames code.
- `scn_pressure_own.js`: `LAYER`, `FLAGS`, `TAG_SUFFIX` (the same A/B for any own-frames layer).

## Before / after (offline; 72 real frames of GFS 2026-11-12 18Z published to the local stand-in in 23 s, 13.1 MB;
before = the .om path replayed; 12 scrub steps; phone = 390 x 844, dpr 3, CPU 4x)
ms from the last scrub key until the wanted frame is drawn / ms from toggle until drawn:

| | settle before | settle after | toggle before | toggle after |
|---|---|---|---|---|
| desktop dark, 3 runs | 1724 / 5652 / 5217 | 11 / 17 / 9 | 32476* / 408 / 347 | 459 / 480 / 352 |
| desktop light, beach | 5001, 5303 | 10, 10 | 375, 363 | 567, 546 |
| phone dark, 3 runs | 9033 / 8738 / 6619 | 71 / 81 / 26 | 554 / 965 / 697 | 1992 / 1496 / 1590 |
| phone light, beach | 9939, 10993 | 49, 44 | 1640, 1197 | 1040, 2000 |

- Bytes per run: 2.87 MB in 16 frames against 3.3-7.5 MB in 64-144 range requests.
- Desktop long frames during the scrub: after, none in 4 of 5 runs (one 7.2 s frame in the first run, the same run whose
  .om arm took 32 s to toggle*: the machine, not the path; not reproduced). Phone scrub long-frame blocking: 1.3-2.5 s
  after against 2.0-7.0 s before.
- **The phone toggle is slower on own frames in four of five pairs** (about 1.0-2.0 s against 0.55-1.6 s). Not profiled.
- The two arms use different "drawn" tests, and show different model runs (our 18Z frames; the replayed .om tiles), so
  the pictures are compared for palette, opacity, legend and layout, not pixel for pixel.

## Look (three themes, desktop and phone; sheets sent to the owner)
Same ramp, opacity, legend and layout in dark, light and beach; the credit reads "NOAA GFS". In BOTH arms light rain is
faint on the light and beach basemaps (pale blue on a pale-blue sea): the ramp is not theme-varied. Not changed here.

## Tests
+16 frontend tests, +1 suite (rain set contract, lever, kill, LUT, opacity; the reader contract). The twelve touched
suites: 174 passed locally. Lint ratchet not worse.

## Not measured
A real phone; Safari and Firefox; memory; play mode; frames past 72 h (the 3-hourly range); a real publish.
