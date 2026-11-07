/**
 * usePointTide(lat, lng) - the infobox tide readout's data from GET /api/weather/point-tide (2026-11-07).
 * Keyed on the ~0.1 degree cell ONLY: tide does not change with the forecast hour, so scrubbing never
 * refetches. Cached 10 min with in-flight dedupe. Returns { status: 'loading'|'ok'|'unavailable'|'off', data }.
 * Kill switch: window.__RAW_DISABLE_INFOBOX_TIDE__ === true (no fetch, status 'off').
 */
import { useEffect, useState } from 'react';
import { BACKEND_URL } from '../../lib/apiClient';
import { tideCellKey } from './tideClient';
import { infoboxTideDisabled, tideCovers } from './tideReadoutFormat';

export const POINT_TIDE_URL = `${BACKEND_URL}/api/weather/point-tide`;
const TTL_MS = 10 * 60 * 1000;
const _cache = new Map();   // cell -> { ts, value }
const _inflight = new Map();

export function clearPointTideCache() { _cache.clear(); _inflight.clear(); }

function load(cell, lat, lng) {
  const hit = _cache.get(cell);
  if (hit && Date.now() - hit.ts < TTL_MS) return Promise.resolve(hit.value);
  if (_inflight.has(cell)) return _inflight.get(cell);
  const ask = () => (typeof fetch === 'function'
    ? fetch(`${POINT_TIDE_URL}?lat=${Number(lat).toFixed(2)}&lng=${Number(lng).toFixed(2)}`) : Promise.reject(new Error('no fetch')));
  const p = Promise.resolve().then(ask)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((j) => {
      const value = j && j.available ? j : null;
      _cache.set(cell, { ts: Date.now(), value });
      _inflight.delete(cell);
      return value;
    });
  _inflight.set(cell, p);
  return p;
}

const MIN_REFETCH_MS = 60 * 1000;

export function usePointTide(lat, lng, nowMs = Date.now()) {
  const off = infoboxTideDisabled();
  const ok = !off && lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
  const cell = ok ? tideCellKey(Number(lat), Number(lng)) : null;
  const [res, setRes] = useState({ cell: null, value: null });
  // Series no longer reaches now+6h: drop the cached cell once (at most once a minute) and refetch.
  const cached = cell ? _cache.get(cell) : null;
  const stale = !!(cached && cached.value && !tideCovers(cached.value, nowMs) && Date.now() - cached.ts > MIN_REFETCH_MS);
  if (stale) _cache.delete(cell);
  useEffect(() => {
    if (!cell) return undefined;
    let live = true;
    load(cell, lat, lng).then((value) => { if (live) setRes({ cell, value }); });
    return () => { live = false; };
  }, [cell, lat, lng, stale]);
  if (off) return { status: 'off', data: null };
  if (!cell) return { status: 'loading', data: null };
  const hit = _cache.get(cell);
  const value = res.cell === cell ? res.value : (hit && Date.now() - hit.ts < TTL_MS ? hit.value : undefined);
  if (value === undefined) return { status: 'loading', data: null };
  return value ? { status: 'ok', data: value } : { status: 'unavailable', data: null };
}
