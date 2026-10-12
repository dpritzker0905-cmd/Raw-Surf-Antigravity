# 2026-10-12 · Why light's and beach's wind trails linger over the field and dark's come back to it: the composite's law (D-028)

Local session (Windows, the lead's machine: headless Chromium, D3D11), started by the session that leads the light and beach wind
lanes. Branch `claude/wind-trails-linger`, cut from `origin/dev` at `b764797b` (#318's merge) and merged with `origin/dev`
`a022b398` (#322's merge) at 20:35Z. Times are UTC.

**The brief this session was started with** (the lead session, 19:02Z; not the owner's words): "Find out WHY light's and beach's
wind trails linger above the colour field between streak cores while dark's come back to it, commit the instrument that measures
it, and prepare (do not ship) one candidate that makes light's and beach's tails behave as dark's. Change nothing the app draws by
default." Its background said of the mechanism: "NOT established: all three themes use the same trail composite".

**The owner's words, first-hand in this session's chat, 20:13Z,** while the candidate was being built behind a default-off lever
as that brief asked: "levers to turn on new updates need to be on by default". So the candidate is built ON with a kill
(DECISIONS D-028). The owner has not seen it; no clip had been shown to them when this was written.

## The finding, in three sentences

1. **The three themes do not lay their trails by the same arithmetic.** `SCREEN_FS` has two branches: dark lays the trail buffer's
   colour at alpha `b x opacity`; light and beach, since dark's rules (D-020, rule 1, "light only adds"), run the `u_glow` branch,
   which lays the colour at full brightness at alpha `b^2 x opacity`.
2. **Written as one family, `screen - g = p (b c - b^2 g) - q b (1 - b) g`, dark is `p = q = 0.505` and light and beach are
   `p = 1, q = 0`:** dark's composite carries a VEIL (a black of alpha `q b (1 - b)`, strongest at half strength) that dims the
   ground under every fading tail, and the glow branch has none, so its tails can only add light until the buffer runs out.
3. **Read off the screen and the trail buffer together the fit gives exactly that (each to 0.3 to 0.45 of an 8-bit level), and
   swapping the branch ALONE on the real engine moves the behaviour with it in both directions,** while the mark's ring, its light
   level, the fade, the number of trails and the ground's lightness move only its size.

The premise in the brief was the one thing wrong in it: the composite is not the same. The lead's measurement (light's and beach's
pixels never come back to the field from 12 kn up; dark's dip a little under it) reproduced here to the decimal.

## 19:05Z · The instrument (committed: bench TRUTH mode)

The lead's scratch scripts (`truth-run.js`, `diff-run.js`, `cmpdirs.js`, `clamp-check.js`) became one bench mode with a pure
statistics file and a test:

- `frontend/scripts/wind-bench/truth.js`: pure functions over RGBA bytes. `ground` (the field alone, the mean in linear light),
  `watch` (every pixel and frame against it: light added and taken, shares over / under / at the field, the share of pixels that
  came back, a pixel's darkest and lightest moment, Weber contrast, flicker), `differ` (two runs frame for frame, CIE76), `clamp`
  (the old bench's bare-canvas clamp, L-V72), and **`lawFit`**, which is new: it fits the composite's own law from the screen, the
  field alone and the engine's trail buffer.
- `truth-run.js`: reads saved frames in a headless page with that same file (`--law`, `--diff`, `--same`, `--clamp`).
- `motion-run.js`: `--at` takes several centres (the SAME particles read at several places, each crop a run of its own),
  `--trail` saves the trail buffer's crop beside each frame, frames are written as they are taken (a run of lossless crops does
  not fit one reply), and a run may carry `force`.
- **`force-uniforms.js`: one variable at a time.** A lever in the app usually moves several things together (the white streak's
  kill also moves the field, the land's depth and both paths). A run's `"force": { "screen.u_glow@map": 0 }` holds the real
  engine, its shaders and every default as they are and replaces ONE uniform on its way to the GPU, optionally only while the map's
  framebuffer is bound (the composite, not the buffer's copy). A force that never fires stops the run.
- `src/components/map/windBenchTruth.test.js` (30 tests): the statistics on synthetic frames with a known answer (a streak that
  lingers and one that darkens, each alone and together; the expected numbers worked from the CIE definition, not from
  `truth.js`), the law's fit on screens drawn by each branch, a buffer one pixel off and a map line above the wind as positive
  controls, the forced uniforms on a recording context.

**Method, every table below:** the low speed ramp (2 to 30 kn, `ramp-fixture.js`), zoom 6, the page and the map at pixel ratio
1.5, lossless PNG crops at device resolution (240 x 330), 90 frames after a 180-frame warm-up, the particle run the FIRST run on a
fresh map and the field alone (`"res": 2`, 12 frames) the second, one invocation an arm, one seed. Crops: the sea (`fy` 0.85) and
the land (`fy` 0.2) at 6.0, 15.3 and 26.0 kn (`fx` 0.143, 0.475, 0.857). "Before" is `origin/dev` at `a022b398`, built by
`--ref origin/dev`.

**Null control.** A second invocation of the same arm: over the sea the same bytes, 90 of 90 frames, in dark and light. Over land
0 of 90: the map does not place its names to the bit from one map to the next (mean 0.04 to 0.10 CIE76 a pixel, 1% to 3% of pixels
over 1; beach's land crops were the same bytes). So "the same picture" is read by hash over the sea and by CIE76 beside this null
over land.

## 19:31Z · Reproduced

The lead's lossless table (15.3 kn; log `2026-10-12-wind-canvas-alpha`, "After the independent review") against this session's
first capture on `b764797b`, the sea: dark's darkest moment -2.2 (the lead -2.2), light +1.8 (+1.8), beach +1.9 (+1.9); the share
of pixel-instants 3 L* or more over the field 0.582 / 0.757 / 0.762 (0.58 / 0.75 / 0.76); 1.5 or more under it 0.191 / 0 / 0
(0.19 / 0.00 / 0.00); a core +25.3 / +25.4 / +28.5 (+25.3 / +25.3 / +28.4). (The lead's "added 7.7 / 10.8 / 12.2" is this mode's
`lift`; `added` reads 8.2 / 10.9 / 12.2, with -0.5 taken in dark.)

## The tables (every number is `truth-run.js`'s own JSON, written out by a script; "before" is `origin/dev` at `a022b398`)

### T1. Zoom 6, the low ramp, six lossless crops: dark, and light and beach before and with the veil

| crop | arm | field L* | added | taken | over | under | at field | back | darkest (p10) | core (p90) | flicker |
|---|---|---|---|---|---|---|---|---|---|---|---|
| sea, 6 kn | dark | 38 | 5.2 | -0.6 | 0.38 | 0.21 | 0.37 | 0.91 | -2.1 (-3.2) | +24.2 (+29.3) | 1.30 |
| sea, 6 kn | light, before | 52.6 | 6.8 | 0 | 0.53 | 0.00 | 0.40 | 0.70 | 0 (0) | +21.7 (+25) | 0.79 |
| sea, 6 kn | light, veil | 52.6 | 4.7 | -0.8 | 0.35 | 0.28 | 0.34 | 0.94 | -3.2 (-4) | +21.1 (+24.8) | 0.97 |
| sea, 6 kn | beach, before | 50.4 | 7 | 0 | 0.53 | 0.00 | 0.41 | 0.70 | 0 (0) | +20.2 (+25.5) | 0.64 |
| sea, 6 kn | beach, veil | 50.4 | 4.7 | -0.7 | 0.36 | 0.25 | 0.36 | 0.92 | -2.7 (-3.4) | +18.6 (+25.1) | 0.78 |
| sea, 15.3 kn | dark | 46.1 | 8.2 | -0.5 | 0.58 | 0.19 | 0.18 | 0.83 | -2.2 (-2.8) | +25.3 (+26.8) | 1.37 |
| sea, 15.3 kn | light, before | 48.2 | 10.9 | 0 | 0.76 | 0.00 | 0.18 | 0.47 | +1.8 (0) | +25.4 (+27.7) | 1.09 |
| sea, 15.3 kn | light, veil | 48.2 | 7.9 | -0.6 | 0.56 | 0.20 | 0.19 | 0.85 | -2.5 (-3) | +24.9 (+27.5) | 1.36 |
| sea, 15.3 kn | beach, before | 39.9 | 12.1 | 0 | 0.76 | 0.00 | 0.18 | 0.47 | +1.8 (0) | +28.3 (+32.1) | 1.19 |
| sea, 15.3 kn | beach, veil | 39.9 | 9.4 | -0.3 | 0.60 | 0.14 | 0.22 | 0.78 | -1.6 (-2.2) | +27.5 (+31.8) | 1.39 |
| sea, 26 kn | dark | 45.4 | 11.5 | -0.2 | 0.78 | 0.08 | 0.10 | 0.64 | -0.2 (-2.4) | +26.4 (+27.5) | 1.85 |
| sea, 26 kn | light, before | 46.9 | 16.2 | 0 | 0.93 | 0.00 | 0.04 | 0.20 | +5.6 (+0.7) | +28.4 (+29.5) | 1.56 |
| sea, 26 kn | light, veil | 46.9 | 13.1 | -0.2 | 0.80 | 0.08 | 0.09 | 0.59 | +0.1 (-2.6) | +28 (+29.5) | 1.98 |
| sea, 26 kn | beach, before | 48.8 | 14.6 | 0 | 0.92 | 0.00 | 0.05 | 0.22 | +4.9 (+0.6) | +26.1 (+28.5) | 1.41 |
| sea, 26 kn | beach, veil | 48.8 | 11.3 | -0.3 | 0.76 | 0.10 | 0.10 | 0.66 | -0.7 (-3) | +25.6 (+28.1) | 1.81 |
| land, 6 kn | dark | 30.9 | 6.8 | -0.3 | 0.44 | 0.07 | 0.44 | 0.84 | -1 (-2) | +27 (+34.5) | 1.40 |
| land, 6 kn | light, before | 52.9 | 6.6 | 0 | 0.53 | 0.00 | 0.40 | 0.70 | 0 (0) | +20.4 (+24.6) | 0.78 |
| land, 6 kn | light, veil | 52.9 | 4.5 | -0.9 | 0.35 | 0.27 | 0.34 | 0.93 | -3.2 (-4.1) | +19.7 (+24.5) | 0.96 |
| land, 6 kn | beach, before | 52.5 | 6.7 | 0 | 0.52 | 0.00 | 0.41 | 0.70 | +0.2 (0) | +19.1 (+24.9) | 0.64 |
| land, 6 kn | beach, veil | 52.5 | 4.5 | -0.7 | 0.35 | 0.25 | 0.36 | 0.93 | -2.8 (-3.7) | +17.6 (+24.6) | 0.80 |
| land, 15.3 kn | dark | 38.5 | 10.3 | -0.2 | 0.63 | 0.08 | 0.24 | 0.72 | -0.6 (-1.7) | +29.1 (+32.1) | 1.44 |
| land, 15.3 kn | light, before | 49.4 | 10.3 | 0 | 0.73 | 0.00 | 0.20 | 0.48 | +1.7 (0) | +24.6 (+27.5) | 1.04 |
| land, 15.3 kn | light, veil | 49.4 | 7.5 | -0.5 | 0.54 | 0.18 | 0.22 | 0.85 | -2.2 (-3.1) | +24 (+27.3) | 1.30 |
| land, 15.3 kn | beach, before | 42.9 | 11.7 | 0 | 0.74 | 0.00 | 0.20 | 0.47 | +1.8 (0) | +28 (+31.9) | 1.18 |
| land, 15.3 kn | beach, veil | 42.9 | 9.1 | -0.3 | 0.59 | 0.13 | 0.23 | 0.78 | -1.4 (-2.4) | +27.3 (+31.8) | 1.40 |
| land, 26 kn | dark | 38.7 | 13.3 | -0.1 | 0.79 | 0.03 | 0.14 | 0.52 | +1.3 (-1.6) | +30.2 (+32.6) | 1.84 |
| land, 26 kn | light, before | 48.3 | 14.8 | 0 | 0.88 | 0.00 | 0.09 | 0.24 | +4.8 (+0.4) | +27.4 (+29.5) | 1.43 |
| land, 26 kn | light, veil | 48.3 | 11.9 | -0.2 | 0.75 | 0.07 | 0.14 | 0.63 | 0 (-2.7) | +27 (+29.3) | 1.82 |
| land, 26 kn | beach, before | 52.1 | 13.7 | 0 | 0.87 | 0.00 | 0.09 | 0.25 | +4.5 (+0.4) | +25.6 (+28.1) | 1.33 |
| land, 26 kn | beach, veil | 52.1 | 10.8 | -0.2 | 0.73 | 0.08 | 0.14 | 0.69 | -0.3 (-3) | +25.2 (+27.8) | 1.75 |

### T2. The composite's law, fitted from the screen and the trail buffer (the sea)

| arm | crop | light p | veil q | residual, 8-bit levels | dark's law alone: opacity, residual | the glow law alone: opacity, residual | pixel-channels the stated law explains to 1.5 levels |
|---|---|---|---|---|---|---|---|
| dark, dev | 6 kn | 0.505 | 0.505 | 0.397 | 0.505, 0.397 | 0.434, 7.08 | 0.999 |
| dark, dev | 15.3 kn | 0.505 | 0.505 | 0.289 | 0.505, 0.289 | 0.43, 7.278 | 1 |
| dark, dev | 26 kn | 0.505 | 0.505 | 0.298 | 0.505, 0.298 | 0.438, 6.657 | 1 |
| light, dev | 6 kn | 0.999 | 0 | 0.455 | 0.716, 26.582 | 0.999, 0.455 | 0.999 |
| light, dev | 15.3 kn | 0.999 | 0 | 0.288 | 1.286, 20.976 | 0.999, 0.288 | 1 |
| light, dev | 26 kn | 0.999 | 0 | 0.291 | 1.397, 18.425 | 0.999, 0.291 | 1 |
| beach, dev | 6 kn | 0.999 | 0 | 0.413 | 0.943, 23.094 | 0.999, 0.413 | 0.999 |
| beach, dev | 15.3 kn | 0.999 | 0 | 0.287 | 1.29, 17.642 | 0.999, 0.287 | 1 |
| beach, dev | 26 kn | 0.999 | 0 | 0.29 | 1.25, 23.16 | 0.999, 0.29 | 1 |
| light, veil | 6 kn | 0.998 | 0.505 | 0.435 | 1.032, 17.132 | 0.797, 10.009 | 0.999 |
| light, veil | 15.3 kn | 0.999 | 0.505 | 0.291 | 1.293, 12.101 | 0.85, 7.679 | 1 |
| light, veil | 26 kn | 0.999 | 0.505 | 0.292 | 1.332, 10.898 | 0.889, 6.666 | 1 |
| beach, veil | 6 kn | 0.999 | 0.505 | 0.395 | 1.136, 13.86 | 0.801, 8.564 | 0.999 |
| beach, veil | 15.3 kn | 0.999 | 0.505 | 0.288 | 1.26, 9.874 | 0.865, 6.735 | 1 |
| beach, veil | 26 kn | 0.999 | 0.505 | 0.291 | 1.248, 14.508 | 0.861, 7.634 | 1 |

Over land (the same fits): 
the share that obeys each theme's own law to 1.5 levels at 6 / 15.3 / 26 kn is dark 0.917 / 0.894 / 0.876, light 0.931 / 0.912 / 0.895, beach 0.917 / 0.913 / 0.886; the fitted p and q there are pulled by the rest (dark p 0.487 / 0.473 / 0.464, q 0.406 / 0.391 / 0.349).

### T3. One variable at a time (the sea; a pixel's darkest moment against the field at 6 / 15.3 / 26 kn, and the share of pixel-instants 1.5 L* or more under it at 15.3 kn)

| what was changed, alone | dark: darkest | under | light: darkest | under | beach: darkest | under |
|---|---|---|---|---|---|---|
| nothing (dev) | -2.1 / -2.2 / -0.2 | 0.19 | 0 / +1.8 / +5.6 | 0.00 | 0 / +1.8 / +4.9 | 0.00 |
| **the composite's branch** (dark on the glow branch; light and beach on dark's) | +0.1 / +2 / +5.2 | 0.00 | -6.8 / -5.6 / -4.2 | 0.41 | -5.9 / -3.9 / -4.8 | 0.31 |
| the mark's white inner ring off | -2.8 / -2.5 / -0.8 | 0.22 | 0 / +1.6 / +5.3 | 0.00 | 0 / +1.7 / +4.5 | 0.00 |
| the mark's light level (dark at 0.742; light and beach at 1) | -2.3 / -2.6 / -2.1 | 0.28 | +0.4 / +3.6 / +10.7 | 0.00 | +0.3 / +3.9 / +9.5 | 0.00 |
| the trail's fade, 0.975 to 0.965 a frame | -2.3 / -2.6 / -1.8 | 0.23 | 0 / +0.7 / +3.2 | 0.00 | 0 / +0.7 / +2.8 | 0.00 |
| half the marks (490 to 245 a 100 x 100 px) | -2.1 / -2.6 / -2.3 | 0.27 | 0 / +0.3 / +1.9 | 0.00 | 0 / +0.3 / +1.6 | 0.00 |

The ground's lightness (the LAND crops, the same arms; field L* then darkest at 6 / 15.3 / 26 kn): 
dark 30.9 / 38.5 / 38.7: -1 / -0.6 / +1.3; light 52.9 / 49.4 / 48.3: 0 / +1.7 / +4.8; light on its land before #320 (the mark's level held) 67.6 / 63 / 61.3: 0 / +1.1 / +3.3; beach 52.5 / 42.9 / 52.1: +0.2 / +1.8 / +4.5; beach on its land before #320 63.1 / 51.6 / 62.1: 0 / +1.4 / +3.3.

Other columns of the branch swap, the sea, 6 / 15.3 / 26 kn: 
dark on the glow branch: over 0.52 / 0.77 / 0.92 (dev 0.38 / 0.58 / 0.78), added 7 / 11.1 / 14.7 (dev 5.2 / 8.2 / 11.5), core +24.9 / +25.6 / +26.8 (dev +24.2 / +25.3 / +26.4); light as dev draws it: over 0.53 / 0.76 / 0.93, added 6.8 / 10.9 / 16.2, core +21.7 / +25.4 / +28.4. Light on dark's branch: over 0.21 / 0.38 / 0.64, added 1.9 / 3.9 / 7.6, core +12.3 / +16.9 / +20.2; beach: over 0.22 / 0.47 / 0.56, added 2.1 / 5.9 / 5.8, core +10.3 / +20.9 / +17.3.

### T5 (sea). Speed ramps, zoom 6, 120 x 330 lossless crops over the sea: dark | light before, with the veil | beach before, with the veil

| kn | field L*: dark, light, beach | darkest: dark | light | light, veil | beach | beach, veil | over: dark | light | light, veil | beach | beach, veil | added: dark | light (x dark) | light, veil (x dark) | beach (x dark) | beach, veil (x dark) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 3.2 | 31.6, 56.4, 54.6 | 0 | 0 | 0 | 0 | 0 | 0.10 | 0.20 | 0.14 | 0.18 | 0.13 | 1.8 | 2.8 (1.56) | 2.2 (1.22) | 2.6 (1.44) | 1.9 (1.06) |
| 5.9 | 39.2, 51.8, 50.2 | -2.3 | 0 | -3.2 | 0 | -2.9 | 0.29 | 0.43 | 0.27 | 0.42 | 0.27 | 3.9 | 5.2 (1.33) | 3.4 (0.87) | 5.3 (1.36) | 3.4 (0.87) |
| 8.6 | 42.6, 51.6, 46.9 | -2.2 | 0 | -3.3 | 0 | -2.5 | 0.28 | 0.41 | 0.24 | 0.42 | 0.26 | 3.4 | 4.8 (1.41) | 2.9 (0.85) | 5.2 (1.53) | 3.3 (0.97) |
| 11.8 | 44.7, 50.3, 43.2 | -2.3 | +1.3 | -2.8 | +1.2 | -2 | 0.54 | 0.72 | 0.51 | 0.71 | 0.53 | 7.3 | 9.8 (1.34) | 6.9 (0.95) | 10.2 (1.40) | 7.4 (1.01) |
| 15.3 | 46.1, 48, 39.6 | -2.4 | +1.6 | -2.5 | +1.7 | -1.7 | 0.57 | 0.75 | 0.56 | 0.76 | 0.60 | 8.1 | 10.8 (1.33) | 7.8 (0.96) | 12 (1.48) | 9.3 (1.15) |
| 18.5 | 46.5, 47.4, 38.6 | -2 | +2.5 | -2.3 | +2.9 | -1.1 | 0.64 | 0.82 | 0.61 | 0.84 | 0.68 | 9 | 11.7 (1.30) | 8.6 (0.96) | 13.5 (1.50) | 10.6 (1.18) |
| 25.6 | 45.6, 47.1, 47.9 | +2.7 | +8.9 | +3.5 | +8.2 | +2.6 | 0.89 | 0.97 | 0.90 | 0.97 | 0.88 | 14.4 | 19 (1.32) | 16.4 (1.14) | 17.7 (1.23) | 14.9 (1.03) |
| 32.3 | 43, 42.5, 51.3 | +3.5 | +11.4 | +6.7 | +8.8 | +3.1 | 0.91 | 0.99 | 0.94 | 0.98 | 0.90 | 14.9 | 21.7 (1.46) | 19.4 (1.30) | 17.2 (1.15) | 14.4 (0.97) |
| 38.5 | 40.3, 37.5, 50.4 | +3.4 | +11.2 | +7.1 | +7.2 | +1.9 | 0.93 | 1.00 | 0.97 | 0.99 | 0.90 | 15.1 | 22 (1.46) | 20.1 (1.33) | 15.7 (1.04) | 13.3 (0.88) |
| 50.0 | 35.9, 34.2, 39.7 | +2.2 | +8.7 | +5 | +4.8 | +1 | 0.90 | 0.99 | 0.95 | 0.97 | 0.87 | 14.7 | 20 (1.36) | 18.3 (1.24) | 16.1 (1.10) | 14.2 (0.97) |

| kn | core, median (highest tenth): dark | light | light, veil | beach | beach, veil | flicker: dark | light (x dark) | light, veil (x dark) | beach (x dark) | beach, veil (x dark) | under: dark | light, veil | beach, veil |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 3.2 | 0 (+26.4) | 0 (+21.5) | 0 (+21.1) | 0 (+19.7) | 0 (+18.7) | 0.16 | 0.11 (0.71) | 0.14 (0.91) | 0.09 (0.60) | 0.12 (0.75) | 0.15 | 0.13 | 0.12 |
| 5.9 | +21.7 (+28.6) | +20.1 (+25.1) | +19 (+24.8) | +18.9 (+24.9) | +16.5 (+24.4) | 0.92 | 0.61 (0.67) | 0.75 (0.82) | 0.52 (0.56) | 0.63 (0.69) | 0.23 | 0.28 | 0.26 |
| 8.6 | +20.2 (+27.1) | +19.2 (+24.6) | +17.6 (+24.3) | +19.2 (+26.3) | +16.7 (+25.7) | 0.75 | 0.55 (0.74) | 0.68 (0.90) | 0.51 (0.69) | 0.60 (0.80) | 0.23 | 0.31 | 0.26 |
| 11.8 | +24.8 (+26.9) | +24 (+26.2) | +23.5 (+25.9) | +25.2 (+29.4) | +23.9 (+29.1) | 1.29 | 0.98 (0.76) | 1.24 (0.96) | 1.01 (0.78) | 1.19 (0.92) | 0.20 | 0.23 | 0.19 |
| 15.3 | +25.3 (+26.8) | +25.5 (+27.7) | +25 (+27.6) | +28.4 (+32.2) | +27.7 (+32) | 1.35 | 1.08 (0.80) | 1.34 (1.00) | 1.18 (0.87) | 1.37 (1.02) | 0.20 | 0.21 | 0.14 |
| 18.5 | +25.4 (+26.9) | +25.9 (+28.1) | +25.4 (+27.8) | +29.6 (+32.9) | +28.9 (+32.7) | 1.48 | 1.19 (0.80) | 1.48 (1.00) | 1.33 (0.90) | 1.54 (1.04) | 0.16 | 0.18 | 0.09 |
| 25.6 | +26.8 (+27.6) | +28.7 (+29.4) | +28.5 (+29.4) | +27 (+29.7) | +26.7 (+29.5) | 2.18 | 1.76 (0.81) | 2.27 (1.04) | 1.62 (0.74) | 2.11 (0.97) | 0.03 | 0.03 | 0.04 |
| 32.3 | +27.8 (+28.6) | +31.3 (+32.5) | +31 (+32.5) | +25.7 (+26.8) | +25.4 (+26.7) | 2.42 | 2.00 (0.83) | 2.51 (1.04) | 1.60 (0.66) | 2.16 (0.89) | 0.02 | 0.01 | 0.03 |
| 38.5 | +28.9 (+29.6) | +33.4 (+34.5) | +33.3 (+34.4) | +26 (+26.6) | +25.8 (+26.6) | 2.71 | 2.34 (0.86) | 2.79 (1.03) | 1.99 (0.73) | 2.58 (0.95) | 0.01 | 0.00 | 0.02 |
| 50.0 | +30.6 (+31.5) | +34.3 (+35.7) | +34.2 (+35.5) | +31.1 (+32.1) | +31 (+32) | 3.03 | 2.71 (0.89) | 3.10 (1.02) | 2.75 (0.91) | 3.19 (1.05) | 0.02 | 0.01 | 0.04 |

### T5 (land). Speed ramps, zoom 6, 120 x 330 lossless crops over the land: dark | light before, with the veil | beach before, with the veil

| kn | field L*: dark, light, beach | darkest: dark | light | light, veil | beach | beach, veil | over: dark | light | light, veil | beach | beach, veil | added: dark | light (x dark) | light, veil (x dark) | beach (x dark) | beach, veil (x dark) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 3.2 | 23.6, 56.9, 57.3 | 0 | 0 | 0 | 0 | 0 | 0.15 | 0.23 | 0.16 | 0.21 | 0.13 | 2.8 | 3 (1.07) | 2.2 (0.79) | 2.6 (0.93) | 1.8 (0.64) |
| 5.9 | 31.7, 52.6, 52.8 | -1.2 | 0 | -3.1 | 0 | -2.9 | 0.33 | 0.41 | 0.25 | 0.39 | 0.24 | 5 | 4.8 (0.96) | 3.1 (0.62) | 4.8 (0.96) | 3.1 (0.62) |
| 8.6 | 35.9, 51.9, 49.2 | -1.2 | 0 | -3.2 | 0 | -2.6 | 0.33 | 0.40 | 0.24 | 0.41 | 0.26 | 4.6 | 4.7 (1.02) | 2.9 (0.63) | 5.1 (1.11) | 3.3 (0.72) |
| 11.8 | 38.1, 51.9, 46.6 | -0.6 | +1 | -2.4 | +1.1 | -1.9 | 0.55 | 0.64 | 0.46 | 0.66 | 0.50 | 8.7 | 8.7 (1.00) | 6.1 (0.70) | 9.5 (1.09) | 7 (0.80) |
| 15.3 | 38.5, 49, 42.9 | -0.7 | +1.7 | -2.2 | +1.7 | -1.4 | 0.64 | 0.74 | 0.55 | 0.73 | 0.58 | 10.4 | 10.5 (1.01) | 7.6 (0.73) | 11.6 (1.12) | 9.1 (0.87) |
| 18.5 | 39.5, 48.5, 42 | -0.2 | +2.1 | -1.8 | +2.6 | -0.6 | 0.68 | 0.77 | 0.58 | 0.80 | 0.66 | 11 | 10.9 (0.99) | 8 (0.73) | 13 (1.18) | 10.4 (0.95) |
| 25.6 | 38.9, 49.4, 51.1 | +4.5 | +8.1 | +2.6 | +8 | +2.5 | 0.82 | 0.86 | 0.79 | 0.90 | 0.82 | 16.1 | 16.5 (1.02) | 14.2 (0.88) | 16.6 (1.03) | 14.2 (0.88) |
| 32.3 | 35.5, 44.3, 54.4 | +6.8 | +11.4 | +6.8 | +9.2 | +3.5 | 0.93 | 0.96 | 0.93 | 0.94 | 0.87 | 18.3 | 20.6 (1.13) | 18.6 (1.02) | 16.7 (0.91) | 14.3 (0.78) |
| 38.5 | 33.8, 40, 53.6 | +5.7 | +10 | +5.9 | +8.1 | +2.6 | 0.91 | 0.94 | 0.91 | 0.94 | 0.87 | 17.4 | 19.7 (1.13) | 17.9 (1.03) | 15.6 (0.90) | 13.3 (0.76) |
| 50.0 | 30.1, 36.9, 43.7 | +4.7 | +8 | +4.3 | +6.8 | +2.5 | 0.89 | 0.93 | 0.89 | 0.93 | 0.86 | 17 | 18 (1.06) | 16.4 (0.96) | 15.9 (0.94) | 14.1 (0.83) |

| kn | core, median (highest tenth): dark | light | light, veil | beach | beach, veil | flicker: dark | light (x dark) | light, veil (x dark) | beach (x dark) | beach, veil (x dark) | under: dark | light, veil | beach, veil |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 3.2 | 0 (+33.6) | 0 (+21.4) | 0 (+20.9) | 0 (+18.9) | 0 (+17.9) | 0.30 | 0.17 (0.56) | 0.22 (0.73) | 0.14 (0.45) | 0.17 (0.59) | 0.07 | 0.14 | 0.14 |
| 5.9 | +20.3 (+33.9) | +15.9 (+24.8) | +14 (+24.5) | +15.1 (+24.6) | +12.3 (+24.1) | 0.92 | 0.57 (0.62) | 0.70 (0.76) | 0.49 (0.53) | 0.60 (0.65) | 0.07 | 0.27 | 0.25 |
| 8.6 | +21.1 (+31.9) | +17.2 (+24.4) | +15.5 (+24.1) | +18 (+25.9) | +15.6 (+25.3) | 0.81 | 0.54 (0.67) | 0.67 (0.82) | 0.52 (0.64) | 0.62 (0.76) | 0.06 | 0.28 | 0.24 |
| 11.8 | +28.3 (+32) | +23.1 (+26) | +22.4 (+25.7) | +24.7 (+29.2) | +23.7 (+28.9) | 1.27 | 0.87 (0.69) | 1.11 (0.87) | 0.96 (0.75) | 1.15 (0.90) | 0.07 | 0.20 | 0.17 |
| 15.3 | +29 (+32.1) | +24.6 (+27.5) | +23.9 (+27.4) | +27.8 (+32) | +27.2 (+31.8) | 1.45 | 1.05 (0.72) | 1.32 (0.91) | 1.17 (0.80) | 1.38 (0.95) | 0.08 | 0.20 | 0.13 |
| 18.5 | +29.2 (+32.1) | +25 (+27.8) | +24.3 (+27.6) | +29.5 (+32.8) | +28.9 (+32.5) | 1.52 | 1.11 (0.73) | 1.39 (0.91) | 1.29 (0.85) | 1.52 (1.00) | 0.06 | 0.15 | 0.07 |
| 25.6 | +31.4 (+32.7) | +27.8 (+29) | +27.6 (+28.9) | +26.4 (+29.2) | +26.2 (+29) | 2.10 | 1.53 (0.73) | 1.99 (0.95) | 1.52 (0.73) | 2.02 (0.96) | 0.01 | 0.03 | 0.03 |
| 32.3 | +32.7 (+33.8) | +30.4 (+32) | +30.2 (+32) | +25.2 (+25.9) | +25 (+25.9) | 2.54 | 1.91 (0.75) | 2.40 (0.95) | 1.56 (0.61) | 2.17 (0.86) | 0.00 | 0.01 | 0.02 |
| 38.5 | +33.4 (+34.9) | +32.5 (+34.1) | +32.2 (+34) | +25 (+25.8) | +24.8 (+25.8) | 2.63 | 2.09 (0.80) | 2.51 (0.96) | 1.62 (0.62) | 2.21 (0.84) | 0.00 | 0.00 | 0.01 |
| 50.0 | +35.1 (+36.8) | +33.2 (+35) | +33 (+34.9) | +30.1 (+31.5) | +29.9 (+31.4) | 2.92 | 2.45 (0.84) | 2.82 (0.97) | 2.26 (0.77) | 2.70 (0.92) | 0.00 | 0.01 | 0.01 |

### T6 (zoom 4). the low ramp built for zoom 4; sea crops at 25 N in the Gulf (11.0, 14.6, 18.2 kn), land crops at 37 N

| crop | kn | darkest: dark | light before | light, veil | beach before | beach, veil | over: dark | light before | light, veil | beach before | beach, veil | added: dark | light before | light, veil | beach before | beach, veil | core: dark | light before | light, veil | beach before | beach, veil |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sea | 11.0 | -1.4 | +1.3 | -2.5 | +1.4 | -1.7 | 0.51 | 0.64 | 0.47 | 0.64 | 0.50 | 7.1 | 8.9 | 6.4 | 9.6 | 7.1 | +23.9 | +23 | +22.5 | +24.2 | +23 |
| sea | 14.6 | -1.5 | +2.2 | -2 | +2.3 | -1.1 | 0.57 | 0.71 | 0.55 | 0.72 | 0.58 | 8.1 | 10.5 | 7.7 | 11.6 | 9.1 | +24.6 | +24.7 | +24 | +27.1 | +26.2 |
| sea | 18.2 | -1 | +2.7 | -1.6 | +3.1 | -0.4 | 0.61 | 0.75 | 0.59 | 0.77 | 0.64 | 8.9 | 11.1 | 8.3 | 12.9 | 10.4 | +24.9 | +25 | +24.3 | +28.6 | +27.7 |
| land | 11.0 | -0.1 | +1.3 | -2.2 | +1.3 | -1.6 | 0.56 | 0.63 | 0.47 | 0.64 | 0.49 | 9.1 | 8.6 | 6.1 | 9.3 | 6.9 | +28 | +22.1 | +21.3 | +23.4 | +22.3 |
| land | 14.6 | 0 | +2.3 | -1.7 | +2.3 | -0.7 | 0.64 | 0.71 | 0.55 | 0.71 | 0.58 | 10.7 | 10.2 | 7.5 | 11.2 | 8.8 | +29.1 | +23.5 | +22.7 | +26.1 | +25.2 |
| land | 18.2 | +0.6 | +2.8 | -1.4 | +3.4 | -0.1 | 0.69 | 0.76 | 0.59 | 0.78 | 0.66 | 11.7 | 10.9 | 8.1 | 13.1 | 10.6 | +29.3 | +23.8 | +23 | +28.3 | +27.6 |

### T6 (zoom 8). the low ramp built for zoom 8 (sea 15.3, 20.5, 26.0 kn; land 6.0, 15.3, 26.0 kn)

| crop | kn | darkest: dark | light before | light, veil | beach before | beach, veil | over: dark | light before | light, veil | beach before | beach, veil | added: dark | light before | light, veil | beach before | beach, veil | core: dark | light before | light, veil | beach before | beach, veil |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sea | 15.3 | -2.2 | 0 | -1.9 | 0 | -1.3 | 0.27 | 0.40 | 0.24 | 0.41 | 0.28 | 3 | 3.8 | 2.4 | 4.2 | 2.8 | +20.2 | +16.6 | +16.3 | +18.6 | +18.2 |
| sea | 20.5 | -2.2 | 0 | -1.9 | 0 | -1.3 | 0.33 | 0.46 | 0.29 | 0.49 | 0.34 | 3.6 | 4.4 | 2.8 | 5.1 | 3.6 | +20.5 | +17.1 | +16.9 | +19.7 | +19.2 |
| sea | 26.0 | -1.9 | 0 | -1.6 | 0 | -1.9 | 0.36 | 0.55 | 0.36 | 0.52 | 0.31 | 3.9 | 5.5 | 3.6 | 4.8 | 2.9 | +20.6 | +18.4 | +18.1 | +16.6 | +16.2 |
| land | 6.0 | -1.3 | 0 | -2.3 | 0 | -2 | 0.22 | 0.26 | 0.16 | 0.28 | 0.17 | 2.8 | 2.5 | 1.5 | 2.7 | 1.7 | +20.2 | +13 | +12.1 | +12.9 | +11.7 |
| land | 15.3 | -1.5 | 0 | -1.8 | 0 | -1.3 | 0.32 | 0.39 | 0.24 | 0.43 | 0.29 | 4 | 3.7 | 2.3 | 4.4 | 3.1 | +23.2 | +15.9 | +15.6 | +18.8 | +18.5 |
| land | 26.0 | -1.2 | 0 | -1.7 | 0 | -1.9 | 0.41 | 0.51 | 0.33 | 0.51 | 0.31 | 4.9 | 5 | 3.2 | 4.8 | 3 | +23.6 | +17.4 | +17.2 | +16.6 | +16.4 |


## 19:43Z · The mechanism, with the arithmetic

`WebGLWindShaders.js` `SCREEN_FS`, with `color` the trail buffer's texel and `brightness` its strongest channel:

```glsl
vec4(u_glow > 0.5 ? color.rgb / max(brightness, 0.004) : color.rgb, brightness * (u_glow > 0.5 ? brightness : 1.0) * u_opacity)
```

blended `SRC_ALPHA, ONE_MINUS_SRC_ALPHA` into the map. `u_glow` is 1 exactly where `windInk.js` returns mode 2: light and beach
under dark's rules (the white streak, D-021, is drawn with it), never dark. A channel at a time, with c the buffer's colour, b its
strongest channel, g the ground:

- **dark** (`u_glow` 0): `screen = g + op b (c - g) = g + op (b c - b^2 g) - op b (1 - b) g`. With c = b C (a tail is its colour C
  faded to level b) the change is `op b (b C - g)`: over the ground while `b > g / C`, UNDER it below that, deepest at
  `b = g / 2C` by `op g^2 / 4C`, and back to nothing at b = 0. For a white ring over dark's 15 kn sea (g = 0.46 in the green
  channel): -0.505 x 0.46^2 / 4 = -0.027, 7 levels, about 2.5 L* at L* 46. Measured: -2.2.
- **light and beach** (`u_glow` 1): `screen = g + op b^2 (c / b - g) = g + op (b c - b^2 g)`. For a white streak `c / b` is white
  and `(1 - g)` is never negative: every strength of tail is over the ground, and a pixel is back at the field only when the
  buffer has faded to exactly 0 (about 100 frames at zoom 6: a level loses 2.5% a frame, then one level a frame under 40).

So the difference between the branches at the same buffer level is exactly `- op b (1 - b) g`: a black veil of alpha `op b (1 - b)`.
It is the term rule 1 of dark's rules removed on purpose (`windDarkRules.js`: "Dark's own formula darkens any ground lighter than
black"; `windInk.js`: "a grey ghost"), when light's and beach's grounds were pale. **What that removal cost was never measured as
motion:** it is the whole of "the trails linger".

Why "from 12 kn up they never come back": the more trails cross a pixel, the less often its buffer level reaches 0. Under the
glow branch any level over 0 is over the field, so a busy pixel's darkest moment is over the field; under dark's branch a level
between 0 and `g / C` is UNDER the field, so a busy pixel's darkest moment is under it until the trails are so dense that the
level never falls below `g / C` (dark from about 25 kn: +2.7 to +3.5).

**Confirmed three ways** (T2 and T3 above):

1. **The fit** (`truth-run.js --law`, the sea, 16 to 21 million pixel-channels a crop): dark p 0.505, q 0.505; light and beach
   p 0.999, q 0.000; residuals 0.29 to 0.46 of a level; 99.9% to 100% of pixel-channels obey the stated law to 1.5 levels. Each
   theme's fit under the OTHER law leaves 7 to 27 levels. Where the buffer is empty the screen is the field (0.000): the three
   crops are the same pixels.
2. **The swap, one uniform forced on the real engine** (`"screen.u_glow@map"`): dark on the glow branch stops dipping (darkest
   +0.1 / +2.0 / +5.2 where it was -2.1 / -2.2 / -0.2; the share under the field 0.00) and reads as light does on dev (over 0.77,
   added 11.1 at 15.3 kn; light 0.76 and 10.9); light and beach on dark's branch dip (-6.8 / -5.6 / -4.2 and -5.9 / -3.9 / -4.8).
3. **The term put back** (the veil, below): with it the fit reads p 0.999, q 0.505 against the core's level, and light's and
   beach's columns move onto dark's.

**Ruled out as the cause of the sign** (each changed alone; none moves a theme's darkest moment across the field; T3):

- **the mark's colour and its white inner ring** (dark: `draw.u_single_casing` forced to 1; light and beach:
  `__RAW_WIND_GLOW_RING__` 0, the streak's own colour at full brightness): dark still dips, light and beach still do not;
- **the mark's light level, `u_white`** (dark forced to light's 0.742; light and beach forced to 1): the same;
- **the casing's black rim**: by reading, it is the same in all three (`DRAW_FS`: a fixed pole, ring 1 since D-021);
- **the trail's fade** (`__RAW_DISABLE_WIND_WIDE_TRAILS__`: 0.975 to 0.965 a frame): light's and beach's darkest moment comes
  DOWN (+1.8 to +0.7 at 15.3 kn) and never crosses;
- **how many trails cross a pixel** (`__RAW_WIND_V2_DENSITY__` 245, half): the same (+1.8 to +0.3);
- **the marks' alpha from the colour table**: dark's rows carry 0.85 / 0.88 / 0.90 at 6 / 15.3 / 26 kn, light's 0.78 / 0.82 / 0.86,
  beach's sea rows 0.61 / 0.72 / 0.77 (read from `drawnMarkRampData` before #322; that PR moves no streak row). An alpha
  scales the buffer's level, and the level arm moved it further than these differ, both ways, without a crossing;
- **the ground's own lightness**: it sets the SIZE of dark's dip (the veil takes `g^2`: dark dips less over its darker land) and
  never gives the glow branch one (light and beach on their land as it was before #320, 61 to 68 L*: still 0 / +1.1 / +3.3).

Fade and trail count are not nothing: they set HOW FAR over the field the glow branch's pixels sit. They cannot give it a pixel
under the field.

## 20:13Z · The owner: on by default. What draws (DECISIONS D-028)

`frontend/src/components/map/windTrailVeil.js`: light and beach, wherever the white streak is laid ground by ground (D-021,
D-022), draw the glow branch's light UNCHANGED plus dark's veil, measured against the level a streak's core is laid at:

```
screen - g  =  opacity (b c - b^2 g)  -  veil b' (1 - b') g          b' = min(1, b / level)
```

`level` = the square root of the white's strength (0.742: the veil is nothing at a full core); `veil` = dark's own composite
opacity at this zoom (0.505 at zooms 4 to 9, 0.48 outside) times the theme's close-zoom factor. One shader line reaches it, inside
`u_glow` and only with a veil over 0; the line every other path draws by is untouched. Nothing about the particles changes:
positions, count, size, lifetime and the buffer's fade are the engine's.

- **Kill:** `window.__RAW_DISABLE_WIND_TRAIL_VEIL__ = true`, read each frame. Steer (bench and A/B):
  `window.__RAW_WIND_TRAIL_VEIL__` = a number over 0 up to 2 (that multiple of dark's strength) or `false`.
- **Every older kill keeps its picture:** the veil draws only where `windWhiteStreakOn` is true and D-022's kill is not set, so
  every key of `DARK_RULES_HOLDS` and `DARK_RULES_STEERS`, the ink, glow and light-look levers, the neutral-body theme and D-022's
  kill stand it down. Dark never reads it. The kill is classified in `windDarkRules.test.js` (ORTHOGONAL: the alpha the white
  streak's composite lays, never a table, the field or the ground).
- **Strength 1 is dark's own number, not a fitted one, and it is the SEA's.** Light at 0.5 and 0.75 was measured too (the six
  crops, before the flip; a pixel's darkest moment at 6 / 15.3 / 26 kn):

  | | the sea | the land |
  |---|---|---|
  | dark | -2.1 / -2.2 / -0.2 | -1.0 / -0.6 / +1.3 |
  | light, veil x 0.5 | -1.1 / -0.3 / +2.8 | -0.9 / 0.0 / +2.2 |
  | light, veil x 0.75 | -2.0 / -1.4 / +1.5 | -2.0 / -1.0 / +1.0 |
  | light, veil x 1 (the default) | -3.2 / -2.5 / +0.1 | -3.2 / -2.2 / 0.0 |

  Dark has two grounds (a slate sea and a near-black land) and one veil, which takes little from the land. Light and beach now
  have ONE ground depth (D-026 drew their land at their sea's depth), near dark's sea. So one strength can sit on dark's sea
  (1) or on dark's land (0.5), not both; 0.75 is nearest dark over the six crops together. The default is 1: it is dark's own
  number, a wide view is mostly sea, and a number solved on one scene has failed three times in this program (L-V50). **It is
  the first thing to steer if the land looks over-carved** (`window.__RAW_WIND_TRAIL_VEIL__ = 0.5` or `0.75`).

## 20:46Z · Measured with the veil

T1 (six crops), T5 (ten speeds, the sea and the land) and T6 (zooms 4 and 8) above. In words:

- **The sea, 6 to 26 kn: light's and beach's columns move onto dark's.** At 15.3 kn, dark / before / with the veil: darkest
  -2.2 / +1.8 / -2.5 in light and -2.2 / +1.8 / -1.6 in beach; the share lit 0.58 / 0.76 / 0.56 and 0.58 / 0.76 / 0.60; the
  share under 0.19 / 0.00 / 0.20 and 0.19 / 0.00 / 0.14; light added 8.2 / 10.9 / 7.9 and 8.2 / 12.1 / 9.4; flicker
  1.37 / 1.09 / 1.36 and 1.37 / 1.19 / 1.39. Along the ramps (T5, the sea) light's darkest moment is within 1.1 L* of dark's from
  5.9 to 25.6 kn and beach's within 1.5 at every speed.
- **Light added, against dark's at the same crop** (T5). The sea: light went from 1.30 to 1.56 times dark's to 0.85 to 1.33
  times; beach from 1.04 to 1.53 to 0.87 to 1.18. **The land: both went from about dark's (light 0.96 to 1.13, beach 0.90 to
  1.18) to UNDER it: light 0.62 to 0.79 of dark's up to 18 kn (0.88 to 1.03 from 26 kn), beach 0.62 to 0.95 (0.76 to 0.88).**
  That is the land's side of the one-ground trade above.
- **Flicker** (the motion the eye is given) went from 0.56 to 0.91 of dark's to 0.69 to 1.05 over the sea, and from 0.45 to 0.85
  to 0.59 to 1.00 over land.
- **A core keeps its height where it is a full core.** The highest tenth of pixels' lightest moments moves 0.6 L* at most from
  6 kn up (1.0 at 3 kn in beach). The MEDIAN lightest moment falls by 0.1 to 1.9 L* in light and 0.1 to 2.8 in beach, most at 6
  to 9 kn (T5): a streak laid by one stamp of a mark whose table alpha is under 1 sits below the core's level, where the veil is
  not nothing. Dark's own cores carry the same term (its marks' alpha is 0.85 to 0.90).
- **Above 30 kn light stays further over the field than dark** (darkest +5.0 to +7.1 where dark is +2.2 to +3.5, down from +8.7
  to +11.4): there the trails are so dense that the level rarely leaves the range where the veil is small, and light's field is
  deeper than dark's sea under the same white. Beach follows dark there.
- **Zooms 4 and 8** (T6): the same direction at both. At zoom 8 light's and beach's pixels already came back TO the field before
  (darkest 0: the fade is faster there), and now dip as dark's do.

**What it costs, and where to look:**

- **The veil takes in proportion to the ground (`g^2`).** Where light's and beach's ground is lighter than dark's, their tails
  dip further than dark's do: at 6 to 9 kn over the sea by 0.9 to 1.1 L* more in light and 0.3 to 0.6 in beach (their field
  there is 47 to 52 L*, dark's 39 to 43), and over LAND from 6 to 18 kn by 1.5 to 2.0 L* more in light and 0.4 to 1.7 in beach
  than dark over its near-black land (T5, land), where the share of pixel-instants under the field is 0.07 to 0.28 against
  dark's 0.06 to 0.08. It is the depth dark shows over its sea. Whether that reads as a crisp streak or as a grey edge is for
  the eye, in slow wind over land first.
- **Calm (3 kn):** the median pixel is untouched in every theme (no streak reaches it); the deepest tenth dips 3.8 to 4.3 L*
  (dark's 5.2 over the sea and 2.7 over land).
- No table moves, so the palette checker is unchanged: `node scripts/wind-color/check.mjs --strict` exits 0 with 0 red lines
  and 0 red colour-blind lines (light's legend 5.4, its tint 5.1 over water and 5.0 over land; beach's and dark's lines as #322
  left them).

## The kill, proven

- **`origin/dev`'s own engine against this tree** (`--ref origin/dev` at `a022b398` against the working tree at `3736ebb7`, the
  same run position): under the kill, light and beach are the same bytes at the three sea crops, 90 of 90 frames each (540
  frames); dark by default the same bytes (270 frames). Over land: beach 0.000 CIE76 at two crops; light 0.036 and 0.039, dark
  0.048 (the null control is 0.04 to 0.10).
- The default is the picture measured before the flip (the steer at `true` on the commit before): the same bytes, 90 of 90, at
  three crops, light and beach. The steer at `false` is dev's light, 90 of 90.
- With the veil drawn the GPU does what the mirror says: `--law --level 0.7416` reads p 0.998 to 0.999, q 0.505, residual 0.29
  to 0.44 of a level, in light and beach at three speeds.

## 20:35Z · Dev moved under this branch (#322)

PR #322 (beach's field, "the margin") merged at 20:01Z, after this branch was cut. It moves beach's FIELD rows only
(`windBeachPath.js`), so beach's ground changed and every beach number here was taken again on the merged tree: beach "before" is
`origin/dev` at `a022b398`. Dark's and light's frames are the same bytes before and after (checked by hash against the first
capture). Beach's one-variable arms were re-run with the kill set and one thing changed. The app's own merge tool failed on the
host ("Committer identity unknown") and left nothing in progress; the merge was made in the session's checkout (`3736ebb7`), no
conflict (the two changes share no file).

<<REVIEW>>

## Not verified

- **Nothing seen in the app, and not by the owner.** The bench is headless Chromium on a desktop GPU with the real engine, the
  real basemaps and synthetic wind (a speed ramp); the two clips also carry the served wind x0.4.
- **One seed, one view (Mobile Bay), zooms 4, 6 and 8, speeds 3 to 50 kn.** No storm fixture at full strength, no zoom 9 and
  over, no pan or zoom in motion (the veil is a function of the buffer's level at a pixel; the trail buffer's own camera is not
  touched), no theme switch mid-run on the GPU (the recording-GL test covers the uniform through a kill toggle).
- **Phones.** `SCREEN_FS` is `mediump`. On a real 16-bit mediump GPU `b * b * op` underflows to 0 below a buffer level of about
  2 of 255, where the veil then stands alone at an alpha under 0.006: by the arithmetic that is under half a level, not measured
  on a device. No device pixel ratio but 1.5 was run.
- **The law over land** is read on the 88% to 93% of pixel-channels that are not under one of the map's own lines or names; the
  rest pull the fit, and that they ARE the map's lines was inferred from the null control (the land differs run to run, the sea
  does not), not masked out.
- **Light added over 30 kn** stays 1.24 to 1.33 times dark's over the sea in light. Not retuned: one variable at a time.
- The lead's earlier clips and D-022's strengths were judged on pictures without the veil. With it the streaks add less light
  (0.6 to 0.9 of what they did); whether 0.55 is still the right strength, and whether the land wants a weaker veil than the
  sea, is the owner's eye's, after this is seen.
- The strength table's 0.5 and 0.75 rows are light's alone, on the six crops; beach at those strengths was measured only before
  #322 moved its field (the sea, darkest at 6 / 15.3 / 26 kn: -0.8 / +0.1 / +2.1 at 0.5, -1.6 / -0.7 / +0.6 at 0.75).

## Files

- New: `frontend/src/components/map/windTrailVeil.js`, `windTrailVeil.test.js`, `windBenchTruth.test.js`;
  `frontend/scripts/wind-bench/truth.js`, `truth-run.js`, `force-uniforms.js`.
- Changed: `WebGLWindShaders.js` (one import, the GLSL, one guarded line in `SCREEN_FS`), `WebGLWindEngine.js` (one import, dark's
  opacity kept, one uniform), `windDarkRules.test.js` (the kill classified), `scripts/wind-bench/motion-run.js`,
  `page/map-entry.js`, `README.md` (Truth mode).
- Clips (not in the repo; `frontend/scripts/wind-bench/out/videos/`): `trail-veil-served.webm` (the served wind x0.4, zoom 6:
  dark | before | with the veil, light above beach), `trail-veil-ramp.webm` (the low ramp, the same panes) and
  `trail-veil-strengths.webm` (the served wind: before | the veil at half strength | at dark's own, light above beach).
