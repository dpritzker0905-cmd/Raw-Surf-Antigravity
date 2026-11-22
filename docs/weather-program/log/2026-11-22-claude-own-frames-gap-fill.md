# 2026-11-22: own-frames gap fill for ICON air temp, ICON rain and EURO / ICON cloud (supersedes #1071, #1075, #1078)

Session: `claude/own-frames-gap-fill` (started by the director's session). One PR to `dev`, client only, no served number.

## The task and the ruling
- Rebuild the three held drafts (#1071 ICON air temperature 0.125°, #1075 ICON rain 0.125°, #1078 EURO cloud) on current `dev`.
- David's ruling on #1071, relayed by the director: where our own frames have gaps, do NOT leave blanks and do NOT fall back to
  Open-Meteo; fill with the clearly labelled ICON prediction, so the user always sees a value and knows its source.
- The advisor's holds this answers (ADVISOR-MERGE-GATE, 2026-11-19 00:57Z): #1075 blank for 180-336 h by default (the GFS
  stand-in never loaded without the lever); #1071 credit said Open-Meteo when idle, and one failed index read latched
  "unavailable" for the session; #1078 stacked on both. The alignment audit row 3: ICON temp blank past 180 h, EURO cloud past 240 h.

## Design (written in the PR description too)
**What counts as a gap:** any hour of the 14-day scrubber with no frame of the picked model's own set within the 3-hour pick
window. Three kinds: RANGE (past ICON 180 h / EURO 240 h), HOLE (a step the index does not list), SET (no index: unpublished,
per-set kill, or a failed read; the retry from #1071 keeps asking every 60 s).

**What fills it, in order** (`frontend/src/components/map/ownRasterGapFill.js`):
1. The same model's coarser own set where one exists: ICON air temperature's 0.5° set when the 0.125° set is missing whole.
2. The model-anchored prediction (air temperature and cloud): `GFS(t) + w(t) * (MODEL(t0) - GFS(t0))`, `t0` = the model's
   last own frame at or before the hour AT THE SAME UTC HOUR OF DAY (the advisor's hold on #1136 at `03d7f3b5f`: the 2 m
   temperature difference has a strong daily cycle over land, so a 15Z offset carried to 03Z can be off by several degrees),
   `w` falling linearly from 1 to 0 over 120 h from the model's last own frame (the seam). It is GFS five days on. The decay is
   a labelled bridge and a design choice, justified only by analogy; it is not shown to be skilful (unscored). This is the decaying-average bias handover of NOAA's National Blend of Models and
   the 14-day contract's own ICON marine rule ("ICON@168 + GFS@168 anchor trend-extrapolation, persistence -> GFS weight
   shift over 5 days"). Computed on the GFS frame's grid; a finer model anchor is box-averaged onto it. Cloud clamped 0-100 %.
3. A plain NOAA GFS stand-in where there is no anchor: a whole set missing, rain (never offset: adding rain where GFS has
   none is not a forecast), or past five days from the anchor.
4. Only when GFS has nothing for the hour either: "unavailable". Never Open-Meteo, under any kill.

Not built here: the "Raw Surf prediction" (research lead's pre-registration 2026-11-19, frame-carry lane). It plugs in as one
more strategy past the horizon when its sets publish, and has to pass its own gate. The anchored offset is the bridge until then.

**Which layer gets what:**

| Layer, model | Own set | Gap fill |
|---|---|---|
| Air temp, ICON | `ICON/weather/temperature/global_0p125` (f000-f180) | 0.5° ICON set (whole-set miss), then ICON-anchored GFS, then GFS |
| Rain, ICON | `ICON/weather/precipitation/global_0p125` (f000-f180) | GFS rain, labelled (loaded without the lever: the #1075 hold) |
| Cloud, EURO | `EURO/weather/cloud_cover/global_0p25` (f000-f240) | EURO-anchored GFS (clamped), then GFS |
| Cloud, ICON | none yet | GFS cloud, labelled "no ICON frame for this hour, NOAA GFS shown" |
| Cloud, GFS | `GFS/weather/cloud_cover/global_0p25` | none (it is the fill); own-only, no .om |

**How the label shows (all three themes, desktop and phone):**
- The status line under the timeline (`ForecastTimeStatus`, rendered in all three MapWeatherControls layouts): "Estimated
  forecast: ICON prediction: NOAA GFS trend anchored to ICON's last frame" / "... no ICON frame for this hour, NOAA GFS shown" /
  "... ICON's own 0.5° frames (its 0.125° frames are missing)" / "... GFS stand-in beyond this model's range". `role="status"`,
  `aria-live="polite"`, `data-gap-fill="on"`, in the held line's warning tone (amber-800 on light, amber-200 on dark and on the
  beach panel's black/90): words first, the tone only adds. Pinned per theme in `rasterDrawnFrame.test.js`.
- The legend credit (`LayerDataCredit`, in all three legend layouts): every source in the field, and that it is an estimate,
  e.g. "ICON · Datenbasis: Deutscher Wetterdienst + NOAA GFS · ICON prediction" (ECMWF's CC BY credit for a EURO prediction),
  "NOAA GFS · stand-in for ICON". The accessible name is the full sentence. Never "© Open-Meteo".

**Kill switches:**
- `window.__RAW_DISABLE_RASTER_OWN_GAP_FILL__ = true`: no fill; gaps say "unavailable" (the drafts' behaviour). Never .om.
- The drafts' own: `__RAW_DISABLE_RASTER_OWN_TEMPERATURE__`, `_RAIN__`, `_SATELLITE__`, the own-frames global, per-set and
  static-frames global kills (each: "unavailable", never .om), and `__RAW_DISABLE_RASTER_OWN_RETRY__` (the latch).

## Where the code sits
- `ownRasterGapFill.js` (new, pure): `gapFillFrames`, `gapFillFrameAt`, `anchoredField`, `sampleBox`, the kill.
- `ownRasterFrames.js`: `gapFill` per set and model; `gapFillFor`, `gapFillIndex` (reads the fill / coarse index whether or not
  that set is on by default; the kills still apply); `combinedFrames` / `combinedFrameAt` route to it; `loadField` composes an
  anchored frame from three loads; the two anchors are pinned outside the window LRU (at most 4 fields).
- `useOwnRasterFrames.js`: engages on the fill when the own set is missing; tries the coarse set first; the credit reports
  `'<MODELS>:fill:<PICKED>'`; the records carry `fill` / `coarse` for the status line.
- `LayerDataCredit.js` (`fillCredit`), `drawnFrameReadout.js` (five new basis words), `rasterDrawnFrame.js`, `ForecastTimeStatus.js`.

## Not done / owed
- Not looked at in a browser: no published ICON 0.125 / EURO cloud frames could be exercised locally against the live CDN
  without a load on the shared box; the parity reads are the drafts' (G1 temp, G2 rain, G3 cloud). Post-deploy check on dev:
  ICON + Air Temp, scrub past day 7.5, read the status line and the credit; the network panel must show no `openmeteo` request.
- The anchored prediction is unscored. It is the house's existing marine rule applied to rasters; the Raw Surf prediction's
  gate (research lead, 2026-11-19) is where skill gets measured.
- Owner's call to confirm: a GFS stand-in for ICON cloud (no ICON cloud set) and for ICON rain past 180 h. David's 2026-11-15
  word on gusts was "no GFS past 7.5 days, a scientific estimate"; these are labelled and can be killed, but the wording
  "ICON prediction" is reserved here for the anchored field, not a plain GFS frame.

## 2026-11-22 later: the advisor's HOLD at `03d7f3b5f` and the fixes
- Same-phase anchor (above), with a test where the ICON - GFS difference flips sign between day (12Z) and night (00Z).
- SCOREBOARD row added: the move from .om to own frames (G1-G3 parity reads cited) and the new past-horizon values, unscored.
- Pending wording: a loading anchored frame reads "Loading ICON prediction Air Temp...", never "ICON+GFS" (seen in the browser look).
- Browser look (local dev build, backend at a dead port, frames from the public bucket): shots and notes in the shared notes folder `PR1136-seam-shots-2026-11-22/`. The seam's drop to GFS's 0.5-degree grid is visible; the desktop legend truncates the long credit; the phone's collapsed sheet does not show the status line (as for every raster line today).
