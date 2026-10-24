# 2026-10-24 (claude, wave-lakes session): Taihu and Lagoa Mirim, the z7+ toggle probe, two corrections

Written 2026-10-24. Branch `claude/wave-lakes-taihu-mirim` on dev `2a519f844` (the #521 squash). Client only, no served number
changes (no SCOREBOARD row). Same kill switch as #521: `window.__RAW_DISABLE_WAVE_LAKES__ = true`.

## Ask (the lead, 2026-10-24)
"The owner's rule 'lakes should show as lakes' plus 'lit only where EURO has valid nodes' means every real lake where EURO carries
valid nodes belongs on the list, so the follow-up adds both, with a test each. Keep the Amazon out: it's a river." The owner's
words (17:47 EDT 2026-10-23, via the lead's digest): "actually yes, lakes should show as lakes. Do what is best to be state of the
art." Valid EURO inland nodes per static-frames' trace of #497's nodes: Taihu (32N 120E) and Lagoa Mirim (32S 54W).

## Change
- `public/wave_lakes.json` 95 -> 98 KB: `taihu` (NE "Tai Hu") and `mirim` (NE "Lagoa Mirim") added by `scripts/build_wave_lakes.py`.
  Lagoa Mirim exists only in `ne_10m_lakes`, so its 50 m outline is the 10 m one simplified at 0.03 deg (`TOL50`). The seven lakes
  already shipped are byte-identical in the rebuilt file (checked).
- `waveLakes.asset.test.js` reads the SHIPPED asset and the real `ne_50m_land.json`: nine lakes; every one is cut out of a real land
  polygon at both resolutions (none silently stays land); real 2-degree EURO lattices carry Taihu at 32N 120E and Lagoa Mirim at
  32S 54W (and Winnipeg, Victoria); the lower Amazon (2S 54W), Okeechobee, Salton, Nicaragua and Ladoga carry none; GFS and ICON
  never carry one.
- `scn_model_toggle.js`: at ZOOM >= 7 the exact-frame window is a viewport clip (`2 <= cols <= CLIP_MAX`) instead of `cols >=
  MIN_COLS` (below).

## Corrections to 2026-10-23-claude-wave-lakes.md (kept visible, not edited there)
1. **The z8 "missed" toggle clicks were a harness threshold, not a saturated box and not a product-id mismatch.** The old check
   required `cols >= MIN_COLS (10)`; EURO's 2-degree lattice on a 6-degree box is 6 columns. A debug run at z8 after a GFS->EURO click
   read: drawn product `euro_marine_waves_global_mid_<hour>` (the right model and hour), `cols 6, rows 4`, bounds -92,42,-82,48,
   `stride 0`; the product /grid serves for the world box and for the viewport box was the same id. Fixed as above; the
   toggle-to-frame at z8 can now be measured (not re-run yet). The "box saturates at z8" reading is retracted for good.
2. **The 10 m lake outlines ARE exercised offline.** The 2026-10-23 log said they were unit-tested only because that harness read
   `res 50` (the 10 m land had not finished loading). The live-read snippet test (below) ran with the 10 m land loaded (`land10m
   true`, `lakeRes 10` at z8): shore-ring points 3.5 px inside the outline changed 16 of 18 between GFS and EURO and 3.5 px outside
   1 of 18, so the field reaches the shoreline and does not spill onto land. The basemap-water overlay, inland-water guard and
   wetland passes are still not exercised with a real basemap (no Mapbox token offline).

## Measured (offline, lakes build, Lake Michigan)
`side-session-notes/.../live-read-wave-lakes-console.js` run as pasted: 0 lit-lake frames of 1699; z8 gfs vs euro: lake 1/1, inside
16/18, outside 1/18; z5 euro vs gfs: lake 15/15, inside 285/308, outside 21/364 (5.8%), land 0/6.

## Not done / owed
- The chip `aria-pressed` probe (the silent old-model frame per GFS->EURO click): next, separate PR if it is a mislabel.
- Cells 3, 5, 8, 10, 12 of the verification matrix (offline store built and published: `GFS/EURO/ICON` waves + six regional sets with
  `MARINE_REGIONAL_TILE_FIRST=1` on the server; the runs are queued after the items above).
