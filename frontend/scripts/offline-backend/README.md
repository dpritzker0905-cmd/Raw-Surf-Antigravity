# Offline backend + browser harness

Replays the real map client against the **real backend app** serving **synthetic stored data**. No request reaches the live
Render box, the database or a bucket, so it can be run as often as needed (the 2026-10-01 live replays saturated the 1-CPU box).

| File | Role |
|---|---|
| `serve_synthetic.py` | Builds a local `ProductStore` (`--layers waves,swell_1,swell_2,wind_waves` and `--models GFS,ICON,EURO` mirror production's tier availability: ICON has no swell_2, EURO swells are Copernicus at global_coarse only, EURO waves are 6-hourly past 144 h; default waves only) — three-hourly GFS AND ICON wave frames (`--models GFS,ICON`; ICON is native to hour 168 and `estimated` beyond, with production's provider fields): 2-deg `global_mid` 181 x 83 and 10-deg `global_coarse` 37 x 17, plus a hurricane-like vortex off Mexico at a KNOWN position) and serves the production FastAPI app over it (`/capabilities`, `/products`, `/grid`, `/grid_series`). `--thin-bounds 0\|1` sets `SERIES_THIN_NODE_BOUNDS` for that process, so an A/B is two processes on two ports. `--regions florida_east_coast,us_southeast_midatlantic` (or `flagship` / `all`) adds production's 0.25-deg `regional_tile` products, boxes and resolutions read from `backend/services/weather_pipeline/pilot_regions.py`. `--dynamic 1` answers the DYNAMIC viewport lane (requests under 15 deg, and the mid tier's background sharpen) from the same synthetic field instead of failing its blocked upstream fetch, so a zoomed-in view commits a grid with its OWN bounds as in production; without it every zoom short-circuits on the 2-deg clip and the client never leaves the world mask. |
| `serve_spa.js` | Static server for `frontend/build` (history fallback). |
| `ab_lib.js` | Playwright (system Chrome) launcher. `/api/weather/*` goes to the local backend; every other `/api/*` is an empty stub; Supabase/push/payment hosts are aborted; **every non-local WebSocket is closed in the browser** (`page.route` does not see sockets); a host audit is kept in `log.hosts` (it counts requests the page ATTEMPTED: `*.onrender.com` entries were intercepted and answered locally or stubbed, never sent). |
| `scn_swap_ab.js` | Scrub replay (jumps of +24, +72, Home, +144, +288, Home) sampling the app's own diagnostics (`__MARINE_RENDER_HOUR_PARITY__`, `__WEBGL_MARINE_UPLOAD_*`, the mask encode mode, a texture-upload spy). |
| `scn_why.js` | After one far jump, dumps the app's own account of why the requested hour is or is not rendered. |
| `scn_gap_variants.js` | Varies zoom, wait time and camera nudges around that jump. |
| `scn_drop.js` | After one far jump, reads the layer's own drop record (`__SWELL2_LAST_DROP__`, the upload reason, the parity). It is how the "stuck scrub" turned out to be a fixture mistake. |
| `scn_home_latency.js` | Live-like latency (`LAT_SERIES` ms per `/grid_series` page, `LAT_GRID` ms per `/grid`, defaults 8000/3000) and a far scrub then Home: compares the app's parity record with what the ENGINE actually holds (grid `hourOffset`, truth tag, upload content hash). `scn_swap_ab.js` takes the same `LAT_*` variables and records the request log in `AB_OUT`. |
| `scn_icon_far.js` | D1 direct-grid acceptance on a production-context bundle (`REACT_APP_ICON_STORED_TAIL=false`): every integer hour 169–240 must reach the engine and upload changed texture bytes. `MODE=fallback` refuses the browser's ICON anchor and requires a stored ICON-anchored estimate; `MODE=kill` checks the old rejection. Series is explicitly disabled so cached three-hour frames cannot bypass the tested estimator. |
| `scn_live_jump.js` | LIVE ONLY (`AB_LIVE=1`): does the drawn field jump while the camera is still? One map load, then three frozen-camera windows (the load settling, a one-stop zoom, a 4-degree pan), consecutive screenshots compared row-profile against row-profile; a redraw in a different place reads as a vertical shift, a window with no redraw reads 0 (the settled tail is the null control). Real load on the box: see the caution at the foot of this file. |
| `scn_layer_matrix.js` | EVERY marine layer x model, scrubbed and switched the same way (2026-10-19). Per step: time to the correct resident grid (hour + layer + model + a new texture upload), whether it came from the series, the time Jacobian dDisplayedHour/dRequestedHour at 300 ms and at settle, and every mismatched frame counted SILENT or ADMITTED by the on-screen status line; per switch: time to the new identity and silent wrong-layer/model frames. Serve the full store (`--models GFS,ICON,EURO --layers waves,swell_1,swell_2,wind_waves`) and pass `FIRST_VALID=<store first_valid>` so each row carries `lattice` (the app's hour 0 is now rounded to the hour, so lattice membership changes every UTC hour: compare A/Bs run back to back, split by it). `AB_BASE` points it at another build. |
| `scn_mask_cost.js` | Times each `setWaveData` in the page and reads the land-mask decision (`reuse` / `retain_*` / `rebuild*` / `stash_swap`) plus the app's own `mask_rebuild` / `mask_stash_swap` events, across layer/model switches at world zoom, zoom and pan, and switches while zoomed in (z7, z9). `THROTTLE=4` slows the page's CPU 4x; `WAIT_MS` sets the settle per action. Regional rebuilds only appear with `serve_synthetic.py --regions ... --dynamic 1`. |
| `scn_position.js` + `cmp_position.js` | WHERE is the field drawn? The same hour and camera rendered as the THINNED world series frame (the exact `/grid` held back by a `beforeWeather` hook) and as the EXACT frame, then cross-correlated on luminance rows. `AB_DIR=<dir>` saves the screenshots; `cmp_position.js <dir>` compares the two servers. A null control (exact vs exact) must read 0 px. |

```bash
# from the repo root, with the backend's venv and a built frontend/build
python frontend/scripts/offline-backend/serve_synthetic.py --dir <empty scratch dir> --port 4100 --thin-bounds 0 &
python frontend/scripts/offline-backend/serve_synthetic.py --dir <same dir>          --port 4101 --thin-bounds 1 &
node frontend/scripts/offline-backend/serve_spa.js frontend/build 3100 &
PORT=4100 node frontend/scripts/offline-backend/scn_swap_ab.js     # and PORT=4101
```

## What it proves, and what it does not
* The **backend side is exact**: thinning, the mid-res tier, the bounds rewrite and every response schema are the production code
  over stored files shaped like production's. Latency is whatever this machine gives; it is not the 1-CPU box's.
* The **data is invented** (a smooth climate plus a moving vortex). Nothing here is a forecast or a number the product serves.
* **Provider fields are load-bearing and must mirror production.** `WebGLMarineLayer` silently drops a frame whose grid provider is not
  whitelisted and keeps the previous hour. The first cut used `provider: "noaa"` (production's GFS waves are `provider: "open-meteo"`,
  `upstream_provider: "noaa"`, `source_dataset: "ncep_gfswave025"`) and produced a forward scrub that never rendered, which looked like an
  app bug for an hour. Before believing a surprising client behaviour here, read `window.__SWELL2_LAST_DROP__` and the parity object.
* The **client is the production bundle** in headless Chrome. A behaviour seen here is a lead for the real app, not a finding about
  it, until it is also seen on the real app (the owner's logs, a recording, or a read-only look at the deployed site).
* Under injected latency the layer's `__MARINE_RENDER_HOUR_PARITY__` / `__MARINE_HEATMAP_STATUS__` can read `retained_previous_hour` for 15+ s while the engine already holds the right hour (the parity effect runs before the upload and nothing re-runs it). Judge what is DRAWN by the engine's held grid and the upload content hash, not by that record.
* Third-party reads still happen (basemap tiles, fonts): they are the same GETs any visitor makes, not our backend.
* **`REACT_APP_ICON_STORED_TAIL` changes which ICON path runs.** `netlify.toml` sets it to `true` only for the dev branch deploy. With it unset (a production-context build) ICON hours above 168 call `fetchBackendMarineGridIconExtended`, which builds client-side `gfs_trend` grids (hours up to 240) or `gfs_euro_blend` (above 240). Before D1 the renderer rejected `gfs_trend`; D1 admits it and recovers the existing stored ICON estimate if the browser's anchor is unusable. Build both contexts when comparing source selection; do not treat that comparison as forecast-skill validation.
* **`AB_LIVE=1` is the one door to the real backend**, and it is opt-in. `/api/weather/*` GETs (read-only, public) then go to the live host while everything else stays stubbed and every socket stays closed; `hooks.afterWeather(url, resp)` sees each response, which `scn_position.js` uses to compare every world `/grid_series` page's declared bounds with the extent of its own cells (the live read-back of `SERIES_THIN_NODE_BOUNDS`). It is real load on the 1-CPU box (one map load = three 48-frame world pages, about 10 to 13 s of CPU each): one run at a time, `/api/health` probed before and after, never in a loop, and not while a CI lane is driving the site.

## D1 acceptance

Build with `REACT_APP_ICON_STORED_TAIL=false`; start `serve_synthetic.py --step 1 --horizon 336` with a fresh scratch directory and serve the build with `serve_spa.js`. The fields are synthetic; their changing content is a delivery oracle, not a scientific skill score.

```bash
MODE=trend OUTPUT=trend.json node frontend/scripts/offline-backend/scn_icon_far.js
MODE=fallback OUTPUT=recovery.json node frontend/scripts/offline-backend/scn_icon_far.js
MODE=fallback FAIL_GFS=anchor OUTPUT=gfs-anchor.json node frontend/scripts/offline-backend/scn_icon_far.js
MODE=fallback FAIL_GFS=target OUTPUT=gfs-target.json node frontend/scripts/offline-backend/scn_icon_far.js
MODE=kill FIRST=192 LAST=192 node frontend/scripts/offline-backend/scn_icon_far.js
MODE=kill KILL_FALLBACK=1 FIRST=192 LAST=192 node frontend/scripts/offline-backend/scn_icon_far.js
# Native and >240 h controls: FIRST=168 LAST=168, FIRST=241 LAST=241, FIRST=288 LAST=288.
```

The scenario first establishes native ICON hour 0. Positive steps assert the resident engine grid's hour and the FNV-1a hash of the typed bytes passed to its actual WebGL wave texture (`texImage2D`/`texSubImage2D`), with a new upload and different hash at every hourly transition. It fails on timeout. Recovery also asserts ICON identity and persistence-anchor provenance. Kill controls require rejection with the requested hour absent from the engine. `OUTPUT` saves rows and diagnostics; `LAT_GRID`/`LAT_SERIES` inject delay. This scenario refuses live mode; RainViewer and remote sockets are blocked by the common harness. Series-enabled hourly snapping, real forecasts and real-device performance require separate evidence.
