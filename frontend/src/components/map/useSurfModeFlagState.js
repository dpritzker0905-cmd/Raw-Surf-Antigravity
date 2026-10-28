/**
 * useSurfModeFlagState.js — the Surf Rating button's state is the FLAG's, in every panel at once (D6, 2026-10-28; the lead's offline
 * erratic fuzzer at 4bd90d0d9: after a phone rotation, the now-visible desktop panel's button read "Surf Rating: OFF" while
 * window.__SURF_MODE__ was true and the band was painting).
 *
 * MapPage mounts two MapWeatherControls (the desktop panel and the phone sheet). Each kept the band toggle in its own useState, read
 * once at mount, and only the panel that was clicked set it; the toggle already broadcasts 'rawsurf:surf-toggle' (MapWebGL and the
 * marine fetcher listen), so every panel now re-reads the flag on that event. The clicked panel's own setter still runs first, so the
 * click paints at once. Kill: window.__RAW_DISABLE_BAND_BUTTON_SYNC__ = true (each panel keeps its
 * own state, as before).
 */
import { useEffect, useState } from 'react';
import { getSurfModeFlag } from './backendWeatherServiceClient';

export const SURF_TOGGLE_EVENT = 'rawsurf:surf-toggle';

export function useSurfModeFlagState() {
  const [on, setOn] = useState(() => getSurfModeFlag());
  useEffect(() => {
    if (typeof window === 'undefined' || window.__RAW_DISABLE_BAND_BUTTON_SYNC__ === true) return undefined;
    const sync = () => setOn(getSurfModeFlag());
    window.addEventListener(SURF_TOGGLE_EVENT, sync);
    sync();   // a toggle between this panel's first render and this effect
    return () => window.removeEventListener(SURF_TOGGLE_EVENT, sync);
  }, []);
  return [on, setOn];
}
