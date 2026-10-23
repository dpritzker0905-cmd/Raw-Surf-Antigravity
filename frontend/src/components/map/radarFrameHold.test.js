import { radarFrameTiming, holdRadarFrame, forgetShownRadarFrame } from './radarFrameHold';

afterEach(() => { delete window.__RAW_DISABLE_RADAR_FRAME_HOLD__; delete window.__RAW_RADAR_FADE_MS__; delete window.__RAW_RADAR_FRAME_HOLD__; forgetShownRadarFrame(); });

// A MapLibre stand-in: frame layers with an opacity, sources with a loaded flag + tile count, and events.
function fakeMap(frames) {
  const handlers = {};
  return {
    frames,
    getLayer: (id) => (frames[id] ? { id } : undefined),
    getSource: (id) => (frames[id] ? {} : undefined),
    isSourceLoaded: (id) => !!(frames[id] && frames[id].loaded),
    style: { tileManagers: Object.fromEntries(Object.keys(frames).map((id) => [id, { _inViewTiles: { getAllTiles: () => new Array(frames[id].tiles || 0).fill({}) } }])) },
    setPaintProperty: (id, prop, v) => { frames[id].opacity = v; },
    on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
    off: (ev, fn) => { handlers[ev] = (handlers[ev] || []).filter((h) => h !== fn); },
    fire: (ev) => (handlers[ev] || []).slice().forEach((h) => h()),
    listeners: (ev) => (handlers[ev] || []).length,
  };
}

test('hard cut timing; kill restores the 250 ms cross-fade; an explicit fade lever wins', () => {
  expect(radarFrameTiming(180)).toEqual({ 'raster-opacity-transition': { duration: 0, delay: 0 }, 'raster-fade-duration': 0 });
  window.__RAW_RADAR_FADE_MS__ = 90;
  expect(radarFrameTiming(90)['raster-fade-duration']).toBe(90);
  window.__RAW_DISABLE_RADAR_FRAME_HOLD__ = true;
  expect(radarFrameTiming(180)).toEqual({ 'raster-opacity-transition': { duration: 250 }, 'raster-fade-duration': 180 });
});

test('first frame: shown as it loads (nothing to hold); the status pair says loading until its tiles are in', () => {
  const m = fakeMap({ a: { opacity: 0.8, loaded: false, tiles: 4 } });
  const times = { a: Date.UTC(2026, 9, 22, 21, 30) };
  const release = holdRadarFrame(m, 'a', 0.8, (id) => times[id]);
  expect(m.frames.a.opacity).toBe(0.8);
  expect(window.__RASTER_DRAWN__).toMatchObject({ layer: 'radar', shown: null, want: { url: 'a' } });
  m.frames.a.loaded = true; m.fire('sourcedata');
  expect(window.__RASTER_DRAWN__).toMatchObject({ shown: { url: 'a' }, want: { url: 'a' } });
  expect(m.listeners('sourcedata')).toBe(0);
  expect(typeof release).toBe('function');
});

test('next frame not loaded: the shown frame stays, then ONE swap when the new one is ready', () => {
  const m = fakeMap({ a: { opacity: 0.8, loaded: true, tiles: 4 }, b: { opacity: 0, loaded: true, tiles: 4 } });
  holdRadarFrame(m, 'a', 0.8);                        // a on screen
  m.frames.a.opacity = 0; m.frames.b.opacity = 0.8;   // the manager asks for b
  m.frames.b.loaded = false;
  const release = holdRadarFrame(m, 'b', 0.8);
  expect(m.frames.a.opacity).toBe(0.8);
  expect(m.frames.b.opacity).toBe(0);
  m.fire('sourcedata');                               // still loading: nothing moves
  expect(m.frames.a.opacity).toBe(0.8);
  m.frames.b.loaded = true; m.fire('sourcedata');
  expect(m.frames.b.opacity).toBe(0.8);
  expect(m.frames.a.opacity).toBe(0);
  expect(m.listeners('sourcedata')).toBe(0);
  expect(typeof release).toBe('function');
});

test('next frame already loaded: swapped at once', () => {
  const m = fakeMap({ a: { opacity: 0.8, loaded: true, tiles: 4 }, b: { opacity: 0.8, loaded: true, tiles: 4 } });
  holdRadarFrame(m, 'a', 0.8);
  m.frames.a.opacity = 0;
  expect(holdRadarFrame(m, 'b', 0.8)).toBeUndefined();
  expect(m.frames.b.opacity).toBe(0.8);
  expect(m.frames.a.opacity).toBe(0);
});

test('a hidden source reading loaded with no tiles is not ready', () => {
  const m = fakeMap({ a: { opacity: 0.8, loaded: true, tiles: 4 }, b: { opacity: 0.8, loaded: true, tiles: 0 } });
  holdRadarFrame(m, 'a', 0.8);
  m.frames.a.opacity = 0;
  holdRadarFrame(m, 'b', 0.8);
  expect(m.frames.a.opacity).toBe(0.8);
});

test('killed: no hold, the manager opacities stand', () => {
  window.__RAW_DISABLE_RADAR_FRAME_HOLD__ = true;
  const m = fakeMap({ a: { opacity: 0.8, loaded: true, tiles: 4 }, b: { opacity: 0.8, loaded: false, tiles: 4 } });
  holdRadarFrame(m, 'a', 0.8); m.frames.a.opacity = 0;
  expect(holdRadarFrame(m, 'b', 0.8)).toBeUndefined();
  expect(m.frames.b.opacity).toBe(0.8);
  expect(m.frames.a.opacity).toBe(0);
});
