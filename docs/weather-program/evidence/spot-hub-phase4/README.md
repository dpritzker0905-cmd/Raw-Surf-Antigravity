# Spot-hub phase 4 charts (#729): visual check of the real production build, offline (2026-11-05)

**How.** `REACT_APP_BACKEND_URL=http://127.0.0.1:8765 npm run build` (the build contains no live-backend URL), served
locally; every backend call answered by `harness/mock.mjs` and every other host aborted by Playwright
(`harness/common.js`), so the live Render box was never contacted. Series data = `spotSeries.fixture.js` (synthetic,
not a forecast). The user is a FREE-tier fixture. Run: `node harness/mock.mjs <build> seen.json` then
`node harness/matrix.js <outdir>`; per-scenario readings are in `results.json` (34 scenarios).

**Mock artefacts (not app defects).** The infobox's Swell/Period/Dir rows read "Rate limited" and "Stale Hour
Retained" because the mock answers `/api/weather/point` and `/grid_series` with an empty body; the drawer's
"Unable to fetch conditions" likewise. The basemap is the simplified-coastline fallback because tile hosts are blocked.

## Results

| Check | Result |
|---|---|
| Charts render in rating colours (`RATING_COLOR`), with the level word, height and wind as text | PASS: hub, drawer, infobox, 3 themes x desktop 1440x900 + phone 390x844 |
| Never colour alone | PASS after fix 2: slider `aria-valuetext` ("Wed 16:00, 2.6 ft, Poor to Fair, 4 kt offshore, tide 0.6 m"), readout line, day buttons' `aria-label`s and visible words |
| Keyboard + ARIA | PASS after fix 1: `role=slider`, `tabindex=0`, label, ArrowRight/Home/End move `aria-valuenow`, visible focus ring; day buttons `aria-pressed`; locked days labelled |
| Free tier: daily = today + 2 local days, hours to +72 h, locked beyond | PASS: 3 day buttons, 11 locked days, one upgrade prompt; last frame's map hour = +66 h (<= 72) |
| GPS-marker infobox | PASS: no chart (a GPS fix is not a catalogued spot; no series exists for it) |
| Kill switch `window.__RAW_DISABLE_SPOT_HUB_CHARTS__ = true` | PASS: hub and drawer show the previous daily rows, infobox has no mini chart, zero `/spot-series` requests |
| No horizontal page scroll at phone width | PASS |
| Console errors | PASS for this PR. Only remaining non-harness error: Radix "`DialogContent` requires a `DialogTitle`" on the map page, which also fires with the kill switch on (pre-existing, not from #729) |

## Fixes made during the check (on #729's branch)

1. **Home / a tap could not select the first bar.** The first bar is the frame covering "now" (before the map's
   hour 0); it maps to hour 0, whose nearest bar is the second one, so the two-way sync bounced the selection off it
   while the slider advertised `aria-valuemin=0`. `useSelection` now keeps its own bar when the map hour is the hour
   that bar stands for. Test: `SpotForecastChart.test.js` "two-way bound ...".
2. **The infobox readout truncated the rating word** ("Poor t..."), leaving colour as the only visible carrier at
   ~200 px. It now wraps. Test: the infobox-chart test asserts no `truncate`.

## Screenshots

In `audit/spot-hub-phase4/build-check/` (PNGs stay out of `docs/weather-program/`: `memory_audit.py` reads every file there as text).
`hub-free-*`, `drawer-free-*`, `infobox-spot-*`, `infobox-gps-*` for `{light,dark,beach}-{desktop,phone}`;
`*-killswitch` variants for the hub (3 themes desktop + dark phone), drawer and infobox (dark desktop, light phone).
