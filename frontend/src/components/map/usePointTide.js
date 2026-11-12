/**
 * usePointTide(lat, lng) - the infobox tide readout's data from GET /api/weather/point-tide (2026-11-07).
 * Keyed on the ~0.1 degree cell ONLY: the returned series is evaluated at the selected hour, so scrubbing never
 * refetches. Series cached 5 min, misses 30 s, with in-flight dedupe. Returns { status: 'loading'|'ok'|'unavailable'|'off', data }.
 * Kill switch: window.__RAW_DISABLE_INFOBOX_TIDE__ === true (no fetch, status 'off').
 */
import { useEffect, useState } from 'react';
import { BACKEND_URL } from '../../lib/apiClient';
import { tideCellKey } from './tideClient';
import { infoboxTideDisabled } from './tideReadoutFormat';

export const POINT_TIDE_URL = `${BACKEND_URL}/api/weather/point-tide`;
// Match /point-tide Cache-Control: successful series max-age=300, unavailable max-age=30.
const TTL_MS = 5 * 60 * 1000;
const UNAVAILABLE_TTL_MS = 30 * 1000;
const isFresh = entry => !!entry && Date.now() - entry.ts < (entry.value ? TTL_MS : UNAVAILABLE_TTL_MS);
const _cache = new Map();   // cell -> { ts, value }
const _inflight = new Map();

export function clearPointTideCache() { _cache.clear(); _inflight.clear(); }

function load(cell) {
  const hit = _cache.get(cell);
  if (isFresh(hit)) return Promise.resolve(hit.value);
  if (_inflight.has(cell)) return _inflight.get(cell);
  // Address the cell we cache; rounding the original coordinates again in Python can select a neighbour.
  const [cellLat, cellLng] = cell.split(',');
  const ask = () => (typeof fetch === 'function'
    ? fetch(`${POINT_TIDE_URL}?lat=${cellLat}&lng=${cellLng}`) : Promise.reject(new Error('no fetch')));
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

export function usePointTide(lat, lng) {
  const off = infoboxTideDisabled();
  const ok = !off && lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
  const cell = ok ? tideCellKey(Number(lat), Number(lng)) : null;
  const [res, setRes] = useState({ cell: null, value: null });
  // Refresh by wall-clock age only. An uncovered selected day cannot extend source coverage.
  const cached = cell ? _cache.get(cell) : null;
  const stale = !!cached && !isFresh(cached);
  useEffect(() => {
    if (!cell) return undefined;
    let live = true;
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      if (!live || document.visibilityState === 'hidden') return;
      return load(cell).then((value) => {
      if (!live) return;
      setRes({ cell, value });
      // Use the acquisition deadline, so fixed selections retry and scrubbing cannot extend cache age.
      const hit = _cache.get(cell);
      if (hit && document.visibilityState !== 'hidden') {
        const expiresAt = hit.ts + (hit.value ? TTL_MS : UNAVAILABLE_TTL_MS);
        clearTimeout(timer);
        timer = setTimeout(refresh, Math.max(1, expiresAt - Date.now()));
      }
      });
    };
    // Resume against the original cache deadline; background tabs do not poll.
    const onVisibility = () => {
      clearTimeout(timer);
      if (document.visibilityState !== 'hidden') refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    refresh();
    return () => { live = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [cell, lat, lng, stale]);
  if (off) return { status: 'off', data: null };
  if (!cell) return { status: 'loading', data: null };
  const hit = _cache.get(cell);
  const value = res.cell === cell ? res.value : (isFresh(hit) ? hit.value : undefined);
  if (value === undefined) return { status: 'loading', data: null };
  return value ? { status: 'ok', data: value } : { status: 'unavailable', data: null };
}
