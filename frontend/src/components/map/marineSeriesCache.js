// PF02: one retention boundary for pages, first-frame minis and warming placeholders.
// Estimated ownership is a budget metric, not a measurement of browser heap or GPU memory.
export function marineSeriesCacheBoundsEnabled() {
  return process.env.REACT_APP_MARINE_SERIES_CACHE_BOUNDS === 'true' &&
    !(typeof window !== 'undefined' && window.__RAW_DISABLE_MARINE_SERIES_CACHE_BOUNDS__ === true);
}

export function estimateSeriesEntryBytes(entry) {
  let bytes = 256;
  const seen = new Set();
  for (const frame of entry?.frames?.values() || []) {
    bytes += 1024; // frame/grid metadata allowance
    const vectors = frame?.grid?.vectors;
    if (!vectors || seen.has(vectors)) continue;
    seen.add(vectors);
    // Normalized grid vectors retain JS objects. Conservative fixed weight avoids
    // serializing or traversing every vector during a frame commit.
    bytes += ArrayBuffer.isView(vectors) ? vectors.byteLength : vectors.length * 256;
  }
  return Number.isFinite(bytes) && bytes >= 0 ? bytes : Infinity;
}

export class MarineSeriesCache extends Map {
  constructor({ maxEntries = 48, maxBytes = 32 * 1024 * 1024, ttl = 300000 } = {}) {
    super();
    this.maxEntries = maxEntries; this.maxBytes = maxBytes; this.ttl = ttl;
    this.weights = new Map(); this.estimatedBytes = 0;
  }
  delete(key) {
    this.estimatedBytes -= this.weights.get(key) || 0;
    this.weights.delete(key);
    return super.delete(key);
  }
  clear() { super.clear(); this.weights.clear(); this.estimatedBytes = 0; }
  prune() {
    if (!marineSeriesCacheBoundsEnabled()) return;
    const now = Date.now();
    for (const [key, entry] of super.entries()) {
      if (!Number.isFinite(entry?.ts) || now - entry.ts >= this.ttl) this.delete(key);
    }
    // Reconcile legacy entries if qualification is enabled after insertion.
    this.estimatedBytes = 0;
    for (const [key, entry] of super.entries()) {
      const weight = estimateSeriesEntryBytes(entry);
      this.weights.set(key, weight); this.estimatedBytes += weight;
    }
    while (this.size > this.maxEntries || this.estimatedBytes > this.maxBytes) {
      this.delete(super.keys().next().value);
    }
  }
  set(key, entry) {
    if (!marineSeriesCacheBoundsEnabled()) return super.set(key, entry);
    this.prune();
    const bytes = estimateSeriesEntryBytes(entry);
    // An oversized page must not evict the working cache and then retain nothing.
    if (bytes > this.maxBytes) return this;
    this.delete(key); super.set(key, entry);
    this.weights.set(key, bytes); this.estimatedBytes += bytes;
    while (this.size > this.maxEntries || this.estimatedBytes > this.maxBytes) {
      this.delete(super.keys().next().value);
    }
    return this;
  }
  get(key) {
    if (!marineSeriesCacheBoundsEnabled()) return super.get(key);
    this.prune();
    const entry = super.get(key);
    if (entry) { super.delete(key); super.set(key, entry); }
    return entry;
  }
  values() { this.prune(); return super.values(); }
  touchFrame(frame) {
    if (!marineSeriesCacheBoundsEnabled()) return;
    // Touch only after containment iteration has ended; moving a key during iteration
    // can visit it again indefinitely. Never extend the product freshness timestamp.
    for (const [key, entry] of super.entries()) {
      if (Array.from(entry.frames?.values() || []).includes(frame)) {
        super.delete(key); super.set(key, entry); break;
      }
    }
  }
}
