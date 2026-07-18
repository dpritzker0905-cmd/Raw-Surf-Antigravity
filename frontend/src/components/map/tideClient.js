/**
 * tideClient.js — tide state + formatting for the spot rating card's tide line (2026-07-18).
 *
 * Tide display RIDES THE RATING TOGGLE (user decision 2026-07-18: no standalone Tides pill) —
 * Rating ON puts tide on the glyph cards, Rating OFF removes the cards entirely. The
 * AUTHORITATIVE tide rides the spot-ratings payload (backend RATING_TIDE lane, baked by the
 * ratings precompute and consistent with the scores it shaped). Until a payload carries it
 * (pre-bake, stale object, live-lane miss) the fallback here fetches the SAME Open-Meteo Marine
 * sea_level_height_msl series the backend's tide.py uses (global, free, no key, by lat/lng) and
 * derives {height_m, trend} for NOW — display-only, never feeds scores. Cached per ~0.1° cell
 * (~11 km, the backend's cache policy) for 3h with in-flight dedupe, so hovering every spot on a
 * coast costs at most one request per cell per session. Kill: window.__RAW_DISABLE_TIDE_FALLBACK__.
 */
import { formatHeightFromMeters } from './heightUnits';

const OPEN_METEO_MARINE_API = 'https://marine-api.open-meteo.com/v1/marine';
const TTL_OK_MS = 3 * 3600 * 1000;    // a tide series is stable for hours (backend parity)
const TTL_FAIL_MS = 10 * 60 * 1000;   // a failed fetch may be transient — retry sooner
const TREND_EPS_M = 0.02;             // backend tide_state_at's slack threshold

const cache = new Map();              // cellKey -> { ts, ok, state: {height_m, trend}|null }
const inflight = new Map();           // cellKey -> Promise<state|null>

/** ~0.1° cell key so nearby spots share one fetch (mirrors backend tide._round_key). */
export function tideCellKey(lat, lng) {
  return `${Math.round(lat * 10) / 10},${Math.round(lng * 10) / 10}`;
}

/**
 * PURE: tide state at `nowMs` from an hourly (times[], levels[]) series — nearest sample for the
 * height, trend from the delta to the next (else from the previous) sample, ±TREND_EPS_M slack
 * band (mirrors backend tide.tide_state_at). Times are GMT-naive ISO strings (we request
 * timezone=GMT). Returns {height_m, trend} or null when the series can't be used.
 */
export function tideStateFromSeries(times, levels, nowMs) {
  if (!Array.isArray(times) || !Array.isArray(levels) || times.length !== levels.length || !times.length) return null;
  let bestI = -1;
  let bestD = Infinity;
  const parsed = times.map((t) => {
    const ms = Date.parse(`${t}Z`.replace(/ZZ$/, 'Z'));
    return Number.isNaN(ms) ? null : ms;
  });
  for (let i = 0; i < parsed.length; i++) {
    if (parsed[i] == null || levels[i] == null) continue;
    const d = Math.abs(parsed[i] - nowMs);
    if (d < bestD) { bestD = d; bestI = i; }
  }
  if (bestI < 0) return null;
  const height = levels[bestI];
  let trend = 'slack';
  let next = null;
  for (let j = bestI + 1; j < levels.length; j++) if (levels[j] != null) { next = levels[j]; break; }
  let prev = null;
  for (let j = bestI - 1; j >= 0; j--) if (levels[j] != null) { prev = levels[j]; break; }
  const delta = next != null ? next - height : (prev != null ? height - prev : null);
  if (delta != null) {
    if (delta > TREND_EPS_M) trend = 'rising';
    else if (delta < -TREND_EPS_M) trend = 'falling';
  }
  return { height_m: Math.round(height * 1000) / 1000, trend };
}

/** Synchronous cache read — the render path's lookup. Undefined = never fetched, null = fetched+unusable. */
export function getCachedTideState(lat, lng) {
  const hit = cache.get(tideCellKey(lat, lng));
  if (!hit) return undefined;
  if (Date.now() - hit.ts > (hit.ok ? TTL_OK_MS : TTL_FAIL_MS)) return undefined;
  return hit.state;
}

/**
 * Fetch (or join the in-flight fetch for) the cell's tide state. Never rejects — resolves the
 * state or null. Callers setState on resolve; the render path reads getCachedTideState.
 */
export function ensureTideState(lat, lng) {
  const key = tideCellKey(lat, lng);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts <= (hit.ok ? TTL_OK_MS : TTL_FAIL_MS)) return Promise.resolve(hit.state);
  if (inflight.has(key)) return inflight.get(key);
  const [klat, klng] = key.split(',');
  const url = `${OPEN_METEO_MARINE_API}?latitude=${klat}&longitude=${klng}`
    + '&hourly=sea_level_height_msl&forecast_days=2&timezone=GMT';
  const p = fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const h = (d && d.hourly) || {};
      const state = tideStateFromSeries(h.time, h.sea_level_height_msl, Date.now());
      cache.set(key, { ts: Date.now(), ok: state != null, state });
      return state;
    })
    .catch(() => {
      cache.set(key, { ts: Date.now(), ok: false, state: null });
      return null;
    })
    .finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

export function _resetTideClientForTest() {
  cache.clear();
  inflight.clear();
}

const TREND_ARROW = { rising: '↑', falling: '↓', slack: '→' };

/** Decorative arrow for a tide trend (render aria-hidden — the trend WORD is the accessible signal). */
export function trendArrow(trend) {
  return TREND_ARROW[trend] || '';
}

/**
 * Format a tide state ({height_m, trend}) for a readout in the user's ft/m display unit:
 * "-0.2 ft falling" / "0.6 m rising". Plain words only (screen-reader safe — callers add
 * trendArrow visually). Null when the payload carries no usable tide.
 */
export function formatTideLine(tide, heightUnit) {
  if (!tide || tide.height_m == null || Number.isNaN(Number(tide.height_m))) return null;
  const height = formatHeightFromMeters(tide.height_m, heightUnit, { withUnit: true });
  const trend = TREND_ARROW[tide.trend] ? tide.trend : null;
  return trend ? `${height} ${trend}` : height;
}
