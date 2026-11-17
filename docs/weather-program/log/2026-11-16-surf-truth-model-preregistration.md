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

## 2026-11-16 23:25Z AMENDMENT 1: the export is row-level and pseudonymized (BEFORE any data or fit)

The Data section said the fit reads "the private aggregate-only export". That wording was wrong: the model needs one
row per observation. The export (T1 P4, `services/surf_truth_export.py`) is ROW-LEVEL and PSEUDONYMIZED: identities
are HMAC-SHA256 keys under a key held only in the environment, and no name, profile id, device or photo position,
photo URL or converted height leaves. It lives in PRIVATE storage only. "Aggregate-only" applies to anything shown
outside private storage (the admin views are counts only). Nothing else in this registration changes.

## 2026-11-16 23:55Z AMENDMENT 2: the advisor's red-team items A-M (BEFORE any data or fit)

Advisor note `redteam-989-surf-truth-model-prereg-2026-11-16.md` (shared notes), items A-M, registered here before any
blind observation exists. Where this amendment and the text above differ, this amendment governs.

- A. Target excluded, scoreable cells. The held-out target report is excluded from the inputs of BOTH the model and the
  baseline. A cell is SCOREABLE for gate items 1-2 only if it has the target anchor report plus >= 1 other INDEPENDENT
  report (independence as defined above). The runnable floor counts SCOREABLE cells, not cells.
- B. Inputs at scoring. All model parameters (P, b, sigma, mu, tau, the scale and set factors, any kept candidate term)
  come from the FIT only. At scoring, the held-out cell's OTHER (non-target) reports are inputs: the model conditions on
  them to infer that cell's T and then predicts the target report. An observer seen only in the holdout gets the role
  prior for b and sigma.
- C. Naive baseline, one definition. Baseline face height = the median of the cell's other raw entries, each converted
  to face metres by its DECLARED scale only (face x 1, Hawaiian x 2; a range at its geometric centre, "8ft+" at 8 ft).
  Its predicted report = that face height converted back to the TARGET's declared scale. No model parameter (no P, no
  b, no set factor) enters the baseline.
- D. The gated fit is the BAYESIAN fit (NumPyro, NUTS, 4 chains, R-hat < 1.01 and bulk ESS > 400 on P, mu and tau,
  and no more than 0.1% divergent transitions after warmup, or the run is VOID). Its posterior predictive integrates parameter uncertainty and sigma_j. EM is used only to
  initialise and to diagnose; an EM interval is never gated.
- E. One look per version. One scored run per model version. A model version committed after ANY scored result is
  scored only on holdout rows RECEIVED AFTER that version's commit time. The data cut for the first scored run is the
  first daily cut at which the floor is met (not chosen); it is recorded with its counts.
- F. Calibration. Gate item 2 is POOLED coverage in [0.75, 0.85]. Per class: the Wilson 95% interval of coverage must
  include 0.80. Coverage of an interval entry (a range, or a typed number read as an interval at the rounding width of
  its precision AS TYPED: an integer +-0.5 of its unit; a half value x.5 +-0.25; any other one-decimal value +-0.05)
  uses a RANDOMIZED PIT (seed 20261116): draw u uniformly between the predictive CDF at the
  entry's low and high edges; the entry is covered iff 0.1 <= u <= 0.9. Right-censored "8ft+": draw u in [CDF(8 ft), 1].
- G. Minimum anchors. The floor additionally requires >= 3 ACTIVE anchors, each contributing held-out scoreable
  reports. Items 1-2 are also reported PER ANCHOR (not gated per anchor).
- H. Flags as a term. The noise of observation i is sigma_j x m_{g(i)}, with flag class g in {clean, unverified
  location (gps_missing, or media_unverified without exif ok), range_only}; m_clean = 1; the others have half-normal
  priors on (m - 1) >= 0, so flagged rows are down-weighted, never up-weighted. Rows with an exclusion flag (Data
  section) still do not enter.
- I. Controls. Negative: the fit with observer ids shuffled within role must NOT score better than the real fit on the
  holdout MAE (VOID if it does); the tau shrink is REPORTED, not gated (real observers may already be nearly unbiased).
  Positive: one synthetic observer with exactly 40 reports on real fit cells, multiplicative +30%, log-noise sd 0.15:
  its b's 95% interval must EXCLUDE 0 and contain log(1.3), and P's posterior must stay within its CI (as above).
- J. Intervals. Bootstrap CIs (seed 20261116) resample by day blocks AND, separately, by anchor; both are reported and the WIDER governs.
  The number of blocks is printed; with fewer than 20 day blocks or fewer than 5 anchors, any passing line is labelled
  FRAGILE.
- K. What a PASS does not certify (added): ENTRY is blind, SAMPLING is not. People report on days they chose to go,
  partly from the forecast, so cells are a forecast-selected sample (over-forecast days observed, under-forecast flat
  days missed). Any forecast-versus-truth number from this stream carries that label.
- L. Physical references. No physical-reference row enters any fit until an amendment registers, for each kind, its
  definition and its mapping to H1/10 (a single photographed wave is not H1/10; a buoy is offshore and needs its own
  transform). Until then P stays at its prior and every output is "anchor-scale face height".
- M. Clock correction. The header's "17:45 EST" is the time written in the research lead's sign-off message, not a
  clock reading. The sign-off message preceded the first commit (99c423124, 17:37:13 EST by git); git's time is
  authoritative.

Research lead signed off amendment 2, 2026-11-16 17:52:05 -0500 (local clock at commit), with edits a-b: (a) D also VOID on more than 0.1% divergent transitions after warmup; (b) F rounding width from the precision as typed, and fixed seeds (20261116) for the PIT and the bootstraps.

## 2026-11-16 22:56Z CLOCK CORRECTION (header read from `date -u`)

The times in this file's earlier headers were ESTIMATED, not read from a clock, and the advisor caught them running
ahead (lesson L-P10). Corrected here, append-only:
- "AMENDMENT 1 ... 23:25Z": committed f458a641e at 2026-11-16 22:46:55Z. The header ran 39 minutes ahead.
- "AMENDMENT 2 ... 23:55Z": committed a91c1f6dc at 2026-11-16 22:52:09Z. The header ran about 63 minutes ahead.
- The original "signed off 17:45 EST": see amendment 2 item M (the sign-off message preceded the 17:37:13 EST commit).
The authoritative time of every section is its git commit time. Both amendments were still registered BEFORE any data
or fit (no blind observation existed at either commit). From here on, every header time in this lane is read from
`date -u` at the moment of writing.

2026-11-16 23:00Z (from `date -u`) DEFINITION, before any data: for gate item 1, a range or bucket TARGET is scored at its geometric centre in the target's declared scale, as the baseline does; "Flat" at the midpoint of [0, 0.5] ft; "8ft+" at its floor, 8 ft. MAE is therefore defined for every target. (Both amendment header times are corrected above, at e8157765f: amendment 1 committed 22:46:55Z, amendment 2 committed 22:52:09Z.)

## 2026-11-16 23:27Z AMENDMENT 3: what the fit's code review settled (from `date -u`; BEFORE any data or run)

The research lead reviewed the fit code (#992 at dd10ee260) against this registration and accepted four choices on
condition they are registered; this amendment does that and registers the review's required readings. No blind
observation exists. Where this differs from the text above, this governs.

1. P and u. Without physical-reference rows the model samples the identified u = log(T x P) ("anchor-scale face
   height") and does not sample P; P's posterior is its prior. Amendment 2 D's R-hat/ESS rule on P is therefore
   VACUOUS while P is prior-only (it applies to mu, tau and the scale and set factors). HARD GUARD: a run that finds
   ANY physical-reference row refuses until a model that samples P is registered by a further amendment.
2. Cell clock. Cells use local SOLAR time (UTC + longitude/15 h) instead of "local spot time": the export carries no
   time zone, and solar time gives every spot the same daylight rule.
3. Anchor group. An observer belongs to the anchor group (whose mean b is 0) iff ANY of its fit rows was filed while
   it was an ACTIVE anchor: bias is a property of the person, so rows filed before activation share its b. Scored
   targets remain only rows filed while ACTIVE (status at received_at). Changes of bias over time are the drift
   monitor's job.
4. Independence, STRICT reading: two reports are independent only if their accounts differ AND both device keys are
   KNOWN and differ. An unknown device cannot satisfy "different device"; if that starves the floor, the run says so.
5. Scoring update (amendment 2 B). For a held-out target, the baseline AND the model's update on the cell's T use ONLY
   the cell's other reports that are independent of the target (strict reading above). The update is a per-draw
   Gaussian update on u from those reports at their declared scale; it IGNORES the random walk to neighbouring cells
   (conservative: no borrowing across cells at scoring). Right-censored "8ft+" reports are DROPPED from the update
   (they never enter as a point); a bounded range enters at its scoring point with variance (log-width)^2/12;
   "Flat" enters at 0.25 ft with the variance of a log-uniform on [0.125, 0.5] ft, i.e. (ln 4)^2/12.
6. Gate item 1 is applied PER SPOT CLASS, as registered: each class needs improvement >= 10% AND the governing (wider
   of day-block and anchor) bootstrap 95% CI's lower bound > 0. The pooled figure is reported.
7. Sensitivity (edit 6), reported, not gating: the gate re-run with same-spot reports within 30 minutes collapsed to
   one. Also reported, not gating: the negative control's tau shrink, and the convergence diagnostics of the
   shuffled and synthetic fits.
8. Before the FIRST real run (not before the code merges): a synthetic world of realistic size must reach R-hat
   < 1.01 and bulk ESS > 400 at the registered 4 x 1000, recorded in the fit log.

## 2026-11-17 00:00Z AMENDMENT 4: the advisor's red-team of the fit code (from `date -u`; BEFORE any data or run)

Advisor note `redteam-992-surf-truth-fit-code-2026-11-16.md` (shared notes). No blind observation exists. Where this
differs from the text above, this governs.

1. Negative control, corrected (it replaces amendment 2 I's negative rule): the run is VOID only if the shuffled-
   identity fit is SIGNIFICANTLY better than the real fit: a paired bootstrap over the SAME scored targets (day blocks,
   seed 20261116) of (shuffled improvement - real improvement) has a 95% interval entirely above 0. "Must not score
   better" alone would void a sound run about half the time when observers are nearly unbiased.
2. Positive control: "P's posterior unchanged" is VACUOUS while P is not sampled (amendment 3.1); it binds once a model
   that samples P is registered. The b-recovery part stands.
3. Convergence applies to ALL THREE fits (real, shuffled, synthetic): if any fails amendment 2 D's rule, the run is
   VOID (a non-converged control fit can pass or void a control by accident).
4. Floor over EVERY registered class: a class in the registered B2 scheme with fewer than 30 + 30 scoreable cells
   makes the run NOT RUNNABLE, including a class with none. Item 1 is per class (amendment 3.6), as is item 2's
   Wilson check; the pooled figures are reported.
5. Amendment 2 E, operational: the model version is the git commit of the code that runs, from a CLEAN working tree
   (a dirty tree refuses). Every scored run record is kept. A run is given the earlier scored records; if any earlier
   scored run used a different model version, only held-out targets RECEIVED AFTER this version's commit time are
   scored. The first scored run is the first daily cut that meets the floor.
6. Overlapping exports: when a row appears in several exports, the copy from the NEWEST cut is used (a later status,
   such as a failed audit, wins).
7. Near-zero entries: a typed value below 0.5 ft (0.15 m) is treated as "Flat" in both the likelihood and scoring.
8. Randomness: each target's predictive draws and its PIT draw use a stream seeded from (20261116, row_key), so one
   target's result never depends on how many targets were scored before it.
9. The review reference: `--review-ref` must name a research-lead review of the exact code commit being run
   ("#992 reviewed at <sha>"), and the run refuses if that sha is not the running commit.
10. The model code's tests do not run in CI (JAX is not installed there); the lane runs them in its fit environment
    before every review and before every run, and each run record carries that test result.

## 2026-11-17 00:14Z AMENDMENT 5: model version by code tree; one scored run per version; required run store (from `date -u`; BEFORE any data or run)

From the research lead's re-review of the fit code (#992 at 700b748e0). No blind observation exists.

1. MODEL VERSION = the git TREE of `backend/scripts/surf_truth` at the commit that runs (`git rev-parse
   HEAD:backend/scripts/surf_truth`), not the commit itself: identical code is the same version, so merging #992 (a new
   commit, the same code) neither demands a re-review nor counts as a new version under 2 E / 4.5. The run still records
   the commit and refuses a dirty tree under that path.
2. REVIEW CHECK (replaces 4.9's "names the running commit"): `--review-ref` must name a reviewed sha, and the run
   refuses unless the code under `backend/scripts/surf_truth` is IDENTICAL at that sha and at the running commit
   (`git diff --quiet <sha> HEAD -- backend/scripts/surf_truth`).
3. ONE SCORED RUN PER VERSION (2 E, now enforced): every run record is written to a REQUIRED private run store (a
   directory; `--run-store`), and every earlier record in it is read. If any earlier SCORED record has this run's
   model version, the run refuses. If an earlier scored record has another version, only targets received after this
   version's first commit time are scored (4.5). The store is not optional: omitting earlier records cannot bypass 2 E.
4. Export cut order (4.6) is by the parsed instant of `cut_at`; an export manifest without `cut_at` is refused.
