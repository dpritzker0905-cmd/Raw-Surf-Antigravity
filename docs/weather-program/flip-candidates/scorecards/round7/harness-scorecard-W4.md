# Evaluation harness scorecard (112 targets 2025-10-01T00Z..2025-10-28T18Z)

Code 25c832896cd7; served env from `.github/workflows/precompute.yml` sha256 2599b8861a62; primary `hs_station`; controls True; input parity {'decoders': ['eccodes'], 'wind_sources': ['pgrb2'], 'backend_versions': ['eccodes-python 2.50.0, ecCodes 2.50.0'], 'production_parity': True}.

> **TOP-PRIORITY ALARM: served hs_station LOSES to out-of-sample climatology at lead 24 h (days 0-3): gain -0.1011 m, CI [-0.1263, -0.0705]** (does not block an improving candidate)
> **TOP-PRIORITY ALARM: served hs_station LOSES to out-of-sample climatology at lead 48 h (days 0-3): gain -0.1020 m, CI [-0.1271, -0.0723]** (does not block an improving candidate)
> **TOP-PRIORITY ALARM: served hs_station LOSES to out-of-sample climatology at lead 72 h (days 0-3): gain -0.1046 m, CI [-0.1254, -0.0799]** (does not block an improving candidate)

## Climatology ratchet: hs_station (out-of-sample climatology, embargo from ['2025-09-28T00:00Z', 'open'])

| lead h | class | served vs clim gain | 95% CI | n | locked | would lock |
|---|---|---|---|---|---|---|
| 24 | short | -0.1011 | [-0.1263, -0.0705] | 1192 | no | no |
| 48 | short | -0.1020 | [-0.1271, -0.0723] | 1192 | no | no |
| 72 | short | -0.1046 | [-0.1254, -0.0799] | 1192 | no | no |

## Climatology ratchet: hb_proxy (out-of-sample climatology, embargo from ['2025-09-28T00:00Z', 'open'])

| lead h | class | served vs clim gain | 95% CI | n | locked | would lock |
|---|---|---|---|---|---|---|
| 24 | short | -0.0049 | [-0.0527, 0.0464] | 1192 | no | no |
| 48 | short | -0.0002 | [-0.0464, 0.0507] | 1192 | no | no |
| 72 | short | -0.0054 | [-0.049, 0.042] | 1192 | no | no |

## Climatology ratchet: hs_offshore (out-of-sample climatology, embargo from ['2025-09-28T00:00Z', 'open'])

| lead h | class | served vs clim gain | 95% CI | n | locked | would lock |
|---|---|---|---|---|---|---|
| 24 | short | +0.0634 | [0.0038, 0.1315] | 1937 | no | yes |
| 48 | short | +0.0660 | [0.0125, 0.1262] | 1937 | no | yes |
| 72 | short | +0.0638 | [0.0154, 0.1234] | 1937 | no | yes |

## hs_station (CDIP Hs (waveFlagPrimary == 1))

| arm | n | bias | MAE (=CRPS) | RMSE | SI | HH | twCRPS>p90 | top-decile bias |
|---|---|---|---|---|---|---|---|---|
| persistence | 3576 | +0.005 | +0.252 | +0.346 | +0.348 | +0.326 | +0.050 | -0.304 |
| climatology | 3576 | -0.162 | +0.260 | +0.389 | +0.355 | +0.415 | +0.047 | -0.930 |
| served | 3576 | -0.349 | +0.362 | +0.422 | +0.238 | +0.481 | +0.044 | -0.704 |
- served vs persistence: gain -0.1147 m, CI [-0.17218, -0.04932], n 3576, 112 h, DM p +0.999
- served vs climatology: gain -0.1026 m, CI [-0.12586, -0.07462], n 3576, 112 h, DM p +1.000
- controls (pass): null_identical REFUSED gain +0.0000 CI [0.0, 0.0] -> ok; null_swap FAIL gain -0.0117 CI [-0.03234, 0.01113] -> ok; positive PASS gain +0.0730 CI [0.06066, 0.0823] -> ok; negative FAIL gain -0.0913 CI [-0.10287, -0.07583] -> ok

## hb_proxy (Komar-Gaughan 1972 on deshoaled CDIP Hs/Tp (PROXY))

| arm | n | bias | MAE (=CRPS) | RMSE | SI | HH | twCRPS>p90 | top-decile bias |
|---|---|---|---|---|---|---|---|---|
| persistence | 3576 | +0.009 | +0.321 | +0.435 | +0.261 | +0.249 | +0.065 | -0.330 |
| climatology | 3576 | -0.186 | +0.349 | +0.515 | +0.288 | +0.321 | +0.067 | -1.200 |
| served | 3576 | -0.231 | +0.355 | +0.439 | +0.224 | +0.267 | +0.038 | -0.291 |
- served vs persistence: gain -0.0373 m, CI [-0.07829, 0.00935], n 3576, 112 h, DM p +0.942
- served vs climatology: gain -0.0035 m, CI [-0.05025, 0.04688], n 3576, 112 h, DM p +0.555
- controls (pass): null_identical REFUSED gain +0.0000 CI [0.0, 0.0] -> ok; null_swap FAIL gain -0.0083 CI [-0.02821, 0.01214] -> ok; positive PASS gain +0.0715 CI [0.06284, 0.08066] -> ok; negative FAIL gain -0.0894 CI [-0.10082, -0.07855] -> ok

## hs_offshore (NDBC WVHT (realtime2))

| arm | n | bias | MAE (=CRPS) | RMSE | SI | HH | twCRPS>p90 | top-decile bias |
|---|---|---|---|---|---|---|---|---|
| persistence | 5771 | -0.005 | +0.367 | +0.520 | +0.363 | +0.333 | +0.064 | -0.646 |
| climatology | 5811 | -0.284 | +0.396 | +0.614 | +0.381 | +0.456 | +0.052 | -1.542 |
| served | 5811 | -0.317 | +0.333 | +0.411 | +0.183 | +0.287 | +0.044 | -0.698 |
- served vs persistence: gain +0.0290 m, CI [-0.07301, 0.14197], n 5771, 112 h, DM p +0.353
- served vs climatology: gain +0.0644 m, CI [0.00981, 0.12754], n 5811, 112 h, DM p +0.018
- controls (pass): null_identical REFUSED gain +0.0000 CI [0.0, 0.0] -> ok; null_swap FAIL gain +0.0007 CI [-0.02521, 0.0289] -> ok; positive PASS gain +0.0672 CI [0.05104, 0.07875] -> ok; negative FAIL gain -0.0840 CI [-0.09844, -0.0638] -> ok

## Candidate arms

| arm | quantity | n | gain (m) | 95% CI | DM p | verdict | first reason |
|---|---|---|---|---|---|---|---|
| `SURF_EXPOSURE_RECONCILED=1` | hs_station | 3576 | -0.0246 | [-0.02724, -0.02178] | +1.000 | **FAIL** | not significant overall: DM (abs loss) one-sided p = 1 >= 0.05 |
| `SURF_EXPOSURE_RECONCILED=1` | hb_proxy (advisory) | 3576 | -0.0491 | [-0.05448, -0.04263] | +1.000 | **FAIL** | not significant overall: DM (abs loss) one-sided p = 1 >= 0.05 |
| `SURF_EXPOSURE_RECONCILED=1` | hs_offshore (advisory) | 5811 | +0.0000 | [0.0, 0.0] | - | **REFUSED** | the two lanes give the same loss at every hour: nothing to judge |
| `SURF_TIDE_DEPTH=1` | hs_station | 3576 | +0.0000 | [0.0, 0.0] | - | **REFUSED** | the two lanes give the same loss at every hour: nothing to judge |
| `SURF_TIDE_DEPTH=1` | hb_proxy (advisory) | 3576 | +0.0000 | [0.0, 0.0] | - | **REFUSED** | the two lanes give the same loss at every hour: nothing to judge |
| `SURF_TIDE_DEPTH=1` | hs_offshore (advisory) | 5811 | +0.0000 | [0.0, 0.0] | - | **REFUSED** | the two lanes give the same loss at every hour: nothing to judge |
| `SURF_SPECTRAL_K=1` | hs_station | 3576 | +0.0185 | [-0.03171, 0.05593] | +0.232 | **FAIL** | not significant overall: DM (abs loss) one-sided p = 0.232 >= 0.05 |
| `SURF_SPECTRAL_K=1` | hb_proxy (advisory) | 3576 | -0.1308 | [-0.20655, -0.06081] | +0.999 | **FAIL** | not significant overall: DM (abs loss) one-sided p = 0.999 >= 0.05 |
| `SURF_SPECTRAL_K=1` | hs_offshore (advisory) | 5811 | +0.0000 | [0.0, 0.0] | - | **REFUSED** | the two lanes give the same loss at every hour: nothing to judge |
| `R5_ARM=bhc` | hs_station | 3576 | +0.1139 | [0.09792, 0.12635] | +0.000 | **PASS** | - |
| `R5_ARM=bhc` | hb_proxy (advisory) | 3576 | +0.0987 | [0.06402, 0.13259] | +0.000 | **PASS** | - |
| `R5_ARM=bhc` | hs_offshore (advisory) | 5811 | +0.1032 | [0.08499, 0.11736] | +0.000 | **PASS** | - |
| `R5_ARM=bhc@1` | hs_station | 3576 | +0.1567 | [0.13205, 0.17471] | +0.000 | **PASS** | - |
| `R5_ARM=bhc@1` | hb_proxy (advisory) | 3576 | -0.0167 | [-0.06799, 0.03583] | +0.727 | **FAIL** | not significant overall: DM (abs loss) one-sided p = 0.727 >= 0.05 |
| `R5_ARM=bhc@1` | hs_offshore (advisory) | 5811 | +0.0845 | [0.04911, 0.11438] | +0.000 | **PASS** | - |
| `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1,SURF_EXPOSURE_RECONCILED=1` | hs_station | 3576 | +0.0438 | [-0.00528, 0.07928] | +0.035 | **FAIL** | the 95% block-bootstrap CI of the mean gain [-0.0053, +0.0793] includes 0 (block 14) |
| `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1,SURF_EXPOSURE_RECONCILED=1` | hb_proxy (advisory) | 3576 | -0.0703 | [-0.1555, 0.01339] | +0.931 | **FAIL** | not significant overall: DM (abs loss) one-sided p = 0.931 >= 0.05 |
| `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1,SURF_EXPOSURE_RECONCILED=1` | hs_offshore (advisory) | 5811 | +0.1032 | [0.08499, 0.11736] | +0.000 | **PASS** | - |
| `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1` | hs_station | 3576 | +0.0559 | [0.00537, 0.09366] | +0.015 | **FAIL** | not significant after Holm across 6 arms (p_adj 0.059) |
| `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1` | hb_proxy (advisory) | 3576 | -0.0681 | [-0.15478, 0.01724] | +0.921 | **FAIL** | not significant overall: DM (abs loss) one-sided p = 0.921 >= 0.05 |
| `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1` | hs_offshore (advisory) | 5811 | +0.1032 | [0.08499, 0.11736] | +0.000 | **PASS** | - |
- `SURF_EXPOSURE_RECONCILED=1` changes served outputs on 14340 heights / 579 levels of 15456 replayed spot-hours (mean |score change| +0.659); flag reads: {}
- `SURF_TIDE_DEPTH=1` changes served outputs on 0 heights / 0 levels of 15456 replayed spot-hours (mean |score change| +0.000); flag reads: {'tide_replayed': 15456}
- `SURF_SPECTRAL_K=1` changes served outputs on 5438 heights / 1557 levels of 15456 replayed spot-hours (mean |score change| +2.220); flag reads: {}
- `R5_ARM=bhc` changes served outputs on 11753 heights / 3124 levels of 15456 replayed spot-hours (mean |score change| +3.898); flag reads: {}
- `R5_ARM=bhc@1` changes served outputs on 11758 heights / 3184 levels of 15456 replayed spot-hours (mean |score change| +4.149); flag reads: {}
- `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1,SURF_EXPOSURE_RECONCILED=1` changes served outputs on 15386 heights / 3229 levels of 15456 replayed spot-hours (mean |score change| +4.196); flag reads: {'tide_replayed': 15456}
- `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1` changes served outputs on 12406 heights / 3291 levels of 15456 replayed spot-hours (mean |score change| +4.241); flag reads: {'tide_replayed': 15456}

## Named gaps (offline-unreachable inputs; never stubbed silently)

- `size_reference`: RATING_LOCAL_SIZE=1 grades against a per-spot size climatology in storage; replay passes None (the global 1.2 m curve). Scores differ from served where a spot has a climatology; heights do not. (spot-hours: 15456)
- `obs_gate`: RATING_OBS_GATE=1 caps model-only good/epic at 69.9 unless >= 2 models agree or a report confirms; applied after rating in the precompute merge. Replay scores are PRE-gate. (spot-hours: 15456)
- `best_tide`: the spot's best_tide prior (DB) is unknown, so tide_fit is neutral even with a tide state. (spot-hours: 15456)
- `primary_swell`: the display-only swell_1 field is not replayed (no score or height effect). (spot-hours: 15456)
- `tide_missing`: spot-hours where no tide series was available (tide_norm None, eta 0). (spot-hours: 0)
- `tide_replayed`: spot-hours that read the served tide source (Open-Meteo sea_level_height_msl) by date through the production tide_state_at (not a gap: counted for linkage). (spot-hours: 15456)
- substitution `grid`: served /point samples the stored normalized product (regional tiles / coarse globals); the replay runs the same PointSampler on a native 0.25 deg GFS-Wave crop.
- substitution `wind_gfswave`: only with the built-in decoder (no pygrib, no eccodes) is the rating wind the GFS-Wave file's UGRD/VGRD (the GFS 10 m forcing on the same grid) instead of the atmosphere file's pgrb2.0p25 UGRD/VGRD 10 m; rows say which (input_parity.wind_sources).
- substitution `repo_variables`: workflow `${{ vars.X || 'd' }}` values resolve to their defaults d (repository variables are not readable offline); listed in served_env.repo_variables_defaulted.
- substitution `tide_series`: served fetches forecast_days=3 at run time; replay fetches the same Open-Meteo series by start/end date (a deterministic tide).
