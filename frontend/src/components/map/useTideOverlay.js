/**
 * useTideOverlay.js - state + data hooks for the map Tide overlay (tideOverlayModel.js has the why).
 *
 * useTideOverlayFlag(): the toggle's state in EVERY mounted panel at once (MapPage mounts the desktop panel and the
 *   phone sheet; same lesson as useSurfModeFlagState): each re-reads the persisted flag on TIDE_OVERLAY_EVENT.
 * useTidePayloads(cells, enabled): the /point-tide payloads for the drawn cells, through usePointTide's ONE shared
 *   loader and cache (loadPointTide: the infobox's own acquisition). Since PR B (#1132) the server answers every cell
 *   from our own tide table, so a cell costs no upstream call and the old Open-Meteo rationing (a cold-cell budget,
 *   cooldown checks, deferrals) is gone. Keyed on the CELL LIST ONLY: the forecast hour is not an input, so scrubbing
 *   never fetches. Waits SETTLE_MS after a view change; wall-clock refresh at the cache TTL; hidden tabs do not poll.
 */
import { useEffect, useMemo, useState } from 'react';
import { loadPointTide, peekPointTide } from './usePointTide';
import { TIDE_OVERLAY_EVENT, getTideOverlayFlag, setTideOverlayFlag, tideOverlayDisabled } from './tideOverlayModel';

const REFRESH_MS = 5 * 60 * 1000;   // = usePointTide TTL; a fresh entry answers from cache, no request
export const SETTLE_MS = 600;        // a pan or zoom must rest this long before the overlay asks for anything

export function useTideOverlayFlag() {
  const [on, setOn] = useState(() => getTideOverlayFlag());
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const sync = () => setOn(getTideOverlayFlag());
    window.addEventListener(TIDE_OVERLAY_EVENT, sync);
    sync();
    return () => window.removeEventListener(TIDE_OVERLAY_EVENT, sync);
  }, []);
  const toggle = () => { const next = !on; setOn(next); setTideOverlayFlag(next); };
  return [on && !tideOverlayDisabled(), toggle];
}

export function useTidePayloads(cells, enabled) {
  const key = enabled && Array.isArray(cells) ? cells.map((c) => c.cell).join('|') : '';
  const [loaded, setLoaded] = useState({});   // cell -> payload | null
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    const list = key.split('|');
    const run = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      // One state update for the whole view (not one re-render per cell); the loader never rejects.
      Promise.all(list.map((cell) => loadPointTide(cell).then((value) => [cell, value]))).then((got) => {
        if (!live || !got.length) return;
        setLoaded((prev) => (got.every(([cell, value]) => prev[cell] === value) ? prev : { ...prev, ...Object.fromEntries(got) }));
      });
    };
    const settle = setTimeout(run, SETTLE_MS);   // a moving view changes the cell list every frame: wait for it to rest
    const timer = setInterval(run, REFRESH_MS);
    return () => { live = false; clearTimeout(settle); clearInterval(timer); };
  }, [key]);
  return useMemo(() => {
    const out = {};
    if (!key) return out;
    for (const cell of key.split('|')) {
      const fresh = peekPointTide(cell);
      out[cell] = fresh !== undefined ? fresh : loaded[cell];
    }
    return out;
  }, [key, loaded]);
}
