// Scrub-step re-render bail-outs (2026-11-15, the phone render census: about 10 React commits per scrub step).
//
// 1. Slot-URL bail-out. useOpenMeteoTileUrls merges the resolved raster slot URLs into a NEW object on every resolve, even when
//    every URL is unchanged (measured: 10 of 10 steps on a Waves view). React cannot bail out of a new object, so MapWebGL and its
//    36 raster Source + 36 Layer wrappers re-render for nothing. With the bail-out the updater returns the previous object when
//    the merged map is shallow-equal, and React skips the commit. Kill: window.__RAW_DISABLE_SLOT_URL_BAILOUT__ = true.
// 2. Derived scrubbing flag. MapForecastOverlay set isScrubbing true in a passive effect right after each hour change (one
//    extra commit per step), then false 200 ms later with the settled hour. Derived, it is `hour !== settled hour` in the same
//    render. Kill: window.__RAW_DISABLE_DERIVED_SCRUBBING__ = true.

const killed = (name) => typeof window !== 'undefined' && window[name] === true;

export const slotUrlBailoutOn = () => !killed('__RAW_DISABLE_SLOT_URL_BAILOUT__');
export const derivedScrubbingOn = () => !killed('__RAW_DISABLE_DERIVED_SCRUBBING__');

// Same own keys (count and names) and Object.is on every value.
export function shallowSameMap(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (let i = 0; i < ka.length; i += 1) {
    const k = ka[i];
    if (!Object.prototype.hasOwnProperty.call(b, k) || !Object.is(a[k], b[k])) return false;
  }
  return true;
}

// The slot-URL updater's result: `next`, or `prev` itself when nothing changed (and the bail-out is on).
export function keepSlotUrlsIfSame(prev, next) {
  return slotUrlBailoutOn() && shallowSameMap(prev, next) ? prev : next;
}

// The overlay's scrubbing flag: derived from the hour vs the settled hour, or the legacy state when killed.
export function scrubbingFlag(timeOffsetHours, settledOffset, legacyState) {
  return derivedScrubbingOn() ? timeOffsetHours !== settledOffset : legacyState;
}
