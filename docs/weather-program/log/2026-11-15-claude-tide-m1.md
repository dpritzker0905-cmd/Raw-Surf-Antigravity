# 2026-11-15 - M1 tide: FES2022b (PyFES, offline) + EOT20 + NOAA CO-OPS; no Open-Meteo. Session tide-overlay-cf8266

Director, 2026-11-15 21:23 EST, under the owner's rules ("nothing depending on open-meteo", 20:14 EST; "move forward
on the best path toward state of the art", 21:09 EST): HOLD #926 and #931 (both serve Open-Meteo sea level; commented
on both PRs) and build M1 from the research lead's plan (PR #929 log, "01:52Z FES2022 confirmed usable").

## Design
- **Offline only (GPL):** PyFES (GPL) runs ONLY in a GitHub Actions job (`backend/scripts/tide_fes/`). The served
  backend never imports it (a guard test asserts no `pyfes` import under `services/` or `routes/`); it serves PyFES's
  OUTPUT (precomputed per-spot hourly tide and high/low events in the weather-products bucket).
- **FES2022b, extrapolated, ocean tide (not load):** what a tide gauge sees. Constituents: M2 S2 N2 K2 K1 O1 P1 Q1 2N2
  M4 MS4 MN4 Mf Mm Sa Ssa (16 of 34; Sa/Ssa because NOAA's predictions carry the seasonal cycle). Downloaded over
  AVISO's authenticated SFTP/FTPS with the `AVISO_USERNAME` / `AVISO_PASSWORD` Actions secrets (never echoed), cached
  compressed between runs. PyFES loads only a small bbox around each prediction point (a global 1/30 deg atlas of 16
  constituents does not fit a runner's memory).
- **EOT20 (DGFI-TUM, CC BY 4.0):** the gate arm and the fallback where FES has no value.
- **NOAA CO-OPS harmonic predictions** near US stations (PR #931's door: 10 km, shape guard, staleness) on top.
- **Order at serve time:** CO-OPS station -> FES2022b -> EOT20 -> unavailable. No model sea level anywhere.
- **Datums:** the prediction is zero-mean about MSL by construction; MLLW / LAT computed offline from the constituents
  (US display MLLW, elsewhere LAT; labelled). eta for the breaking cap stays relative to MSL.
- **Credits** (LayerDataCredit + /point-tide): DGFI-TUM EOT20 (CC BY 4.0); "The FES2022 Tide product was funded by
  CNES, produced by LEGOS, NOVELTIS and CLS and made freely available by AVISO", DOI 10.24400/527896/A01-2024.004;
  NOAA CO-OPS.
- **Later (M1b):** a non-tidal residual (Copernicus sea level or CO-OPS observations).

## PRE-REGISTERED gate (written before any FES run)
Job `.github/workflows/tide-fes-gate.yml` -> `backend/scripts/tide_fes/fes_gate.py`. The same 25 CO-OPS stations as
the #926 checks (the IDS of `tide_datum_vs_coops.py`; Boston/Galveston reported if they fail to load). Each arm is
evaluated at the station's own coordinate, hourly, over the 14 UTC days before the run day.
- **G-M1a parity:** RMSE of FES2022b (tide + long-period, m) vs CO-OPS harmonic PREDICTIONS (MSL). PASS when the median
  over stations is **below 0.117 m** (#926's best figure against the same truth) - and reported beside it the median
  for EOT20 once that arm runs.
- **G-M1b timing:** FES High/Low times vs CO-OPS hilo: median absolute error <= 20 min; reported per station.
- **G-M1c observed water (informative, defined now):** RMSE vs CO-OPS OBSERVED water (MSL, on the hour) for FES and
  for CO-OPS's own predictions; FES within 0.05 m of CO-OPS predictions at the median. Both are astronomical, so both
  miss surge; this checks that FES adds no error of its own beyond NOAA's.
- **Shadow then cutover:** served beside today's values (a shadow field) first; cutover behind a kill switch with a
  SCOREBOARD row. No served number moves in the gate PR.
