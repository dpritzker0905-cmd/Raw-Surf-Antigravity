# Scorecard: RATING_WIND_HRRR rework, nearest HRRR sea cell — FAIL

Pre-registration: `rating-wind-hrrr-sea-preregistration.md` (this folder, commit 4923754b, before any scoring).
Run: GitHub Actions `rework-score-hrrr.yml`, PR #728, run 41938532670 (the gate job prints the full JSON between
`GATE_JSON_BEGIN` / `GATE_JSON_END`). Log: `docs/weather-program/log/2026-11-05-claude-rework-rating-wind-hrrr-sea.md`.

| arm | n | days | blocks | gain (rating pts) | two-way 95% CI | worse after Holm | verdict |
|---|---|---|---|---|---|---|---|
| A1 sea_nearest | 8,347 | 70 | 6 | -0.02 | [-0.78, +0.74] | none | FAIL |
| A2 sea_bilinear | 8,347 | 70 | 6 | -0.13 | [-1.12, +0.85] | none | FAIL |
| lane (#711, reference) | 8,347 | 70 | 6 | +0.32 | [-0.59, +1.23] | none | FAIL (reference) |

Per season, A1: W1 +0.76 [-0.89, 2.40], W4 -0.50 [-1.87, 0.87], W26 -0.24 [-1.24, 0.76]. Per region, A1: east
-0.56 [-1.14, 0.03], gulf +0.81 [0.29, 1.33], west +0.77 [-0.45, 2.00].

Controls: x0.8 PASS [0.93, 2.48], x1.25 FAIL [-3.11, -1.16]. The null read FAIL [0, 0] in the first run because of a
scorer rounding bug (null built as truth + 1.0 x (gfs - truth)); fixed to cand = gfs bit for bit as pre-registered and
re-run on the cached inputs (see PR #728's comment for that run). The arms do not depend on the controls.

Verdict: RATING_WIND_HRRR stays '0'. No served number moves.
