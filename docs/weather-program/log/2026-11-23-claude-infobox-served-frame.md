# 2026-11-23 (claude, infobox-honesty session): one tide per glyph, and an infobox that reads the frame the map draws

Branch `claude/infobox-served-frame` from dev 0cc5cf586. Started by the lead (local_d6b521eb) from the SOTA-GAP inspection
(2026-11-23, side notes `SOTA-GAP-INSPECTION-2026-11-23.md`), findings 9 and 10. Client only. **Both move numbers the
infobox or a glyph shows, so both ship DARK (D-001)**:
- `REACT_APP_GLYPH_TIDE_OWN=true` (finding 9), kill `window.__RAW_DISABLE_GLYPH_TIDE_OWN__ = true`;
- `REACT_APP_INFOBOX_OWN_FRAME=true` (finding 10), kill `window.__RAW_DISABLE_INFOBOX_OWN_FRAME__ = true`.

Each build flag defaults off. Each runtime switch can only turn its flag off. Flipping is the owner's word.

## Ask

- **The lead, 2026-11-23:**
  - (9) "Two different tides on one spot glyph ... They must agree, using our own table at the scrubbed hour."
  - (10) "Make the infobox read the same served frame the map draws (same model, same hour), and add gust and current
    values."
  - "Put the design to SubQ, Reflection and LongCat; test twice; send me the head."

## Design and panel

The design is in the side notes, `infobox-served-frame-design-2026-11-23.md`. All three reviewers answered the four
questions the same way:
- the SHOWN frame's decoded field, mirrored on the CPU, is the single source (not a backend `/point` lane per raster
  layer);
- drop the baked `rating.tide` from the glyph's display;
- use two flags.

Taken from their extra points:
- an engaged layer with no value says "No data here" / "Unavailable" and never falls back to another source (SubQ);
- the card names the frame's own time when it is not the wheel's (SubQ);
- the parity tests cover the antimeridian wrap and the no-data corners (all three).

Not taken (follow-ups below): a GPU readback test, and logging baked-vs-overlay tide disagreement.

## What was wrong, read in the code

- **9. The glyph's hover card and accessible name** (`MapMarkerLayers.js`) read one of two tides:
  - the baked `rating.tide` (our table, at the RATING frame's time, nearest hourly sample);
  - otherwise `tideClient`'s browser Open-Meteo `sea_level_height_msl`, read at wall-clock now.

  The Tide overlay marker under the same glyph reads `/point-tide` with `tideAt` at the scrubbed instant.
- **10. The infobox's raster readings.**
  - When our own frames draw a layer there is no .om slot. `decodedOmSampler` then kept the NEWEST decoded Open-Meteo
    tile of any model and hour (or nothing).
  - Air temperature read the point forecast while the map drew it terrain-adjusted.
  - Gusts and currents had no infobox branch at all.

## What changed

- **`glyphTide.js` (9).** With the flag on, the glyph's tide line is `tideMarkerModel(peekPointTide(cell),
  forecastSelectionMs(hour))`: the marker's own model, payload, height format and instant.
  - Hover and focus go through the shared `/point-tide` loader. There is no Open-Meteo fetch, and `rating.tide` is not
    displayed.
  - `MapMarkerLayers` takes `timeOffsetHours`. Its memo (`sameMarkerProps`) ignores the hour outside Surf Rating mode,
    so a scrub step never re-renders the markers there.
- **`ownFrameReadout.js` (10).** `useOwnRasterFrames` records the exact field the GPU is given at each cut
  (`noteShownFrame`).
  - `fieldValueAt` samples it as `ownRasterLayer.FS` does: cell-centre lattice, bilinear, integer wrap on full-circle
    grids, any corner below -9000 = no data. Air temperature adds `lapse * downscaleAt(...)`; `setDownscaled` now
    carries the asset.
  - `ownFrameCards` builds the layer's cards for pressure, air temp, cloud, rain, fog, water temp, gusts and currents.
    Gusts are in knots and carry the gust window ("Peak gust, max over 6 h (ECMWF)"). Currents are in knots, with a
    "to NE" direction card in words.
  - `forecastCardCompiler` lets those cards replace the layer's old ones.
  - With the flag on, `decodedOmSampler` keeps only the exact slot on screen.
- **Guards.**
  - Both kill switches are registered as TESTED (`killSwitch.inventory.test.js`).
  - `glyphTide.js` is listed as pure (`blindQualityScreens.proof.test.js`).
  - Floor fragment: +2 suites / +28 tests.

## Measured (offline only; no live load)

### 1. Jest (pass 1 and pass 2: two separate whole-tree runs)

- `glyphTide.test.js` (10 tests). The glyph's accessible name and card text equal the marker's model at hours 0, 3, 7,
  18 and 30, never the baked tide. Also pinned:
  - two hours give two tides;
  - hover asks `/point-tide` and never Open-Meteo;
  - past coverage there is no line;
  - the kill switch and flag off show the old line;
  - the memo.
- `ownFrameReadout.test.js` (18 tests). Pinned:
  - exact on a plane;
  - the antimeridian wrap both ways;
  - regional discard and latitude clamp;
  - MISSING / NaN corners;
  - dz;
  - "Loading", "Unavailable" and "No data here";
  - every layer's units, words and accessible name;
  - the gust window, current direction and other-hour note;
  - the compiler replacing cards;
  - the strict .om sampler.

### 2. Offline browser harness, `scn_infobox_own_frame.js` (new)

**Setup.**
- Builds: A (flags off; map chunk 6161.1e0dd887) vs B (both flags on; 6161.3fef0750). Both have
  `REACT_APP_ICON_STORED_TAIL=true`.
- Data: our GFS pressure frames from the fixture CDN (`own_frames_fixture.js`, run 2026-11-23 06Z).
- Network: every `/api/weather` ask got a local 404, Open-Meteo hosts were aborted, and the host audit reads "ok" with
  no live request.
- Check: the card is compared with the SHOWN frame decoded in Node from the fixture bytes.
- Measured 13:52-13:54Z, dark desktop.

| point | hour | frame on screen | frame value at point | before (A) card | after (B) card |
|---|---|---|---|---|---|
| 18N 70W (tropical low) | 0 | f009 | 999.7 hPa | `--` | 1000 hPa |
| 18N 70W | 9 | f018 | 1007.4 | `--` | 1007 |
| 18N 70W | 24 | f033 | 1011.9 | `--` | 1012 |
| 52N 40W (subpolar low) | 0 / 9 / 24 | f009 / f018 / f033 | 986.1 / 991.1 / 1002.2 | `--` | 986 / 991 / 1002 |
| 28N 40W (subtropical high) | 0 / 9 / 24 | f009 / f018 / f033 | 1027.0 / 1028.3 / 1030.9 | `--` | 1027 / 1028 / 1031 |

- **Result:** before 0 of 9 rows match (no card value while the map draws our frame); after 9 of 9 match.
- **Other themes and viewports:** light desktop, and beach and light phone (rebuilt B2 with the shorter note,
  13:56-13:58Z) match too. Phone shots show "1000 hPa · at 10 AM" on one line.
- **The note:** the frame on screen was the nearest 3-hourly step (f009 = 10 AM EST for a 9 AM wheel), so the card says
  "at 10 AM". Before the note was shortened, a phone truncated "at Mon 10 …".

### Not measured in the browser

- **The glyph tide** (no offline spot ratings: a glyph is rated only through the CDN / entitlement path). Jest renders
  the real `MapMarkerLayers` with the real loader instead.
- **Gusts and currents in a browser:** there is no fixture for their sets. The card math is the same function, pinned
  in Jest.
- **The "stale .om tile" half of finding 10:** the .om path is blocked offline.
- **A GPU readback:** the CPU mirror is pinned against the shader's documented math, not its pixels.

### Tests run

- Jest, the whole `src` tree, twice:
  - pass 1: 747 of 749 suites. The 2 failures were the inventory guards, fixed.
  - pass 2: 749 of 749 suites, 9891 of 9891 tests, including `src/components/map` (505 suites / 7237 tests) and
    `src/tests` (37 / 371).
- `check_eslint.js`: no rule over its baseline.
- `loc_ratchet.py`: 0 new, 0 regressed.
  - `MapForecastOverlay.js` is 799 lines; `MapWebGL.js` is unchanged in size (the prop rides an existing line).

## Overlap

Open PR #1149 (`claude/tide-mllw-us`, ships ON) also edits `MapMarkerLayers.js` and `tideClient.js`:
- it removes the browser Open-Meteo fallback (D-082);
- it keeps the baked `rating.tide`, which still differs from the marker in time and source.

Whichever PR merges second takes a small rebase in `MapMarkerLayers.js`. The flag-on path here is unchanged by #1149:
it reads the marker's model, so MLLW follows automatically.

## Not done here (follow-ups)

- The wind card's gust (a bias-adjusted point value with no window label; the gust map draws the raw frame).
- The Open-Meteo .om layers still drawn for some (layer, model) pairs (the licence lane).
- A GPU readback parity test.
- Offline gust / current fixture sets.
- A browser read of the glyph tide on real data.
