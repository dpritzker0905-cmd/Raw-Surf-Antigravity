# 2026-10-24 · claude · per-model pressure, client: the layer follows the model selector (dark)

The owner, 2026-10-23 20:13 EDT: "Yes start it", answering "start the per-model pressure route?" after "We want each models
pressure showing". The lead's route, step 3 (client): "The pressure layer follows the model selector (GFS / EURO / ICON),
labelled with its source ... Same frame store, prewarm and fetch priority as #511 ... Past a model's native horizon, never cap
the 14-day scrubber; follow the same labelled extension policy the wave layers use for ICON and EURO ... Kill switches for each
piece. Client dark until the owner sees side-by-sides." Isobars and H/L come in the next PR. The publishers are their own PR.

## What
Still DARK: `window.__RAW_RASTER_OWN_FRAMES__` (unchanged lever). A model whose set is unpublished or killed
(`__RAW_DISABLE_STATIC_FRAMES_SETS__`) stays on the .om path, which draws that model as before.
- `ownRasterFrames.js`: `OWN_RASTER_SETS.pressure.models` = GFS / EURO / ICON set keys, `fallback: 'GFS'`; `setKey(layer,
  model)`; indexes, the remembered index and the prewarm are per model; `combinedFrames` = the model's own frames, then the
  GFS frames past its last one, flagged `estimated: 'gfs_estimated_fallback'` (copies; the indexes are never mutated);
  `combinedFrameAt` = the model's own frame within 3 h whenever it has one (inside its range a gap stays a gap, never a stand-in),
  else past its range the stand-in. Frames load from their own set (`setKey` per entry).
- `useOwnRasterFrames.js`: per-model engagement and failure (a model without a set fails alone; switching back retries);
  the GFS index is pinned when another model is picked (the stand-in is a step away at the horizon).
- Status line (#471's readout): a stand-in reads "Estimated forecast: GFS stand-in beyond this model's range", the wave layers'
  own words (`drawnFrameReadout.ESTIMATE_WORDS`, now exported); a model switch reads "Loading EURO Pressure... still showing GFS
  Pressure" until the new model's frame is drawn.
- Credit (the source label): the model of the frame ON SCREEN: "NOAA GFS", "EURO (ECMWF) · CC BY 4.0", "ICON (Deutscher
  Wetterdienst)"; the GFS stand-in past EURO's range is credited to NOAA.
- `staticFrames.STATIC_SETS` gains the EURO and ICON pressure sets (raster: the marine store never takes them).

## Measured (the dark client against a local CDN stand-in of real runs, 150 ms per response; real clock)
Sets: GFS 2026-10-23 06Z (#473), EURO 12Z and ICON 00Z/12Z (published offline by the publishers' PR).
| model (dark) | step | jump past its range | credit | switch back to GFS | Open-Meteo requests |
|---|---|---|---|---|---|
| GFS | 18-40 ms | 240 ms (still GFS, "nearest stored forecast") | NOAA GFS | - | 0 |
| EURO | 23-40 ms | 244 ms, "Estimated forecast: GFS stand-in ..." | EURO (ECMWF) · CC BY 4.0 -> NOAA GFS | 262 ms | 0 |
| ICON | 20-26 ms | 222 ms, "Estimated forecast: GFS stand-in ..." | ICON (Deutscher Wetterdienst) -> NOAA GFS | 228 ms | 0 |
Toggles 395-402 ms (EURO, ICON; the prewarmed index), GFS 2.7 s in the run's first, cold browser.
COLOUR PARITY vs Open-Meteo's own EURO / ICON pressure, live, zoom 3 over the North Atlantic, per-pixel CIEDE2000 (514,600
pixels; null = the same arm twice = 0):
| model | runs (ours vs Open-Meteo's) | dark p50 / p95 / p99 | light | beach |
|---|---|---|---|---|
| EURO | 12Z vs 18Z (6 h apart) | 0 / 2.22 / 2.87 | 0 / 1.37 / 1.97 | 0 / 1.18 / 2.03 |
| ICON | 00Z vs 00Z (same run) | 0.44 / 2.45 / 3.42 | 0.28 / 1.56 / 2.01 | 0.34 / 1.56 / 2.04 |
The renderer and palette are GFS's, same-run parity p95 0.64-1.12 (2026-10-23). What is left here: EURO, a different run;
ICON, our box-mean regrid against Open-Meteo's own ICON regrid, and our 3-hourly ICON frames against Open-Meteo's hourly ICON
(at 05:3xZ the two can be up to an hour apart).
