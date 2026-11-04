# Evaluation harness scorecard (104 targets 2026-10-06T00Z..2026-10-31T18Z)

Code 25c832896cd7; served env from `.github/workflows/precompute.yml` sha256 2599b8861a62; primary `hs_station`; controls True; input parity {'decoders': ['eccodes'], 'wind_sources': ['pgrb2'], 'backend_versions': ['eccodes-python 2.50.0, ecCodes 2.50.0'], 'production_parity': True}.

> **TOP-PRIORITY ALARM: served hs_station LOSES to out-of-sample climatology at lead 24 h (days 0-3): gain -0.0567 m, CI [-0.0950, -0.0057]** (does not block an improving candidate)
> **TOP-PRIORITY ALARM: served hs_station LOSES to out-of-sample climatology at lead 72 h (days 0-3): gain -0.0603 m, CI [-0.1010, -0.0041]** (does not block an improving candidate)

## Climatology ratchet: hs_station (out-of-sample climatology, embargo from ['2026-10-03T00:00Z', 'open'])

| lead h | class | served vs clim gain | 95% CI | n | locked | would lock |
|---|---|---|---|---|---|---|
| 24 | short | -0.0567 | [-0.095, -0.0057] | 1039 | no | no |
| 48 | short | -0.0516 | [-0.0928, 0.0034] | 1039 | no | no |
| 72 | short | -0.0603 | [-0.101, -0.0041] | 1039 | no | no |

## Climatology ratchet: hb_proxy (out-of-sample climatology, embargo from ['2026-10-03T00:00Z', 'open'])

| lead h | class | served vs clim gain | 95% CI | n | locked | would lock |
|---|---|---|---|---|---|---|
| 24 | short | +0.0784 | [0.0195, 0.1758] | 1039 | no | yes |
| 48 | short | +0.0861 | [0.0234, 0.1895] | 1039 | no | yes |
| 72 | short | +0.0766 | [0.0139, 0.1755] | 1039 | no | yes |

## Climatology ratchet: hs_offshore (out-of-sample climatology, embargo from ['2026-10-03T00:00Z', 'open'])

| lead h | class | served vs clim gain | 95% CI | n | locked | would lock |
|---|---|---|---|---|---|---|
| 24 | short | +0.0695 | [0.0009, 0.1475] | 1883 | no | yes |
| 48 | short | +0.0726 | [0.0057, 0.153] | 1883 | no | yes |
| 72 | short | +0.0529 | [-0.0144, 0.1319] | 1883 | no | no |

## hs_station (CDIP Hs (waveFlagPrimary == 1))

| arm | n | bias | MAE (=CRPS) | RMSE | SI | HH | twCRPS>p90 | top-decile bias |
|---|---|---|---|---|---|---|---|---|
| persistence | 3117 | -0.017 | +0.271 | +0.357 | +0.338 | +0.329 | +0.038 | -0.452 |
| climatology | 3117 | -0.117 | +0.266 | +0.353 | +0.316 | +0.350 | +0.023 | -0.739 |
| served | 3117 | -0.315 | +0.322 | +0.390 | +0.219 | +0.419 | +0.020 | -0.544 |
- served vs persistence: gain -0.0513 m, CI [-0.08633, -0.00601], n 3117, 104 h, DM p +0.992
- served vs climatology: gain -0.0562 m, CI [-0.09583, -0.00246], n 3117, 104 h, DM p +0.990
- controls (pass): null_identical REFUSED gain +0.0000 CI [0.0, 0.0] -> ok; null_swap FAIL gain -0.0060 CI [-0.02828, 0.02333] -> ok; positive PASS gain +0.0644 CI [0.05663, 0.07324] -> ok; negative FAIL gain -0.0805 CI [-0.09155, -0.07079] -> ok

## hb_proxy (Komar-Gaughan 1972 on deshoaled CDIP Hs/Tp (PROXY))

| arm | n | bias | MAE (=CRPS) | RMSE | SI | HH | twCRPS>p90 | top-decile bias |
|---|---|---|---|---|---|---|---|---|
| persistence | 3117 | -0.029 | +0.364 | +0.467 | +0.257 | +0.253 | +0.042 | -0.557 |
| climatology | 3117 | -0.227 | +0.385 | +0.505 | +0.248 | +0.294 | +0.026 | -1.020 |
| served | 3117 | -0.190 | +0.305 | +0.413 | +0.202 | +0.232 | +0.028 | -0.357 |
- served vs persistence: gain +0.0598 m, CI [0.01856, 0.10723], n 3117, 104 h, DM p +0.006
- served vs climatology: gain +0.0803 m, CI [0.01884, 0.17517], n 3117, 104 h, DM p +0.035
- controls (pass): null_identical REFUSED gain +0.0000 CI [0.0, 0.0] -> ok; null_swap FAIL gain +0.0190 CI [-0.00936, 0.05062] -> ok; positive PASS gain +0.0609 CI [0.05492, 0.06825] -> ok; negative FAIL gain -0.0762 CI [-0.08531, -0.06864] -> ok

## hs_offshore (NDBC WVHT (realtime2))

| arm | n | bias | MAE (=CRPS) | RMSE | SI | HH | twCRPS>p90 | top-decile bias |
|---|---|---|---|---|---|---|---|---|
| persistence | 5566 | -0.024 | +0.419 | +0.578 | +0.387 | +0.371 | +0.092 | -0.610 |
| climatology | 5649 | -0.087 | +0.372 | +0.500 | +0.330 | +0.326 | +0.063 | -0.616 |
| served | 5649 | -0.281 | +0.306 | +0.370 | +0.161 | +0.251 | +0.030 | -0.394 |
- served vs persistence: gain +0.1119 m, CI [0.06569, 0.1714], n 5566, 104 h, DM p +0.000
- served vs climatology: gain +0.0650 m, CI [-0.0015, 0.14403], n 5649, 104 h, DM p +0.043
- controls (pass): null_identical REFUSED gain +0.0000 CI [0.0, 0.0] -> ok; null_swap FAIL gain +0.0098 CI [-0.01659, 0.03493] -> ok; positive PASS gain +0.0612 CI [0.05249, 0.07098] -> ok; negative FAIL gain -0.0764 CI [-0.08873, -0.06561] -> ok

## Candidate arms

| arm | quantity | n | gain (m) | 95% CI | DM p | verdict | first reason |
|---|---|---|---|---|---|---|---|
| `SURF_EXPOSURE_RECONCILED=1` | hs_station | 3117 | -0.0277 | [-0.03359, -0.02313] | +1.000 | **FAIL** | not significant overall: DM (abs loss) one-sided p = 1 >= 0.05 |
| `SURF_EXPOSURE_RECONCILED=1` | hb_proxy (advisory) | 3117 | -0.0654 | [-0.07603, -0.05238] | +1.000 | **FAIL** | not significant overall: DM (abs loss) one-sided p = 1 >= 0.05 |
| `SURF_EXPOSURE_RECONCILED=1` | hs_offshore (advisory) | 5649 | +0.0000 | [0.0, 0.0] | - | **REFUSED** | the two lanes give the same loss at every hour: nothing to judge |
| `SURF_TIDE_DEPTH=1` | hs_station | 3117 | +0.0000 | [0.0, 0.0] | - | **REFUSED** | the two lanes give the same loss at every hour: nothing to judge |
| `SURF_TIDE_DEPTH=1` | hb_proxy (advisory) | 3117 | +0.0000 | [0.0, 0.0] | - | **REFUSED** | the two lanes give the same loss at every hour: nothing to judge |
| `SURF_TIDE_DEPTH=1` | hs_offshore (advisory) | 5649 | +0.0000 | [0.0, 0.0] | - | **REFUSED** | the two lanes give the same loss at every hour: nothing to judge |
| `SURF_SPECTRAL_K=1` | hs_station | 3117 | +0.0152 | [-0.00356, 0.03124] | +0.051 | **FAIL** | not significant overall: DM (abs loss) one-sided p = 0.0512 >= 0.05 |
| `SURF_SPECTRAL_K=1` | hb_proxy (advisory) | 3117 | -0.1383 | [-0.17265, -0.10719] | +1.000 | **FAIL** | not significant overall: DM (abs loss) one-sided p = 1 >= 0.05 |
| `SURF_SPECTRAL_K=1` | hs_offshore (advisory) | 5649 | +0.0000 | [0.0, 0.0] | - | **REFUSED** | the two lanes give the same loss at every hour: nothing to judge |
| `R5_ARM=bhc` | hs_station | 3117 | +0.1019 | [0.08392, 0.12081] | +0.000 | **PASS** | - |
| `R5_ARM=bhc` | hb_proxy (advisory) | 3117 | +0.0589 | [0.02928, 0.08504] | +0.000 | **FAIL** | the station-cluster bootstrap CI of the gain [-0.01737884394221008, 0.14718781278546472] includes 0 (10 statio |
| `R5_ARM=bhc` | hs_offshore (advisory) | 5649 | +0.0915 | [0.07465, 0.10854] | +0.000 | **PASS** | - |
| `R5_ARM=bhc@1` | hs_station | 3117 | +0.1325 | [0.10278, 0.16217] | +0.000 | **PASS** | - |
| `R5_ARM=bhc@1` | hb_proxy (advisory) | 3117 | -0.0413 | [-0.09097, 0.00172] | +0.952 | **FAIL** | not significant overall: DM (abs loss) one-sided p = 0.952 >= 0.05 |
| `R5_ARM=bhc@1` | hs_offshore (advisory) | 5649 | +0.0962 | [0.06136, 0.12911] | +0.000 | **PASS** | - |
| `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1,SURF_EXPOSURE_RECONCILED=1` | hs_station | 3117 | +0.0513 | [0.02928, 0.07095] | +0.000 | **FAIL** | the station-cluster bootstrap CI of the gain [-0.0009723030734680768, 0.10522019037179488] includes 0 (10 stat |
| `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1,SURF_EXPOSURE_RECONCILED=1` | hb_proxy (advisory) | 3117 | -0.0867 | [-0.12907, -0.04932] | +1.000 | **FAIL** | not significant overall: DM (abs loss) one-sided p = 1 >= 0.05 |
| `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1,SURF_EXPOSURE_RECONCILED=1` | hs_offshore (advisory) | 5649 | +0.0915 | [0.07465, 0.10854] | +0.000 | **PASS** | - |
| `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1` | hs_station | 3117 | +0.0582 | [0.03568, 0.07812] | +0.000 | **PASS** | - |
| `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1` | hb_proxy (advisory) | 3117 | -0.0854 | [-0.12828, -0.04667] | +1.000 | **FAIL** | not significant overall: DM (abs loss) one-sided p = 1 >= 0.05 |
| `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1` | hs_offshore (advisory) | 5649 | +0.0915 | [0.07465, 0.10854] | +0.000 | **PASS** | - |
- `SURF_EXPOSURE_RECONCILED=1` changes served outputs on 13465 heights / 222 levels of 14352 replayed spot-hours (mean |score change| +0.388); flag reads: {}
- `SURF_TIDE_DEPTH=1` changes served outputs on 0 heights / 0 levels of 14352 replayed spot-hours (mean |score change| +0.000); flag reads: {'tide_replayed': 14352}
- `SURF_SPECTRAL_K=1` changes served outputs on 4784 heights / 599 levels of 14352 replayed spot-hours (mean |score change| +1.071); flag reads: {}
- `R5_ARM=bhc` changes served outputs on 10914 heights / 706 levels of 14352 replayed spot-hours (mean |score change| +0.869); flag reads: {}
- `R5_ARM=bhc@1` changes served outputs on 10917 heights / 725 levels of 14352 replayed spot-hours (mean |score change| +0.919); flag reads: {}
- `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1,SURF_EXPOSURE_RECONCILED=1` changes served outputs on 14179 heights / 841 levels of 14352 replayed spot-hours (mean |score change| +1.340); flag reads: {'tide_replayed': 14352}
- `R5_ARM=bhc,SURF_SPECTRAL_K=1,SURF_TIDE_DEPTH=1` changes served outputs on 11498 heights / 835 levels of 14352 replayed spot-hours (mean |score change| +1.323); flag reads: {'tide_replayed': 14352}

## Named gaps (offline-unreachable inputs; never stubbed silently)

- `size_reference`: RATING_LOCAL_SIZE=1 grades against a per-spot size climatology in storage; replay passes None (the global 1.2 m curve). Scores differ from served where a spot has a climatology; heights do not. (spot-hours: 14352)
- `obs_gate`: RATING_OBS_GATE=1 caps model-only good/epic at 69.9 unless >= 2 models agree or a report confirms; applied after rating in the precompute merge. Replay scores are PRE-gate. (spot-hours: 14352)
- `best_tide`: the spot's best_tide prior (DB) is unknown, so tide_fit is neutral even with a tide state. (spot-hours: 14352)
- `primary_swell`: the display-only swell_1 field is not replayed (no score or height effect). (spot-hours: 14352)
- `tide_missing`: spot-hours where no tide series was available (tide_norm None, eta 0). (spot-hours: 0)
- `tide_replayed`: spot-hours that read the served tide source (Open-Meteo sea_level_height_msl) by date through the production tide_state_at (not a gap: counted for linkage). (spot-hours: 14352)
- substitution `grid`: served /point samples the stored normalized product (regional tiles / coarse globals); the replay runs the same PointSampler on a native 0.25 deg GFS-Wave crop.
- substitution `wind_gfswave`: only with the built-in decoder (no pygrib, no eccodes) is the rating wind the GFS-Wave file's UGRD/VGRD (the GFS 10 m forcing on the same grid) instead of the atmosphere file's pgrb2.0p25 UGRD/VGRD 10 m; rows say which (input_parity.wind_sources).
- substitution `repo_variables`: workflow `${{ vars.X || 'd' }}` values resolve to their defaults d (repository variables are not readable offline); listed in served_env.repo_variables_defaulted.
- substitution `tide_series`: served fetches forecast_days=3 at run time; replay fetches the same Open-Meteo series by start/end date (a deterministic tide).
