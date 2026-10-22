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
| `LAT_PRODUCTS` | ms injected per `/products` reply (live: 1.3-2.1 s for 10.75 MB; the synthetic one is 4.3 MB and lands in a few ms, so without it no lookup can start before the manifest lands) |
| `LAB_EXACT=0` | stop waiting for the EXACT frame per step (default: wait, bounded by `WIN`, for `exactMs` as well as `marineMs`) |
| `LAB_FLAGS` | comma list of other window flags set true before boot, the same in both arms (`__SURF_MODE__`: the rating overlay on, whose spot lookups resolve valid times before the manifest lands, as the live spot hubs and glyphs do) |
| `FLOWS=open_waves,open_wind` | a map open and nothing else (20 s settle): the load's request mix |

**Request counts (2026-10-20, request diet):** each flow's `lab.json` entry carries `loadNet` / `net` (finished weather requests by kind at the end of
setup / of the flow, wind counted apart, with when the first `/products`, `/grid` and `/grid_series` started and took), `loadStarted` /
`started` (the same by request START, so a request still in flight at the end counts), `loadList` (every finished load request: path,
start, ms, frames asked, domain) and `telemetry` (`window.__MARINE_REQUEST_DIET__` counts, `__MARINE_EXACT_UPGRADE__`). Each step row
carries `exactMs`: input to the first frame with the selected instant at FULL detail (identity as `marineMs`, or the same instant once the
app's own selected frame is the expected hour, and not a world grid coarser than 2.5 deg a cell: the engine's copy drops
`__decimatedStride`, so a stride-4 series frame is told by its 8-degree cells).

**Served vs asked clock (2026-10-21, `marineConformServed.js`):** each step row carries `servedOff.grid` (the marine `/grid` replies in
the step) and `servedOff.series` (the marine `/grid_series` frames), each `{ n, off, offH, substituted, noServed }`: how many name a
`served_valid_time` that is not their `valid_time` (the ask's echo; a stored-series frame's `valid_time` is the hour asked, too) and by
how many hours. Each flow carries `loadServedOff` (the same over the load); each step `end.mServed` / `end.mAsk` / `end.drawnDataMs`
(the engine grid's two clocks and the drawn record's data instant) and `dimAt` (the resident and both clocks at the step's first
stale-dim frame). Read off the wire through the harness's `afterWeather` hook, which parses each marine reply before it is delivered
(tens of ms per world grid or page, the same in both arms); not collected with `LAB_LIVE_BASE`. Only where `off` is above 0 can the
conform's served clock (dark: `LAB_FLAGS=__RAW_MARINE_CONFORM_SERVED_TIME__` for the B arm) change a decision. The per-step request
lists are by COMPLETION; compare arms on the flow's `started` counts.

**Stale backend (2026-10-21, SWR_BACKOFF):** `FLOWS=stale_world,stale_regional` arm `serve_synthetic.py`'s stale window (`GET /__lab/stale`)
just before an hour step (+6 h) on the world view (z3.5) or at zoom 6, after a 30 s settle there. For `LAB_STALE_S` seconds (default 60) the
backend answers that view's `/grid` stale and coarse (`swr_revalidation_pending`), then fresh; the map then sits idle and the step dwells
until the fresh grid has been drawn for 5 s (or `LAB_STALE_TAIL_MS`, default 75000, after the window). The step row's `stale` block: every
`/grid` the BACKEND saw for the view (`serverLog`, ms from the window's end), `reasksPerMin` while stale, `staleAskAtS` (the ladder as seen),
`freshAskLagMs` (backend fresh -> next ask) and `freshDrawnMs` (-> the fresh grid's cols in the marine engine, from the page's per-frame
`drawLog`). `LAB_WINDOW_JSON='{"__RAW_MARINE_SWR_STALE_DELAYS__":[...]}'` sets non-`true` window values before boot (an arm's rungs).
`node stale_summary.js A=<dir>,<dir> B=<dir>,... [--json out.json]` prints each run and the medians per flow and arm.
Zoom 6 caveat: the view's series frame (non-stale) can take over mid-window and end the re-ask in every arm (see the 2026-10-21 log).

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
