# 2026-11-05 · claude · SURF_EXPOSURE_RECONCILED rework: partition-wise exposure after BHC (#730) - FAIL

Branch `claude/rework-exposure-partitioned` from dev df713415. One writer: this session. Authority: the lead's
rework brief after round 7 (#722); the owner's "Yes" (2026-11-04) to scoring on GitHub Actions. **No served number
moves in this PR** (README rule 5: no SCOREBOARD row). `SURF_EXPOSURE_RECONCILED` stays `'0'`.

## 1. Pre-registration (commit 9e9aadc06, before any score)

`flip-candidates/scorecards/rework-2026-11-04/exposure-partitioned-preregistration.md`: E1 `sqrt(sum w_i x_i)` and E2
`sqrt(sum w_i (0.55 + 0.45 x_i)^2)` over the GFS partitions at the anchor (production represent gate + reconcile),
candidates; R `sqrt(x_bulk)` (round 7's flag) as the reference; every arm and the baseline on top of BHC. It stated in
advance that E1 was expected to FAIL (the reconciled curve can only lower heights on a chain still low after BHC).

## 2. Build (tools only)

`scripts/rework_exposure_run.py`: the harness at production parity with BHC composed on every GFS crop (production
`bight_hs_consensus.compose`, EURO WAM `swh` from ECMWF open data on AWS; 06/18 Z -> previous 00/12 Z at step + 6),
partitions sampled at each anchor by the production PointSampler, candidates = served-plus-BHC hs_station x
f_cand / f_served (`model_hs_at_station` is linear in the factor; the run refuses if its recompute drifts > 1 cm).
Shared with #727 (identical files): `rework_gate.py`, `rework_window.py`, `rework_net.py`, `rework-score.yml`.
Tests: `test_rework_exposure.py` 6 (chain), `test_rework_gate.py` 5 (estate).

## 3. Result (Actions run 41939262446, head 54e546db7): FAIL

Full table: `flip-candidates/scorecards/rework-2026-11-04/exposure-partitioned-scorecard.md`.
- E1 hs_station -0.016 m [two-way -0.048, 0.015]; E2 -0.003 [-0.027, 0.022]; neither survives Holm across arms.
- R (round 7's flag, now after BHC) -0.023 [-0.044, -0.001], worse after Holm in the Bight, W1 and W4: round 7's
  failure reproduces on the BHC baseline.
- Controls ok on both quantities. BHC moved the served hs_station bias from round 7's -0.35 m to -0.16 m here.

## 4. Diagnosis

- The partition split is not where the error lives: E2 (split, served curve) is within +-0.003 m of the baseline.
  Splitting the sea by train moves heights both ways and they cancel at these stations.
- The reconciled curve is still the harm: every arm using it (E1, R) is lower and worse; it deepens a bias that is
  still negative after BHC (-0.156 -> -0.187). Its premise (height^2 = exposure, the dual floor) is not supported
  by buoy truth while the chain reads low.
- The one consistent gain is Avila (285p1: E1 +0.098), a headland-sheltered buoy where the bulk chain reads high; that
  is the case #727's sheltered-scope K addresses directly (+0.312 there), so it does not argue for this flag.
- Next (not built): revisit exposure only after the level is right everywhere (the chain's -0.16 m residual bias), and
  score the floor value itself (0.10 / 0.595) rather than the curve shape.
