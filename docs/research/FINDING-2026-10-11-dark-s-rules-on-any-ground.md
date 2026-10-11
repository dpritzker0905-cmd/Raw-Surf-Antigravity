# FINDING 2026-10-11: dark's rules on any ground

Owner, 2026-10-11: "we need the light mode and beach mode's wind animations to follow the same rules as dark mode. Learn from all
our past mistakes and find more best practices and tools." Earlier words this answers (2026-10-10, log
`2026-10-10-dark-style-light-beach.md`): "I like the way dark theme does the animations of the wind, the color, everything ...
light theme and beach theme's to reflect similarly of this style, but with their own color schemes", and "we need to replicate
our science from dark mode".

The instrument for this note is **Ground Truth**, a p5.js + WebGL lab that draws one wind field three times (dark, beach and
light grounds). It uses the engine's own particle law, mark casing, 8-bit trail fade, colour tables and composites, and it
measures every frame the way the wind bench reads a crop. It is published as a private artifact (link in the session log) and is
a model, not the engine. Its limits are listed at the end. Nothing in the app changed. No default moved.

## 1. Dark's rules, decoded (what dark actually does)

Sources: `WebGLWindShaders.js`, `WebGLWindEngine.js`, `WebGLWindUtils.js`, `WindColorRamp.js`, `windInk.js`, `windBasemapMute.js`.

Motion, density, mark size, life, trail fade and the mark casing are **already the same in all three themes**. Only four things
differ, and they are all colour:

| | dark | light today | beach today |
|---|---|---|---|
| Ground | night map, unmuted | muted (OKLab C × 0.15; water L × 0.9) | muted (water L × 0.94) |
| Field (the veil under the streaks) | the **particle table itself**, alpha-over: `F·α² + dst·(1−α)`, α = 0.48·(0.44 + 0.56·ss(0,5,kn)) | its own field table, multiply tint `dst·(1 − s(1−F))`, s 0.29→0.70 | its own field table, multiply tint, s 0.27→0.60 |
| Streak composite | brightness alpha: `c·b·op + dst·(1 − b·op)`, b = max(c), op 0.505 | premultiplied: `c·op + dst·(1 − a·op)`, op 1.0 | premultiplied, op 0.6 |
| Streak table | neon, max channel ≈ 1 in every row | dark inks, max channel 0.62-1.0 | mid tones |

So dark's science, in one sentence: **the ground under a streak is the streak's own colour at low light, and the streak is that
colour at full light.** One table feeds both the veil and the streak. The composite only adds light: a black rim adds nothing,
because its brightness b is 0. Light and beach break this in three places: a different table for the ground than for the streak,
a premultiplied composite that shows the black rim, and a near-white ground.

## 2. The rule, restated so it holds on any ground

Each clause comes from a measurement in the lab (seed 1963, zoom 5, 21,952 marks, the engine's dose of 490 per 100 × 100 px).

1. **Light only adds, in the ground-independent form.** Dark's formula only behaves as "light only adds" because its ground is
   near black. It removes `b·op` of the ground but adds colour in proportion to `b²`. On a lighter ground a fading tail darkens
   the paper: on light's land the lab read −5 L* with only 38% of streak pixels lighter. The form that holds on every ground moves
   toward the colour at full light by b²: `out = Ŝ·b²·op + dst·(1 − b²·op)`, Ŝ = S/max(S). That is #311's "dark's streak method"
   (windInk mode 2). With it, light and beach read 98-100% lighter, against dark's own 70-72% in the lab.
2. **Room: dim the ground by one factor, as dusk does.** Lighter-than-ground needs a ground with room above it. Dim every band's
   ground by one factor in linear light (chromaticity kept) until the everyday-wind ground (6-27 kn, over land) sits at the
   ceiling. **Do not push each band to the ceiling.** That equalises lightness, the one channel colour-blind viewers keep. Per-band
   room took light's colour-blind floor to 0.4; one factor kept 4.6 (today 4.84).
3. **Names: a dimmed orange is brown and a dimmed yellow is olive.** Brown and olive are related colours: they exist only below a
   brighter surround. On a night map a dim yellow reads as yellow light; on a pale page the same chromaticity reads as olive.
   This is the same physics as B ink's flat olive sea. Hold orange-to-yellow grounds (OKLCH h 35°-126°) at or above L* 76, and let
   every other hue take dusk's factor: a dim blue is still navy and a dim red still maroon. With the guard ending just past
   yellow, light's floor rose to 4.60 and beach's to 3.65 (today 3.46). A guard reaching 135° cost beach 3.65 → 2.65, and a guard
   at L* 68 collapsed light to 0.42 (27 and 33 kn met).
4. **The relation is to the ground under the mark, so solve land and sea separately.** Dark's land and sea are both near black, so
   one streak colour per speed serves both. Light's and beach's sea is far darker than their land after the tint, so one colour
   stepped +24 L* over light's sea and washed it (end L* 75.1). Solved per ground, against dark's step over dark's own land and
   own sea, the sea read +17.3, end 68.1, no wash.
5. **Colour floor: no streak buys lightness with its hue.** A lilac or periwinkle cannot be both light and vivid (the gamut's cusp
   for violet and blue sits low). Walking a streak down until it keeps C* ≥ 25 leaves light's 3-10 kn a few L* short of dark's
   step. That is the honest cost. #311's A hit the same wall.

Lab result at the defaults (ceiling L* 58, guard L* 76, colour floor 25, ring 0.25):

| ground | step (median ΔL*) | lighter | end L* | colour-blind floor (today) |
|---|---|---|---|---|
| dark land / sea (reference) | +5.5 / +6.0 | 72% / 70% | 21.7 / 27.9 | 2.49 / 1.24 |
| beach land / sea | +7.8 / +14.8 | 99% / 100% | 64.0 / 54.2 | 3.65 (3.46) / 3.63 (3.45) |
| light land / sea | +8.0 / +17.3 | 98% / 100% | 68.5 / 68.1 | 4.60 (4.84) / 3.50 (4.83) |
| today, beach land / sea | +4.3 / +5.8 | 89% / 86% | 78.6 **washes** / 58.5 | |
| today, light land / sea | +3.0 / +12.0 | 69% / 100% | 85.9 / 68.9 | |

The colour-blind floor here uses Machado 2009 on the grounds, so compare across rows. The project's bar of 5 belongs to the
checker's own method (Viénot/Brettel via coloraide). Light's sea floor falls from 4.83 to 3.50: that is the price of the sea's
dusk, and it is open.

## 3. Past mistakes and the rule each one left

From LESSONS, DECISIONS, STATE and the logs of 2026-07 to 2026-10. The full inventory with file:line references is in the
session log.

| Mistake | Rule |
|---|---|
| v2 changed density, life, fade, stretch, speed, composite and colour at once, default on (#273) | One variable per lever; default off; the owner's yes after an A/B (L-V1, L-V3) |
| Leftover levers in the owner's browser were judged as "the wind" | Reset every lever after an A/B and say so (L-V4) |
| A flat 490 marks at every zoom inked 99.8% of the screen at z7.5, and the tests encoded it | Calibrate the ink the eye sees, per zoom (L-V6) |
| A hard per-pixel threshold drew diamonds at 43-44 kn | No hard thresholds on an interpolated grid; scanner across zooms (L-V8) |
| Thin marks chosen from theory: 10 recurring shapes against 4 | Any trail-shaping lever passes the 3-seed scanner (L-V16) |
| Gates scored at the stops, on grey: 15 kt blended into the water | Check the ramp between stops, over every real ground (L-V9, L-V27) |
| A gold tint multiplied into cyan water came out green | Measure hue bent by the ground (hue30); mute the basemap (L-V18) |
| The mute never ran in the app (`layers: 0`) | Instruments carry the app's layer stack; read back the effect (L-V21) |
| The 10 → 16 kn sRGB line ran through grey (C* 1.0 at 13 kn) | Read a ramp along its path; hue path in OKLCH (L-V27) |
| Glow became light's default from stills and washed out live | A still-crop pick is a hypothesis; a wash number before the next design (L-V28) |
| The first wash bar ranked the reference worst | Test a bar on its anchors (L-V29) |
| Ink's sea turned flat olive; its lilac laid a quarter of the ink of its warm bands | Dim yellow is olive (clause 3); even mark strength across bands |
| Shader bugs passed 27-30 string pins | The GPU bench is the authority, not string pins (L-V26.3) |
| "Every theme" claimed on two | Measure every one; an independent reviewer for drawn changes (L-V27.7) |

## 4. Best practices from outside the project

Some vendor hosts were unreachable from the research sandbox. Items marked [excerpt] come from search excerpts only.

- **Esri's flow renderer flips the direction of contrast by background, and adds glow (bloom) only on dark.** Its smart-mapping docs
  say stronger values get "bright colors on dark backgrounds and dark colors on light backgrounds". Its glow sample first dims the
  basemap to `brightness(0.3)` and then masks a colour raster through the streaks. Glow presumes a darkened ground; that is clause
  2. https://developers.arcgis.com/javascript/latest/references/core/smartMapping/raster/renderers/flow/ ·
  https://developers.arcgis.com/javascript/latest/sample-code/layers-imagery-afrenderer-blending/
- **earth.nullschool keeps speed out of the streak hue.** It uses grey streaks by speed, hue in an overlay at 40%, and fades trails
  by alpha (`destination-in` 0.97), not toward the ground. https://github.com/cambecc/earth (MIT)
- **webgl-wind's fade buffer at 0.996 never reaches zero in 8 bits.** Subtract at least one level per frame; the engine's floor
  does this. https://github.com/mapbox/webgl-wind
- **APCA's contrast budget per ground.** On L* 93 land, the best any lighter streak can reach is |Lc| ≈ 11, below APCA's
  "invisible" 15. Lighter-than-ground is impossible there without dimming the ground. APCA is calibrated for text, and dark
  itself reads low in the lab, so treat it as a second opinion, not a bar.
  https://github.com/Myndex/SAPC-APCA (reference code licence is restrictive; use Color.js's implementation)
- **Each hue reaches its most vivid colour at its own lightness (OKLab L):** yellow 0.96, cyan 0.90, green 0.87, orange 0.73,
  magenta 0.70, red 0.63, violet 0.56, blue 0.45. Lightened to L* 95, blue, violet, red and magenta keep about 0.02 chroma, which
  is white. This is why pale lilac streaks read as fog, and why clause 5 exists.
- **Moving light targets are detected faster than moving dark ones**, most at low speeds (Luo-Li et al. 2018,
  https://pubmed.ncbi.nlm.nih.gov/30271942/). This is a perceptual reason to keep dark's lighter-than-ground direction on every
  theme, not only a taste.
- **Thin lines carry contrast in lightness, not hue.** Isoluminant moving stripes appear to drift slower (Cavanagh et al. 1984)
  [excerpt]. Bands that differ only in hue at equal lightness are the weakest; keep a lightness step between neighbours.
- **Animated streamlets separate perceptual layers** (Ware, Kelley & Pilar 2014,
  https://ccom.unh.edu/publications/improving-display-wind-patterns-and-ocean-currents). Wind can sit over other fields if its
  streaks keep their own contrast.
- **Simulate colour blindness on the composited pixels, in linear RGB.** Machado 2009 suits protan and deutan; prefer Brettel for
  tritan (DaltonLens auto-selection). culori applies Machado to gamma-encoded RGB, so convert to linear first.
- **Sequential, monotone lightness, no grey midpoint** for a magnitude like speed (Kovesi 2015; Thyng et al. 2016 cmocean
  `speed`; Crameri et al. 2020).
- **Test animations deterministically:** Playwright's `page.clock`; SwiftShader with
  `--use-gl=angle --use-angle=swiftshader-webgl`, asserting the canvas is not blank; statistics per theme and band, not exact
  frames.

## 5. Tools (ranked for this team)

1. **culori** (JS, MIT): OKLCH, CIEDE2000, Machado filters (convert to linear RGB first). https://github.com/Evercoder/culori
2. **Color.js** (JS, MIT): CSS Color 4 gamut mapping, CAM16 and HCT, APCA and WCAG contrast. https://github.com/color-js/color.js
3. **ColorAide** (Python, MIT): reference colour-blind simulation; already behind `cvd_check.py`. https://github.com/facelessuser/coloraide
4. **DaltonLens-Python** (MIT): simulates whole frames and picks the right model per deficiency. https://github.com/DaltonLens/DaltonLens-Python
5. **Playwright** clock and screenshots: already the bench's driver. https://playwright.dev
6. **pixelmatch** (ISC; OKLab HyAB distance): fast perceptual frame gate. https://github.com/mapbox/pixelmatch
7. **ꟻLIP** (BSD-3): per-pixel "how different does this look" maps for A/B review. https://github.com/NVlabs/flip
8. **cmocean / Crameri / colorcet**: reference ramps to compare against.

## 6. What the lab is not

- **The grounds are flat colours:** the bench's offline basemap for light and beach (muted as the app does) and the app's own
  night-map fallback for dark. There are no roads, labels or terrain. Dark reads lower here (+5.5 to +6.0 at the median) than on
  the real map (+9.5 to +14.5).
- **Zoom 5 only.** The close-zoom terms (`WIND_CLOSE_LAND`, the z > 6 dose and speed keep) are idle.
- **The casing's rim is drawn in its own pass**, so a new mark's black rim does not erase older trail under it as the engine's
  premultiplied blend does. This affects only "as drawn today".
- **The engine has no land mask.** Clause 4 needs one (a coarse land texture), or a blend whose lightness step does not grow on
  a darker ground. Neither exists yet.
- **Nobody has seen any of this in the app**, and the owner has not seen the lab.

## 7. What would carry it into the app (not done; behind a lever, default off, A/B first)

- Light: #311's A deep already has clauses 1, 2 (roughly) and 5. **It lacks 3, and it shows.** Computed over the muted land
  with this lab's colour model:
  - 33 kn: rgb(144, 127, 71), L* 53.5, OKLCH h 93°, which is olive.
  - 40 kn: rgb(136, 106, 71), L* 46.8, h 70°, which is brown.
  - 27 kn: rgb(128, 153, 99), L* 60.2, h 129°, which is moss.

  #311's gates never asked what a colour is called on a pale page, so none caught it. Under the guard the same bands sit at
  L* 75, 68 and 63 (33 kn is still a pale khaki: the multiply tint cannot hold it higher). A deep also lacks clause 4: it has one
  streak table for land and sea.
- Beach: dark's streak method today stops at 74-82% of dark's step. Its own dusk field (clause 2) plus the guard (clause 3) is the
  missing half.
- The solver in the lab (`solveTheme`) produces both tables per theme in milliseconds. A port is a table, not a rewrite.
