# Gate: self-improving-loop-v1 (DESIGN, pre-registration style)
Stamp: 2026-11-23T18:40:17Z (research lead, on the director's assignment, from David's ask to put "the researchers to work with the inspector… toward SOTA". DESIGN ONLY: nothing is built, and no threshold below has been computed on data.)
Candidate: the three missing pieces of the self-improving loop that the Fable inspection found (SOTA-GAP-INSPECTION-2026-11-23, findings 6-8): (A) drift alerts, (B) a challenger-vs-champion job that writes PROPOSALS, (C) an admin view of verification and skill.
Metric: one PRIMARY metric per served surface (section 2), used by all three components. Each alarm and each proposal reads only that surface's primary metric; secondaries are display only.
Pass threshold: this design "passes" when its acceptance controls hold on replayed history (section 7): in-control replay stays within the false-alarm budget, a planted drift alarms within its delay bound, an A/A challenger never proposes, and a planted better challenger does.
Controls: section 7 (an in-control replay; planted drift; an A/A challenger; a planted-better challenger; the LOCKED-read audit).
Decision rule: the loop NEVER switches anything. Alarms open issues; challengers write proposals; the owner decides (D-087's HYBRID pattern: evidence bound to feature + version + commit, no auto-enable). A component ships only after its acceptance controls pass and its prerequisites (section 0) have landed.
Unmeasured items: the surf rating's quality (blind check-ins are too sparse for a daily alarm today, so it is a weekly display, not an alarm); currents (no scheduled truth yet); thresholds (computed later from pre-onset history, section 2.3).
Served change: none. The loop has no write path to any served value, flag, manifest, repo variable or environment.

## 0. Prerequisites (must land FIRST; the inspection's P0s)
1. **The owner check on every switch path** (inspection finding 1): `owner_reenable` compares the actor with the owner, and `clear` no longer restores a code default (#1221, #1223, D-087's `version_hold`). Until then, a loop that writes "proposals" sits one step from a path that can flip.
2. **The LOCKED fence at ONE shared buoy-read function** (inspection finding 2). Every consumer reads buoy observations through it, and it refuses LOCKED station ids outside a logged, pre-registered look. Today only `served_wave_verify_score.py` imports the holdout.
3. **D-072 decided by the owner** (it is proposed, not decided). Component A adopts its three rules as the level alarms. If the owner rejects D-072, component A keeps only its trend and per-buoy alarms.

## 1. Principles (fixed now)
- **Never flip.** No component has credentials to write `control/flags.json`, a repo variable or the Render env. The job token is `contents: read, issues: write` only, so even a bug in it cannot switch anything.
  - **No issue-triggered write path (review: Reflection, medium).** A CI test lists every workflow triggered by `issues`, `issue_comment` or `label`. It asserts that none has `contents: write`, `actions: write` or a variables/secret write, and that none dispatches the flag-guardrail or any publish workflow. An alarm or proposal issue can therefore never start a write.
- **The owner decides.** A proposal is a GitHub issue plus an evidence file; turning anything on is the existing owner-checked path.
- **Holdout:**
  - LOCKED buoys are never read except the single pre-registered look (`served-wave-skill-v1` §1a).
  - **Enforced at the data, not by convention (review: Reflection, high):**
    - The ONE shared buoy-read function refuses any request whose station set intersects LOCKED unless a pre-registered look token is passed, and logs every station id it serves.
    - Every derived product (scores, thresholds, CUSUM inputs, archive aggregates) carries the station-id list it was built from, so an aggregate that silently includes a LOCKED station fails a CI check.
    - A CI test runs each metric surface's builder with a seeded LOCKED id and asserts the refusal.
  - Challenger DECISIONS read VERIFY buoys only.
  - Alarms may read VERIFY and FIT-USED buoys (monitoring a calibrated product at its own training buoys is still monitoring), never LOCKED.
- **One primary per surface; thresholds pre-registered from history the threshold-setter has not judged.** This is the D-072 lesson: a bound proposed after seeing the episode it is meant to catch is not blind.
- **"Not measured" is never shown as zero or green.**

## 2. Surfaces, primary metrics, sources
| Surface | Primary metric | Truth | Source today (scheduled?) |
|---|---|---|---|
| Offshore Hs, served frames | Hs MAE (m), per model × region × lead bin, Tier B | NDBC, VERIFY buoys, shared QC | `served-wave-verify` scorer (scheduled, collecting) |
| Offshore Hs, point/`/point` lane | paired MAE vs the same-model control, per lead (D-072 rule 1) | NDBC | forecast-accuracy-monitor (scheduled, about 2 of 4 slots) |
| Wind (rating and map) | 10 m vector RMSE (kn) per region × lead; category hit rate reported | NDBC buoys and coastal stations | skill ledger wind lanes (scheduled) |
| Gust | gust MAE (kn) and the exceedance Brier score at 25 kt | NDBC GST | gust-verify (scheduled) |
| Tide level | water-level MAE (m) vs gauges, 25 h filtered residual reported | CO-OPS gauges | tide-own-series (scheduled) |
| Period | Tp MAE (s) per model, definition named | NDBC DPD | served-wave scorer (secondary) |
| Surf rating | level hit rate vs blind check-ins | #1151 blind field | WEEKLY display only (too sparse to alarm) |

### 2.3 How thresholds are set (before any build reads live data)
- **Calibration and validation are split BEFORE calibration (review: Reflection, high).**
  - Thresholds, CUSUM `h` and the per-buoy bounds are computed on CALIBRATION, 2026-08-15 to 2026-10-03 (7 weeks), from ROWS, not logged aggregates. LOCKED buoys are excluded.
  - They are frozen in `gates/self-improving-loop-v1-thresholds.json` with its SHA-256.
  - VALIDATION is the later, contiguous, untouched block 2026-10-04 to 2026-10-31 (4 weeks). It is used only by the acceptance controls (section 7), never to tune anything.
- **Season (review: SubQ 0.90, winter excess false alarms likely).**
  - The per-buoy rule uses a SEASON-NORMALISED error: the scatter index (RMSE over the mean observed value at that buoy), not raw MAE. A stormier winter raises both terms.
  - The CUSUM input is a PAIRED differential (served minus the same-model control or persistence), which removes the common seasonal level.
  - On top of that, the first 30 days of each new season (DJF, MAM, JJA, SON) run WARN-only for the per-buoy rule. A seasonal re-baseline is an amendment, set on that season's first 60 days.
- A surface without 60 days of rows in that window gets its window from its own first 60 collected days, labelled "self-baselined". Its alarms are WARN-only until a second, unseen 60 days confirms the bound.

## 3. Component A: drift alerts
Three alarm types per surface. Each opens or updates ONE GitHub issue per (surface, region, rule), labelled `weather-drift`, deduplicated until a human closes it. Every scored run's step summary prints all of them.
1. **Level alarms:** D-072's three rules as written, once decided (same-model regression; hole buoys with their own bound; best_match on common keys). Bounds are re-derived from the pre-onset rows as D-072 requires.
2. **Per-buoy alarm (closes the 46267 gap), WEEKLY on non-overlapping blocks (review: Reflection, medium).**
   - Once a week, on the last complete Monday-to-Sunday block (no rolling windows, so blocks do not overlap), a VERIFY or FIT-USED buoy is flagged when BOTH hold:
     - its scatter index exceeds its own calibration-window 99th percentile of weekly blocks;
     - its MAE exceeds an absolute floor (Hs 0.5 m; wind 6 kn; tide 0.15 m).
   - Each flagged buoy gets a p-value from its calibration weekly blocks (the empirical exceedance rank). Benjamini-Yekutieli at q = 0.10 runs across that week's buoys (valid under any dependence between buoys; section 11).
   - All flagged buoys of a week go into ONE issue (`weather-drift`, per-buoy, that week), never one issue per buoy.
3. **Trend alarm (slow degradation):** a one-sided CUSUM per (surface, region) on the daily paired loss differential (served minus the same-model control, or minus persistence where no control exists), standardised by the CALIBRATION mean and standard deviation, with k = 0.5.
   - The decision level h is set by block-bootstrap simulation of the CALIBRATION series (7-day blocks, so autocorrelation is kept) so that the in-control average run length is at least 500 days per chart.
   - **What the CUSUM sees:** because it reads a differential against the same-model control, it detects OUR regressions (decode, cell, fills, blends), not a degradation of the upstream model itself. Upstream degradation is caught by the level and per-buoy rules, which read absolute error.
4. **Health WARNs (no statistics):** pending-queue headroom >= 85 % of `PENDING_MAX_ENTRIES` (inspection finding 5); a scheduled scorer missing two consecutive slots; a scored run with n below its floor.

**One global budget, allocated now (review: Reflection, high; the first draft's arithmetic exceeded it). At most 1 statistical issue every 7 days, program-wide, in expectation under no real drift:**
| Rule | Allocation (issues per week) | How it is held |
|---|---|---|
| Trend CUSUM, at most 16 charts (section 11.2) | <= 0.224 | ARL0 >= 500 days per chart (16 × 7 / 500) |
| Per-buoy weekly | <= 0.10 | 1 batch a week, BY q = 0.10, so P(any false) <= 0.10 under the global null, one issue a week at most |
| D-072 level rules (3 rules × 3 leads) | <= 0.50 | each rule's bound set on CALIBRATION so that its daily exceedance rate there is <= 0.5 / 7 / 9 |
| Reserve | 0.176 | absorbs dependence between rules |
- The achieved rate is measured on VALIDATION before shipping (section 7) and reported monthly live.
- If achieved false alarms over 30 days exceed twice the budget, the rule with the most closed-as-false issues is paused (WARN-only) and reported. Its threshold is never re-tuned silently: a new bound is an amendment, set on new calibration data.

## 4. Component B: challenger vs champion (PROPOSALS only)
- **Registry:** `docs/weather-program/challengers.json`, one entry per candidate:
  - `id`, `flag`, `fix_version`, `commit`, `surface`;
  - the registered gate file whose primary metric, window, bar and controls it inherits;
  - `status`.

  A candidate without a registered gate cannot be entered. The job never invents a bar.
- **Job:** daily, after the skill ledger and scorers.
  - For each registered challenger it reconstructs the champion (the served config) and the challenger on VERIFY buoys only, paired by key.
  - It computes the gate's primary metric over the gate's fixed window. It looks ONCE, at the window's end. That is the decision look.
  - Daily, it also updates an anytime-valid confidence sequence on the mean paired loss differential (a mixture-martingale bound at alpha 0.05). The sequence is used ONLY for display and for an early HARM warning (its upper bound < 0 means the challenger is significantly worse), never to propose early.
- **A proposal is written when:**
  - the gate's bar is met at its decision look;
  - the gate's own controls pass;
  - the challenger is not worse in any region at the gate's floor.
- **What a proposal is:**
  - an evidence JSON bound to `id + fix_version + commit` (D-087), written to `verify/proposals/` with its SHA-256;
  - one issue labelled `weather-proposal`, with the table, the controls and the owner question in plain words.

  It writes nothing else.
- **Failure:** a FAIL is recorded and the challenger is retired for that version. Re-scoring the same window is forbidden; a new version is a new registration on new data.
- **Many challengers:** each decides on its own gate. Monthly, a program-level report counts proposals against the expected false proposals under the A/A null (the `rating-wind-coast-v1` amendment-1 pattern). It is reported, never decisive.
- **First registrants:** they are named as candidates only, each needing its own gate first: the EMOS gust calibration, the gust-risk hindcast, the peak-period flags (`peak-period-ship-v1`), the wind-lr2 lane, and the tide gates.

## 5. Component C: admin view (specification for the admin-truth build lane)
Read-only panels. Every number has its n, window and timestamp. Missing data reads "not measured".
1. **Skill:** each surface's primary metric with its interval, per model, region and lead, plus a sparkline of the last 90 days.
2. **Alarms:** open `weather-drift` issues with links; health WARNs; the false-alarm budget used this month.
3. **Challengers:** registry status (collecting / insufficient / proposal / failed / retired), the confidence sequence, and the proposal link.
4. **Flags:** the coverage class per flag (REPLAY / RATING / BLIND, from `flag_guardrail.py`), the lane value as actually set (inspection finding 3), and the manifest state.
5. **Holdout:** LOCKED list SHA, the frozen date, and the count of logged LOCKED reads (0 expected).
6. **Read-backs:** overdue commitments from `memory_audit`.
- **Data path:** the public score tables and issue API only. No service-role key in the browser (as `served-wave-verify-v1` §7a requires).
- Three themes and accessibility per the project rules.

## 6. Holdout and multiplicity summary
| Who reads | VERIFY | FIT-USED | LOCKED |
|---|---|---|---|
| Alarms (A) | yes | yes | never |
| Challenger decisions (B) | yes | never | never |
| Admin display (C) | yes (labelled) | yes (labelled) | count of reads only |
| Pre-registered SOTA look | no | no | once, 2027-03/04 |

## 7. Acceptance controls (each must pass before its component ships; replayed offline, never against the live box)
1. **In-control replay on VALIDATION** (2026-10-04 to 2026-10-31, contiguous and later than CALIBRATION, never used to tune). Statistical issues must stay within the allocated budget per rule and in total (<= 1 per 7 days). Achieved rates are reported per rule.
2. **Planted drift, injected into the SERVED forecast-error stream** (never into observations or the control): add +0.20 m Hs (and +3 kn wind) to one region's served values from a fixed date in VALIDATION.
   - The CUSUM must alarm within 14 days, and the level or per-buoy rules within 14 (two weekly blocks for the per-buoy rule).
   - Both delays are reported. Power is simulated beforehand on CALIBRATION (the delay distribution over 200 placements), and the bound is set from that simulation, not from VALIDATION.
3. **A/A challenger:** register the champion as its own challenger. Over a 90-day replay it must never produce a proposal (and its confidence sequence must cover 0).
4. **Planted-better challenger:** the champion with its known error halved in every region on one surface must produce a proposal at its decision look. The "not worse in any region" rule uses each gate's own non-inferiority margin, so the halving cannot be blocked by noise in one region.
5. **LOCKED audit:** a test seeds a LOCKED id into the data. Every component must refuse it, and the fence must log the attempt.

## 8. Build order and owner decisions
- **Build order:** (0) prerequisites; then A (needs D-072 decided); then B (needs the registry and at least one gate-registered challenger); then C (by the admin-truth lane, reading A and B's outputs).
- **Owner decisions this design needs:**
  - adopt D-072;
  - the program false-alarm budget (proposed: at most 1 statistical issue a week);
  - whether drift issues also notify a channel beyond GitHub.

## 9. Limits
- **Buoys are offshore and sparse at some coasts.** Alarms cover what is measured.
- **Rating quality cannot alarm** until blind check-ins accrue.
- **Thresholds come from one season** (autumn). A winter re-baseline is an amendment after 60 winter days.
- **Anytime-valid bounds are wider** than a fixed look. That is why they are used only for display and harm warnings, never to propose.

## 10. Reviews (filled before freeze)
Asked 2026-11-23 with public context only. Answers are advisory; SubQ figures are model confidence, not statistics.
- **SubQ (snap-1.2):**
  - overall sound: 0.96;
  - weakest part: the threshold baseline (0.52), ahead of per-buoy FDR (0.24) and the CUSUM ARL (0.13);
  - fit-used buoys in alarms acceptable: 0.95;
  - an autumn-only baseline likely causes excess winter false alarms: 0.90. **Fixed:** scatter-index normalisation, paired differentials, a WARN-only first 30 days per season, and seasonal re-baselines (section 2.3).
- **Reflection (Beam-1.0, high), six findings, all taken:**
  1. Validation reused the calibration window (alternate weeks). **Fixed:** a contiguous CALIBRATION / later VALIDATION split, set before calibration.
  2. The false-alarm budget was arithmetically over (BH daily plus 15 CUSUMs at ARL 180). **Fixed:** one global budget allocated per rule (CUSUM ARL0 500, a weekly per-buoy test, level-rule bounds, a reserve), measured on VALIDATION.
  3. LOCKED could leak through aggregates. **Fixed:** refusal at the one read function, station-id provenance on every derived product, and a CI test per metric builder.
  4. The per-buoy rule on rolling windows was fragile. **Fixed:** weekly non-overlapping blocks, an empirical p from calibration blocks, and one issue a week.
  5. The acceptance controls were confounded. **Fixed:** drift is injected into the served stream only; the delay bound comes from a power simulation on CALIBRATION; the "not worse" rule uses each gate's non-inferiority margin.
  6. Issue-triggered automation could write. **Fixed:** a CI test asserts no issue- or label-triggered workflow has write permissions or dispatches the guardrail or publish workflows.
- **LongCat:** the single paid submit failed (network; billing outcome uncertain). Not retried; check its usage.
- **Still incoming:**
  - The inspector's facts (each scheduled scorer and its cron, the monitor's paging rule at file:line, every buoy-read path for the fence, the proposals location).
  - The researcher's literature (CUSUM/EWMA ARL under autocorrelation, anytime-valid confidence sequences vs Diebold-Mariano, FDR vs FWER for alerts, reusable holdout).

  They are folded into this file before freeze, and anything they change is listed here.

## 11. The unified statistical specification (Q14, #1230: SubQ, Reflection and LongCat all asked for one, before any build)
Q14 found the literature defaults conflicting, because they mixed error frameworks (per-stream ARL vs multiplicity, sequential vs fixed-look, BY discovery sets feeding actions, i.i.d. holdout reuse). This section fixes ONE framework per decision type and says why they do not interact.

### 11.1 Data-generating assumptions (each one is checked; a failed check changes a named parameter, never silently)
- **A1, stationarity within a season after normalisation.**
  - The daily paired loss differential per chart, and the weekly scatter index per buoy, are weakly stationary within a season.
  - Check: on CALIBRATION, a block-bootstrap test for a mean shift between its two halves at p >= 0.05. A chart that fails is excluded and listed. It is not re-tuned.
- **A2, dependence dies out within 7 days.**
  - Check: the lag-7 autocorrelation of each chart's CALIBRATION series is < 0.2.
  - If ANY stream feeding a rule fails, that rule's block length becomes 14 days EVERYWHERE it is used. Its CUSUM h, per-buoy calibration distribution, level-rule bound and harm-sequence weekly-mean construction (14-day block means) are all re-derived. Recorded per rule. (Review: Reflection; the first text re-simulated only h.)
- **A3, cross-stream dependence is unrestricted** (shared synoptic weather). Never assumed independent: every simulation resamples ALL streams with the SAME block draw.
- **A4, the observations are not affected by the forecasts** (no feedback). This holds for buoys and gauges.

### 11.2 The four decision types, each with ONE error target
| Type | Hypothesis | Timing | Error target | Why it does not mix with the others |
|---|---|---|---|---|
| A-trend (CUSUM) | H0: the chart's mean paired differential equals its CALIBRATION mean | daily | a false-ISSUE RATE (the budget in section 3), not FWER or FDR | Alarms take no served action. The target is operational and is measured, not derived. |
| A-buoy (weekly) | H0_b: buoy b's weekly scatter index comes from its CALIBRATION weekly distribution | weekly, one batch | FDR <= 0.10 within the week's batch (BY); under the global null this is P(any false) <= 0.10 | The BY family is exactly "the buoys scored that week". It is never applied to a sequence of days or to CUSUM output. |
| A-level (D-072) | per D-072 | daily | each rule's EXPECTED FALSE ISSUES PER WEEK, set to its budget share by simulation (checks, dependence and issue dedup included; review: Reflection), not a per-check exceedance rate | It is a fixed bound, not a test statistic; its simulated issue rate goes into the same budget. |
| B-decision (challenger) | the gate's own H0, e.g. challenger loss >= champion loss + margin | ONE fixed look at the gate's window end | the gate's own FWER (alpha 0.05, Holm within the gate's family) | It is fixed-horizon. No repeated looks feed it, and no discovery set feeds it. |
| B-harm (advisory) | H0: challenger mean loss <= champion mean loss | weekly | anytime-valid, P(ever falsely warn) <= 0.05 | It triggers only a WARNING on the issue, never a decision or a served action. |

- **The family, enumerated (LongCat's point):**
  - The CUSUM charts are the (surface, region) pairs listed in `self-improving-loop-v1-thresholds.json`, at most 16: served Hs × 5 regions, wind × 5, gust × 3, tide × 3. That is not 1,800 streams.
  - Models and lead bins are NOT separate charts. The chart reads the served (consensus-of-record) stream at its primary lead bin.
  - Per-model, per-lead views are display only. Adding a chart is an amendment, and it re-runs the budget simulation.
- **Why BY's FDR still fits a COUNT budget (review: Reflection rated "severe"; answered by construction, not changed):** all buoys flagged in one week go into ONE issue (section 3). Two cases:
  - Under the global null (no real drift anywhere), BY at q makes P(any flag) <= q. So the expected false per-buoy ISSUES per week are <= 0.10.
  - When some buoys really drift, false flags join the same week's already-justified issue and add no issue.
  - The issue count therefore stays within the 0.10 share. The 11.5 simulation measures it directly.
- **Several challengers on the same surface (review: Reflection):** challengers that decide in the same calendar quarter on the SAME surface share VERIFY data and the same action space, so they form one Holm family at alpha 0.05 at their decision looks.
  - A proposal needs its own gate's bar AND to survive this Holm overlay.
  - Different surfaces are separate decisions. The 8-per-quarter cap and the monthly A/A-null report stay.
- **No discovery set feeds an action:** a proposal comes only from a pre-registered challenger's own gate, never from "whatever the alarms flagged". This resolves Q14 conflict 4.

### 11.3 Exact constructions
- **CUSUM:**
  - `S_t = max(0, S_{t-1} + z_t - k)`, with `z_t` the daily paired differential standardised by its CALIBRATION mean and standard deviation, `k = 0.5`. It alarms when `S_t > h`.
  - **Reset rule (automatic, so the simulated rate does not depend on human timing; review: Reflection):** at an alarm, S is set to 0, and that chart is SUPPRESSED for 14 days. It keeps computing and displays, but cannot open a second issue.
    - After 14 days it may alarm again, and a new alarm comments on the open issue rather than opening another.
    - Human closure of the issue affects only the issue, never S.
    - The simulation implements exactly this rule.
  - `h` is chosen per chart so that the simulated in-control ARL0 is >= 500 days. The simulation resamples CALIBRATION in 7-day blocks, with all charts' common block draw (A2, A3) and the reset rule included.
- **Per-buoy:** the p-value of buoy b in week w is the empirical upper-tail rank of its scatter index among its CALIBRATION weekly blocks: `(1 + #{calib >= x}) / (1 + n_calib)`, then BY at q = 0.10 over the buoys scored in week w.
- **Harm confidence sequence:** on WEEKLY block means of the paired loss differential (one value per 7-day block, so A2 makes them approximately independent), a normal-mixture confidence sequence (Howard et al. 2021 form) with variance proxy `sigma^2` estimated on CALIBRATION blocks and multiplied by 1.5 for safety, alpha 0.05, one-sided.
  - This is an ASSUMPTION-based construction, sub-Gaussian weekly means. It is validated by simulation (11.5), not claimed by theorem for autocorrelated daily data.
  - **If the validation fails (SubQ: the weakest remaining part, 0.85):** a pre-registered widening procedure runs on CALIBRATION only. The variance multiplier is raised from 1.5 in steps of 0.25 until the simulated false-warning rate is <= 0.05. The final multiplier is frozen in the thresholds file.
  - If no multiplier up to 4.0 passes, the harm warning is dropped for that surface and reported. That is safe, because it is advisory only.
  - A Harvey-corrected Diebold-Mariano test on the same window is printed beside it as a diagnostic, never as a decision (Q14 B).

### 11.4 Holdout interaction (Q14 D; LongCat's "reusable holdout is i.i.d." point accepted)
- **No reusable-holdout mechanism is used.** Its guarantees (Dwork et al. 2015) assume i.i.d. samples, which forecast errors are not.
- **Instead, VERIFY reuse is bounded and disjoint in time:**
  - each challenger's decision window starts after its registration and after any window used to design or tune it;
  - at most 8 challenger decisions may use any one calendar quarter of VERIFY data, logged and reported.
- **LOCKED:** one pre-registered look, champion and challenger(s) on the SAME LOCKED window. Drift then affects every arm alike: the look compares arms, not absolute levels.
  - Staleness is a limit: a LOCKED result speaks for its window's season.
- **Alarms never read LOCKED** (section 1). An alarm opened on a surface does not let a challenger on that surface use pre-registration data: its window still starts after its own registration.

### 11.5 Validation of the specification itself (added to section 7's acceptance controls)
1. **Full-pipeline null (Q14 next check 1).** Simulate 1,000 years of in-control operation by block-resampling CALIBRATION with the common block draw, running EVERY A rule with its look frequency, reset rule and BY layer.
   - The realised false-issue rate per rule and in total must meet the budget. Achieved rates are reported.
   - Then replay VALIDATION once, as section 7(1) says.
2. **Selection pipeline on null data (Q14 next check 2).** Simulate registering 8 A/A challengers per quarter for 8 quarters, with harm warnings and decisions. Report:
   - the realised false-proposal rate, which must be <= 0.05 per challenger;
   - the realised false harm-warning rate, which must be <= 0.05 over each challenger's horizon.
3. **Drifting synthetic data (Q14 next check 3).** Run a slow linear drift (0 to +0.2 m over 60 days) on VALIDATION. Report the detection delay of each A rule, and confirm that no B decision changes when the drift is common to both arms.

### 11.6 Reviews of this specification (2026-11-23; public context only)
- **SubQ (snap-1.2):**
  - coherent now: 0.99;
  - weakest remaining part: the confidence-sequence assumption (0.85). **Fixed:** a pre-registered widening procedure, or the warning is dropped (11.3);
  - block-bootstrap simulation an adequate validation: 0.90.
- **Reflection (Beam-1.0, high):** "mostly yes" on coherence. Five findings:
  1. BY's FDR vs a count budget (rated severe). **Answered by construction:** one issue a week, P(any) <= q under the global null; the simulation measures it.
  2. The A2 fallback re-derived only h. **Fixed:** it now applies to every rule.
  3. The CUSUM reset depended on human closure timing. **Fixed:** an automatic reset plus 14-day suppression, simulated as written.
  4. The level-rule calibration was per-check. **Fixed:** expected false issues per week, by simulation.
  5. Multiplicity across challengers. **Fixed:** a Holm overlay per surface per quarter.
- **LongCat:** the single paid submit failed (network; billing outcome uncertain), the second failure today. Not retried; please check its usage.
- **Literature:** Q14 (#1230) by the SOTA researcher: CUSUM under autocorrelation (Lu et al. 2001), anytime-valid inference (Johari et al. 2021; Howard et al. form used here), BY under dependence (Benjamini and Yekutieli 2001), and the reusable holdout's i.i.d. limit (Dwork et al. 2015). This specification resolves the five conflicts Q14 listed.

