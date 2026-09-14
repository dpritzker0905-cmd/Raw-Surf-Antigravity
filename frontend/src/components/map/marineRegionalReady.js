// A cache arrival is a hint to re-check current intent, never a command to fetch.
export const MARINE_REGIONAL_READY = 'rawsurf:marine-regional-ready';
export function publishMarineRegionalReady(model, layer, hour, surf) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MARINE_REGIONAL_READY, { detail: { model, layer, hour, surf } }));
  }
}
