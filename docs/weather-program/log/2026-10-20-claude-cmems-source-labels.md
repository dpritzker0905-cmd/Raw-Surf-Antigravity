# 2026-10-20 claude: CMEMS source labels (MFWAM, not ECMWF)

Branch `claude/cmems-source-labels`, on `dev` 11d19ef0b. Times UTC.

## 04:06Z: what the owner asked, and what was checked

Owner (2026-10-20, ~03:00Z): "we have to be careful our copernicus is routed to the proper ECMWF ... check for me as if I
was asking a question", then "As long as its grib and direct data feed CMEM or better, we are good", then "The labeling
was just wrong. Can we fix that? ive asked in the past, but its been missed". Then, on the app: "We dont need an extra
copernicus header, Euro is fine" and "whatever is the best path toward state of the art. Use jacobian lens".

**Routing (read from code at dev b240d727, not measured live):** every primary EURO wave route is a direct feed.
- `waves` on the global coarse / mid / pilot tiers: ECMWF Open Data wave stream (ECWAM 0.25 deg; swh/mwp/pp1d/mwd),
  `ecmwf_wave_service`, kill `EURO_MARINE_COARSE_ECMWF` / `EURO_MARINE_MID_ECMWF`.
- `swell_1`, `swell_2`, `wind_waves`, the regional/island tiers and the native `/point` + spot-ratings points: CMEMS
  `cmems_mod_glo_wav_anfc_0.083deg_PT3H-i` (GLOBAL_ANALYSISFORECAST_WAV_001_027).
- Not direct: the Open-Meteo `ecmwf_wam025` (+GFS) fallback, used only when CMEMS/ECMWF fail.

**The defect was the label, not the route.** CMEMS global waves is Météo-France's MFWAM (ECWAM code base, ECMWF IFS
winds, 1/12 deg, altimeter assimilation), not ECMWF's own wave model. The code said otherwise in: the capabilities
notes (static rows and the served override), the estimate-basis `source_model` `ecmwf_wam_cmems_glo_0083` (both coarse
and mid tiers), the `copernicus_marine_service` docstring ("Source model: ECMWF WAM"), the coarse ingestion comment
("REAL ECMWF-WAM swells") and the route census (which also called the ECMWF wave stream "the IFS product" and guessed
an atmospheric product was answering wave requests; the code fetches the wave stream, so that guess is withdrawn and
the 2026-08-03 n=70 gap is now stated as a gap between two wave models).
The owner says this was asked before. I found no record of it in `docs/weather-program/` (no "MFWAM" anywhere), which is
why it kept being missed: the fix now carries a guard (`tests/test_cmems_source_labels.py`).

## What changed

- Backend labels as above. `source_model` is now `mfwam_cmems_glo_0083`. Nothing reads that string programmatically
  (grep: only the two definitions); `basicSourceName` still maps it to "Copernicus" via "cmems". Stored products keep
  the old string until their next ingest.
- App: the forecast panel header and the three EURO no-data swell cards said "ECMWF" while the picker says "EURO".
  Jacobian read (outputs: provenance honesty, match with the picker, licence, regression risk; levers: keep "ECMWF",
  per-layer "Copernicus", "EURO"): "ECMWF" is false on 3 of EURO's 4 marine layers; per-layer "Copernicus" (my first
  build) was rejected by the owner and breaks the match with the picker; "EURO" names our lane, not an organisation,
  so it is true on every layer and matches the picker. Cross term checked: `modelProvenance.ACTIVE_MODEL_LABEL` stays
  "ECMWF", because `describeSubstitution` compares it with the tile family (`ecmwf_*`), and renaming it would raise a
  false "substituted" banner on every EURO tile (pinned in `modelDisplayName.test.js`).
  Text only, ships ON, kill `window.__RAW_DISABLE_EURO_DISPLAY_NAME__ = true`.
- **No served number changes** (no surf height, rating, glyph, hub or sim value); no SCOREBOARD row.

## Evidence

- Backend: `tests/test_cmems_source_labels.py` 3 passed (with `test_capabilities_contract.py`, 19 passed); mutation:
  the capability-note asserts went red against the served override before it was fixed. Chain lane 170 -> 171 files;
  floor 170/2817 -> 171/2820, `_FLOOR_SET_FROM` chain 2823 -> 2826 (dev hosted read 2823, CI 39364732468). flake8
  gate clean; file-size check 0 violations.
- App: `src/components/map` + `src/tests` + `src/__tests__` 413 suites / 5545 passed; mutation (one card back to
  'ECMWF') -> 1 failed. ESLint ratchet exit 0. Not opened in a browser.

## Follow-up found (not built here)

The app credits no data source anywhere (frontend grep: no "Copernicus Marine Service" or ECMWF credit). The CMEMS
licence (section 2.4) asks for "Generated using E.U. Copernicus Marine Service Information" visible on the home page or
the page giving access to the data; ECMWF Open Data is CC BY 4.0 (attribution); DWD open data asks for a source note.
A data-credit line is the next step on this axis (all three themes, desktop and mobile).
