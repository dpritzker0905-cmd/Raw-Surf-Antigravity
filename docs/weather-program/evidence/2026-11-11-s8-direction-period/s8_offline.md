# S8/S7 v2 offline first reading

window graded: 2026-10-19T22:00:00+00:00 .. +21 d; members GFS, EURO, ICON

## lead 24 h -- direction (n=14523 paired keys; consensus beats best: True)
| candidate | MAE deg | circ bias deg | RMS | p90 |
|---|---|---|---|---|
| GFS | 25.21 | 1.35 | 41.94 | 76.0 |
| EURO | 22.98 | 2.13 | 32.97 | 52.0 |
| ICON | 27.33 | -2.04 | 37.89 | 58.0 |
| consensus | 22.29 | 1.15 | 31.74 | 49.04 |
| persistence | 22.48 | -1.01 | 38.22 | 64.0 |
| climatology | 26.83 | -3.33 | 40.01 | 65.15 |

| coast | n | GFS | EURO | ICON | consensus | persistence | climatology |
|---|---|---|---|---|---|---|---|
| atlantic_ne | 2918 | 23.44 / -0.13 | 22.34 / -4.42 | 27.34 / -10.28 | 22.82 / -4.2 | 35.65 / -2.97 | 41.92 / -6.22 |
| atlantic_se | 2943 | 11.62 / 0.15 | 16.86 / -10.14 | 20.0 / -9.6 | 14.8 / -6.57 | 12.69 / -1.06 | 17.52 / 6.81 |
| gulf | 436 | 20.14 / 4.62 | 21.33 / -0.76 | 28.84 / -7.13 | 22.06 / -1.08 | 23.85 / -4.45 | 50.32 / -10.38 |
| hawaii | 994 | 41.88 / -8.49 | 42.11 / 11.06 | 62.54 / 2.24 | 43.8 / 1.71 | 24.58 / 1.3 | 32.16 / 1.7 |
| pacific_ne | 7232 | 29.47 / 3.56 | 23.21 / 9.44 | 25.38 / 4.53 | 22.19 / 6.7 | 20.79 / -0.46 | 22.39 / -7.25 |

### period peak: forecast spectral PEAK period (GFS-Wave PERPW, ECMWF pp1d, GWAM peak under ICON_PEAK_PERIOD) vs NDBC DPD (n=14323; exact definition: True)
| candidate | MAE s | bias s | RMSE s |
|---|---|---|---|
| GFS | 1.566 | 0.006 | 2.51 |
| EURO | 1.391 | -0.247 | 2.209 |
| consensus | 1.389 | -0.121 | 2.158 |
| persistence | 2.014 | 0.0 | 2.985 |
| climatology | 2.267 | -0.718 | 3.01 |

| coast | n | GFS | EURO | consensus | persistence | climatology |
|---|---|---|---|---|---|---|
| atlantic_ne | 3068 | 1.468 / -0.219 | 1.519 / -0.422 | 1.45 / -0.321 | 1.92 / 0.002 | 2.646 / -1.833 |
| atlantic_se | 3387 | 1.617 / -0.505 | 1.262 / -0.193 | 1.389 / -0.349 | 1.717 / 0.014 | 2.433 / -1.836 |
| gulf | 482 | 0.682 / -0.277 | 0.671 / -0.283 | 0.654 / -0.28 | 0.861 / -0.027 | 0.962 / 0.343 |
| hawaii | 658 | 2.023 / -0.169 | 1.818 / 0.582 | 1.711 / 0.206 | 1.95 / 0.05 | 1.875 / 0.233 |
| pacific_ne | 6728 | 1.604 / 0.403 | 1.408 / -0.274 | 1.382 / 0.065 | 2.295 / -0.011 | 2.142 / 0.184 |

### period tm10: forecast energy period Tm-1,0 (GWAM tm10, ECMWF mwp) vs NDBC APD (= Tm02): NOT the same moment (n=14706; exact definition: False)
| candidate | MAE s | bias s | RMSE s |
|---|---|---|---|
| EURO | 2.232 | 2.185 | 2.66 |
| ICON | 2.23 | 2.107 | 2.701 |
| consensus | 2.204 | 2.146 | 2.618 |
| persistence | 1.051 | 0.007 | 1.504 |
| climatology | 1.233 | -0.431 | 1.652 |

| coast | n | EURO | ICON | consensus | persistence | climatology |
|---|---|---|---|---|---|---|
| atlantic_ne | 3019 | 1.3 / 1.263 | 1.452 / 1.431 | 1.359 / 1.347 | 0.752 / 0.044 | 0.967 / -0.665 |
| atlantic_se | 2941 | 1.836 / 1.72 | 1.368 / 1.2 | 1.593 / 1.46 | 0.69 / -0.013 | 1.233 / -1.175 |
| gulf | 472 | 0.352 / 0.265 | 0.432 / 0.221 | 0.362 / 0.243 | 0.371 / 0.039 | 0.479 / 0.33 |
| hawaii | 994 | 1.942 / 1.915 | 2.317 / 2.27 | 2.116 / 2.092 | 0.803 / -0.021 | 0.919 / -0.322 |
| pacific_ne | 7280 | 2.941 / 2.917 | 3.006 / 2.854 | 2.932 / 2.885 | 1.399 / 0.001 | 1.435 / -0.099 |

bootstrap (buoy clusters): `{"direction": {"best_member": "raw_surf:EURO", "persistence_minus_best": {"point": -0.499, "lo95": -3.547, "hi95": 2.21, "n_buoys": 92}, "climatology_minus_best": {"point": 3.851, "lo95": 0.157, "hi95": 7.392, "n_buoys": 92}, "consensus_minus_best": {"point": -0.69, "lo95": -2.443, "hi95": 1.139, "n_buoys": 92}}, "period_peak": {"best_member": "raw_surf:EURO", "persistence_minus_best": {"point": 0.622, "lo95": 0.494, "hi95": 0.753, "n_buoys": 93}, "climatology_minus_best": {"point": 0.875, "lo95": 0.717, "hi95": 1.036, "n_buoys": 93}, "consensus_minus_best": {"point": -0.003, "lo95": -0.051, "hi95": 0.05, "n_buoys": 93}}, "period_tm10": {"best_member": "raw_surf:ICON", "persistence_minus_best": {"point": -1.179, "lo95": -1.397, "hi95": -0.973, "n_buoys": 92}, "climatology_minus_best": {"point": -0.997, "lo95": -1.242, "hi95": -0.769, "n_buoys": 92}, "consensus_minus_best": {"point": -0.026, "lo95": -0.092, "hi95": 0.032, "n_buoys": 92}}}`

## lead 48 h -- direction (n=14399 paired keys; consensus beats best: True)
| candidate | MAE deg | circ bias deg | RMS | p90 |
|---|---|---|---|---|
| GFS | 25.34 | 0.99 | 42.04 | 76.0 |
| EURO | 23.12 | 1.87 | 33.16 | 52.0 |
| ICON | 27.63 | -3.44 | 38.15 | 57.0 |
| consensus | 22.43 | 0.47 | 31.87 | 49.08 |
| persistence | 27.68 | -1.86 | 43.88 | 77.0 |
| climatology | 26.85 | -3.18 | 40.07 | 65.11 |

| coast | n | GFS | EURO | ICON | consensus | persistence | climatology |
|---|---|---|---|---|---|---|---|
| atlantic_ne | 2898 | 23.48 / -0.04 | 22.62 / -4.86 | 28.02 / -11.57 | 23.12 / -4.89 | 44.27 / -4.42 | 41.99 / -5.74 |
| atlantic_se | 2923 | 11.56 / 0.43 | 17.12 / -10.6 | 20.86 / -10.77 | 15.08 / -7.03 | 15.92 / -2.48 | 17.55 / 6.95 |
| gulf | 423 | 20.84 / 4.36 | 22.39 / -2.21 | 30.29 / -9.14 | 23.19 / -2.23 | 30.76 / -5.9 | 50.03 / -9.38 |
| hawaii | 994 | 41.7 / -9.68 | 42.08 / 11.52 | 62.26 / 3.27 | 43.63 / 2.55 | 32.11 / 2.62 | 32.19 / 1.66 |
| pacific_ne | 7161 | 29.72 / 2.81 | 23.18 / 9.34 | 25.27 / 2.85 | 22.16 / 5.82 | 24.97 / -1.18 | 22.4 / -7.22 |

### period peak: forecast spectral PEAK period (GFS-Wave PERPW, ECMWF pp1d, GWAM peak under ICON_PEAK_PERIOD) vs NDBC DPD (n=14213; exact definition: True)
| candidate | MAE s | bias s | RMSE s |
|---|---|---|---|
| GFS | 1.589 | 0.096 | 2.533 |
| EURO | 1.414 | -0.226 | 2.224 |
| consensus | 1.409 | -0.065 | 2.166 |
| persistence | 2.38 | -0.008 | 3.354 |
| climatology | 2.278 | -0.725 | 3.013 |

| coast | n | GFS | EURO | consensus | persistence | climatology |
|---|---|---|---|---|---|---|
| atlantic_ne | 3048 | 1.45 / -0.136 | 1.567 / -0.376 | 1.458 / -0.256 | 2.303 / 0.032 | 2.648 / -1.831 |
| atlantic_se | 3372 | 1.598 / -0.426 | 1.272 / -0.197 | 1.39 / -0.312 | 2.139 / -0.012 | 2.42 / -1.818 |
| gulf | 467 | 0.679 / -0.228 | 0.701 / -0.262 | 0.668 / -0.245 | 1.017 / 0.075 | 0.949 / 0.34 |
| hawaii | 658 | 2.083 / -0.293 | 1.845 / 0.52 | 1.759 / 0.113 | 2.467 / -0.008 | 1.886 / 0.23 |
| pacific_ne | 6668 | 1.663 / 0.527 | 1.423 / -0.242 | 1.414 / 0.143 | 2.624 / -0.031 | 2.168 / 0.165 |

### period tm10: forecast energy period Tm-1,0 (GWAM tm10, ECMWF mwp) vs NDBC APD (= Tm02): NOT the same moment (n=14604; exact definition: False)
| candidate | MAE s | bias s | RMSE s |
|---|---|---|---|
| EURO | 2.253 | 2.205 | 2.701 |
| ICON | 2.285 | 2.152 | 2.797 |
| consensus | 2.239 | 2.178 | 2.681 |
| persistence | 1.269 | 0.016 | 1.765 |
| climatology | 1.237 | -0.434 | 1.658 |

| coast | n | EURO | ICON | consensus | persistence | climatology |
|---|---|---|---|---|---|---|
| atlantic_ne | 3006 | 1.321 / 1.28 | 1.422 / 1.384 | 1.349 / 1.332 | 0.976 / 0.057 | 0.972 / -0.673 |
| atlantic_se | 2921 | 1.81 / 1.694 | 1.308 / 1.122 | 1.545 / 1.408 | 0.835 / -0.034 | 1.234 / -1.175 |
| gulf | 468 | 0.371 / 0.283 | 0.439 / 0.214 | 0.37 / 0.249 | 0.484 / 0.076 | 0.472 / 0.326 |
| hawaii | 994 | 1.938 / 1.914 | 2.351 / 2.306 | 2.131 / 2.11 | 1.051 / -0.05 | 0.92 / -0.325 |
| pacific_ne | 7215 | 2.986 / 2.961 | 3.15 / 2.994 | 3.026 / 2.977 | 1.648 / 0.024 | 1.443 / -0.099 |

bootstrap (buoy clusters): `{"direction": {"best_member": "raw_surf:EURO", "persistence_minus_best": {"point": 4.575, "lo95": 1.067, "hi95": 7.911, "n_buoys": 91}, "climatology_minus_best": {"point": 3.73, "lo95": 0.005, "hi95": 7.252, "n_buoys": 91}, "consensus_minus_best": {"point": -0.688, "lo95": -2.358, "hi95": 1.088, "n_buoys": 91}}, "period_peak": {"best_member": "raw_surf:EURO", "persistence_minus_best": {"point": 0.967, "lo95": 0.829, "hi95": 1.1, "n_buoys": 92}, "climatology_minus_best": {"point": 0.865, "lo95": 0.702, "hi95": 1.021, "n_buoys": 92}, "consensus_minus_best": {"point": -0.004, "lo95": -0.054, "hi95": 0.049, "n_buoys": 92}}, "period_tm10": {"best_member": "raw_surf:EURO", "persistence_minus_best": {"point": -0.984, "lo95": -1.176, "hi95": -0.785, "n_buoys": 91}, "climatology_minus_best": {"point": -1.016, "lo95": -1.23, "hi95": -0.82, "n_buoys": 91}, "consensus_minus_best": {"point": -0.014, "lo95": -0.081, "hi95": 0.048, "n_buoys": 91}}}`

## lead 72 h -- direction (n=14385 paired keys; consensus beats best: True)
| candidate | MAE deg | circ bias deg | RMS | p90 |
|---|---|---|---|---|
| GFS | 26.22 | 0.32 | 43.16 | 79.0 |
| EURO | 23.6 | 1.45 | 33.79 | 54.0 |
| ICON | 28.5 | -4.32 | 39.32 | 59.0 |
| consensus | 23.08 | -0.18 | 32.65 | 50.46 |
| persistence | 29.98 | -3.55 | 45.73 | 82.0 |
| climatology | 26.76 | -3.13 | 39.82 | 64.98 |

| coast | n | GFS | EURO | ICON | consensus | persistence | climatology |
|---|---|---|---|---|---|---|---|
| atlantic_ne | 2901 | 26.29 / -0.78 | 23.74 / -5.82 | 30.76 / -12.61 | 24.88 / -5.74 | 44.97 / -6.31 | 41.78 / -5.72 |
| atlantic_se | 2922 | 11.71 / -0.15 | 17.6 / -11.37 | 21.99 / -11.67 | 15.69 / -7.79 | 19.5 / -3.65 | 17.57 / 6.83 |
| gulf | 428 | 23.2 / 5.74 | 24.44 / -2.34 | 32.51 / -11.39 | 25.26 / -2.59 | 36.71 / -6.69 | 48.65 / -7.84 |
| hawaii | 994 | 42.23 / -10.98 | 42.12 / 10.77 | 62.95 / 4.9 | 44.22 / 1.74 | 37.76 / 2.01 | 32.21 / 1.65 |
| pacific_ne | 7140 | 30.08 / 2.06 | 23.36 / 9.31 | 25.21 / 1.85 | 22.3 / 5.27 | 26.68 / -3.17 | 22.36 / -7.13 |

### period peak: forecast spectral PEAK period (GFS-Wave PERPW, ECMWF pp1d, GWAM peak under ICON_PEAK_PERIOD) vs NDBC DPD (n=14205; exact definition: True)
| candidate | MAE s | bias s | RMSE s |
|---|---|---|---|
| GFS | 1.65 | 0.159 | 2.613 |
| EURO | 1.472 | -0.258 | 2.31 |
| consensus | 1.466 | -0.05 | 2.233 |
| persistence | 2.544 | -0.062 | 3.549 |
| climatology | 2.282 | -0.736 | 3.026 |

| coast | n | GFS | EURO | consensus | persistence | climatology |
|---|---|---|---|---|---|---|
| atlantic_ne | 3048 | 1.593 / 0.081 | 1.646 / -0.447 | 1.567 / -0.183 | 2.535 / -0.003 | 2.654 / -1.843 |
| atlantic_se | 3373 | 1.608 / -0.478 | 1.351 / -0.334 | 1.436 / -0.406 | 2.462 / -0.15 | 2.439 / -1.846 |
| gulf | 477 | 0.689 / -0.246 | 0.714 / -0.356 | 0.671 / -0.301 | 1.105 / 0.14 | 0.953 / 0.328 |
| hawaii | 658 | 2.114 / -0.359 | 1.831 / 0.473 | 1.761 / 0.057 | 2.625 / -0.047 | 1.89 / 0.239 |
| pacific_ne | 6649 | 1.72 / 0.597 | 1.473 / -0.199 | 1.463 / 0.199 | 2.685 / -0.06 | 2.166 / 0.163 |

### period tm10: forecast energy period Tm-1,0 (GWAM tm10, ECMWF mwp) vs NDBC APD (= Tm02): NOT the same moment (n=14590; exact definition: False)
| candidate | MAE s | bias s | RMSE s |
|---|---|---|---|
| EURO | 2.227 | 2.171 | 2.691 |
| ICON | 2.267 | 2.093 | 2.79 |
| consensus | 2.205 | 2.132 | 2.658 |
| persistence | 1.38 | -0.02 | 1.881 |
| climatology | 1.236 | -0.433 | 1.656 |

| coast | n | EURO | ICON | consensus | persistence | climatology |
|---|---|---|---|---|---|---|
| atlantic_ne | 3010 | 1.282 / 1.233 | 1.408 / 1.322 | 1.316 / 1.277 | 1.043 / 0.044 | 0.973 / -0.672 |
| atlantic_se | 2921 | 1.744 / 1.617 | 1.316 / 1.085 | 1.506 / 1.351 | 0.931 / -0.123 | 1.232 / -1.175 |
| gulf | 469 | 0.387 / 0.239 | 0.462 / 0.196 | 0.38 / 0.218 | 0.549 / 0.116 | 0.466 / 0.315 |
| hawaii | 994 | 1.945 / 1.915 | 2.257 / 2.204 | 2.083 / 2.059 | 1.205 / -0.064 | 0.92 / -0.318 |
| pacific_ne | 7196 | 2.978 / 2.95 | 3.132 / 2.933 | 2.997 / 2.942 | 1.782 / -0.008 | 1.441 / -0.097 |

bootstrap (buoy clusters): `{"direction": {"best_member": "raw_surf:EURO", "persistence_minus_best": {"point": 6.382, "lo95": 2.876, "hi95": 9.65, "n_buoys": 91}, "climatology_minus_best": {"point": 3.169, "lo95": -0.545, "hi95": 6.564, "n_buoys": 91}, "consensus_minus_best": {"point": -0.516, "lo95": -2.238, "hi95": 1.282, "n_buoys": 91}}, "period_peak": {"best_member": "raw_surf:EURO", "persistence_minus_best": {"point": 1.071, "lo95": 0.939, "hi95": 1.196, "n_buoys": 92}, "climatology_minus_best": {"point": 0.81, "lo95": 0.652, "hi95": 0.965, "n_buoys": 92}, "consensus_minus_best": {"point": -0.006, "lo95": -0.058, "hi95": 0.051, "n_buoys": 92}}, "period_tm10": {"best_member": "raw_surf:EURO", "persistence_minus_best": {"point": -0.847, "lo95": -1.033, "hi95": -0.667, "n_buoys": 91}, "climatology_minus_best": {"point": -0.991, "lo95": -1.199, "hi95": -0.797, "n_buoys": 91}, "consensus_minus_best": {"point": -0.022, "lo95": -0.089, "hi95": 0.04, "n_buoys": 91}}}`

GFS archive vs NOAA AWS GRIB: `{"24": {"dir": {"n": 388, "median_abs": 0.2300000000000182, "p90_abs": 0.46000000000000796, "share_exact": 1.0}, "per": {"n": 388, "median_abs": 0.009999999999999787, "p90_abs": 0.020000000000000462, "share_exact": 1.0}}, "48": {"dir": {"n": 388, "median_abs": 0.27000000000001023, "p90_abs": 0.44999999999998863, "share_exact": 1.0}, "per": {"n": 388, "median_abs": 0.009999999999999787, "p90_abs": 0.020000000000000462, "share_exact": 1.0}}, "72": {"dir": {"n": 388, "median_abs": 0.25, "p90_abs": 0.44999999999998863, "share_exact": 1.0}, "per": {"n": 388, "median_abs": 0.009999999999999787, "p90_abs": 0.020000000000000462, "share_exact": 1.0}}}`
