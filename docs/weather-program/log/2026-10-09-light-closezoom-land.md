# 2026-10-09 · Light mode, close zoom: the wind no longer drowns the land

Owner, after #285-#289 merged: "in light mode, really close up ... wind animations are flooding too much just a little
bit, where it drowns out the land beneath". Their tab: dev--rawsurf.netlify.app, Mobile Bay to Gulf Shores at about z9,
the 18Z viewport product (`-89..-84 / 29..32`, 21x13, max 54.6 kn). A screen read shows long chains of large
white-ringed, orange-cored marks over the land, with the tan tint underneath.

## Measure first (wind bench, new LAND mode, `land-run.js`)

`ink` reads the trail buffer, which cannot tell a translucent mark from an opaque one. Land mode reads the screen:
- the real engine over a 1-css-px dark line grid on the theme's land colour, 180 frames;
- line contrast kept, with the field alone (2x2 pool) and with the desktop pool;
- `parts` = the share of the field-only contrast the particles take away.

| parts (before) | z6 | z7 | z8 | z9 | z10 | z11 |
|---|---|---|---|---|---|---|
| light | 0.40 | 0.58 | 0.64 | 0.60 | 0.53 | 0.54 |
| dark | 0.00 | 0.25 | 0.28 | 0.38 | 0.24 | 0.25 |
| beach | 0.25 | 0.37 | 0.40 | 0.37 | 0.33 | 0.35 |

- **The field is not the cause:** alone it keeps about 0.80 of the land's contrast in light at every zoom.
- **Light's particles are:** they hide 1.5x more land at z8-9 than at z6 (the look the owner approved), and about
  twice what dark's do.
- **Why:** the close-zoom dose holds trail INK, and it was calibrated on dark, whose marks composite translucent. Light's
  marks are premultiplied at opacity 1.0 (LESSONS L-V14).

Opacity is the one variable that fixes this without touching mark count, size, trails or colour. By light mark opacity:

| | z6 | z7 | z8 | z9 | z10 | z11 |
|---|---|---|---|---|---|---|
| 0.8 | 0.33 | 0.47 | 0.52 | 0.49 | 0.43 | 0.44 |
| 0.65 | 0.27 | 0.38 | 0.43 | 0.40 | 0.35 | 0.36 |

## Fix

`WIND_CLOSE_LAND` (`WebGLWindUtils.js`) eases light's premultiplied mark opacity from 1.0 at z6 to 0.65 at z7.5 and
beyond, as a smoothstep ramp (L-V13: no step at a zoom boundary).
- **Untouched:** z<=6, dark and beach.
- **Lever:** `__RAW_WIND_CLOSE_LAND_OPACITY__`, the close-zoom factor, 0.1-1.
- **Kill:** `__RAW_DISABLE_WIND_CLOSE_LAND__`.
- **Client-only:** no served number changes, so no SCOREBOARD row.

## Verified

Bench, after (same machine and view, one run per arm):

| light | z6 | z7 | z8 | z9 | z10 | z11 |
|---|---|---|---|---|---|---|
| parts | 0.40 | 0.43 | 0.43 | 0.40 | 0.35 | 0.36 |
| lost (was) | 0.48 (0.48) | 0.55 (0.64) | 0.56 (0.69) | 0.52 (0.67) | 0.45 (0.59) | 0.47 (0.61) |

- **Null control:** dark and beach match the before run to 3 decimals in every row.
- **Positive control:** with `__RAW_DISABLE_WIND_CLOSE_LAND__`, light returns to the before numbers exactly.
- **Trail buffer:** unchanged (the factor is applied only in the screen composite), so the artifact scanner's view and the
  #281 positive control are unaffected.
- **Jest:** both trees pass, 286 suites / 3538 tests. The ESLint ratchet is clean.
- **Cost, stated plainly:** light's marks are about a third fainter from z7.5 in. The live lever lets the owner try a
  milder setting, e.g. `window.__RAW_WIND_CLOSE_LAND_OPACITY__ = 0.8` (parts 0.43-0.52).

## Console log the owner sent (same session)

Nothing in it explains the flood: it is pure compositing. Things worth knowing:
- **Fine-overlay swaps while panning.** The fine overlay flips between the 0.25 deg viewport product (21x13, max 54.6 kn)
  and a 5x5 crop of the 2 deg world product (max 41.6 kn) whenever the view leaves the fine box. The fine fetches for the
  new box are aborted by the next pan ("signal is aborted"; the safe zero grid is held, not drawn). Each flip also moves
  `maxWindSpeed` and rebuilds the colour ramp. This is the same family as the eye-shape item; it is not a rendering bug.
- **A noisy tracer.** `WEATHER_TRUTH ABSENT ... died after orchestratorCommit` fired on a cache-hit re-commit of an
  identical grid, which skips the upload. It is noise from the tracer.
- **The box was slow.** "Failed to fetch message count: timeout of 15000ms" is the 1-CPU box under load, not wind.

## Round 2 · every theme, thin marks, better instruments, #292 folded in (same session)

Owner, after #291 merged: "Dont assume that beach mode and dark mode cannot be improved a little bit. Run the same tests.
We need this to be state of the art. Make better instruments and use skills and plugins to help"; then "Test all your
work when done using forensics. And lets fix the #292 to merge into this work".

### Instruments
- **land-run.js v2.** Each basemap's road polarity: dark's lines are lighter than its land. The first run drew them
  darker and read a false 0.00 at z6. Adds `sal` and `cover`; `sal / cover` is the contrast per marked pixel.
- **map-run.js (new).**
  - Setup: the owner's real Mapbox basemaps in MapLibre 5, with the engine at the app's slot (labels and coastline
    above). The served GFS grid (2026-10-09 15Z) is viewed at Mobile Bay, at served strength and x2.3 (storm, the
    owner's case).
  - Scoring: each basemap edge pixel is scored between its own line and ground pixels (retain, lost, WCAG 3:1 kept),
    plus a GMSD gradient check and the particle signal. Values are medians of 5 samples at CSS-pixel scale.
  - Its first WCAG version credited the particles' rings as road contrast (L-V17).
- **Research:** deep-research skill, 3 threads plus a report, `reports/Wind particle close zoom legibility.md`.
  - Industry source reading (Windy, Ventusky, Zoom Earth, MapTiler, Mapbox, WeatherLayers, earth): no leader adds
    particles closer in; widths stay 1-3 px. Ours reach ~5.8 css px at z9.
  - Perception: count is the cheapest lever, then width, then opacity. Opacity is the motion-carrying contrast.
  - Metrics: GMSD, SSIM contrast-structure on feature masks, WCAG 3:1, Feature Congestion.

### Decision
- **Lever:** WIND_CLOSE_THIN narrows each dash across the wind, so width returns to the leaders' range. Count is
  unchanged (the owner wants "plenty").
- **Light:** thin 2.0 replaces #291's opacity 0.65. At equal land returned it keeps each mark's contrast: 15.5 vs 15.7
  dL* per marked pixel, where opacity 0.65 gave 13.1.
- **Beach** thin 2.0, **dark** thin 1.5. Each returns to its own approved z6 land cost.
- **Kept as levers:** WIND_CLOSE_LAND (opacity), for the owner's A/B.

### #292
- **Ledger:** both PRs appended seq 964. dev's chain was kept; #292's two lines were re-chained as 965-966 and the
  STATE anchor was moved. Verify: OK.
- **Lessons:** both added L-V14; #292's became L-V15.
- **Scanner control:** #292's dark palette made the scanner's positive control BLIND (dev PASS; #292 alone BLIND,
  palette only). The pole crossing moved only 42.5 -> 41 kn, but the HOLE got too faint. The control's arms now pin
  the dark palette (`__RAW_DISABLE_WIND_DARK_CVD__`, CONTROL_VARIANTS). PASS on dev and on the merge.
- **Colour-blind check:** one RED line, the light tint over water at 47-55 kn (tritan 2.7). That is #292's own
  documented exception for the owner (L-V15), not a regression.

### Forensic battery (merged tree, eaa02aaf + defaults)
- **Null controls:**
  - z<=6 identical between new and kill, every theme and every column, on both instruments and both strengths.
  - The field-only columns are identical at every zoom: the lever touches only the marks.
- **Positive control:** with the kills on, the flood reappears exactly (synthetic light 0.58-0.64, beach 0.37-0.40,
  dark 0.31-0.35), so the instrument is not blind.
- **Jacobian at z8, kill -> new:**

  | | parts | contrast per marked pixel |
  |---|---|---|
  | light | 0.64 -> 0.45 | 15.7 -> 15.5 |
  | beach | 0.40 -> 0.28 | 13.2 -> 13.9 |
  | dark | 0.35 -> 0.28 | 19.3 -> 18.5 |

  Monotone, no inversions.
- **No cliff:** synthetic light z5.5-7.5 reads 0.38/0.40/0.44/0.42/0.43, against 0.38/0.40/0.50/0.58/0.63 before.
- **Real map, storm, land pLoss z7-11, kill -> new:**
  - light 0.29/0.25/0.19/0.26/0.24 -> 0.21/0.17/0.13/0.17/0.16 (z6 0.23)
  - beach 0.18/0.19/0.17/0.18/0.20 -> 0.13/0.13/0.12/0.13/0.14 (z6 0.12)
  - dark 0.20/0.20/0.16/0.15/0.18 -> 0.16/0.15/0.12/0.11/0.14 (z6 0.20)

  Dark's WCAG 3:1 kept rises about 6 points at every close zoom (z9 0.63 -> 0.69).
- **Real map, served:** the same direction and size (light z9 0.11 -> 0.06, beach 0.10 -> 0.06, dark 0.10 -> 0.07).
- **Eye bench (merged tree):** both controls PASS. Particle eye/wall at z6 -> 6.5 is 1.24 -> 1.91 (the pre-existing
  L-V13 step). dev's run is below.
- **Other checks:**
  - Jest, both trees: 287 suites pass.
  - The ESLint ratchet is clean.
  - `craco build` compiles. `npm run build` cannot run on Windows (NODE_OPTIONS syntax), so it was run through bash.
  - The palette checker shows 0 red normal-vision lines.
- **Cost, stated plainly:** thinner marks lay less trail ink. Dark close-zoom ink is 124-134, against 151-158 on dev
  (owner-approved ~150). Count is unchanged. The lever lets the owner try a milder dark setting:
  `__RAW_WIND_CLOSE_THIN__ = 1.25`.
