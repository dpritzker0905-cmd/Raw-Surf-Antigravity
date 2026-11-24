# 2026-11-22: native 1/12-degree Copernicus currents on the surf boxes (DARK)

**Asked by:** the director, from the research lead's Q3 note (PR #1141), red flag 1:

> We down-sample Copernicus GLO-PHY currents from native 1/12° to 0.25°, which throws away its coastal advantage, exactly where surfers look.

The brief:
- Build a dark regional native-1/12° set behind a flag.
- Measure the size per run.
- Keep `uo` / `vo` (not SMOC).
- Make the animation read it.
- Add a kill switch.
- No skill claims in labels.

## What was built
**Backend:** `backend/services/frame_set_raster_currents_native.py`
- One set per marine pilot box (the 14 boxes in `pilot_regions`). Key: `CMEMS/marine/currents/<box>_0p083`, every 6 h to 240 h.
- Every source cell, with no regrid: the box is snapped inward to the source lattice.
- The world set's one-byte frame layout (the speed band, field 13), plus the flow direction byte (field 14) at **every** cell (`dir_stride` 1, stated in the index as `grid.flow_dir_stride`).
- One read of the ARCO store per hour feeds every box, and it fetches only the chunks the boxes touch.
- Published through `frame_set_raster.publish` unchanged (coverage floor, parity, index, latest.json, retention).
- Its own pilots step: `--bundle currents_native`.
- Monitored by name in data-health-monitor.yml.

**Client:** `frontend/src/components/map/currentNative.js`
- Applies only when the Currents particles are flowing on the Copernicus world set and the **whole view** sits inside one box.
- The particles then advect on that box's native frame for the same hour.
- The marks' colour and sea texture travel with the grid (`grid.colourField`).
- Anywhere else, with another ocean model on screen, or on any miss, the world grid flows.
- The raster is unchanged.
- **Labels:** none changed. Same model, same credit.

## Size per run (measured)
Measured from the real 2026-11-22 00Z bulletin, offline `--out-dir`.

| Measure | Value |
|---|---|
| Frames per run | 574 (14 sets × 41) |
| Kept | 7.0 MB per run |
| Pulled | 1.34 GB per run (the store chunks the boxes touch) |
| Wall time | 49 s |
| Parity refusals | 0 |
| Per frame (gz) | 3.6 kB (south_africa) to 35.6 kB (indonesia) |

Frame-layout variants, measured on the same hour (+24 h, all 14 boxes, 224,710 cells), per run:

| Layout | Per run |
|---|---|
| Band + one-byte direction per cell (**chosen**) | 7.0 MB |
| Band + direction per 2 × 2 block | 5.3 MB |
| Band + two-byte direction | 13.9 MB |
| Two-byte speed + direction | 14.8 MB |
| Band only | 3.8 MB |

The per-cell byte keeps the direction at the native resolution, which is the point of the set. It costs 1.7 MB a run over the 2 × 2 anchors.

## Browser check (offline harness)
Frames came from the real 22 Nov run, served locally. The world currents set (hours 6-30) and the 14 box sets were in one latest.json, with the client lever on.
- **Inside the Florida box at z8.6-10:** `window.__RAW_CURRENT_NATIVE__` read `{box: florida_east_coast, state: flowing, cols: 73, rows: 85}`. The particles were drawn on the native grid; the world grid is 720 × 361.
- **Panning out:** the state went to `outside` and the world grid flowed.
- **Kill:** `__RAW_DISABLE_CURRENTS_NATIVE__` took effect at the next pan, without a reload.
- **Console:** no errors.

## Switches
- **Backend (DARK):** repo variable `FRAME_RASTER_CURRENTS_NATIVE = '1'` to publish. The direction byte follows `FRAME_RASTER_DIR_BYTE`.
- **Client (DARK):** `window.__RAW_CURRENTS_NATIVE__ = true` (or localStorage `'1'`) to read the native sets. Kill: `window.__RAW_DISABLE_CURRENTS_NATIVE__ = true`. Also off with the Currents particles' own kill and under prefers-reduced-motion.

## Not done / follow-ups
- **No skill claim.** Whether 1/12° verifies better near the coast is the Q3 pre-registered check's "GLO-PHY native" arm.
- **The raster still draws the world 0.25° set.** Drawing the native box raster under the marks is a separate change.
- **The read is duplicated.** The world currents step and this step each read the store, about 1.7 GB + 1.34 GB a day. Feeding both from one read would save about 1.3 GB a day.
