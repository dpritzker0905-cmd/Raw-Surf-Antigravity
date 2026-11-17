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

## 5. Registered BEFORE any gate number exists (17:30 EST): the owner's decision, and the advisor's seven changes
**State of measurement when this is written:** no gate line has a number. One single-view shakedown of the instrument was run
(not a gate result, not to be quoted as one). A full scrub run was started 17:08 and STOPPED by me at about 17:20 with 3 of 10
views done, because another lane needs the machine quiet; its partial output is discarded unread and W1-W4, W8b, W9 will be
run whole, later.

**The owner's decision (relayed by the director, 16:14 EST), binding on this lane:** "The hour blend is ONE behaviour
everywhere, and it stays OFF until both of these are done": (1) a hidden-hour test on REAL forecast frames from the public
CDN, replayed offline: the blend's error against the real frame at most the hard swap's, ghosting no worse; negative control,
a corrupted middle frame must fail; positive control, identical neighbours give zero error; (2) a blinded 5-minute look by the
owner, 10 randomized pairs of hard cut against cross-fade. For wind: "blend u/v, keep within one model, cross-hour only."
- So the blend ships **OFF by default**. It runs only when `window.__RAW_ENABLE_HOUR_BLEND__ === true` is set before the app
  loads (one name for the marine and the wind blend: one behaviour). The kill `__RAW_DISABLE_WIND_HOUR_BLEND__` stays and
  wins over it. With the flag unset the three wind shaders are the text they were, byte for byte, and no texture is kept.
  **Merging the PR does not turn anything on.** Turning it on is a later, separate change, at the owner's word.
- "Cross-hour only", as built: a blend needs the same model and a different valid time or grid; base and fine overlay of
  different hours still never composite (section 1).

**The advisor's seven changes to section 3, taken as they stand. Thresholds already written are not moved.**
1. **W7 is relabelled**: a second ARITHMETIC check on a synthetic field (it can show the mix is the mix; it cannot show the
   mix is nearer the truth on real weather). Truth for wind rests on **W13** below.
2. **W7's baseline stays** "the smaller of the two end hours", and the report prints the error of h alone and of h+6 alone
   beside it, per view and pooled.
3. **W8a is fixed to the step the app blends**: the pair is (h, h+3), the scrubber's step on this fixture, not (h, h+6); and
   the ratio is taken where the moving wave dominates: nodes where the wave's own speed is at least half the node's speed
   in both hours (the fixture's wave term is known, so the mask is computed from the generator, not from the result). The
   0.85 line and the 12 h positive control are unchanged and use the same mask.
4. **Particles, two more lines.** **W8c**: W1's step measure with the particles DRAWN (colour field and particles together):
   arm B's mean step not larger than arm A's, and no view worse by more than 10%. **W8d**: during a blend (the 160 ms after
   each step, arm B), the count of particles dropped or respawned per frame and the mean particle speed stay within the range
   spanned by the same two quantities at rest in the two end hours, widened by 10% of that range (or of the larger value when
   the range is under 1%); 80 steps; a step outside is listed, more than 4 outside fails.
5. **W14, the HRRR lane** (the fine overlay, on by default over CONUS). Two views inside CONUS added for this line only:
   (-98, 39, z4.5) and (-122, 37, z5.5). Per drawn frame the instrument logs the base mix weight and the overlay's valid
   time. Assert: **no frame draws an overlay whose valid time differs from the base's while the mix weight is above 0**, and
   no frame draws an overlay of hour X over a base that is not wholly hour X. W5 (self-mix) is run in these two views too. If
   the offline backend cannot serve an HRRR overlay the line is VOID, said so, and stays owed.
6. **W15, device limits.** At init the engine reads MAX_COMBINED_TEXTURE_IMAGE_UNITS and MAX_VERTEX_TEXTURE_IMAGE_UNITS. Below
   what the blend needs (unit 7 in use: 8 combined; the particle-draw vertex shader samples 4 textures: 4 vertex units), or
   when the blended shaders fail to compile or link, the engine uses the OLD shaders (the kill path), does not blend, and
   counts it in the telemetry (`fallbacks`, with the reason). Unit tests for both branches. This is a code line, not a
   measured one.
7. **Clean-truth check, for every real picture or field the gate reads at 600 ms**: the same hour is read again at 4 s; a
   reading whose two samples differ by more than 0.5 luminance units (pictures) or 0.1 kn mean (fields) is dropped and
   listed; more than 10% dropped voids the line that used them.
- **W13, truth on real frames (the owner's test, for wind).** Real GFS wind frames from the public CDN, fetched ONCE, slowly,
  outside the app, into a local folder and replayed by the offline backend; nothing is asked of the live backend. For hours
  h, h+3, h+6 of one run, at least 8 triples over at least 2 runs: ERROR(blend) = mean vector difference in knots between
  the half-way u/v mix of h and h+6 and the real h+3; ERROR(cut) = the smaller of the same for h alone and h+6 alone (both
  printed). Pass: pooled ERROR(blend) at most **100%** of ERROR(cut) (the owner's line: not worse than the hard swap) and in
  at least 80% of triples; ghosting no worse: W8a's retention on these frames reported, with the count of nodes where the mix
  loses more than half the mean of the two speeds. A hard cut loses none, so no pass line is set for that count: it is
  reported and judged by the owner's blinded look, not by a line invented after seeing it. Negative control: the
  middle frame replaced by one from another day must FAIL the pass line, or W13 is void. Positive control: h+6 replaced by a
  copy of h gives ERROR(blend) = ERROR(cut) = the h-to-(h+3) difference exactly and a self-mix difference of zero.
  To be run only in the quiet window the director names.
- **W2 is a desktop GPU figure.** A real phone is unmeasured and is listed as not covered.
- The PR's first line will say whether merging turns the blend on (it does not).

## 6. Built after section 5 (17:51 EST). Code and unit tests only; still no gate number.
- **Opt-in.** `windHourBlendEnabled` (`windHourBlendGLSL.js`): `window.__RAW_ENABLE_HOUR_BLEND__ === true` and the kill not
  set. Unset, `withWindHourBlend` returns each shader as it came (the same string) and `windBlendMs()` is 0.
- **W15 built.** `windBlendDeviceVerdict(gl)` reads the two limits; `startWindPrograms` (`WebGLWindEngineInit.js`) compiles the
  blended set only when it was loaded and the device passes, falls back to the plain set once on a refused compile or link
  (at once, or later on the async path in `pollPrograms`, which then reports "pending", not "failed"), sets
  `engine._windBlendShaders`, and counts every fallback with its reason (`__RAW_WIND_HOUR_BLEND__.fallbacks`,
  `.fallbackWhy`). With the plain set compiled nothing is kept and the uniform setter makes no GL call.
- **W11 and W15 unit tests:** `windHourBlend.test.js`, 43 tests, pass. The kill is listed in `killSwitch.inventory.test.js`
  and classified in `windDarkRules.test.js`. Those two and `WebGLWindShaders.test.js` pass with it (4 suites, 145 tests).
  Lint ratchet pass, file size 0 violations. Floor fragment: frontend +43 tests, +1 suite. The WHOLE map and tests trees have
  not been run on this commit (a heavy job; owed before the PR, in the quiet window or at the director's word).
- **A consequence for the gate, stated before measuring:** the lab pages load WITH the opt-in, so both arms run the blended
  shader text and arm A is the kill set at run time (mix 0). W2 therefore compares blend against kill on the same shaders; it
  does not measure the cost of the added text against the plain shaders. Added now as **W2b**: one further arm-A scrub in a
  page loaded WITHOUT the opt-in (the plain shaders, what every user gets by default), reported beside W2; the at-rest GPU
  time of the blended text with mix 0 must be within **5%** of the plain shaders'.

## 7. W13's controls restated BEFORE any frame is fetched or scored (18:30 EST). No number exists.
Writing the marine real-frame test (the marine log, section 34) showed a fault in W13's negative control as section 5 worded
it ("the middle frame replaced by one from another day must FAIL the pass line"). It could not fail that way: the average of
two fields is usually CLOSER to an unrelated field than either one is, so against a wrong truth the blend-to-cut ratio would
still read under 100%. The control is replaced, before data, by the two the marine test registers, and the same instrument
(`real_frames_hidden_hour.mjs`, set `wind`; now on this branch, not run) scores it:
- **N1, a wrong truth:** scored against the frame 48 h later in place of the real h+3, ERROR(blend) must be at least **2 x**
  its value against the real h+3 in at least 90% of triples. If not, W13 cannot tell a right middle from a wrong one: VOID.
- **N2, a wrong blend:** the mix built from h and h+54 in place of h+6 must FAIL W13's pooled line against the real h+3
  (above 100% of the cut). If it passes, W13 is VOID.
- **P** is unchanged in meaning and made exact: with both neighbours and the middle the same frame, every error is exactly 0.
- W13's pass line, triples and runs are as section 5 wrote them, with one thing made definite: triples are h = 0, 6, ... 114
  of each run (20 a run), at least 2 runs, and the result is NOT reported until two runs are in.
- Units: the instrument reports the wind frames' own speed unit and says so; if that is not knots the 0.1 kn figure of the
  clean-truth check (section 5, item 7) is converted, not re-chosen.
- The owner's wording of the negative control ("a corrupted middle frame must fail") is ambiguous between N1 and N2; both are
  run and the reading is put to the director.

## 8. W13: first fetch, the controls only; the truth line NOT read (18:55 EST)
At the director's word (18:40 EST: the Node-only test may run now; every browser job is held until 00:30 EST).
- **Fetch** 18:40-18:47 EST: 581 requests to the public frame CDN at one per 600 ms, 31.1 MB, static files only. Five sets (the
  four marine layers and `wind`), 57 frames each (3-hourly to f168) from each of the two indexes the CDN lists.
- **Found before scoring:** the two indexes are two PUBLISHES of the same model run (GFS 2026-11-15 12Z; index `run_time`
  18:33Z and 21:14Z for wind), not two runs. So ONE run is in hand. As registered, the result is not reportable until two runs
  are in; I go further and do not read it: the scorer has a `--controls-only` mode that withholds the truth lines, and that is
  all that was run. The scorer now counts one model run once (the current index; the second publish is listed as skipped).
  Without that fix the same 20 triples would have been counted twice.
- **Controls, wind, 20 triples, one run:** N1 (a wrong truth) holds in 20 of 20; N2 (a wrong blend) fails the pass line, as
  it must; P (identical neighbours) is exactly zero. So the instrument can fail and can read zero on this data.
- **Owed:** a second fetch after the next GFS run is published, then the truth line for both runs together.

## 9. W13 RESULT: wind on real frames, two runs (21:22 EST). Read once, as it came out.
Second fetch 21:14-21:18 EST: GFS 2026-11-15 18Z. With 12Z: two runs, 20 triples each, 40 triples, set `GFS/wind/wind/global_mid`
(181 x 83, knots). Scorer at `68719d80b` (the same file on this branch). A third arm, advection, was registered for this test
before any truth line was read: the marine log, section 37, which covers wind (the field carried along its own vector).
- **W13 PASSES.** Mean vector error against the real h+3: the half-way u/v mix of h and h+6 **1.913 kn**; the hard swap
  3.059 kn (h alone 3.080, h+6 alone 3.075). The mix is **62.5%** of the swap, and not worse in 40 of 40 triples (line: at
  most 100%, in at least 80%).
- **Controls held:** N1 (a wrong truth) 40 of 40; N2 (a wrong blend) fails the line as it must (5.950 kn against 3.080);
  P exactly zero.
- **Smear, reported without a line as registered:** speed kept through the (h, h+6) mix 0.971 of the mean of the two hours';
  nodes where the mix loses more than half that speed: 11,378 of 600,920 (1.9%). A hard swap loses none. Whether that shows is
  for the owner's blinded look. Note this is the 6-hour pair; the app blends 3-hour neighbours, where less is lost (W8a, on
  the synthetic field, is still to be run).
- **Ghost nodes (more than 3 kn off the real middle):** the mix 93,583, the hard swap 205,081, of 600,920.
- **ADVECTION IS WORSE THAN THE MIX:** 2.177 kn, 113.8% of the mix's error, smaller than it in 0 of 40 triples; 119,703 ghost
  nodes. It beats the hard swap (71.2%). Its controls held. As written beforehand, a wind system has no physical reason to
  travel along its own 10 m wind. Exploratory, not registered, to rule out a sign error of mine: reversed 137.2%, half speed
  102.6%, quarter speed 99.5%: the error is smallest with no motion.
- **Limits:** value space on the world grid only; the shaders drawing this mix is W5/W6, NOT yet measured for wind (no wind
  gate line has run in a browser); two runs 6 hours apart on one day are not independent samples; nothing here covers the
  particles, the HRRR lane, regional grids or a phone. The blend stays off.

## 10. THE SCRUB LINES, first gate run (2026-11-16, 21:50-22:06 EST): W1, W2, W3, W8b, W9 pass; **W4 FAILS**
The director's hold on browser jobs ended 00:30 EST on the 16th; run that evening, the director told beforehand.
**Build:** local, this branch merged with the marine branch (`a641e2db3`, never pushed); the wind code is this branch's at
`2b99e8793`. Loaded with the opt-in; arm A is the kill at run time. Offline backend, `--moving-wind 8`. Instrument
`scn_wind_blend.js` as committed in `a8d8c8f85` plus the opt-in line. Dark, desktop, ten views, 80 boundaries an arm,
every hour settled first (median 1.6 s). 0 page errors. Nothing asked of the live backend (host audit ok).
- **W1 PASS.** Pooled step 6.709 (hard swap) to 1.712 (blend): **25.5%** (line 50%). Per view 20-38%; no view worse; no view
  left out. Blended 79 of 80 steps in arm B. Smoothness only.
- **W2 PASS.** GPU ms per frame, median over views: 3.746 to 3.895 over the scrub (**+4.0%**), 3.814 to 3.963 inside the blend
  windows (**+3.9%**); line +10%. A desktop GPU; a phone is unmeasured. This compares blend against kill on the SAME shader
  text; W2b (the plain shaders) is separate and not yet run.
- **W3 PASS.** 72 of 72 (grid, valid time) pairs: identical bytes and u/v range in both arms.
- **W4 FAIL: 74 of 80.** All six failures are one view, (150, -34, z5), arm B, steps 0 and 3-7: 420 ms after the step a
  blend is still running (mix 0.00002 to 0.91) and a texture is kept. What happens there: the step first brings the new
  hour's world grid (blend one); a few hundred ms later a REGIONAL grid of the same hour (27 x 22) replaces the base, which is
  a grid swap, and the design blends a grid swap (blend two). So on that view the picture is in transition for longer than
  one 160 ms blend and is not at rest at 420 ms. The other nine views, and steps 1-2 of this one, are at rest. Recorded as a
  FAIL of the line as written. Not yet measured: that the second blend ends and frees its texture (it is counted:
  starts 338, ends 277, restarts 61, errors 0 over the run, which balances: 277 + 61 = 338).
- **W8b PASS.** Particle vertices per frame constant in every view and arm (147,456 and 294,912); the particle picture's mean
  luminance in the 200 ms after a step, B / A: 0.955 to 1.004 (line: not below 0.95; the lowest, 0.955, is view 6).
- **W9 PASS.** One step per 100 ms: 6.694 to 2.734 (40.8% of the hard swap).
- **A second finding in the same read-back, not a gate line:** inside ONE frame the three programs got slightly different mix
  weights (for example 0.1749 colour field, 0.1735 advection, 0.1720 particle draw), because each pass asks the clock again.
  The particles are advected through a field a hair different from the one coloured. Small (under 0.003), but wrong by
  design: one frame should have one weight.
**Registered now, before any further line is run:**
1. **The fix for the second finding:** the weight is computed once per frame (a call within 8 ms of the last reuses it). Unit
   test. Because the code changes, the scrub lines above are RE-RUN on the fixed build and both runs are kept; the lines and
   thresholds do not change. A new standing check **W4b**: at 420 ms the three programs' weights are EQUAL in every step
   (including steps where a blend is still running).
2. **W4 is not redefined.** It stays as written and is re-measured. Added beside it, **W4c**: 1,500 ms after each step, no
   blend, no kept texture, weight 0 in all three programs, 80 of 80 (this is the leak check W4 was meant to be; a view
   whose second blend starts later than 420 ms cannot pass W4 as written, and that is said, not hidden).
3. **Instrument for the advisor's lines, built, not run:** `MODE=more` (W8c the step with particles drawn; W8d particles
   respawned per frame and the mean particle step, read from the particle state texture; W14's log of the base's and the
   overlay's valid time beside the weight) and `MODE=plain` (W2b). **W14 for the HRRR lane is VOID as registered:** the
   offline backend serves an HRRR lane only from a real lane file, which this harness does not have. The same assertion
   (no frame mixes while holding an overlay of another hour than the base) is run on the synthetic fine overlay instead and
   reported as a lesser check; the HRRR line stays owed.

## 11. GATE RUN 2 on the fixed build, and the new lines (2026-11-16, 22:18-23:10 EST). Recorded as it came out.
**Build:** local merge `7339d1d3f` (this branch at `856fb9d5f`, with the one-weight-per-frame fix, plus the marine branch),
never pushed. Same harness and settings as section 10. Four runs in one chain: the scrub lines again; `MODE=more`;
`MODE=plain`; the truth instrument. 0 page errors in all four; nothing asked of the live backend.

**Scrub lines, run 2 (run 1 is section 10; both are kept):**
- W1 PASS 6.847 to 1.663, **24.3%** (run 1: 25.5%); 80 of 80 blended. W2 PASS **-1.1%** over the scrub, **+4.5%** in blend
  windows (run 1: +4.0%, +3.9%). W3 PASS 80 of 80. W8b PASS (0.993 to 1.025). W9 PASS 38.9% (run 1: 40.8%).
- **W4: 80 of 80 this run; 74 of 80 in run 1.** The line is timing-dependent on views where a regional grid of the same hour
  arrives after the world grid (section 10); in this run no step was still blending at 420 ms. Standing: FAILED once, passed
  once; not claimed as passed.
- **W4c PASS:** 1,500 ms after every step no blend, no kept texture, weight 0 in all three programs: 80 of 80 in both arms.
- **W4b has NO SIGNAL in this run:** the three weights are equal in 80 of 80, but all are 0, because no blend was running at
  420 ms. The fix is covered by its unit test only; the gate has not yet seen it during a running blend. Owed: a read-back
  inside the blend window.

**The advisor's lines:**
- **W8c PASS.** The step with the colour field AND the particles drawn, 12 views (the ten plus two in CONUS): pooled 4.292
  (hard swap) to 1.374 (blend), 32.0%; no view worse.
- **W8d FAILS as registered.** Particles respawned per frame and the mean particle step, in the 160 ms after each step, against
  the range of the same at rest in the two end hours (widened 10%), arm B, 96 steps: outside in **55** (respawned) and **53**
  (step) of 96; the line allows 4. Context, measured in the same run and not a rescue of the line: the HARD SWAP arm shows the
  same excursion, larger (the window against the mean of the two rests: respawned 1.078 in arm A, 1.039 in arm B; step 1.084
  in arm A, 1.049 in arm B). So the 160 ms after a step differs from rest with or without the blend, and the blend's is the
  smaller. The line compared the blend with rest and never with the hard swap, and the range of two rest means is narrower
  than the frame-to-frame noise (a rest window is 11-13 frames). It cannot pass as written; it stays FAILED, and a line that
  compares the two arms is owed as a new registration.
- **W14: VOID for the HRRR lane** (section 10, item 3). Lesser check on the synthetic fine overlay: of 710 frames that mixed,
  0 held an overlay of another hour than the base; but only 33 frames in the whole run held a fine overlay at all, so this is
  weak evidence. The HRRR line stays owed.
- **W2b does NOT meet its line as written, in the harmless direction.** GPU ms per frame, median over ten views: the plain
  shaders (a page loaded without the opt-in; confirmed plain in all ten) 4.105; the blended text with the kill 3.662. That is
  10.8% LOWER, outside "within 5%". There is no sign that the added text costs anything at rest, but two separate page loads
  differ per view by far more than 5% (2.3 to 4.9 ms across views), so this instrument cannot resolve the line. Not passed.

**Truth lines (the report script printed "every line scored here passes"; that summary is wrong for W7 and W8a, see below):**
- **W5 PASS.** 20 cases, 181 x 83: an exact copy as the earlier field, drawn alone and mixed half and half: difference
  0.0000 from the picture at rest; moved one cell: 5.99 to 7.05; the rest picture read again: 0.0000. World grid only: no
  regional case was scored, so "world and regional grids" in the line is NOT met.
- **W6 PASS.** 31 held pictures in the value view: outside the rounding bracket at most 1.0% (line 1%), mean 0.1%; without the
  allowance at most 1.6%. Bytes the shader mixed against the stored hours: 36 of 36 identical.
- **W7 does NOT pass as registered.** Value space: mix 2.477 kn against nearest hour 6.290 kn, **39.4%** (line 60%, expected
  about 40%), 31 of 40 triples. But (i) the value-space figure is the WORLD grid's, the same field in every view, so the "31
  triples" are about four independent ones seen ten times; and (ii) **PICTURE space contradicts it**: mix 5.736 against
  nearest hour 6.536 luminance units, **87.8%**, and section 3 says the picture result "must not contradict". Per triple the
  picture ratios are two-humped: about 0.37 (as the values say) or about 1.0 and above (for example 2.97 / 8.14 beside
  8.23 / 8.16 in one view), while the same triples' value-view bracket is exact and the bytes mixed are right. So in about
  half the triples the COLOUR picture taken as "held at 0.5" was not a half-way mix when it was read. Cause NOT established.
  Candidates, none verified: the hold is cancelled before the picture is read (a re-commit of the same hour on the same
  grid ends a blend: `same_hour` in `keepOutgoingWindBase` sets the blend to null); the colour picture and the value picture
  are read at different moments; the colour of a vector mix (speed) differs from the mix of colours more than assumed. If the
  first is true it is also a defect in the app: a same-hour re-commit during a running 160 ms blend would cut it short.
  Diagnosis owed before W7 is run again.
- **W8a was NOT run as amended.** Section 5, item 3 fixed the pair to (h, h+3) with a mask where the wave dominates; the
  instrument still scores (h, h+6) over all nodes. For that old definition: 0.880 (line 0.85); the 12 h control 0.168 (must be
  below 0.85: it can fail); the moving part alone 0.594. Recorded as the OLD line's result; the amended W8a is owed.
- The clean-truth check (section 5, item 7) is not implemented beyond "the truth picture read twice: 0.000".

**Where the wind gate stands.** Passed: W1, W2, W3, W4c, W5 (world only), W6, W8b, W8c, W9, W13 (real frames, value space).
Failed or not met: W4 (once of twice), W8d, W2b (unresolvable), W7 (picture contradicts value). Void: W14 (HRRR). No signal:
W4b. Not run: W8a as amended, W12 (light, beach, phone), W11's whole-tree run. The blend stays off; no PR is opened as
anything but a draft with these lines in it.
