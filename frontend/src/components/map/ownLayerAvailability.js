/**
 * ownLayerAvailability.js — NO EMPTY LAYERS (2026-11-15, the advisor's red-team of #928, condition 1). The own-frames-only
 * layers (gusts, currents) have no .om path behind them: until their frame sets are published (a repo-variable flip and a
 * pilots run), the picker would offer a layer that draws nothing. A layer is offered only while at least one of its sets is
 * in v1/latest.json (staticFrames.getPinnedIndex resolves; it returns null for a set latest.json does not list), checked at
 * mount and every RECHECK_MS, so a set that later disappears hides the layer again. Until the first answer the layer is
 * hidden (never offered empty). Kill: window.__RAW_DISABLE_OWN_LAYER_AVAILABILITY__ = true (offer them unconditionally, as
 * before this check).
 */
import { useEffect, useState } from 'react';
import { getPinnedIndex, staticFramesEnabled } from './staticFrames';
import { OWN_ONLY_LAYERS, OWN_RASTER_SETS } from './ownRasterFrames';

export const RECHECK_MS = 10 * 60 * 1000;
const W = () => (typeof window !== 'undefined' ? window : {});
export const availabilityCheckKilled = () => W().__RAW_DISABLE_OWN_LAYER_AVAILABILITY__ === true;

/** The distinct set keys of a layer (every model's). */
export function setKeysOf(layer) {
  const set = OWN_RASTER_SETS[layer];
  return set ? [...new Set(Object.values(set.models))] : [];
}

/** { layer: true | false } for every own-only layer: true when at least one of its sets has a published index. */
export async function publishedOwnOnlyLayers(pin = getPinnedIndex) {
  const out = {};
  await Promise.all(OWN_ONLY_LAYERS.map(async (layer) => {
    const got = await Promise.all(setKeysOf(layer).map((k) => Promise.resolve().then(() => pin(k)).catch(() => null)));
    out[layer] = got.some((idx) => !!(idx && Array.isArray(idx.frames) && idx.frames.length));
  }));
  return out;
}

/** The own-only layers the picker may offer now: { gusts: bool, currents: bool }. */
export function useOwnOnlyLayersAvailable() {
  const killed = availabilityCheckKilled();
  const [avail, setAvail] = useState(() => Object.fromEntries(OWN_ONLY_LAYERS.map((l) => [l, killed])));
  useEffect(() => {
    if (killed) return undefined;
    if (!staticFramesEnabled()) { setAvail(Object.fromEntries(OWN_ONLY_LAYERS.map((l) => [l, false]))); return undefined; }
    let alive = true;
    const check = () => publishedOwnOnlyLayers().then((a) => { if (alive) setAvail((prev) => (OWN_ONLY_LAYERS.every((l) => prev[l] === a[l]) ? prev : a)); });
    check();
    const id = setInterval(check, RECHECK_MS);
    return () => { alive = false; clearInterval(id); };
  }, [killed]);
  return avail;
}
