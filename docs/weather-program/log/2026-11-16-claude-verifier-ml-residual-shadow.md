# 2026-11-16: nonlinear ML residual correction of offshore wave height, shadow only; pre-registered gate (pr-verifier)

Append-only. The senior research lead's brief (#929, first written for Move 4, which is done), passed to this session
by the director on 2026-11-16 ~00:44Z. MEASUREMENT ONLY: nothing here serves. It could change a served number only if
it ever ships, which needs this gate met AND the owner's word. All times UTC.

## 1. Pre-registration, written 2026-11-16 00:50Z, BEFORE any scored row was read

**What I had seen.** The brief's literature, which reports gradient-boosted residual corrections cutting MAE by 13-46%
(Zhang 2023) and trees beating neural nets at one site (Callens 2020). Move 4's published read of the linear and OCF
variants (SCOREBOARD 2026-11-13 02:33Z):
- the rolling 14-day per-region bias-corrected equal mean gained +0.031 / +0.008 / +0.019 m at +24/48/72 h;
- linear MOS lost (-0.000 / -0.012 / -0.019 m);
- Hawaii was worse at every lead.

I have read no scored row. The segments are in private Storage and this machine holds no key. The measurement runs in
a dispatch-only Actions job that prints aggregates, dispatched on the owner's word.

**Data.** The skill ledger's scored rows, every month present through the read. A pair is one (buoy, target hour,
lead) where all three member lanes scored the same verifying observation:
- `raw_surf` (served GFS), `raw_surf:EURO`, `raw_surf:ICON`;
- same observation time and height;
- finite `hs_m`, `hs_m` > 0.

Leads +24, +48, +72 h. **The 9 hole buoys** (44090, 46254, 46267, 46274, 46285, 51201, 51206, 51208, LJPC1) **are
excluded from the fit AND the score.**

**Target and model.** The model predicts the served lane's residual, observed minus `hs_m`(served). The corrected
forecast is max(0, `hs_m` + prediction).
- **Features, all known at issue time:**
  - lead;
  - served `hs_m`, `tp_s`, `dir_deg` (sin, cos), `wind_kt`, `wind_from_deg` (sin, cos);
  - EURO and ICON `hs_m`;
  - model spread (max - min of the three heights);
  - day of year (sin, cos);
  - region (`skill_consensus.region_of`, integer-coded).
  - A missing feature stays missing; the model handles NaN natively.
- **Model:** scikit-learn `HistGradientBoostingRegressor`, settings fixed now and never tuned on this data:
  - `loss="absolute_error"`, `learning_rate=0.05`, `max_iter=300`;
  - `max_leaf_nodes=15`, `min_samples_leaf=50`, `l2_regularization=1.0`;
  - `early_stopping=False`, `categorical_features=[region]`, `random_state=20261116`.

**Cross-validation: leave-buoy-out AND forward time blocks.** No row is ever predicted by a model that saw its buoy or
its future.
- Buoys are hashed into 5 groups (sha256 of the id, mod 5).
- Target time is cut into 7-day blocks starting 2026-08-01.
- A test cell is (buoy group g, block b). Its model trains on the pairs whose buoy is NOT in g AND whose target is
  before block b's start minus 72 h, so the training observations existed at issue time.
- A block is tested when its training set has >= 2,000 pairs.

**Baseline to beat.** Move 4's `ocf_rolling`: the equal mean of the three members, each minus its own rolling 14-day
per-region bias as of issue time (`skill_ocf._forecasts`' rule, region fallback included), computed on the same pairs
with the hole buoys excluded. The served lane minus its own rolling per-region bias is printed beside it, not gating.

**Statistic.** Per lead, paired dMAE = MAE(ML) - MAE(`ocf_rolling`) on the same test pairs (negative = ML better). The
95% interval is a 3-day-block bootstrap, 2,000 draws, seed 20261116; 1-day blocks are printed beside it. Region cells use
`region_of`. A region cell is testable with >= 100 pairs on >= 7 target days.

**Gate. PASS needs all of the following.**
- **G1:** at EVERY lead, the pooled 3-day interval of dMAE lies wholly below 0.
- **G2:** NO testable region x lead cell is significantly worse (3-day interval wholly above 0).
- **N, the shuffled-label null:** the same pipeline with each training set's residual labels permuted (a fresh seed
  per test cell). It must NOT meet G1 at any lead.
- **P, the seeded-shift positive control:** +0.30 m is planted on the observation of every pair whose served `tp_s` >=
  12 s, in training and test. On those test pairs, the mean of (ML prediction with the plant) - (ML prediction without)
  must be >= +0.15 m (half the plant), and on the other test pairs it must lie within +-0.05 m.
- **Coverage:** >= 1,000 test pairs from >= 20 buoys at every lead.
- **VOID** when N or P fails, or coverage is short: then there is no verdict.
- **FAIL** otherwise when G1 or G2 fails.

**Limits stated before the result.**
- About three months of one season pair, summer into the first winter swells.
- NDBC buoys are offshore, so this corrects offshore significant wave height, not the breaking height.
- Forward blocks train on 4-14 weeks.
- A PASS is a shadow result only: serving needs its own build, a kill switch, the D-065 filter and the owner's word.
