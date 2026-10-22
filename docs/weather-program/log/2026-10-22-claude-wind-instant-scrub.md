# 2026-10-22 (claude, wind instant scrub, a subagent of the lead): wind instant on toggle and scrub

Written 2026-10-22T22:40Z. Branch `claude/wind-static-frames` from dev `6a03c442a` (merged dev `57632973b`). Design:
`docs/architecture/static-wind-frames.md`. Evidence: `evidence/wind-instant-scrub-2026-10-22.json`.

## Ask
The owner, 2026-10-22 17:13 EDT, relayed by the lead: "Just from my visual checks, the marine instant scrub is improving vastly. I
did notice however, wind is not immediately instant scrub upon toggling over to that layer. However it does work after a little
while. Please check all your work, and research this." His console (dev bundle 8b396b11, beach, GFS): a world /grid (15,023
vectors) and five viewport fine grids at the toggle, "Cache miss for wind at hour +6h. Fetching immediately..." on the first step,
966-vector series frames later, and ~15 "Fetching wind (attempt 1/5, offset: 0h)" with aborted fetches at hour 0.

## Instruments (new)
- A REAL GFS wind run offline: NOAA GFS 2026-10-22 12Z (113 frames, f000-f336) and the real HRRR 18Z lane (49 hours), built by
  the production fetchers and normalizer (gribberish standing in for pygrib, orientation checked against the GRIB's own section 3
  and 14 land/sea places); `serve_synthetic.py --real-wind/--real-wind-lane` serves it with the lane installed as the box's.
- `scn_wind_toggle.js`: Waves -> Wind at the owner's window (844 x 390, dpr 2) and zooms, a zoom/pan GESTURE phase, 10 steps;
  per window the time to the correct base and view, backend requests, wrong-label and thinned frames, the storm's console lines.
- `scn_wind_static_parity.mjs`: the app's own windStaticFrames.js against the real resolver, node by node, plus the wind
  texture's bytes.

## Found
- The toggle at the owner's zooms waits on 2 `/grid` (world + viewport clip) and a `/grid_series` mini; the first steps are
  debounced `/grid` round trips; the series pages, once landed, show a thinned 46 x 21 world (8-degree cells) in place of the
  2-degree field `/grid` serves (synthetic baseline, owner window: 7-8 of 10 steps at z2-z4.4 never reach the 2-degree field).
- `/grid` answers wind boxes over 20 degrees with the global_mid clip (the static frame's own numbers); at or under 20 the mid
  tier sharpens to a dynamic product (measured on the real store: 156/80/42/26-degree boxes mid, 14-degree dynamic).
- `/grid` blends HRRR into GFS wind at serve time (D-017) over CONUS for the HRRR cycle's 48 h, including the world tier; so a
  frame must carry the lane, and the client must know whether the box holds the same lane.
- The storm needs gestures: offline without them the toggle logs 1 attempt; with a zoom in/out and a pan, 3-6 attempts.

## Built (each in the design doc)
Publisher: GFS wind global_mid frames with the lane applied, the lane pointer, `wind_lane.lane_use` shared. Client: seam A
(world + mid crops), synchronous world base in every scrub path, instant press commit with idle pre-build, idle prefetch of the
run while another layer is shown, series world pages skipped. Kills listed in the design doc.

## Numbers
(filled in below when the interleaved run lands)
