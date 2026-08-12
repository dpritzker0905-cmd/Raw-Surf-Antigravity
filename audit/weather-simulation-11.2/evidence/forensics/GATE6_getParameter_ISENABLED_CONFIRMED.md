# `isEnabled` change CONFIRMED in production — and this time the ranges separate

**Deployed** `34d76000` (frontend `BUILD_VERSION` verified). Measured 2026-08-12, RTX 3060 Laptop,
headed Chromium, `LAYER=Waves`, 30 s from activation, identical workload every run
(textures +9, uploads +17, vectors 289).

## `gl.getParameter` self time

| build | samples | range |
|---|---|---|
| `286a4e6b` before | 2 | **1411.2 – 1519.1 ms** · 4.50 – 4.92% |
| `34d76000` after | 5 | **960.3 – 1291.9 ms** · 3.12 – 4.16% |

**The ranges do not overlap.** Post-change maximum (1291.9 ms) sits below pre-change minimum
(1411.2 ms). Mean ≈ 1465 → ≈ 1181 ms, about a **19% reduction in `getParameter` cost**.

★ This is the standard `286a4e6b` failed. That change moved a call count and moved nothing else;
this one predicted an amount, and the amount showed up.

## The prediction matched the observation

The micro-benchmark predicted ~209 µs saved per capture (BLEND 75.05→0.10, SCISSOR_TEST
68.85→0.05, CULL_FACE 65.00→0.05 µs). Observed reduction ≈ 180–280 ms over ~31 s implies
~860–1340 captures in the window — 14–22 frames/s across two engines, against a measured p50 of
30 fps and p95 of 15 fps. **Consistent.** The residual gap between 19% observed and the ~29.5% the
capture site alone would give is expected: `captureWebGLState` is not the only `getParameter` caller
(`WebGLWindUtils.js:18` also appears in the profile).

## What is still open

The other **~499 µs per capture** — `COLOR_WRITEMASK`, `DEPTH_WRITEMASK` and the six `BLEND_*`
reads — are values, not capabilities, so `isEnabled` cannot touch them. MapLibre's own shadow
(`map.painter.context.*.current`) was probed live and matched the driver exactly on every one; it
needs the map context plumbed into both engines' render paths.

And the far larger prize is untouched: `getImageData` at **2858–2942 ms / 9.3–9.6%**, still roughly
2.3× `getParameter`, in the ocean-mask path that `DO_NOT_ADVANCE_ITEMS.md` fences off as performance
work until determinism is settled.

## ⚠️ The E2E failure on `286a4e6b` was NOT this code

The failing hook is `page.goto('/auth', { waitUntil: 'domcontentloaded' })` timing out at 90 s —
the auth page, which loads no WebGL, no MapLibre, and none of the changed files. The other failures
are `booking-flow.spec.js` (auth gating, spot cards, nav). That part stands.

### ⛔ RETRACTED: "the suite races its own deploy"

**This claim was published here and is WRONG.** The original text asserted a structural CI race —
that a push starts E2E and the deploys simultaneously. It does not. `e2e-tests.yml` already gates on
BOTH deployments, added 2026-08-07/08-10 with the rationale written into the file. The failing run's
own log proves the gates worked:

```
02:11:52  deployed build 286a4e6b matches the commit under test
02:13:11  Wait for the Render backend to serve THIS commit   (passed in ~2 s)
02:13:13  Running 52 tests using 1 worker
```

★ **I proposed fixing something the file already warns against fixing.** `e2e-tests.yml` contains
explicit notes that raising timeouts "COULD NOT FIX THIS and twice did not", and that
`cancel-in-progress: true` is correct and must stay. Reading the workflow BEFORE diagnosing it would
have cost one minute.

### The likely cause was me

Timing, from the run log against this session's own commands:

| time | event |
|---|---|
| 02:13–02:14 | Mobile Safari passing |
| 02:17:59 | this session's cadence sample — a 15.7 MB catalog fetch off the Render box |
| 02:20–02:45 | this session's CPU profiles and micro-benchmarks — repeated `/map` loads, marine grid fetches, 30 s headed sessions |
| 02:22–02:33 | Desktop Firefox failing, 90 s `page.goto` timeouts |
| 02:35–02:38 | Desktop Safari failing |

E2E drives the **live shared deployment** on a **1-CPU Render box**. Profiling that same deployment
concurrently is load-testing the thing under test. ⚠️ Timing-consistent and mechanistically
plausible; **not proven** — no per-request attribution was collected.

★ **OPERATIONAL RULE: do not run browser harnesses or profilers against `dev--rawsurf.netlify.app`
or the Render backend while an E2E run is in flight.** Check with
`gh run list --workflow="E2E Tests" --limit 1` first. The suite cannot distinguish your load from a
regression, and a red run costs the next session an hour of misdiagnosis — as it nearly cost this
one, twice: first blaming the code, then blaming the CI.
