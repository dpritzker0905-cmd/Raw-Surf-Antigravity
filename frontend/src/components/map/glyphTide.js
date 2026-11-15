/**
 * glyphTide.js - the rating glyph card's tide FALLBACK, through the one door (TIDE_HARMONIC plan, 2026-11-15).
 * Before: tideClient.ensureTideState fetched Open-Meteo straight from the browser and took the NEAREST sample at NOW,
 * a second tide that could disagree with the infobox. Now it reads the same /api/weather/point-tide cache
 * (usePointTide.loadPointTide) and the same evaluator (tideAt), so the card, the infobox and the Tides overlay read one
 * source (NOAA where a station is near, else the model). It stays at NOW: the card shows the rating's own hour when the
 * rating payload carries tide, and only falls back here when it does not.
 * Kill switch (unchanged): window.__RAW_DISABLE_TIDE_FALLBACK__.
 */
import { tideCellKey } from './tideClient';
import { loadPointTide, peekPointTide } from './usePointTide';
import { tideAt } from './tideReadoutFormat';

/** Synchronous: undefined = never fetched / expired, null = no tide, else {height_m, trend, ...} at atMs. */
export function getGlyphTide(lat, lng, atMs = Date.now()) {
  const payload = peekPointTide(tideCellKey(Number(lat), Number(lng)));
  if (payload === undefined) return undefined;
  return payload ? tideAt(payload, atMs) : null;
}

/** Fetch (or join) the cell's /point-tide payload. Never rejects. */
export function ensureGlyphTide(lat, lng) {
  return loadPointTide(tideCellKey(Number(lat), Number(lng)));
}
