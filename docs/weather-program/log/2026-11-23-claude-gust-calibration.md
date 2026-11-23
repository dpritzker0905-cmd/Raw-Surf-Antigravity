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

**PRIMARY ENDPOINT (pinned 2026-11-23 on the director's directive, before any calibration fit or score on real data):**
- **ONE primary metric: CRPS.** Per model, the mean CRPS gain of C over the raw gust: `d = |G - y| - CRPS_C`. The CRPS of a point
  forecast is its absolute error.
- **Hypothesis:** H0 `E[d] <= 0` vs H1 `E[d] > 0`, one-sided.
- **Block bootstrap (station x day):** the D-066 two-way bootstrap. Blocks are 100 km complete-linkage station blocks x UTC valid
  days, pigeonhole weights, 2,000 replicates, seed 20261103 (`eval_twoway._cells_ci`). It gives the mean, the SE and a
  t-interval with days - 1 df.
- **p-value:** `p = 1 - t_cdf(mean / SE, days - 1)` (`eval_twoway.t_cdf`).
- **Holm across models (family = GFS, EURO, ICON, alpha 0.05 FWER):**
  - The two reads are Bonferroni-split. GFS + EURO get a family alpha of 2 x 0.05 / 3, and ICON (read later, alone) gets 0.05 / 3.
  - Holm's step-down runs within the GFS + EURO read: the smaller p is compared with 0.0167; if that model is rejected, the other
    p is compared with 0.0333.
  - ICON is compared with 0.0167.
  - The family-wise error rate is <= 0.05 whatever ICON's timing.
  - A model's primary PASSES only if it is rejected under that rule.
- **n stated in advance:**
  - **Read window:** test cycles are every 00Z cycle from (first stored cycle + 14 days) through the last cycle whose 240 h lead has
    verified before the read. Each test row's valid time is <= the NDBC fetch time.
  - **Expected test rows for GFS and EURO:** first stored cycle 2026-10-09, read after the 12-09 re-score. That gives about 46 test
    cycles (2026-10-23..12-07).
    - GFS: about 46 x 15,000 ~ 0.7 M rows (the 11-18 scoring had ~19,000 pairs a cycle; ~80% have a usable height).
    - EURO: about 46 x 8,000 ~ 0.37 M rows (fewer steps; the dense-target subset).
  - **Expected test rows for ICON:** at 28 cycles, about 14 x 9,000 ~ 0.13 M rows.
  - **Floors (below any of them the model is NOT_READ, never PASS):** >= 14 UTC test days and >= 50 two-way blocks, plus >= 200,000
    test rows (GFS), >= 100,000 (EURO) or >= 50,000 (ICON).
  - The realised n (rows, cycles, days, blocks) is reported beside every number.
- **G1-G6 below are SECONDARY:**
  - They are each required to ship (safety and served-number checks), but they are not the primary hypothesis.
  - Their intervals are reported unadjusted, and none of them can rescue a failed primary.
  - G4's CRPS clause IS the primary, under the Holm rule above.

**Adopted from the 2026-11-23 review (SubQ Savant and Reflection Beam; their answers are in §1b; all written before any real-data fit):**
- **Size check before the read (both reviewers).** At read time the realised layout (its blocks, days and rows per cell) is checked
  with eval_twoway's null calibration (synthetic mean-zero nulls on that layout; `calibrate_items`' defaults, 300 sets x 200
  replicates). It runs through a numpy port (`scripts/twoway_np.py`) of the same nulls, bootstrap and thresholds, because the
  pure-Python original needs ~1e10 operations on a real layout. The port is pinned by a test to within 0.04 of
  `eval_twoway.self_test()` on each binding null. If the one-sided false-pass rate is above 5%, the
  verdict is INVALID, never PASS. If power against a 4-null-SD effect is below 80%, the verdict is UNDERPOWERED, reported and never
  PASS.
- **Height-scaling robustness (both).** The primary is recomputed on the RAW, unscaled target, and on buoys only (3 m <= z <= 6 m).
  These are reported; if either has a negative mean gain, the model HOLDS.
- **Calibration diagnostics (SubQ 8).** The PIT histogram (10 bins) and the 50 / 80 / 90% central-interval coverage of C are
  reported per model and lead bin; they do not gate.
- **G2's strata** need >= 5,000 test rows and >= 14 UTC days to gate, otherwise they are reported only. G2 stays unadjusted on
  purpose: it is a safety check, and multiplicity there can only cause a false FAIL, never a false PASS.
- **Why the required gates need no multiplicity adjustment against a false PASS:** shipping needs EVERY gate. That is an
  intersection-union test, so its false-pass rate is no higher than the primary's.
- **Reported comparators** (they decide nothing): persistence (the #1063 definition), climatology (each station's training-window
  median), raw W, k*W and wind x 1.40.

**Gate, per model (all must pass; each model ships or stays raw on its own):**
- G1 (the served number): the pooled MAE gain of C's median over the raw gust has a two-way 95% lower bound > 0.
- G2 (no part made worse): in no lead bin x land/sea stratum is the two-way 95% UPPER bound of that gain below 0. Strata under 14
  UTC days are reported, not gated.
- G3 (not worse than the naive baseline; a paired one-sided NON-INFERIORITY test, replacing the point-estimate rule after the
  2026-11-23 review below):
  - CRPS: the two-way 95% lower bound of `|1.40W - y| - CRPS_C` must be > -0.02 m/s.
  - The served median: the two-way 95% lower bound of `|1.40W - y| - |C - y|` must be > -0.02 m/s.
- G4 (the distribution): pooled CRPS of C has a two-way 95% lower bound of gain > 0 over the raw MAE. The Brier skill vs the raw
  indicator is > 0 at 25 and at 34 kn (point estimates; 48 kn reported only).
- G5 (storm guard: calibration must not mute the strong gusts): over pairs with an observed gust >= 34 kn, POD of C's median >= POD of
  the raw - 0.05, AND FAR of C's median at 34 kn <= the raw's FAR + 0.05 (so the guard cannot be met by over-forecasting). Fewer than
  50 such events = UNDERPOWERED = that model HOLDS (does not ship).
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

## 1b. External review of the pre-registration (2026-11-23, public context only, before any real-data fit)

On the director's directive, §1's text (the primary endpoint included) went to SubQ Savant (subq-savant-1.4, medium effort; a first
call at high effort spent its whole budget reasoning and returned nothing) and Reflection Beam (Beam-1.0, high effort), with the same
prompt: "review as a skeptical statistician; false PASS, false FAIL / power, missing SOTA practice; must-fix or nice-to-have". Only
the public pre-registration text was sent. Their answers are advisory. Summarised below (not verbatim), with what was done about each.

| # | point (who) | disposition |
|---|---|---|
| 1 | Primary is vs the raw gust only, which already loses to wind x 1.40; it can PASS with no value over the baseline (both, #1) | ADOPTED: G3 is now a paired one-sided non-inferiority test vs wind x 1.40 (CRPS and the median, margin 0.02 m/s), required to ship |
| 2 | G3 was a point estimate (SubQ #4, Reflection #4) | ADOPTED (same change) |
| 3 | Two-way bootstrap size not demonstrated for this unbalanced sparse layout (SubQ #7, Reflection #3) | ADOPTED: `eval_twoway.calibrate_items` on the realised layout; false pass > 5% = INVALID, power < 80% = UNDERPOWERED |
| 4 | No power analysis / minimum detectable effect (SubQ #6, Reflection #6) | ADOPTED via 3 (power against the 4-null-SD effect on the realised layout). Before 12-09, a synthetic-only power run of the fitter is allowed and will be logged |
| 5 | Neutral log law with one z0 for all heights and land/sea distorts the target (both: SubQ #3, Reflection #2, #12) | PARTLY: kept as #1063's rule. The primary is re-read on the RAW target and on buoys only (3-6 m); a negative sign on either = HOLD |
| 6 | Targets differ across models (instantaneous vs dense window max) (SubQ #2, Reflection #2) | NOT ADOPTED: models are never compared or pooled (D-076). Each model's target is the observation its own label names; that per-model match is the point |
| 7 | ICON's later read at 0.05/3 is an ambiguous sequential rule (Reflection #7) | ADOPTED as an explicit Bonferroni split: GFS+EURO family 2(0.05)/3 with Holm inside (0.0167, 0.0333), ICON 0.0167 |
| 8 | G2 has no size floor; stratum multiplicity (SubQ #5) | PARTLY: floor >= 5,000 rows and 14 days. No adjustment: G2 can only cause a false FAIL |
| 9 | Brier / POD guard can be gamed by over-forecasting (SubQ #9) | ADOPTED: a FAR guard at 34 kn beside the POD guard |
| 10 | EMOS too simple (no regime, diurnal, direction or station effects); add PIT and coverage (SubQ #8, Reflection #8) | PARTLY: PIT and coverage reported. The single candidate stays; adding model variants now would be a garden of forking paths. Richer predictors are a later, separately pre-registered amendment |
| 11 | Comparators weak: no persistence or climatology (Reflection #9) | ADOPTED as reported comparators (they decide nothing) |
| 12 | Controls use heuristic thresholds; the leak check is weak (SubQ #10, Reflection #10) | NOT CHANGED: the size check (3) is the calibrated diagnostic. The controls are sanity checks with thresholds fixed in advance |
| 13 | Fold dealing not randomised; fallback strata inconsistent (Reflection #5, #11) | NOT CHANGED: the deterministic round robin of 100 km blocks keeps a station and its <= 100 km neighbours in one fold. The fitted-row share and each stratum's fallback are reported |
| 14 | A 45-day window under-represents >= 34 kn events (Reflection #6) | NOTED: G5's >= 50-event floor already turns too few events into HOLD, never PASS |
