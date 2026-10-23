import {
  _resetInstantTelemetryForTest, flushInstantTelemetry, HIST_EDGES, installInstantTelemetry, noteWeatherAsk, pySize, rumEndpoint, rumSampled,
} from './instantTelemetry';
import { _resetMarineDrawnForTest, publishMarineDrawn, publishWindDrawn } from './marineDrawnFrame';

// FIELD TELEMETRY (skills audit #3, 2026-10-23): press-to-frame on sampled pages, LoAF, INP with attribution, one report per hide
// to the existing bounded POST /api/weather/client-diagnostics.
describe('instantTelemetry', () => {
  let clock;
  const advance = (ms) => { clock += ms; jest.advanceTimersByTime(ms); };
  const key = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  const drawMarine = (hour, model = 'GFS', layer = 'waves') => publishMarineDrawn({ hourOffset: hour, __sourceModel: model, __componentLayer: layer });
  const batch = () => window.__RAW_RUM__.pending();
  const rows = () => batch().rows;
  const install = (opts = {}) => installInstantTelemetry({ sampled: true, loadVitals: () => null, ...opts });
  const histTotal = (h) => (h ? h.reduce((a, b) => a + b, 0) : 0);

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

  it('the endpoint: none in a test/dev build, a window override (empty = nowhere)', () => {
    expect(rumEndpoint()).toBeNull();
    window.__RAW_RUM_URL__ = '/api/weather/client-diagnostics';
    expect(rumEndpoint()).toBe('/api/weather/client-diagnostics');
    window.__RAW_RUM_URL__ = '';
    expect(rumEndpoint()).toBeNull();
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
    expect(rows()).toEqual([[0, 0, 45, null, 'GFS', 'waves', 2, 0]]);
    expect(batch().hist).toEqual({ 'marine.step': [0, 0, 1, 0, 0, 0, 0, 0, 0, 0] });   // 45 ms: the <= 50 ms bin
  });

  it('a frame drawn BEFORE the ask reached telemetry (a resident frame) still counts from the press', () => {
    install();
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 3 });
    key();
    advance(4);
    drawMarine(4);
    advance(6);
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 4 });
    expect(rows()).toEqual([[0, 0, 10, null, 'GFS', 'waves', 2, 0]]);
  });

  it('a draw from BEFORE the press never answers it: Waves off and on again waits for a new frame, not the old record', () => {
    install();
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 0 });
    drawMarine(0);                                                      // on screen before anything below
    advance(500);
    noteWeatherAsk({ model: 'GFS', layers: [], hour: 0 });              // Waves off (the engine clears; no new drawn record)
    advance(500);
    key();
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 0 });       // on again: the old record matches the ask, but is stale
    expect(rows()).toEqual([]);
    advance(40);
    drawMarine(0);
    expect(rows()).toEqual([[0, 1, 40, null, 'GFS', 'waves', 2, 0]]);
  });

  it('a drag counts while the button is held; a newer ask supersedes; nothing drawn in 8 s is a timeout', () => {
    install();
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 0 });
    window.dispatchEvent(new MouseEvent('pointermove', { buttons: 0 }));   // a hover is not a press
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 1 });
    expect(batch().lost).toEqual({ superseded: 0, timeout: 0 });
    window.dispatchEvent(new MouseEvent('pointermove', { buttons: 1 }));
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 2 });
    advance(30);
    window.dispatchEvent(new MouseEvent('pointermove', { buttons: 1 }));
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 3 });
    advance(12);
    drawMarine(3);
    expect(rows()).toEqual([[0, 0, 12, null, 'GFS', 'waves', 1, 0]]);
    expect(batch().lost.superseded).toBe(1);
    window.dispatchEvent(new MouseEvent('pointermove', { buttons: 1 }));
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 4 });
    advance(8000);
    expect(batch().lost.timeout).toBe(1);
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
    expect(batch().hist).toEqual({});
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
        [0, 2, 7, 4.3, 'EURO', 'waves', 2, 0],
        [1, 1, 9, 4.3, 'EURO', 'wind', 2, null],
        [0, 2, 5, 4.3, 'ICON', 'waves', 2, 0],
      ]);
      expect(Object.keys(batch().hist).sort()).toEqual(['marine.model', 'wind.layer']);
      expect(batch().lost.superseded).toBe(0);
    } finally {
      delete window.__MAP_INSTANCE__;
    }
  });

  it('long animation frames: totals plus the worst four, scripts named by file without a query string', () => {
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
    const L = batch().loaf;
    expect(L.n).toBe(7);
    expect(L.over200).toBe(2);
    expect(L.blockMs).toBe(955 - 350);
    expect(L.worst.map((w) => w.d)).toEqual([300, 250, 120, 90]);
    expect(L.worst[0].s).toEqual([{ f: 'main.abc.js', fn: 'tick', inv: 'FrameRequestCallback', d: 295 },
      { f: '942.chunk.js', fn: 'decode', inv: 'https://x.test/a.js', d: 1 }]);
  });

  it('one report per hide to the sink, shaped as the route expects; nothing new, no request; no endpoint, nothing sent', async () => {
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
    const local = flushInstantTelemetry('hidden');                     // no endpoint (test build): published, not sent
    expect(local.via).toBeNull();
    expect(beacon).not.toHaveBeenCalled();
    expect(window.__RAW_RUM__.last.details.p2f).toEqual([[0, 0, 30, null, 'GFS', 'waves', 2, 0]]);
    expect(window.__RAW_RUM__.last.details.inp).toEqual({ v: 180, r: 'good', t: 'pointerdown', el: 'div.forecast-wheel>button', ls: 'complete' });

    window.__RAW_RUM_URL__ = '/api/weather/client-diagnostics';
    expect(flushInstantTelemetry('hidden')).toBeNull();                 // nothing new since the last flush
    key();
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 2 });
    advance(12);
    drawMarine(2);
    document.dispatchEvent(new Event('visibilitychange'));              // jsdom: visibilityState stays 'visible'
    expect(beacon).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0][0]).toBe('/api/weather/client-diagnostics');
    expect(beacon.mock.calls[0][1].type).toBe('application/json');
    const sent = window.__RAW_RUM__.last;
    // ClientDiagnosticReport: timestamp (ISO datetime), event_type <= 120 chars, correlationId <= 120, details a dict <= 4096 B
    expect(Object.keys(sent).sort()).toEqual(['correlationId', 'details', 'event_type', 'timestamp']);
    expect(sent.event_type).toBe('instant_rum');
    expect(Number.isFinite(Date.parse(sent.timestamp))).toBe(true);
    expect(sent.correlationId).toMatch(/^[0-9a-f]{1,8}$/);
    expect(sent.details.why).toBe('pagehide');
    expect(sent.details.p2f).toEqual([[0, 0, 12, null, 'GFS', 'waves', 2, 0]]);
    expect(sent.details.cols).toEqual(['fam', 'kind', 'ms', 'zoom', 'model', 'layer', 'input', 'src']);
    expect(sent.details.edges).toEqual(HIST_EDGES);
    expect(pySize(JSON.stringify(sent.details))).toBeLessThanOrEqual(3900);
    expect(JSON.stringify(sent)).not.toMatch(/localhost|http:/);       // no page URL in the record
  });

  it('pySize is an upper bound on what Python json.dumps writes (a space after each , and :)', () => {
    expect(pySize('{"a":[1,2],"b":"x"}')).toBe('{"a": [1, 2], "b": "x"}'.length);
    expect(pySize('{"s":"a,b:c"}')).toBeGreaterThanOrEqual('{"s": "a,b:c"}'.length);
    const e = String.fromCharCode(233);   // json.dumps (ensure_ascii) writes it as a 6-byte escape: 34 bytes in all below
    expect(pySize('{"el":"div.vagues-' + e + 't' + e + '"}')).toBe('{"el": "div.vagues-XXXXXXtXXXXXX"}'.length);
  });

  it('fetchLater, where the browser has it, carries the current batch in case the page dies without a hide', () => {
    const later = jest.fn();
    window.fetchLater = later;
    const beacon = jest.fn(() => true);
    Object.defineProperty(window.navigator, 'sendBeacon', { configurable: true, value: beacon });
    window.__RAW_RUM_URL__ = '/api/weather/client-diagnostics';
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
    expect(url).toBe('/api/weather/client-diagnostics');
    expect(JSON.parse(init.body).details.p2f).toHaveLength(2);
    expect(JSON.parse(init.body).details.why).toBe('destroyed');
    const armed = init.signal;
    window.dispatchEvent(new Event('pagehide'));                        // the hide beacon replaces the armed one
    expect(armed.aborted).toBe(true);
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it('a long session: every press in the histogram, the newest 50 rows in detail, and the report stays under the bound', () => {
    let cb = null;
    window.PerformanceObserver = class { constructor(fn) { cb = fn; } observe() {} disconnect() {} };
    window.PerformanceObserver.supportedEntryTypes = ['long-animation-frame'];
    window.__MAP_INSTANCE__ = { getZoom: () => 12.345 };
    try {
      install();
      cb({ getEntries: () => [400, 380, 360, 340, 320].map((d) => ({ duration: d, blockingDuration: d - 50, startTime: 123456,
        scripts: [{ sourceURL: `https://site.test/static/js/${'x'.repeat(70)}.chunk.js`, sourceFunctionName: 'y'.repeat(50), invoker: 'z'.repeat(80), duration: d },
          { sourceURL: 'https://site.test/static/js/main.js', sourceFunctionName: 'w'.repeat(50), invoker: 'q'.repeat(80), duration: d }] })) });
      noteWeatherAsk({ model: 'GFS', layers: ['swell_2', 'wind'], hour: 0 });
      for (let h = 1; h <= 160; h++) {
        key();
        noteWeatherAsk({ model: 'GFS', layers: ['swell_2', 'wind'], hour: h });
        advance(h * 10);
        drawMarine(h, 'GFS', 'swell_2');
        publishWindDrawn({ hourOffset: h, model: 'GFS' });
      }
      expect(rows()).toHaveLength(50);
      expect(rows()[49][2]).toBe(1600);                                  // the newest kept
      expect(histTotal(batch().hist['marine.step'])).toBe(160);
      expect(histTotal(batch().hist['wind.step'])).toBe(160);
      const out = flushInstantTelemetry('hidden');
      expect(out.detailsBytes).toBeLessThanOrEqual(3900);
      expect(histTotal(out.report.details.hist['marine.step'])).toBe(160);   // trimming drops rows, never the counts
      expect(out.report.details.loaf.n).toBe(5);
    } finally {
      delete window.__MAP_INSTANCE__;
    }
  });
  it('frame-store hit or miss, per marine layer and zoom band, on every timed press', () => {
    window.__MAP_INSTANCE__ = { getZoom: () => 4.6 };
    try {
      install();
      noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 0 });
      key();
      noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 1 });
      publishMarineDrawn({ hourOffset: 1, __sourceModel: 'GFS', __componentLayer: 'waves', __fromFrameStore: true });
      key();
      noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 2 });
      drawMarine(2);                                                      // the normal path drew it
      expect(rows().map((r) => r[7])).toEqual([1, 0]);
      expect(batch().store).toEqual({ 'waves|z4': [1, 1] });
    } finally {
      delete window.__MAP_INSTANCE__;
    }
  });

  it('scrub velocity and jump size: the gap between step presses and the hours jumped, presses only', () => {
    install();
    noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 0 });
    key(); noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 1 });            // first step: a jump, no gap yet
    advance(80); key(); noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 2 }); // 80 ms: a held key
    advance(400); key(); noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 26 }); // 400 ms, 24 h: a day jump
    advance(5000); noteWeatherAsk({ model: 'GFS', layers: ['waves'], hour: 27 });   // no press within 1 s (autoplay-like): not counted
    expect(batch().jump).toEqual([2, 0, 0, 1, 0]);
    expect(batch().gap).toEqual([1, 0, 1, 0, 0, 0]);
  });

  it('server fallbacks: /grid, /grid_series and /point requests from Resource Timing, counted with their time', () => {
    const cbs = {};
    window.PerformanceObserver = class { constructor(fn) { this.fn = fn; } observe(o) { cbs[o.type] = this.fn; } disconnect() {} };
    window.PerformanceObserver.supportedEntryTypes = ['resource'];
    install();
    cbs.resource({ getEntries: () => [
      { name: 'https://x.test/api/weather/grid?model=GFS&bbox=1', duration: 300.4 },
      { name: 'https://x.test/api/weather/grid_series?hours=48', duration: 1200 },
      { name: 'https://x.test/api/weather/grid?model=EURO', duration: 99.6 },
      { name: 'https://x.test/api/weather/point?lat=1', duration: 50 },
      { name: 'https://x.test/api/weather/capabilities', duration: 10 },
      { name: 'https://cdn.test/weather-frames/v1/latest.json', duration: 5 },
    ] });
    expect(batch().backend).toEqual({ grid: [2, 400], grid_series: [1, 1200], point: [1, 50] });
  });
});
