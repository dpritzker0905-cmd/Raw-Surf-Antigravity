# Offline backend + browser harness

Replays the real map client against the **real backend app** serving **synthetic stored data**. No request reaches the live
Render box, the database or a bucket, so it can be run as often as needed (the 2026-10-01 live replays saturated the 1-CPU box).

| File | Role |
|---|---|
| `serve_synthetic.py` | Builds a local `ProductStore` (three-hourly GFS AND ICON wave frames (`--models GFS,ICON`; ICON is native to hour 168 and `estimated` beyond, with production's provider fields): 2-deg `global_mid` 181 x 83 and 10-deg `global_coarse` 37 x 17, plus a hurricane-like vortex off Mexico at a KNOWN position) and serves the production FastAPI app over it (`/capabilities`, `/products`, `/grid`, `/grid_series`). `--thin-bounds 0\|1` sets `SERIES_THIN_NODE_BOUNDS` for that process, so an A/B is two processes on two ports. |
| `serve_spa.js` | Static server for `frontend/build` (history fallback). |
| `ab_lib.js` | Playwright (system Chrome) launcher. `/api/weather/*` goes to the local backend; every other `/api/*` is an empty stub; Supabase/push/payment hosts are aborted; **every non-local WebSocket is closed in the browser** (`page.route` does not see sockets); a host audit is kept in `log.hosts` (it counts requests the page ATTEMPTED: `*.onrender.com` entries were intercepted and answered locally or stubbed, never sent). |
| `scn_swap_ab.js` | Scrub replay (jumps of +24, +72, Home, +144, +288, Home) sampling the app's own diagnostics (`__MARINE_RENDER_HOUR_PARITY__`, `__WEBGL_MARINE_UPLOAD_*`, the mask encode mode, a texture-upload spy). |
| `scn_why.js` | After one far jump, dumps the app's own account of why the requested hour is or is not rendered. |
| `scn_gap_variants.js` | Varies zoom, wait time and camera nudges around that jump. |
| `scn_drop.js` | After one far jump, reads the layer's own drop record (`__SWELL2_LAST_DROP__`, the upload reason, the parity). It is how the "stuck scrub" turned out to be a fixture mistake. |
| `scn_home_latency.js` | Live-like latency (`LAT_SERIES` ms per `/grid_series` page, `LAT_GRID` ms per `/grid`, defaults 8000/3000) and a far scrub then Home: compares the app's parity record with what the ENGINE actually holds (grid `hourOffset`, truth tag, upload content hash). `scn_swap_ab.js` takes the same `LAT_*` variables and records the request log in `AB_OUT`. |
| `scn_icon_far.js` | ICON far hours under latency: switch to ICON, scrub into the estimated range (native ends at 168 h) and back. Per step: time to render-hour parity, the last upload's provider and hour, the layer's own drop record, and what the engine holds. Run it against a build WITH and WITHOUT `REACT_APP_ICON_STORED_TAIL=true` (see below). |
| `scn_live_jump.js` | LIVE ONLY (`AB_LIVE=1`): does the drawn field jump while the camera is still? One map load, then three frozen-camera windows (the load settling, a one-stop zoom, a 4-degree pan), consecutive screenshots compared row-profile against row-profile; a redraw in a different place reads as a vertical shift, a window with no redraw reads 0 (the settled tail is the null control). Real load on the box: see the caution at the foot of this file. |
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
* **`REACT_APP_ICON_STORED_TAIL` changes which ICON path runs.** `netlify.toml` sets it to `true` only for the dev branch deploy. With it unset (a production-context build) ICON hours above 168 call `fetchBackendMarineGridIconExtended`, which builds client-side `gfs_trend` grids (hours up to 240) or `gfs_euro_blend` (above 240); `WebGLMarineLayer` does not whitelist `gfs_trend`, so those frames are dropped. Build both (`REACT_APP_ICON_STORED_TAIL=true npm run build` into a second directory) and serve each on its own port before judging ICON far-hour behaviour.
* **`AB_LIVE=1` is the one door to the real backend**, and it is opt-in. `/api/weather/*` GETs (read-only, public) then go to the live host while everything else stays stubbed and every socket stays closed; `hooks.afterWeather(url, resp)` sees each response, which `scn_position.js` uses to compare every world `/grid_series` page's declared bounds with the extent of its own cells (the live read-back of `SERIES_THIN_NODE_BOUNDS`). It is real load on the 1-CPU box (one map load = three 48-frame world pages, about 10 to 13 s of CPU each): one run at a time, `/api/health` probed before and after, never in a loop, and not while a CI lane is driving the site.
