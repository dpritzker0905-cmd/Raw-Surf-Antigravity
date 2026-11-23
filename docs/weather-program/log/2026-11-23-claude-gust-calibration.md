# 2026-11-23 — Calibrated gusts for the Gusts layer: pre-registration, then the out-of-sample score (session gust-calibration, Claude Opus)

Asked by the director (local_d6b521eb), on the gust SOTA path of 2026-11-22 (`GUSTS-SOTA-PATH.md` in the director's notes, rank 1):
build a calibrated gust per model (EMOS or gust-factor regression) on the gust verification record (#1063), score it out of sample
against the raw model gusts and against wind x 1.40, and wire it into the served frames only if it passes.

Record before this session (read 2026-11-23 02:30Z):
- #950 (wind EMOS pre-registration) and #951 (its ENS collector) were MERGED on 2026-11-16, so SOTA-ROADMAP row 3's "open" is stale.
  They cover the LONG-RANGE ENS wind/gust past the native end (D-075), not the deterministic gust frames. Nothing to supersede:
  this calibration is a separate method on a separate record (#1063's), and leaves #946 / D-075 alone.
- #1063 (gust verification collector) was merged 2026-11-19. `gust-verify.yml` has run cleanly every day since: 11-19, 11-20,
  11-21 and 11-22 (runs 44598739666, 44798985147, 44932867958, 45055454502). The stored record had 4 00Z cycles per model. The keyless
  PR dry run's 9 days were never uploaded.
- First scoring (log `2026-11-18-opus-gust-verification.md` §3a, n ~ 1 period, not acted on): wind x 1.40 has lower MAE than every
  model in every lead bin except EURO 120-240 h. Most of EURO/ICON's high bias is the one-report-an-hour observation (the dense
  window maximum cuts EURO's +1.6 to ~+0.5 m/s, ICON's +1.26 to +0.14).

## 0. Collector: backfill dispatched (2026-11-23 02:40Z), then CANCELLED (~03:00Z, director's order: no dispatches without David's word)

`gust-verify.yml` (on dev) `mode=backfill` for GFS and EURO 00Z, 2026-10-09..10-28 (run 45101551190) and 10-29..11-18
(run 45101561748). The mode is the merged collector's own; it writes create-only under `calibration/gust_verify/`. Why now: NDBC's
`realtime2` files hold 45 days, so 10-09 is the oldest cycle whose verifying reports can still be fetched, and the window rolls
forward every day. ICON has no archive (DWD keeps about a day), so ICON's record starts at 11-19 and grows by one cycle a day.

## 1. PRE-REGISTERED METHOD (written 2026-11-23, before any calibration code exists and before any fit or calibrated number)

Nothing in this section is edited after results exist; changes are appended as dated amendments.

**Data.** The #1063 record, read by `gust_verify_score.build_pairs` unchanged: each model's served gust `G` (the frame value at the
station's 0.25-degree node), its own 10 m wind `W` (same node and step), lead `f`, the gust window `w` (GFS 0 = instantaneous;
EURO 1 h to f090, 3 h to f144, 6 h after; ICON 1 h to f078, 3 h after), the station's land flag (GFS LAND at its node), and the NDBC
reports. All values m/s. A pair needs `G`, `W` and its target present; every arm is scored on exactly the same pairs.

**Target (the observation each model is calibrated to), scaled to 10 m by the #1063 log law (stations with 1 m <= z <= 50 m only):**
- GFS (instantaneous): the hourly GST at the valid hour (the report nearest the hour within +-10 min): #1063's primary.
- EURO and ICON (maxima over the w hours ending at the valid hour): the DENSE window maximum. That is the max of every report in
  (V-w, V], at stations reporting at least 5 times in each of those hours. Why it is the target and not #1063's sparse primary: the
  served gust is labelled as the window's maximum, and the sparse "max of one report per hour" under-samples that maximum (§3a of the
  18th). Calibrating to it would teach the model to under-forecast the peak its label names. The sparse target is reported as a
  sensitivity and never decides.

**Strata (one calibration per model; NEVER fitted, pooled or blended across models, D-076):** model x lead bin (0-23, 24-47, 48-71,
72-119, 120-240 h) x window w x land/sea. A stratum with fewer than 2,000 training pairs falls back to its land and sea pooled
(same model, bin and w). If that pool also has fewer than 2,000, the stratum stays RAW (the identity, served as the raw gust).

**Candidate C: EMOS, a truncated normal at 0** (Thorarinsdottir & Gneiting 2010), one per stratum:
- location `mu = a + b*G + c*W`; scale `sigma = exp(d + e*G/10)`;
- fitted by minimum mean CRPS (the closed form of the 0-truncated normal), L-BFGS-B from (a, b, c, d, e) = (0, 1, 0, ln 2, 0);
- the SERVED number is the predictive MEDIAN, `m = mu + sigma * PhiInv(0.5 + 0.5 * Phi(-mu/sigma))`, floored at 0;
- the probability of exceeding a threshold `t` is `1 - F(t)`.
- Not in the record, so not predictors: stability and boundary-layer depth. The collector stores neither. Adding them is a future
  amendment, scored only on cycles collected after it. The land/sea flag is the only coastal class the record has.

**Comparator R (reported, never decides):** the fitted gust factor `k*W`, k per stratum by minimum MAE on the same training rows.

**Out of sample, blocked by time AND by station:**
- TIME: rolling origin by calendar week of the cycle date. The first test week starts once at least 14 UTC days of training valid
  times exist. For a test week starting at T, the training rows are those from earlier cycles whose VALID time is before T, over
  the trailing 45 days of valid time. So every training observation was in hand when the first test run was issued, as operations
  would have it.
- STATION: the 100 km complete-linkage blocks of D-066 (`eval_twoway.spatial_blocks`, the stations' lat/lon) are dealt into 5
  folds in order of their sorted block names (round robin). Each (test week, fold) is fitted on the other 4 folds' stations only.
- Every test row is scored exactly once, by a fit that saw neither its week nor its block.

**Metrics per model, pooled and per lead bin x land/sea:** n; bias; MAE of C's median, of the raw `G`, of wind x 1.40 and of R; the
CRPS of C (the CRPS of a point forecast is its MAE); for 25 / 34 / 48 kn (12.86 / 17.49 / 24.69 m/s): the Brier score of C's
exceedance probability against the raw and the wind x 1.40 indicators (0/1), and C's reliability (10 equal-width probability bins,
observed frequency and count). POD and FAR of C's median and of the raw at 25 and 34 kn.

**Uncertainty:** the D-066 two-way (100 km block x UTC valid day) bootstrap, `eval_twoway.two_way_ci` (2,000 reps, its seed). The gain
rows are `|raw - obs| - |C - obs|`, and for G4 `|raw - obs| - CRPS_C`. It is computable only over at least 14 UTC target days.

**Gate, per model (all must pass; each model ships or stays raw on its own):**
- G1 (the served number): the pooled MAE gain of C's median over the raw gust has a two-way 95% lower bound > 0.
- G2 (no part made worse): in no lead bin x land/sea stratum is the two-way 95% UPPER bound of that gain below 0. Strata under 14
  UTC days are reported, not gated.
- G3 (beats the naive baseline): pooled MAE of C's median <= the pooled MAE of wind x 1.40 (point estimate; its two-way interval is
  reported).
- G4 (the distribution): pooled CRPS of C has a two-way 95% lower bound of gain > 0 over the raw MAE. The Brier skill vs the raw
  indicator is > 0 at 25 and at 34 kn (point estimates; 48 kn reported only).
- G5 (storm guard: calibration must not mute the strong gusts): over pairs with an observed gust >= 34 kn, POD of C's median >= POD of
  the raw - 0.05. Fewer than 50 such events = UNDERPOWERED = that model HOLDS (does not ship).
- G6: |bias of C| <= 0.25 m/s pooled (each lead bin reported).

**Controls (a failed control VOIDS that model's verdict until explained):**
- NULL: the same pipeline with each training stratum's targets permuted (seed 3) must give an out-of-sample MAE >= 1.10 x the real C's.
- POSITIVE 1 (bias absorbed): +1.0 m/s added to `G` in train and test. C's out-of-sample MAE must move by <= 0.02 m/s, while the raw's
  rises by >= 0.3 m/s.
- POSITIVE 2 (recovery): synthetic targets `y = max(0, 0.5 + 0.7G + 0.4W + N(0, 1.2^2))` (seed 4) on GFS's 0-23 h pairs. The fit must
  recover a, b, c within +-0.1 and exp(d) within 10% of 1.2.
- LEAK: a fit that also trains on the test rows must score MAE <= the out-of-sample fit. Otherwise the folds are not doing what they claim.
- The CRPS closed form is checked against a 200,000-draw Monte Carlo in the tests (to 0.5%).

**When each model is read (no score is read before the #1063 re-score):**
- No out-of-sample score of any model is computed or read before BOTH of these hold:
  - the #1063 multi-week re-score (due 2026-12-09) is recorded;
  - this pre-registration is gated and merged.
- After that, a run is dispatched only on David's word in the director session. Its exact spec (window, models, workflow) goes to the
  director first.
- GFS and EURO: then read on the record available at that time, needing >= 14 UTC training days plus >= 14 UTC test days.
- ICON: read once the stored record has at least 28 cycles (~2026-12-16). Until its read passes, ICON stays raw.
- A run started before these hold is VOID: it is recorded and never used.

**Precedence:**
- **This calibration vs #1063's additive bias correction.** For each model and lead bin, the bias correction comes first: it is
  decided at the 12-09 re-score by its own rule. C is scored after it, against the RAW gust. If both pass, they are never stacked:
  C (which absorbs a constant bias, POSITIVE 1) replaces the additive correction for that model and bin. If C fails, the #1063 rule
  stands alone.
- **This calibration vs D-075.** C covers each model's own native range only. Past it, D-075's ENS median 10fg rule governs
  (#946's gate), and C is never applied to ENS members.
- **This document vs this session.** Where this document and anything said in this session disagree, the merged #1186 text wins,
  as amended in dated amendments.

**If a model passes:** a PR wires C into that model's gust frames behind a registered guarded flag (`runtime_flags.flag()`,
`_RATING_FLAGS` parity, a kill switch, a SCOREBOARD row, the history filter). Coefficients are refitted on the trailing 45 days. It
moves a served number, so D-065 applies, and the director (David) decides whether it ships ON or dark. A model that fails stays raw,
and the result is recorded as a finding.

**Amendment 1 (2026-11-23, written while building the fitter on SYNTHETIC data, before any fit on the real record; §1 is not edited).**
1. POSITIVE 1 is computed on the rows that a FIT served in both arms. A stratum that falls back to RAW is the identity by design, so
   it cannot absorb a bias. On the synthetic record, 4% of the rows were raw-fallback, and they alone moved C's MAE by 0.04.
2. The CRPS check: 200,000 draws carry about 0.7% Monte Carlo noise (measured at mu = -1, sigma = 2). The test therefore uses 2,000,000
   draws to 0.5%, plus a deterministic quadrature of the integral of (F - 1{x >= y})^2 to 0.1%. The closed form matches the quadrature
   to 1e-6.
3. NULL seeding: "seed 3" is one generator per (test week, station fold), `default_rng([3, week, fold])`, so the parallel jobs stay
   deterministic.
4. Implementation facts, stated: the dense target is read on the pairs `gust_verify_score.build_pairs` keeps, which needs the sparse
   hourly observation present. A station whose GFS land flag is unknown counts as sea. The keyless CI rebuild (`gust-calibrate.yml`)
   freezes its station list on the day it runs, so its list can differ slightly from the dev record's list (frozen 2026-11-19).
5. Tooling: numpy only. The normal CDF is Numerical Recipes' erfc and its inverse is Acklam's, both tested against `math`. The
   optimizer is a 5-parameter BFGS. Each model's CI job rebuilds GFS or EURO alone (`--models`) and fits with 4 worker processes.
