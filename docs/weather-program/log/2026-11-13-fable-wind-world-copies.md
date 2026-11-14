# 2026-11-13 Fable (animation lane): wind world copies from the frame's bounds. Three gate parts pass; the 50% share does not

Client only. Built ON with kill `window.__RAW_DISABLE_WIND_COPY_CULL__ = true` (the layer's old offsets). No served number.
Separate from #881 (marine). Gate sent to the director at 21:05 EST before building; "build it against your gate exactly as
written" at 21:12. **Result: parts 2, 3 and 4 pass; part 1's "at least 50% of the wind particle pass" is NOT met (46-53% where
three copies were drawn, 34-37% where two). Draft PR; the call is the director's.**

## What the wind layer did
`WebGLWindLayer.js` picked the world offsets from the map centre, an estimated span and a padding (commit `769ccac22`,
2026-06-10, "seamless wrapping"; no reason recorded for the padding):
- below zoom 3.5 the padding is 180 degrees on each side ("pre-render adjacent worlds"): two or three copies for any view;
- the span is `canvas.width * 360 / (256 * 2^zoom)`: device pixels over 256-pixel tiles where the map uses CSS pixels and
  512-pixel tiles, so 2x too wide at devicePixelRatio 1 and 6x at 3; above zoom 3.5 a second copy is drawn well before an
  edge is in view.

## The change (`windWorldCopies.js`)
The offsets come from the map's own bounds of the frame: every copy the view, widened by 10 degrees, touches. An edge in view
draws that side only. Unreadable bounds, or the kill, give the old offsets unchanged. The span is no longer used, so its
factor-of-2-to-6 error goes with it (the old computation stays in the layer as the fallback).

## Gate and results (`scn_wind_world_copies.js`; offline app, wind on, AMD Radeon 890M, 147,456 particles)
**(4, done first) Does the padding prevent a visible pop-in? No pop-in was found without it. PASS.** The map was eased across
the date line four times (zoom 3 east and west, zoom 5, and 180 degrees in 0.7 s at zoom 2.5). For every frame, the copies
that frame's true bounds need were compared with the copies drawn in that frame: 0 frames missing a copy in 656 desktop
frames (504 of them needing a side copy) and 658 phone frames (108 needing one). The offsets are recomputed in the same
callback that draws, from that frame's bounds, so there is nothing to pre-render.

**(1) Draws per frame 3 -> 1 and the skipped copies at least 50% of the wind particle pass. Draws: yes. Share: NO.**
GPU ms per wind particle draw by offset, all copies timed in one page load of the old arm:

| view | old arm draws | main / skipped copies (ms) | share on the skipped copies | new arm draws |
|---|---|---|---|---|
| Atlantic z3.2 | 3 | 0.591 / 0.216 + 0.287 | 46% | 1 |
| E Pacific z3 | 2 | 0.567 / 0.287 | 34% | 1 |
| Indian z2.8 | 3 | 0.578 / 0.218 + 0.291 | 47% | 1 |
| mid-Atlantic z3.4 | 3 | 0.474 / 0.218 + 0.290 | 52% | 1 |
| zoom 2 at 0E | 3 | 0.584 / 0.218 + 0.291 | 47% | 1 |

Phone profile (dpr 3, CPU 4x, same GPU): 46%, 37%, 46%, 53%, 47%. The absolute saving is about 0.5 ms per frame where three
were drawn (0.29 ms where two): close to the marine figure in #881, but the wind's main copy costs more (it fills trails), so
the share is lower than the 50% I carried over from the marine gate.
Heatmap copies: 0.001-0.005 ms each against 0.06 ms for the main one. Negligible.

**(2) Every copy not drawn lights zero pixels, particles and heatmap. PASS.** 7 views (the 5 above and two span-bug views,
zoom 5 at 150E and zoom 4 at 140W, where the old rule drew two), desktop and phone: 0 and 0. Positive control: the main copy lit
84k-165k particle pixels (desktop).

**(3) Near +-180 and with more than a world on screen, every needed copy is drawn and lights pixels. PASS.** Fiji z4, Bering
z5, NZ z3, date line z2.5: the needed side is drawn (two copies, where the old rule also drew two) and lights 40k-65k particle
pixels and 359k-414k heatmap pixels. A 3400 px window at zoom 2: three copies at 0E (73k and 73k side pixels), two at 150E.

## Tests
+27 in `windWorldCopies.test.js`: one copy mid-globe; the side in view and only that side; a sweep of 550 views checking that
every longitude of the view and its margin lies in a drawn copy and that no drawn copy is untouched; unreadable bounds fall
back; the kill; the order of the layer's steps. Three of my first expectations were wrong arithmetic in the examples and were
corrected; the rule did not change.

## Limits
- One integrated GPU, headless Chromium; times under 1 ms per draw (one view of the wide window aside).
- Some per-offset times in later rows of a page load carry samples from the previous view; the shares above use only rows
  where every listed copy was being drawn.
- Pitch and rotation not exercised (the bounds are then a wider bounding box). Frame rate not measured.
