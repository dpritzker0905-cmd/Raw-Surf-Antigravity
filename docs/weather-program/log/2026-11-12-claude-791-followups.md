# #791 post-merge review follow-ups (findings 6 and 5)

Session: Claude (subagent of the #791 review session), 2026-11-12. Owner asked to start the follow-up PRs from the
post-merge review of #791 (responsive weather + selected-time tides, merged as 40d004dfe). Two small draft PRs to
`dev`, built from origin/dev. Codex-owned files (MapPage, MapWeatherControls, TideReadout, usePointTide,
tideReadoutFormat, useMapChromeLayout, WeatherLayerSheet, and the listed backend serving files) were not edited.
This same file is committed identically in both PRs so either can merge first.

## PR A: tide-cell rounding oracle in CI (finding 6)

- The client tide cell (`tideClient.js` roundTideCoordinate, via tideCellKey and the fetch URL) must match the
  backend `services/weather_pipeline/tide.py::_round_key`, which is Python `round(x, 1)`. CI had 5 cases.
- `frontend/scripts/gen_tide_round_oracle.py` writes `tideRoundOracle.fixture.json` (10,006 inputs, 180 KB):
  every multiple of 0.25 in [-180, 180] with its adjacent binary floats and +/- Number.EPSILON, every x.x5
  decimal, signed zero, the +/-90 / +/-180 bounds and neighbours, and a seeded (791) sweep of 3000.
- Frontend `tideRoundOracle.test.js` (3 tests): the client agrees on every input, as lat and lng. Mutation:
  removing the .25/.75 tie branch turns 2 of 3 red. Backend `tests/test_tide_round_key_oracle.py` (chain lane,
  3 tests): `_round_key` equals the fixture, keeps -0.0 and ties-to-even, and the fixture equals the generator.
- Finding: signed zero differs (Python keeps `-0.0`, the client yields `0`). Same cell: Python's tuple key compares
  equal and hashes equal; the URL would say `latitude=0` instead of `-0.0`, which Open-Meteo treats identically.
  Recorded, not changed.
- Floors by fragment (`rederive_floor.py`): frontend +3 tests / +1 suite, chain +3 tests / +1 file.

## PR B: 44x44 hit area for the short-screen Legend toggle (finding 5, part)

- `responsiveWeather.css` (max-height: 600px block) kept `.weather-legend-toggle { min-height: 24px }`. Now the pill
  stays 24px (no layout shift in the height-budgeted short layout) and a transparent `::before`,
  `width/height: max(100%, 44px)` centred on the button, gives a 44x44 minimum hit area. It paints nothing, so
  light, dark and beach are unchanged; the rule is in the shared stylesheet, so desktop short windows and mobile
  landscape both get it.
- Measured in Chrome (static harness, 700x400 viewport, the same two rules): `elementFromPoint` hits the button at
  +/-21 px from centre and misses at +/-23 px, vertically, and horizontally for a 13 px-wide button; visible box
  stays 24 px tall.
- Jest `responsiveWeatherTapTargets.test.js` (3 tests) pins the stylesheet text. Mutation: deleting the `::before`
  rule turns it red. Floor fragment: frontend +3 tests / +1 suite.
- Kill switch: none at CSS level. The repo's switch pattern is a JS `window.__RAW_DISABLE_<NAME>__`, which a CSS rule
  cannot read without a JS hook in MapPage.js (Codex-owned). The coarse switch `__RAW_DISABLE_RESPONSIVE_WEATHER__`
  removes the whole responsive layer, this rule included.
- Codex follow-up (not done here, their file): the mobile close-button width in MapWeatherControls.js.

No served number changed in either PR; no SCOREBOARD row.
