# 2026-11-03 · claude · Spot-hub phase 1: tides in every hub and infobox, honest labels, fixes, one tier resolver

Session: a delegated subagent of the lead. Branch `claude/spot-hub-phase1`, cut from `origin/dev` at `12fdcd228`.
Owner's word, 2026-11-03 ~04:55Z: "Yes, start them" (to "Start spot-hub phase 1 (labels, bugs, tides in infoboxes)
and the single tier resolver?"). DRAFT PR only: nothing merged, no workflow dispatch, no Render/Netlify env change, no
live backend call. Research of record: memory `research-spot-hubs-forecast-charts-2026-11-03.md` (re-verified on
`12fdcd228` before each change).

## What changed

Visual changes ship ON behind one kill switch, `window.__RAW_DISABLE_SPOT_HUB_P1__ = true`. **No served number moves**
(no height, rating, glyph or sim value), so there is no SCOREBOARD row.

| Item | Before (file:line on `12fdcd228`) | Now |
|---|---|---|
| Full hub tide | none (`SpotHub.js`) | `SpotHubTides` reads `/tides/{id}` (the drawer's endpoint) and renders the drawer's block (`SpotTideBlock`, extracted from `SpotConditions.js:365-421`) |
| Infobox tide | `/point-rating` `rating.tide` dropped (`pointRatingClient.js:38-49`) | passed through; a `Tide` row after `Rating`: "+1.3 ft, Rising", note "model estimate, mean sea level", aria "Tide (model estimate, mean sea level): ..." ; absent => no row |
| Tide source line | "Data from NOAA Tides & Currents" (`SpotConditions.js:419`) | "Model estimate: Open-Meteo modelled sea level, mean sea level datum. Times in your time zone." (`/tides` default path is `tide.py`, station `open-meteo:sea_level_height_msl`); the NOAA line stays only for the `TIDES_GLOBAL_SOURCE=0` rollback |
| Forecast source line | "Forecast from Open-Meteo Marine API" (`SpotConditions.js:509`) | "Raw Surf forecast · one sample per UTC day (12:00 UTC)" (`/conditions/forecast` = `resolve_spot_conditions`, stored products) |
| Hub direction | `${d \|\| '-'}-` (`SpotHub.js:444`) | `formatWaveDirection` ("95° E"), "—" when absent or the backend's 0/0 missing pair |
| Hub/drawer period | `${p \|\| '-'}s`; drawer `day.swell_period` never arrives | "11.2s" / "—"; the drawer row shows "Period 11.5s" from `wave_period` (UI label only, no backend field change) |
| Day scroll | `floor(offset/24)` on a tomorrow-first array (`SpotHub.js:217-234`): one card late | the map hour placed by its UTC date (`forecastDayIndexForOffset`); the matching card gets a ring and `aria-current="date"` |
| Day labels | `new Date('YYYY-MM-DD')` = UTC midnight, the previous day west of Greenwich | `forecastCalendar` (UTC) on every surface; no spot timezone exists, so labels say "UTC dates" |
| Tier windows | SpotHub 3/7/14 (`:158-161`), SpotConditions 3/7/10 (`:43-48`), spot_details 3/7/10 (`:60-69`), explore 3/7/10 (`:456-466`) | every surface: `hubForecastWindow` = `resolveForecastWindow(user, model, 'waves')` + `getAllowedModels` (the scrubber's) |
| Server over-serving | all 10 rows to every tier | `services/forecast_tier_window.py` (the resolver's echo, pinned to the JS by test) withholds rows beyond the window and names them in `forecast_locked_dates`; request unchanged (`forecast_days=11`); kill `SPOT_FORECAST_TIER_HORIZON=0` |

## Decisions taken, and what stays open for the owner

- **The free window is ROLLING, as the resolver's is**: a daily row is open when its 12:00 UTC sample is at most
  `days*24` h ahead. Free therefore gets 2 rows before 12:00Z and 3 after. "Calendar today + 2 days" is an owner
  decision still open; it would change the resolver, not the hubs.
- **Premium 14 vs 10**: the resolver opens 14 days, the hub rows stop at 10 (`spot_conditions.py` `daily_count`).
  Shown as what exists ("10-day forecast"; a note "Your plan opens 14 days on the map; spot forecasts show up to 10
  days for now"). The 14-day series is phase 3.
- **Tide days 9-14**: not touched; the tide block shows today's extremes only.
- **The tier is client-asserted** (`?subscription_tier=`): the server trim helps an honest client only. Flagged for
  Codex's app-security review; auth not redesigned here.
- **`gold`** maps to guest (3 days) in the resolver's `getUserTier`, which the server echo mirrors; the old server ladder
  gave it 10. `gold` is not a subscription tier anywhere else in the code (only a gamification badge), so it was left to
  the resolver.

## Reflection review (tier resolver)

Taken: the client caps its window by the server's applied `forecast_horizon_hours` (`effectiveWindowHours`), so two
clocks or unloaded capabilities can never open a row the server withheld; rows with an unparseable date are dropped
server-side instead of sent. Not taken, with reasons: `forecast_days_allowed = hours // 24` (kept = rows sent, because
the frozen production Explore card prints it as "N Days" and slices by it: 14 would print "14 Days" over 10 rows);
gating hub render on capabilities (the scrubber has the same unloaded-capabilities behaviour; the server cap bounds it).

## Gates (local, this worktree)

- Backend: `tests/test_forecast_tier_window.py` 21 tests (chain lane), plus `test_spot_details_forecast_deadline.py`
  and `test_parity_unification.py`: 34 passed. flake8 E9/F63/F7/F82 clean; 800-line check 0 violations.
  Chain floor re-derived with `rederive_floor.py --lane chain --add 21 --add-files 1`: 3166 -> 3187, files 189
  (dev run 41549383722 read 3172); this PR must read 3193 passed.
- Frontend: full `src/components src/tests` run 516 suites / 7137 passed + the kill-switch inventory fix; new suites
  `spotHubP1.test.js` (38), `SpotHub.phase1.test.js` (12), `SpotConditions.phase1.test.js` (8); frontend floor
  529/6928 -> 532/6986. `check_eslint.js` passes (no rule above baseline). craco build compiles.
- Visual: the local build on 127.0.0.1:3195 with every app API answered from fixtures (no live backend, sockets
  closed): full hub and drawer in light/dark/beach at 1280x900 and 390x844 (12 PNGs, session scratchpad). The map
  infobox Tide row was NOT screenshotted (it needs the WebGL map, an exact point and surf mode); it is covered by the
  compiler and client tests.
