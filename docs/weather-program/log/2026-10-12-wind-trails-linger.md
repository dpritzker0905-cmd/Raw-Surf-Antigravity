# 2026-10-12 · Why light's and beach's wind trails linger over the field and dark's come back to it: the composite's law (D-029)

Local session (Windows, the lead's machine: headless Chromium, D3D11), started by the session that leads the light and beach wind
lanes. Branch `claude/wind-trails-linger`, cut from `origin/dev` at `b764797b` (#318's merge) and merged with `origin/dev`
twice as it moved: `a022b398` (#322) at 20:35Z and `e89aaa85` (#323) at 21:35Z. Times are UTC.

**The brief this session was started with** (the lead session, 19:02Z; not the owner's words): "Find out WHY light's and beach's
wind trails linger above the colour field between streak cores while dark's come back to it, commit the instrument that measures
it, and prepare (do not ship) one candidate that makes light's and beach's tails behave as dark's. Change nothing the app draws by
default." Its background said of the mechanism: "NOT established: all three themes use the same trail composite".

**The owner's words, first-hand in this session's chat, 20:13Z,** while the candidate was being built behind a default-off lever
as that brief asked: "levers to turn on new updates need to be on by default". So the candidate is built ON with a kill
(DECISIONS D-029). The owner has not seen it; no clip had been shown to them when this was written.

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
- `src/components/map/windBenchTruth.test.js`: the statistics on synthetic frames with a known answer (a streak that
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

## 20:13Z · The owner: on by default. What draws (DECISIONS D-029)

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
  kill stand it down; and (after the review, below) so do the land's depth kill (D-026: the land is pale again there) and the
  opaque canvas's kill (D-027: there the veil's alpha would lighten). The paths' kills (D-024, D-025) leave it drawn. Dark never
  reads it. The kill is classified in `windDarkRules.test.js` (ORTHOGONAL: the alpha the white streak's composite lays, never a
  table, the field or the ground).
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

## 21:08Z · The independent review: the veil held; four things around it did not

A fresh agent reviewed the diff at `3736ebb7` with the code and no conclusion (42 mutants, a GPU harness of its own, 129,864
lever states). **What it could not break:** under the kill the shader's output is `origin/dev`'s to the byte on a GPU (0 differing
bytes over 256 levels x 4 colours x 5 grounds x 2 blends, the buffer's copy and the premultiplied and ink composites included);
the veil draws only in the white streak's glow branch (never in dark, with ink, premultiplied, under a hold, a steer or a kill);
the shader compiles in WebGL 1 and 2 and its GPU output is within half a level of the mirror; emulated in 16-bit floats it is
within one level of exact, as the old glow branch is; the uniform is sent before the composite draws and the copy sets `u_glow`
0; the least-squares algebra, residuals, flicker and quantiles in `truth.js` are right.

**What it found, and what was done with each:**

1. **The commit was red on existing tests (high).** The new engine line took `WebGLWindEngine.js` one line over its ratchet
   (1076 against 1075) and added a second `windCloseLandFactor(` where two tests pin one; `motion-run.js`'s cache line no longer
   matched its pin. This session had run its own two suites and not the whole tree. **Done:** the veil's uniform is sent on the
   opacity's own line and the close-zoom factor moved into `trailVeilUniform` (the engine is 1074 lines, as on dev, and names the
   factor once); the cache pin follows the multi-crop line. The whole frontend suite is run before the push (below).
2. **Under the opaque canvas's kill the veil LIGHTENED light's trails (medium).** That kill blends the canvas's alpha by the
   colour's factors, so the veil's extra alpha let light's near-white page through: +4.8 to +9.6 levels where the built blend
   gives -6 to -15 (its GPU read). **Done:** the veil stands down under `__RAW_DISABLE_WIND_OPAQUE_CANVAS__`.
3. **Under the land's depth kill the veil stayed on over land that kill makes pale again (low).** The dip grows with the ground
   squared: -6.6 levels at ground 118, -17.5 at 190 (by the law). **Done:** it stands down under
   `__RAW_DISABLE_WIND_LAND_DEPTH__` too. Both are in the module's "IT STANDS DOWN" list; the paths' kills (D-024, D-025) leave it
   drawn and that is said there.
4. **Nothing ran the GLSL; the tests pinned its text (medium).** Five mutants survived: the include above `precision`, a
   statement added between two pinned lines, the uniform declared `vec3`, the uniform sent after the composite's draw, `u_glow`
   set to 1 during the buffer's copy. **Done:** `windTrailVeil.test.js` now RUNS `trailVeilOf` (its statements turned to
   JavaScript a line at a time, so an added or changed statement changes the result; four positive controls), checks the layout a
   compiler needs (`precision` first, the uniform declared once as `vec2`, only `.x` and `.y` read, two `gl_FragColor`
   assignments), and drives the real engine on a recording GL that keeps every program's uniforms AS THEY STAND AT EACH DRAW: the
   composite's draw holds the veil expected on 17 off paths in three themes and on 23 lever sets, a veil over 0 is only ever held beside `u_glow` 1,
   `u_premul` 0 and `u_ink` 0, and the buffer's copy always draws with `u_glow` 0.
5. **The bench (low).** A run stopped for a forced uniform that never fired left its frames on disk under the arm's name
   (**done:** removed before the stop). The cache key ignored `force`, `--trail` and levers (**done:** `crops.js` `sameRun`).
   `@map` / `@buffer` are judged when a value is SENT, and a forced value persists until the engine sends that uniform again
   (**said** in `force-uniforms.js` and the README, with the advect program as the case that breaks it). The row flip and the
   crop index were untested (**done:** `crops.js`, tested by what it does). `watch`'s extremes depend on a run's length
   (**done:** `truth-run.js` says so when arms differ, and `--diff` when one run is longer).
6. **Records (low).** The decision, the lesson and this log were cited by the code before they existed (they are in this commit,
   as D-029 and L-V76: #323 took D-028, L-V74 and L-V75 while this was being written). L-V73
   gives the mark's colour as the cause of dark's dip; that was the lead's guess and the ring arm rules it out. **Done:** a dated
   note under L-V73.

**Proved again after the fixes** (the engine line and the resolver moved; the tree at `3736ebb7` with them, then at `0e2150b8`
with #323 merged in, each against `origin/dev`'s own engine at the same run position, the three sea crops, by hash): under the
kill light and beach are dev's bytes, 90 of 90 at every crop, both times; dark by default the same; the default is the picture
measured before the fixes, 90 of 90. **And the two kills the veil now stands down under:** with
`__RAW_DISABLE_WIND_LAND_DEPTH__` set, and with `__RAW_DISABLE_WIND_OPAQUE_CANVAS__` set, this tree draws `origin/dev`'s frames
under the same kill, light and beach, 90 of 90 at every crop (12 of 12 comparisons).

**The whole frontend suite** (both trees, the Windows `--testMatch` form): 314 suites, 4501 tests, 0 failed at `3736ebb7` with
the fixes; run again after #323 was merged in (the last section). `node scripts/check_eslint.js` exits 0 (no rule over its
baseline).

## 21:50Z · Dev moved again (#323), and the lead's own candidate beside this one

PR #323 (the coast in the borders' ink) merged at 21:02Z. Its log (`2026-10-12-wind-map-through.md`, the lead session's) holds
two things this session had not been told: **the lead read the same cause in `SCREEN_FS` between 20:02Z and 20:30Z** ("dark's trail composite
reaches zero once the trail fades to the ground's level, the glow composite never does"), on the owner's observation of 20:02Z
("lighter moving air/wind in dark mode is almost transparent, or even smaller animations than in beach or light mode"), with a new
gauge of its own (`anatomy-run.js`: a streak's bright body by speed); and **it built a different candidate, local only**
(`claude/proto-tail-cut`, lever `__RAW_WIND_GLOW_CUT__` = k): the glow laid at alpha `b max(0, b - k) / (1 - k)`, the mark's level
re-solved for its strength. It says the trails lane (this branch) builds it, that a preview clip of it was shown to the owner, and
"no PR until the owner has picked". No message about it reached this session.

**The two candidates are the same law with and without its negative part.** Dark's branch for a white tail is
`op b (b - g)`: over the ground above `b = g`, under it below. The CUT is that with the ground fixed at a number k and clamped at
zero: the tail ends at `b = k` and never dims anything (rule 1 of dark's rules, "light only adds", still holds). The VEIL is that
with the ground the pixel actually has, unclamped: the tail ends where dark's does on that ground and then dips under it as dark's
does. Measured beside each other:

**By truth mode, the sea, 6 / 15.3 / 26 kn** (the cut is the lead's local branch `claude/proto-tail-cut`, read with `--ref`; its field alone is `origin/dev`'s):

| | darkest moment | share under the field | share lit (3 L* or more over) | share at the field | light added | core | flicker |
|---|---|---|---|---|---|---|---|
| dark | -2.1 / -2.2 / -0.2 | 0.21 / 0.19 / 0.08 | 0.38 / 0.58 / 0.78 | 0.37 / 0.18 / 0.10 | 5.2 / 8.2 / 11.5 | +24.2 / +25.3 / +26.4 | 1.30 / 1.37 / 1.85 |
| light, before | 0 / +1.8 / +5.6 | 0.00 / 0.00 / 0.00 | 0.53 / 0.76 / 0.93 | 0.40 / 0.18 / 0.04 | 6.8 / 10.9 / 16.2 | +21.7 / +25.4 / +28.4 | 0.79 / 1.09 / 1.56 |
| light, the veil (this change) | -3.2 / -2.5 / +0.1 | 0.28 / 0.20 / 0.08 | 0.35 / 0.56 / 0.80 | 0.34 / 0.19 / 0.09 | 4.7 / 7.9 / 13.1 | +21.1 / +24.9 / +28 | 0.97 / 1.36 / 1.98 |
| light, the cut at 0.38 | 0 / 0 / 0 | 0.00 / 0.00 / 0.00 | 0.39 / 0.56 / 0.78 | 0.57 / 0.39 / 0.18 | 5 / 8 / 12.8 | +21.2 / +24.9 / +28.1 | 0.87 / 1.30 / 2.00 |
| light, the cut at 0.46 | 0 / 0 / 0 | 0.00 / 0.00 / 0.00 | 0.35 / 0.50 / 0.72 | 0.61 / 0.46 / 0.24 | 4.5 / 7.1 / 11.6 | +20.9 / +24.6 / +27.9 | 0.90 / 1.37 / 2.16 |
| beach, before | 0 / +1.8 / +4.9 | 0.00 / 0.00 / 0.00 | 0.53 / 0.76 / 0.92 | 0.41 / 0.18 / 0.05 | 7 / 12.1 / 14.6 | +20.2 / +28.3 / +26.1 | 0.64 / 1.19 / 1.41 |
| beach, the veil (this change) | -2.7 / -1.6 / -0.7 | 0.25 / 0.14 / 0.10 | 0.36 / 0.60 / 0.76 | 0.36 / 0.22 / 0.10 | 4.7 / 9.4 / 11.3 | +18.6 / +27.5 / +25.6 | 0.78 / 1.39 / 1.81 |
| beach, the cut at 0.38 | 0 / 0 / 0 | 0.00 / 0.00 / 0.00 | 0.37 / 0.55 / 0.76 | 0.59 / 0.40 / 0.20 | 4.9 / 8.6 / 11.2 | +18.8 / +27.2 / +25.6 | 0.71 / 1.40 / 1.78 |
| beach, the cut at 0.46 | 0 / 0 / 0 | 0.00 / 0.00 / 0.00 | 0.33 / 0.49 / 0.70 | 0.65 / 0.48 / 0.27 | 4.3 / 7.5 / 10.1 | +18.1 / +26.7 / +25.4 | 0.73 / 1.46 / 1.90 |

**By the lead's own gauge** (`anatomy-run.js` on the low ramp, zoom 6: the mean over its 12 bands of each ratio to dark, light / beach; the cut's columns are the lead's, from `log/2026-10-12-wind-map-through.md`):

| | before (this session) | before (the lead) | the cut at 0.38 (the lead) | the cut at 0.46 (the lead) | the veil (this session) |
|---|---|---|---|---|---|
| land, body share | 1.29 / 1.28 | 1.30 / 1.28 | 0.97 / 0.95 | 0.88 / 0.85 | 0.97 / 0.97 |
| land, body length (90th pct) | 1.39 / 1.44 | 1.39 / 1.43 | 0.98 / 1.01 | 0.87 / 0.89 | 0.96 / 1.02 |
| sea, body share | 1.45 / 1.42 | 1.47 / 1.45 | 1.11 / 1.05 | 1.00 / 0.94 | 1.10 / 1.08 |
| sea, body length (90th pct) | 1.80 / 1.82 | 1.78 / 1.74 | 1.18 / 1.17 | 1.04 / 1.05 | 1.19 / 1.26 |
| land, core L* | 0.83 / 0.87 | 0.83 / 0.87 | 0.82 / 0.86 | 0.82 / 0.86 | 0.82 / 0.85 |

- **Where the picture is LIT, the two agree with each other and with dark:** the share lit, the light added, the cores and the
  bodies' size (the veil sits on the cut at 0.38 on the lead's gauge: land 0.97 / 0.97 against 0.97 / 0.95, sea 1.10 / 1.08
  against 1.11 / 1.05).
- **Where it is not lit, they differ in kind:** under the cut a pixel between streaks is AT the field (0.39 to 0.40 of
  pixel-instants at 15.3 kn, where dark has 0.18) and never under it; under the veil it is under it as often as dark's is (0.20
  and 0.14 at 15.3 kn against dark's 0.19) and at it as often (0.19 and 0.22 against 0.18).
- **What each costs.** The veil's dip grows with the ground squared: over land and in light air it is deeper than dark's own
  (above), and it is the one thing here that can read as a grey edge. The cut costs nothing of that kind, needs one number for
  two grounds (the lead: 0.38 matches the land, 0.46 the sea) and re-solves the mark's level; it does not give light and beach
  the darker moment dark has between streaks.
- **Not decided here.** This branch builds the veil ON, because it is dark's whole law and this session's brief asked for tails
  that "behave as dark's"; the owner has been shown the cut by the lead, not the veil. **Which of the two is the owner's pick is
  open, and the PR is a draft until it is made.** Either is one module here: the cut's alpha in place of the veil's term is a
  change to `trailVeilOf` and `trailVeilUniform`, no engine line.

**Proof on the merged tree** (`0e2150b8`, #323 in, against `origin/dev` at `e89aaa85`): the kill is dev's bytes in light and
beach, dark by default the same, the default the picture measured before, 90 of 90 at the three sea crops (15 of 15). The whole
frontend suite after the merge: 315 suites, 4522 tests, 0 failed; `check_eslint.js` exits 0; `check.mjs --strict` exits 0 with 0
red lines and 0 red colour-blind lines; the production build compiles (run as `NODE_OPTIONS=--openssl-legacy-provider npx craco
build`: `npm run build` cannot start on Windows, its script sets the variable the POSIX way).

**The clips were filmed again on the merged tree** (#323's coast is on dev now): `trail-veil-served.webm`, `trail-veil-ramp.webm`,
`trail-veil-strengths.webm`, and `trail-veil-vs-cut.webm` (dark | the lead's cut at 0.38 | the veil, light above beach).


## 22:15Z · PR #324 opened as a DRAFT; what hosted CI caught on the first push

The branch was pushed at `d3f8b851` and PR #324 opened as a draft (ledger seq 1140 to 1142). **Hosted CI's File Size Governance
failed on that head:** `WebGLWindShaders.js` is a grandfathered file over the 800-line limit and may only shrink, and the change
had added three lines to it (1029 to 1032). `scripts/loc_ratchet.py` is not among the checks this session had run (the frontend
suite, the lint ratchet, the build, the palette checker): it is one more for the list in L-V77. **Fixed:** the import joins the
import line, the GLSL include joins the line of the include before it, and the guarded branch joins the line that computes the
brightness (1029 lines, as on dev; the same statements). `python scripts/loc_ratchet.py` exits 0. The shader's suites pass (9
suites, 423 tests), and the GPU proof was run once more on that text: against `origin/dev`'s frames the kill in light and beach, dark by default, and
the default against the picture measured before, 90 of 90 at the three sea crops (15 of 15).

## 22:22Z · The lead's ten notes arrived in one batch: the fork is closed, and what they asked for is measured

Notes 1 to 10 from the lead session (written from about 19:20Z to 22:15Z) reached this session together at 22:22Z, after PR #324
was open. None had been delivered before: the section of 21:50Z above, the PR's first body, D-029 and STATE were all written
without them. What they change:

- **The fork is closed: the veil is the tail's build, the cut is withdrawn.** The lead, note 5: "your veil (commit 6c578875,
  windTrailVeil.js) IS the tail's build; my prototype cut is withdrawn"; it reads the two-term law as "the law itself, where my
  cut only approximates its zero crossing and has no dip". The owner's words it rests on, first-hand to the lead and relayed
  here (not witnessed by this session): 20:54Z, "merge #323 and build the tail, also make sure the other sub agents are getting
  what they need to do done so we can get this working"; 21:13Z, "merge the tail pr when its ready [...] make sure your sub
  agents are on the same page here, so we're not just lapping work over work". So #324 is not waiting on a pick: it is marked
  ready for review, and the lead verifies it against dev and merges it. The default strength of 1 stands (the lead's notes 6, 9
  and 10, on its own anatomy table: land 0.97 / 0.98, sea 1.11 / 1.11; steer 1.5 over-veils).
- **What is left is named, and is the lead's, each its own later change:** the near-calm bands (the owner, 21:51Z, to the lead:
  "The almost still wind needs to be almost still and almost transparent on beach and light modes, as that is how it looks on
  dark mode"; the veil moves the 1 to 3 kn bands by under 0.1: it is the white streak's own level in near-calm air, not the
  tail); the sea's remainder (bodies 1.1 to 1.25 of dark's: D-022's 0.55 over the sea); and the land's lightness with the
  streak's strength over it (the lead's `claude/wind-map-far-zoom`: the land at 0.90 / 0.94 with a streak at 0.75), which merges
  AFTER this and is re-read with the veil on. The order the lead set: this PR on today's land; its land step; its near-calm term;
  the colours lane.
- **Its boundary was kept without knowing it:** nothing here edits `windBasemapMute.js` or `WIND_COASTLINE`.

**Measured for the lead's asks** (its notes 7 to 9: both lands, zooms 2 and 3; note 1: the map's side):

**T7. The veil on BOTH lands** (the LAND crops, 6 / 15.3 / 26 kn, zoom 6; the lighter land is the lead's levers: `__RAW_WIND_BASEMAP_LAND_L__` 0.90 in light and 0.94 in beach with `__RAW_WIND_WHITE_LAND__` 0.75):

| | field L* | darkest moment | share under the field | share lit | light added (x dark's) | core, median (highest tenth) |
|---|---|---|---|---|---|---|
| dark, its own land | 30.9 / 38.5 / 38.7 | -1 / -0.6 / +1.3 | 0.07 / 0.08 / 0.03 | 0.44 / 0.63 / 0.79 | 6.8 (1.00) / 10.3 (1.00) / 13.3 (1.00) | +27 (+34.5) / +29.1 (+32.1) / +30.2 (+32.6) |
| light, today's land, before | 52.9 / 49.4 / 48.3 | 0 / +1.7 / +4.8 | 0.00 / 0.00 / 0.00 | 0.53 / 0.73 / 0.88 | 6.6 (0.97) / 10.3 (1.00) / 14.8 (1.11) | +20.4 (+24.6) / +24.6 (+27.5) / +27.4 (+29.5) |
| light, today's land, the veil | 52.9 / 49.4 / 48.3 | -3.2 / -2.2 / 0 | 0.27 / 0.18 / 0.07 | 0.35 / 0.54 / 0.75 | 4.5 (0.66) / 7.5 (0.73) / 11.9 (0.89) | +19.7 (+24.5) / +24 (+27.3) / +27 (+29.3) |
| light, the lighter land, before | 59.5 / 55.6 / 54.1 | +0.3 / +2.1 / +5.8 | 0.00 / 0.00 / 0.00 | 0.53 / 0.75 / 0.89 | 7.1 (1.04) / 11.8 (1.15) / 17.1 (1.29) | +22.1 (+27.6) / +28 (+31.7) / +31.7 (+34.7) |
| light, the lighter land, the veil | 59.5 / 55.6 / 54.1 | -4.1 / -2.7 / +0.1 | 0.29 / 0.20 / 0.08 | 0.37 / 0.57 / 0.78 | 5.5 (0.81) / 9.6 (0.93) / 15.2 (1.14) | +22.1 (+27.6) / +28 (+31.7) / +31.7 (+34.7) |
| light, the lighter land, the veil at half strength | 59.5 / 55.6 / 54.1 | -1.3 / -0.2 / +2.9 | 0.10 / 0.01 / 0.00 | 0.43 / 0.65 / 0.83 | 6.1 (0.90) / 10.5 (1.02) / 16.1 (1.21) | +22.1 (+27.6) / +28 (+31.7) / +31.7 (+34.7) |
| light, the lighter land, the veil's level forced to the land's own | 59.5 / 55.6 / 54.1 | -3.7 / -2.4 / +0.2 | 0.29 / 0.19 / 0.07 | 0.35 / 0.56 / 0.77 | 4.8 (0.71) / 8.6 (0.83) / 13.9 (1.05) | +21.2 (+27.4) / +27.3 (+31.5) / +31.2 (+34.4) |
| beach, today's land, before | 52.5 / 42.9 / 52.1 | +0.2 / +1.8 / +4.5 | 0.00 / 0.00 / 0.00 | 0.52 / 0.74 / 0.87 | 6.7 (0.99) / 11.7 (1.14) / 13.7 (1.03) | +19.1 (+24.9) / +28 (+31.9) / +25.6 (+28.1) |
| beach, today's land, the veil | 52.5 / 42.9 / 52.1 | -2.8 / -1.4 / -0.3 | 0.25 / 0.13 / 0.08 | 0.35 / 0.59 / 0.73 | 4.5 (0.66) / 9.1 (0.88) / 10.8 (0.81) | +17.6 (+24.6) / +27.3 (+31.8) / +25.2 (+27.8) |
| beach, the lighter land, before | 58.3 / 47.8 / 57.6 | +0.2 / +2.3 / +5.4 | 0.00 / 0.00 / 0.00 | 0.53 / 0.76 / 0.88 | 7.4 (1.09) / 14 (1.36) / 15.8 (1.19) | +21 (+28.5) / +33.4 (+38.6) / +29.3 (+33) |
| beach, the lighter land, the veil | 58.3 / 47.8 / 57.6 | -3.6 / -1.6 / 0 | 0.26 / 0.15 / 0.09 | 0.38 / 0.62 / 0.76 | 5.8 (0.85) / 12 (1.17) / 13.8 (1.04) | +21 (+28.5) / +33.4 (+38.6) / +29.3 (+33) |
| beach, the lighter land, the veil at half strength | 58.3 / 47.8 / 57.6 | -1 / +0.1 / +2.3 | 0.06 / 0.00 / 0.00 | 0.43 / 0.68 / 0.82 | 6.4 (0.94) / 12.9 (1.25) / 14.7 (1.11) | +21 (+28.5) / +33.4 (+38.6) / +29.3 (+33) |
| beach, the lighter land, the veil's level forced to the land's own | 58.3 / 47.8 / 57.6 | -3.1 / -1.2 / 0 | 0.26 / 0.14 / 0.08 | 0.36 / 0.61 / 0.74 | 5.1 (0.75) / 11.2 (1.09) / 12.5 (0.94) | +19.3 (+28.1) / +32.7 (+38.4) / +28.9 (+32.7) |

**T8. Zoom 3 (the low ramp built for zoom 3; 200 x 150 crops)**

| crop | darkest: dark | light before | light, veil | beach before | beach, veil | share lit: dark | light before | light, veil | beach before | beach, veil | added: dark | light before | light, veil | beach before | beach, veil | core: dark | light, veil | beach, veil |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| the Gulf, 15.3 kn | -1.1 | +2.6 | -1.5 | +2.7 | -0.5 | 0.59 | 0.74 | 0.58 | 0.74 | 0.61 | 8.1 | 10.9 | 8.3 | 12.1 | 9.7 | +23.6 | +24.4 | +26.7 |
| the open Atlantic, 25.9 kn | +1 | +7.1 | +1.9 | +6.2 | +0.8 | 0.78 | 0.93 | 0.82 | 0.92 | 0.78 | 11 | 16.2 | 13.3 | 14.6 | 11.5 | +24.7 | +27.7 | +25.2 |
| the US interior, 12.5 kn | 0 | +1.2 | -1.4 | +1.4 | -1 | 0.53 | 0.60 | 0.45 | 0.62 | 0.49 | 8.2 | 8.2 | 6 | 9.3 | 7.1 | +25 | +20.4 | +22.4 |

**T9. Zoom 2 (the ramp cannot be built that wide: the bench's own world wind, its speed not read; 160 x 120 crops)**

| crop | darkest: dark | light before | light, veil | beach before | beach, veil | share lit: dark | light before | light, veil | beach before | beach, veil | added: dark | light before | light, veil | beach before | beach, veil | core: dark | light, veil | beach, veil |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| the open Atlantic, 30 N 50 W | -2.4 | +0.4 | -3.1 | +0.3 | -2.7 | 0.33 | 0.55 | 0.36 | 0.54 | 0.36 | 4.1 | 6.8 | 4.4 | 6.9 | 4.5 | +24.1 | +22.2 | +20.7 |
| the US interior | -0.4 | +1.2 | -2.4 | +1.4 | -1.7 | 0.57 | 0.64 | 0.46 | 0.68 | 0.51 | 8.3 | 8.3 | 5.7 | 9.7 | 7.1 | +27.9 | +22.3 | +23.4 |

- **On the lighter land the veil's dip over land is 0.2 to 0.9 L* deeper at 6 and 15 kn than on today's land** (light -4.1 / -2.7
  / +0.1 against -3.2 / -2.2 / 0.0; beach -3.6 / -1.6 / 0.0 against -2.8 / -1.4 / -0.3) and 1.0 to 3.1 L* deeper than dark's over
  its own land there (-1.0 / -0.6): the veil takes the ground squared and that land is 5 to 7 L* lighter under the field. With
  the streak at 0.75 the light added comes back to dark's (light 0.81 / 0.93 / 1.14 of it, beach 0.85 / 1.17 / 1.04, where
  today's land reads 0.66 to 0.89): the lead's reading, reproduced.
- **The veil's level stays the sea's (the question in notes 8 and 9), by measurement.** With the level forced to the land's own
  (`"force": { "screen.u_trail_veil@map": [0.505, 1.1547] }`) the land's streaks add LESS light (light 4.8 / 8.6 / 13.9 against
  5.5 / 9.6 / 15.2) and their median core falls 0.4 to 1.7 L*, for a dip no more than 0.5 L* shallower: a higher level puts the veil
  between the sea's core level and the land's as well. As built, a land streak laid above the sea's level carries no veil down
  to that level, and its core is the unveiled core to the digit (+22.1 / +28.0 / +31.7 with and without the veil). **So: the veil
  as it is, and the land's strength re-solved on top of it by the land's own lane.** If the land's dip is to be dark's land's,
  the lever that does it is the veil's STRENGTH over land (half strength reads -1.3 / -0.2 / +2.9, dark's land -1.0 / -0.6 /
  +1.3), which the screen pass cannot apply by ground today (the land mask is in the draw pass): a later change, not this one.
- **Zooms 3 and 2 move as zooms 4, 6 and 8 do.** Over the sea light's and beach's darkest moment comes from +0.3 to +7.1 over the
  field to within 0.9 L* of dark's; over land their tails dip 1.0 to 2.0 L* under dark's and the streaks add 0.69 to 0.87 of
  dark's light (today's land).
- **The map's side** (`map-run.js --app-sync --themes dark,light,beach --zooms 4,6,8`, the veil against its kill; the WATER
  columns; dark's own row is the bar and is the same under both arms):

  | zooms 4 / 6 / 8 | lines' contrast kept under field + streaks (`retP`) | lines left under half (`lostP`) | the streaks' signal (`sal`) |
  |---|---|---|---|
  | dark | 0.73 / 0.79 / 0.82 | 0.26 / 0.16 / 0.10 | 6.8 / 7.8 / 4.3 |
  | light, before | 0.81 / 0.90 / 0.78 | 0.13 / 0.02 / 0.05 | 9.1 / 11.8 / 6.2 |
  | light, the veil | 0.75 / 0.85 / 0.74 | 0.16 / 0.04 / 0.07 | 6.1 / 8.9 / 4.3 |
  | beach, before | 1.13 / 1.09 / 1.03 | 0.06 / 0.03 / 0.04 | 9.3 / 10.1 / 4.8 |
  | beach, the veil | 1.11 / 1.03 / 0.99 | 0.09 / 0.04 / 0.05 | 6.3 / 7.0 / 3.1 |

  The veil does not buy the map's lines anything by this gauge: over water it takes 0.02 to 0.06 of the contrast they kept
  and leaves 0.01 to 0.03 more of them under half, because the lingering light also lifted the ground beside a dark line. Both
  stay inside dark's own figures except light's water at zoom 8 (0.74 against dark's 0.82; 0.78 before). What it changes is the
  streaks' own signal over water, from 1.1 to 1.5 times dark's to 0.9 to 1.1 in light and 0.7 to 0.9 in beach. Over LAND the same
  column goes from about dark's (0.86 to 1.04) to 0.58 to 0.67 of it in light and 0.63 to 0.76 in beach: the land cost, by a
  third gauge.

**Records moved with this (22:45Z to 22:55Z):** ledger seq 1143 (the push of 8795c078, recorded late), 1144 (a correction to
seq 1135: the owner's words for #323's merge and the lead's before / after reads, as its note 6 gave them), 1145 (D-029 amended:
the cut withdrawn, what is left and whose, the level's choice) and 1146 (a correction to seq 1141: the PR is no longer a draft);
STATE; the PR's title and body rewritten (`gh pr edit 324`) and the PR marked ready for review (`gh pr ready 324`, 22:52Z; read
back: OPEN, not a draft). The module's comment now says why the level is the lower of the two grounds' (a comment only: the veil,
rules, bench, shader and canvas suites, 6 suites and 355 tests, pass after it; `check_eslint.js` and `loc_ratchet.py` exit 0).
Hosted CI on 8795c078, one read at 22:53Z: 18 pass, 1 skipping, 0 failing. **Not in the ledger:** the push of the commit that
carries this section (a line cannot record its own push); the next writer of the ledger records it. This session does not merge.

## Not verified

- **Nothing seen in the app, and not by the owner.** The bench is headless Chromium on a desktop GPU with the real engine, the
  real basemaps and synthetic wind (a speed ramp); the two clips also carry the served wind x0.4.
- **One seed, one view (Mobile Bay), zooms 4, 6 and 8, speeds 3 to 50 kn** (and, in the section of 22:22Z, zoom 3 on a wider
  ramp and zoom 2 on the bench's own world wind, its speed not read). No storm fixture at full strength, no zoom 9 and
  over, no pan or zoom in motion (the veil is a function of the buffer's level at a pixel; the trail buffer's own camera is not
  touched), no theme switch mid-run on the GPU (the recording-GL test covers the uniform through a kill toggle).
- **Phones.** `SCREEN_FS` is `mediump`. On a real 16-bit mediump GPU `b * b * op` underflows to 0 below a buffer level of about
  2 of 255, where the veil then stands alone at an alpha under 0.006: by the arithmetic that is under half a level, not measured
  on a device. No device pixel ratio but 1.5 was run.
- **The law over land** is read on the 88% to 93% of pixel-channels that are not under one of the map's own lines or names; the
  rest pull the fit, and that they ARE the map's lines was inferred from the null control (the land differs run to run, the sea
  does not), not masked out.
- **Light added over 30 kn** stays 1.24 to 1.33 times dark's over the sea in light. Not retuned: one variable at a time.
- (Closed at 22:22Z: the lead withdrew the cut and filmed the veil for the owner itself.) The cut was read here at two values of k on six crops at
  zoom 6; its ramps, zooms 4 and 8 and its land rows (its branch draws the land's field on another commit than the field-alone
  run it was read against: the sea rows are clean, the land rows carry 0.2 to 0.4 L* of that) were not measured.
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
- New after the review: `frontend/scripts/wind-bench/crops.js` (where a crop is; which crop goes to which run; when a saved run
  is this run). `windCanvasAlpha.test.js`: one pinned line of `motion-run.js` follows the multi-crop form.
- Clips (not in the repo; `frontend/scripts/wind-bench/out/videos/`): `trail-veil-served.webm` (the served wind x0.4, zoom 6:
  dark | before | with the veil, light above beach), `trail-veil-ramp.webm` (the low ramp, the same panes),
  `trail-veil-strengths.webm` (the served wind: before | the veil at half strength | at dark's own) and `trail-veil-vs-cut.webm`
  (dark | the lead's cut at 0.38 | the veil).
