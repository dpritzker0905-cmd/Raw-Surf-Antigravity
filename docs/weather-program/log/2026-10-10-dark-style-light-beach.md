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
