# Evaluation harness scorecard (56 targets 2026-10-06T00Z..2026-10-19T18Z)

Code 24fa4431d179 (dirty); served env from `.github/workflows/precompute.yml` sha256 18197ef09f6d; primary `hs_station`; controls True; input parity {'decoders': ['eccodes'], 'wind_sources': ['pgrb2'], 'backend_versions': ['eccodes-python 2.50.0, ecCodes 2.50.0'], 'production_parity': True}.

## Climatology ratchet: hs_station (out-of-sample climatology, embargo from ['2026-10-03T00:00Z', 'open'])

| lead h | class | served vs clim gain | 95% CI | n | locked | would lock |
|---|---|---|---|---|---|---|
| 24 | short | -0.0432 | [-0.0903, 0.0129] | 559 | no | no |
| 48 | short | -0.0379 | [-0.0891, 0.0246] | 559 | no | no |
| 72 | short | -0.0489 | [-0.0989, 0.0093] | 559 | no | no |

## Climatology ratchet: hb_proxy (out-of-sample climatology, embargo from ['2026-10-03T00:00Z', 'open'])

| lead h | class | served vs clim gain | 95% CI | n | locked | would lock |
|---|---|---|---|---|---|---|
| 24 | short | +0.0587 | [-0.0381, 0.1869] | 559 | no | no |
| 48 | short | +0.0633 | [-0.0426, 0.1833] | 559 | no | no |
| 72 | short | +0.0516 | [-0.0538, 0.1741] | 559 | no | no |

## Climatology ratchet: hs_offshore (out-of-sample climatology, embargo from ['2026-10-03T00:00Z', 'open'])

| lead h | class | served vs clim gain | 95% CI | n | locked | would lock |
|---|---|---|---|---|---|---|
| 24 | short | +0.1541 | [0.0487, 0.286] | 772 | no | yes |
| 48 | short | +0.1597 | [0.0513, 0.2912] | 772 | no | yes |
| 72 | short | +0.1402 | [0.0346, 0.2713] | 772 | no | yes |

## hs_station (CDIP Hs (waveFlagPrimary == 1))

| arm | n | bias | MAE (=CRPS) | RMSE | SI | HH | twCRPS>p90 | top-decile bias |
|---|---|---|---|---|---|---|---|---|
| persistence | 1677 | -0.060 | +0.299 | +0.392 | +0.350 | +0.351 | +0.041 | -0.532 |
| climatology | 1677 | -0.196 | +0.310 | +0.404 | +0.320 | +0.395 | +0.026 | -0.861 |
| served | 1677 | -0.252 | +0.353 | +0.431 | +0.317 | +0.427 | +0.023 | -0.505 |
- served vs persistence: gain -0.0543 m, CI [-0.10252, -0.00408], n 1677, 56 h, DM p +0.977
- served vs climatology: gain -0.0433 m, CI [-0.09257, 0.01488], n 1677, 56 h, DM p +0.934
- controls (pass): null_identical REFUSED gain +0.0000 CI [0.0, 0.0] -> ok; null_swap FAIL gain -0.0164 CI [-0.04628, 0.01708] -> ok; positive PASS gain +0.0706 CI [0.05914, 0.08184] -> ok; negative FAIL gain -0.0883 CI [-0.1023, -0.07393] -> ok

## hb_proxy (Komar-Gaughan 1972 on deshoaled CDIP Hs/Tp (PROXY))

| arm | n | bias | MAE (=CRPS) | RMSE | SI | HH | twCRPS>p90 | top-decile bias |
|---|---|---|---|---|---|---|---|---|
| persistence | 1677 | -0.091 | +0.405 | +0.516 | +0.267 | +0.271 | +0.046 | -0.668 |
| climatology | 1677 | -0.336 | +0.466 | +0.584 | +0.251 | +0.334 | +0.029 | -1.147 |
| served | 1677 | -0.077 | +0.408 | +0.554 | +0.288 | +0.290 | +0.042 | -0.201 |
- served vs persistence: gain -0.0027 m, CI [-0.07682, 0.07645], n 1677, 56 h, DM p +0.525
- served vs climatology: gain +0.0579 m, CI [-0.04546, 0.17596], n 1677, 56 h, DM p +0.165
- controls (pass): null_identical REFUSED gain +0.0000 CI [0.0, 0.0] -> ok; null_swap FAIL gain +0.0124 CI [-0.02973, 0.06432] -> ok; positive PASS gain +0.0815 CI [0.07209, 0.09076] -> ok; negative FAIL gain -0.1019 CI [-0.11345, -0.09011] -> ok

## hs_offshore (NDBC WVHT (realtime2))

| arm | n | bias | MAE (=CRPS) | RMSE | SI | HH | twCRPS>p90 | top-decile bias |
|---|---|---|---|---|---|---|---|---|
| persistence | 2280 | -0.082 | +0.509 | +0.690 | +0.412 | +0.403 | +0.110 | -0.896 |
| climatology | 2316 | -0.112 | +0.452 | +0.597 | +0.353 | +0.354 | +0.067 | -1.044 |
| served | 2316 | -0.263 | +0.300 | +0.365 | +0.152 | +0.218 | +0.032 | -0.405 |
- served vs persistence: gain +0.2066 m, CI [0.14116, 0.2909], n 2280, 56 h, DM p +0.000
- served vs climatology: gain +0.1513 m, CI [0.04496, 0.2817], n 2316, 56 h, DM p +0.009
- controls (pass): null_identical REFUSED gain +0.0000 CI [0.0, 0.0] -> ok; null_swap FAIL gain +0.0365 CI [-0.01958, 0.08562] -> ok; positive PASS gain +0.0599 CI [0.04813, 0.07312] -> ok; negative FAIL gain -0.0749 CI [-0.0914, -0.06016] -> ok

## Candidate arms

| arm | quantity | n | gain (m) | 95% CI | DM p | verdict | first reason |
|---|---|---|---|---|---|---|---|
| `R5_ARM=bhc` | hs_station | 1677 | +0.0988 | [0.07233, 0.12905] | +0.000 | **PASS** | - |
| `R5_ARM=bhc` | hb_proxy (advisory) | 1677 | +0.0646 | [0.02931, 0.09724] | +0.000 | **FAIL** | the station-cluster bootstrap CI of the gain [-0.01358803827769648, 0.16347228868467978] includes 0 (10 statio |
| `R5_ARM=bhc` | hs_offshore (advisory) | 2316 | +0.0698 | [0.05316, 0.08459] | +0.000 | **PASS** | - |
- `R5_ARM=bhc` changes served outputs on 4197 heights / 242 levels of 6048 replayed spot-hours (mean |score change| +0.715); flag reads: {}

## Named gaps (offline-unreachable inputs; never stubbed silently)

- `size_reference`: RATING_LOCAL_SIZE=1 grades against a per-spot size climatology in storage; replay passes None (the global 1.2 m curve). Scores differ from served where a spot has a climatology; heights do not. (spot-hours: 6048)
- `obs_gate`: RATING_OBS_GATE=1 caps model-only good/epic at 69.9 unless >= 2 models agree or a report confirms; applied after rating in the precompute merge. Replay scores are PRE-gate. (spot-hours: 6048)
- `best_tide`: the spot's best_tide prior (DB) is unknown, so tide_fit is neutral even with a tide state. (spot-hours: 6048)
- `primary_swell`: the display-only swell_1 field is not replayed (no score or height effect). (spot-hours: 6048)
- `tide_missing`: spot-hours where no tide series was available (tide_norm None, eta 0). (spot-hours: 0)
- `tide_replayed`: spot-hours that read the served tide source (Open-Meteo sea_level_height_msl) by date through the production tide_state_at (not a gap: counted for linkage). (spot-hours: 6048)
- substitution `grid`: served /point samples the stored normalized product (regional tiles / coarse globals); the replay runs the same PointSampler on a native 0.25 deg GFS-Wave crop.
- substitution `wind_gfswave`: only with the built-in decoder (no pygrib, no eccodes) is the rating wind the GFS-Wave file's UGRD/VGRD (the GFS 10 m forcing on the same grid) instead of the atmosphere file's pgrb2.0p25 UGRD/VGRD 10 m; rows say which (input_parity.wind_sources).
- substitution `repo_variables`: workflow `${{ vars.X || 'd' }}` values resolve to their defaults d (repository variables are not readable offline); listed in served_env.repo_variables_defaulted.
- substitution `tide_series`: served fetches forecast_days=3 at run time; replay fetches the same Open-Meteo series by start/end date (a deterministic tide).
