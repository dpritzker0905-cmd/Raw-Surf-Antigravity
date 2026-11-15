# 2026-11-15 - NOAA harmonic tide (TIDE_HARMONIC) built; surge term (option B) held OFF by its own gate

Owner, in session: "Start building the NOAA harmonic tide upgrade" (14:56 EST), after choosing eta option (B)
"Tide + Surge" (14:44 EST). Plan + pre-registered gate: `2026-11-15-claude-tide-harmonic-plan.md` (written and pushed
before any code). Stacked on PR #926 (TIDE_LOCAL_DATUM). Raw results: notes folder `tide-overlay-2026-11-15/`
(`harmonic-radius-G3.json`, `harmonic-gate-G2-G10.json`).

## Built
- `services/weather_pipeline/tide_harmonic.py`: nearest indexed CO-OPS harmonic station within RADIUS_KM; reads
  `tides/coops/index.json` + `tides/coops/<id>.json` from the weather-products bucket (6 h in-process cache, 5 min
  failure cooldown, per-key lock); `combine` serves level = the NOAA prediction (station MSL), NOAA's own High/Low
  events (6-min), `water_level`, `source`, `station`. Any failure -> the model (PR #926 local datum).
- `tide.fetch_tide_hourly` (the one door) tries it first; `tide_norm_at` returns `water_level_m`; `sea_inputs.resolve`
  takes eta from it. `/point-tide` reports `tide_source`, `station`, `provider`, `quantity` per source and uses NOAA's
  events; `/tides/{id}` too.
- `scripts/tide_harmonic_ingest.py` + `.github/workflows/tide-harmonic.yml` (daily 05:23Z + dispatch; off switch repo
  var TIDE_HARMONIC_INGEST=0): stations within 100 km of an active spot; hourly MSL predictions -14 d..+15 d, hilo,
  model_offset_m (median model - prediction over the 14 past days). Render never calls NOAA.
- Client: the infobox footer names the source ("NOAA tide prediction · Honolulu (3 km) · MSL" / "Modeled sea level ·
  MSL"); the glyph card's fallback reads the door (`glyphTide.js` -> /point-tide + tideAt), no browser-direct Open-Meteo.
- Flags (GUARDED): TIDE_HARMONIC '1'; TIDE_SURGE_RESIDUAL '0' (held, see G10). Guardrail coverage BLIND for both (the
  replay's cached window has no NOAA series); evidence = G2/G3/G10 here.

## Gate results (pre-registered)
- **G3 radius (leave-one-out over 1,260 harmonic stations, 127 scored, 14 d):** neighbour vs model median RMSE:
  5 km 0.064 vs 0.244 (28/28 wins), 10 km 0.123 vs 0.280 (25/28), 25 km 0.129 vs 0.265 (19/26), 50 km 0.081 vs
  0.149 (15/18), 100 km 0.164 vs 0.239 (15/27). Rule -> **D = 100 km**. Caveats: 56% wins at 100 km; the sample leans
  on Chesapeake/Delaware Bay stations (75/127), where the model is weakest.
- **G2 station truth: PASS 20/20** (HI, CA, OR, Northeast, Carolinas, FL, Gulf): served hourly level max error 0.000 m,
  High/Low time max error 0 min, 384-hour horizon, through the real door with the CI ingest's own documents.
- **G9 residual sanity: PASS** (unit): planted 0, +0.5 and -0.3 m surges recovered within +-0.02 m.
- **G10 eta truth: FAIL for option B.** Against CO-OPS OBSERVED water level, 20 stations x 168 h, with the model offset
  taken from the 14 days before (out of sample): median RMSE harmonic alone **0.248 m**, model as served **0.354**,
  tide + surge **0.284**; B beat both at 9/20. B won big where a surge ran this week (Sandy Hook 0.350 -> 0.126,
  Atlantic City 0.352 -> 0.136, Newport 0.314 -> 0.149, South Beach OR 0.448 -> 0.286) and lost in the Southeast
  (Charleston 0.106 -> 0.351, Fernandina 0.094 -> 0.409, Lake Worth 0.200 -> 0.404), where the model's non-tidal
  signal is noise. => TIDE_SURGE_RESIDUAL ships HELD OFF; eta at NOAA points = the NOAA tide (0.248 vs the model's
  0.354 m against observed: better than today either way). The residual is one flag flip away when a version passes.
- **G4 load: PASS** - a test asserts the serve path holds no NOAA host; bucket reads cached per key for 6 h; scrub
  requests unchanged (the overlay's 0 per step, #923).
- **G1 parity / G5 horizon:** unit-level here (same payload through tideAt; 384 h served). The four-surface parity at
  hours 100/300 needs #923 merged with this (the overlay lives there): to run once both land.
- **G6 history filter:** runs on the PR (TIDE_HARMONIC is BLIND to the replay; expect SKIPPED/UNTESTABLE).
- **G7 screenshots: NOT taken** for the new footer text (same element and theme classes as before). Owed.
- **G8 coverage census:** needs the spot table (CI); the first ingest run prints spots and stations.

## Tests
Backend `test_tide_harmonic.py` 16 (mutation: residual zeroed -> 4 red); tide/flag/guardrail/sea-input/replay suites
147 and a 93-file sweep 1629 passed (one expectation updated: the model result now carries `source`). Frontend
`tideSource.test.js` 2, map tide/marker/overlay/kill suites 88/88. Lint and size gates clean.
