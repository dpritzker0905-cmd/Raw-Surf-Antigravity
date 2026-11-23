/**
 * decodedOmBudget.js — window.__DECODED_OM_TILES__ (the decoded .om fields openMeteoProtocol keeps for the point infobox's sampler)
 * under the shared byte budget (2026-11-23, cacheBudget.js). Measured: 280 MB of a 985 MB retained heap after one 21-layer cycle,
 * the largest single holder, read by the infobox alone.
 *  - ONE COPY: on the main thread the decoder stores each field directly AND broadcasts it; this thread's own BroadcastChannel
 *    listener then received a structured clone of the same field and stored it again under the same key (the clone replaced the
 *    direct entry while the library kept the original). The listener now skips the echo of a field this thread stored at or after
 *    the broadcast; a worker's broadcast (no direct store) still lands.
 *  - The FIFO cap (150) stays; the budget drops these first (cost 0: the infobox re-reads from the decoder's own state or decodes).
 * Kill: window.__RAW_DISABLE_CACHE_BUDGET__ = true (the echo copy and the 150-entry FIFO alone, as before).
 */
import { activeView, cacheBudgetOn, noteCacheGrowth, registerCache } from './cacheBudget';
import { decodedOmEntries } from './cacheBudgetAdapters';

export const DECODED_OM_MAX = 150;
const omMap = () => (typeof window !== 'undefined' ? window.__DECODED_OM_TILES__ : null);

/** After a store: today's FIFO cap, then one budget pass (scheduled, off the decode path). */
export function trimDecodedOmTiles(map) {
  if (!map) return;
  while (map.size > DECODED_OM_MAX) map.delete(map.keys().next().value);
  noteCacheGrowth();
}

/** True for this thread's own echo of a field it already stored directly (skip it: a second copy of the same field). */
export function isOwnDecodedOmEcho(map, payload) {
  if (!cacheBudgetOn() || !map || !payload || !payload.cacheKey) return false;
  const have = map.get(payload.cacheKey);
  return !!have && Number(have.timestamp || 0) >= Number(payload.timestamp || 0);
}

registerCache('decoded-om', {
  entries: () => decodedOmEntries(omMap(), activeView()),
  drop: (k) => { const m = omMap(); return m && m.delete(k) ? 1 : null; },
  cost: 0,
});
