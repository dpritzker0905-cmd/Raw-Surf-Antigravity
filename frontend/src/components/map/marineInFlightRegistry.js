/**
 * marineInFlightRegistry.js
 *
 * Phase 1 of the marine "abort-storm" rework (Codex plan, 2026-06-21). A bounded
 * registry of in-flight marine grid requests that lets the fetcher DETACH a request
 * on a target switch instead of aborting+refetching it — the detached request runs to
 * completion, self-caches via fetchMarineData/_cacheMarineResult, and (if its target
 * becomes wanted again) is woken from cache. This module is PURE mechanics + telemetry;
 * it is NOT wired into useMarineDataFetcher yet (Phase 2). Importing/instantiating it
 * has ZERO behavior change.
 *
 * Display-safety is NOT this module's job — it never touches setMarineData, the abort
 * gates, or the transition coordinator. The fetcher's existing requestId / live-target /
 * transition-generation guards remain the sole authority over what is committed. The
 * registry only answers "is this target already in flight, and as what?" and bounds
 * concurrency.
 *
 * Entry shape:
 *   { key, controller, intent, requestId, state: 'foreground'|'detached',
 *     startedAt, wantedAgain, completionStatus: null|'success'|'failure'|'abort' }
 *
 * Key shape (full target identity incl. viewport so a different-bounds request is never
 * reused): `${rawModel}|${model}|${layer}|${hour}|${boundsKey}`.
 */

export const MARINE_INFLIGHT_DETACHED_CAP = 4;

/**
 * Canonical registry key for a fetch intent. Includes BOTH rawModel (the UI-selected
 * model, e.g. ICON) and the resolved model (e.g. GFS for an out-of-horizon fallback) so
 * two intents that resolve differently are never conflated, plus boundsKey/hour/layer.
 */
export function marineInFlightKey(intent) {
  if (!intent) return '';
  const rawModel = intent.rawModel || intent.model || 'GFS';
  const model = intent.model || rawModel;
  const layer = intent.layer || 'waves';
  const hour = intent.hour != null ? intent.hour : 0;
  const boundsKey = intent.boundsKey || '';
  return `${rawModel}|${model}|${layer}|${hour}|${boundsKey}`;
}

const TELEMETRY_EVENTS = [
  'foreground_started',
  'foreground_same_target_reused',
  'foreground_detached',
  'detached_reused_on_return',
  'detached_cache_completed',
  'detached_failed',
  'detached_aborted_by_cap',
  'detached_aborted_on_unmount',
  'detached_wake_enqueued',
  'network_request_started',
];

/**
 * @param {object} [opts]
 * @param {number} [opts.cap=4]        Max concurrent DETACHED requests before eviction.
 * @param {boolean} [opts.mirrorToWindow=true]  Mirror telemetry to window.__MARINE_INFLIGHT__.
 * @param {() => number} [opts.now]    Clock injection for tests.
 */
export function createMarineInFlightRegistry(opts = {}) {
  const cap = opts.cap != null ? opts.cap : MARINE_INFLIGHT_DETACHED_CAP;
  const mirrorToWindow = opts.mirrorToWindow !== false;
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();

  /** @type {Map<string, object>} insertion-ordered (Map guarantees this). */
  const entries = new Map();

  const counts = {};
  for (const e of TELEMETRY_EVENTS) counts[e] = 0;
  const log = [];
  const LOG_CAP = 80;

  function record(event, detail) {
    if (counts[event] == null) counts[event] = 0;
    counts[event] += 1;
    log.unshift({ event, ...detail, t: now() });
    if (log.length > LOG_CAP) log.length = LOG_CAP;
    if (mirrorToWindow && typeof window !== 'undefined') {
      window.__MARINE_INFLIGHT__ = window.__MARINE_INFLIGHT__ || {};
      window.__MARINE_INFLIGHT__.counts = counts;
      window.__MARINE_INFLIGHT__.log = log;
      window.__MARINE_INFLIGHT__.active = describe();
    }
  }

  function describe() {
    const out = [];
    for (const e of entries.values()) {
      out.push({ key: e.key, state: e.state, wantedAgain: e.wantedAgain, hour: e.intent?.hour, model: e.intent?.rawModel, layer: e.intent?.layer });
    }
    return out;
  }

  function detachedCount() {
    let n = 0;
    for (const e of entries.values()) if (e.state === 'detached') n += 1;
    return n;
  }

  /**
   * Register (or look up) a foreground request. If an entry with the SAME key and SAME
   * controller already exists, this is a no-op reuse. If the key exists with a DIFFERENT
   * controller (it was detached and is being re-driven), the new foreground entry replaces
   * it in the map but the OLD controller is returned so the caller can decide (it should
   * NOT normally happen — same-target dedup at the call site prevents it).
   */
  function registerForeground(controller, intent, requestId) {
    const key = marineInFlightKey(intent);
    const existing = entries.get(key);
    if (existing && existing.controller === controller) {
      record('foreground_same_target_reused', { key });
      return existing;
    }
    const entry = {
      key,
      controller,
      intent,
      requestId: requestId != null ? requestId : null,
      state: 'foreground',
      startedAt: now(),
      wantedAgain: false,
      completionStatus: null,
    };
    entries.set(key, entry);
    record('foreground_started', { key });
    return entry;
  }

  function find(keyOrIntent) {
    const key = typeof keyOrIntent === 'string' ? keyOrIntent : marineInFlightKey(keyOrIntent);
    return entries.get(key) || null;
  }

  /**
   * Mark a foreground request as detached (the user switched away). Does NOT abort — the
   * request keeps running so it can self-cache. Then enforce the detached cap.
   * @returns {object|null} the detached entry, or null if not found.
   */
  function detach(keyOrIntent) {
    const key = typeof keyOrIntent === 'string' ? keyOrIntent : marineInFlightKey(keyOrIntent);
    const entry = entries.get(key);
    if (!entry) return null;
    if (entry.state !== 'detached') {
      entry.state = 'detached';
      entry.detachedAt = now();
      record('foreground_detached', { key });
    }
    enforceCap(key);
    return entry;
  }

  /**
   * The current live target was found already in-flight as a DETACHED request — mark it
   * wanted so its completion can wake a cache-backed commit. Returns true if a detached
   * entry was marked.
   */
  function markWanted(keyOrIntent) {
    const key = typeof keyOrIntent === 'string' ? keyOrIntent : marineInFlightKey(keyOrIntent);
    const entry = entries.get(key);
    if (!entry || entry.state !== 'detached') return false;
    if (!entry.wantedAgain) {
      entry.wantedAgain = true;
      record('detached_reused_on_return', { key });
    }
    return true;
  }

  /**
   * Record completion of a request (identity-safe: ignored if the stored entry's
   * controller differs, i.e. the key was re-registered with a new controller).
   * @param {string} status 'success' | 'failure' | 'abort'
   * @returns {{ entry: object|null, shouldWake: boolean }} shouldWake is true when a
   *          wanted detached request completed successfully (cache is now warm) — Phase 2
   *          uses this to enqueue exactly one cache-backed re-entry for the live target.
   */
  function complete(keyOrIntent, controller, status) {
    const key = typeof keyOrIntent === 'string' ? keyOrIntent : marineInFlightKey(keyOrIntent);
    const entry = entries.get(key);
    if (!entry || (controller && entry.controller !== controller)) {
      return { entry: null, shouldWake: false };
    }
    entry.completionStatus = status;
    if (status === 'success') {
      record('detached_cache_completed', { key, foreground: entry.state === 'foreground' });
    } else {
      record('detached_failed', { key, reason: status });
    }
    // Wake on success OR failure (not deliberate abort): a wanted detached request that
    // finished must re-drive the current target — success => cache-warm hit, failure =>
    // fresh re-fetch. Combined with "cap never evicts a wanted entry" (pickEvictionVictim),
    // this guarantees a wanted detached request always completes and wakes, so the early-
    // return dedup in the fetcher can never strand a transition.
    const shouldWake = entry.state === 'detached' && entry.wantedAgain && status !== 'abort';
    entries.delete(key);
    return { entry, shouldWake };
  }

  /** Identity-safe removal (no-op if a newer controller now owns the key). */
  function remove(keyOrIntent, controller) {
    const key = typeof keyOrIntent === 'string' ? keyOrIntent : marineInFlightKey(keyOrIntent);
    const entry = entries.get(key);
    if (entry && (!controller || entry.controller === controller)) {
      entries.delete(key);
      return true;
    }
    return false;
  }

  function noteWakeEnqueued(key) {
    record('detached_wake_enqueued', { key });
  }
  function noteNetworkRequest(key) {
    record('network_request_started', { key });
  }

  /**
   * Enforce the detached cap. Aborts+removes the OLDEST detached entry, but NEVER the
   * protected key (the current live target) and PREFERS evicting non-wanted entries so a
   * wanted target waiting to wake isn't stranded. If only the protected entry would
   * remain over cap, we leave it (temporary +1 over cap is safe — it's the live target).
   */
  function enforceCap(protectKey) {
    let guard = 0;
    while (detachedCount() > cap && guard < 100) {
      guard += 1;
      const victim = pickEvictionVictim(protectKey);
      if (!victim) break; // nothing safe to evict
      try { if (victim.controller) victim.controller.abort(); } catch (e) { /* ignore */ }
      entries.delete(victim.key);
      record('detached_aborted_by_cap', { key: victim.key, wanted: victim.wantedAgain });
    }
  }

  function pickEvictionVictim(protectKey) {
    // Oldest-first (Map insertion order). NEVER evict a wanted entry or the protected
    // (current) key — a wanted detached request must survive to complete and wake, else its
    // early-return dedup in the fetcher would strand a transition. If only wanted/protected
    // entries remain over cap, evict nothing (temporary +N over cap is safe and bounded by
    // how many distinct targets the user is actively returning to).
    let oldestNonWanted = null;
    for (const e of entries.values()) {
      if (e.state !== 'detached') continue;
      if (e.key === protectKey) continue;
      if (e.wantedAgain) continue;
      if (!oldestNonWanted) oldestNonWanted = e;
    }
    return oldestNonWanted;
  }

  /** Abort EVERY request (foreground + detached). For true unmount. */
  function abortAll() {
    for (const e of entries.values()) {
      try { if (e.controller) e.controller.abort(); } catch (err) { /* ignore */ }
      if (e.state === 'detached') record('detached_aborted_on_unmount', { key: e.key });
    }
    entries.clear();
  }

  function getTelemetry() {
    return { counts: { ...counts }, log: log.slice(), active: describe() };
  }

  function resetTelemetry() {
    for (const k of Object.keys(counts)) counts[k] = 0;
    log.length = 0;
    if (mirrorToWindow && typeof window !== 'undefined' && window.__MARINE_INFLIGHT__) {
      window.__MARINE_INFLIGHT__.counts = counts;
      window.__MARINE_INFLIGHT__.log = log;
      window.__MARINE_INFLIGHT__.active = describe();
    }
  }

  return {
    key: marineInFlightKey,
    registerForeground,
    find,
    detach,
    markWanted,
    complete,
    remove,
    detachedCount,
    size: () => entries.size,
    noteWakeEnqueued,
    noteNetworkRequest,
    abortAll,
    getTelemetry,
    resetTelemetry,
    _entries: entries, // exposed for tests/diagnostics only
  };
}

export default createMarineInFlightRegistry;
