import {
  _resetInstantTelemetryForTest, flushInstantTelemetry, installInstantTelemetry, noteWeatherAsk, rumEndpoint, rumSampled,
} from './instantTelemetry';
import { _resetMarineDrawnForTest, publishMarineDrawn, publishWindDrawn } from './marineDrawnFrame';

// FIELD TELEMETRY (skills audit #3, 2026-10-23): press-to-frame on sampled pages, LoAF, INP with attribution, one beacon per hide.
describe('instantTelemetry', () => {
  let clock;
  const advance = (ms) => { clock += ms; jest.advanceTimersByTime(ms); };
  const key = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  const drawMarine = (hour, model = 'GFS', layer = 'waves') => publishMarineDrawn({ hourOffset: hour, __sourceModel: model, __componentLayer: layer });
  const rows = () => window.__RAW_RUM__.pending().rows;
  const install = (opts = {}) => installInstantTelemetry({ sampled: true, loadVitals: () => null, ...opts });

  beforeEach(() => {
    jest.useFakeTimers('legacy');
    clock = 1000;
    jest.spyOn(performance, 'now').mockImplementation(() => clock);
    window.requestAnimationFrame = (fn) => { fn(clock); return 1; };
    _resetMarineDrawnForTest();
    _resetInstantTelemetryForTest();
  });
  afterEach(() => {
    _resetInstantTelemetryForTest();
    _resetMarineDrawnForTest();
    delete window.__RAW_DISABLE_RUM__;
    delete window.__RAW_RUM_URL__;
    delete window.fetchLater;
    delete window.PerformanceObserver;
    window.localStorage.removeItem('__RAW_RUM__');
    Object.defineProperty(window.navigator, 'sendBeacon', { configurable: true, value: undefined });
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('samples a small share of pages; this browser can be forced either way; the kill switch wins over all', () => {
    expect(rumSampled(() => 0.05)).toBe(true);                        // default rate 0.1
    expect(rumSampled(() => 0.5)).toBe(false);
    window.localStorage.setItem('__RAW_RUM__', 'true');
    expect(rumSampled(() => 0.99)).toBe(true);
    window.localStorage.setItem('__RAW_RUM__', 'false');
    expect(rumSampled(() => 0)).toBe(false);
    window.localStorage.setItem('__RAW_RUM__', 'true');
    window.__RAW_DISABLE_RUM__ = true;
    expect(rumSampled(() => 0)).toBe(false);
    expect(install()).toBe(false);                                      // the kill also refuses an explicit install
  });

  it('an unsampled page installs nothing and records nothing', () => {
    expect(installInstantTelemetry({ sampled: false })).toBe(false);
    key();
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 0 });
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 1 });
    drawMarine(1);
    expect(window.__RAW_RUM__).toBeUndefined();
    expect(flushInstantTelemetry()).toBeNull();
  });

  it('a step: from the key press to the next frame after the matching marine draw', () => {
    install();
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 0 });       // boot state: not a press
    advance(500);
    key();                                                              // press at t = 1500
    advance(20);
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 1 });       // React's effect, 20 ms later
    advance(10);
    drawMarine(0);                                                      // a stale frame: not the ask
    expect(rows()).toEqual([]);
    advance(15);
    drawMarine(1);                                                      // the ask's frame at t = 1545
    expect(rows()).toEqual([[0, 0, 45, null, 'GFS', 'waves', 2]]);
  });

  it('a frame drawn BEFORE the ask reached telemetry (a resident frame) still counts from the press', () => {
    install();
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 3 });
    key();
    advance(4);
    drawMarine(4);
    advance(6);
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 4 });
    expect(rows()).toEqual([[0, 0, 10, null, 'GFS', 'waves', 2]]);
  });

  it('a drag counts while the button is held; a newer ask supersedes; nothing drawn in 8 s is a timeout', () => {
    install();
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 0 });
    window.dispatchEvent(new MouseEvent('pointermove', { buttons: 0 }));   // a hover is not a press
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 1 });
    expect(window.__RAW_RUM__.pending().lost).toEqual({ superseded: 0, timeout: 0 });
    window.dispatchEvent(new MouseEvent('pointermove', { buttons: 1 }));
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 2 });
    advance(30);
    window.dispatchEvent(new MouseEvent('pointermove', { buttons: 1 }));
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 3 });
    advance(12);
    drawMarine(3);
    expect(rows()).toEqual([[0, 0, 12, null, 'GFS', 'waves', 1]]);
    expect(window.__RAW_RUM__.pending().lost.superseded).toBe(1);
    window.dispatchEvent(new MouseEvent('pointermove', { buttons: 1 }));
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 4 });
    advance(8000);
    expect(window.__RAW_RUM__.pending().lost.timeout).toBe(1);
    expect(rows()).toHaveLength(1);
  });

  it('autoplay steps and asks with no input in the last second are not presses', () => {
    install();
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 0 });
    key();
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 1, playing: true });
    drawMarine(1);
    advance(1500);
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 2 });     // the key was 1.5 s ago
    drawMarine(2);
    expect(rows()).toEqual([]);
  });

  it('layer and model toggles, per family: wind is timed on its own toggle and steps, never on a marine model switch', () => {
    window.__MAP_INSTANCE__ = { getZoom: () => 4.26 };
    try {
      install();
      noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 0 });
      key();
      noteWeatherAsk({ model: 'EURO', layers: ['waves'], hour: 0 });
      advance(7);
      drawMarine(0, 'EURO');
      key();
      noteWeatherAsk({ model: 'EURO', layers: ['waves', 'wind'], hour: 0 });   // wind on: only wind is pending
      advance(9);
      drawMarine(0, 'EURO');                                                    // a marine redraw does not answer a wind toggle
      publishWindDrawn({ hourOffset: 0, model: 'GFS' });
      key();
      noteWeatherAsk({ model: 'ICON', layers: ['waves', 'wind'], hour: 0 });   // model: marine only
      advance(5);
      publishWindDrawn({ hourOffset: 0, model: 'GFS' });
      drawMarine(0, 'ICON');
      expect(rows()).toEqual([
        [0, 2, 7, 4.3, 'EURO', 'waves', 2],
        [1, 1, 9, 4.3, 'EURO', 'wind', 2],
        [0, 2, 5, 4.3, 'ICON', 'waves', 2],
      ]);
      expect(window.__RAW_RUM__.pending().lost.superseded).toBe(0);
    } finally {
      delete window.__MAP_INSTANCE__;
    }
  });

  it('long animation frames: totals plus the worst five, scripts named by file without a query string', () => {
    let cb = null;
    window.PerformanceObserver = class { constructor(fn) { cb = fn; } observe() {} disconnect() {} };
    window.PerformanceObserver.supportedEntryTypes = ['long-animation-frame', 'event'];
    install();
    expect(window.__RAW_RUM__.loaf).toBe(true);
    const entry = (d, b) => ({ duration: d, blockingDuration: b, startTime: 100,
      scripts: [{ sourceURL: 'https://site.test/static/js/main.abc.js?v=1#x', sourceFunctionName: 'tick', invoker: 'FrameRequestCallback', duration: d - 5 },
        { sourceURL: 'https://site.test/static/js/942.chunk.js', sourceFunctionName: 'decode', invoker: 'https://x.test/a.js?token=1', duration: 1 },
        { sourceURL: 'not a url', sourceFunctionName: '', invoker: '', duration: 0 }] });
    cb({ getEntries: () => [60, 250, 80, 120, 90, 300, 55].map((d) => entry(d, d - 50)) });
    const L = window.__RAW_RUM__.pending().loaf;
    expect(L.n).toBe(7);
    expect(L.over200).toBe(2);
    expect(L.blockMs).toBe(955 - 350);
    expect(L.worst.map((w) => w.d)).toEqual([300, 250, 120, 90, 80]);
    expect(L.worst[0].s).toEqual([{ f: 'main.abc.js', fn: 'tick', inv: 'FrameRequestCallback', d: 295 },
      { f: '942.chunk.js', fn: 'decode', inv: 'https://x.test/a.js', d: 1 }]);
  });

  it('one beacon per hide with everything since the last one; nothing new, no request; no endpoint, nothing sent', async () => {
    const beacon = jest.fn(() => true);
    Object.defineProperty(window.navigator, 'sendBeacon', { configurable: true, value: beacon });
    install({ loadVitals: () => ({ onINP: (fn) => fn({ value: 180.4, rating: 'good',
      attribution: { eventType: 'pointerdown', eventTarget: 'div.forecast-wheel>button', loadState: 'complete' } }) }) });
    await Promise.resolve(); await Promise.resolve();
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 0 });
    key();
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 1 });
    advance(30);
    drawMarine(1);
    expect(rumEndpoint()).toBeNull();
    const local = flushInstantTelemetry('hidden');                     // no endpoint: published, not sent
    expect(local.via).toBeNull();
    expect(beacon).not.toHaveBeenCalled();
    expect(window.__RAW_RUM__.last.p2f).toEqual([[0, 0, 30, null, 'GFS', 'waves', 2]]);
    expect(window.__RAW_RUM__.last.inp).toEqual({ v: 180, r: 'good', t: 'pointerdown', el: 'div.forecast-wheel>button', ls: 'complete' });

    window.__RAW_RUM_URL__ = '/api/rum';
    expect(flushInstantTelemetry('hidden')).toBeNull();                 // nothing new since the last flush
    key();
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 2 });
    advance(12);
    drawMarine(2);
    document.dispatchEvent(new Event('visibilitychange'));              // jsdom: visibilityState stays 'visible'
    expect(beacon).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0][0]).toBe('/api/rum');
    expect(beacon.mock.calls[0][1].type).toBe('text/plain;charset=utf-8');
    const sent = window.__RAW_RUM__.last;
    expect(sent.why).toBe('pagehide');
    expect(sent.p2f).toEqual([[0, 0, 12, null, 'GFS', 'waves', 2]]);
    expect(sent.cols).toEqual(['fam', 'kind', 'ms', 'zoom', 'model', 'layer', 'input']);
    expect(window.__RAW_RUM__.lastBytes).toBeLessThanOrEqual(8192);
    expect(JSON.stringify(sent)).not.toMatch(/localhost|http:/);       // no page URL in the record
  });

  it('fetchLater, where the browser has it, carries the current batch in case the page dies without a hide', () => {
    const later = jest.fn();
    window.fetchLater = later;
    const beacon = jest.fn(() => true);
    Object.defineProperty(window.navigator, 'sendBeacon', { configurable: true, value: beacon });
    window.__RAW_RUM_URL__ = '/api/rum';
    install();
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 0 });
    key();
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 1 });
    drawMarine(1);
    key();
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 2 });
    drawMarine(2);
    expect(later).not.toHaveBeenCalled();                               // re-armed at most every 2 s
    advance(2000);
    expect(later).toHaveBeenCalledTimes(1);
    const [url, init] = later.mock.calls[0];
    expect(url).toBe('/api/rum');
    expect(JSON.parse(init.body).p2f).toHaveLength(2);
    expect(JSON.parse(init.body).why).toBe('destroyed');
    const armed = init.signal;
    window.dispatchEvent(new Event('pagehide'));                        // the hide beacon replaces the armed one
    expect(armed.aborted).toBe(true);
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it('the record is capped: 150 rows per batch, the rest counted', () => {
    install();
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 0 });
    for (let h = 1; h <= 160; h++) {
      key();
      noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: h });
      drawMarine(h);
    }
    expect(rows()).toHaveLength(150);
    expect(window.__RAW_RUM__.pending().lost.overflow).toBe(10);
    const out = flushInstantTelemetry('hidden');
    expect(out.bytes).toBeLessThanOrEqual(8192);
  });
});
