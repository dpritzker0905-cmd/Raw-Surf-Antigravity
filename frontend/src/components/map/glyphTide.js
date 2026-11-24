/**
 * glyphTide.js - ONE tide per spot glyph (SOTA-GAP inspection 2026-11-23, finding 9; ONE FORECAST COMPOSITION).
 * DARK (D-001): build flag REACT_APP_GLYPH_TIDE_OWN=true, default off; window.__RAW_DISABLE_GLYPH_TIDE_OWN__ = true only disables.
 *
 * Before: a rated spot glyph's hover card (and its accessible name) read the baked `rating.tide` (our table at the RATING frame's
 * time, nearest hourly sample) or, without it, tideClient's Open-Meteo `sea_level_height_msl` fetched from the browser and read
 * at WALL-CLOCK now. The Tide overlay marker drawn under the same glyph reads our own /point-tide payload at the SCRUBBED instant.
 * Two tides on one glyph, and the fallback put Open-Meteo in user data (the owner, 2026-11-18: none).
 *
 * After (flag on): the card's tide IS the marker's: the same payload (usePointTide's one cache and loader), the same tideAt and
 * height format (tideOverlayModel.tideMarkerModel), the same instant (forecastSelectionMs(timeOffsetHours)). No payload, or an
 * instant outside its modeled coverage: no tide line (the marker says "No tide for this time"). The baked tide still shapes the
 * score server-side; it is not shown. Hover / focus asks the shared loader, never Open-Meteo.
 */
import { loadPointTide, peekPointTide } from './usePointTide';
import { tideCellKey } from './tideClient';
import { tideMarkerModel } from './tideOverlayModel';
import { forecastSelectionMs } from './forecastReadout';

export function glyphTideOwnEnabled() {
  return process.env.REACT_APP_GLYPH_TIDE_OWN === 'true'
    && !(typeof window !== 'undefined' && window.__RAW_DISABLE_GLYPH_TIDE_OWN__ === true);
}

/** The tide overlay marker's model for this spot at the scrubbed hour, or null (not loaded, unavailable, outside coverage). */
export function glyphTideModel(lat, lng, timeOffsetHours, unit, name) {
  const payload = peekPointTide(tideCellKey(lat, lng));
  if (!payload) return null;
  const m = tideMarkerModel(payload, forecastSelectionMs(timeOffsetHours), unit, name);
  return m.available ? m : null;
}

/** The card's line, in the marker's own words: "0.6 m rising" (height exactly as the marker prints it). */
export function glyphTideLine(model) {
  return model ? `${model.heightText} ${String(model.trendWord || '').toLowerCase()}`.trim() : null;
}

/** Hover / focus: load the cell through the ONE shared loader (deduped, cached); `then` re-renders the card. */
export function requestGlyphTide(lat, lng) {
  return loadPointTide(tideCellKey(lat, lng));
}
