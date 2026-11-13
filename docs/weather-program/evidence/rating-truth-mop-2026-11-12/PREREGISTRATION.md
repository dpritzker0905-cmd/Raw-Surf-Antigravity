# Pre-registration: MOP rating-truth check for #771 (JAC-2, `RATING_REF_PRIOR`), gate 2

Written 2026-11-12 ~23:10Z, committed before any spot-hour was scored. The MOP series were downloaded (fetch only) and
the instrument's unit tests ran on synthetic data; no category agreement on real data had been computed.
Owner decision being served: 2026-11-12 17:06 EST, #771 waits for this check.

## Question

#771 changes only the size yardstick for a spot with no size climatology: OFF = the legacy absolute curve, ON = the
catalogue reference prior (1.142 m). At CDIP MOP points, which yardstick puts reference-less spot-hours in the size
category that measured nearshore water says they are in?

## Instrument

`backend/scripts/rating_truth_mop.py` (I/O) and `backend/scripts/rating_truth_mop_core.py` (pure, tested in
`backend/tests/test_rating_truth_mop.py`). Offline. The only network is CDIP's public THREDDS server. The app backend is
never called.

- **Spots:** the 19 California spots and MOP v1.1 alongshore points vetted in
  `docs/research/FINDING-2026-11-11-jac1-mop-refutes-the-landward-taper.md`. Regions (4): `north_central` (Ocean Beach
  SF, Linda Mar, Capitola, Pleasure Point, Steamer Lane, Carmel), `santa_barbara_ventura` (Leadbetter, Sands, Rincon,
  Mondos, C Street), `la_orange` (Malibu First Point, Zuma, Huntington Pier, Newport Point), `san_diego` (Trestles,
  Blacks, La Jolla Shores, Windansea).
- **Hours:** every 2nd hour. Reference years 2018-01-01..2021-12-31; scored 2022-01-01..2025-03-31. Every scored hour
  with a defined breaking height counts, flat hours included.
- **Height (one for every grader):** `eval_scoring.hb_proxy`, the #773 nearshore arm's frozen Komar-Gaughan operator,
  applied to MOP Hs and Tp at the MOP point's own depth.
- **Category (the rating's own gates, no new thresholds):** from `surf_rating.size_score` and `oversize_gate` at that
  height and yardstick: flat (size gate 0) / small (< 0.6, the anchor) / fun (0.6 to < 1) / solid (saturated, no
  taper) / overhead (in the oversize taper) / big (at the taper floor). Break depth is None for every grader.
- **Truth:** the category against the spot's own typical day from measured water: `spot_size_climatology.
  reference_from_hist` (the served reference's statistic: clamped p50 of surfable-day heights) over the
  reference-year MOP heights.
- **OFF arm (legacy):** reference None with `RATING_REF_PRIOR=0`. The runner refuses to run if the prior leaks in.
- **ON arm (prior):** leave-one-out: the median of `scripts/climatology_baseline.json`'s per-spot references with the
  spot's own entry removed. Checked against #771's code at `f81a293b2` with the flag ON: the explicit-prior gates equal
  #771's reference-less gates at 1,600 of 1,600 heights from 0 to 16 m (0 mismatches).
- **Metric:** exact category agreement with truth, per spot-hour.
- **CI:** 95 % percentile bootstrap of (prior − legacy) agreement, 2,000 replicates, resampling whole UTC days (every
  spot on a resampled day comes with it, since the spots share swell), seed 20261112.
- **Operator variants:** `kg_frozen` (hb_proxy as frozen, ×1.0) and `h110_served` (×1.27, `surf_height_convention.
  H110_OVER_HS`, the convention served heights use). Truth is invariant to the scale; the arms are not.

## Pass rule (binding)

**PASS** if, in BOTH operator variants:
1. pooled agreement(prior) ≥ agreement(legacy), and the CI lower bound of (prior − legacy) ≥ 0; and
2. no region is significantly worse: no region whose CI of (prior − legacy) has an upper bound < 0.

**FAIL** otherwise. #771 stays held, with why.

**INVALID** (no verdict; #771 stays held) if a control misbehaves in either variant:
- **null control:** on a random half of the days the two arms' labels are exchanged (seed 20261113). Its CI must
  contain 0.
- **positive control:** a known-wrong yardstick, 4.0 m (`REF_CLAMP_MAX_M`, a big-wave spot's yardstick for every spot),
  must lose to the prior: CI upper bound of (wrong − prior) < 0.

Descriptive only, never binding: seasons (where ≥ 30 days), per-spot agreement, surfable-only agreement (truth not
flat), adjacent-category agreement, a shifted-truth null (each spot's truth rotated by a random number of days: what
the label mix alone buys), confusion matrices.

## Known limits, stated before the result

- California only, 19 spots. The catalogue's other coasts are not tested.
- MOP is a wave model (linear spectral refraction driven by CDIP buoys) at 10-15 m depth, not observed surf. The
  breaking height is a proxy operator on it.
- Every one of these spots HAS a served reference; leave-one-out simulates the reference-less case. The live
  reference-less population (band cells, new spots, outages, eval replay) is not these spots.
- Truth defines "typical" as this spot's measured-water median, which is the rating's own design statement. A spot
  whose real typical day sits near 1.142 m on this operator favours the prior; one far from it favours neither arm in
  particular. The result says which yardstick is nearer measured water at these points, not that either is right.
