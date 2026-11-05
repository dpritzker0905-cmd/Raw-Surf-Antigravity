# Scorecard: SURF_EXPOSURE_RECONCILED rework, partition-wise exposure after BHC (2026-11-05) - FAIL

Source: GitHub Actions run 41939262446 (`rework-score.yml`, head 54e546db7), gate job 127000046568 (the full JSON is
in its log between GATE_JSON_BEGIN / GATE_JSON_END; artifact `rework-gate` id 13382570047, 30-day retention).
Pre-registration: `exposure-partitioned-preregistration.md` (commit 9e9aadc06, before any score).
Windows W1 2024-12-01..28, W4 2025-10-01..28, W26 2026-10-17..30; `eval_harness_stations_ca.json`; leads 24/48/72;
production parity (pygrib + pgrb2). Every arm, the baseline included, on the BHC-composed marine field.

| arm | quantity | n | days | blocks | gain m | two-way 95% CI | bias ref -> cand | Holm worse | verdict |
|---|---|---|---|---|---|---|---|---|---|
| E1 sqrt(sum w x) (candidate) | **hs_station** | 5,484 | 70 | 4 | -0.016 | [-0.048, 0.015] | -0.156 -> -0.187 | - | **FAIL** |
| E2 sqrt(sum w (0.55+0.45x)^2) (candidate) | **hs_station** | 5,484 | 70 | 4 | -0.003 | [-0.027, 0.022] | -0.156 -> -0.164 | - | **FAIL** |
| R sqrt(x_bulk) (reference: round 7's flag after BHC) | hs_station | 5,484 | 70 | 4 | -0.023 | [-0.044, -0.001] | -0.156 -> -0.186 | Bight, W1, W4 | FAIL |
| E1 | hb_proxy (advisory) | 5,484 | 70 | 4 | -0.001 | [-0.054, 0.053] | +0.059 -> -0.006 | - | FAIL |
| E2 | hb_proxy (advisory) | 5,484 | 70 | 4 | +0.000 | [-0.026, 0.027] | +0.059 -> +0.045 | - | FAIL |
| R | hb_proxy (advisory) | 5,484 | 70 | 4 | -0.032 | [-0.066, 0.002] | +0.059 -> -0.009 | Bight, W4 | FAIL |

Controls (served-plus-BHC pairs): hs_station and hb_proxy both ok (null REFUSED, x0.8 PASS, x1.25 FAIL).
Neither candidate survives Holm across arms (p_better 0.85 / 0.60).

Per station, hs_station gain (E1 / E2 / R): 103p1 -0.039 / -0.021 / -0.012; 142p1 -0.065 / -0.041 / -0.013;
153p1 -0.012 / -0.006 / -0.005; 201p1 +0.011 / +0.048 / -0.114; 262p1 -0.010 / -0.004 / -0.006;
264p1 -0.019 / -0.009 / -0.007; 284p1 -0.017 / -0.009 / -0.004; 285p1 (Avila) +0.098 / +0.036 / +0.048.
