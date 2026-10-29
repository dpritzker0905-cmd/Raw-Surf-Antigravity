# 2026-10-28 (claude, side session of the lead): D11, an opacity-0 frame and a 350 ms fade after a WebGL context restore

Branch `claude/d11-restore-frames` from dev 8360f7098. Client only, ON. Kill: `window.__RAW_DISABLE_VEIL_NEVER_HID__ = true`.

## Ask

The lead's offline erratic fuzzer (fc033f5c1, at 4bd90d0d9): after a WebGL context restore, one blank frame plus one frame at
opacity 0 (142-324 ms). Repro `min-gl.json`: desktop, GFS Waves at z4.6, wait, context lost and restored 800 ms later.

## Cause

- **The opacity-0 frame.** The fuzzer recorded `__RAW_GPU__.coldVeil { mult: 0, lifted: true, reason: 'adequate' }` on it.
  - Every COLD commit (nothing resident: the re-mounted layer's first upload) stamps the cold-activation veil.
  - The render pass lifts a veil whose resident is adequate (here a 2-degree world frame at a 40-degree view).
  - `resolveColdVeil`'s "never engaged" shortcut keyed only on the render arriving within 50 ms of the stamp. The first render after a restore comes later (the async shader compile on the new context), so the lift took the reveal ramp: one frame at 0, then 350 ms of fade-in, over a frame that had never been hidden.
- **The blank frame.** The re-mounted layer's first render callbacks come while its shaders still compile on the restored context (`WebGLProgramBatch`, async by design since #410); nothing is drawn until they link. Unchanged here.

## Fix

- `marineEngineDecisions.resolveColdVeil`: a veil now records that it hid a frame (`veil.hid`).
- An adequate lift of a veil that never hid one ends with no ramp, whatever the timing. A veil that did hide frames (the designed coastal cold paint, D3) reveals with its ramp as before.
- Two lines changed; the file is at 799 lines, under the 800 cap.

## Offline before/after (the fuzzer's REPLAY of `min-gl.json`, x3 per arm, the same store and CDN)

| arm | `inv1_alpha0` | `inv1_blank` |
|---|---|---|
| dev ea9608095 (main.953ceb74) | 3/3 (1 frame each, then the 350 ms fade) | 3/3 (1 frame) |
| fix (main.07f54de2) | **0/3** | 3/3 (1 frame: the shader compile, unchanged) |

## Tests

- `WebGLMarineEngine.coldVeil.test.js` gains one test:
  - the restore case: the first render 200 ms after the stamp, and an adequate regional, lift with no ramp;
  - a veil that hid frames still ramps;
  - the kill restores the 50 ms rule.
- Red first: dev fails it, and the 11 existing veil tests pass on both.

## Not in this PR

- **D3, the designed coastal veil** (a 2-degree world frame hidden up to 4 s at a coastal view): measured and proposed separately.
