# 2026-11-15 Fable (animation lane): a blend between adjacent hours for the wind field

Client only, display only. No served number changes. The owner's word (2026-11-15 15:07Z, relayed by the director): "Yes, blend
them", to whether wind and the tile layers should blend smoothly between hours; it supersedes the wind engine's "never blend
two hours" rule. Taken up in this session at the owner's word ("Do this task here"). Base: `origin/dev` b01a1a74c. Branch
`fable/wind-hour-blend`. The marine version is draft PR #930; its log (`2026-11-15-fable-crest-hour-blend.md`, on that
branch) holds the lessons this gate is built from.

## 1. What is there now (read before the gate was written; nothing built, nothing measured)
- ONE function takes every wind commit: `WebGLWindEngine.prototype.setWindData` (`WebGLWindEngine.js:197`). An hour step on the
  same model takes its last branch (`:283-291`): the base texture is deleted, the new hour is encoded in its place
  (`encodeWindTexture`, `WebGLWindUtils.js:142`), and a fine overlay that "no longer describes the same air" is dropped.
- The rule being superseded: `windGridsCompatible` (`WebGLWindEngine.js:95-112`), "never blend two hours or two models". It
  governs whether the BASE and the FINE OVERLAY may composite. This change does not touch that rule: a base and an overlay
  of different hours still never composite. It adds a short blend between the OUTGOING base and the NEW base.
- A wind texture is RGBA8: R, G = u, v scaled between THAT texture's own minimum and maximum (`uMin`, `uMax` on the encoded
  object, decoded in the shaders as `mix(u_wind_min, u_wind_max, rg)`), B = speed. Each texture has its own range, bounds
  and size.
- Three shaders read the base field: the particle advection (`WebGLWindShaders.js:120-121`), the particle draw (`:466-467`) and
  the colour field (`:903-904`, and five neighbour reads at `:891-896`).
- Particles: a same-model base swap keeps the trails (`WebGLWindLayer.js:476-505`, `keepTrails`).
- The offline harness's synthetic wind (`serve_synthetic.py`, `wind_field`) is the same every hour except a vortex that moves
  0.09 degrees an hour. As the marine gate found for the ocean, a step then changes almost nothing outside the vortex.

## 2. The design (fixed here so the gate cannot be fitted to it afterwards)
- When a commit replaces the base field with another hour of the SAME model, the outgoing base texture is kept (not freed)
  with its own bounds, size, point registration and u/v range. For BLEND_MS = 160 (the rasters' and the marine blend's) the
  three shaders read it at its own place, decode it with its own range, and mix the u/v VECTORS of the two fields; the
  particles are advected through the mixed field and the colour field is coloured from it. Never speed and direction, never
  trails, never colours. Smoothstep ease.
- At rest the earlier texture is not read and is freed: the exact hour is drawn unblended.
- No blend (the hard swap, as today): under the kill; under prefers-reduced-motion; when the model changes; when there was no
  base; when the same hour is committed again on the same grid.
- A grid swap (another size or bounds) is blended like an hour step, the earlier grid read at its own bounds; outside the
  earlier grid the new field is drawn alone.
- The fine overlay is untouched: it is dropped when the hour changes, as today, and files again when it arrives.
- The shader text is added by a wrapper, so with the kill set before the shaders load the three shaders are the text they were.
- Kill: `window.__RAW_DISABLE_WIND_HOUR_BLEND__ = true`. Lab only: `__RAW_WIND_BLEND_MS__`, `__RAW_WIND_BLEND_HOLD__`.
- Truth note: for at most 160 ms the screen shows a mix of two served hours. At rest exactly one.

## 3. THE GATE, written before building and before any measurement. No threshold moves after data.
Instrument: the offline harness only (nothing is asked of the live backend). GFS wind.
**Data, fixed now:** the synthetic backend with a new option `--moving-wind 8`: on top of the stock field, a wind wave of 8 kn,
14 degrees long, travelling 0.6 degrees an hour (1.8 degrees per 3 h step), with u and v a quarter wave apart so both
speed and direction change everywhere. Off by default. The void rule below applies to it.
**Arms:** A = the kill set, B = the blend; both in ONE page, one scrub each per phase, A first on even views and B first on
odd views. **Cache:** before anything is measured in a view, every hour used is visited until it is SETTLED (the engine's
base is not a stand-in and has not changed for 1.5 s; 10 s limit; an hour that does not settle is listed). What counts as a
stand-in for wind is established by a probe of the grid after a step (the marine `scn_grid_at_rest.js`, adapted) and written
into this log before the gate runs.
**Views (ten):** (-40, 35, z2.5), (-140, 20, z3.0), (20, -40, z3.5), (150, -20, z3.0), (-106, 14, z4.0, the vortex),
(-158, 21.6, z5.0), (-9.5, 39, z5.0), (150, -34, z5.0), (-123, 37.5, z5.0), (-5, 50, z4.5). 24 h in 3 h steps, a step every
600 ms: 80 boundaries per arm. Dark theme, desktop 1280 x 800, unless a line says otherwise.

- **W1 smoothness (the colour field, particles not drawn).** The STEP of a boundary = the largest mean absolute change of
  luminance between two consecutive drawn frames in the 600 ms after the step, minus the median of the same in the 400 ms
  before it. Pass: arm B's mean step at most **50%** of arm A's over all boundaries, and no view worse in B. A view whose
  arm-A step is below 2 x its floor is left out and listed; more than 3 such views void the line. Read as smoothness only.
- **W2 frame time.** GPU ms per frame (timer query): arm B's median at most **10%** above arm A's over the scrub, and
  separately inside the blend windows.
- **W3 served bytes.** For every (grid size, valid time) both arms had as the base after a step, the base texture's bytes and
  its u/v range are identical; at least 40 pairs.
- **W4 at rest.** 420 ms after each step: no blend, the mix uniform 0 in all three programs, no kept texture. 80 of 80.
- **W5 the earlier field at its own place (self-mix).** The lab gives the blend an exact copy of the CURRENT base (same bytes,
  same range, same bounds) as the earlier field. Held at 0 and at 0.5 the colour-field picture must equal the picture at rest:
  mean absolute luminance difference at most **0.01**, in every case, on at least 12 cases over world and regional grids.
  Positive control: the same with the earlier field moved one cell must differ by at least 1.0 in every case, or W5 is void.
- **W6 the values drawn are the exact mix.** In a value view (u and v as grey, added to the colour shader for the lab if none
  exists), per pixel, the held picture's value must lie between the reference built from the two hours' bytes rounded down and
  the one rounded up (decoded with each texture's own range), widened by one level. Line: at most **1%** of pixels outside in
  every same-grid held picture; also reported without the widening.
- **W7 truth: the hidden middle hour, in VALUE space.** For hours h, h+3, h+6 on a settled cache: the half-way mix of the u/v
  fields of h and h+6 (what the shader draws at 0.5, checked by W6) against the REAL field of h+3, as the mean vector
  difference in knots over all nodes. ERROR(cut) = the smaller of the same for the real h and the real h+6 fields (on a
  repeat visit a hard cut shows one of the two fine hours). Four triples per view. Pass: pooled ERROR(blend) at most **60%** of
  ERROR(cut); void below 25%; no view where the blend's error exceeds the cut's; at least 30 of 40 triples; the two fields
  mixed are h and h+6. A view whose ERROR(cut) is below **0.5 kn** has no signal and is left out and listed.
  Expected for this fixture, written now: a half-way mix of two waves 92 degrees of phase apart is 0.69 of the amplitude at
  the right phase, so about 40% of the cut's error, as the marine gate measured (40.5%). Read two-sided: far below 25% or far
  above 45% on this fixture means the test, not the blend, needs looking at.
  Also in picture space (the colour field, particles not drawn, the held picture read 3 s after the jump, the truth picture
  read twice): reported, with the same lines, and must not contradict the value-space result.
- **W8 no direction smear, no doubled trails.**
  (a) Speed kept through the mix, in value space: mean |half-way vector| divided by the mean of the two hours' speeds, pooled
  over the triples' nodes, at least **0.85**. Positive control: the same for two hours 12 h apart (the moving wave in
  near-opposite phase) must FALL BELOW 0.85 on the wave's part of the field, or W8(a) cannot see smear and is void.
  Stated before data: a vector mix of a feature that has moved or turned DOES lose speed in the middle; W8(a) measures how
  far this data is from that, and real runs with fast narrow features are not covered.
  (b) Particles: the number of particle vertices drawn per frame is the same before, during and after every step in both
  arms, and the particle layer is not cleared at a step in arm B where it is not in arm A (the mean luminance of the
  particle-only picture in the 200 ms after a step is not lower in B than in A by more than 5%).
- **W9 a fast drag.** One step per 100 ms: arm B's mean step (W1's measure) not larger than arm A's.
- **W10 the first visit** (the outgoing fine field and the stand-in of the next hours, if the wind engine has a stand-in; if the
  probe shows it has none, this line does not apply and that is recorded). The baseline that DECIDES is the real cut: the
  stand-in of the new hour against the real h+3 field's picture. Pass: pooled ERROR(blend) at most **100%** of it (the blend is
  not worse than what a cut shows) and in at least 80% of the scored views; a view whose cut error is below 1.0 luminance unit
  is not scored. The 60% line of the same-grid case is NOT carried over: one input is a stand-in (the marine gate's lesson).
- **W11 the off paths.** Unit tests: the kill and prefers-reduced-motion give no blend; with the kill set before load the three
  shaders are byte for byte the text they were; with the mix at 0 the earlier texture is not read.
- **W12 themes and layouts.** W1, W4 and W5 again in the light and beach themes on desktop, and in the dark theme on the phone
  layout (390 x 844). Each must pass its line.
- Controls that must be shown able to fail are named in their lines (W5, W8a). A failed or void line is recorded as it is.
  Nothing is tuned against this data without a new dated registration.
- The advisor is sent this text before anything is measured. NOT covered: real model runs (owed before default-on, as for
  marine), EURO and ICON wind, the fine overlay's own arrival, Safari, Firefox, a real phone, the deployed site.

## 4. Built, and the probe the gate asked for, BEFORE any gate line is measured (17:02 EST)
Built as designed in section 2: `windHourBlend.js` (the engine side), `windHourBlendGLSL.js` (the text added to the three
shaders by a wrapper; under the kill at load each shader is the text it was), four hooks in `WebGLWindEngine.js`, one in
`WebGLWindEngineInit.js`, a `value` debug view of the colour field for the lab (u, v as red, green), and
`--moving-wind` in the offline backend. No gate number exists yet.

**What the wind engine holds after a step** (`scn_wind_blend.js` with PROBE=1, blend killed; a world view and a coastal view,
the same hours twice; sampled every 40 ms for 7 s beside the /api/weather requests):
- FIRST visit to an hour: the base stays the PREVIOUS hour until the new hour's own request returns, 3.1 to 3.5 s after the
  step in the world view (the request took 2.7-3.3 s on the offline backend). There is NO coarse stand-in of the new hour, as
  the marine engine has. When the new hour arrives it may come as a regional grid that replaces the base (85 x 56), followed
  by the world grid (181 x 83) with the regional one moved to the overlay.
- REPEAT visit: the new hour's world grid (181 x 83) is the base 41-56 ms after the step, with no request; the fine overlay is
  dropped at the step.
- So: **W10 does not apply** (there is no stand-in to mix with), and that is recorded here as section 3 said it would be. On a
  first visit the picture simply waits; the blend then runs when the new hour lands.
- **Settled, for wind:** the base's valid time is no longer the one before the step, and base and overlay have not changed for
  1.5 s; 10 s limit; an hour that does not settle is listed. (The rule first written into the instrument, "unchanged for
  1.5 s", would have called the HELD previous hour settled; corrected before any run.)
