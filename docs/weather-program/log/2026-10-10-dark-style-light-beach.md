# 2026-10-10 · Dark's wind look for light and beach: measured, two candidates built (default off)

Owner (14:59Z, with the algorithmic-art skill): "I like the way dark theme does the animations of the wind, the color,
everything. We need the light theme and beach theme's to reflect similarly of this style, but with their own color
schemes that fit with their theme colors and map colors properly. Deep research to improve this further. We got this".
Written 16:37Z. No request of mine reached the live backend: every number is the offline wind bench (real engine and
basemaps on the GPU), Jest, or public research.

## What dark's look is, measured

New instrument: the **style columns** of the wind bench's map mode (`scripts/wind-bench/style.js`, README "The style
columns"). A mark pixel is one the particles changed against the field-only frame from the same camera and seed; over
those pixels, at device resolution, it reads which side of the ground they fall on, how far, and whether they keep its
colour. Mobile Bay, served strength, over land:

| zoom | theme, marks | streak vs field (L*, median) | share lighter | chroma field -> streak | signal, share of dark | map lines kept (land / water) |
|---|---|---|---|---|---|---|
| z4 | dark | +14.5 | 0.99 | 22.5 -> 24.5 | 100% | 0.60 / 0.73 |
| | light, today | +5.5 | 0.67 | 20.5 -> 16.5 | 46% | 0.71 / 0.73 |
| | light, glow | +10.0 | 0.99 | 22.5 -> 26.0 | 71% | 0.77 / 0.78 |
| | light, ink | -13.0 | 0.00 | 20.5 -> 35.5 | 96% | 0.53 / 0.58 |
| | beach, today | +2.5 | 0.63 | 50.0 -> 37.5 | 28% | 0.63 / 0.81 |
| | beach, glow | +10.5 | 1.00 | 49.5 -> 47.5 | 80% | 0.72 / 0.82 |
| | beach, ink | -15.0 | 0.00 | 49.0 -> 53.5 | 123% | 0.43 / 0.79 |
| z6 | dark | +13.0 | 0.97 | 21.5 -> 23.0 | 100% | 0.65 / 0.79 |
| | light, today | +5.0 | 0.64 | 18.5 -> 13.5 | 68% | 0.69 / 0.78 |
| | light, glow | +7.0 | 0.98 | 17.5 -> 17.5 | 60% | 0.76 / 0.82 |
| | light, ink | -11.5 | 0.00 | 18.0 -> 29.5 | 107% | 0.79 / 0.67 |
| | beach, today | +3.5 | 0.68 | 40.5 -> 34.5 | 46% | 0.74 / 0.76 |
| | beach, glow | +10.5 | 1.00 | 40.5 -> 41.5 | 92% | 0.76 / 0.81 |
| | beach, ink | -11.5 | 0.00 | 40.5 -> 47.5 | 117% | 0.75 / 0.66 |
| z8 | dark | +10.5 | 1.00 | 20.0 -> 20.5 | 100% | 0.67 / 0.82 |
| | light, today | +4.5 | 0.82 | 22.5 -> 16.0 | 51% | 0.71 / 0.76 |
| | light, glow | +5.5 | 1.00 | 16.0 -> 17.0 | 54% | 0.75 / 0.78 |
| | light, ink | -7.0 | 0.00 | 22.5 -> 28.5 | 105% | 0.75 / 0.68 |
| | beach, today | +3.5 | 0.91 | 41.0 -> 36.5 | 41% | 0.69 / 0.79 |
| | beach, glow | +7.5 | 1.00 | 40.5 -> 41.5 | 90% | 0.70 / 0.81 |
| | beach, ink | -8.0 | 0.00 | 40.5 -> 45.5 | 123% | 0.69 / 0.74 |
| z10 | dark | +9.5 | 1.00 | 20.0 -> 22.0 | 100% | 0.68 / 0.83 |
| | light, today | +5.0 | 0.80 | 25.0 -> 20.5 | 55% | 0.71 / 0.74 |
| | light, glow | +7.0 | 1.00 | 24.5 -> 27.0 | 81% | 0.75 / 0.76 |
| | light, ink | -6.5 | 0.00 | 25.0 -> 32.0 | 113% | 0.74 / 0.67 |
| | beach, today | +2.5 | 0.81 | 51.5 -> 43.0 | 31% | 0.74 / 0.82 |
| | beach, glow | +7.0 | 1.00 | 50.0 -> 50.0 | 81% | 0.75 / 0.84 |
| | beach, ink | -9.0 | 0.00 | 50.5 -> 53.0 | 159% | 0.74 / 0.80 |

- **Dark:** every streak pixel is lighter than the colour under it, by +9.5 to +14.5 L* at the median, and keeps that
  colour. One polarity, a brighter shade of what it rides on.
- **Light and beach today:** 63-91% of streak pixels are lighter and the rest darker, +2.5 to +5.5 L* at the median, and
  the streaks are PALER than the field. A black rim, a white ring and a dark colour core share two or three pixels and
  cancel. This is the "thin pale hatching".

## Two candidates, both default off (`windInk.js`)

**Glow** (`window.__RAW_WIND_GLOW__`): dark's own pipeline on the light map.
- The premultiplied composite stands down for the theme, so the buffer (light on black), the fade, the black carving
  rim and the white inner ring (at half strength) are dark's.
- The streak's body is the legend colour at full brightness, mixed 20% toward white.
- One change to dark's composite, needed only on a light ground: the buffer's colour is renormalised and laid at
  alpha = brightness squared. Dark lays (level x colour) at alpha (level x opacity), so its light falls with the square
  of the level; on a light ground the same law has to be written out, or the faded colour shows as a grey ghost.
- It works because the field under the marks is a multiply tint: the ground the marks sit on is L* 74-81 over land and
  58-64 over water, not the bare map's 93.

**Ink** (`window.__RAW_WIND_INK__`): the mirror.
- The trail buffer holds ink on white paper and fades toward white; a white rim carves; the buffer is multiplied into
  the map (one polarity by construction). The ink is the legend colour.

**What each reads** (signal = mean lightness the streaks add, as a share of dark's, at z4 / z6 / z8 / z10):

| | land | water |
|---|---|---|
| light, today | 46 / 68 / 51 / 55% | 133 / 130 / 142 / 119% |
| light, glow | 71 / 60 / 54 / 81% | 141 / 136 / 117 / 133% |
| light, ink | 96 / 107 / 105 / 113% | 121 / 149 / 160 / 116% |
| beach, today | 28 / 46 / 41 / 31% | 78 / 76 / 85 / 56% |
| beach, glow | 80 / 92 / 90 / 81% | 163 / 135 / 111 / 122% |
| beach, ink | 123 / 117 / 123 / 159% | 138 / 161 / 165 / 152% |

- **Glow:** one polarity (0.98-1.00 lighter), colour kept or raised, and the map's own lines survive BETTER than today
  on every surface at every zoom. Its limit is room above pale land: light reaches 54-81% of dark's signal there,
  beach 80-92%. Over LIGHT land at z6 and z8 that is no more raw signal than today (60% against 68%, 54% against
  51%): today's mark gets its signal from two halves that cancel, glow's gain there is one polarity and colour. More white in the body buys strength and costs colour (ring 0.8, white 0.3: 73-82%, chroma ratio
  0.72-0.76).
- **Ink:** one polarity (0.00 lighter), the most colourful, at or above dark's signal on land. It fails where streaks
  carpet warm-band water: at z6 over the Gulf (marks on 87% of the pixels) the 27-40 kn yellow-to-orange band goes
  olive brown at any ink strength from 0.6 to 0.9. At storm strength it takes the water from L* 52.5 to 29 (signal
  212% of dark) and the map's lines there keep 0.55 of their contrast against 0.72 today.
- Storm strength (x2.3), z6: glow reads 70% (light) and 78% (beach) of dark on land, 106% and 105% on water.

Pictures and the full table: the owner's A/B page, https://claude.ai/artifact/8LihWH7nhRsnFjJifr9WRK. The lab (one seeded wind on three grounds, the
three laws switchable, from the algorithmic-art skill): https://claude.ai/artifact/7FMWEapCfMSd8XjqQLMgpm, philosophy `reports/Headroom.md`.

## What failed on the way

1. **Ink with "clean" inks** (each ink scaled so its strongest channel passes untouched): colours stayed clean, but
   green and yellow inks lost their lightness step (beach -2 L*), because their pass band IS the luminance. Kept as
   levers (`__RAW_WIND_INK_PURITY__`, `__RAW_WIND_INK_DENSITY__`), default off.
2. **Glow, first law** (alpha = brightness): tails ran twice as long as dark's and the map whited out.
3. **Glow, the buffer copy:** the renormalising branch was still on when the engine copies one trail buffer into the
   other, so every texel was rewritten at full brightness each frame and nothing faded (marks on 93-99% of pixels).
4. **A uniform behind a comment:** the ink snippet was interpolated after a `//` on its line, so the shader never
   declared it. 27 string-pin tests passed. The bench would have refused to compile it; a test now reads the source
   as the compiler does.
5. In the lab, a helper named `quad` was overwritten by p5's own (the second time this session).

## Research

`reports/Dark style wind on light basemaps.md` (five strands; notes in `research_notes/`, both untracked in the main
checkout). Its sourced findings: no product draws luminous speed-coloured streaks on a pale map (the leaders hide the
map under a saturated field and draw white streaks; Windy flips to one dark purple on its light map); a streak is
carried by luminance, and mixed-polarity marks are the weakest design; each hue is vivid at one lightness (yellow, lime
and cyan only when light; violet, red and plum only when dark), which is exactly where ink failed. Its first draft
concluded for ink from the first prototype. The bench then showed glow working on the tinted ground, and the result
went back to the writer.

## Controls

- **Null:** with both levers off, the engine's trail buffer equals `dev`'s at 696 of 696 samples (dark, light and
  beach; a pan and a zoom-out; anchored and screen arms; `path-run.js --flow --hash-all` against `--ref origin/dev`).
- **Dark is untouched:** dark's rows are identical with either lever on.
- Tests: `windInk.test.js` (35) and `windBenchStyle.test.js` (8); deliberate breaks listed in the PR.

## Limits and what is owed

- **Neither is a default.** One visual variable, the owner's A/B first (LESSONS L-V1, L-V2). Both levers change how the
  trail is laid, so the one chosen must pass the 3-seed scanner before it becomes a default (L-V16); the scanner can
  name them (`run.js --variants candidate,glow,ink`).
- **Not seen in the app.** Pictures are the bench's. A phone at 3x was not measured.
- The streaks' colour-blind separation was not checked for either candidate (the legend and the field are unchanged
  and pass). Glow's body is a lighter shade of the legend colour, ink's is the legend colour.
- Glow over light land stays under dark's strength. Ink would need a palette for the warm band before it could ship.
- The Canvas2D fallback is untouched.

## 18:37Z on: the owner picks glow; the fog, the hard lines and the streak colour

Owner, 18:37Z: "I like glow better. I do see hard lines in between very light winds and other wind fields. ... lets use it
to merge and push, and make all this work properly to state of the art". 18:40Z: "the light wind color also looks like fog
visually, a lot, in light mode. And slightly in beach mode. This needs to be part of this work." 18:45-18:50Z: "beach mode
only needs very slight adjustments I think. light mode is the one that looks like fog"; "the wind animations in beach mode
could be improved ... perhaps they should have color to the animations"; "In dark mode, the wind animations themselves seem
like they change color, whereas in light and beach modes, they do not".

Merged on that word: #307 (dev `90849fe9`, 18:49Z) and #308 (dev `55fca955`, 19:17Z; the levers, default off). The work
below is its own PR.

### What the fog is, measured

Instrument: the palette checker's model (`frontend/scripts/wind-color`: the field as composited over the muted ground,
CIELAB L* / C*), then the wind bench on the real engine and basemap.

| light, over the muted land | 10 kn | 11 | 12 | 13 | 14 | 15 | 16 kn |
|---|---|---|---|---|---|---|---|
| before (straight sRGB line between the stops) | 71.4 / 22.5 | 70.8 / 15.3 | 70.2 / 8.0 | **69.6 / 1.0** | 69.1 / 6.9 | 68.6 / 14.4 | 68.2 / 21.8 |
| after (the path round the hue wheel) | 71.4 / 22.5 | 71.0 / 22.1 | 70.6 / 20.2 | 70.0 / 19.7 | 69.4 / 21.1 | 68.9 / 21.3 | 68.2 / 21.8 |

Three causes, largest first:

1. **A grey veil at the commonest wind speeds (light only).** The 10 kn violet and the 16 kn green are 172 degrees apart
   in hue; the straight line between them keeps 7% of their chroma at the midpoint. Every other segment of every theme
   keeps 0.90 or more (beach 0.92 or more), which is why beach reads only slightly foggy. The same line greyed the
   streaks and the legend bar from 11 to 15 kn. On the bench crop (Mobile Bay z6) it is a grey band across the whole
   picture between the lavender land and the teal coast.
2. **Calm drew the bare map, and the bare map is grey.** The calm stops were near white and the tint is weakest at calm
   (0.29), so calm air showed the ground itself: light 92.4 / 0.6 on 93.4 / 0.5, beach 83.0 / 3.5 on 83.9 / 2.2. That was
   the 2026-07 design ("calm is clean"), set on a map that kept its colour; since the basemap mute (2026-10-09) the
   ground under the wind is grey. A difference under the threshold of seeing, then the climb to the 3 kn tint (beach's
   steepest step anywhere, 5.7 dE00 per knot at 2.5 kn), draws an edge round every calm patch: the "hard lines between
   very light winds and other wind fields".
3. **The 3-10 kn lilac is pale, and cannot be otherwise at its lightness.** Over this near-white ground a multiply tint in
   the lilac family tops out at C* 15 at L* 84.5, 23 at 78.5, 45 at 71 (sRGB gamut; the blue channel is already at 1).
   The stops use about 85% of that. NOT FIXED here, see "Tried and taken back".

### Fix 1: HUE PATH (`WindColorRamp.js`, `huePathStops`)

A segment whose straight midpoint keeps under 3/4 of its ends' chroma is walked round the hue wheel in OKLCH (lightness
and chroma straight, hue by the shortest arc; near-opposite hues go by the cool side, through cyan, the one family no
other band uses), as 1 kn waypoints. Today that is one segment, light's 10-16 kn, in the field and in the particle ramp
(so the streaks and the legend bar take it too): violet, blue, azure, teal, green. Dark and beach get the very same
ramp object back; their lookup tables do not move. Kill: `window.__RAW_DISABLE_WIND_HUE_PATH__`.

### Fix 2: CLEAR CALM

Calm is a pale tint of each theme's own first colour, solved from the composite wanted (the stop is deeper than it
draws, because calm tints at 0.29):

| | calm before | calm now | off the bare ground (dE00) | off the 3 kn tint |
|---|---|---|---|---|
| light | 92.4 / 0.6 | 88.5 / 7.0, a pale rose (dark's calm is magenta) | 1.2 -> 9.3 (3 kn: 12.5) | 7.4 |
| beach | 83.0 / 3.5 | 82.2 / 7.5, a pale seafoam | 1.3 -> 8.1 (3 kn: 15.5) | 7.8 |

The calm edge is gentler: its steepest step falls from 5.1 to 3.6 dE00 per knot in light and from 5.7 to 3.5 in beach
(beach's steepest anywhere). Kill: `window.__RAW_DISABLE_WIND_CALM_CLEAR__`; every older
field kill steps back past it.

### Tried and taken back: deeper lilacs at 3, 6 and 10 kn

Solving 3 / 6 / 10 kn for more colour (84.5 / 14.2, 78.0 / 22.8, 69.5 / 32.0) raised the field's chroma on the bench
(z8 land 16.0 -> 27.0) and broke four bars in turn: 6-10 kn for deuteranopes (4.4, floor 5); with that widened, 3-6 kn
for protanopes (4.6); then dark's strength per band (3.6 dE76 over at 10 kn; the bar is 1) and the unmuted-water
exception (2.89, bar 3.0). Those rows are A's, and A was tuned to exactly those bars. So 3, 6 and 10 kn are unchanged,
byte for byte, and the pale lilac stays. Making it read as clear colour needs a field stronger than dark's at 3-10 kn
or another hue family there: the owner's decision, with an A/B.

### Streak colour (`windInk.js`, per theme)

Bench, glow marks over the final colours (step over the field, share of mark pixels lighter, chroma field -> mark):

| z6 over land | 20% white, ring 0.5 | no white, ring 0.5 | no white, ring 0.25 | no white, no ring |
|---|---|---|---|---|
| beach | +10.5, 1.00, 40.5 -> 41.5 | +9.5, 1.00, -> 45.5 | +8.5, 1.00, -> 50.0 | +8.0, 1.00, -> 53.5 |
| light | +6.0, 0.99, 20.5 -> 23.0 | +4.0, 0.83, -> 26.0 | +2.0, 0.76, -> 29.0 | -0.5, 0.45, -> 30.5 |

Beach's hues are vivid when light, so its streaks drop the white and stay one polarity: default **no white, ring 0.35**.
Measured at that default: z4 +9.5, 1.00, 49.5 -> 58.0; z6 +9.0, 1.00, 40.5 -> 48.0; z8 +6.5, 1.00, 40.5 -> 46.5 over
land; over water z6 +10.0, 0.99, 34.5 -> 49.5 and z8 +4.0, 0.99, 22.5 -> 30.0. The streak is 1.15 to 1.43 times as
colourful as the field under it (it was 0.96 to 1.16), for 1 to 2 L* of its step. Light's lilacs cannot be both light
and vivid: without the white its marks fall on both sides of the ground and cancel, which is the look glow replaced. Light
keeps **20% white, ring 0.5** (z4 +9.0, 0.99, 24.5 -> 28.0; z6 +6.0, 0.99, 20.5 -> 23.0; z8 +5.0, 1.00, 22.5 -> 23.5).
Above 10 kn light's streaks now carry the path's blue, teal and green; below it they stay a pale lilac.

### Glow is the default (D-019), and the scan

`WIND_GLOW.themes = ['light', 'beach']`; kill `window.__RAW_DISABLE_WIND_GLOW__` (the marks as they were).

3-seed artifact scanner, the marks before glow against glow (`run.js --seeds 3 --themes light,beach --variants
candidate,glow`, run `20261010-193528`, positive control PASS on all three seeds): 5 recurring shapes in 4 of 26 views
before, 7 in 5 of 26 with glow. Shape by shape (kind, speed band, size, place) they are the same shapes:
- fine-z7: a 4-block BLOB at 17 kn at [384, 512]. The marks before glow have it in light on all three seeds; in beach it
  sat under the counting threshold (beach's old marks drew at 0.6) and glow's brighter trail crosses it.
- world-z4 light: the same three near-calm HOLEs (2 to 5 kn, 10-21 blocks) in both; one is counted as non-calm when its
  mean speed reads 5-6 kn (two of three seeds with glow) and as calm at 5 kn (before).
No shape appears that the marks before glow do not have. Glow lays more ink (trail mean 100-161 against 82-145) at the
same frame time (16.8-17.1 ms).

### Before and after on the real map (both arms drawn with glow marks; field chroma under the marks, land)

| light | z4 | z6 | z8 |
|---|---|---|---|
| before | 22.5 | 17.5 | 16.0 |
| after | 24.5 | 20.5 | 22.5 |

Beach's field reads the same to the digit at all three views (there is almost no calm air in them).

### The steepest step, in context

| steepest change per knot (dE00) | where | 0-3 kn | 3-6 | 6-10 | 10-16 |
|---|---|---|---|---|---|
| dark, the look to carry over | 13.1 at 5.75 kn | 6.0 | 13.1 | 7.2 | 1.7 |
| light, land, before | 9.0 at 13 kn | 5.1 | 2.5 | 2.9 | 9.0 (into and out of grey) |
| light, land, after | 10.7 at 12 kn | 3.6 | 2.5 | 2.9 | 10.7 (violet to green in 6 kn, in colour) |
| beach, land, before -> after | 5.7 at 2.5 kn -> 3.5 | 5.7 -> 3.5 | 3.1 | 3.0 | 2.1 |

The 10-16 kn handoff is still light's steepest part, now a quick sweep through blue and teal instead of a grey stripe,
and under dark's own steepest (13.1). Making it gentler means moving the 10 or the 16 kn stop: the owner's decision.

### Bars re-scoped, each with its reason in the test

- `windFieldLut.test.js`: "calm is clean" (<= 2.5 dE off the surface) becomes "calm is a pale tint" (4 to 11.5 on the
  basemaps' own surfaces, weaker than light air's). Its positive control (the 2026-07 saturated calm) still fails.
- same file: the calm pair's bar on the basemaps' own surfaces is 5.0 (it is 5.3 over light's own cyan water, the
  picture with the mute killed); over the muted ground that draws it is 6.1 and 7.4, pinned in the new file.
- `windLightFastBand.test.js`: calm is the clear calm stop; 3 kn and A's rows from 6 kn up are as they were.
- `windLegendFromRamp.test.js`: light's bar has 18 stops (13 + the path's five), dark's and beach's 13.
- `windLightTheme.test.js`: the premultiplied marks are tested under glow's kill switch.

### Research

Three researchers and a writer: `reports/Wind fog look and streak colour.md`, notes in `research_notes/Wind fog look and
streak colour/` (main checkout, untracked). What it added: fog is colours converging on one light grey, a filter darkens
and keeps contrast (so a multiply tint never loses the map's lines: the fog is colour statistics); calm should differ
from the ground by nothing or by at least a just-nameable step, never by a sub-threshold one (the toe); colour is seen
at about a third of the sharpness of lightness, so white inside a 2-3 px mark is averaged into it; no leading product
draws speed-coloured streaks over a speed-coloured field. Where the bench overruled the notes: they placed the fog at
3-6 kn (it is at 13 kn), set chroma targets a multiply tint cannot reach, and expected the white share to matter more
than the ring.

### Controls

- Dark's and beach's ramps come back as the same object from the path; their lookup tables are equal with the kill on
  and off. Light's tables differ between 10 and 16 kn and nowhere else.
- 3, 6 and 10 kn sample exactly what they sampled; the legend's 13 stops are untouched.
- 19 deliberate breaks, 19 turn a pin red (`mutate_clear.py`: the keep threshold at 0 and at 2, the warm way
  round, a fifth of the chroma, the table or the bar not taking the path, both kills, the calm rows, an older kill not
  stepping back, glow off by default or on in dark, beach keeping the white).
- Palette checker `--strict`: 0 red, 0 colour-blind red. It gained two gates: the field's weakest colour on the PATH from
  3 to 40 kn (>= 8 C*), and calm against the bare ground (>= 5 dE00, weaker than 3 kn).
- Jest map + `src/tests`: 301 suites, 3846 tests. ESLint ratchet: no rule over baseline. Production build compiles.

### Limits and what is owed

- **Not seen in the app.** The pictures are the bench's. A phone at 3x was not measured.
- **The pale lilac at 3-10 kn in light is still pale** (cause 3). The owner's decision: a deeper field there, another hue
  family, or as it is.
- **A sharp vertical edge in the bench's z4 picture** is the seam between its fine grid and its 2-degree base (two grids
  that disagree on speed at their border). The colours no longer turn it grey; the seam is data, not palette.
- The Canvas2D fallback (`WindParticleOverlay.js`) samples the straight ramp still.
- The streaks' colour-blind separation was not checked (the legend and its stops are unchanged and pass).
