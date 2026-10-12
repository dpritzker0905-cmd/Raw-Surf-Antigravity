# 2026-10-12 · Why light never matched its samples: the page behind the map showed through the wind (D-027)

Local session (Windows, AMD Radeon 890M, D3D11), the lead of the light/beach wind lanes; the same session that built #314, #315
and #320. Branch `claude/wind-opaque-canvas`, cut from `origin/dev` at `74417b5a` (#316's merge). Times are UTC.

**The owner's words this rests on** (this session's chat, first-hand):

- 2026-10-12 02:58Z: "We need to make light mode wind animations & beach mode wind animations equivalent to dark modes. We possibly
  solved issues why, but we have a lot open here and need to put it to lessons and memory. [...] And the map needs to be taken
  into account... use the jacobian lens to help see everything as a whole. To not miss any clues."
- 12:28Z, on the deployed dev build (`74417b5a`): "I just did a visual check for wind on beach and light modes, and I still do not
  visually see the improvements yet.... notate that"
- 12:36Z: "you need to also compare the amount and density of the animations from beach and light mode to dark mode. And colors,
  how slower color wind is more transparent than faster color wind. Weve worked on this for 2 days already. This should work
  after all the agents worked on this. Study your research and best practices more"

The owner did not name the change built here and has not seen it.

## The finding

**In light mode the app shows the page behind the map through the wind, and that page is near white. In dark and beach it is
black. The wind bench has always laid its frames over black.**

1. The map's canvas is premultiplied (read from the context: `alpha: true, premultipliedAlpha: true`). The browser shows
   `rgb + (1 - alpha) x page`.
2. Two of the wind's passes draw into the map's own framebuffer with `blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)`
   (`WebGLWindEngine.js`: the colour field when it is not a multiply tint, which is dark's; and the trail composite when it is not
   premultiplied, which is dark's and, since D-021, light's and beach's white streak). That blend applies the same factors to the
   alpha channel: a pass of alpha `a` over an opaque map leaves `1 - a + a x a`.
3. Read on the bench (`motion-run.js`, Mobile Bay, the fixture wind x0.4, zoom 6, page and map at 1.5), the canvas's alpha, least
   and mean: **dark 0.608 / 0.685, light 0.749 / 0.900, beach 0.749 / 0.895.**
4. `MapPage.js` lays `bg-gray-50` behind the map when `theme === 'light'` and `bg-black` otherwise: dark AND beach. Nothing with a
   colour of its own sits between that page and the canvas.
5. The bench saved every frame as a JPEG of the bare canvas. A JPEG fills what a canvas leaves with black.

So for dark and beach the bench's frame is the screen. For light it is not: the app adds up to a quarter of the page's white
under every streak, and the bench never drew that.

## How it was found

The owner's 12:36Z message asked for amount, density and colour by speed against dark. Three readings disagreed and each was
chased to its instrument:

- **The probe's lift said light equals dark over the sea** (0.93 to 1.13 on dev's look, 0.97 to 1.08 with every open change),
  on a build where the owner saw no dark in light. The probe's line contrast and its lift then disagreed with each other.
- **The probe's ground was checked against the field alone** (the same crop drawn with a 2 x 2 particle pool; low ramp, 11.8 /
  15.3 / 18.5 kn; the local preview that carries every open change). Dark's ground read low: over the sea 41.3 / 42.6 / 43.1
  where the field alone is 44.7 / 46.1 / 46.6, over land 33.2 / 34.7 / 35.5 against 38.7 / 38.6 / 39.8. Light's read true (50.0 /
  48.1 / 47.4 against 50.3 / 48.1 / 47.4 over the sea). Lift over the field alone, sea: dark 5.1 / 5.2 / 5.4 (reported 8.6 / 8.7
  / 8.9), light 8.1 / 8.7 / 9.0, beach 8.4 / 9.7 / 10.4; land: dark 6.5 / 8.1 / 8.1 (reported 11.9 / 12.0 / 12.4), light 6.6 /
  8.6 / 8.6, beach 7.3 / 9.1 / 10.6 (LESSONS L-V73).
- **To rule out the JPEG, the crops were taken again as PNG at device resolution**, and the first read came back 14 L* too
  light in dark. The PNG had kept the canvas's alpha, which the JPEG had been throwing away. That was the clue: the canvas is
  not opaque. The page behind the map was then read from `MapPage.js`, and one light frame was photographed by the browser itself
  over each page colour (a real screenshot, the compositor's output): over gray-50 the streaks are near white and the field is
  veiled; over black it is the bench's picture.

Lossless, against the field alone, 15.3 kn, the local preview (scratch instrument `truth-run.js`, not committed):

| | lift | picture 10 L* or more over its ground, share of pixel-instants | a pixel's lightest moment over its ground | 1.5 L* or more UNDER its ground |
|---|---|---|---|---|
| dark, sea (over black, its page) | 6.6 | 0.39 | +18.4 | 0.19 |
| light, sea, over black (the bench; the fix) | 10.8 | 0.51 | +24.6 | 0.00 |
| **light, sea, over gray-50 (the app's page, under the same engine)** | **24.3** | **0.74** | **+46.8** | 0.00 |
| beach, sea (over black, its page) | 12.1 | 0.54 | +28.9 | 0.00 |
| dark, land | 9.5 | 0.44 | +26.5 | 0.07 |
| light, land, over black | 10.0 | 0.47 | +23.6 | 0.00 |
| **light, land, over gray-50** | **22.6** | **0.70** | **+45.8** | 0.00 |
| beach, land | 11.6 | 0.51 | +28.6 | 0.00 |

Dark's marks take the picture under the field beside their core (they carry the legend's colour); light's and beach's were
solved to be the ground's colour made lighter and never do. That is a difference in the look that no measure here had named.

## What was built

- `windCanvasAlpha.js`: `blendIntoMap(gl, src, dst)` sets `blendFuncSeparate(src, dst, ZERO, ONE)`: the colour's blend as asked
  for, the canvas's alpha as the map drew it. Kill `window.__RAW_DISABLE_WIND_OPAQUE_CANVAS__ = true` (read each frame) sets
  `blendFunc(src, dst)`, dev's call.
- `WebGLWindEngine.js`: the two passes bound to the map's framebuffer set their blend through it. Three lines edited in place; the
  file is the same length (it is over the line ratchet's limit).
- The bench: `page/map-entry.js` lays every saved frame over the app's page for the theme (`APP_PAGE`; `pageCanvas`) and returns
  the canvas's alpha; `motion-run.js --behind <css colour>` lays another page and prints the alpha, a run.
- Tests first: `windCanvasAlpha.test.js`. 3 of 13 failed before the engine and bench edits (the two engine pins and the bench's
  page pin). It pins the blend with and under the kill, the law, `MapPage.js`'s page classes, the bench's copy of them, and that
  no pass is left that blends the map's alpha by the colour's factors. Four older source pins of the two edited lines moved to
  the new call (`windInk.test.js`, `windLightTheme.test.js` two, `windParticlesV2.test.js`). The new kill is classified in
  `windDarkRules.test.js` (it moves the canvas's alpha, never a colour, so dark's rules do not stand down under it).

## Measured, built (this branch: dev's engine and this change; Mobile Bay, the fixture wind x0.4, zoom 6, page and map at 1.5)

**The canvas's alpha**, least / mean: built 1 / 1 in dark, light and beach. Under the kill: 0.608 / 0.685, 0.749 / 0.900, 0.749 /
0.895.

**Frames built against frames under the kill, by a hash of each of 90**, each over its theme's own page:

| | same bytes | different |
|---|---|---|
| dark | 90 | 0 |
| beach, the two arms at the same run position | 90 | 0 |
| light | 0 | 90 |
| null control: the same arm twice (beach, both arms) | 90 | 0 |
| order control: the same arm, first run on a fresh map against second | 75 | 15 (frames 1 to 39) |
| light built, over gray-50 against over black (`--behind`; each the only run of its page) | 90 | 0 |
| light under the kill over black against light built over black (the same) | 90 | 0 |

The first comparison of beach read 15 frames different. The null control was clean, the same 15 differed on a repeat, and with
the arms' order swapped the difference followed the position, not the arm: a theme's first run on a fresh map is not its second.
Dark and beach draw the same screen with and without the change; light draws a different one in every frame. The last two rows
say what light's new picture is: the page no longer matters, and it is dev's light over a black page to the byte, which is the
picture the bench has always drawn. (A run's position is also what its page ran before: light after two dark runs differed from
light alone in a page in all 90 frames, same arm, same page colour.)

**The mirror probe, beside dark** (220 px crops; JPEG frames; the probe's own ground, so dark's lift is read high, L-V73):

| | ground L* | picture L* | lift | a core's L* | flicker |
|---|---|---|---|---|---|
| dark, sea (0.5, 0.8) | 43.6 | 54.8 | 11.2 | 70.1 | 2.03 |
| light on dev, sea (the app: over gray-50) | 54.2 | 73.9 | 19.7 | 94.4 | 2.52 |
| **light built, sea** | 48.6 | 58.9 | 10.3 | 72.0 | 1.75 |
| beach, sea, built and under the kill alike | 49.4 | 62.7 | 13.4 | 79.6 | 2.19 |
| dark, land (0.5, 0.2) | 18.9 | 28.6 | 9.7 | 32.3 | 1.16 |
| light on dev, land | 73.0 | 79.8 | 6.8 | 87.4 | 1.01 |
| **light built, land** | 72.0 | 76.1 | 4.1 | 83.0 | 0.84 |
| beach, land, both arms | 66.8 | 71.5 | 4.7 | 76.8 | 0.88 |

The speed under these crops was not read (the view's sea runs 10.5 kn at the median, 6.9 to 14.9 the quartiles; its land 4.9, 3.2
to 9.1: `ground-run.js --scale 0.4`).

## What it costs, and what it does not do

- **Over land in light air light's streaks get fainter until #320 lands:** 6.8 to 4.1 at the land crop. On dev's pale land the
  page's white was the only thing lifting a white streak. #320 (the land at the sea's depth, D-026) was measured on the fixed
  picture, the bench's. The two belong together.
- **Beach does not change.** Its page is black. What the owner did not see in beach on the deployed build is that none of #315,
  #319 (F) and #320 is merged.
- **D-022's strengths were set against a bar read too high** (L-V73). Not retuned here.
- **The probe on a live canvas** (`mirror-probe.js capture()`) was not checked for this; its light numbers on any build before
  this change are unverified.
- Not measured: phones; zooms other than 6; a page other than `MapPage.js` hosting the map with the wind on.

## The owner's two questions, answered from what is measured

**Amount and density.** The engine draws the same particles on the same paths in every theme (one seed, one clock). What
differs is how much of that the eye is given. Share of the picture a streak lights 10 L* or more above its ground at an instant
(lossless, 15.3 kn, the table above): dark 0.39 over the sea and 0.44 over land. Light over the app's page 0.74 and 0.70, with
near-white cores: not too little animation but a white haze of it, over a veiled field (that row is the preview's engine laid
over gray-50; dev's own engine was read with the probe: lift 19.7 against dark's 11.2, a core at L* 94). Light with this fix and the open changes 0.51 and
0.47; beach 0.54 and 0.51. By speed, on the probe's frames (every open change; the bench's picture): the share lit at an instant
is 0.87 to 1.02 of dark's over the sea in light and 0.75 to 1.02 in beach (lowest under 5 kn); over land 0.86 to 0.98 and 0.67
to 0.99.

**Colour by speed.** The field's strength rises with speed only to 5 kn in dark and 7 kn in light and beach
(`WebGLWindShaders.js`, `baseAlpha` 0.44 / 0.42 / 0.45 to 1 by `rampEnd`); above that the strength is constant in all three and
only the colour moves. The colour under the field over the sea, by speed (the probe's ground chroma, 1.8 / 4.5 / 7.3 / 10 / 11.8 /
15.3 / 18.5 / 25.6 / 32.3 / 38.5 / 44.7 kn):

- dark: 21, 29, 19, 23, 23, 23, 23, 27, 22, 19, 18. Even. What rises with speed in dark is lightness (the field alone reads L*
  44.7 / 46.1 / 46.6 at 11.8 / 15.3 / 18.5 kn; the probe's ground 30 at 4.5 kn to 46 at 25.6).
- light on dev: 16, 31, 39, 40, 33, 26, 37, 34, 28, 27, 23. **Backwards: its strongest colour is at 6 to 10 kn**, in the lightest
  winds a surfer sees. In the preview that carries every open change (light's field there is #318's): 17, 22, 25, 26, 26, 28,
  32, 42, 33, 27, 23: it rises with speed to 26 kn.
- beach on dev: 11, 18, 21, 19, 23, 32, 39, 44, 42, 27, 25, with its pale band from 26 to 39 kn. In the same preview (F, #319,
  and #315): 11, 17, 18, 16, 17, 19, 22, 32, 35, 26, 23.

## Research read again for this

- earth.nullschool's source lays its colour overlay at one opacity (`OVERLAY_ALPHA = Math.floor(0.4 * 255)`) and makes a streak
  brighter with speed (greys 85 to 255 up to 17 m/s): strength by speed lives in the MARK there, not in the field's opacity.
- Motion is carried by luminance contrast, slow motion most of all (Lu and Sperling 1999; Hawken et al. 1994).
- On a light ground "more" reads as darker, on a dark ground as lighter (Schloss et al. 2019): the references for light
  basemaps draw darker marks. A white streak on light's ground is a choice the owner made from samples (D-021); those samples
  were over black.

## Not verified

- **Nothing here has been seen in the app.** The deploy preview's map is behind the sign-in.
- One view, one seed, zoom 6, a laptop's pixel ratio. The lossless table is one crop a row.
- The glow look of 2026-10-10 ran the same composite in light by the code's path; its alpha was not re-measured.

## 15:26Z · After the independent review: the engine change stands; three things this log said do not

A fresh agent reviewed the diff after the PR was opened (it had not returned when #321 was opened; the PR said so). It ran the
real engine on a recording GL over 20 lever sets, 31 mutants, a compositor check in a plain page, and the bench under the kill.

**Its verdict: the engine change is correct and it could not break it.** No other draw lowers the canvas's alpha, nothing leaks
into the engine's own buffers or back into MapLibre, the kill is dev call for call, `MapPage.js` is the map's only host, and its
own GPU read agrees (built 1 / 1; under the kill dark 0.608 / 0.682, light 0.749 / 0.912, beach 0.749 / 0.909 on the offline
basemap).

**What it found, and what was done with each:**

1. **The old saved frames were not "the canvas over black"** (medium). A bare 2D canvas is un-premultiplied by the encoder
   (clamped at 255) and then filled with black, so a pixel held min(channel, alpha). Its read under the kill: dark 6.1% to 8.6% of
   pixels with a clamped channel, 2.0 to 2.8 L* darker each on average; light 21% to 26%, 1.7 to 2.0 L*, up to 13.0; beach 11.5% to
   25.6%, 3.1 to 3.6 L*. **Checked on this session's own older lossless crops** (the old bench, every open change, 15.3 kn): 29% of
   dark's sea pixels carry the clamp's mark (a channel at 255 under an alpha below 1), 15% of dark's land, 7% of light's, none of
   beach's at that crop. **So three things this log says above are wrong or too strong, and are corrected where they were also
   written (D-027, L-V72, the README, STATE, `windCanvasAlpha.js`):** "the bench has always laid its frames over black"; "over
   black it is the bench's picture" and "it is dev's light over a black page to the byte, which is the picture the bench has
   always drawn" (the byte comparison is true of the CORRECTED bench only); and "for dark and beach the bench's frame is the
   screen". Light with the fix is close to its old samples, with brighter and more coloured streak cores. The lossless table
   above ("How it was found") was read from such clipped crops: its direction stands (gray-50 far over black), its numbers do not.
2. **The tests pinned text** (medium): four ways of re-opening the bug passed every committed test (a draw with blending off, a
   later blend call, a clear on an existing line, the field with blending off), and the "law" tests exercised two functions
   nothing in the app called. **Done:** the review's instrument is adopted as `windCanvasAlphaTrace.test.js` (the real `render()`
   on a recording GL: every draw and clear on the map's framebuffer, on 20 lever sets, three themes, with and without a fine
   grid; the kept-alpha factors never reach the engine's own buffers; MapLibre gets its blend back; the kill as positive
   control). Checked here with its mutant E5 (blending off before the composite): 122 tests fail. The two uncalled functions are
   removed.
3. **The scored columns still read the canvas without the page** (medium, bench). **Done:** every canvas read carries its alpha
   (`page-colour.js` `alphaOf`); the motion run reports the least over every sampled frame; `map-run.js` and `path-run.js` print a
   warning when a scored read was on a see-through canvas. Not done: laying the page into the scored reads themselves.
4. **The motion run's cache and an invalid `--behind`** (low to medium). **Done:** a cached run is this run only on the same page;
   a string that is not a CSS colour stops the run.
5. **What the bench pin did not see** (low). **Done:** the page's colours, the alpha read, the fold and the warning are one
   CommonJS module tested by what it does. Not done, said in the README: `run.js`, `ladder-run.js` and `lane-run.js` still save
   the bare canvas (right on a built engine, clipped on an older `--ref` or under the kill).
6. **The page pin covered one of three elements** (low). **Done:** `MapWebGL.js`'s root and the map's own style are pinned too.
7. **`windCanvasAlpha.js`'s comment** (low). **Done:** D-020, not D-021; "opaque wherever the map drew it opaque"; the samples
   sentence narrowed.
8. **Ship notes.** Two older kills (the field tint's; dark's rules' with the premultiplied composite's) send light to one of the
   two passes: under this change they draw dev's colours but not the page showing through them. Said in the module's comment:
   for dev's exact screen under such a kill, set this kill with it. And "merge with #320" is withdrawn, below.

### Measured again, on corrected frames, against the field alone

"Added" is the mean picture minus the same crop drawn with the colour field alone (a run with a 2 x 2 particle pool); it is the
light the streaks add. The probe's own lift (the mean over each pixel's darkest moment) is beside it, because it is what every
earlier table in this program carried.

**This branch (dev's engine and this change), the fixture wind x0.4, zoom 6, 220 px crops:**

| | field alone L* | darkest moment | mean picture | added | the probe's lift | a core L* |
|---|---|---|---|---|---|---|
| dark, sea | 46.3 | 43.6 | 54.8 | 8.5 | 11.2 | 70.1 |
| light built, sea | 46.6 | 48.6 | 58.9 | 12.3 | 10.3 | 72.0 |
| light on dev's page, sea | 46.6 | 54.2 | 73.9 | 27.3 | 19.7 | 94.4 |
| beach, sea | 46.4 | 49.4 | 62.7 | 16.3 | 13.4 | 79.6 |
| dark, land | 25.3 | 18.9 | 28.6 | 3.3 | 9.7 | 32.3 |
| light built, land | 72.3 | 72.0 | 76.1 | 3.8 | 4.1 | 83.0 |
| light on dev's page, land | 72.3 | 73.0 | 79.8 | 7.5 | 6.8 | 87.4 |
| beach, land | 67.4 | 66.8 | 71.5 | 4.1 | 4.7 | 76.8 |

So "the cost" as first written (light's land at 0.70 of dark's lift, 0.42 with the fix) was the probe reading dark high: by
light added, light's land streaks go from 7.5 to 3.8 where dark's add 3.3.

**The local preview (every open change and this one; speed ramps, zoom 6, 110 px crops; `light-flat` and `beach-flat` have #320
killed), light added and its ratio to dark's at the same crop:**

| kn | sea: dark | light | beach | land: dark | light | light, #320 off | beach | beach, #320 off |
|---|---|---|---|---|---|---|---|---|
| 3.2 | 1.1 | 2.6 (2.36) | 2.4 (2.18) | 2.3 | 2.8 (1.22) | 2.7 (1.17) | 2.4 (1.04) | 2.9 (1.26) |
| 5.9 | 3.4 | 5.1 (1.50) | 5.3 (1.56) | 5.0 | 5.1 (1.02) | 5.5 (1.10) | 4.9 (0.98) | 6.6 (1.32) |
| 8.6 | 3.0 | 5.0 (1.67) | 5.5 (1.83) | 4.4 | 4.7 (1.07) | 5.1 (1.16) | 5.3 (1.20) | 7.6 (1.73) |
| 11.8 | 6.7 | 9.7 (1.45) | 10.3 (1.54) | 7.9 | 8.1 (1.03) | 9.3 (1.18) | 8.9 (1.13) | 12.8 (1.62) |
| 15.3 | 7.7 | 10.9 (1.42) | 12.3 (1.60) | 10.4 | 10.6 (1.02) | 12.8 (1.23) | 11.5 (1.11) | 17.0 (1.63) |
| 18.5 | 8.2 | 11.3 (1.38) | 13.3 (1.62) | 10.8 | 10.9 (1.01) | 13.1 (1.21) | 13.4 (1.24) | 19.9 (1.84) |
| 25.6 | 14.3 | 19.0 (1.33) | 17.9 (1.25) | 15.2 | 15.6 (1.03) | 19.6 (1.29) | 15.6 (1.03) | 21.4 (1.41) |
| 38.5 | 14.9 | 21.9 (1.47) | 15.5 (1.04) | 17.5 | 19.9 (1.14) | 27.2 (1.55) | 15.9 (0.91) | 20.2 (1.15) |

- **A core's height over the field, the sea:** dark 4.5, 14.7, 14.7, 20.8, 22.2, 22.7, 25.0, 26.0; light 4.5, 14.9, 15.5, 21.9,
  22.9, 23.0, 28.0, 31.4; beach 4.3, 14.1, 15.9, 22.6, 25.3, 26.5, 26.6, 23.5. The cores match; what differs is between them.
- **The darkest moment against the field, the sea** (under is positive): dark 3.9, 3.5, 3.6, 2.7, 2.5, 2.3, then 3.0 and 3.9 OVER
  it at 25.6 and 38.5 kn; light 2.1, 1.7, 1.5 under, then 1.3, 1.9, 2.5, 9.2, 11.7 over; beach 1.8, 1.0, 1.1 under, then 1.6, 2.5,
  3.3, 8.9, 7.5 over. From 12 kn up light's and beach's pixels do not come back to the field between streaks.
- **Flicker against dark's:** the sea, light 0.74 to 0.86 and beach 0.65 to 0.90; the land with #320, light 0.65 to 0.82 and
  beach 0.58 to 0.87; with #320 off, light 0.68 to 1.13 and beach 0.69 to 1.27.
- **The probe's lift, the land, #320 off, light against dark:** 0.15, 0.55, 0.48, 0.55 at 3.2 to 11.8 kn, where the light added is
  1.17, 1.10, 1.16, 1.18. That backwards reading is what #320's log and D-026 give as their reason (corrected on that branch).

**Lossless, device resolution, the same preview, 15.3 kn, every pixel and frame against the field alone** (`truth-run.js`,
scratch; the corrected bench, so nothing is clipped):

| | added | 3 L* or more over the field, share of pixel-instants | 1.5 L* or more under it | darkest moment | a pixel's lightest | line contrast (Weber) |
|---|---|---|---|---|---|---|
| dark, sea | 7.7 | 0.58 | 0.19 | -2.2 | +25.3 | 1.82 |
| light, sea | 10.8 | 0.75 | 0.00 | +1.8 | +25.3 | 1.70 |
| beach, sea | 12.2 | 0.76 | 0.00 | +1.9 | +28.4 | 2.46 |
| dark, land | 9.9 | 0.62 | 0.07 | -0.6 | +29.1 | 2.86 |
| light, land | 10.1 | 0.71 | 0.00 | +1.5 | +24.4 | 1.62 |
| beach, land | 11.6 | 0.73 | 0.00 | +1.7 | +28.0 | 2.35 |

Dark's dip under its field is real and small (no pixel 3 L* under); the JPEG frames overstate it over land (2.0 at 15.3 kn where
this reads 0.6). Light and beach light 9 to 18 points more of the picture at an instant than dark does, with cores as high.

### What this changes

- **The gap to dark is not strength.** With every open change, light's and beach's streak cores stand as high as dark's over
  the sea, and they add as much light as dark's over the deeper land and more over the sea. What dark has and they do not: its
  streaks come back to the field (and a little under it) between cores; theirs linger 1 to 12 L* over it. Over land light's line
  contrast is 0.57 of dark's (1.62 against 2.86): its land, deep as it now is, is still 11 L* lighter than dark's.
- **#320's stated reason was this gauge's error; its effect is still toward dark:** with it light's land adds 1.0 to 1.2 times
  dark's light (1.1 to 1.55 without it) and beach's 0.9 to 1.2 (1.15 to 1.84 without it), on one ground with the sea.
- **D-022's strengths were set on the probe's lift.** By light added, light at 0.55 adds 1.3 to 1.7 times what dark does over
  the sea, and beach at 0.55 adds 1.0 to 1.8 times.
- **Every clip sent before this section was drawn from clipped frames** except the two taken on this branch
  (`light-canvas-fix-alone.webm` and the two stills). The others are being filmed again on the corrected bench.

### Not verified

- Still nothing seen in the app. One view, one seed, zoom 6; the by-speed rows are JPEG frames at 1000 px (means are sound, the
  darkest moments carry ringing); the lossless table is one speed. Why light's and beach's trails linger and dark's do not is
  not established: the composite is the same, the marks' colours are not.
