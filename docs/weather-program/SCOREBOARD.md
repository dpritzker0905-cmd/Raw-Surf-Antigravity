# Scoreboard: are we getting closer to state of the art? (append-only)

One row per measurement. Never edit a row; a wrong row gets a new row that corrects it and says so. A fix that
changes a served number adds rows before and after, on the same instrument. Lower is better for every MAE and gap.

## The north star

**Beat the public references on paired buoy hours at every lead.** The Forecast Accuracy Monitor grades us and the
public references on the same buoy, target hour and lead against the same verifying observation. Until the gap is at
or below zero, a free public model forecasts the open ocean better than we serve it. Nearshore, where users read the
number, the nearshore judge and the sim-parity monitor are the instruments.

## Instruments

| Id | Instrument | Where it runs | What it says |
|---|---|---|---|
| S1 | Offshore skill ledger, held-out week (`/api/weather/buoy-calibration` → `forecast_skill_consensus`) | inside every precompute | MAE and bias per lead for GFS (served), EURO, ICON and the consensus candidates; `by_band`, `by_region` |
| S2 | Public-reference gap (Forecast Accuracy Monitor, paired head-to-head) | `forecast-accuracy-monitor.yml` | how far a public reference (Open-Meteo marine, NCEP GFS-Wave 0.25°) is ahead of us, in metres |
| S3 | Nearshore judge (`nearshore-validation.yml`) | scheduled + dispatch | MAE of the served NEARSHORE height at nearshore buoys, with MOP / NWPS / consensus arms |
| S4 | Sim parity (`sim-parity-monitor.yml`) | scheduled | spots whose served glyph and sim differ by a rating level (a composition break when attributed so) |
| S6 | Same-model parity (`backend/scripts/same_model_parity_probe.py`) | on demand | our served GFS vs Open-Meteo's GFS-Wave 0.25 at the ledger's buoys, forecast to forecast: pipeline loss, no observation needed |
| S5 | Data freshness | Actions run history, `/api/health` → `scheduler.workflow_dispatch` | missed ingest slots; runs per day per lane |

## Rows

| Date (UTC) | `dev` | Id | Metric | Value | Source |
|---|---|---|---|---|---|
| 2026-09-28 22:50Z | `52e0ec53` | S3 | nearshore MAE / obs-over-model | 0.139 m / 1.12 (was 0.148 / 1.23 at Kr 0.797) | judge run 36494660949, after #120 (Kr 0.873) and #146 |
| 2026-09-28 22:50Z | `52e0ec53` | S3 | MOP grid arm vs chain | 0.085 vs 0.172 m (MOP closer on 75% of rows) | judge run 36494660949 |
| 2026-09-28 23:45Z | — | S5 | missed scheduled slots, 3 days | core ingest 44% (rest median 106 min late), pilots 11% (305 min), MOP 75% (290 min), Data Health 89% | Actions run history; motivated #153 |
| 2026-09-29 02:29Z | `322d1f20` | S1 | all-sea MAE 24/48/72 h, served GFS | 0.300 / 0.329 / 0.392 m | ledger report, held-out week, ~2,800 pairs/lead |
| 2026-09-29 02:29Z | `322d1f20` | S1 | all-sea MAE 24/48/72 h, equal mean (candidate) | 0.282 / 0.304 / 0.337 m | same |
| 2026-09-29 02:29Z | `322d1f20` | S1 | big swell (3 m+) MAE 24/48/72 h, served GFS vs equal | 0.464 / 0.580 / 0.872 vs 0.432 / 0.432 / 0.645 m | same (n 320 / 282 / 306) |
| 2026-09-29 02:36Z | `ef1ba246` | S4 | spots a level apart | 0 of 48 | sim parity run 36513357358 |
| 2026-09-29 06:49Z | `e82f59c8` | S2 | gap to Open-Meteo marine at 24/48/72 h | +0.050 / +0.045 / +0.058 m (our win rate 41-42%, n ≈ 2,560-2,760) | accuracy monitor run 36533043356; held since 2026-08-10 |
| 2026-09-29 06:49Z | `e82f59c8` | S2 | gap to NCEP GFS-Wave 0.25° at 24/48/72 h | +0.020 / +0.026 / +0.027 m (our win rate 41-42%, n ≈ 2,240-2,410) | same |
| 2026-09-29 06:49Z | `e82f59c8` | S1 | buoy height MAE, served | 0.289 m over 59 buoys (bias −0.016 m) | same |
| 2026-09-29 11Z | `e82f59c8` | S1 | `by_band` MAE, equal vs served GFS | big 0.501 vs 0.635 · rideable 0.342 vs 0.375 · small 0.251 vs 0.253 · flat 0.139 vs 0.245 m | ledger `by_band` (first publication) |
| 2026-09-29 11:24Z | `e82f59c8` | S4 | spots a level apart | **32 of 48**: glyphs baked without size references after a Supabase 429 at 02:48Z (fixed by #162) | sim parity run 36561587061 |
| 2026-09-29 13:46Z | `e4c27fd7` | S5 | dispatch fallback's first decisions | core ingest 12:15Z slot and pilots 11:45Z slot had no run → both dispatches **HTTP 403** (token lacks Actions write); MOP 12:40Z slot served | Render log `[workflow-dispatch]` |
| 2026-09-29 17:00Z | `de72c81c` | S5 | first armed consensus shadow build | 874 of 882 frames across 18 regions (8 no member within 3 h, 0 refused), 8.5 min | pilots run 36590800405 |
| 2026-09-29 18:09Z | `afa19a52` | S6 | same-model parity, ours vs Open-Meteo GFS-Wave 0.25 (same 12Z cycle) | n=240 at 56 buoys: bias +0.008 m, MAE 0.074; global_mid tier bias +0.100 (43% of sq. diff on 18% of rows); regional node vs native cell MAE 0.045 | same_model_parity_probe (new) |
| 2026-09-29 18:24Z | `afa19a52` | S6 | regional node vs Open-Meteo NW 2x2 RMS-equivalent mean | MAE 0.0102 m, 72% within 0.011 m (own cell: 14%): nodes are 2x2 means shifted half a cell NW | offset + block scans |
