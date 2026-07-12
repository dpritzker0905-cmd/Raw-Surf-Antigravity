/**
 * marineForensics.js — one-read forensic recorder for the marine pipeline (2026-07-12).
 *
 * WHY (user, verbatim): "Is there a way to forensically test this with logs? How can we really
 * dial in these features without being stuck in a nightmare testing situation?" A live report
 * used to arrive as thousands of interleaved console lines with no build identity — the 07-12
 * round-3 session was judged on a STALE service-worker bundle (`rawsurf-v3-caeb440c` removed
 * mid-session) during a Render deploy window, and neither confound was visible until the full
 * paste was decoded by hand.
 *
 * WHAT: every load-bearing marine lifecycle event (grid commits, no-downgrade rejects/self-heals,
 * engine clears, mask rebuilds, band fade transitions, in-flight fetch-lock skips WITH AGE) lands
 * in a capped ring buffer with a timestamp. One console call replaces the whole paste:
 *   __RAW_FORENSIC__.summary()  → counts by type + the last event of each type (quick read)
 *   __RAW_FORENSIC__.dump()     → {build, startedAt, events[]} (full JSON)
 *   __RAW_FORENSIC__.copy()     → puts dump() JSON on the clipboard (falls back to returning it)
 *
 * The first recorded event also announces the RUNNING BUNDLE's build hash and cross-checks it
 * against the service-worker caches — a stale-bundle session now self-diagnoses in one loud line
 * instead of costing a re-diagnosis (the verify-bundle-hash-first lesson, automated).
 *
 * Recording is fire-and-forget and exception-swallowing: forensics must never break the pipeline.
 */
import { BUILD_VERSION } from '../../buildVersion';

const MAX_EVENTS = 500;

const _state = {
  startedAt: Date.now(),
  events: [],
  announced: false,
};

/** Push one event into the ring. `data` is shallow-merged; keep values small (no grids/textures). */
export function recordMarineEvent(type, data) {
  try {
    if (!_state.announced) {
      _state.announced = true;
      announceBuild();
    }
    _state.events.push({ t: Date.now(), type, ...(data || {}) });
    if (_state.events.length > MAX_EVENTS) {
      _state.events.splice(0, _state.events.length - MAX_EVENTS);
    }
  } catch (e) { /* forensics must never break the pipeline */ }
}

/** Full dump — the paste-me-to-Claude blob. */
export function forensicDump() {
  return {
    build: BUILD_VERSION,
    startedAt: _state.startedAt,
    now: Date.now(),
    eventCount: _state.events.length,
    events: _state.events.slice(),
  };
}

/** Quick console read: counts per type + the most recent event of each type. */
export function forensicSummary() {
  const counts = {};
  const last = {};
  for (const ev of _state.events) {
    counts[ev.type] = (counts[ev.type] || 0) + 1;
    last[ev.type] = ev;
  }
  return { build: BUILD_VERSION, total: _state.events.length, counts, last };
}

/** Reset the ring (exposed for tests and for starting a clean capture before a repro). */
export function forensicReset() {
  _state.events.length = 0;
}

/**
 * Announce the running bundle's build hash and cross-check the service-worker caches.
 * A mismatch (bundle hash absent from the newest rawsurf-v3-* cache) = the page is running a
 * STALE bundle — the exact 07-12 round-3 confound — and logs a loud, unmissable warning.
 */
export function announceBuild() {
  try {
    // eslint-disable-next-line no-console
    console.log(`[BUILD] bundle=${BUILD_VERSION}`);
    if (typeof window !== 'undefined' && window.__RAW_GPU__) {
      window.__RAW_GPU__.build = BUILD_VERSION;
    }
    if (typeof caches !== 'undefined' && caches.keys) {
      caches.keys().then((keys) => {
        const sw = keys.filter((k) => k.startsWith('rawsurf-v3-')).map((k) => k.slice('rawsurf-v3-'.length));
        recordMarineEvent('build_check', { bundle: BUILD_VERSION, swCaches: sw });
        if (BUILD_VERSION !== 'dev' && sw.length && !sw.includes(BUILD_VERSION)) {
          // eslint-disable-next-line no-console
          console.warn(
            `[BUILD] ⚠️ STALE BUNDLE: this page is running ${BUILD_VERSION} but the service worker has cached [${sw.join(', ')}]. ` +
            'HARD-REFRESH before judging any behavior — this session\'s visuals are the OLD code.'
          );
        }
      }).catch(() => {});
    }
  } catch (e) { /* never fatal */ }
}

if (typeof window !== 'undefined') {
  window.__RAW_FORENSIC__ = {
    dump: forensicDump,
    summary: forensicSummary,
    reset: forensicReset,
    events: _state.events,
    copy: async function copy() {
      const blob = JSON.stringify(forensicDump());
      try {
        await navigator.clipboard.writeText(blob);
        return `copied ${_state.events.length} events (build ${BUILD_VERSION}) to clipboard`;
      } catch (e) {
        // Clipboard needs a user gesture in some contexts — hand the JSON back instead.
        return blob;
      }
    },
  };
}
