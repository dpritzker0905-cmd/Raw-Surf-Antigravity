# Amendment 2 to gust-ens-risk-v1 (the SubQ and Reflection reviews of the scoring plan)
Stamp: 2026-11-23 03:52Z. Written before any score, count or verdict exists. The collection is running; nothing has been paired with an observation. Where this file and the gate or amendment 1 differ, this file holds; everything else stands.

## Source
- David asked by name, in the director session (relayed by `local_d6b521eb`): "use subq, reflection, longcat to help
  figure it out. Make sure all lanes do that."
- Both advisors got the same public plan text: the gate plus amendment 1, as summarised in the log's 03:52Z entry.
  - Reflection Beam (high effort).
  - SubQ Savant (low effort).
- Their answers are summarised in the log. LongCat was not asked: its one paid request on 2026-11-22 failed with a network
  error, and its billing outcome is unknown.
- Adopted: the points both raised, plus SubQ's dependent-null control. Not adopted, with reasons:
  - Recalibrated-ensemble and HRES-recalibrated references: the EMOS gate is separate, so they are reported only.
  - A censoring-aware likelihood: replaced by the simpler exclusion in B3 below.

## B1 · Fair Brier for the ensemble (decides)
- The ENS arm's Brier is the fair (ensemble-adjusted) Brier score for m = 50 members: per row
  `(p - o)^2 - p (1 - p) / (m - 1)`.
- It is used in P1 and in every reported ENS Brier. The raw Brier is reported beside it.
- CLIM and the 0/1 arms (HRES, median, p90) are not adjusted; they are not finite-ensemble fractions.

## B2 · One crossed bootstrap, Holm across cells (decides)
- P1's interval is replaced by ONE paired, two-way clustered bootstrap. Each replicate resamples stations and 3-day
  blocks of valid days independently. A row's weight is (draws of its station) x (draws of its block). The statistic is
  the weighted mean of the paired per-row difference (fair BS(ENS) - BS(CLIM)). 10,000 replicates, seed 20261122.
- The one-sided p-value is (1 + #{replicates >= 0}) / (10,000 + 1).
- **Holm** runs over every non-UNDERPOWERED cell (threshold x bin), one family, one-sided alpha 0.05. A cell's P1 needs
  its Holm-adjusted p < 0.05, plus B4's calibration condition.
- Reported only, never deciding:
  - the 1-day block, station-only and 5-day block intervals of amendment 1;
  - the effective sample size (the number of distinct station x 3-day-block clusters holding an event).

## B3 · ASOS at 25 kn is censored, so it is reported only (decides)
- METAR `PK WND` is reported only above 25 kt, and a report with no gust group falls back to the sustained speed. That
  biases the ASOS 25 kn event frequency low.
- So ASOS rows do not enter P1 at 25 kn; NDBC alone decides there. At 34 and 48 kn, ASOS rows enter as registered.
- The ASOS 25 kn cells are reported in their own table.

## B4 · Calibration condition (decides, replaces amendment 1's REL < RES and the ratio)
Calibration fit:
- A logistic recalibration `logit(P(o = 1)) = a + b logit(p')` is fitted on the cell's rows by maximum likelihood.
- p' = p clipped to [1 / (2m), 1 - 1 / (2m)].

The condition holds when both of these do:
- the slope b is in [0.5, 1.5];
- calibration in the large is in [0.5, 2.0]: mean(p) / event frequency.

Reported, never deciding:
- REL, RES and UNC;
- the reliability diagram over the 51 member-count classes (pooled to >= 50 rows a point), with 95% consistency bars by
  binomial resampling at each point's mean p.

## B5 · Matching is per step (stated, unchanged)
- Each row is one (run, step, station). The forecast is that step's member fraction for that step's own window, and the
  truth is the window max over the same (V - w, V].
- Lead bins are reporting groups of such rows. Nothing is aggregated over a bin's hours.

## B6 · New control C6: the full decision rule under a dependent null (VOID if it misbehaves)
- The observations are circularly shifted in time, per station, by 7, 14 and 21 days within the truth span. This keeps
  each station's own autocorrelation and the cross-station structure of the forecasts, but breaks the pairing.
- The whole decision rule is run on each shift (fair Brier, crossed bootstrap, Holm, B4).
- **VOID** if any shift yields a PASS in any cell.
- The shifted runs' p-values are reported as the rule's empirical false-positive check. If more than 5% of the shifted
  cells have p < 0.05 before Holm, that is reported as a calibration warning on the bootstrap.

## B7 · The count-only pass also reports precision
The n table (amendment 1 A3) adds, per bin, the number of distinct stations x 3-day blocks. It still reads no outcome.
