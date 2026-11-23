# 2026-11-22 · opus · Gusts: say which gust each model serves (the time-window label)

Lane: started by the gust-colour-parity director (local_7f4942af) after the gust verification (#1063, SCOREBOARD row
2026-11-18). That check found ECMWF/ICON's apparent high bias is mostly the time window: their fields are maxima over hours,
while the observation is one peak an hour. Both advisors consulted on 2026-11-22 (Reflection, SubQ) ranked explicit window
labelling as a cheap SOTA step. The owner's palette (wind colours for gusts) and the no-stand-in rule (D-075) stand: no colour
and no data change here.

## What changed (client words only; no served number moves)

- `frontend/src/components/map/gustWindow.js` (new): the window per model and lead. GFS `GUST` is instantaneous. ECMWF open
  data `10fg`/`10fg3` is the max over the past 1 h to 90 h, 3 h to 144 h and 6 h after. ICON `VMAX_10M` is the max over the
  past 1 h to 78 h and 3 h after.
- The status line under the timeline (`rasterDrawnFrame.describeRasterFrame`): when the asked gust frame is on screen, a quiet
  `window` line, e.g. "Peak gust, max over the last 3 h (ECMWF)". It is added to the nearest / reduced lines. Loading,
  stand-in and gap-fill lines still win.
- The legend credit (`LayerDataCredit`, beside 'Wind Gusts (kts)' in all three legend layouts): " · max over last 3 h" in
  place of the generic " · peak since last step". The accessible name starts with the full words.
- The lead is the DRAWN frame's own: valid minus run, read from the shown frame's published path
  `<set>/<run stamp>/<valid stamp>-<sha>.bin` (`frame_set_raster.py`'s frame path), which the status record already holds. So
  `useOwnRasterFrames.js` is untouched (PR #1176 edits it). A held or nearest frame is labelled by what is on screen. A path
  without both stamps means no ECMWF/ICON label (no guess); GFS is instantaneous at every lead.
- Kill: `window.__RAW_DISABLE_GUST_WINDOW_LABEL__ = true` (the line and credit as before).

## Deviation from the brief

The brief said the ECMWF window is "3 h, then 6 h". The decoded messages (`backend/scripts/gust_verify_collect.euro_window`,
`frame_set_raster.py` gust_euro) say the window is **1 h to 90 h**, then 3 h to 144 h, then 6 h. Our EURO frames are 3-hourly to
144 h, but at leads up to 90 h each one holds `10fg` over the past hour only. The label follows the data.

## Not done

- The point infobox "Gusts" card (`forecastCardCompiler.js`) reads Open-Meteo's point `wind_gusts_10m`, not our per-model
  frames. A per-model window label there would be false. It is left unlabelled, and is a candidate for its own change: a
  second gust source on screen.
- The legend title stays 'Wind Gusts (kts)'. The window sits in the credit on the same row, so the 375 px row does not grow
  another phrase.

## Evidence

- `gustWindow.test.js`: 45 tests. Every step boundary (EURO 90/93, 144/150; ICON 78/81; GFS any lead), the status line per
  model, nearest/pending/estimated precedence, the missing-run case, the kill, ForecastTimeStatus and the rendered credit in
  light, dark and beach.
- Full `src/components/map` + `src/tests` Jest, `check_eslint.js` and `npm run build`: see the PR.
