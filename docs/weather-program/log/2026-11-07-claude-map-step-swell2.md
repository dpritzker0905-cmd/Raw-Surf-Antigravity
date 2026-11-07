# 2026-11-07 claude: scrubber step cadence + GFS swell_2 coarse grid

## Fix 1 (shipped, client only, ON): step buttons land on a real model frame
- Owner revision: the step row is -1d, -3h, -1h, Now, +1h, +3h, +1d (mirrored: one shared row). -1h/+1h and the wheel arrows move the slider 1 h. -3h/+3h land on the next real model frame (`cadenceStep.js` reads `cadence_hours` from `window.__WEATHER_CAPABILITIES__`; hourly models just move 3 h). When the shown frame differs from the asked hour the readout adds a visible 'model step' tag beside the existing 'nearest model time step' screen-reader text; no interpolation. 12 PM -> 1 PM and 2 PM -> 1 PM is nearest-frame snapping (both 1 h away), now labelled on every such hour.
- Kill switch: `window.__RAW_DISABLE_CADENCE_STEP__ = true`. Horizon and tier gating untouched.
- Tests: `cadenceStep.test.js` (5), kill switch registered in `killSwitch.inventory.test.js`. Frontend floor 642/8413 -> 643/8418.

## Fix 2 (NOT fixed): GFS swell_2 "COARSE 2 deg GRID" at Now
Reproduced cold on dev (open /map?diag=1, press Swell 2 within seconds of load), no load loops, one session:
- HUD / `__MARINE_PROJECTION_DIAG__`: `gfs_marine_swell_2_global_mid_<hour>.json`, resolution 2. After the layer has been warm (or after scrubbing away and back) it is `gfs_marine_swell_2_florida_east_coast_...`, 0.25. swell_1 on the same page: regional 0.25.
- The cold press fetched the swell_2 regional index + bundle and a `/grid_series` mini, and only then the swell_2 global_mid index; `__MARINE_NO_DOWNGRADE__` shows the 181x80 world grid REJECTED against a 9x11 regional resident, `__MARINE_DRAWN__.resolutionDeg` is 0.25, but `__MARINE_TRUTH_TRACE__` (last GPU upload through the controller) and the HUD still carry the world grid (gridBounds -180..180, 15,023 vectors, upload seq 3).
- Reading: the heatmap/frame-store lane shows the regional frame while the controller-committed grid, which drives the HUD and the crest particles' field and land mask, stays the 2 deg world grid on the first (cold) swell_2 selection. swell_1 is warmed earlier by marineController's sibling order (`waves, swell_1, swell_2, wind_waves`, marineController.js ~119-121), swell_2 later, which is why the owner sees it only on swell_2.
- Not root-caused to a line, so nothing speculative was changed. Next probe: log the arbiter's `byRule` order for a cold swell_2 press (`__RAW_ARBITER_SHADOW__`: empty_resident, fresh_same_target, tier_downgrade) and find which commit left the world grid as the controller's resident.
