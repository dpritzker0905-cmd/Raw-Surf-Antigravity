// MANIFEST VALID-TIME INDEX (kill: window.__RAW_DISABLE_MANIFEST_TIME_INDEX__ = true).
//
// getSharedValidTime (backendWeatherServiceClient.js) runs on every scrub step, layer/model switch and request build. It used
// to filter the WHOLE products manifest (thousands of rows) and parse every valid_time_start with `new Date` on each call; the
// 2026-10-20 stall profile (PR #400) billed it 113-307 ms of main-thread stall per erratic run. This builds, ONCE per manifest
// (the products array is replaced wholesale on every fetch and never mutated in place), a map
//     MODEL|domain|layer -> { count, times: sorted unique valid-time ms, first: lowest manifest index holding that time }
// and answers "nearest valid time" by binary search.
//
// ⚠️ It must return exactly what the linear scan returns, ties included. The scan keeps the FIRST product in manifest order
// whose |valid - target| is smallest (strict `<`), and skips unparseable dates (NaN never compares less). So among equal
// times the lowest index wins (kept in `first`), and when the two neighbours are equally far the one that appears earlier in
// the manifest wins. A manifest with a non-string model/domain/layer gets no index: the caller runs the original scan, which
// keeps its exact behaviour (including throwing on such a row). Pinned by manifestTimeIndex.parity.test.js.

const SEP = '\u0000';
const indexByProducts = new WeakMap();

export function manifestTimeIndexEnabled(win = (typeof window !== 'undefined' ? window : null)) {
  return !(win && win.__RAW_DISABLE_MANIFEST_TIME_INDEX__ === true);
}

export function manifestGroupKey(model, domain, layer) {
  return `${model}${SEP}${domain}${SEP}${layer}`;
}

function buildIndex(products) {
  const raw = new Map();
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    if (!p || typeof p.model !== 'string' || typeof p.domain !== 'string' || typeof p.layer !== 'string') return null;
    const key = manifestGroupKey(p.model.toUpperCase(), p.domain.toLowerCase(), p.layer.toLowerCase());
    let g = raw.get(key);
    if (!g) { g = { count: 0, entries: [] }; raw.set(key, g); }
    g.count++;
    const ms = new Date(p.valid_time_start).getTime();
    if (!Number.isNaN(ms)) g.entries.push([ms, i]);
  }
  const groups = new Map();
  for (const [key, g] of raw) {
    g.entries.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    const times = [];
    const first = [];
    for (const [ms, i] of g.entries) {
      if (times.length && times[times.length - 1] === ms) continue;   // sorted by index within a time: the first kept is lowest
      times.push(ms);
      first.push(i);
    }
    groups.set(key, { count: g.count, times, first });
  }
  return groups;
}

/** The index for this products array (built on first use, then reused until the manifest is replaced), or null. */
export function getManifestTimeIndex(products) {
  if (!Array.isArray(products)) return null;
  const hit = indexByProducts.get(products);
  if (hit && hit.length === products.length) return hit.groups;
  const groups = buildIndex(products);
  indexByProducts.set(products, { length: products.length, groups });
  return groups;
}

/**
 * Nearest valid time to `targetMs` in one group, with the linear scan's tie rule.
 * Returns { ms, diffMs } where ms is null (and diffMs Infinity) when the group has no parseable time.
 */
export function nearestValidTime(group, targetMs) {
  const { times, first } = group;
  const n = times.length;
  if (n === 0) return { ms: null, diffMs: Infinity };
  let lo = 0;
  let hi = n;
  while (lo < hi) {   // first time >= target
    const mid = (lo + hi) >>> 1;
    if (times[mid] < targetMs) lo = mid + 1; else hi = mid;
  }
  let best = -1;
  if (lo === n) best = n - 1;
  else if (lo === 0) best = 0;
  else {
    const dPrev = Math.abs(times[lo - 1] - targetMs);
    const dNext = Math.abs(times[lo] - targetMs);
    if (dPrev < dNext) best = lo - 1;
    else if (dNext < dPrev) best = lo;
    else best = first[lo - 1] < first[lo] ? lo - 1 : lo;
  }
  return { ms: times[best], diffMs: Math.abs(times[best] - targetMs) };
}
