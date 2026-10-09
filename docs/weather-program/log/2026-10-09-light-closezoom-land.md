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
