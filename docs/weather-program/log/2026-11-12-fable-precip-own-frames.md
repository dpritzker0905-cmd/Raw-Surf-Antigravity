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
