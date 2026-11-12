# 2026-11-12: Desktop Safari continuity flakes (Fable repair lead)

Append-only. Branch `fable/safari-continuity-steady-draw`.

## What was asked

The coordinator asked about two Desktop Safari flakes in `marine-render-continuity.spec.js`. Both passed on retry, so retries were hiding them:

- `:266`: the test that toggles layers, models, zoom and pan.
- `:408`: the fast burst at Sebastian Inlet z12.

## Evidence

- **Source:** dev E2E runs (`e2e-tests.yml`). I surveyed 12 completed runs on 2026-11-12.
- **Flakes found:** 4, all Desktop Safari, all with the same assertion.

  | Run | Test |
  |---|---|
  | 43216443158 | `:266` and `:408` |
  | 43224263438 | `:266` |
  | 43231836639 | `:408` |

- **The assertion:** "the engine must be drawing at rest ...". Expected `> 1`, received `1`.
- **Where it fails:** at the at-rest positive control, BEFORE any gesture, so no continuity sample exists.
- **Screenshots:**
  - Waves is active and the field is not yet painted.
  - In the burst, the readout says "Loading the detailed forecast...".
- **Since #802, #807, #809 and #799:**
  - #802 merged at 13:50. Run 43231836639 started at 13:54, on the commit after #802, and still flaked.
  - The 4 runs that started after #807 (14:24) were clean.
  - n = 4 is too small to call that a fix. Nothing in those PRs targets this path.

## Classification

**Test timing (startup). Not a gesture draw gap.**

- The old control waited for `opacity.n > 0`. The FIRST draw satisfies that.
- It then gave the engine 1.5 s to draw again.
- On Safari, startup can draw once and then wait for the detailed frame for longer than 1.5 s.
- The spec's own comment says the control exists so the gate does NOT measure startup.

**Not reproduced locally.** Playwright has only Chromium installed on this machine, with no WebKit. The lane also drives the deployed dev preview, not a local build.

**Open question:** whether a >1.5 s startup gap on Safari is a user-visible defect is a separate matter. The new `steady drawing after` annotation records that startup time on every run, so it can be measured instead of guessed.

## Fix

- **`continuityOracle.steadyDrawStep`:** while the counter is flat, it re-anchors. It passes only when the counter advances across a full 1.5 s window, within 60 s.
- **Still strict:** a dead engine fails by name and reports its last `{n, heatmap, layer.n, layer.skip}`.
- **Unit tests:** 5 new Jest tests.
  - They include the CI failure shape and a negative control (a counter that never moves is never steady).
  - Mutation check: making the step always report steady fails 3 of them.
