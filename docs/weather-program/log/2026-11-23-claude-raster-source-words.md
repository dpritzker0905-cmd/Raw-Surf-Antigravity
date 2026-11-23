# 2026-11-23 (claude, infobox-honesty session): a raster says which model it draws (SOTA-GAP pass 13)

Branch `claude/raster-source-words` from dev ce871fc90. Started by the lead (local_d6b521eb) from the approved inspection's
pass 13. **Display only: no served number changes**, so it ships ON with a kill switch:
`window.__RAW_DISABLE_RASTER_SOURCE_WORDS__ = true`.

## Ask

- **The lead, 2026-11-23:** "With EURO or ICON selected, the Fog layer draws GFS data (Open-Meteo ncep_gfs025 visibility;
  window.__RASTER_DRAWN__.shown.model = "GFS"), and nothing says so."
- **The fix asked for:**
  - the same honest status line as Cloud on ICON, generic, driven by the drawn model against the selected one;
  - all three themes and all layouts;
  - ARIA-readable;
  - if cheap, a label for ICON Water Temp as the Copernicus Marine ocean field.
- **Correction to the ask** (the lead then asked for the grid to be read, not trusted). The ask said 1/16°; the
  inspection said "at 1.6 degrees". The PUBLISHED set says neither.
  - Read 2026-11-23 from the public frame CDN: `v1/latest.json` gives `CMEMS/marine/water_temp/global_1p6`, and its index
    `20261123T000000Z-ed96dfa81b65.json` gives a grid of 2160 x 1021, from west -180 to east 179.8333 and south -80 to
    north 90. The spacing is exactly 0.16667 degrees = **1/6°**, in both directions.
  - `common_meta.source_dataset` agrees: "every second 1/12-degree cell (1/6 degree)".
  - The line does not hard-code it. `useOwnRasterFrames` stamps the DRAWN field's own longitude spacing on the shown
    record (`gridDeg`, from the decoded grid the GPU gets), and `gridWords` prints it (1/6°, 1/12°, or the decimal). A
    frame with no grid prints no grid words.

## Read in the code

- `rasterDrawnFrame.describeRasterFrame` builds every raster status line. It is rendered by `ForecastTimeStatus`, which
  `MapWeatherControls.renderTimeline` mounts in the desktop panel and in both phone layouts.
- When the frame on screen is the one asked for, it said nothing unless the frame was estimated, nearest or reduced.
- Fog's .om slot is pinned to `ncep_gfs025` on every model (LayerRegistry), so its asked and shown frames agree, both
  GFS, under a EURO or ICON button.

## What changed

- `describeRasterSource(shown, layer, selectedModel)`, called after the pending and estimated checks.
  - When the DRAWN frame's model family (the record's model before any `+`/`:`, else the own-frame path's folder) is one
    of GFS/EURO/ICON and differs from the pressed button, the line reads "EURO fog unavailable: NOAA GFS shown", in the
    warning tone (`state: 'standin'`).
  - Ocean products (Copernicus, RTOFS, GIOPS) are other quantities, not stand-ins. Radar is excluded.
  - ICON water temp on the Copernicus set gets a quiet line: "Water Temp: Copernicus Marine ocean model, top layer, 1/6°
    grid".
- `ForecastTimeStatus` passes the selected model.
  - A stand-in line waits the same `PENDING_QUIET_MS` as a pending one, so the in-between render of a model switch
    (new button, old record) never flashes one.
  - The warning tone covers `standin`. The pinned `pending || held` expression in `drawnFrameHeld.test.js` stays as it
    was.
- **The COLLAPSED phone header.** A real-browser probe found the status line in the DOM, but under the bottom nav:
  `elementFromPoint` not on it, at y=802 of 844 (the drawer's collapsed body). This is true for every raster status
  line there.
  - `StaleLayerChip.readStaleChip`, the chip that already shows on the collapsed header, now also says the stand-in: the
    same words, from the same reader (`describeRasterSource`).
  - It has an info icon, its accessible name is the sentence, and a tap opens the drawer. The kill is the line's own.
- **Panel.** SubQ and Reflection both said:
  - trigger on the DRAWN model against the selected one (the request already carries the stand-in, so comparing it would
    hide the mismatch);
  - soften "No EURO fog forecast" to "EURO fog unavailable: NOAA GFS shown";
  - guard the switch mid-load. All three were taken. LongCat is down, per the lead.

## Measured / tests

- **`rasterSourceWords.test.js` (13 tests):**
  - Fog on EURO and on ICON give the exact words; GFS, or no model given, gives nothing;
  - generic water temp on ICON falling back to GFS; EURO rain on EURO says nothing;
  - the ICON Copernicus source line with 1/6°;
  - no false line for currents (RTOFS), radar, an estimated gap fill (its own words win) or a load in progress;
  - the model-family parser, and the kill switch;
  - the rendered status line: `role=status`, `aria-live=polite`, `data-drawn-state="standin"`, the warning tone in
    light (amber-800), dark and beach (amber-200), and nothing before the quiet time;
  - a model switch with the old record for half the quiet time never prints a stand-in;
  - the ICON water temp line in the quiet tone.
- `rasterSourceWords.test.js` also renders the collapsed header (14 tests in all): the chip's words, `data-stale-chip=
  "source"`, a tap opening the drawer, nothing on GFS, and the kill.
- **Real browser, 20:44-20:52Z.**
  - Setup: a local production build of this branch, the API stubbed locally (ab_lib; host audit "ok"; no request to our
    backend), and the public Open-Meteo fog tiles as the inspection read them. View z3 North Atlantic, after 10 s.

  | selected | theme / viewport | drawn (`__RASTER_DRAWN__`) | the line (`role=status`, `aria-live=polite`) |
  |---|---|---|---|
  | EURO | dark / desktop | GFS | "EURO fog unavailable: NOAA GFS shown", `text-amber-200`, on top |
  | ICON | light / desktop | GFS | "ICON fog unavailable: NOAA GFS shown", `text-amber-800` |
  | EURO | beach / phone 390 px | GFS | the same words, but under the bottom nav (collapsed): hence the chip above |
  | GFS | dark / desktop | GFS | no line |

  On the final build (with the chip), 21:01-21:05Z:

  | selected | theme / layout | what shows on top |
  |---|---|---|
  | EURO | beach / phone, collapsed | the chip "ⓘ EURO fog unavailable: NOAA GFS shown" (`data-stale-chip="source"`, on top at y=716); the line itself is still under the nav |
  | ICON | light / phone, collapsed | the chip "ICON fog unavailable: NOAA GFS shown", on top |
  | EURO | beach / phone, expanded | the line, on top (y=726 of 844); the chip goes with the collapsed header |
  | ICON | dark / phone, expanded | the line, on top |
  | EURO | dark / desktop | the line, on top (the phone chip is not drawn) |
  | GFS | dark / phone, collapsed | no chip, no line |

- **Jest, the whole tree, twice on the final code (runs 5 and 6):**
  - `src/components/map` 505 suites / 7227 tests and `src/tests` 37 / 371, 0 failures in both.
  - Run 6: 749 of 749 suites, 9881 of 9881 tests.
  - Run 5: one failure in `components/admin/AdminSupportDashboard.pagination.test.js` (a 5 s timeout under load, a
    different test of that suite than run 3's). The suite passes alone (21/21) and in run 6.
  - The production build passes. `check_eslint.js`: no rule over its baseline. `loc_ratchet.py`: 0 new. An earlier pair of runs, before the chip, caught a source-text pin on the tone expression, now kept intact.
  The first of those runs also showed the known local Git Bash spawn timeout (`netlifyIconStoredTailScope`).

No SCOREBOARD row: no served number changes.

## Part 2: the advisor's hold on #1246 (composed, not replaced)

- **The hold (relayed by the lead).** `describeRasterFrame` returned the source line BEFORE the nearest-forecast and
  drawnFactor checks. ICON water temp (CMEMS, a source line on every frame) and any stand-in could therefore no longer
  show "Showing <time>: the nearest stored forecast" or "drawn at 1/N detail", which showed before the PR.
- **The fix.** The nearest / reduced / gust line is computed as before, and the source text is JOINED to it
  ("<base> · <source>", the withWindow pattern).
  - A stand-in sets the state, so it keeps the warning tone and the quiet wait.
  - A quiet source line keeps the base line's state.
  - With no base line, the source line stands alone, as before.
- **Tests.** `rasterSourceWords.test.js` gains three (17 in all): a stand-in at a nearest hour, a CMEMS frame at a
  nearest hour, and a CMEMS frame drawn at reduced detail. Each shows both lines, and each fails on the held code. The
  floor fragment is now +1 suite / +17 tests.
- **Tested twice on the fix (runs 7 and 8, the whole tree):**
  - `src/components/map` 506 suites / 7243 tests and `src/tests` 37 / 371: 0 failures in both runs.
  - The other failures were admin paging suites (`AdminSupportDashboard.pagination`, `AdminSpotPaging`), timing out
    under the full-tree load, with different tests each run. They are outside this diff and pass alone (35/35).
  - The production build passes. `check_eslint.js`: no rule over its baseline.
