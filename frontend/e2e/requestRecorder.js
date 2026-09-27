/**
 * requestRecorder — what the map asks the 1-CPU backend for, gesture by gesture (A15-11, 2026-09-27).
 *
 * Audit 15.0 measured ~11 weather requests within ~9 s of a layer activation, up to 5 launched in the
 * same 5 ms, and in-app `grid_series` taking 7.8-8.2 s where the same request alone took 0.7-1.8 s:
 * contention on a 1-CPU box. The proposed budget is <= 4 weather requests in flight per activation.
 * That was one manual session. This records it on every dev E2E run, so the fix is measured before
 * and after instead of argued: each `/api/weather/*` request with its gesture label, start, end and
 * outcome, summarised per gesture.
 *
 * Observation only. It never delays, blocks or rewrites a request.
 */
const WEATHER_PATH = /\/api\/weather\//;

/** Attach listeners; returns the live row array. `getLabel` reads the gesture in effect. */
function recordWeatherRequests(page, getLabel) {
  const rows = [];
  const open = new Map();
  page.on('request', (req) => {
    const url = req.url();
    if (!WEATHER_PATH.test(url)) return;
    const row = { url, start: Date.now(), end: null, label: getLabel(), status: null, failed: false };
    open.set(req, row);
    rows.push(row);
  });
  const settle = (failed) => async (req) => {
    const row = open.get(req);
    if (!row) return;
    open.delete(req);
    row.failed = failed;
    try {
      // The browser's own clock for the exchange when it has one; the event time otherwise.
      const t = req.timing();
      if (t && t.startTime > 0 && t.responseEnd >= 0) {
        row.start = Math.round(t.startTime);
        row.end = Math.round(t.startTime + t.responseEnd);
      } else {
        row.end = Date.now();
      }
      const res = failed ? null : await req.response();
      row.status = res ? res.status() : null;
    } catch (e) {
      row.end = row.end || Date.now();
    }
  };
  page.on('requestfinished', settle(false));
  page.on('requestfailed', settle(true));
  return rows;
}

/** 'grid_series', 'grid', 'point', ... — the path segment after /api/weather/. */
function endpointOf(url) {
  const m = /\/api\/weather\/([^/?#]+)/.exec(url || '');
  return m ? m[1] : 'other';
}

/** True when the request's bbox spans (nearly) the whole world: the audit's "world fetch". */
function isWorldExtent(url) {
  try {
    const q = new URL(url).searchParams;
    const bbox = (q.get('bbox') || '').split(',').map(Number);
    if (bbox.length === 4 && bbox.every(Number.isFinite)) {
      const [w, , e] = bbox;
      return ((e < w) ? (e + 360) - w : e - w) >= 340;
    }
    const west = Number(q.get('west'));
    const east = Number(q.get('east'));
    if (Number.isFinite(west) && Number.isFinite(east) && q.has('west') && q.has('east')) {
      return ((east < west) ? (east + 360) - west : east - west) >= 340;
    }
  } catch (e) { /* not a parseable URL */ }
  return false;
}

function median(xs) {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  return v[Math.floor((v.length - 1) / 2)];
}

/**
 * Per gesture: how many weather requests it started, the most that were in flight at once when one of
 * them started (its own and anyone else's: the contention it met), how many were world-extent, and
 * the median and worst duration. An unfinished request counts as open until `now`. PURE.
 */
function summarizeRequests(rows, now) {
  const endOf = (r) => (typeof r.end === 'number' ? r.end : now);
  const inFlightAt = (t) => rows.filter((r) => r.start <= t && endOf(r) > t).length;
  const byLabel = {};
  for (const r of rows) {
    const key = r.label || '(none)';
    const g = byLabel[key] || (byLabel[key] = { n: 0, peakInFlight: 0, world: 0, failed: 0,
      endpoints: {}, _ms: [] });
    g.n += 1;
    g.peakInFlight = Math.max(g.peakInFlight, inFlightAt(r.start));
    if (isWorldExtent(r.url)) g.world += 1;
    if (r.failed || (typeof r.status === 'number' && r.status >= 400)) g.failed += 1;
    const ep = endpointOf(r.url);
    g.endpoints[ep] = (g.endpoints[ep] || 0) + 1;
    if (typeof r.end === 'number') g._ms.push(r.end - r.start);
  }
  for (const g of Object.values(byLabel)) {
    g.medianMs = median(g._ms);
    g.maxMs = g._ms.length ? Math.max(...g._ms) : null;
    delete g._ms;
  }
  const peak = rows.reduce((m, r) => Math.max(m, inFlightAt(r.start)), 0);
  return { total: rows.length, peakInFlight: peak, byLabel };
}

module.exports = { recordWeatherRequests, summarizeRequests, endpointOf, isWorldExtent };
