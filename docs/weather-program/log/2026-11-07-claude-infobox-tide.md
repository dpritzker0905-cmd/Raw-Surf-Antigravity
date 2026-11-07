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

## Review round (Codex on #738)
- Card no longer goes stale: payload now carries `events` (all highs/lows in the curve window); the client recomputes height, trend, rate and next high/low from the cached series every 5 min (`tideAt`, no network) and refetches only when the series stops covering now+6 h (at most once a minute).
- Time labels: `tz_approx` + solar offset in use renders "times approx. (local solar time)"; a next event not on today's date carries its weekday ("Sun 2:32 AM").
- `TideReadout` takes an optional `atTime` (default now). NOT wired in MapForecastOverlay: the readout shows CURRENT tide, independent of the selected forecast hour (owner undecided).
