# 2026-10-09 · The basemap mute (#296) never ran in the app: hidden layers under the wind stood it down

Owner, after #296 / #297 / #298 deployed (dev build `0f73e2fb`), pasted the live console with the two read-backs I had
asked for:

```
window.__WIND_BASEMAP_MUTE__            {applied: true, layers: 0, amount: 0.85, waterL: 0.9, theme: 'light', …}
window.__WIND_LAYER_DELIVERY__.verdicts {base: 1, base_promote: 1, noop: 36, fine: 5}
```

## Correction of my own claim

I reported #296 as "light and beach basemaps lose their colour while the wind is on" (STATE, the PR, the reply to the
owner), and told the owner that `applied: true` would confirm it. **`layers: 0` means nothing was muted. The mute has not
run in the app since it merged.** What the owner saw in light and beach after #296 was the old map colours.

- The deployed build does carry the code: `service-worker.js` reads `BUILD_VERSION = '0f73e2fb'`, and chunk
  `4716.d81c5fbb.chunk.js` contains `__WIND_BASEMAP_MUTE__`, `noop_base_clip` and the #297 kill switch.
- #297 (the light colour-blind pass) is live and unaffected. Its "muted ground" numbers (2.58 / 2.59) describe a ground
  the app has not shown yet; the unmuted ones (land 1.83 -> 2.52, water 2.75 kept) are what is on screen.

## Root cause (three defects, one visible)

1. **The rule stood down for any raster layer in the style.** `windBasemapMutePlan` returned an empty plan when a raster
   layer sat under the wind ("satellite: the photo is the map"). The app keeps these mounted and HIDDEN under the wind at
   all times (`MapWebGL.js`):
   - `esri-satellite-layer` (`visibility: 'none'` unless Satellite is on);
   - 18 weather-wash slots, `rain|satellite|pressure|temperature|water_temp|fog` x 3, anchored
     `beforeId = 'webgl-wind-particles'` (the owner's log: "[Raster Queue Transition] Processing layer 'rain' …").
2. **"Under the wind" was the whole style.** `getStyle().layers` leaves custom layers out (MapLibre 5.24
   `_serializedAllLayers`: `if (layer.type !== 'custom')`), so `findIndex(windId)` was always -1. Harmless on these two
   basemaps on its own, but it made (1) worse: a radar frame ABOVE the wind would have blocked the mute too.
3. **The read-back reported the intent.** An empty plan returned `applied: true, layers: 0`.

Why the bench passed: its map was the Mapbox style and the wind layer, nothing else. The app's own layers were never in
the instrument (LESSONS L-V21).

## Reproduced offline, then fixed

Path bench with **the app's layer stack** added to its map (`page/map-entry.js` `addAppStack`: the hidden satellite layer
and 18 hidden slots under the wind, one visible clear-tile raster above it). Share of wind pixels > 30 deg off the legend
hue for the true speed (`hue30`), kill switch on -> default, 2026-10-09:

| theme | path | deployed code `0f73e2fb` | this fix |
|---|---|---|---|
| light | pan | 46.5% -> 46.6% (0 layers) | 46.5% -> **1.5%** (9 layers) |
| light | zoomOut | 26.8% -> 26.6% | 27.0% -> **2.7%** |
| light | erratic 1 | 58.9% -> 58.5% | 58.7% -> **3.5%** |
| beach | pan | 39.8% -> 39.8% (0 layers) | 39.8% -> **0.6%** (17 layers) |
| beach | zoomOut | 7.4% -> 7.4% | 7.4% -> **0.6%** |
| beach | erratic 1 | 49.3% -> 49.3% | 49.3% -> **0.4%** |
| dark (null control, never muted) | pan / zoomOut / erratic 1 | | 2.5% / 3.7% / 4.1%, both arms |

The left column is the live defect on the bench (the positive control for the instrument). Zero flashes in every run.
Coast colour contrast under the wind falls as #296 said it would: light 11.5 -> 11.2, 10.6 -> 10.0, 10.9 -> 9.4; beach
12.1 -> 10.5, 11.1 -> 9.1, 10.8 -> 8.6 (dE00).

`path-run.js --mute-check` (new; the real map and library, no path):

| | fix | deployed code |
|---|---|---|
| light | muted 9; restore exact (max dE00 0.000); satellite shown -> stale, stands down (`imagery:esri-satellite-layer`), map = original (0.000); hidden -> stale, muted 9 | muted 0: FAILED |
| beach | muted 17; same sequence, same zeros | muted 0: FAILED |
| dark | not muted, never stale | not muted |

## The fix (client only; no served number moves)

`windBasemapMute.js`:
- **Imagery is a raster layer SHOWING under the wind**: visible, and not parked at opacity 0. Hidden slots no longer
  count. A satellite photo or a weather wash that is on screen still stands the mute down (`windBasemapImagery`).
- **The wind layer's slot comes from the style's draw order** (`map.style._order`, as `waterTempAnchor.js` reads it);
  nothing above the wind is touched or consulted.
- **The ocean mask's layers (`ocean-mask-*`) are left to OceanMask.** It repaints them on its own sync and shows them
  only while a marine layer is on; muting them here would be undone, or copied, by that sync.
- **The read-back reports the effect**: `applied` is true only when `layers > 0`; when imagery stands it down,
  `reason: 'imagery:<layer id>'`.
- **The record is written before the paint writes**, so a write that throws is undone by the next sync (no double mute).

`WebGLWindLayer.js`: the `styledata` handler asks `windBasemapMuteStale` (no `getStyle()`: one pass over the style's layer ids) and
syncs only when the answer changed: Satellite or a wash switched on or off while the wind is on, a lever, or an earlier
sync that met a style mid-load. It does not react to someone repainting a muted colour (a writer that re-asserts on every
style change would trade writes with it for ever).

Tests: `windBasemapMute.test.js` +11 (the app's stack, pinned to `MapWebGL.js` / `OceanMask.js` / the wind layer's id by
a wiring test; the fake map now leaves custom layers out of `getStyle()` like the library). Jest map + `src/tests`: 291
suites, 3661 tests. ESLint ratchet: no rule over baseline. File size: 0 violations.

## The eye read-back in the same paste (no defect found)

`noop_base_clip` is absent because the case it guards never occurred in that session. Every product in the log is
`gfs_wind_wind_global_mid_…` (the 2-deg world grid, clipped): 21x16, 15x11, 14x12 and 71x47 nodes are views 26-140 deg
wide. The server builds a finer wind box only for a request span <= 20 deg (`mid_res_tier.py`,
`WIND_MID_REVAL_MAX_SPAN`), so no finer box was ever resident and #298 had nothing to protect. To test it: zoom in over
the storm until the console files a `viewport_gfs_wind_wind_…` product, then zoom out one stop.

Also in the paste: a 15 s timeout on `featured photographers` and aborted wind fetches while panning. The box was busy
again (the open item from `log/2026-10-09-wind-eye-tier-keep.md`).

## Open, for the owner

- **A weather wash under the wind (rain, pressure, temperature, fog) stands the mute down**, as a satellite photo does.
  That keeps today's look for those combinations, which the bench has not measured. Switching a wash on while the wind
  is on therefore brings the map's colours back. The alternative (keep the map muted under a wash) is one line, the
  `showing` predicate; it wants a bench run with a wash on first.
- With a marine layer AND the wind on, the ocean mask's land keeps its theme colour (not muted, not measured).
- Not verified on the deployed build yet. After the deploy, `window.__WIND_BASEMAP_MUTE__.layers` should read 9 in light
  and 17 in beach (wind on, no satellite or wash).
