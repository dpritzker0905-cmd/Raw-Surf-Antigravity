# Raster lab

Toggle and scrub timing for the seven RASTER weather layers (rain, radar, satellite, pressure, temperature, water temp,
fog), measured from what MapLibre draws, offline. Built 2026-10-22 for the owner's "instant load upon activating the
toggle, and instant scrub" (baseline and plan: `docs/weather-program/log/2026-10-22-claude-raster-instant.md`).

| File | Role |
|---|---|
| `rr.js` | Record / replay for the raster layers' EXTERNAL hosts (Open-Meteo S3 `.om` range reads, RainViewer, IEM, DWD, nowCOAST). A miss is fetched live ONCE (S3: 6 at a time; the small public servers: 2 at a time, >= 150 ms apart) and stored under `RR_DIR`; a hit is answered from disk after the latency it took when recorded, holding one of the host's 6 HTTP/1.1 connections. `RR_MODE=replay` refuses misses (504), so a replay can never touch the network. `RR_LAT=0` / `x2` scales the latency. Our backend is never involved. |
| `lab.js` | One fresh browser per combo (viewport x layer x model x zoom): toggle the layer on, 10 single steps on the timeline wheel, one long jump. Per animation frame it records the VISIBLE raster slot (or radar frame), the time step and model its source URL names, tile states, isSourceLoaded, how many of the layer's slots are LIT at their evaluated (mid-transition) opacity, and tiles still inside their per-tile fade. The app's clock is pinned to the recording (`RR_DIR/meta.json`), so every session asks for the same frames. |
| `summarize.js` | JSONL -> per-layer rollup and per-combo table (markdown + JSON). |

Frame classes: `o` correct hour fully drawn, `p` correct hour partly drawn, `s` STALE (another hour under the new label),
`b` BLANK. `mixed` counts frames with two hours lit at once (an opacity cross-fade); `fadingFrames` counts per-tile fade-ins.
Steps whose hour maps to the same frame as the step before (EURO is 3-hourly) are counted apart, not in the percentiles.

```bash
python frontend/scripts/offline-backend/serve_synthetic.py --dir <store> --port 4198 --models GFS,ICON,EURO
node frontend/scripts/offline-backend/serve_spa.js <build dir> 3198
cd frontend/scripts/raster-lab
AB_BASE=http://127.0.0.1:3198 PORT=4198 RR_DIR=<cache> OUT=<dir> VPS=desktop TAG=base node lab.js
node summarize.js <dir>/results-base.jsonl --md summary.md
```
Env: `VPS` (desktop,phone), `LAYERS`, `MODELS` (GFS,EURO), `ZOOMS` (2,4,6,9), `STEPS` (10), `DWELL` (1000 ms after each fully
drawn frame), `STEP_TIMEOUT`, `LONG_JUMP_H` (96), `RADAR_DIR` (-1: back through the observed frames), `CENTER`, `FLAGS` (JSON
of window levers set before load, e.g. a kill switch), `PHONE_CPU` (4).

Terms: record new RainViewer frames sparingly (100 requests/IP/min, personal/educational use); replay is free.
