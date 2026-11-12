# 2026-11-11 · haiku-marine-motion-evidence · evidence base for the opposing-animation question

Owner question (relayed by the "Weather simulation system audit" session, 2026-11-11): "I'm seeing opposing wave
animations in all the marine layers, unless that is part of the animation's design?"

Scope split: the director's session traces the shader math (`WebGLMarineEngine.js`, `WebGLMarineShaders.js`) and the
offline direction test. This log is the evidence the fix is judged against. It does not trace code. No live backend
call, no code or flag change, no secrets. Nothing committed. Times UTC-agnostic (no timestamps needed here).

Method note: sources were read through search snippets and abstracts, not full papers, except where marked. Consensus
returned abstracts; WebSearch returned snippets of Copernicus/Mercator PDFs and LibreTexts pages (not opened in full).
Anything I could not check is marked **unverified**.

---

## 1. Direction conventions of the served sources

| Source served | Direction variable | Convention (as documented) | Evidence |
|---|---|---|---|
| Copernicus MFWAM / NWS reanalysis (WW3 v4.18) | `VMDR` (total mean), `VMDR_WW` (wind sea), `VMDR_SW1`, `VMDR_SW2` (swell partitions) | Mean wave direction **from**; CF standard name `sea_surface_wave_from_direction`; 0° north, 90° east, anticlockwise-in-math / clockwise-on-compass ("anti-trigonometric evolution"); the **netCDF attributes carry a 180° offset** that netCDF-aware tools normally apply | Copernicus PUM `CMEMS-NWS-PUM-004-015` and Mercator `CMEMS-GLO-PUM-001-032` (WebSearch snippets, not opened in full); Copernicus global wave product variable list (snippet) |
| WAVEWATCH III (general) | Mdir | Meteorological convention: direction the waves come **from** (ESSD 2022 SeaVision validation paper states this for its WW3 comparison) | ESSD 14, 3615 (2022) snippet, https://essd.copernicus.org/articles/14/3615/2022/ |
| ECMWF wave fields (EURO / IFS and AIFS waves) | mean wave direction, partition directions | Direction **from** (ECMWF wave parameter convention: "mean direction from which waves are coming"). **Unverified this session**: I did not open the ECMWF parameter table. Check the GRIB parameter description before relying on it. | not retrieved |
| ICON-wave (DWD gwam/ICON-EU wave) | wave direction | Expected "from" by the same meteorological convention. **Unverified**: no source read. | not retrieved |
| Wind (for comparison) | U10, V10 or wind direction | Wind direction is conventionally "from"; vector components point **to** | general meteorology; not retrieved in this session |

**Key consequence.** A wave direction in these products is where the waves come **from**. The direction the crests travel
is therefore `to = from + 180°` (mod 360). A renderer that uses the `from` value directly as the travel direction
draws every partition **180° backwards**. If a second, correct step later flips it, the error cancels in one layer and
appears in another. This is the simplest mechanism that would produce "opposing" animations across layers, and it is
the first thing the director's offline direction test should check, per source.

**Double-flip hazard.** The Copernicus netCDF 180° attribute offset is applied by netCDF-aware software. If the decoder
(for example, a hand-written reader on the backend or the client) applies the attribute **and** the renderer also flips
`from` to `to`, the net effect is zero; if only one flips, the arrow is off by 180°. The decoder must be checked for
exactly one application of the offset. (From the Copernicus PUM snippet; decoder behaviour in this repo is not checked
here.)

**Partition variables.** Use the per-partition direction for each partition's motion, not the total direction. A total
mean direction across two crossing trains is a vector average that can point along neither train.

## 2. Phase speed, group speed, and which one a viewer should see

Deep water (depth > about half a wavelength):

- Dispersion: ω² = gk; phase speed c = ω/k = g/ω = gT/2π (Stewart, *Introduction to Physical Oceanography*, Ch. 16.1,
  LibreTexts, WebSearch snippet, not opened in full; also Exploratorium). The substitution ω = 2π/T is my step, not a
  quoted line.
- Group speed: c_g = dω/dk = c/2 in deep water (LibreTexts / Exploratorium snippets). Energy travels at c_g.
- Numbers: c ≈ 1.56·T m/s (Exploratorium), so a 12 s swell has crests moving about 18.7 m/s and energy about 9.4 m/s.
  Wavelength λ = gT²/2π ≈ 224 m at T = 12 s.

Which speed to show:

- **Crest or texture pattern** (the "moving wave" look): the eye reads crest displacement, which moves at **c**.
- **Energy or particle flow** (where energy arrives): **c_g = c/2**. A particle layer advected at c will outrun the
  energy and read as a different, faster swell.
- Both have the **same direction** for one deep-water component. A speed difference is not an opposing direction. If a
  viewer sees layers moving in opposite directions, the cause is not c versus c_g; it is a direction error, a
  partition mismatch, or a moving noise layer (sections 4 and 5).
- In intermediate and shallow water, refraction bends the direction and depth changes c; the displayed direction then
  follows the local arrival direction, not the offshore one. Out of scope for the deep-water mechanism.

**Legitimate direction differences.** Swell and wind sea can legitimately move in different directions when:

1. The partitions are separate components. A wind sea from SE and a swell from NW cross. Each partition moves in its own
   direction. This is physics, not a bug, and the map should show it as crossing seas, not as one blended field.
2. The swell is refracting over bathymetry. Near-shore direction bends toward the shore normal; a layer that was
   computed offshore and drawn near shore can differ from one drawn from local data.
3. The partitions are at different times in the same frame (interpolated frames), if the phase step is wrong (section 4).

They are **not** legitimate when two layers depict the **same partition** or the **same total**, one drawn with
`from` and one with `to`, or a texture layer moving opposite to the crests it is meant to decorate.

## 3. How state-of-the-art flow and wave viewers show motion (what the literature says)

**Dense texture advection** (the family behind most "moving field" maps):

- **Line Integral Convolution (LIC).** Cabral and Leedom (1993) convolve a noise texture along the local vector field.
  The moving look comes from animating the phase of the convolution. Forssell et al. (1995), *IEEE TVCG*: LIC extended to
  curvilinear grids, variable-speed animation (speed as magnitude), and unsteady flows; real-time on texture hardware.
  Consensus: https://consensus.app/papers/details/w:2bd439ff-f2c1-40cf-90d5-2d61b6715e34/?utm_source=claude_code
  Cabral et al. (2023 reprint) https://consensus.app/papers/details/w:870f73d5-9c20-4cb0-93bf-372153169414/?utm_source=claude_code
  **Relevance:** LIC gives one dominant direction per field because the texture is advected by one field. Two fields
  with two textures, or a texture not advected by the field, produce the counter-motion the owner sees.
- **IBFV (image-based flow visualization).** van Wijk (2002, SIGGRAPH): each frame is a blend of a warped previous frame
  and filtered noise, so the dye advects by the flow every frame and decays. Moving textures, LIC and spot noise all come
  out of this one loop. https://consensus.app/papers/details/w:732bfb87-18ee-46e7-9470-43ea48326cc7/?utm_source=claude_code
  van Wijk (2003, IBFVS): applied to a wind field on the earth. https://consensus.app/papers/details/w:7b00f619-4f45-4683-a37d-cd7c146d9e88/?utm_source=claude_code
  **Relevance:** the standard design has **one** advected field per view. A background noise layer that is not advected by
  the same field scrolls against the pattern.
- **Survey.** Laramee et al. (2004), *Computer Graphics Forum*, "State of the art in flow visualization: dense and
  texture-based techniques". https://consensus.app/papers/details/w:a6a69fc4-7bba-4c8b-b6ad-d554c5b6ad03/?utm_source=claude_code

**GPU particle advection** (the "flow particles" family, used by wind viewers): particles are advected by the same
field each frame and fade out after a lifetime. The technique is the same single-field advection; the visible failure
is particles spawned with the wrong sign or a stale field after a time-step jump. (Viewer-specific behaviour of
windy.com, earth.nullschool, Ventusky and Surfline/Magicseaweed is **unverified**: I did not open or screenshot them. The
director's team should compare against these by screenshot, not by memory.)

**Temporal aliasing and the wagon-wheel effect** (the perception problem):

- VanRullen, Reddy and Koch (2005), *PNAS*, "Attention-driven discrete sampling of motion perception": the continuous
  wagon-wheel illusion (a reversed-looking rotation) is strongest at alternation rates around **10 Hz**; it depends on
  attention; a motion-energy model with temporal subsampling at 10–20 Hz reproduces it.
  https://consensus.app/papers/details/w:ea0eef00-4b62-4a81-a48f-eb2ee5d3c997/?utm_source=claude_code
- Parks et al. (2026, arXiv): a delay-coupled neural-field model reproduces stroboscopic motion reversal from pulsed
  input, including motion opposite to the forcing direction. Preprint, one citation.
  https://consensus.app/papers/details/w:c66b2db6-1caa-4dc2-b18d-f18fe2e3f0d6/?utm_source=claude_code
- Mackin et al. (2016), ICIP: temporal aliasing impairs motion quality; it can be tolerated to a degree, with frame
  rates about 50% lower than needed to remove it perceptibly. https://consensus.app/papers/details/w:009ff2af-39f8-4f19-9d45-1e7c8dd34698/?utm_source=claude_code

**The aliasing rule for wave crests (derived, checkable).** For a component with period T displayed at frame interval
Δt, the crest pattern advances phase by Δφ = 2π·Δt/T per frame. Sampled, the pattern is ambiguous when Δφ approaches π:
the eye then picks the shorter path, which is backwards. Two equivalent statements, both to test in the shader:

- In space: displacement per frame d = c·Δt must stay under λ/4 (a quarter wavelength) so the nearest-crest match is
  forward. For T = 12 s, λ ≈ 224 m; at 60 fps with c ≈ 18.7 m/s the step is 0.31 m per frame, far below λ/4, so a
  continuous advection is safe. A **time-jump** of one forecast hour (3600 s) is not: it moves 12 s swell through 300
  periods, which is only safe if the crest phase is recomputed, not advected.
- In time: Δφ per displayed frame must stay under π/2 (ideally π/4) for the shown component. A scrub that steps whole
  forecast hours and advances the texture by the old phase will alias.

**Layer design rules from practice (partly from the literature above, partly from common design; each marked).**
- One dominant motion per field (LIC/IBFV design; literature). Secondary layers are either static or move with the
  dominant field (design practice; the IBFV architecture implies it).
- No independent scrolling noise (IBFV uses noise as a dye source that is advected, so noise follows the flow).
  **Design practice**, derived from IBFV.
- Phase versus group: crests at c, energy at c_g (physics, section 2). **Design practice** on which one to draw.

## 4. Perception: what reads as "opposing"

- The eye reads motion from the **shortest consistent match** between successive frames (the motion-energy account in
  VanRullen 2005). If the per-frame step is larger than about a quarter wavelength, the match flips, so the layer reads
  as moving the other way. That is the mechanism for "opposing" animation, and it is an aliasing failure, not a direction
  error, even when the direction is correct.
- Two layers with opposite true directions read as opposing; two layers with the same direction but different speeds read
  as one field with a shear. The owner's complaint is consistent with the first case or with a sign error.
- Attention matters (VanRullen 2005): a busy map with many moving layers makes the eye pick the layer it attends to, so a
  wrong layer is more visible when the palette is high contrast.
- **Design rules (practice; flagged as such):** one visible direction per frame; a legend or arrow that states the
  travel direction for each partition; no high-contrast periodic pattern whose frame-to-frame step sits near half a
  period; motion slow enough that the step is well under a quarter wavelength at the largest scrub step.

**Themes and devices (repo constraint, not literature).** The repo rule is light, dark and beach themes, desktop and
mobile. A direction cue that depends on colour alone fails the rule (CLAUDE.md, THREE THEMES). Direction should be carried
by the motion itself and by a text or arrow label, not hue. Colour-vision evidence: Crameri et al. (2020) and Nuñez et
al. (2017) (see the SOTA file) apply to the colour side.

Also repo constraint: ACCESSIBILITY (CLAUDE.md). Animated content should respect reduced-motion preferences. WCAG 2.2
relevant criteria, from memory: 2.2.2 Pause, Stop, Hide (moving content lasting over five seconds, level A) and 2.3.3
Animation from Interactions (level AAA). **Recalled from memory, not retrieved this session; check the W3C text.**

## 5. Hypotheses to test (not code tracing; the director's session owns the code)

| # | Hypothesis | Predicts | Test that separates it |
|---|---|---|---|
| H1 | Sign: `from` used as travel direction (or `to` as `from`) | Every layer reversed by 180°, including a correct-looking one | Offline: synthetic partition with known direction; rendered displacement vs expected `to` |
| H2 | Double flip: netCDF 180° offset applied in decode and again in render | Some sources reversed, others correct, depending on the decode path | Per source: decoded value at one point vs the raw netCDF attribute |
| H3 | Per-frame step too large (aliasing) on scrub or time-jump | Reversal only during scrub or at hour boundaries; still during slow playback at high speed | Replay frames at 1 h and 3 h steps; measure apparent direction vs step |
| H4 | Noise or texture layer not advected by the dominant field | Opposing motion in a dense texture layer, not in crests | Turn off the texture; if the opposition disappears, the texture is the cause |
| H5 | Two partitions drawn with one partition's direction | Two layers moving in lockstep in the wrong direction, or swapped | Compare each layer's direction to its partition's direction in the source |
| H6 | Phase versus group confusion | Particles faster than crests, or appearing to run ahead of crests | Speed ratio should be 2:1 (c_g : c) for deep-water swell |

H1 and H2 would make **every** layer wrong in a consistent way; H3 and H4 would make some layers wrong only in motion.
The owner's report, "in all the marine layers", points most strongly at H1 or H2, but this is a prior, not a result.

## 6. Checklist the code fix must pass

1. **One convention, applied once.** For each source (MFWAM, WW3 product, ECMWF EURO, ICON-wave), the travel direction is
   `to = from + 180°`, and the netCDF 180° attribute offset is applied exactly once on the decode path. Show the decoded
   value at one reference point for each source.
2. **Per partition.** Each swell or wind-sea layer moves in its own partition's `to` direction. The total layer uses the
   total `to`, not the average of partitions.
3. **Offline direction test passes.** A synthetic field with a known direction, rendered for at least 8 consecutive
   frames, gives an apparent direction within 10° of `to` for every layer, in each theme.
4. **Step under a quarter wavelength.** At the largest scrub step, the per-frame displacement is below λ/4 for the
   shortest period shown, or the crest phase is recomputed (not advected) on a time jump.
5. **One dominant motion per field.** A secondary layer is static or moves with the dominant field; no independent
   scrolling noise. Crossing partitions are drawn as separate, labelled motions, not blended.
6. **Phase and group are named.** Crest or texture layers use c; particle or energy layers use c_g = c/2. The code
   comment and the legend state which.
7. **No direction by colour alone.** Each layer's direction is carried by motion plus a text or arrow label, and the
   labelled direction matches the motion in light, dark and beach themes, desktop and phone.
8. **Reduced motion respected** (or the layer has a pause control), per the repo accessibility rule. Check the
   WCAG text before writing the criterion number into code.
9. **Screenshot evidence before and after**, on desktop and phone, for the same frame, with the arrow visible. Compare
   against one reference viewer (screenshot, not memory).
10. **The fix changes the served animation, not the served numbers.** If heights and ratings are untouched, say so in the
    log entry; if any served number changes, D-065 applies (default ON, kill switch, history filter, SCOREBOARD row).

## 7. What could NOT be verified

- Viewer behaviour of windy.com, earth.nullschool, Ventusky, Surfline or Magicseaweed: not opened or screenshotted.
- ECMWF and ICON-wave direction conventions: not read from their parameter tables this session (rows marked).
- The full Copernicus PUM text: read as WebSearch snippets only.
- The WAVEWATCH III manual's own convention statement: not retrieved (the ESSD paper is secondary).
- The repo's shader and decode code: not traced here (director's session).
- WCAG criterion text: from memory.
- Perception numbers (10 Hz, 20 Hz, λ/4): taken from abstracts and from the aliasing arithmetic above; the λ/4 threshold is
  a derived design target, not a measured threshold.

## 8. Sources

- Copernicus Mercator PUM, `https://documentation.marine.copernicus.eu/PUM/CMEMS-GLO-PUM-001-032.pdf` (snippet)
- Copernicus NWS wave reanalysis PUM, `https://documentation.marine.copernicus.eu/PUM/CMEMS-NWS-PUM-004-015.pdf` (snippet)
- ESSD 14, 3615 (2022), `https://essd.copernicus.org/articles/14/3615/2022/` (snippet)
- Stewart, *Introduction to Physical Oceanography*, Ch. 16.1, `https://geo.libretexts.org/Bookshelves/Oceanography/Introduction_to_Physical_Oceanography_(Stewart)/16:_Ocean_Waves/16.1:_Linear_Theory_of_Ocean_Surface_Waves` (snippet)
- Exploratorium, `http://isaac.exploratorium.edu/~pauld/activities/waves/waterwavespeed.html` (snippet)
- Cabral & Leedom (1993) LIC, via Forssell et al. (1995) and Cabral et al. (2023 reprint) — Consensus links in section 3
- van Wijk (2002) IBFV; van Wijk (2003) IBFVS; Laramee et al. (2004) — Consensus links in section 3
- VanRullen, Reddy & Koch (2005), *PNAS* — Consensus link in section 4
- Parks et al. (2026, arXiv); Mackin et al. (2016, ICIP) — Consensus links in section 4

## Checklist status

Not yet checked against code. The checklist is the input to the director's fix. This log does not claim any item passes.

---

## Addendum 2026-11-11 (second pass, same session)

Re-run after the director's "put the researcher online" message. Nothing above is rewritten; corrections and additions follow.

**Second opinion (Reflection Beam, medium effort; question and claims only, no secrets, no repo content).** It agreed with the direction convention and the aliasing heuristic, and raised these points:

1. **Deep water only.** c = gT/2π and c_g = c/2 hold only in deep water. For intermediate and shallow water, use the full dispersion relation ω² = gk·tanh(kh) and check depth per point. Correction to section 2: those formulas are deep-water limits, not general.
2. **Particles are not always energy.** Energy packets move at c_g, but surface drifters and particle layers follow Stokes drift, which can differ from both and in some conditions opposes propagation. A particle layer labelled as "wave energy" should use c_g; one labelled as "surface water motion" should use Stokes drift. Name which one in code and legend.
3. **Check the decoder offset against metadata**, not only by rule. Confirm the variable's standard name and attributes in each product before assuming the 180° offset is or is not applied.
4. **Mean versus spread.** The dominant mean direction should not oppose itself; large directional spread can still mislead. Test the mean direction per partition, not every subcomponent.
5. **Aliasing needs more inputs than the quarter-wavelength rule:** actual animation FPS, scrub deltas, spatial Nyquist, and crest phase recomputed on every time jump.
6. **Real effects that change direction:** currents, refraction, shoaling, bathymetry and land boundaries. A synthetic test checks the renderer, not the physics; say so.

**Checklist additions (items 11-14; items 1-10 stand, with item 4 read as above):**

11. **Depth-aware dispersion.** Phase and group speeds come from the full dispersion relation at each point's depth (or are labelled deep-water only).
12. **Particle layers name their velocity.** Energy (c_g) and Stokes drift are distinct, and the code and legend say which.
13. **Wrap-around and missing data.** The 0°/360° wrap, directional spread, partition count and labels, unit metadata, and missing or invalid direction values are handled and tested.
14. **Performance on a phone.** The fix holds frame rate on a mid-range phone, measured, not assumed; and the synthetic direction test is on record with its threshold (10°) and frame count (8+).

Item 3 stays as written; the decoder check in item 1 is now "verify against metadata, once".

**Status.** The checklist is still not checked against code. It is the input to the director's fix; this addendum does not claim any item passes.
