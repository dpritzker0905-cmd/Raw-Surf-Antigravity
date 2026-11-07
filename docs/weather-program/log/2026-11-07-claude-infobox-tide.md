# 2026-11-07 - claude - infobox tide readout

Scope: the map infobox (`MapForecastOverlay.js`) never showed tide. Added a point-keyed readout. NO served surf number moves (tide is display only), so it ships ON with a kill switch.

- Backend: `GET /api/weather/point-tide?lat=&lng=` (`routes/weather_point_tide.py`). Reuses `tide.fetch_tide_hourly` (cached per 0.1 degree cell, own acquisition budget), `tide_state_at`, `tide_extrema`. No new upstream call. 200 + `available:false` on a miss, a 429 cooldown or an exception. `Cache-Control` 300 s (30 s on a miss). Heights in metres.
- Source is Open-Meteo `sea_level_height_msl`: a MODEL of mean sea level, not MLLW, no station. The footer says so.
- `tz_offset_h` is longitude/15 (solar, `tz_approx:true`): no tz database ships. The client uses the browser zone when it agrees within 1.5 h, else the solar offset.
- Frontend: `TideReadout.js` + `usePointTide.js` (keyed on the 0.1 degree cell only, so scrubbing never refetches) + `tideReadoutFormat.js`. Arrow is aria-hidden and the word Rising/Falling/Slack is always shown; the SVG curve is `role="img"` with a spoken summary. Three themes via `isLight`/`isBeach`. The infobox has one layout for desktop and mobile.
- Kill switch: `window.__RAW_DISABLE_INFOBOX_TIDE__ = true` (no fetch, renders nothing). Registered in `killSwitch.inventory.test.js`.
- `MapForecastOverlay.js` stays at 800 lines (merged a duplicate import, dropped a double blank line).
- Tests: `backend/tests/test_point_tide.py` (4, guards lane; floor 3539 -> 3554, files 223 -> 224), `TideReadout.test.js` (11).
- Not verified: hosted behaviour against live Open-Meteo (no live calls made, by instruction).
