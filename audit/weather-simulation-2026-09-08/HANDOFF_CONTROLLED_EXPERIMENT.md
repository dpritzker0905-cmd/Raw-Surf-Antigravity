# Controlled marine handoff: reproduction and opt-in candidate

September 8, 2026. Baseline source: `1ef2008dec41c08334ce0be6e9ae4ec5e125c217`.
This advances the existing visual handoff mission. It does not establish scientific release readiness.

## What the intervention establishes

The actual `WebGLMarineEngine` and `WebGLMarineCustomLayer` were compiled and rendered in Edge WebGL.
The harness holds the incoming grid geometry, wave height (2 m), period (10 s), direction, model,
layer, valid time, camera, background, random seed and clock schedule fixed between comparison legs.
It changes only the replacement arrival time (immediate versus one second later). A separate
positive control changes incoming height to 5 m and must produce different pixels.

The fixed zoom is 4.724 after setup. The original regional grid covers about 0.477 of the viewport,
crossing the existing 0.6 display gate. The incoming larger grid covers the viewport. Synthetic
all-water inputs remove coastal geography and mask changes as explanatory variables.

| Case | Sampling interval | Largest consecutive luminance step |
| --- | --- | ---: |
| Immediate arrival, default | 100 ms | 0.718 |
| Delayed arrival, default | 100 ms | 32.702 |
| Delayed arrival, candidate | 100 ms | 9.281 |
| Delayed arrival, default | 16.667 ms | 32.707 |
| Delayed arrival, candidate | 16.667 ms | 1.857 |

The default delayed replacement changes regional opacity from 0 to about 0.684 while the coarse
wash drops from about 0.493 to 0.172. The coarse wash was present throughout the hold. This
reproduces a delay-dependent visual discontinuity without changing the wave values. It establishes
this mechanism in the controlled fixture, not the sole cause of every historical live finding.

The candidate coordinates coarse wash, regional heatmap and crest opacity over 600 ms. It produces
zero luminance change at the replacement instant in this fixture. Repeats and final-frame windows
are compared by SHA-256 of every framebuffer; the final rendering converges to the default result.
The immediate-arrival path must retain identical framebuffer hashes with the flag enabled.
All nine legs must paint more than 190,000 of 196,608 pixels during resident warmup and handoff,
exercise all three actual commits, and report zero browser, renderer-disable and WebGL errors.
The measured Edge minimum including setup was 194,596 pixels.
The four initial baseline cases also retained exactly their pre-edit luminance series after the
default-off integration. This is a finite intervention across a branch gate, not a smooth Jacobian.

## Historical constraints retained

- The July from-hidden snap (`30846e38`) remains unchanged for rating transitions.
- The coverage gate and geometric coarse wash floor remain unchanged. No rejected rectangle is exposed.
- The coarse-base cache and atomic replacement protections remain intact.
- The candidate requires an actual hidden-bridge-to-covering-grid replacement with the same explicit
  model, layer and valid time, same lead, explicit unrated status and the same retained coarse source.
  Unknown identities, lifecycle resets, changed targets and interrupted transitions cancel the blend.
- `__RAW_ENABLE_BRIDGE_HANDOFF_BLEND__` defaults off. No forecast coefficient, value, skill threshold,
  or live verdict budget changes.

## Validation and reproducibility

Local full frontend: 251 suites / 2,403 tests passed, zero failures. The earlier focused run passed
76 tests in seven suites; the full run additionally includes the malformed-time guard. LOC governance
passed (engine 3,206 lines, ceiling 3,207). Source lint had zero errors and one existing unused-import
warning. The new harness lint passed; all nine legacy Zoomlab lint findings were compared with the
baseline and are unchanged. Initial experimental render-scope errors were caught and corrected
before this result; successful exit alone was not used as visual evidence.

Run after `npm ci` in `frontend` and Playwright browser installation:

```sh
node frontend/scripts/marine-handoff-lab/run.cjs /tmp/marine-handoff-lab
```

For this Windows backup computer, set `HANDOFF_BROWSER_CHANNEL=msedge` to use installed Edge.
The runner writes per-frame results, summary and PNGs, and exits nonzero for any failed control.
Local detailed evidence: `handoff-pixel-hashes/results.json`; compact results: `handoff-summary.json`.
The experiment is included in the existing unfiltered marine composition CI job, with artifact upload.
The live marine workflow now accepts a boolean `handoff_blend` input; scheduled runs keep the default.
Live telemetry records the actual adjusted wash and cumulative transition starts, so a green run
without an exercised transition cannot be mislabeled validation of the repair.

## Next gate and state-of-the-art path

Run the candidate against the live coastal staircase and inspect transport, coverage, masks,
transition engagement and unchanged verdict budgets. A clean run that never engages the candidate
is only regression evidence. Coastal mask continuity and real app lifecycle behavior remain open;
do not enable by default merely because this synthetic scene passes.

Then finish provider/cycle/quantity identity through the accuracy ledger and evaluate paired,
held-out forecast skill before changing physical or calibration parameters. The prior 10,724-pair
accuracy audit remains RED; nearshore jobs with skipped validation do not supply scientific proof.
`SCIENTIFIC_CONTEXT.md` retains the scientific source qualifications and the boundary of historical
review. These are ordered gates within the existing task registers, not a replacement backlog.

GitHub checks on baseline `1ef2008d` completed successfully (hosting informational checks neutral).
Candidate-head CI and live results must be recorded separately; this report does not predict them.

## Ubuntu evidence and judge correction

The first Ubuntu controlled run at0526159c failed the spatial assertion on the single coarse
setup frame (145,677 pixels exceeded the eight-level color-difference threshold). Every resident
and handoff frame painted all196,608 pixels. No browser, renderer-disable or WebGL error occurred.
The measured effect replicated: maximum60Hz step33.204 default versus1.882 with the candidate.

The judge now checks setup for valid nonblank output and keeps the original190,000-pixel floor
throughout warmup and handoff. No measured-handoff threshold was relaxed. Raw Ubuntu and Edge
artifacts pass the corrected judge, including exact framebuffer repeat/convergence comparisons.
Ten injected faults verify rejection of missing legs/frames, blank setup, measured coverage gaps,
GL errors, missing hashes, renderer disable, changed on-time output, a vacuous data control and
an unexercised treatment. This corrects an overbroad setup assertion; it does not establish cold
activation equivalence across GPUs. The report preserves the original failed run34291660087.

## Live result: promotion refused

Run34291656386 at0526159c passed the data contract but failed the coastal visual budget:
369 analyzed frames,155 water samples,zero transport/browser errors, sixMULT0_FRAME findings and
oneSETTLED_STEP of-18.6 atz5.344. The incoming covering grid replaced a0.211-coverage resident;
the coarse wash remained present. Candidate transition starts stayed0 even with the experiment
requested. This is neither a successful repair nor evidence of an engaged candidate regression.
Unlike the synthetic scene, the wash did not dim at this recorded replacement.

The trace lacks the identities/base-reference comparison needed to prove which prerequisite
refused the transition. Replacement telemetry now records those observed inputs and the flag
without changing the predicate. Source inspection found the explicit `useMarineWindData` field
list omits served_valid_time, but the existing trace cannot establish that this caused the refusal.
Do not substitute that plausible explanation for a measured rejection. Next: capture a qualified
or rejected real replacement with these inputs, then repair only the demonstrated boundary.
The candidate stays default-off; live budgets are unchanged.
