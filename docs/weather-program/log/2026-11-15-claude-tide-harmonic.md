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

## Advisor/director review of #931 (2026-11-15 evening): responses
- **Radius: 10 km** (was 100). The G3 sample was first-30-by-ID per bucket (75/127 in two bays, little Pacific coast);
  on the open coast the model scored 0.117 m vs a neighbour's 0.12-0.16 beyond 5 km. Only <= 5 km was a clear win.
  A region-stratified LOO (Hawaii / Pacific / Gulf of Alaska / Northeast / Southeast / Gulf / Caribbean, open-coast
  stations only, both directions of every pair) is REGISTERED as the condition to widen: D = the largest bucket where
  the neighbour's median beats the model on the local datum in EVERY region with >= 5 pairs. Not run yet.
- **Shape guard:** a station serves only if its tide moves with the spot cell's model over their overlap (r >= 0.8,
  sd ratio 0.6-1.6, best lag within 1 h); else the model. Pensacola (diurnal, r 0.65) is refused by it.
- **Staleness fallback:** a station file that does not cover now .. +72 h serves the model (the ingest stopped).
- **G4 as registered:** the real serve path runs with the HTTP client patched and every URL recorded; none is NOAA's
  (the grep test stays as a second guard).
- **G2 re-run (code at 09918fd68):** 18/20: Virginia Key's ingest fetch failed transiently (no document); Pensacola is
  refused by the shape guard (by design). The other 18 exact.
- **Option B re-scored (advisor point 6):** with the model's own 1-year mean as the residual's offset (instead of the 14
  past days, which absorb a season-long anomaly), same 20 stations x 168 h vs OBSERVED: harmonic alone 0.248, model as
  served 0.354, B (14-day offset) 0.284, **B (1-year offset) 0.157 m**, model minus its 1-year mean 0.211; B-1y beats the
  harmonic alone at 12/20 (still worse in the Southeast: Charleston 0.106 -> 0.179, Fernandina 0.094 -> 0.178). Post
  hoc, so it does not flip the flag. The code now takes the 1-year offset when the door applied it (#926 merged in).

## PRE-REGISTERED (before the run): held-out test of option B with the 1-year offset
Script `backend/scripts/tide_harmonic_heldout_b.py`: the 26 stations x 4 held-out weeks of the #926 test (7 days from
2025-12-15, 2026-03-15, 2026-06-15, 2026-09-15), vs OBSERVED water (MSL, on the hour). Arms: harmonic alone (CO-OPS
predictions); model minus its 1-year mean (what #926 serves); **B** = harmonic + (25 h low-pass of (model minus its
1-year mean) minus harmonic). Pass lines for TIDE_SURGE_RESIDUAL to ship ON:
- **B1** B's median station-week RMSE below BOTH other arms' medians;
- **B2** at every Southeast/Gulf station (Wrightsville, Charleston, Fernandina, Lake Worth, Virginia Key, Clearwater,
  Pensacola) B's 4-week median is not worse than the harmonic alone by more than 0.05 m;
- **B3** on surge hours (|observed - predicted, 25 h low-pass| > 0.15 m), B's median RMSE below the harmonic alone's.
All three pass -> TIDE_SURGE_RESIDUAL default '1' in this PR. Otherwise it stays '0' and the result is recorded.

## Option B held-out result (run as registered above; notes `harmonic-heldout-B.json`)
103 station-weeks (Anchorage 2026-03-15: 18 observed hours, excluded). Median RMSE vs OBSERVED water: harmonic alone
0.147, model minus its 1-year mean 0.177, **B 0.132 m**. **B1 PASS** (below both). **B2 PASS**: Southeast/Gulf 4-week
median B minus harmonic: Charleston +0.002, Clearwater -0.037, Wrightsville +0.014, Virginia Key -0.028, Pensacola
-0.014, Fernandina 0.000, Lake Worth -0.031 m (all <= 0.05). **B3 PASS**: surge hours (72 station-weeks) B 0.147 vs
harmonic 0.211. => **TIDE_SURGE_RESIDUAL ships ON** (the owner's option B). The surge term applies only where the cell
has its 1-year datum (the tested variant); without one, eta is the NOAA tide (the 14-day variant that failed G10 is
never used). Kill '0'. Tests: `test_tide_harmonic.py` 20.

## Advisor re-check (2026-11-15 ~23:40Z, notes `redteam-926-931-923-recheck-2026-11-15.md`): responses
- **DEFECT fixed - the surge term ended at the model's ~72 h horizon** (water_level fell back to the bare tide), so with
  this season's +0.4 m on the US West Coast eta would drop ~0.4 m between +72 and +73 h and the breaking-depth cap would
  step in every forecast. Now `residual_at` HOLDS the last low-passed residual past the model's span (constant, no
  decay: past a few days most of what it carries is the slow seasonal anomaly); before the span (the past day) it is 0.
  Tests: held value at day 10, no step across +72 h, zero before the span (mutation: no hold -> 2 red).
- **G2 re-run of the transient:** Virginia Key now exact (0.000 m, 0 min, 65 events, 408 h). So **19/20 exact + 1
  refused by the shape guard (Pensacola), by design**: against the registered ">= 20" the honest reading is 19 served
  exactly and one deliberately not served.
- **The shape guard's thresholds (r >= 0.8, sd ratio 0.6-1.6, lag <= 1 h) were chosen AFTER Pensacola (r 0.645) was
  seen.** They are not pre-registered; they are a conservative serve-or-fall-back rule whose fallback is the model.
- **The held-out B test used the archive (a hindcast).** In production the surge at +24..+72 h is a FORECAST and B's
  median edge was 0.015 m. OWED (not blocking): a dispatch-only shadow read, two weeks, of served eta at NOAA points
  against OBSERVED water by lead (0-24 / 24-48 / 48-72 / 72+ h held), since the guardrail is BLIND to it. Design: a
  daily CI job records, per station, the production combine's water_level for the next 72 h from the bucket documents
  and the live model forecast (no Render call); a scoring step after 14 days compares each lead with CO-OPS
  water_level. Pass line to write before scoring: B not worse than the tide alone at any lead bucket by > 0.02 m.

## Shadow read built (director: "add a shadow read of B by lead"); #926's fixed datum merged in
- `scripts/tide_eta_shadow.py` + `.github/workflows/tide-eta-shadow.yml` (daily 06:17Z record; dispatch mode=score;
  off switch repo var TIDE_ETA_SHADOW=0): per day, 20 NOAA stations, production's own `combine` on the CI ingest's
  documents and the live model forecast on the fixed 365-day datum -> `tides/shadow/eta-<date>.json` (water_level and
  level, leads 0-96 h). Never calls Render. Local dry run 2026-11-15: 20/20 recorded; La Jolla surge +0.26 m held from
  +70 h to +80 h (no step).
- **Pass line (written before any scoring):** after >= 14 daily records, B's median band RMSE vs OBSERVED water is not
  worse than the tide alone's by more than 0.02 m in ANY lead band (0-24, 24-48, 48-72, 72-96 h held).
- The surge term now requires `datum == "model_mean_365d"` (#926's fixed datum); on the `window_72h` fallback eta is
  the NOAA tide (test).

## REGISTERED (before the change): the held value past the model horizon (advisor, at 838858f0b)
Holding the LAST low-passed residual holds the least reliable value (an edge window of >= 13 samples) and can hold a
storm peak to day 14. Rule, chosen before changing code: past the model span, hold **the smaller in magnitude of (the
last valid residual, the median residual over the span)**, keeping its sign; if they disagree in sign, hold 0.
Inside the span, an hour whose window was dropped (a gap) takes the **nearest valid residual inside the span** (not 0).
Before the span: 0. Tests: (1) seasonal case: a steady +0.4 m stays +0.4 past the horizon (the fixed case stays fixed);
(2) storm at the edge: 0.1 m all span with a 0.8 m peak in the last hours holds ~0.1, not 0.8; (3) a gap hour inside the
span equals its nearest neighbour; (4) opposite signs hold 0.
