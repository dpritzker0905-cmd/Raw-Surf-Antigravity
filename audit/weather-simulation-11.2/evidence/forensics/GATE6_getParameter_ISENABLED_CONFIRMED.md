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
are `booking-flow.spec.js` (auth gating, spot cards, nav). A `domcontentloaded` timeout means the
site was not serving.
★ **Every push to `dev` redeploys both Netlify and Render AND starts an E2E run against those same
live deployments — the suite races its own deploy.** That is a structural CI defect, not a code
defect, and it will keep producing red runs that look like regressions.
