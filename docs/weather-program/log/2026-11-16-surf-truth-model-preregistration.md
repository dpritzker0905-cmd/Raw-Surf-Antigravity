# 2026-11-16 Surf-truth latent model (anchors D / T1 P4): pre-registration (session `surf-truth-checkins-e7abf2`)

Research lead signed off 17:45 EST with edits 1-7 (owner of the aggregator; edits applied below). Written BEFORE any
data is fitted. As of this
writing the truth stream holds no blind observation at all (P1 merged 2026-11-16; legacy rows: 9 check-ins, 4 surf
reports, 3 condition reports with a height, all excluded below). Nothing here changes a served number.

## What is being decided

Whether a latent-truth model over the app's own blind observations produces a breaking FACE height per spot-time
cell that is good enough to serve as truth for the surf gates (the repair lead's #942 needs n >= 30 per spot class).
The output is TRUTH FOR TESTING ONLY: it never feeds the forecast, is never shown to observers, and the model's own
outputs never become observations.

## Data (fixed now)

- Source: `surf_observations` rows with `flow='blind_v1'`, read through the private aggregate-only export (T1 P4;
  not built yet; the fit runs offline in Actions, never on Render).
- Unit of truth: a CELL = spot x 3-hour window in local spot time, daylight only. A spot-day groups its cells.
- Each row enters with its RAW entry, never `face_m`: `height_value` + `height_unit`, or `height_bucket` as an
  interval (Flat [0, 0.5] ft; "8ft+" right-censored at 8 ft), plus `height_scale`, `set_or_avg`, `observer_role`.
- Excluded from the fit (kept in the table, counted in every report):
  `forecast_shown_before = true`; `flow != 'blind_v1'`; flag `duplicate_media`; flag `no_parent`;
  `gps_distance_m > 2000`; `|exif_age_s| > 10800`; `xp_status = 'audit_failed'`.
  Rows from a paid, photo-less, GPS-only report enter with their flags as covariates (advisor, #980): weak evidence.
- Anchor status is read from `surf_truth_anchor_events` AT `received_at` (not today's row): only an anchor that was
  ACTIVE then counts as an anchor for that row.

## Model (fixed now; a design choice, pre-registered as such)

For observation i by observer j in cell c:

    log y_i = log T_c + log k_z(i) + log k_set(i) + log P + b_j + e_i,     e_i ~ N(0, sigma_j^2)

- `T_c`: latent true breaking face height H1/10 (m) of the cell; random-walk prior on log T across the cells of a
  spot-day (step sd 0.15), weak lognormal prior per spot-day.
- `z(i)`: latent scale category in {face, hawaiian}; P(z = declared) = 0.9, else the region prior. k_face = 1;
  k_hawaiian centred at 0.5 with log-sd 0.25 (edit 3). WHY this choice over centring at 0.57: the only opened
  measurement (Caldwell 2007, UHSLC) gives face = 2 x Hawaiian; the two-thirds variant (k = 0.67) is snippet-level.
  So the centre stays on the measurement and the uncertainty widens to cover 0.5-0.67 (log(0.67/0.5) = 0.29, about
  1.2 sd) instead of moving the centre toward an unopened source.
- `k_set`: 'sets' = 1.0 (H1/10); 'typical' = 1/1.27 (Rayleigh H1/3 vs H1/10), log-sd 0.10.
- `P`: the anchors' COMMON perception factor against physical truth: prior lognormal centred 0.6, log-sd 0.25.
  Sources (edit 7): Stokes et al. 2014, mean 0.70 over 354 observers; Stokes 2015 thesis, mean under-estimate 48%;
  both ABSTRACTS ONLY, one UK group, spread unreported. IDENTIFIED ONLY by physical-reference rows (in-frame scale in
  a photo, Sentinel-2 surf-zone scene (T2), a shallow buoy within reach), never fixed at 0.70. P is CONSTANT in this
  registration (edit 4). Without physical references only T x P is identified: it is reported as the "anchor-scale
  face height", never as T (edit, choice 1).
- Candidate term (edit 4): a common slope of log P on log T (Stokes: under-calls largest on small or short-period
  waves). Fitted ONLY with >= 20 physical-reference rows, and kept ONLY if it beats constant P on the physical
  holdout; until then P is constant.
- `b_j`: observer bias (log) RELATIVE TO THE ANCHOR MEAN, hierarchical by role ~ N(mu_role, tau^2); CONSTRAINT: the
  mean b over ACTIVE anchors is 0 (anchors set the relative scale; P sets the absolute one). Each anchor's own b is
  estimated, not fixed.
- `sigma_j`: hierarchical half-normal by role.
- Buckets: interval-censored likelihood. "8ft+": right-censored.
- Optional term, fitted ONLY if it beats the constant-bias model on the holdout (both reported): size-dependent
  bias `a_j (log T_c - c)`, a_j ~ N(0, 0.1^2) hierarchical by role (storms under-read, small seas over-read).
- Fit: EM (continuous Dawid-Skene form; no opened source gives one, so this is our design) first; a Bayesian fit
  (NumPyro) later as a cross-check only. Seed 20261116.
- The forecast is NEVER an input to T. An analysis-only forecast snapshot (joined offline to the run CURRENT at
  received_at) is used only to report forecast-vs-truth after the gate passes.

## Holdout (fixed now)

- Spots: a spot is held out iff `int(sha256(spot_id + ":t1-holdout-v1"), 16) < 0.2 * 2**256`. A FIXED threshold,
  not a quantile of the spots seen so far, so membership never changes as spots are added and no spot can move
  between holdout and fit across run versions (edit, choice 2).
- Times: additionally, an ANCHOR report in a fit spot is held out iff
  `int(sha256(spot_id + cell_start_iso + ":t1-anchor-holdout-v1"), 16) < 0.2 * 2**256`.
- Physical references (edit 2): a physical-reference row is held out iff
  `int(sha256(reference_id + ":t1-physical-holdout-v1"), 16) < 0.2 * 2**256`.
- The holdout is never seen by the fit, the size-term choice or any tuning.

## Gate (PASS = all; NOT RUNNABLE until the floor below is met)

Floor to run at all: >= 30 cells per spot class (B2 classes) each with >= 2 INDEPENDENT observers or >= 1 active
anchor, in BOTH fit and holdout. INDEPENDENT (edit 6) = a different account AND a different device AND not the same
check-in group or session id where one exists (friends surfing together are correlated even across accounts). Where
no group id exists, the clustering is REPORTED as a sensitivity: the gate re-run with same-spot reports within 30 min
of each other collapsed to one. Below the floor: report "NOT RUNNABLE" with the counts,
fit nothing.

Items 1 and 2 score the PREDICTED REPORT, not T (edit 1): a held-out anchor report is y = T k_z k_set P e^{b_j} e,
so the model predicts that report (the posterior predictive, including sigma_j) and is compared with it. The naive
baseline gets the same treatment (its predicted report for the same observer). Otherwise P's offset (~0.6) would sit
inside the MAE, and coverage would be checked on an interval without observation noise.

1. Accuracy: MAE of log(predicted report) vs log(held-out anchor report), per spot class; must beat the naive
   baseline (the cell's median raw entry converted with the declared scale, mapped to the same observer's report) by
   >= 10% with a day-block bootstrap 95% CI excluding 0.
2. Calibration: 80% posterior-predictive interval coverage of held-out anchor reports in [0.75, 0.85], pooled and per
   class.
3. Bias by role reported (not gated), with CIs.
4. If physical-reference rows exist (>= 20): P's posterior must move off the prior (posterior sd < 0.7 x prior sd);
   otherwise every output is labelled "anchor-scale face height" and no absolute claim is made.

WHAT A PASS CERTIFIES (edit 2): consistency on the ANCHOR SCALE (the model predicts what a trusted observer reports
at a place and time it has not seen), NOT physical accuracy. Physical accuracy is REPORTED, not gated, here: with
>= 20 physical-reference rows, the error of (T x k) against the hash-held-out physical references, with its CI. It
becomes a gate only through a later amendment that registers a line BEFORE any result.

## Controls (VOID if any fails)

- Negative: shuffle observer ids within role; the variance of b must collapse toward 0 (tau shrinks by >= 50%).
- Positive: inject a synthetic observer at +30% on real cells; its b must be recovered within its 95% CI, AND P's
  posterior must be unchanged within its CI (edit 5: catches the anchor constraint leaking bias into P).
- Leak check: the holdout spots and cells never appear in the fit input (asserted in code, logged as counts).

## Anchor monitoring (registered now; an alert, not part of the fit gate)

- Common-bias drift: rolling 30-day mean of anchor residuals against physical references; ALERT when |mean| > 15%
  with a 95% CI excluding 0 (shown on the admin Model tab).
- Per-anchor reliability over time: rolling sigma_j and b_j; an anchor whose |b| exceeds 25% for 30 days is flagged
  for an admin to consider probation (an admin decides; the model never changes a status).

## Runs, versions, rollback

Every fit writes a versioned run (model version, data cut, seed, gate verdict, counts, controls) to private storage;
the admin Model tab shows the runs and which is ACTIVE as truth for gates. Rollback = point ACTIVE at an earlier run.
A run that fails a control is VOID and can never be made active.

## Not decided here

The B2 spot-class scheme itself (the research lead's), the physical-reference ingestion (T2 Sentinel-2, buoy match),
and anything served. Amendments go below, dated, BEFORE any result they could change.
