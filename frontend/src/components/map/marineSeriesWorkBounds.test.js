jest.mock('../../lib/apiClient', () => ({ API_BASE: '' }));
jest.mock('./backendWeatherServiceClient', () => ({ getSurfModeFlag: () => false }));
import { ensureMarineSeries, _resetMarineSeriesForTest, _seriesLimiterState, marineSeriesViewportIdentity } from './marineGridSeries';
import { createMarineViewportIntent } from './marineSeriesWorkPolicy';
import { acquireMiniSlot, releaseMiniSlot, acquireSeriesSlot, releaseSeriesSlot } from './marineSeriesLimiter';

const box = n => ({ west: -170 + n * 2, east: -169 + n * 2, south: 20, north: 21 });
const world = { west: -180, east: 180, south: -80, north: 85 };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
describe('actual transport work and latest viewport ownership', () => {
  let flag, requests, loads, controllers;
  beforeEach(() => {
    flag = process.env.REACT_APP_MARINE_SERIES_WORK_BOUNDS;
    process.env.REACT_APP_MARINE_SERIES_WORK_BOUNDS = 'true';
    jest.useFakeTimers(); _resetMarineSeriesForTest();
    requests = []; loads = []; controllers = []; window.__MARINE_SERIES__ = true;
    global.fetch = jest.fn((url, { signal }) => new Promise((resolve, reject) => {
      const r = { url, signal, done: false, finish() { this.done = true; resolve({ ok: true, json: async () => ({ frames: [] }) }); } };
      signal.addEventListener('abort', () => { r.done = true; reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })); }, { once: true });
      requests.push(r);
    }));
  });
  afterEach(async () => {
    controllers.forEach(c => c.abort());
    for (let n = 0; n < 30; n++) { requests.forEach(r => r.finish()); await flush(); }
    await Promise.all(loads); _resetMarineSeriesForTest(); jest.useRealTimers(); delete global.fetch;
    delete window.__MARINE_SERIES__; delete window.__RAW_DISABLE_MARINE_SERIES_WORK_BOUNDS__;
    delete window.__RAW_DISABLE_FETCH_PRIORITY__;
    if (flag === undefined) delete process.env.REACT_APP_MARINE_SERIES_WORK_BOUNDS;
    else process.env.REACT_APP_MARINE_SERIES_WORK_BOUNDS = flag;
  });
  const call = (bounds, signal) => loads.push(ensureMarineSeries('GFS', 'waves', bounds, 0, signal, true));
  it.each([false, true])('12 stalled viewports: causal active transport bound, enabled=%s', async enabled => {
    process.env.REACT_APP_MARINE_SERIES_WORK_BOUNDS = String(enabled);
    const c = new AbortController(); controllers.push(c);
    for (let n = 0; n < 12; n++) call(box(n), c.signal);
    await flush();
    expect(requests.filter(r => !r.done)).toHaveLength(enabled ? 3 : 14);
    expect(_seriesLimiterState().queuedVisibleMini).toBe(enabled ? 11 : 0);
  });
  it('latest regional intent drops abandoned queues while retaining reusable world work', async () => {
    const intent = createMarineViewportIntent(); controllers.push(intent);
    const key = b => marineSeriesViewportIdentity('GFS', 'waves', b);
    const globalSignal = intent.signalFor(key(world)); call(world, globalSignal); await flush();
    let previous;
    for (let n = 0; n < 12; n++) {
      const next = intent.signalFor(key(box(n))); call(box(n), next); await flush();
      if (previous) expect(previous.aborted).toBe(true);
      previous = next;
      expect(requests.filter(r => !r.done).length).toBeLessThanOrEqual(3);
    }
    expect(globalSignal.aborted).toBe(false);
    expect(previous.aborted).toBe(false);
    // Only the useful latest mini may wait behind the retained global mini.
    expect(_seriesLimiterState()).toMatchObject({ queuedVisible: 0, queuedVisibleMini: 1 });
    expect(requests.filter(r => !r.done).every(r => r.url.includes('bbox=-180') || r.url.includes('bbox=-148'))).toBe(true);
  });
  it('an abort after mini grant returns its slot before transport starts', async () => {
    const c = new AbortController(); controllers.push(c); call(box(0), c.signal); c.abort(); await flush();
    expect(requests).toHaveLength(0);
    expect(_seriesLimiterState()).toMatchObject({ active: 0, visibleMini: 0 });
  });
  it('a foreground mini waits for total capacity beside old background work', async () => {
    const background = await acquireMiniSlot(undefined, true);
    const p1 = await acquireSeriesSlot(), p2 = await acquireSeriesSlot();
    let foreground;
    const pending = acquireMiniSlot(undefined, false).then(lane => { foreground = lane; });
    await flush(); expect(foreground).toBeUndefined();
    releaseMiniSlot(background); await pending; expect(foreground).toBe('visible-mini');
    releaseMiniSlot(foreground); releaseSeriesSlot(p1); releaseSeriesSlot(p2);
  });
  it('priority rollback cannot bypass the qualified total bound', async () => {
    window.__RAW_DISABLE_FETCH_PRIORITY__ = true;
    const c = new AbortController(); controllers.push(c);
    for (let n = 0; n < 12; n++) call(box(n), c.signal);
    await flush(); expect(requests).toHaveLength(3);
  });
  it('qualification kill switch retains the14-request legacy trigger', async () => {
    window.__RAW_DISABLE_MARINE_SERIES_WORK_BOUNDS__ = true;
    const c = new AbortController(); controllers.push(c);
    for (let n = 0; n < 12; n++) call(box(n), c.signal);
    await flush(); expect(requests).toHaveLength(14);
  });
  it('turning on rollback drains minis already queued under qualification', async () => {
    const c = new AbortController(); controllers.push(c);
    for (let n = 0; n < 12; n++) call(box(n), c.signal);
    await flush(); expect(requests).toHaveLength(3);
    window.__RAW_DISABLE_MARINE_SERIES_WORK_BOUNDS__ = true;
    requests[0].finish(); await flush();
    expect(_seriesLimiterState().queuedVisibleMini).toBe(0);
    expect(requests).toHaveLength(14);
    expect(requests.filter(r => !r.done)).toHaveLength(13);
  });
  it.each([false, true])('central difference of active transport versus viewport count, enabled=%s', async enabled => {
    process.env.REACT_APP_MARINE_SERIES_WORK_BOUNDS = String(enabled);
    const counts = [];
    for (const count of [11, 13]) {
      const c = new AbortController(); controllers.push(c);
      for (let n = 0; n < count; n++) call(box(n), c.signal);
      await flush(); counts.push(requests.filter(r => !r.done).length);
      c.abort(); await flush();
      expect(_seriesLimiterState()).toMatchObject({ active: 0, visibleMini: 0, queuedVisible: 0, queuedVisibleMini: 0 });
    }
    expect((counts[1] - counts[0]) / 2).toBe(enabled ? 0 : 1);
  });
  it('grant removes the queued mini abort listener', async () => {
    const first = await acquireMiniSlot(undefined, false);
    const c = new AbortController(); controllers.push(c);
    const add = jest.spyOn(c.signal, 'addEventListener'), remove = jest.spyOn(c.signal, 'removeEventListener');
    const pending = acquireMiniSlot(c.signal, false); expect(add).toHaveBeenCalledTimes(1);
    releaseMiniSlot(first); const lane = await pending;
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]); releaseMiniSlot(lane);
  });
  it('A/B/A before aborted cleanup starts fresh A and old cleanup cannot remove its dedupe owner', async () => {
    const intent = createMarineViewportIntent(); controllers.push(intent);
    const key = b => marineSeriesViewportIdentity('GFS', 'waves', b);
    call(box(0), intent.signalFor(key(box(0)))); await flush();
    call(box(1), intent.signalFor(key(box(1))));
    const latest = intent.signalFor(key(box(0))); call(box(0), latest); await flush();
    const current = requests.filter(r => !r.done);
    expect(current).toHaveLength(2);
    expect(current.every(r => r.url.includes('bbox=-170'))).toBe(true);
    call(box(0), latest); await flush();
    expect(requests.filter(r => !r.done)).toHaveLength(2);
  });
});
