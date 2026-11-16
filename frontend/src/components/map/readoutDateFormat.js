/**
 * readoutDateFormat.js: the status lines' date words, formatted by CACHED Intl.DateTimeFormat instances (2026-11-11, the layer
 * animation lane).
 *
 * Measured before (scn_layer_anim + a CPU profile, phone profile, six 1-hour scrub steps; log 2026-11-11-fable-layer-animation):
 * `new Date(ms).toLocaleString('en-US', {...})` builds a new Intl.DateTimeFormat on every call, and the drawn-frame readout
 * calls it several times per status render: 164 ms (waves), 153 ms (wind) and 49 ms (rain) of the scrub's main-thread time.
 * A formatter built once gives the same words (ECMA-402: toLocaleString with explicit options IS DateTimeFormat.format), so
 * the cache is keyed by the options alone; the locale is fixed ('en-US') and the time zone is the device's, as before.
 * Kill: window.__RAW_DISABLE_READOUT_FORMAT_CACHE__ = true (toLocaleString per call, as before).
 */
const OPTIONS = {
  hour: { weekday: 'short', hour: 'numeric' },
  dated: { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' },
  clock: { hour: 'numeric', minute: '2-digit' },
  run: { weekday: 'long', hour: 'numeric' },
};
const cache = {};
const killed = () => typeof window !== 'undefined' && window.__RAW_DISABLE_READOUT_FORMAT_CACHE__ === true;

/** `kind`: 'hour' (Sat 5 AM) | 'dated' (Sat, Nov 14, 5 AM) | 'clock' (5:10 AM) | 'run' (Saturday 8 PM). `date` is a Date. */
export function formatReadoutDate(date, kind = 'hour') {
  const options = OPTIONS[kind] || OPTIONS.hour;
  if (killed() || typeof Intl === 'undefined' || typeof Intl.DateTimeFormat !== 'function') return date.toLocaleString('en-US', options);
  let f = cache[kind];
  if (!f) { f = new Intl.DateTimeFormat('en-US', options); cache[kind] = f; }
  return f.format(date);
}

/**
 * A MODEL RUN in the reader's own time (2026-11-16, the director after the advisor's #933 read: "Saturday 8 PM run", not "Sun 00Z").
 * Used by every status line that names a run (the rated band's run-age label, the held-frame "older run" reason). '' when unknown.
 * Kill: window.__RAW_DISABLE_LOCAL_RUN_TIME__ = true (the callers fall back to their previous words).
 */
export function localRunTimeOn() { return !(typeof window !== 'undefined' && window.__RAW_DISABLE_LOCAL_RUN_TIME__ === true); }
export function formatRunLocal(ms) {
  if (!Number.isFinite(ms)) return '';
  return formatReadoutDate(new Date(ms), 'run');
}
