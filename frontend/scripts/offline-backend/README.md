# Offline backend + browser harness

Replays the real map client against the **real backend app** serving **synthetic stored data**. No request reaches the live
Render box, the database or a bucket, so it can be run as often as needed (the 2026-10-01 live replays saturated the 1-CPU box).

| File | Role |
|---|---|
| `serve_synthetic.py` | Builds a local `ProductStore` (115 three-hourly GFS wave frames: 2-deg `global_mid` 181 x 83 and 10-deg `global_coarse` 37 x 17, plus a hurricane-like vortex off Mexico at a KNOWN position) and serves the production FastAPI app over it (`/capabilities`, `/products`, `/grid`, `/grid_series`). `--thin-bounds 0\|1` sets `SERIES_THIN_NODE_BOUNDS` for that process, so an A/B is two processes on two ports. |
| `serve_spa.js` | Static server for `frontend/build` (history fallback). |
| `ab_lib.js` | Playwright (system Chrome) launcher. `/api/weather/*` goes to the local backend; every other `/api/*` is an empty stub; Supabase/push/payment hosts are aborted; **every non-local WebSocket is closed in the browser** (`page.route` does not see sockets); a host audit is kept in `log.hosts`. |
| `scn_swap_ab.js` | Scrub replay (jumps of +24, +72, Home, +144, +288, Home) sampling the app's own diagnostics (`__MARINE_RENDER_HOUR_PARITY__`, `__WEBGL_MARINE_UPLOAD_*`, the mask encode mode, a texture-upload spy). |
| `scn_why.js` | After one far jump, dumps the app's own account of why the requested hour is or is not rendered. |
| `scn_gap_variants.js` | Varies zoom, wait time and camera nudges around that jump. |

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
* The **client is the production bundle** in headless Chrome. A behaviour seen here is a lead for the real app, not a finding about
  it, until it is also seen on the real app (the owner's logs, a recording, or a read-only look at the deployed site).
* Third-party reads still happen (basemap tiles, fonts): they are the same GETs any visitor makes, not our backend.
