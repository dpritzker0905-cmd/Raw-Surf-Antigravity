# Pre-registration: SURF_EXPOSURE_RECONCILED rework, partition-wise exposure scored after BHC (2026-11-04)

Written and committed BEFORE any score of these variants exists. Author: claude, branch
`claude/rework-exposure-partitioned` (dev df713415). The owner approved scoring on GitHub Actions ("Yes", 2026-11-04).

## Why a rework

Round 7: `SURF_EXPOSURE_RECONCILED=1` (height factor `sqrt(exposure)` instead of `0.55 + 0.45 x exposure`)
hs_station -0.024 m [two-way -0.039, -0.006], worse in every season and region; D-065's filter: MAE +0.0093 m.
Diagnosis: `sqrt(x) <= 0.55 + 0.45 x` for every x in [0.1, 1] (equal only head-on), so the reconciled curve can only
LOWER heights, and it was applied to a chain already biased low (hs_station bias -0.347 m served, -0.205 m with
the Bight Hs consensus, BHC). It also reads ONE bulk direction (GFS DIRPW, the peak direction) for a sea that often
holds a head-on swell and an off-axis wind sea at once.

## The variants (two candidates + one reference, all on top of BHC; no tuning)

For each anchor row, with the station's shore normal `sn` (the instrument's own geometry), the GFS partitions at the
anchor spot (`swell_1`, `swell_2`, `wind_waves`: SWELL/SWPER/SWDIR 1-2, WVHGT/WVPER/WVDIR from the same GFS-Wave file,
sampled by the production `PointSampler`), passed through the production gate `surf_partitions.partitions_represent`
and `reconcile_partitions` to the total; energy weights `w_i = h_i^2 / sum h^2`; per-train exposure
`x_i = clamp(0.10 + 0.90 max(0, cos(dir_i - sn)), 0, 1)` (the served formula):

- **E1 partition-wise reconciled (primary candidate):** height factor `sqrt(sum_i w_i x_i)` (energy-weighted
  exposure, height = sqrt of energy, the reconciliation's own rule).
- **E2 partition-wise, served curve (secondary candidate):** height factor `sqrt(sum_i w_i (0.55 + 0.45 x_i)^2)`:
  isolates the partition split from the curve change.
- **R bulk reconciled after BHC (reference, not a candidate):** `sqrt(x_bulk)`: round 7's failing flag, re-scored on
  top of BHC so the rework is compared with the original on the same baseline.

Rows where the partitions do not represent the sea (the production gate refuses) keep the served factor: the
candidate equals the baseline there. Rows without a shore normal keep it too (the served fail-open).

**The instrument.** `nearshore_validation.model_hs_at_station` is linear in the exposure factor, so a candidate's
hs_station = the served-plus-BHC hs_station x f_cand / f_served, exactly (`f_served` recomputed from the same row's
bulk direction; the run asserts it reproduces the replayed value). hb_proxy (advisory) uses the same ratio on the
surf height, which is exact unless the depth cap binds (counted and reported).

**BHC.** Every arm, the baseline included, is replayed on the BHC-composed marine field: `bight_hs_consensus.compose`
on each GFS crop with the EURO WAM `swh` of ECMWF open data (AWS `ecmwf-forecasts`, 0.25 deg, `wave` stream) of the
same cycle and step; 06/18 Z cycles take the previous 00/12 Z run at step + 6 (round 7's rule, the latest-run pick).
Outside the polygon BHC is the identity.

## Scoring (binding)

- Stations: `backend/scripts/eval_harness_stations_ca.json` (8 CA CDIP nearshore + 2 NDBC); leads 24/48/72; 6-hourly
  targets; GFS-Wave + pgrb2 wind (AWS archive), pygrib.
- Windows: **W1** 2024-12-01..12-28, **W4** 2025-10-01..10-28, **W26** 2026-10-17..10-30.
- Gate: `backend/scripts/rework_gate.py` on hs_station (primary): pooled D-066 two-way block x day CI, >= 14 UTC
  days; PASS = lower bound > 0 AND no season or region stratum worse after Holm AND survives Holm across E1, E2.
  Advisory: hb_proxy, station-cluster CI. Controls: null REFUSED, x0.8 PASS, x1.25 FAIL, else INVALID.

## Expectation, stated before scoring

E1 lowers heights at every off-axis train, like the original, so with the chain still ~0.2 m low after BHC a FAIL is
the expected outcome; E2 can raise or lower (a head-on swell under an off-axis bulk direction is raised). Both are
scored as pre-registered whatever the expectation.

## Outcomes, decided now

- A candidate PASSES: it is built as a served flag default ON with a `'0'` kill switch (partitions are resolved at
  serving cost; the PR states that cost), GUARDED, SCOREBOARD row, DECISIONS entry, log, ledger fragment.
- Both FAIL: the PR is docs + the scoring tools only; `SURF_EXPOSURE_RECONCILED` stays OFF; the result and diagnosis
  are recorded.
