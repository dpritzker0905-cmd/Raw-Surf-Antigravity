# Gate: self-improving-loop-v1 (DESIGN, pre-registration style)
Stamp: 2026-11-23T18:40:17Z (research lead, on the director's assignment, from David's ask to put "the researchers to work with the inspector… toward SOTA". DESIGN ONLY: nothing is built, and no threshold below has been computed on data.) RE-FROZEN 2026-11-23T19:11:55Z after the advisor's HOLD (section 12.4 replaces the per-buoy null and makes every false-alarm check held-out). First frozen 2026-11-23T19:02:48Z: the rule forms, families, budget, controls and holdout rules below are final for v1. The thresholds file and its numbers come later, computed under section 12.2's freeze order. Open at freeze: LongCat's view on the notify channel (section 10.1, not statistical; it can only reopen the channel choice) and the inspector's fact list (the advisor's read supplied the facts the design depends on: the archive start, the direct NDBC readers).
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
  - **The loop holds NO secret except `GITHUB_TOKEN`** (advisor blocker 2). Every read goes through public or read-only paths: public score tables, public NDBC through the fence, and run artifacts. A CI check fails if any loop workflow or script references another secret.
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
   - Each buoy gets a p-value from a BLOCK-BOOTSTRAP null (advisor blocker 1: 7 calibration weeks give a minimum p of 1/8, so the rule could never fire).
     - Its baseline daily errors are resampled in 7-day circular blocks, 19,999 times, to build the null distribution of a weekly scatter index.
     - p = (1 + #{null >= x}) / 20,000, so the minimum p is 5e-5. That is below BY's smallest threshold for 100 buoys, q / (m · c(m)) = 0.10 / (100 × 5.19) = 1.9e-4, so the rule CAN fire.
     - Benjamini-Yekutieli at q = 0.10 runs across that week's buoys (valid under any dependence between buoys; section 11).
   - All flagged buoys of a week go into ONE issue (`weather-drift`, per-buoy, that week), never one issue per buoy.
3. **Trend alarm (slow degradation):** a one-sided CUSUM per (surface, region) on the daily paired loss differential (served minus the same-model control, or minus persistence where no control exists), standardised by the CALIBRATION mean and standard deviation, with k = 0.5.
   - The decision level h is set by block-bootstrap simulation of the CALIBRATION series (7-day blocks, so autocorrelation is kept) so that the in-control average run length is at least 500 days per chart.
   - **What the CUSUM sees:** because it reads a differential against the same-model control, it detects OUR regressions (decode, cell, fills, blends), not a degradation of the upstream model itself. Upstream degradation is caught by the level and per-buoy rules, which read absolute error.
4. **Health WARNs (no statistics):** pending-queue headroom >= 85 % of `PENDING_MAX_ENTRIES` (inspection finding 5); a scheduled scorer missing two consecutive slots; a scored run with n below its floor.

(SUPERSEDED for the per-buoy rule by section 12.4, and for the decision types by sections 11.2 and 12.2; the shares below still hold.) **One global budget, allocated now (review: Reflection, high; the first draft's arithmetic exceeded it). At most 1 statistical issue every 7 days, program-wide, in expectation under no real drift:**
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
  - an evidence JSON bound to `id + fix_version + commit` (D-087), uploaded as a workflow-run ARTIFACT with its SHA-256 (advisor blocker 2: a write to `verify/proposals/` would need the service-role key, which can also write `control/flags.json`);
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
- **Owner decisions (answered by David in the director session at 2026-11-23T18:50:01Z):**
  - D-072: "Adopt D-072 (Recommended)". Recorded as DECIDED in DECISIONS.md (#1233).
  - The budget: "At most 1 a week (Recommended)". This is the budget in section 3.
  - The notify channel: David asked "Is GitHub issues only the SOTA path forward? Ask reflection, subq, and longcat". The answer is in section 10.

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

### 10.1 The notify channel (David's question, 2026-11-23)
Asked with public context only. The question covered alert fatigue against missed alarms for one owner, GitHub notification reliability, and an email digest or push against the secret burden in a public repo.
- **SubQ (snap-1.2):**
  - GitHub issues only: 0.90 (weekly digest 0.06, severe-only push 0.03, chat or webhook 0.001);
  - the missed-alarm risk of issues-only, with notifications configured, is material: 0.03;
  - an email or webhook secret is a material burden: 0.24.
- **Reflection (Beam-1.0, high):** GitHub issues only. At most 1 alarm a week means fatigue is low, so the question is reliability. Issues are durable and auditable and add no secret to a public repo.
  - Main risk: a missed notification (watch settings, email routing, mobile app, filters).
  - Upgrade to severe-only push only if a delayed alarm would harm customers, and then with a least-privilege secret.
- **LongCat:** pending. The paid submit waits for David's approval in the research lead's session. Its preview is ready (payload sha `d1889a62…`).
- **Decision, from where the reviewers agree: GitHub issues only, with four mitigations built into component A:**
  1. Each issue is ASSIGNED to the owner, which notifies him even when he is not watching every thread.
  2. Each issue carries the label `weather-drift` and a severity in the title.
  3. A monthly synthetic "path test" issue (labelled `weather-drift-test`, closed automatically after 24 h) confirms that the notification reaches him. The owner is asked once to confirm that email and mobile delivery are on.
  4. No secret is added.
- **Reopen if:** an alarm is missed in practice, or customers depend on alarm latency. Then a severe-only push with a least-privilege secret is the next step.

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
- **Per-buoy:** the p-value of buoy b in week w is `(1 + #{null >= x}) / 20,000`, against 19,999 circular 7-day block-bootstrap resamples of b's baseline daily errors (minimum 5e-5, below the BY rank-1 threshold of 1.9e-4). Then BY at q = 0.10 over the buoys scored in week w.
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

## 12. Advisor early read at `74acd1a45`, folded before freeze (binding; where this section differs from earlier text, this section governs)
The full notes are in the shared notes, `ADVISOR-EARLY-READ-1231-self-improving-loop.md`.

### 12.1 Blockers
1. **Per-buoy p-values could never reach the BY threshold.** Fixed in sections 3 and 11.3: a 19,999-draw block-bootstrap null, minimum p 5e-5, below the 1.9e-4 rank-1 threshold.
2. **A storage write needs the service-role key.** Fixed in sections 1 and 4: evidence is a run artifact plus the issue body; the loop holds no secret but `GITHUB_TOKEN`, enforced by a CI check.
3. **Direct NDBC reads bypass the fence.**
   - A CI scan fails if any file outside the fence module contains an NDBC host or URL (`ndbc.noaa.gov`, the realtime2 and historical paths, and the NDBC ERDDAP datasets). Scripts and workflows are included.
   - Existing direct readers move behind the fence BEFORE the LOCKED list is frozen: the wind and gust observation readers, the EMOS and gust collectors, and gust-verify.
   - **Human and tool reads:** no session queries a LOCKED station id, through the ndbc or ww3 MCP tools or public pages, outside the logged look. The LOCKED list is referenced by its SHA in this rule, and the rule goes into LESSONS and the session brief.
   - **Neighbours:** a station within 25 km of a LOCKED buoy is LOCKED-ADJACENT. It may be monitored, but never used to fit or decide anything. Every fitted product records its training-station list.
4. **Rows that do not exist (August to October).** Each surface's baseline is fixed now by what rows exist. A surface uses the fixed CALIBRATION/VALIDATION windows only if it has ROWS (not aggregates) for at least 42 of CALIBRATION's 50 days; otherwise it is SELF-BASELINED. Expected status, confirmed with row counts in the thresholds file at freeze:
   | Surface | Expected baseline |
   |---|---|
   | Hs, served frames | SELF-BASELINED: the archive began collecting in November |
   | Hs, point lane (D-072) | fixed window, if the accuracy monitor's rows are retained; else self-baselined |
   | Wind | fixed window, if the skill-ledger rows are retained; else self-baselined |
   | Gust | self-baselined unless gust-verify rows cover CALIBRATION |
   | Tide | SELF-BASELINED (the own-tide series is recent) |
   - Self-baselined surfaces run WARN-only until their second, unseen 60 days confirm the bound (section 2.3).
5. **One planted drift per alarm type** (replaces the single region-wide step in section 7(2)):
   - a single-buoy step (+0.5 m Hs at one VERIFY buoy) must be caught by the per-buoy rule within 2 weekly blocks;
   - a lead step (+0.2 m at the 72 h lead only) by the level rules within 7 days;
   - a slow ramp (0 to +0.2 m over 60 days, one region) by the CUSUM;
   - an intermittent fault (+0.5 m on one day in three, one region) must be caught by some rule within 21 days.
   - Each plant's detection-delay bound comes from a power simulation on the baseline, set before VALIDATION is read.

### 12.2 Fixes
- **Freeze order:** every rule form and constant (k, the ARL0 target, the budget shares, q, block lengths, floors, the plant sizes) is frozen with a SHA in `self-improving-loop-v1-thresholds.json` BEFORE any threshold is computed.
  - CALIBRATION and VALIDATION (August to October) have been SEEN in aggregate, so a PROSPECTIVE validation block is added: after freeze, every rule runs 28 days live in WARN-only mode before it may open an issue. Its achieved rate is reported.
- **Served changes are not in-control:** CALIBRATION and VALIDATION are split into segments at every served change logged in ACTIONS (`flag_flip`, `deploy` of a served-number change) or SCOREBOARD. Days within ±3 of a change are dropped, and the change dates are listed.
- **Tail uncertainty:** each threshold and h is reported with its bootstrap 90 % interval and set at the conservative end (the larger h; the larger p99 bound). A sparse baseline therefore errs toward fewer alarms, and says so.
- **Reserve wording:** expected issues add linearly across rules whatever the dependence, so the 0.176 reserve covers ESTIMATION error in the per-rule rates, not dependence. Dependence affects only how alarms cluster, which the simulation reports.
- **The family, exactly:**
  - CUSUM: Hs served × {West, East, Gulf, Hawaii, Puerto Rico}, wind × the same 5, gust × {West, East + Gulf, Hawaii}, tide × {West, East + Gulf, Hawaii}, giving 16 charts;
  - level: 3 D-072 rules × {24, 48, 72 h}, giving 9;
  - per-buoy: 1 weekly batch.
- **Served change on a surface:** when a served change merges on a surface (a ledger `flag_flip` or served deploy), that surface's charts reset S to 0 and run WARN-only for 14 days. The issue text names the change. A re-baseline is an amendment after 60 days.
- **The served frames' "same-model control":**
  - for GFS frames, NOAA's own GFS-Wave at the same buoy and lead (the upstream read of `served-wave-skill-v1` S-FID);
  - for EURO and ICON frames, which have no upstream read here, the differential against observed persistence.
- **Wider no-write CI test:** besides `issues`, `issue_comment` and `label` triggers, the test covers scheduled jobs that READ issue or label state and then act, `workflow_run` and `repository_dispatch` chains, and any `gh workflow run` or `gh api .../dispatches` call in the loop's scripts.
- **A/A at scale:** 200 A/A challenger replicates (block-resampled), with the realised false-proposal rate <= 0.05 and its 95 % Clopper-Pearson upper bound reported.
- **Planted-better challenger:** planted at the gate's minimum detectable effect from its power simulation, not at "error halved".
- **Added controls:**
  1. **Never-flip red team:** the loop job, with its own token, tries to write `control/flags.json`, a repo variable and a dispatch. All must fail.
  2. **Direct-read red team:** a script outside the fence that fetches NDBC must fail the CI scan.
  3. **Chart-reset control:** after a simulated alarm, S = 0 and suppression lasts 14 days.
  4. **"Not measured" UI test:** an empty or n = 0 metric renders "not measured", never 0 or green.
- **Validation length:** 28 days cannot confirm a rate of 1 a week. So:
  - the decisive check is the full-pipeline in-control SIMULATION (section 11.5). It passes if the simulated false issues are <= 1.0 per week with a 95 % upper bound <= 1.2;
  - the 4-week VALIDATION replay is a sanity check that passes with <= 8 statistical issues (P(<= 8 | Poisson(4)) = 0.98 when the alarms work as designed);
  - the prospective WARN-only month is reported beside both.

### 12.3 Inspector facts, folded after freeze (clarifications plus TWO CONSERVATIVE OPERATING RULES: the read-time LOCKED filter on stored rows, and the D-072 level rules WARN-only until a passing replay; no rule form, constant or budget share changes)
Source: the inspection lane's `LOOP-FACTS-FOR-RESEARCH-LEAD-2026-11-23.md` (shared notes, read at dev `78e7adb21`).
- **The fence also covers STORED rows.** There is no single NDBC helper today: about six independent fetchers plus one-off scripts, and only `served_wave_verify_score.ndbc_get` is behind the holdout module.
  - Several readers fetch nothing themselves and read the skill ledger's stored rows instead (`forecast_accuracy_monitor.py`, `gate_v2.py` and others).
  - So the LOCKED filter is applied at READ of stored rows too, not only at fetch: every loop input passes the same station-id filter, and rows stored before the LOCKED list existed are filtered on read, never trusted.
- **Proposals are not `shadow_proposal`.** #1223's `shadow_proposal` is a key inside the flag's own entry in `control/flags.json`. The loop never writes it, and never writes that file at all (section 1).
- **Skill-ledger row loss.** The pending queue was at 61,093 of a 68,000 cap on 2026-11-23, and +72 h rows are evicted first. Any period with a non-zero `pending_evicted_cap` counts as missing rows under section 12.1 item 4, so the 42-of-50-days test is decided on rows actually stored.
- **D-072 level rules depend on a version that passed its replay.** The v2 replay failed as registered (SCOREBOARD 2026-11-16, P3: rule 2 fired on 0 of 5 episode days).
  - The level rules run WARN-only, and their 0.50 budget share opens no issue, until the D-072 version adopted in #1233 has a passing replay on record.
  - Until then, the per-buoy rule and the CUSUM run on their own shares, and the unused share is not reassigned.
- **46267 today:** no per-buoy rule existed before or after #852. Its post-fix value is NOT MEASURED, and the plant in section 12.1 item 5 is the test that the per-buoy rule would have caught it.

### 12.4 Advisor HOLD at `417b32bc9`, folded: the per-buoy null and held-out validation (binding; supersedes the per-buoy p-value, BY and simulation text in sections 3, 11.2, 11.3 and 11.5, and section 12.1 item 1)
Full note: `ADVISOR-MERGE-GATE.md` in the shared notes.

**What was wrong.** The weekly index is one 7-day window, and the null resampled 7-day circular blocks of the same baseline. So each bootstrap "week" was one of only about 50 distinct baseline windows, and p = 5e-5 meant only "above the baseline maximum". By exchangeability, an in-control new week does that about 1 time in 8 per buoy: about 12 of 100 buoys would pass BY, a false issue nearly every week. The 11.5 simulation resampled the same windows, so it could not see this. The CUSUM h has the same, milder, blind spot.

**The fix: pooled standardised z with a parametric tail and a union bound; no p-values and no BY.** SubQ and Reflection both chose this, independently (2026-11-23). It is the advisor's options (b) and (c) combined, with (a)'s parametric tail fitted to the pooled values.
- **Standardise per buoy:** `z_{b,w} = (SI_{b,w} - mean_b) / s_b`. Here `s_b` is the buoy's baseline weekly standard deviation, shrunk toward the pooled standard deviation (7 weeks per buoy are too few for a stable `s_b`), with a floor of 0.02 SI units.
- **One pooled null:** all buoys' standardised baseline weeks (about 700).
- **Threshold z0:** the per-buoy-week false-flag rate `alpha = 1e-3`, so that 100 buoys × 1e-3 = 0.10.
  - z0 is the LARGER of the normal 1e-3 quantile (3.09) and a generalised-Pareto tail fitted to the top 10 % of the pooled values, evaluated at 1e-3.
  - 700 values cannot estimate a 1e-3 quantile empirically, so the tail is a model. Taking the larger of the two models errs toward fewer alarms.
- **Flag:** buoy b in week w when `z_{b,w} > z0` AND its MAE exceeds the floor (Hs 0.5 m; wind 6 kn; tide 0.15 m). All flagged buoys of a week go into ONE issue.
- **Why the budget holds under any dependence:** one issue can hold several buoys, so E[false issues per week] <= E[false flags per week] <= sum over buoys of alpha = 0.10, by the union bound, whatever the cross-buoy dependence. Each buoy's expected false flags per week are 1e-3, within the rule's 0.10 share.
- **Detection check:** a +0.5 m Hs step at one VERIFY buoy moves its weekly SI by several `s_b`, so it should flag in the first full week after the step (the second, if the step starts mid-week). This is the section 12.1 item 5 plant, run on held-out weeks.

**Held-out validation for every A rule (the advisor's second point).** No rule's false rate is measured on the data its threshold was built from.
- **Per-buoy:** leave-one-week-out rotation of CALIBRATION, 7 rotations. Standardise and fit z0 on 6 weeks, then count flags in the held-out week. Then VALIDATION (4 weeks) and the prospective 28-day WARN-only block.
- **CUSUM h:** the same rotation, by 7-day segment. h is re-derived without the held-out segment and run on it. Then VALIDATION and the prospective block.
- **Level rules:** the same rotation, then VALIDATION and the prospective block. They stay WARN-only until D-072 has a passing replay (section 12.3).
- **The full-pipeline simulation in 11.5 is kept, but only as a check of the code path** (reset, suppression, issue dedup). It is no longer evidence of a false-alarm rate.

**What the data can and cannot show (stated, not hidden; both reviewers agree).**
- At the target rates, the held-out data expect very few false issues:
  - about 0.7 per-buoy false flags over the 7 rotations, and 0.4 to 0.8 over VALIDATION plus the prospective block;
  - about 1.8 CUSUM alarms over 56 days for 16 charts at ARL0 500.
- So the 0.10 per-week rate and ARL0 >= 500 are NOMINAL, under the fitted tail model and the union bound. Held-out data give a COMPATIBILITY CHECK, not empirical verification. Zero observed false issues is not proof.
- **The compatibility checks, fixed now:**
  - per-buoy: fail if 2 or more held-out weeks have a false flag, across the 7 rotations plus the 8 VALIDATION and prospective weeks (expected 1.5 at 0.10 a week; P(>= 2 | Poisson(1.5)) = 0.44, so this check can only catch a gross miss: a rate near 1 a week gives about 15);
  - CUSUM: fail if more than 5 alarms over VALIDATION plus the prospective block (P(>= 6 | Poisson(1.8)) = 0.01).
  - A failed check raises z0 (to the 5e-4 quantile) or h (ARL0 1,000), by amendment, and the rule stays WARN-only.
- **Live:** the monthly achieved-rate report and the pause rule (section 3: a rule over twice its budget for 30 days goes WARN-only) are the long-run guard, and they accumulate the evidence the baseline cannot give.

**The fence is #1234's, not a second design.** This REPLACES section 12.1 item 3's "no NDBC host outside the fence module; move the readers" model. #1234 instead lets each reader module (54 today) hold its own fetch and CALL the fence. Section 12.1 item 3 and section 12.3 now mean #1234's fence, adopted by name:
- `services/buoy_holdout.py` (`is_locked`, `drop` for stored rows, `allow_url` for fetches, `redact`);
- the AST guard `tests/test_buoy_holdout_guard.py`. It scans every backend `.py` file (scripts included) and every workflow, with listed, live-checked exemptions.
- Every loop reader must call that module. The loop adds no fence of its own.
- **Gaps, as follow-ups on #1234's fence, not here:**
  1. **ERDDAP NDBC patterns:** the guard's URL patterns must also match the NDBC datasets served through ERDDAP, not only `ndbc.noaa.gov` paths.
  2. **Per-call-site checking:** the guard passes a module that calls the fence ANYWHERE. It should check that each buoy-truth fetch or stored-row read site is itself fenced.
  3. **The 25 km LOCKED-ADJACENT rule:** it exists nowhere yet. #1234 has no radius, and this design only states the rule.
  4. **No session reads of LOCKED ids** through the ndbc or ww3 MCP tools or public pages. This is a human and tool rule; it goes into LESSONS and the session brief.
  5. **Training-station lists:** each fitted product records the stations it was trained on.
- The loop does not ship until gaps 1 to 3 are closed on #1234's fence or a follow-up to it.

