# September 8 refresh: separate delivery, instrument validity and forecast skill

## Decision

**The repair PR passed Linux CI, but it is unmerged. The reported scheduled failures ran the old dev code.** Do not attribute them to the repair branch. The most actionable new finding is that the repeated “EURO antimeridian seam” diagnosis was based on a regional Azores response. Correcting the probe's requested geometry makes all 12 live ladder checks pass. Accuracy breaches remain real operational findings and are not fixed by making the probe truthful.

Scope: saved Brain checkpoint, PR #14 at 5251182085e293ddfb3d54a770c8897be7d2d7ce, the latest 100 Actions runs returned on September 8, detailed failed logs, the successful PR CI log, and fresh served-grid interventions. This is a bounded sample, not every historical run. No merge, production deployment, threshold widening or physics adjustment was performed. Raw inputs and outputs are in resume-evidence.zip.

## Delivery identity and CI

PR #14 remains OPEN, mergedAt=null, targeting dev. Scheduled runs shown in the inventory use 524d8c49236bf42848a1dfe10b2bbd2ce59a64cf. The prior memory phrase “pushing PR #14 into dev” was ambiguous: the branch was pushed and a PR opened, not merged into dev.

All GitHub checks for the 52511820 PR head completed successfully. Netlify preview succeeded; its Pages changed check is neutral, not a failed test. The successful composition job reports 1,804 passed, 66 skipped and one expected failure. Skips are not converted into scientific validation. The estate coverage report explicitly accounts for selected files and zero silent files. Last night's first-head frontend LOC failure was real, caused by marineGridSeries.js reaching 810 lines, and fixed by the extraction in 52511820.

Sources: [PR #14](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/pull/14), [successful CI run](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/34182296424).

## Finding 1: the supposed antimeridian failure was measured at the wrong location

The nightly script called /api/weather/grid without bbox, assumed the result was global, and treated the leftmost/rightmost returned columns as ±180°. No assertion tested that premise. At fixed valid time 2026-09-08T18:00:00Z, the EURO response was euro_marine_waves_island_azores_20260908T180000Z.json. Its bounds were west=-29.292, east=-24.577, south=36.492, north=39.545. The 0/37 western column was therefore an Azores edge, not the date line.

Control: explicitly requesting bbox=-180,-80,180,85 at the same valid time returned euro_marine_waves_global_mid_20260908T180000Z.json with -180/+180 endpoints, 181 columns and 83 rows. Both seam endpoints had 83 valid cells. GFS's no-bbox response was genuinely global, explaining why the old assumption appeared to work for that model.

The repair now requests a global bbox and requires both the declared bounds and actual vector endpoints to be ±180 before grading a seam. A regional response fails as unmeasured geometry, rather than masquerading as a seam defect. Synthetic controls verify rejection of an island payload, rejection of global bounds with regional vectors, acceptance of populated global endpoints and rejection of a genuinely dead global endpoint. The corrected live ladder passes all 12 checks.

This supersedes the interpretation of V2 in the September 7 FINAL_VERIFICATION.md; that report and its observations are preserved. We have NOT established why the Azores western edge is empty, nor that an omitted-bbox request must always return global. Those are separate selection/normalization questions. No artificial pixels were inserted and no seam threshold was relaxed.

Source: [failed nightly run](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/34221746224). Evidence: EURO-grid.json, EURO-explicit-global.json, GFS-grid.json, original and repaired ladder logs.

## Finding 2: accuracy gates are red for two measured reasons

At 12:06 UTC the monitor reported MAE 0.401 m over 60 buoys. At 17:13 UTC it reported 0.404 m, both above the configured 0.40 m threshold. The latest paired +24 h comparison reports ours=0.270 m, persistence=0.254 m, delta=+0.016 m, win rate=48%, n=3,360 paired keys. At +48 h and +72 h the printed comparison favors the app. Do not generalize a +24 h result to every lead or compare the 60-buoy aggregate with the paired archive as if they were one cohort.

The gate's exit is supported by its configured operational rule. Its old text claiming a bad constant and excluding sea-state effects is NOT supported by these summary metrics. Correlated cases can move multiple metrics together. The PR already corrects the paired-message significance claim; this follow-up corrects the remaining absolute-MAE/warning messages. Thresholds and exit semantics are unchanged.

Scientific basis: ECMWF distinguishes verification metrics, significance testing and temporally correlated samples. [ECMWF verification training](https://events.ecmwf.int/event/335/contributions/3924/attachments/2419/4183/1_Leutbecher_verification2.pdf), [significance of forecast-score changes](https://www.ecmwf.int/en/elibrary/78783-significance-changes-medium-range-forecast-scores). These support evaluating uncertainty; they do not identify the cause of Raw Surf's current errors.

Sources: [latest accuracy failure](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/34255747866), [preceding failure](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/34224180915).

## Finding 3: nearshore green is still a no-op

The September 8 18:44 UTC Nearshore Validation run passed its arm-gate step and skipped checkout, installation, preflight, the outcome loop, summary and report upload. This is not proof of nearshore accuracy. Do not enable the workflow blindly just to replace a skip with activity; establish the input/observation readiness required by its existing objective.

Source: [nearshore run](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/34264847165), saved nearshore-jobs.json.

## Jacobian lens: interventions, not causal guesses

| Intervention | Held fixed | Observed change | Supported inference |
|---|---|---|---|
| Omitted bbox → explicit global bbox | EURO, waves, valid time | Azores tile → global mid; 0/37 → 83/83 west cells | The original seam verdict depended on selected geometry |
| Regional vectors with global metadata | Synthetic vector values | Probe refuses geometry | Metadata alone cannot pass the seam test |
| Kill a true global endpoint | Global geometry | Probe fails | The correction still detects the claimed failure class |
| Remove unsupported cause wording | Accuracy inputs and thresholds | Diagnostic wording only | The red operational gate remains active |

These are discrete software sensitivity controls. No smooth physical derivative, forecast improvement, confidence interval or production model attribution is claimed.

## What to do next, in order

1. Add these bounded instrument corrections to PR #14 and rerun its exact-head CI. Preserve the false-diagnosis evidence.
2. Review a merge/deployment decision separately; without merging, scheduled dev jobs cannot execute these fixes. Prior authorization did not authorize merging.
3. For +24 h skill, extract matched buoy/target/source/lead cohorts, check coverage, units, valid-time/cycle alignment and representativeness, and use a dependence-aware uncertainty estimate before choosing a physical intervention. Do not tune against this aggregate snapshot.
4. Investigate the Azores edge at raw-provider → normalized-file → served-response boundaries; it is not an antimeridian task. Retain existing canonical objectives rather than opening a competing backlog.

Local validation of this follow-up: 25 accuracy-monitor tests passed; the full frontend suite and LOC ratchet passed; the repaired live contract passed. Local Python still lacks pygrib/uvloop; prior exact-head Linux CI is the stronger dependency-environment evidence for the earlier package. Current follow-up CI must be checked separately.
