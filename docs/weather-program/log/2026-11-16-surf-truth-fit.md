# 2026-11-16 Surf-truth fit: the code for the pre-registered model (session `surf-truth-checkins-e7abf2`)

## 2026-11-16 23:18Z (from `date -u`) Built, tested on synthetic data only; NOT RUN on real data

Director's assignment: this lane builds the P4 export (#990) and the fit; the research lead reviews the fit against
#989 BEFORE ANY RUN (builder and checker apart). The registration is #989 + amendments 1-2 + the appended
definitions. No blind observation exists yet, so nothing real can be fitted; the runner also refuses without a
recorded research-lead review, without a registered B2 class scheme, and below the floor (NOT RUNNABLE, nothing fitted).

Code: `backend/scripts/surf_truth/` (prep, gate, controls: numpy only; model: NumPyro; run: the CLI). Dependencies
in `backend/requirements-surf-truth-fit.txt`, installed by no production or CI lane.

ONE MODELLING CHOICE FOR THE RESEARCH LEAD'S REVIEW (it follows the registration's own words, but it is a choice):
the registration says that without physical-reference rows P stays at its prior and only T x P is identified. A first
synthetic run that sampled P and T separately mixed along that unidentified ridge (2 chains x 300: R-hat 1.12, bulk
ESS 20), so every real run would have been VOID by amendment 2 D. The model therefore samples the identified
u = log(T x P) ("anchor-scale face height") and does not sample P until physical rows exist (none may enter before
amendment 2 L); P's posterior is its prior, reported as such, and its convergence check is vacuous. Same synthetic
world after the change: R-hat 1.03, ESS 127 at 2 x 300; the +30% observer's b = 0.265 [0.234, 0.293] vs log 1.3 = 0.262.

Scoring-stage approximations (amendment 2 B), also for review: T of a held-out cell is a per-draw Gaussian update on
log T from the cell's other reports at the declared scale (the 10% scale mixture is applied only to the target's
prediction); a range enters at its scoring point with variance (log-width)^2/12; an observer unseen in the fit takes
its role prior. Cells use local SOLAR time (UTC + lon/15 h): the export has no time zone.

Evidence (fit environment, Python 3.12, numpyro 0.15.3, jax 0.4.30, numpy 2.0.2): 24 tests pass. CI runs the 21
numpy-only rule tests; the 3 model tests skip there (no JAX) and are run by this lane before any review or run:
anchor-relative biases recovered with the anchor-mean constraint exact; the registered positive control (40 reports,
+30%, log-noise 0.15) passes; predictive coverage of reports on a held-out synthetic spot is within [0.65, 0.95].

## 2026-11-16 23:34Z (from `date -u`) Research lead review of dd10ee260: R1-R6 and M1-M2 done; amendment 3 registered first

The research lead requested changes (R1-R6) and accepted the four choices on condition they are registered:
amendment 3 on #989 (1e1e09595, 23:27:20Z) registers them and the review's readings BEFORE any data. Code now:
R1 gate item 1 per spot class (improvement >= 10% and the governing CI's lower bound > 0, per class; pooled reported).
R2 strict independence (an unknown device is not independent). R3 the 30-minute session-collapse sensitivity runs
and is recorded. R4 the baseline and the model's update use only reports independent of the target. R5 "8ft+" is
dropped from the scoring update; Flat carries a log-uniform [0.125, 0.5] ft variance. R6 the leak check covers every
row of held-out spots plus held-out anchor targets. M1 tau shrink and M2 diagnostics of the shuffled and synthetic
fits are recorded. Guard (amendment 3.1): any physical-reference row refuses the run.
Tests: 30 pass in the fit environment (27 numpy rule tests, also in CI; 3 model tests). M3 (4 x 1000 on a realistic
synthetic world) is running and is owed BEFORE the first real run; its result is appended here when it lands.

## 2026-11-16 23:40Z (from `date -u`) M3: the registered 4 x 1000 converges on a realistic synthetic world

`synthetic.world(spots=10, days=20, seed=21)`: 3,200 rows, 800 cells, 8 observers (4 anchors). At the registered
4 chains x 1000 warmup x 1000 samples (seed 20261116): R-hat max 1.006 (< 1.01), bulk ESS min 799 (> 400), divergent
fraction 0.000 (<= 0.001): CONVERGED by amendment 2 D. Wall time 445 s on this laptop (CPU). LIMIT: 8 observers; a
real stream has many more per-observer parameters (b_j, sigma_j), which costs sampling time and may lower ESS, so the
first real run's own diagnostics decide (VOID if they fail), and run time should be re-measured then.

## 2026-11-17 00:10Z (from `date -u`) Advisor red-team of the fit code: amendment 4 registered first, then the code

The advisor read dd10ee260 (before the research lead's fixes; items 2, 3 and two smaller ones were already fixed at
aa0505456). Amendment 4 on #989 (83d09b81f, 00:00:32Z) registers the rest before any data. Code: the floor counts EVERY
registered class (one with no data blocks the run); all three fits must converge or the run is VOID; the run takes its
model version from a CLEAN git tree, requires the review to name that exact commit, runs the model tests first and
records the result, and scores only targets received after its commit when an earlier version has been scored; the
newest export copy of a row wins; the negative control voids only when the shuffled fit is significantly better
(paired day-block bootstrap); typed values under 0.5 ft are Flat; each target has its own random stream.
Tests: 37 pass in the fit environment (34 numpy rule tests, also in CI; 3 model tests). The research lead's review at
aa0505456/cfdaa4907 does NOT cover this code: a new review is requested.

## 2026-11-17 00:18Z (from `date -u`) Research lead re-review: R7, R8 and both recommendations; amendment 5 registered first

Amendment 5 on #989 (fda3f7c0d, 00:14:08Z). Code: the model version is the git TREE of scripts/surf_truth (identical
code = same version, so merging #992 needs no re-review and is not a new version); --review-ref must name a sha whose
surf_truth code is identical to the running code (git diff --quiet <sha> HEAD); every run record goes to a REQUIRED
private --run-store and every earlier record there is read; a second SCORED run of the same version refuses (R7);
export cuts are ordered by parsed instant and a manifest without cut_at is refused (R8). Checked against real git in
this worktree: a dirty tree refuses; an unknown reviewed sha refuses. Tests: 36 numpy rule tests pass (also in CI).
