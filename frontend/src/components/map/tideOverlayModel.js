/**
 * tideOverlayModel.js - PURE model for the map Tide overlay (marine add-on, owner-approved 2026-11-15).
 *
 * ONE SOURCE OF TRUTH: the overlay is an UPGRADE of the infobox tide, not a second tide. It reads the SAME
 * /api/weather/point-tide payload (usePointTide's cache, keyed by tideClient.tideCellKey) and evaluates it with
 * the SAME tideAt() at the SAME instant (forecastReadout.forecastSelectionMs(timeOffsetHours), the instant the
 * infobox's TideReadout receives as atTime). tideOverlay.parity.test.js pins marker == infobox at several hours.
 *
 * The data is MODELED sea level (Open-Meteo, MSL, ~0.1 degree cells). There are no tide stations behind it, so the
 * overlay draws one marker per tide CELL, anchored at the first visible surf spot in that cell, never a station pin
 * that would imply a gauge. Cells are capped (MAX_TIDE_CELLS) and fetched on view change only: the hour never
 * enters a fetch, so scrubbing costs zero backend requests.
 *
 * Kill switch: window.__RAW_DISABLE_TIDE_OVERLAY__ = true (no toggle, no markers, no fetch).
 */
import { tideCellKey } from './tideClient';
import { tideAt, trendWord, trendGlyph, formatTideHeight } from './tideReadoutFormat';

export const TIDE_OVERLAY_EVENT = 'rawsurf:tide-overlay-toggle';
export const TIDE_OVERLAY_STORAGE_KEY = '__TIDE_OVERLAY__';
export const MAX_TIDE_CELLS = 12;
const MINUTE_MS = 60 * 1000;

export function tideOverlayDisabled() {
  return typeof window !== 'undefined' && window.__RAW_DISABLE_TIDE_OVERLAY__ === true;
}

/**
 * Persisted user choice; ships ON. Independent of Surf Rating (owner 2026-11-15: both may be on; the tide label sits
 * under the spot glyph, the rating colours the glyph and the coastal band).
 */
export function getTideOverlayFlag() {
  if (typeof window === 'undefined' || tideOverlayDisabled()) return false;
  try {
    const v = window.localStorage.getItem(TIDE_OVERLAY_STORAGE_KEY);
    return v == null ? true : v === 'true';
  } catch (e) { return true; }
}

export function setTideOverlayFlag(on) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(TIDE_OVERLAY_STORAGE_KEY, on ? 'true' : 'false'); } catch (e) { /* private mode */ }
  window.dispatchEvent(new CustomEvent(TIDE_OVERLAY_EVENT, { detail: { on: !!on } }));
}

/**
 * PURE: the tide cells to draw for the visible (UNCLUSTERED) spots: one entry per tide cell, anchored at the first
 * spot in it, nearest `center` ([lng, lat]) first, at most `max`. Clustered bubbles never get a tide marker: a
 * bubble spans many cells, so one tide number on it would be a lie.
 */
export function selectTideCells(spotClusters, center, max = MAX_TIDE_CELLS) {
  if (!Array.isArray(spotClusters)) return [];
  const byCell = new Map();
  for (const c of spotClusters) {
    if (!c || c.isCluster) continue;
    const lat = Number(c.latitude);
    const lng = Number(c.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const cell = tideCellKey(lat, lng);
    if (!byCell.has(cell)) byCell.set(cell, { cell, lat, lng, name: c.name || 'Surf spot', spotId: c.id });
  }
  const cells = [...byCell.values()];
  if (Array.isArray(center) && center.every(Number.isFinite)) {
    const [clng, clat] = center;
    const d2 = (e) => (e.lat - clat) ** 2 + ((e.lng - clng) * Math.cos((clat * Math.PI) / 180)) ** 2;
    cells.sort((a, b) => d2(a) - d2(b) || (a.cell < b.cell ? -1 : 1));
  }
  return cells.slice(0, Math.max(0, max));
}

/** "2h 10m", "45m", "Now" for a non-negative interval in ms. */
export function formatTimeUntil(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.round(ms / MINUTE_MS);
  if (mins < 1) return 'now';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** The turn the marker counts down to: the next high while rising, the next low while falling, else the sooner. */
function nextTurn(d) {
  const hi = d.next_high ? { kind: 'High', ...d.next_high } : null;
  const lo = d.next_low ? { kind: 'Low', ...d.next_low } : null;
  if (d.trend === 'rising') return hi || lo;
  if (d.trend === 'falling') return lo || hi;
  if (hi && lo) return Date.parse(hi.time) <= Date.parse(lo.time) ? hi : lo;
  return hi || lo;
}

/**
 * PURE: what one marker shows at `atMs`. `payload` is the /point-tide payload, unchanged; the evaluation IS the
 * infobox's (tideAt). Returns { available:false, text } outside the payload's coverage (the 14-day scrubber runs
 * past the ~3-day modeled series; the scrubber is never capped to it), else the full readout with a text label for
 * the trend (never arrow or colour alone).
 */
export function tideMarkerModel(payload, atMs, unit, name = 'Surf spot') {
  const d = payload ? tideAt(payload, atMs) : null;
  if (!d) {
    return { available: false, text: 'No tide for this time', ariaLabel: `Tide near ${name}: no modeled tide for the selected time` };
  }
  const height = formatTideHeight(d.height_m, unit);
  const word = trendWord(d.trend);
  const turn = nextTurn(d);
  const until = turn ? formatTimeUntil(Date.parse(turn.time) - atMs) : null;
  const nextText = turn && until ? `${turn.kind} in ${until}` : null;
  const turnHeight = turn ? formatTideHeight(turn.height_m, unit) : null;
  let ariaLabel = `Tide near ${name}: ${word.toLowerCase()}, ${height} at selected time`;
  if (nextText) ariaLabel += `, ${turn.kind.toLowerCase()} ${turnHeight} in ${until}`;
  return {
    available: true, height_m: d.height_m, trend: d.trend, heightText: height, trendWord: word,
    glyph: trendGlyph(d.trend), nextText, next: turn ? { kind: turn.kind, time: turn.time, height_m: turn.height_m } : null,
    ariaLabel,
  };
}
