# 2026-10-10 · Light's fast wind bands: A (steady descent) is the default field

Owner (14:21Z), after the A/B of three redesigns (#304) and this session's recommendation: "I like A too". Written 14:40Z.
Client only: no served number moves. No request of mine reached the live backend: every number below is Jest, the
palette checker, the offline wind bench (real engine and basemap on the GPU) or GitHub.

## What changed

- **Light's field tint from 6 to 75 kn is candidate A's rows** (`LIGHT_FIELD_RAMP`, `WindColorRamp.js`). 0 and 3 kn and
  every alpha are as they were. The legend, the particles (colour, density, speed, trails), beach and dark do not move.
- **Kill switch:** `window.__RAW_DISABLE_WIND_LIGHT_FASTBAND__ = true` restores the field before A, byte for byte. It is
  read at the next ramp build, so switch the theme away and back (a reload clears a console flag).
- **Each older light-field kill steps back past A first** (`__RAW_DISABLE_WIND_LIGHT_NEUTRAL_CVD__`, `..._LIGHT_CVD__`,
  `..._LIGHT_LOWBAND__`, `..._MIDBAND_REFINE__`), so it draws exactly the ramp it drew before A.
- **Gone:** the A/B lever `window.__RAW_WIND_LIGHT_FASTBAND__` and candidates B and C (their rows are in `541117de`).
  `WindColorRamp.js` 527 -> 507 lines.

## Built tests first

1. **The "before" came from the running code.** A scratch test on `dev` `9eccf149` wrote the default field, what the
   lever's `a` resolved to, and each older kill's ramp to a file. The new pins and the new rows were generated from that
   file, not typed.
2. **The pins were rewritten and watched fail** against the unchanged code: 6 of 16 in `windLightFastBand.test.js`
   (the default is not A, the lever is alive, the floor, the unmuted grounds, a chroma turn, the strength) and 5 in
   `windFieldLut.test.js` and `windPaletteCvd.test.js`.
3. **Then the rows moved.** The three suites: 52 of 52. CI's frontend command (`src/components/map src/tests`): 298
   suites, 3786 tests (3797 before: 29 candidate tests out, 16 + 1 + 1 in). Hosted CI's whole-frontend floor is
   377 suites / 4177 tests against 403 / 4680 on `dev` `8f44c7cd`.
4. **Seven deliberate breaks, each turns a pin red:** an older kill that no longer steps back (2 red), the kill firing
   on any truthy value (1), the kill never firing (6), one row of A left at the old field (6), a wrong row in the
   kill's table (5), the step back also running for beach (3), A's 75 kn row made darker (4).

## Which pins changed, and which did not

| pin | before | now |
|---|---|---|
| `windFieldLut`: light and beach carry dark's strength 6-75 kn within 1 dE76 | both themes | beach as before; light 6-21 kn as before; light 27-75 kn carries A's own measured strengths (33.2, 34.1, 33.2, 33.1, 41.1, 40.4, 43.8) within 1 |
| `windFieldLut`: the particle palette as the field is far too strong (positive control) | over 1.4x dark at 40-75 kn | over 1.3x light's own field and over 2x dark |
| `windPaletteCvd`: the tint over light's own cyan water is an accepted exception | clears 2.6 | clears 3.0 (3.04 at 10-16 kn); it shows only with the basemap mute killed |
| `windPaletteCvd`: the tint on the muted ground | 2.55 on water and land | 5 on water and land; the unmuted land 5 (was 2.5) |

- The old form of each re-scoped pin stays as a positive control behind the kill: the field before A sits within
  1 dE76 of dark in every band and reads 2.55-3 on the muted grounds.
- The fast-band log expected two kill controls to break (low band, neutral ground). They hold unchanged, because the
  older kills step back past A. One line of the neutral-ground control moved: it pinned the live 33 kn row.

## The palette checker (`node scripts/wind-color/check.mjs --theme light`, coloraide's models)

| line | before A | with A |
|---|---|---|
| colour-blind RED lines | 1 (tint over the muted water: 2.6 at 6-10 kn, deutan) | 0 (weakest 5.2 at 40-47 kn, tritan) |
| normal-vision RED lines | 0 | 0 |
| speeds whose tint the ground bends over 30 deg off the legend's hue | 1 kn (12.5-14 kn), a warning | none |
| watch item: the streak's colour core against its own tint, land | -1.0 L* at 10 kn | 0.0 L* at 12 kn |

The watch item is under its 3 L* line before and after: it is the open pale-marks item, not this change.

## What it costs on the real map (wind bench map mode, light, Mobile Bay, served GFS grid)

Share of each basemap line's own contrast that survives under the wind (field + particles), and share of the map's
3:1 lines that stay 3:1. Field before A -> A. `out/fastband-a-served.json`, `out/fastband-a-storm.json`.

**Everyday strength (the grid as served):**

| zoom | land: line contrast kept | land: lines still 3:1 | water: line contrast kept | water: lines still 3:1 |
|---|---|---|---|---|
| z6 | 0.692 -> 0.693 | 0.791 -> 0.791 | 0.785 -> 0.784 | 0.598 -> 0.597 |
| z7 | 0.704 -> 0.705 | 0.769 -> 0.768 | 0.755 -> 0.751 | 0.640 -> 0.633 |
| z8 | 0.709 -> 0.707 | 0.811 -> 0.807 | 0.757 -> 0.757 | 0.703 -> 0.701 |

**Storm strength (the grid x2.3, Mobile Bay median about 30 kn, the Gulf in the top bands):**

| zoom | land: line contrast kept | land: lines still 3:1 | water: line contrast kept | water: lines still 3:1 |
|---|---|---|---|---|
| z6 | 0.628 -> 0.628 | 0.777 -> 0.776 | 0.737 -> 0.723 | 0.554 -> 0.544 |
| z7 | 0.603 -> 0.590 | 0.739 -> 0.703 | 0.706 -> 0.632 | 0.535 -> 0.410 |
| z8 | 0.643 -> 0.630 | 0.795 -> 0.778 | 0.716 -> 0.649 | 0.658 -> 0.604 |

- At everyday strength nothing moves by more than 0.7 of a point.
- At storm strength the land keeps its line work within 1.3 points (lines still 3:1: down up to 3.6 points). Over the
  water, where the top bands sit, the map's lines lose up to 7.4 points of contrast and up to 12.5 points of their
  3:1 share (z7). That is the price of the darker storm tint. The owner picked A from the strength numbers and the
  stills, before this measurement existed: it is in the PR and in my reply for the owner to weigh.
- The particles stand out more over A's field: mean |dL*| they add over water 8.9 -> 10.2 (z6), 4.4 -> 5.6 (z7),
  5.0 -> 6.2 (z8) at everyday strength.
- I looked at the storm frames: the land bands read the same, the coast band is a clearer red, the Gulf a deeper violet.

## Limits

- **Not seen in the app with A as the default.** The owner judged A on the A/B page's 448 px stills; the rows are
  pinned equal to what that page drew. After the deploy the check is the owner's eyes in light theme, plus the kill.
- **Over light's own cyan water** (basemap mute killed) the weakest pair is 3.04, still under 5.
- The palette checker does not run in CI; `windPaletteCvd.test.js` and `windLightFastBand.test.js` carry its lines.
- The Canvas2D fallback (`WindParticleOverlay.js`) draws particles only; no field ramp reaches it.

## Also recorded here

- **#306's merge** (`9eccf149`, 14:15:13Z, the owner's "merge 306"). Three backend lanes were still re-running when
  I merged, on code identical to the head that had passed all 18. CI on `dev` for `9eccf149` (run 38058875265) has
  since completed green in every job.
- Decision D-018. LESSONS L-V25.
