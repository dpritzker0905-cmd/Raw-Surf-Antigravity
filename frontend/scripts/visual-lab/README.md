# Visual lab

Replays the owner's map flows on the production bundle and reports what is ON SCREEN, step by step: which forecast frame the
marine and wind engines actually drew against the selected hour/layer/model, how long until the right field appeared, whether
the picture right after the input was stale, which console patterns fired, what the network did, and frame pacing.
Offline by default (the real FastAPI app over synthetic stored data, `../offline-backend`). Nothing reaches the live backend
unless `AB_LIVE=1`.

## Run

```bash
# from frontend/, with a production build in frontend/build (npx craco build, env as in ../offline-backend/README.md)
python scripts/offline-backend/serve_synthetic.py --dir <empty dir> --port 4103 --thin-bounds 1 \
  --models GFS,ICON,EURO --layers waves,swell_1,swell_2,wind_waves,wind
node scripts/offline-backend/serve_spa.js build 3100
AB_DIAG=1 PORT=4103 OUT=lab-out node scripts/visual-lab/lab.js        # opens lab-out/report.html
```

| Variable | Meaning |
|---|---|
| `FLOWS` | comma list: `icon_waves_scrub`, `icon_wind_scrub`, `layer_switch_future`, `model_switch_future`, `pan_zoom_future` (default all) |
| `VIEW` | `desktop` (1280 x 800) or `phone` (390 x 844 at DPR 3, emulated) |
| `LAT_SERIES` / `LAT_GRID` | ms injected per `/grid_series` page / `/grid` reply (live-like: 2500 / 500; a freshly restarted box: 8000 / 3000) |
| `AB_DIAG=1` | the app's diagnostic console on (the console instruments need it; the owner's browser has it) |
| `LAB_KILLS` | comma list of `window.__RAW_DISABLE_*__` kill switches set before the app boots (the A arm of an A/B on one build) |
| `LAB_TRACE=1` | a Chrome performance trace of the first flow, `OUT/trace.json` (DevTools > Performance > Load profile) |
| `LAB_TRACE=1` (also) | `OUT/profile.json`, a V8 CPU profile of the same flow on the trace clock, with a named `LABSTEP_<n>_<label>` marker per step; `LAB_SAMPLE_US` sets the sampling interval (default 250) |
| `FLOWS=erratic` | the owner's erratic session (2026-10-19): long scrubs, model and layer switches, zoom 8, pan, fast toggles |
| `LAB_LIVE_BASE`, `LAB_KILLS`, `LAB_CONSOLE` | a dev server on the live backend (owner's word only); kill switches set before boot; matching console lines to `OUT/console-<flow>.txt` |

**Who owns the main-thread stalls:** build with source maps (`GENERATE_SOURCEMAP=true`, the CRA default), run with
`LAB_TRACE=1`, then `node frontend/scripts/visual-lab/stall_profile.js OUT/trace.json frontend/build [50]`. Stalls are
unbroken stretches of non-idle main-thread samples of at least 50 ms; each sample is attributed to its leaf native or to
the leaf-most frame that maps to an original source file, bucketed by stage (shader compile, GPU-sync state capture, land
mask, grid -> texture, fetch/manifest, marine draw, wind, React, MapLibre), per step (`stageByStep`), with the hottest
original functions (`hotLines`). Native WebGL calls bill their time to the JS function that calls them, and a synchronous
read such as `getParameter` also absorbs queued GPU work (uploads, compiles), so read the GPU-sync bucket that way.
`FOCUS=<regex>` adds `focus`: every busy sample whose stack holds a matching `<original source>:<function>` frame, stall or
not (`FOCUS=WebGLProgramBatch` = the engines' shader batch, which the stage table folds in with MapLibre's program compile).

**Load probe:** each flow's `lab.json` entry carries `load`: the marine layer's first `render()` call and first real heatmap
draw (page rAF frame, ms since navigation, layer calls so far), and each engine's shader-batch telemetry when it settled
(`mode` async / deferred / serial, `polls`, `ms`; `window.__RAW_GPU__.shaderBatch`).
| `AB_LIVE=1` | the REAL backend: real load on the 1-CPU box that serves production; one run, `/api/health` before and after, owner's word only |

## What each column means

- **Marine / Wind correct**: input to the first animation frame whose resident grid has the selected hour, layer and model
  (`window.__MARINE_ENGINE__`, `window.__WIND_ENGINE__`). `never` = not within `WIN` (8 s).
- **Mismatch frames**: frames where the drawn frame differed from the selection. *same instant* = labelled with another hour but
  exactly the product a fetch for the selected hour returns (3-hourly data snapped by instant, the #267 rule; not a mislabel);
  *labelled* = the status line said so (W-1: "Loading…", "nearest stored forecast", "Estimated"); *silent* = neither.
- **Stale picture**: on 16 px block averages (wind streaks and crest ribbons average out): the screenshot 150 ms after the input is
  compared with the previous step's settled picture and this step's. `STALE` when the step changed the picture well above the
  animation noise floor and the early picture still looked like the previous step; `n/a` when the step barely changed the field.
- **Console**: counts of the patterns from the owner's logs (`windAbortSafeZero`, `windRetry`, `staleDiscard`, `settleMiss`,
  `seriesInstant`, `maskRebuild`, `swell2Blend`), counted from Node so no in-page console override can hide them.
- **Network**: weather requests in the step, by kind, duplicates (same URL twice) and failures.
- **Pacing**: worst rAF gap and longest long task.

## Limits

Synthetic data and world-only tiers (no regional viewport products, so land-mask rebuilds and regional fetch paths are not
exercised); headless desktop Chrome or an emulated phone, not a physical device; latency is injected, not the 1-CPU box's.
A finding here is a lead for the real app until it is also seen there (the owner's console, a recording, or one bounded live run).
