# 2026-10-25 claude (mid-zoom session): the rating band on coarse grids and at grid edges (owner manual test P0)

Task (lead, from the owner's manual test on dev build d1653d4f, after #552): with the rating band ON the owner saw breaks in the rating
on tiles that were not all the way on screen, and ratings that did not match up. Console: many `[rating-band] OFF - rendered grid is NOT
a rating grid` lines; at z7.8 the band PAINTED on a 9x8 global_mid rating grid (16 deg span, 2 deg cells) next to the 17x21
florida_east_coast rating grid (0.25 deg cells) at z8.5; the render backstop at z7.8 printed `sharpen={found:true, covers:true, ...,
willSharpen:false}`.

## 1. Did #552's waves-only bundle frames displace the surf=1 rating grids? No, not measured to.
`frontend/scripts/offline-backend/scn_rating_band.js` (new): Surf/Rating flag ON before load (`window.__SURF_MODE__ = true`), Florida at
z7, 7.8, 8, 8.5, 9, bundles ON (default) against `__RAW_DISABLE_REGIONAL_BUNDLES__`, every weather ask recorded with its answer. The offline
backend DOES serve rating grids (`rating_mode` true on surf=1 series pages and /grid), so the band can be exercised offline.
- Every surf=1 ask goes to the server in both arms; no surf ask was ever answered from a bundle (staticRegional skips surf; the frame store's
  regional show fails closed on a rating grid, pinned in marineFrameStoreRegional.test.js).
- 9 s settle, one round: bundles ON stayed on an 8x7 / 14-deg series frame (2 deg cells) at z7.8 and z8 where OFF had 13x13 / 17x17.
  Three more alternated rounds at a 12 s settle: both arms ended on the same mix of 17x13 (0.5 deg), 13x13 and 17x17 (0.25 deg) grids, so
  the first-run difference was timing, not the bundles. Verdict: #552 did not displace the rating grids; it is not the cause.
- What IS real offline: the band paints from whatever rating grid is resident, including 1-2 deg ones, until a finer one lands.

## 2. Why `willSharpen:false` when found and covers are true (code reading, useMarineScrubSettle.js:224-240; not a live read)
`canSharpen = frame && fw < 340 && frameCovers && setMarineData && frameFinerEnough`. For `regional_too_coarse` the covering series
frame is usually the SAME coarse grid that is already resident, so `frameFinerEnough` (frame cell < 0.9 x resident cell) is false and the
commit is declined on purpose (it only churns particles). The fall-through is a forced series reload of the same page
(`settleSeriesReloadNeeded`, budgeted by marineSettleReloadGuard.js), which asks for the same decimated page. In the owner's log the
resident and the covering frame were both coarse rating grids, so nothing finer was ever committed by this path. NOT shown: where the
fine 0.25 deg viewport tile should have come from in that session (the /grid for the view box, or the tile-first server answer). One
live read would settle it: `/grid?model=GFS&domain=marine&layer=waves&surf=1&bbox=<the z7.8 view box>`, what region and cols come back.

## 3. The fix (client only, visual, ships ON with kill switches; no served number changes)
`marineRatingBandRes.js` adds two legs to `resolveRatingBandFade` (min() with the span and coverage legs; the existing wash trade then
draws the honest heatmap where the band goes):
- RESOLUTION: lattice spacing of the resident rating grid (`gridCellDeg`, lon span / (cols-1)): full band up to 0.5 deg, gone at 1.0 deg
  (smoothstep). A 2-deg global_mid grid and the 1-deg 9x8 grid of the offline repro are held; 0.25 and 0.5 deg are untouched.
- EDGE: coverage of the view by the resident, above z7 only, only after the view has stayed < 98% covered for 1.5 s: full at >= 98%, gone at
  <= 85%. The 1.5 s grace is what keeps this off mid-pan dips (the band-blink the coverage leg's spec rules out, pinned by two existing tests).
- Words, not colour alone: ForecastTimeStatus shows a polite `role="status"` line while the band is held ("Surf ratings paused: the
  detailed rating grid for this view is still loading." / "... does not cover this whole view yet."), light/dark/beach.
Levers: `__RAW_BAND_RES_CELL_LO__` / `_HI__`, `__RAW_BAND_EDGE_COVER_LO__` / `_HI__`, `__RAW_BAND_EDGE_GRACE_MS__`. Kills:
`__RAW_DISABLE_BAND_RES_FADE__`, `__RAW_DISABLE_BAND_EDGE_FADE__`. Telemetry: `__RAW_GPU__.ratingBandFade` gains resFade, edgeFade, heldBy, cellDeg.

Offline proof (built branch, Florida, bundles ON, 10 s settle): the 9x8 1-deg grid at z7/z7.8 is `fade 0, heldBy resolution` with the status line,
and the red coastal band the kill arm paints from it is gone (screenshots: scratchpad cells/band2/shots1 on-z7.8 vs nofix-z7.8); 0.5 and 0.25 deg
grids: fade 1, no line. The EDGE leg is pinned by Jest only (coverage was always full in these runs); the edge case in a browser, the three
themes in a browser, and the live build are NOT verified.
