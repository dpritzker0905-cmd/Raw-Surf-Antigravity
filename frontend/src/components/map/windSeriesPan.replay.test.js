import { ensureWindSeries, _resetWindSeriesForTest, windSeriesViewportIdentity } from './windGridSeries';
import { startWindSeriesWarm } from './windSeriesWarm';

// ── Offline replay of the wind series lane under a pan session ──────────────────────────────────
//
// WHY: on 2026-10-10 00:04-00:13Z /api/health read 10-13 s while the owner panned the live dev wind
// map over the Gulf. The Render request log showed ONE client re-requesting the whole 14-day wind
// timeline for every small pan (a mini plus two 48-frame pages). This replays that view sequence
// against the real windGridSeries.js with a mock fetch, so the request count is a measurement that
// needs no network and puts no load on the 1-CPU box (CLAUDE.md: never load-test the live backend).
//
// The mock models only what the client can observe: the URL it was sent, how long the server would
// take, and whether the client aborted first. "Frames built" is a MODEL (the box built a 48-frame
// page in ~20 s = OVERALL_DEADLINE, observed live, so ~2.4 frames/s until the request is aborted);
// requests and frames REQUESTED are hard counts.

// The view sequence read from the Render request log (one client, 2026-10-10), seconds from the first
// request at 00:03:55Z. Every bbox is the string the client sent.
const LIVE_PAN_SESSION = [
  { t: 0,   label: 'world (mount)',  b: [-180, -80, 180, 85] },
  { t: 1,   label: 'Gulf (restore)', b: [-91.8141, 27.0133, -83.9859, 30.1631] },
  { t: 35,  label: 'pan A',          b: [-92.2640, 26.8999, -78.6162, 32.3345] },
  { t: 40,  label: 'pan B (+5 s)',   b: [-92.2640, 26.5839, -78.6162, 32.6330] },
  { t: 117, label: 'pan C',          b: [-92.7200, 26.6968, -79.0722, 32.7393] },
  { t: 168, label: 'pan D',          b: [-92.9982, 25.9038, -79.3503, 31.9922] },
];

const MINI_MS = 500;
const PAGE_MS = 20000;           // OVERALL_DEADLINE: every page in the log ended at ~20 s
const FRAMES_PER_S = 48 / 20;

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

async function advance(ms, step = 100) {
  for (let t = 0; t < ms; t += step) {
    jest.advanceTimersByTime(Math.min(step, ms - t));
    await flush();
  }
}

// A mock backend that records every grid_series request and honours AbortSignal.
function makeMockBackend(clock) {
  const log = [];
  const fetchImpl = (url, opts = {}) => new Promise((resolve, reject) => {
    const u = new URL(String(url), 'http://x');
    const hours = (u.searchParams.get('hours') || '').split(',').filter(Boolean).map(Number);
    const entry = {
      issuedAt: clock(), hours, bbox: u.searchParams.get('bbox'),
      kind: hours.length === 1 ? 'mini' : (hours[0] >= 144 ? 'page1+' : 'page0'),
      state: 'pending', builtFrames: 0,
    };
    log.push(entry);
    const ms = hours.length === 1 ? MINI_MS : PAGE_MS;
    const timer = setTimeout(() => {
      entry.state = 'done'; entry.builtFrames = hours.length;
      resolve({
        ok: true,
        json: async () => ({
          frames: hours.map((h) => ({
            hour_offset: h, cols: 2, rows: 2,
            bounds: { west: -1, south: -1, east: 1, north: 1 },
            vectors: [{ lat: 0, lng: 0, u: 1, v: 1, speed: 2, direction: 45 }],
          })),
        }),
      });
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      if (entry.state !== 'pending') return;
      entry.state = 'aborted';
      // The server checks request.is_disconnected() before each hour, so work stops at the abort.
      entry.builtFrames = Math.min(hours.length, Math.floor((clock() - entry.issuedAt) * FRAMES_PER_S));
      const err = new Error('aborted'); err.name = 'AbortError'; reject(err);
    };
    if (opts.signal) {
      if (opts.signal.aborted) { onAbort(); return; }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  return { log, fetchImpl };
}

// A MapLibre stand-in: bounds in, `moveend` out.
function makeFakeMap() {
  const handlers = {};
  let bounds = { west: 0, south: 0, east: 1, north: 1 };
  return {
    on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
    off: (ev, fn) => { handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn); },
    getBounds: () => ({
      getWest: () => bounds.west, getSouth: () => bounds.south,
      getEast: () => bounds.east, getNorth: () => bounds.north,
    }),
    moveTo(b) {
      bounds = { west: b[0], south: b[1], east: b[2], north: b[3] };
      (handlers.moveend || []).slice().forEach((fn) => fn());
    },
  };
}

// Drive a wiring (a function (map, deps) -> stop) through a session and summarise.
async function runPanSession({ wire, session = LIVE_PAN_SESSION, restSeconds = 130, hour = 0 }) {
  let now = 0;
  // Virtual seconds since the session began. Jest's modern fake timers advance Date.now() with the
  // timers, so a request issued mid-advance carries its true issue time (not the last view's).
  const t0 = Date.now();
  const clock = () => (Date.now() - t0) / 1000;
  const backend = makeMockBackend(clock);
  global.fetch = jest.fn((url, opts) => backend.fetchImpl(url, opts));
  const map = makeFakeMap();
  const stop = wire(map, { model: 'GFS', hour });

  const marks = [];
  for (const view of session) {
    if (view.t > now) { await advance((view.t - now) * 1000); now = view.t; }
    marks.push({ label: view.label, at: now, firstLogIndex: backend.log.length });
    map.moveTo(view.b);
    await flush();
  }
  await advance(restSeconds * 1000); now += restSeconds;
  stop();
  await flush();

  // Attribute each request to the view that was current when it was issued.
  const rows = marks.map((m, i) => {
    const next = marks[i + 1] ? marks[i + 1].firstLogIndex : backend.log.length;
    const reqs = backend.log.slice(m.firstLogIndex, next);
    return {
      view: m.label,
      mini: reqs.filter((r) => r.kind === 'mini').length,
      page0: reqs.filter((r) => r.kind === 'page0').length,
      far: reqs.filter((r) => r.kind === 'page1+').length,
      framesRequested: reqs.reduce((s, r) => s + r.hours.length, 0),
      farFrames: reqs.filter((r) => r.hours[0] >= 144).reduce((s, r) => s + r.hours.length, 0),
      framesBuilt: reqs.reduce((s, r) => s + r.builtFrames, 0),
      aborted: reqs.filter((r) => r.state === 'aborted').length,
    };
  });
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const totals = {
    requests: backend.log.length, mini: sum('mini'), page0: sum('page0'), far: sum('far'),
    framesRequested: sum('framesRequested'), farFrames: sum('farFrames'),
    framesBuilt: sum('framesBuilt'), aborted: sum('aborted'),
  };
  return { rows, totals, log: backend.log };
}

function formatTable(title, { rows, totals }) {
  const pad = (v, n) => String(v).padEnd(n);
  const head = `${pad('view', 16)}${pad('mini', 6)}${pad('p0', 4)}${pad('far', 5)}${pad('req fr', 8)}${pad('far fr', 8)}${pad('built fr', 10)}aborted`;
  const line = (r) => `${pad(r.view, 16)}${pad(r.mini, 6)}${pad(r.page0, 4)}${pad(r.far, 5)}${pad(r.framesRequested, 8)}${pad(r.farFrames, 8)}${pad(r.framesBuilt, 10)}${r.aborted}`;
  return [title, head, ...rows.map(line),
    line({ view: 'TOTAL', mini: totals.mini, page0: totals.page0, far: totals.far,
      framesRequested: totals.framesRequested, farFrames: totals.farFrames,
      framesBuilt: totals.framesBuilt, aborted: totals.aborted })].join('\n');
}

// The wiring exactly as dev shipped it (WeatherEngine.js before the change): ONE AbortController for
// the whole effect, aborted only when the effect is torn down, ensureWindSeries on every moveend with
// the raw viewport. Kept here as the "before" so the comparison is against the real predecessor.
function legacyWiring(map, { model, hour }) {
  const controller = new AbortController();
  const boundsNow = () => {
    const b = map.getBounds();
    return { west: b.getWest(), south: Math.max(-85, b.getSouth()), east: b.getEast(), north: Math.min(85, b.getNorth()) };
  };
  const kick = () => ensureWindSeries(model, boundsNow(), hour, controller.signal);
  const t = setTimeout(kick, 600);
  map.on('moveend', kick);
  return () => { clearTimeout(t); controller.abort(); map.off('moveend', kick); };
}
const newWiring = (map, { model, hour }) => startWindSeriesWarm({ map, model, hour });

describe('wind series lane under the live pan session (offline replay, no network)', () => {
  beforeEach(() => {
    jest.useFakeTimers('modern');
    jest.setSystemTime(new Date('2026-10-10T00:03:55Z'));
    _resetWindSeriesForTest();
    delete window.__WIND_SERIES__;
    delete window.__RAW_DISABLE_WIND_SERIES_SUPERSEDE__;
    delete window.__WIND_SERIES_ADJ_DWELL_MS__;
  });
  afterEach(() => {
    jest.useRealTimers();
    delete window.__RAW_DISABLE_WIND_SERIES_SUPERSEDE__;
    delete window.__WIND_SERIES_ADJ_DWELL_MS__;
  });

  // The true predecessor: the single-controller wiring AND the previous prefetch (idle callback, no
  // abort guards), which is what the kill switch restores.
  const runBefore = async () => {
    window.__RAW_DISABLE_WIND_SERIES_SUPERSEDE__ = true;
    try { return await runPanSession({ wire: legacyWiring }); } finally { delete window.__RAW_DISABLE_WIND_SERIES_SUPERSEDE__; }
  };

  it('before vs after the same six views: fewer requests, far-hour frames and wasted frames', async () => {
    const before = await runBefore();
    _resetWindSeriesForTest();
    const after = await runPanSession({ wire: newWiring });
    console.log(`${formatTable('BEFORE (dev wiring)', before)}\n\n${formatTable('AFTER (supersede + dwell)', after)}`);

    // BEFORE is the behaviour measured on untouched origin/dev 0f73e2fb: a mini, a 48-frame page and a
    // 48-frame far page for every view (the world view's far page is attributed to the next row).
    expect(before.rows.map((r) => [r.mini, r.page0, r.far, r.framesRequested, r.farFrames])).toEqual([
      [1, 1, 0, 49, 0], [1, 1, 2, 145, 96], [1, 1, 0, 49, 0], [1, 1, 2, 145, 96], [1, 1, 1, 97, 48], [1, 1, 1, 97, 48],
    ]);
    expect(before.totals).toMatchObject({ mini: 6, page0: 6, far: 6, framesRequested: 582, farFrames: 288, aborted: 0 });
    // AFTER requests strictly less of everything, and the far page is no longer fetched blind.
    expect(after.totals.requests).toBeLessThan(before.totals.requests);
    expect(after.totals.framesRequested).toBeLessThan(before.totals.framesRequested);
    expect(after.totals.farFrames).toBeLessThan(before.totals.farFrames);
    // Frames the box actually built for views that were no longer on screen fall.
    expect(after.totals.framesBuilt).toBeLessThan(before.totals.framesBuilt);
  });

  // Steady-state sessions. The live trace had long rests; these are what keep the box busy. Each pan
  // is a 14 x 5.5 degree Gulf view, shifted 0.7 degree so every one is a fresh 0.5-degree key.
  const exploring = (gapSeconds, count) => Array.from({ length: count }, (_, i) => ({
    t: i * gapSeconds, label: `pan ${i + 1}`,
    b: [-92.2 + i * 0.7, 26.9 + i * 0.4, -78.6 + i * 0.7, 32.3 + i * 0.4],
  }));

  it.each([[25, 'exploring, a pan every 25 s'], [8, 'fast, a pan every 8 s']])(
    'steady state, %s s apart: the box does less work, and nothing the user left keeps running', async (gap, title) => {
      const session = exploring(gap, 8);
      // A long rest after the last pan lets every queued request drain, so neither side is cut short.
      window.__RAW_DISABLE_WIND_SERIES_SUPERSEDE__ = true;
      const b = await runPanSession({ wire: legacyWiring, session, restSeconds: 400 });
      delete window.__RAW_DISABLE_WIND_SERIES_SUPERSEDE__;
      _resetWindSeriesForTest();
      const a = await runPanSession({ wire: newWiring, session, restSeconds: 400 });
      console.log(`${formatTable(`BEFORE, ${title}`, b)}\n\n${formatTable(`AFTER, ${title}`, a)}`);
      expect(a.totals.farFrames).toBeLessThan(b.totals.farFrames);
      expect(a.totals.framesBuilt).toBeLessThan(b.totals.framesBuilt);
      // Every view's own page 0 is still requested: only the far page and abandoned work went.
      expect(a.totals.page0).toBe(b.totals.page0);
    });

  it('the kill switch restores the previous behaviour exactly', async () => {
    const before = await runBefore();
    _resetWindSeriesForTest();
    window.__RAW_DISABLE_WIND_SERIES_SUPERSEDE__ = true;
    const killed = await runPanSession({ wire: newWiring });
    expect(killed.totals).toEqual(before.totals);
    expect(killed.rows).toEqual(before.rows);
  });

  it('a view that stays put still gets its adjacent page (the convenience survives for a resting user)', async () => {
    const rest = await runPanSession({
      wire: newWiring, session: [{ t: 0, label: 'rest', b: [-92.2640, 26.8999, -78.6162, 32.3345] }], restSeconds: 120,
    });
    expect(rest.totals.page0).toBe(1);
    expect(rest.totals.far).toBe(1);
    expect(rest.totals.aborted).toBe(0);
  });

  it('a pan inside the dwell cancels the pending adjacent page of the view it left', async () => {
    const r = await runPanSession({
      wire: newWiring,
      session: [
        { t: 0, label: 'X', b: [-92.2640, 26.8999, -78.6162, 32.3345] },
        { t: 26, label: 'Y', b: [-70.0, 30.0, -60.0, 36.0] },   // p0 of X landed at ~20.5 s, dwell not over
      ],
      restSeconds: 20,
    });
    const farFor = (b) => r.log.filter((x) => x.hours[0] >= 144 && x.bbox.startsWith(b));
    expect(farFor('-92.2640')).toHaveLength(0);
  });

  it('the 14-day scrubber stays whole: scrub start loads every page of the current view', async () => {
    const c0 = Date.now();
    const backend = makeMockBackend(() => (Date.now() - c0) / 1000);
    global.fetch = jest.fn((url, opts) => backend.fetchImpl(url, opts));
    const map = makeFakeMap();
    const stop = newWiring(map, { model: 'GFS', hour: 0 });
    map.moveTo([-92.2640, 26.8999, -78.6162, 32.3345]);
    await advance(2000);
    window.dispatchEvent(new Event('timeline_scrub_start'));
    await advance(25000);   // two pages in flight (the 2-slot limiter), the third starts when one lands
    const pageStarts = backend.log.filter((x) => x.hours.length > 1).map((x) => x.hours[0]).sort((a, b) => a - b);
    expect(pageStarts).toEqual([0, 144, 288]);
    expect(backend.log.filter((x) => x.state === 'aborted')).toHaveLength(0);
    stop();
  });

  it('wide (global) work is shared and never aborted by a regional pan', async () => {
    const c0 = Date.now();
    const backend = makeMockBackend(() => (Date.now() - c0) / 1000);
    global.fetch = jest.fn((url, opts) => backend.fetchImpl(url, opts));
    const map = makeFakeMap();
    const stop = newWiring(map, { model: 'GFS', hour: 0 });
    map.moveTo([-180, -80, 180, 85]);
    await advance(1000);
    map.moveTo([-92.2640, 26.8999, -78.6162, 32.3345]);
    await advance(1000);
    const world = backend.log.filter((x) => x.bbox.startsWith('-180'));
    expect(world.length).toBeGreaterThan(0);
    expect(world.every((x) => x.state !== 'aborted')).toBe(true);
    stop();
  });

  it('refuses work for a view that has already been superseded', async () => {
    const c0 = Date.now();
    const backend = makeMockBackend(() => (Date.now() - c0) / 1000);
    global.fetch = jest.fn((url, opts) => backend.fetchImpl(url, opts));
    const c = new AbortController(); c.abort();
    await ensureWindSeries('GFS', { west: -92, south: 26, east: -80, north: 32 }, 0, c.signal);
    expect(backend.log).toHaveLength(0);
    // ...and with the kill switch, the previous behaviour (the request goes out).
    window.__RAW_DISABLE_WIND_SERIES_SUPERSEDE__ = true;
    _resetWindSeriesForTest();
    ensureWindSeries('GFS', { west: -92, south: 26, east: -80, north: 32 }, 0, c.signal);
    await advance(200);
    expect(backend.log.length).toBeGreaterThan(0);
  });

  it('does not change what is requested: the request box is the raw viewport, to 4 decimals, as before', async () => {
    const r = await runPanSession({
      wire: newWiring, session: [{ t: 0, label: 'A', b: [-92.2640, 26.8999, -78.6162, 32.3345] }], restSeconds: 5,
    });
    expect(r.log.map((x) => x.bbox)).toContain('-92.2640,26.8999,-78.6162,32.3345');
    expect(new Set(r.log.map((x) => x.bbox)).size).toBe(1);
  });

  it('identity: micro-pans inside one 0.5-degree key share it; a wide view is the shared global key', () => {
    const a = windSeriesViewportIdentity('GFS', { west: -92.26, south: 26.9, east: -78.62, north: 32.33 });
    const b = windSeriesViewportIdentity('GFS', { west: -92.3, south: 26.8, east: -78.6, north: 32.4 });
    const g = windSeriesViewportIdentity('GFS', { west: -180, south: -80, east: 180, north: 85 });
    expect(a).toBe(b);
    expect(g).toContain('_global_p');
    expect(LIVE_PAN_SESSION.length).toBe(6);
  });
});
