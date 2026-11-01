# 2026-10-22 (claude, wind instant scrub, a subagent of the lead): wind instant on toggle and scrub

Written 2026-10-22T22:40Z. Branch `claude/wind-static-frames` from dev `6a03c442a` (merged dev `57632973b`, then `efec1adfa`). Design:
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

## Numbers (2026-10-23T02:40Z; full table in the design doc section 5, raw in the evidence file)

Offline, owner window, live-like latency. Old = dev `d1dbeed8b`; new = this branch.

- **Toggle Waves -> Wind** (z2, z3.9, z4.4, z6, z9):
  - old: 3.3-6.9 s, and never within the window at z6; 2-5 backend calls;
  - new: data in place in 1-168 ms, first pixel 104-228 ms, 0 backend calls.
- **Steps:**
  - old: 24 of 50 never reached the hour's 2-degree field; 8,259 thinned frames;
  - new: 0 of 50 missed; drawn p50 27-44 ms and p95 70-112 ms; 0 backend calls at world and mid zooms (0.4 a step at z9, the sharpened overlay).
- **Held keys** (12 presses 40 ms apart): old 0 of 60 reached their hour; new p50 23-41 ms, 4 of 60 missed the gap.
- **Wrong labels:** 0 in every arm. **Thinned frames:** 0 on the new build.
- **The z2 1.1 s outlier** from the first baseline is gone (mapped-vector reuse).
- **Reviewed build** (+ /capabilities check), second run: toggle data 3-138 ms, drawn 128-200 ms, 0 backend calls; step drawn p50 38-61 ms.
- **Mismatch arm:** lane-window hours go to `/grid` (4.6-8.3 s) and later hours stay static, with 0 wrong labels.
- **Parity:**
  - frames 0-20 (the whole lane window): 3.04M nodes, 0 bad;
  - frames 21-109, every 4th: 10.75M nodes, 0 bad;
  - texture within 1 LSB.
- **Contract misses, stated plainly:**
  - The toggle's first pixel (104-228 ms) is over the 100 ms bar. The data is there; the remainder is the engine's first draw after mount (PR C).
  - Held-key p95 is 35-49 ms against 33 ms.

**No served number changes**, so there is no SCOREBOARD row: the frames equal `/grid` node for node. The only backend change a user can see is
an added `/capabilities` field (`wind_lane` on GFS wind rows).

## Review (static-frames session, 2026-10-22)
Five findings, all fixed in `e3a3831e5`:
1. The pointer could move back to an older lane. The pilots run now re-reads L2, and the pointer never moves backwards.
2. The runner env could differ from the box. Fixed with shared code constants, the runner env ignored, and `/capabilities` reporting the box's constants with a client equality check. The owner confirmed Render sets neither variable.
3. `refresh` keeps the last lane. This residual is documented.
4. `lane_weight` only on valid nodes.
5. Naming.

## Plan approved by the lead
PR A (this), then PR B (CI-side rebuild of the lane-window frames after a new lane), then PR C (warm engine, first pixel).
Changes to how particles behave go to the owner as a side-by-side A/B first.
