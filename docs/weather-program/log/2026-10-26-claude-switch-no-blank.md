# 2026-10-26 (claude, GPU-frames session): a model switch at mid zoom never blanks

Branch `claude/switch-no-blank` from dev 714389a8d. Client only (`WebGLMarineLayer.js`, new `marineClampGuard.js`,
`marineTransitionCoordinator.js`). No served number changes; every change has a kill switch.

## Ask

- **The owner**, live 2026-10-26 ~12:40Z (bundle 4e004446): "Heatmap temporarily cleared when switching to Euro. ... All marine
  layers need to be instant. Work perfectly. Display correct data."
- **The lead (B):** "A model switch blanks. ... Never a blank frame: keep the old field until the new model's frame is uploaded
  ("Loading EURO..."), or draw EURO from the store in the same frame (the #571 preload, #575). Find who calls Clear on a model change
  and why. Keep its anti-mislabel guarantee via the label and receipt, not via a blank."

## Who clears, and why

Offline, in the contract scenario (`scn_instant_contract.js`, on PR A's branch), every `clearBuffers` call was recorded with its
reason-log entry, the transition flags and a stack.

- **The clear:** `non_renderable_terminal` (`WebGLMarineLayer.js`, the data-commit effect). It fired 22-74 ms after the GFS -> ICON
  click at z4.6 and z5.3, with `__MARINE_TRANSITIONING__`, `__MARINE_FETCH_PENDING__` and `__MARINE_FETCH_DEBOUNCING__` all false.
  It drew 15-130 blank frames until ICON's grid landed (0.75-2.2 s).
- **Why no hold caught it:**
  - Every hold in that branch, and the switch hold itself (`shouldHoldFrameThroughSwitch`), refuses when the resident is
    "regional at a global viewport".
  - That test was a regional width under 340 deg AND zoom <= 7 (or a view wider than 15 deg). The mid-zoom resident since #459 is
    a viewport CLIP of global_mid (28 x 23 cells at z4.6), so it always passed.
  - The guard exists so that a z9 tile is not drawn as a clamped rectangle after a zoom-out. The display gate (`useMarineWindData`)
    already SHOWS any regional grid covering `alignedCoverFrac()` (0.6) of the view at any zoom; the clear-side guard never learned
    that rule.
- **The second blank source:** the switch hold's TTL (2 s, "bridges ~2s then blanks honestly"). A switch to an un-framed EURO/ICON
  tail hour waits on /grid for longer than that (research note S3, `docs/research/instant-marine-sota-2026-10-26.md`).

## The change

1. **`marineClampGuard.residentRegionalAtGlobalViewport`.** WebGLMarineLayer's inline guard moves into a pure function, and that
   file shrinks by 14 lines (it is grandfathered past the line cap). A resident covering at least `alignedCoverFrac()` of the view
   is not regional-at-global; a tile the view has outgrown still is.
   - Kill: `window.__RAW_DISABLE_COVERING_CLIP_HOLD__ = true` (the old test).
2. **The switch hold holds until replaced:** the default bound goes from 2 s to 30 s. While the drawn frame is another model's, the
   status line already says "Loading EURO Waves… still showing ICON Waves" (`drawnFrameReadout`, `pending`), and the held frame
   keeps its own identity for the readouts.
   - Lever (2000 = the old behaviour): `window.__RAW_SWITCH_HOLD_TTL_MS__`.

## Verified

- **Unit:** `marineClampGuard.test.js` (6) pins:
  - the owner's z4.6 clip is not regional-at-global;
  - a z9 tile and a 21% resident still are (the positive control);
  - the gate's 0.6 and its lever;
  - antimeridian views;
  - the kill.
- **Unit:** `marineTransitionCoordinator.switchHold.test.js` pins:
  - a 5 s and a 15 s switch hold (the research note's T2: the old 2 s must fail them, a positive control in the same test);
  - expiry at 30 s;
  - per-target clock resets.
- **Offline, contract matrix** (`scn_instant_contract.js`, PR A): dev 4b8563851 build (714389a8d adds docs only) against this
  branch + PR A, same synthetic store, same box, idle two-rAF ~32 ms.

  | Session | dev blank frames | fix blank frames |
  |---|---|---|
  | waves z4.6 / z5.3, GFS -> ICON / EURO switches | 20 / 30 | 0 / 0 |
  | waves z8 ICON | 738 | 0 |
  | swell_1 / wind_waves z4.6 (GFS sessions) | 94 / 159 | 0 / 0 |
  | all other waves sessions (z2-z8, 3 models), light, beach | 0 | 0 |
  | slow switch: GFS -> EURO at h336 with EURO's /grid held 5 s | 360 (clear at 140 ms) | 0 |
  | kill arm on the fix build (both kills), waves z4.6 GFS | — | 30 (dev's behaviour back) |

- **The 30-second bound:** not exercised offline. In the slow-switch run the clamp-guard fix alone (2 s bound) also showed 0 blank
  frames, because the transition flags held the frame through the 5 s wait. It is kept as the research note's T2 (a 2 s bound must
  fail a 5 s and a 15 s switch). It is the smaller of the two changes, and the lever restores 2 s.
- **Silent mislabels:** 0 in every session of both builds. The held frame keeps its own identity (the truth-safety pin in
  `switchHold.test.js`), and the status line words the switch.
