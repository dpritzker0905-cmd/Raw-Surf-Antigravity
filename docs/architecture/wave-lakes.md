# Wave-carrying lakes render as lakes (2026-10-23)

Client only. Ships ON. Kill switch: `window.__RAW_DISABLE_WAVE_LAKES__ = true`. Telemetry: `window.__RAW_WAVE_LAKES__`.

## The problem

The wave mask is built from Natural Earth (NE) land. NE land fills the Great Lakes, Lake Victoria, Lake Winnipeg and the
Salton Sea as land; only the Caspian is a hole, and the Black Sea is outside land. So a model that carries waves on a
lake never shows them there: the mask paints the lake black under every model.

After #497 (static-frames session) EURO's world grid carries its own values on 34 lake nodes: Great Lakes 14, Caspian 9,
Black Sea 5, Winnipeg and Victoria 6. GFS and ICON carry none of these lakes.

## What changed

| Piece | File | What it does |
|---|---|---|
| Asset | `frontend/public/wave_lakes.json` (98 KB), built by `frontend/scripts/build_wave_lakes.py` | Superior, Michigan, Huron, Erie, Ontario, Winnipeg, Victoria, Taihu, Lagoa Mirim (the last two added 2026-10-24: valid EURO inland nodes; Lagoa Mirim has no 50 m outline in NE, so its g50 is the 10 m one simplified at 0.03 deg): NE 50 m and 10 m outlines (10 m simplified at 0.01 deg), bbox, 3 interior anchors |
| Allow-list | `waveLakes.js` `lakesCarried(grid)` | A lake is cut only when the grid's model is in `LAKE_MODELS` (`['EURO']`) and a VALID node's cell touches the lake. Lakes near an ocean (Ladoga, Nicaragua) and Okeechobee and Salton are not in the asset, so no model lights them |
| Land variant | `waveLakes.js` `withWaveLakes(land, grid, bounds, engine)` | The carried lakes that touch the mask bounds are cut as holes in their containing NE polygon (the lake ring winds against the land; its islands wind with it, nonzero fill). One memoised object per (land, lake set, resolution), so every identity-keyed mask cache holds across hours |
| Encoder | `WebGLMarineTextureEncoder.js` | The rebuild and the coarse-base wash both take the variant. When the resident mask's lake set differs from this commit's, the "retain the resident while the basemap loads" shortcuts are withdrawn for this commit |
| Shelter | `marineMaskShelter.js` | The sheltered-water classifier would discard an enclosed lake (value 64). Components holding a carried lake's anchor are released, on a copy |
| Frame store | `waveLakesShow.js`, hooked in `marineFrameStoreRuntime.showStored` | See "Model toggles" |
| Layer | `WebGLMarineLayer.js` | Loads the asset once with the land; one re-upload when it lands |

## Model toggles (lead condition 2)

A lit lake under GFS or ICON is a defect: it would show the encoder's extrapolation or height 0 as if it were GFS's forecast.

- **Normal commit.** The encoder recomputes the variant for the committed grid: GFS -> plain land, EURO -> the lake
  variant. Both masks are built once per bounds; the one-slot mask stash then swaps them by reference on each toggle.
- **Frame-store show (no commit).** The GPU frame store shows a stored GFS frame without running the encoder. Before
  such a show, `lakeShowPlan(engine, model)` decides:
  - `keep`: the resident mask has no lakes, or the model carries lakes.
  - `swap`: the stash holds the plain-land mask for the resident's bounds. After the frame copy succeeds, the same show
    swaps it in by reference (no raster, no upload), stashes the lake mask, and points the drawn frame at it.
  - `decline` (miss `lake_mask`): no plain mask is ready (the stash is empty or holds another land, the stash is off,
    as on handhelds, or the lake mask carries a degraded paint). Nothing changes, not the mask, not the wave bytes, not
    the grid, and the normal commit draws.
  - Crop shows decline when a swap would be needed (miss `lake_mask_crop`).
- The swapped-in mask brings back its own clean basemap-water paint record (`maskPatchKeep`), as after a reuse commit.

## The mask stash's variant slot

Zoomed in, EURO <-> GFS cycles three masks (GFS's plain world mask, EURO's world series page with lakes, EURO's viewport with
lakes). The resident plus one stash slot held two, so every toggle rebuilt one: z8 Lake Michigan `setWaveData` 251-375 ms against
5-15 ms without lakes. `maskTextureStash.js` now has a second slot (`engine._maskStash2`) that takes what the first slot would
have evicted, and a regional mask the WORLD PIN refuses. It is used only while a lake mask is in play, so a session that never
sees a carried lake holds exactly what it held before. With it the same toggles are stash swaps (7-16 ms after the first build of
each mask). Cost: one more mask texture (up to 32 MB of GPU memory, counted in `__RAW_GPU__`); the stash is off on handhelds
(`maskStashEnabled`), so a phone never allocates either slot (tested). Kill: `window.__RAW_DISABLE_MASK_STASH_VARIANT__ = true`.
Both slots are owned: `safeDeleteTexture` never frees either, and `freeMaskStash` (engine teardown) frees both.

## Measured (offline; `docs/weather-program/evidence/wave-lakes-2026-10-23.json`, log `2026-10-23-claude-wave-lakes.md`)

- Pixels that differ between a build with lakes and one without (same theme, model and view): EURO lake 0.76-0.86, GFS lake
  0.000-0.001, Salton / Okeechobee / Nicaragua 0.000 under both, land 0.000-0.012.
- EURO -> GFS at Lake Michigan: the lake renders exactly as the GFS no-lakes build. 0 lit-lake frames in every toggle run.
- 0 mask paints on the click path and on the scrub (keys at the Lake Michigan view, every arm).
- The EURO toggle itself (GFS -> EURO, ~1 s at z4) misses the 100 ms instant contract, with or without lakes: EURO world frames
  are not store-eligible while the server fills the world mid lattice (`serveTimeFillAtWorld`); the publish-time fill fix is owned
  by the static-frames session.

## Not covered

- An EURO frame shown from the store over a plain mask leaves the lakes dark until the normal commit (no lake is lit
  wrongly; the lake simply appears one commit later).
- Handhelds have the mask stash off, so a store show that needs a swap declines and the normal commit rebuilds the mask.
- The 10 m lake outlines are exercised in unit tests only (the offline harness has no 10 m land); the live read must check the
  shoreline against the 10 m land. The offline screenshots have no Mapbox basemap, so the basemap-water overlay, the inland-water
  guard and the wetland passes are not exercised with lakes.
