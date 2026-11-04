# Evaluation harness scorecard (112 targets 2024-12-01T00Z..2024-12-28T18Z)

Code 25c832896cd7; served env from `.github/workflows/precompute.yml` sha256 2599b8861a62; primary `hs_station`; controls True; input parity {'decoders': ['eccodes'], 'wind_sources': ['pgrb2'], 'backend_versions': ['eccodes-python 2.50.0, ecCodes 2.50.0'], 'production_parity': True}.

## Climatology ratchet: hs_station (out-of-sample climatology, embargo from ['2024-11-28T00:00Z', 'open'])

| lead h | class | served vs clim gain | 95% CI | n | locked | would lock |
|---|---|---|---|---|---|---|
| 24 | short | -0.0229 | [-0.1199, 0.0623] | 1156 | no | no |
| 48 | short | -0.0197 | [-0.1175, 0.0697] | 1156 | no | no |
| 72 | short | -0.0235 | [-0.1271, 0.0768] | 1156 | no | no |

## Climatology ratchet: hb_proxy (out-of-sample climatology, embargo from ['2024-11-28T00:00Z', 'open'])

| lead h | class | served vs clim gain | 95% CI | n | locked | would lock |
|---|---|---|---|---|---|---|
| 24 | short | +0.0244 | [-0.1463, 0.202] | 1156 | no | no |
| 48 | short | +0.0335 | [-0.1398, 0.2115] | 1156 | no | no |
| 72 | short | +0.0249 | [-0.1495, 0.2078] | 1156 | no | no |

## Climatology ratchet: hs_offshore (out-of-sample climatology, embargo from ['2024-11-28T00:00Z', 'open'])

| lead h | class | served vs clim gain | 95% CI | n | locked | would lock |
|---|---|---|---|---|---|---|
| 24 | short | +0.1349 | [-0.014, 0.2455] | 2015 | no | no |
| 48 | short | +0.1336 | [-0.0108, 0.2408] | 2015 | no | no |
| 72 | short | +0.1266 | [-0.0307, 0.2469] | 2015 | no | no |

## hs_station (CDIP Hs (waveFlagPrimary == 1))

| arm | n | bias | MAE (=CRPS) | RMSE | SI | HH | twCRPS>p90 | top-decile bias |
|---|---|---|---|---|---|---|---|---|
| persistence | 3444 | -0.071 | +0.333 | +0.552 | +0.464 | +0.421 | +0.093 | -0.582 |
| climatology | 3468 | -0.161 | +0.386 | +0.614 | +0.499 | +0.520 | +0.096 | -1.507 |
| served | 3468 | -0.375 | +0.403 | +0.495 | +0.273 | +0.412 | +0.053 | -0.658 |
- served vs persistence: gain -0.0727 m, CI [-0.11421, -0.01352], n 3444, 112 h, DM p +0.995
- served vs climatology: gain -0.0220 m, CI [-0.12061, 0.06634], n 3468, 112 h, DM p +0.658
- controls (pass): null_identical REFUSED gain +0.0000 CI [0.0, 0.0] -> ok; null_swap FAIL gain -0.0061 CI [-0.02644, 0.0212] -> ok; positive PASS gain +0.0795 CI [0.05827, 0.10206] -> ok; negative FAIL gain -0.0994 CI [-0.12757, -0.07284] -> ok

## hb_proxy (Komar-Gaughan 1972 on deshoaled CDIP Hs/Tp (PROXY))

| arm | n | bias | MAE (=CRPS) | RMSE | SI | HH | twCRPS>p90 | top-decile bias |
|---|---|---|---|---|---|---|---|---|
| persistence | 3444 | -0.094 | +0.462 | +0.723 | +0.362 | +0.343 | +0.113 | -0.742 |
| climatology | 3468 | -0.303 | +0.515 | +0.819 | +0.382 | +0.426 | +0.112 | -1.954 |
| served | 3468 | -0.194 | +0.478 | +0.599 | +0.285 | +0.276 | +0.075 | +0.196 |
- served vs persistence: gain -0.0220 m, CI [-0.09746, 0.08182], n 3444, 112 h, DM p +0.678
- served vs climatology: gain +0.0276 m, CI [-0.1458, 0.20724], n 3468, 112 h, DM p +0.394
- controls (pass): null_identical REFUSED gain +0.0000 CI [0.0, 0.0] -> ok; null_swap FAIL gain -0.0112 CI [-0.03997, 0.02173] -> ok; positive PASS gain +0.0945 CI [0.0736, 0.11763] -> ok; negative FAIL gain -0.1182 CI [-0.14704, -0.092] -> ok

## hs_offshore (NDBC WVHT (realtime2))

| arm | n | bias | MAE (=CRPS) | RMSE | SI | HH | twCRPS>p90 | top-decile bias |
|---|---|---|---|---|---|---|---|---|
| persistence | 6042 | -0.106 | +0.487 | +0.772 | +0.441 | +0.407 | +0.106 | -0.940 |
| climatology | 6045 | -0.127 | +0.546 | +0.783 | +0.446 | +0.431 | +0.081 | -1.623 |
| served | 6045 | -0.369 | +0.414 | +0.527 | +0.217 | +0.288 | +0.054 | -0.571 |
- served vs persistence: gain +0.0730 m, CI [-0.00128, 0.17084], n 6042, 112 h, DM p +0.054
- served vs climatology: gain +0.1317 m, CI [-0.01571, 0.24146], n 6045, 112 h, DM p +0.038
- controls (pass): null_identical REFUSED gain +0.0000 CI [0.0, 0.0] -> ok; null_swap FAIL gain -0.0125 CI [-0.05223, 0.01812] -> ok; positive PASS gain +0.0828 CI [0.06283, 0.10517] -> ok; negative FAIL gain -0.1036 CI [-0.13147, -0.07854] -> ok

## Candidate arms

| arm | quantity | n | gain (m) | 95% CI | DM p | verdict | first reason |
|---|---|---|---|---|---|---|---|
| `SURF_EXPOSURE_RECONCILED=1` | hs_station | 3468 | -0.0197 | [-0.0251, -0.01395] | +1.000 | **FAIL** | not significant overall: DM (abs loss) one-sided p = 1 >= 0.05 |
| `SURF_EXPOSURE_RECONCILED=1` | hb_proxy (advisory) | 3468 | -0.0312 | [-0.04103, -0.01882] | +1.000 | **FAIL** | not significant overall: DM (abs loss) one-sided p = 1 >= 0.05 |
| `SURF_EXPOSURE_RECONCILED=1` | hs_offshore (advisory) | 6045 | +0.0000 | [0.0, 0.0] | - | **REFUSED** | the two lanes give the same loss at every hour: nothing to judge |
| `SURF_TIDE_DEPTH=1` | hs_station | 3468 | +0.0000 | [0.0, 0.0] | - | **REFUSED** | the two lanes give the same loss at every hour: nothing to judge |
| `SURF_TIDE_DEPTH=1` | hb_proxy (advisory) | 3468 | +0.0000 | [0.0, 0.0] | - | **REFUSED** | the two lanes give the same loss at every hour: nothing to judge |
| `SURF_TIDE_DEPTH=1` | hs_offshore (advisory) | 6045 | +0.0000 | [0.0, 0.0] | - | **REFUSED** | the two lanes give the same loss at every hour: nothing to judge |
| `SURF_SPECTRAL_K=1` | hs_station | 3468 | +0.0132 | [-0.01191, 0.03575] | +0.147 | **FAIL** | not significant overall: DM (abs loss) one-sided p = 0.147 >= 0.05 |
| `SURF_SPECTRAL_K=1` | hb_proxy (advisory) | 3468 | -0.1353 | [-0.16875, -0.10414] | +1.000 | **FAIL** | not significant overall: DM (abs loss) one-sided p = 1 >= 0.05 |
| `SURF_SPECTRAL_K=1` | hs_offshore (advisory) | 6045 | +0.0000 | [0.0, 0.0] | - | **REFUSED** | the two lanes give the same loss at every hour: nothing to judge |
| `R5_ARM=bhc` | hs_station | 3468 | +0.1536 | [0.13421, 0.17572] | +0.000 | **PASS** | - |
| `R5_ARM=bhc` | hb_proxy (advisory) | 3468 | +0.1352 | [0.09762, 0.16876] | +0.000 | **FAIL** | band 'obs top 10% (p90)': |bias| grows by +0.119 (candidate +0.362 vs reference +0.243), over the 0.050 limit |
| `R5_ARM=bhc` | hs_offshore (advisory) | 6045 | +0.1346 | [0.11179, 0.16339] | +0.000 | **PASS** | - |
| `R5_ARM=bhc@1` | hs_station | 3468 | +0.1729 | [0.1307, 0.21285] | +0.000 | **PASS** | - |
| `R5_ARM=bhc@1` | hb_proxy (advisory) | 3468 | -0.0877 | [-0.13826, -0.04814] | +1.000 | **FAIL** | not significant overall: DM (abs loss) one-sided p = 1 >= 0.05 |
| `R5_ARM=bhc@1` | hs_offshore (advisory) | 6045 | +0.1080 | [0.07904, 0.13812] | +0.000 | **PASS** | - |
| `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1,SURF_EXPOSURE_RECONCILED=1` | hs_station | 3468 | +0.0682 | [0.04149, 0.09385] | +0.000 | **PASS** | - |
| `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1,SURF_EXPOSURE_RECONCILED=1` | hb_proxy (advisory) | 3468 | -0.0470 | [-0.09202, -0.0062] | +0.980 | **FAIL** | not significant overall: DM (abs loss) one-sided p = 0.98 >= 0.05 |
| `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1,SURF_EXPOSURE_RECONCILED=1` | hs_offshore (advisory) | 6045 | +0.1346 | [0.11179, 0.16339] | +0.000 | **PASS** | - |
| `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1` | hs_station | 3468 | +0.0841 | [0.05395, 0.11268] | +0.000 | **PASS** | - |
| `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1` | hb_proxy (advisory) | 3468 | -0.0433 | [-0.08934, -0.00128] | +0.965 | **FAIL** | not significant overall: DM (abs loss) one-sided p = 0.965 >= 0.05 |
| `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1` | hs_offshore (advisory) | 6045 | +0.1346 | [0.11179, 0.16339] | +0.000 | **PASS** | - |
- `SURF_EXPOSURE_RECONCILED=1` changes served outputs on 14103 heights / 586 levels of 15456 replayed spot-hours (mean |score change| +0.600); flag reads: {}
- `SURF_TIDE_DEPTH=1` changes served outputs on 0 heights / 0 levels of 15456 replayed spot-hours (mean |score change| +0.000); flag reads: {'tide_replayed': 15456}
- `SURF_SPECTRAL_K=1` changes served outputs on 5611 heights / 1442 levels of 15456 replayed spot-hours (mean |score change| +1.843); flag reads: {}
- `R5_ARM=bhc` changes served outputs on 11758 heights / 3309 levels of 15456 replayed spot-hours (mean |score change| +4.228); flag reads: {}
- `R5_ARM=bhc@1` changes served outputs on 11759 heights / 3525 levels of 15456 replayed spot-hours (mean |score change| +4.856); flag reads: {}
- `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1,SURF_EXPOSURE_RECONCILED=1` changes served outputs on 15374 heights / 3186 levels of 15456 replayed spot-hours (mean |score change| +4.050); flag reads: {'tide_replayed': 15456}
- `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1` changes served outputs on 12419 heights / 3286 levels of 15456 replayed spot-hours (mean |score change| +4.129); flag reads: {'tide_replayed': 15456}

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
