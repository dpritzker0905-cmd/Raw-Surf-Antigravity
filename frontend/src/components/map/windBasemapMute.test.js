/**
 * BASEMAP MUTE UNDER THE WIND (2026-10-09): the owner's "ambiguity to the wind color vs the color of the map" in light and
 * beach. The path bench (scripts/wind-bench/path-run.js) measured the hue fidelity these tests protect; here: the colour
 * maths, the plan over a style, and the sync's safety (idempotent, exact restore, never a stale colour written back).
 */
import fs from 'fs';
import path from 'path';
import {
  WIND_BASEMAP_MUTE, windBasemapMuteAmount, windBasemapWaterL, parseColor, oklab, muteColor, muteValue, windBasemapMutePlan, syncWindBasemapMute,
  windBasemapImagery, windBasemapMuteStale,
} from './windBasemapMute';

const close = (a, b, eps) => Math.abs(a - b) <= eps;

describe('parseColor reads the colour forms the Mapbox styles use, and nothing else', () => {
  it.each([
    ['#fff', [255, 255, 255, 1]], ['#a0c8f0', [160, 200, 240, 1]], ['#a0c8f080', [160, 200, 240, 128 / 255]],
    ['rgb(10, 20, 30)', [10, 20, 30, 1]], ['rgba(10,20,30,0.5)', [10, 20, 30, 0.5]], ['white', [255, 255, 255, 1]],
  ])('%s', (s, want) => { parseColor(s).forEach((v, i) => expect(v).toBeCloseTo(want[i], 6)); });
  it('hsl / hsla (legacy comma syntax)', () => {
    const c = parseColor('hsl(200, 50%, 70%)');
    expect(c.slice(0, 3).map(Math.round)).toEqual([140, 191, 217]);
    expect(parseColor('hsla(120, 100%, 25%, 0.4)').map((v) => +v.toFixed(3))).toEqual([0, 127.5, 0, 0.4]);
  });
  it('class names and expression operators are not colours (the walk must leave them alone)', () => {
    for (const s of ['park', 'sand', 'tan', 'interpolate', 'get', 'class', '', 'hsl(', '#12']) expect(parseColor(s)).toBeNull();
  });
});

describe('muteColor removes chroma, keeps lightness and alpha', () => {
  it('OKLab L kept, chroma scaled by 1 - amount', () => {
    for (const s of ['hsl(196, 80%, 70%)', 'hsl(100, 45%, 80%)', '#e6d3a8', 'rgb(168, 214, 222)']) {
      const [L0, a0, b0] = oklab(parseColor(s)), m = parseColor(muteColor(s, 0.85)), [L1, a1, b1] = oklab(m);
      expect(close(L1, L0, 0.004)).toBe(true);
      expect(close(Math.hypot(a1, b1), 0.15 * Math.hypot(a0, b0), 0.004)).toBe(true);
    }
  });
  it('alpha is kept; amount 0 and non-colours come back untouched; waterL darkens', () => {
    expect(parseColor(muteColor('hsla(196, 80%, 70%, 0.4)', 0.85))[3]).toBeCloseTo(0.4, 6);
    expect(muteColor('hsl(196, 80%, 70%)', 0)).toBe('hsl(196, 80%, 70%)');
    expect(muteColor('park', 0.85)).toBe('park');
    const L = (s) => oklab(parseColor(s))[0];
    expect(close(L(muteColor('rgb(168, 214, 222)', 0.85, 0.92)), 0.92 * L('rgb(168, 214, 222)'), 0.004)).toBe(true);
  });
});

describe('muteValue walks expressions and legacy functions without changing their structure', () => {
  it('interpolate and match: colours muted, operators, inputs and class labels kept', () => {
    const expr = ['match', ['get', 'class'], 'park', 'hsl(100, 50%, 80%)', 'sand', ['interpolate', ['linear'], ['zoom'], 5, '#e6d3a8', 12, 'hsl(50, 40%, 85%)'], 'hsl(0, 0%, 90%)'];
    const out = muteValue(expr, 0.85);
    expect(out.length).toBe(expr.length);
    expect(out[0]).toBe('match'); expect(out[1]).toEqual(['get', 'class']); expect(out[2]).toBe('park'); expect(out[4]).toBe('sand');
    expect(out[5].slice(0, 3)).toEqual(['interpolate', ['linear'], ['zoom']]);
    expect(out[3]).toMatch(/^rgba\(/); expect(out[5][4]).toMatch(/^rgba\(/); expect(out[6]).toMatch(/^rgba\(/);
  });
  it('legacy {base, stops}', () => {
    const out = muteValue({ base: 1.2, stops: [[5, 'hsl(196, 80%, 70%)'], [10, '#a0c8f0']] }, 0.85);
    expect(out.base).toBe(1.2);
    expect(out.stops[0][0]).toBe(5);
    expect(out.stops[1][1]).toMatch(/^rgba\(/);
  });
});

const STYLE = () => [
  { id: 'land', type: 'background', paint: { 'background-color': 'hsl(35, 12%, 89%)' } },
  { id: 'landcover', type: 'fill', paint: { 'fill-color': ['match', ['get', 'class'], 'wood', 'hsl(100, 40%, 70%)', 'hsl(80, 30%, 80%)'], 'fill-opacity': 0.6 } },
  { id: 'hillshade', type: 'hillshade', paint: { 'hillshade-shadow-color': 'hsl(56, 59%, 22%)' } },
  { id: 'water', type: 'fill', paint: { 'fill-color': 'hsl(196, 80%, 70%)' } },
  { id: 'waterway', type: 'line', paint: { 'line-color': 'hsl(196, 80%, 70%)' } },
  { id: 'road-primary', type: 'line', paint: { 'line-color': 'hsl(45, 90%, 60%)' } },
  { id: 'building', type: 'fill-extrusion', paint: { 'fill-extrusion-color': 'hsl(35, 8%, 85%)' } },
  { id: 'wind', type: 'custom' },
  { id: 'admin-1-boundary', type: 'line', paint: { 'line-color': 'hsl(0, 0%, 60%)' } },
  { id: 'place-label', type: 'symbol', paint: { 'text-color': 'hsl(0, 0%, 20%)' } },
  { id: 'water-label', type: 'symbol', paint: { 'text-color': 'hsl(196, 60%, 40%)' } },
];

describe('windBasemapMutePlan: the area colours under the wind, nothing above it', () => {
  const plan = windBasemapMutePlan(STYLE(), 'wind', 0.85, 0.92), byId = (id) => plan.filter((p) => p.id === id);
  it('mutes background, fills, hillshade, extrusions and the water lines', () => {
    expect(new Set(plan.map((p) => p.id))).toEqual(new Set(['land', 'landcover', 'hillshade', 'water', 'waterway', 'building']));
  });
  it('satellite: a style with imagery under the wind keeps its photo (nothing muted)', () => {
    const sat = [{ id: 'satellite', type: 'raster', paint: {} }, ...STYLE()];
    expect(windBasemapMutePlan(sat, 'wind', 0.85, 0.9)).toEqual([]);
  });
  it('leaves roads (navigation colour), everything above the wind (borders, labels) and opacities alone', () => {
    expect(byId('road-primary')).toEqual([]);
    expect(byId('admin-1-boundary')).toEqual([]);
    expect(byId('water-label')).toEqual([]);
    expect(plan.some((p) => /opacity/.test(p.prop))).toBe(false);
  });
  it('waterL darkens the water layers only', () => {
    const L = (s) => oklab(parseColor(s))[0];
    expect(close(L(byId('water')[0].to), 0.92 * L('hsl(196, 80%, 70%)'), 0.004)).toBe(true);
    expect(close(L(byId('land')[0].to), L('hsl(35, 12%, 89%)'), 0.004)).toBe(true);
  });
  it('nothing to do at amount 0, without layers, or for an unknown wind id (whole list: only reachable via sync guard)', () => {
    expect(windBasemapMutePlan(STYLE(), 'wind', 0)).toEqual([]);
    expect(windBasemapMutePlan(null, 'wind', 0.85)).toEqual([]);
  });
});

describe('levers and defaults', () => {
  it('pinned defaults: light and beach 0.85 chroma off; water lightness light x0.90, beach x0.94; dark untouched', () => {
    // path bench: the hue holds from 0.85; water x0.90 keeps light's coast above today's; x0.94 is the darkest beach
    // water at which its tint keeps the colour-blind floor of 5 (windPaletteCvd.test.js)
    expect(WIND_BASEMAP_MUTE.amount).toEqual({ light: 0.85, beach: 0.85 });
    expect(WIND_BASEMAP_MUTE.waterL).toEqual({ light: 0.9, beach: 0.94 });
    expect(windBasemapMuteAmount('dark', {})).toBe(0);
    expect(windBasemapWaterL('dark', {})).toBe(1);
  });
  it('lever (any theme), out-of-range lever ignored, kill wins', () => {
    expect(windBasemapMuteAmount('dark', { __RAW_WIND_BASEMAP_MUTE__: 0.5 })).toBe(0.5);
    expect(windBasemapMuteAmount('light', { __RAW_WIND_BASEMAP_MUTE__: 3 })).toBe(0.85);
    expect(windBasemapMuteAmount('light', { __RAW_DISABLE_WIND_BASEMAP_MUTE__: true, __RAW_WIND_BASEMAP_MUTE__: 0.5 })).toBe(0);
    expect(windBasemapWaterL('beach', { __RAW_WIND_BASEMAP_WATER_L__: 0.85 })).toBe(0.85);
  });
});

/**
 * A map that keeps a live style (paint values as set) and counts writes. Like MapLibre (5.24 _serializedAllLayers),
 * getStyle() LEAVES CUSTOM LAYERS OUT: the wind layer's own slot is only in style._order.
 */
function fakeMap(layers = STYLE()) {
  const live = new Map(layers.map((l) => [l.id, JSON.parse(JSON.stringify(l))]));
  const map = {
    style: { _order: layers.map((l) => l.id) }, writes: 0, failOn: null,
    getLayer: (id) => live.get(id),
    getStyle: () => ({ layers: [...live.values()].filter((l) => l.type !== 'custom').map((l) => JSON.parse(JSON.stringify(l))) }),
    getPaintProperty: (id, p) => (live.get(id).paint || {})[p],
    getLayoutProperty: (id, p) => (live.get(id).layout || {})[p],
    setLayoutProperty: (id, p, v) => { const l = live.get(id); l.layout = { ...(l.layout || {}), [p]: v }; },
    setPaintProperty: (id, p, v) => {
      if (map.failOn === id) { map.failOn = null; throw new Error('style mid-load'); }
      map.writes++; const l = live.get(id); l.paint = l.paint || {}; if (v === undefined) delete l.paint[p]; else l.paint[p] = JSON.parse(JSON.stringify(v));
    },
    paint: () => JSON.stringify([...live.values()].map((l) => l.paint)),
  };
  return map;
}

/**
 * THE APP'S STACK around the basemap (MapWebGL.js, OceanMask.js; pinned by the wiring tests below). The app keeps its
 * satellite photo and 18 weather-wash slots MOUNTED AND HIDDEN under the wind layer, the ocean mask's own fills too, and
 * draws radar frames above it. `on` shows layers by id prefix (visibility), `opacity` gives the shown ones an opacity.
 */
const WASHES = ['rain', 'satellite', 'pressure', 'temperature', 'water_temp', 'fog'];
function APP({ on = [], opacity = ['interpolate', ['linear'], ['zoom'], 2, 0.6, 12, 0.78] } = {}) {
  const shown = (id) => on.some((p) => id.startsWith(p));
  const raster = (id, op) => ({ id, type: 'raster', layout: { visibility: shown(id) ? 'visible' : 'none' }, paint: { 'raster-opacity': shown(id) ? op : 0 } });
  const S = STYLE(), out = [];
  for (const l of S) {
    if (l.id === 'landcover') out.push(raster('esri-satellite-layer', 1), { id: 'ocean-mask-fill', type: 'fill', layout: { visibility: 'none' }, paint: { 'fill-color': 'hsl(40, 30%, 85%)' } }, { id: 'ocean-mask-inland-water', type: 'fill', layout: { visibility: 'none' }, paint: { 'fill-color': 'hsl(196, 80%, 70%)' } });
    if (l.id === 'wind') out.push(...WASHES.flatMap((k) => [0, 1, 2].map((s) => raster(`${k}-slot-${s}-layer`, s === 1 ? opacity : 0))));
    out.push(l);
    if (l.id === 'wind') out.push({ id: 'park-above', type: 'fill', paint: { 'fill-color': 'hsl(100, 45%, 80%)' } });
  }
  out.push({ id: 'rv-radar-frame', type: 'raster', paint: { 'raster-opacity': 0.8 } }, { id: 'spot-geofences-layer', type: 'circle', paint: { 'circle-color': '#06b6d4' } });
  return out;
}
const BASEMAP_AREAS = ['land', 'landcover', 'hillshade', 'water', 'waterway', 'building'];

describe('THE APP\'S STACK (live dev 2026-10-09: __WIND_BASEMAP_MUTE__ read { applied: true, layers: 0 }; nothing was muted)', () => {
  it('hidden satellite and weather slots under the wind do NOT stand the mute down: the basemap is muted', () => {
    const plan = windBasemapMutePlan(APP(), 'wind', 0.85, 0.9);
    expect(new Set(plan.map((p) => p.id))).toEqual(new Set(BASEMAP_AREAS));
    expect(windBasemapImagery(APP(), 'wind')).toBeNull();
  });
  it('a satellite photo SHOWING under the wind still keeps its map (positive control)', () => {
    const sat = APP({ on: ['esri-satellite'] });
    expect(windBasemapImagery(sat, 'wind')).toBe('esri-satellite-layer');
    expect(windBasemapMutePlan(sat, 'wind', 0.85, 0.9)).toEqual([]);
  });
  it('a weather wash showing under the wind stands it down too (unmeasured with the mute: today\'s look is kept)', () => {
    const rain = APP({ on: ['rain-slot'] });
    expect(windBasemapImagery(rain, 'wind')).toBe('rain-slot-1-layer');     // slots 0 and 2 are visible at opacity 0
    expect(windBasemapMutePlan(rain, 'wind', 0.85, 0.9)).toEqual([]);
  });
  it('visible at opacity 0 is not on screen; a raster ABOVE the wind (radar) is not under it', () => {
    expect(windBasemapImagery(APP({ on: ['fog-slot'], opacity: 0 }), 'wind')).toBeNull();
    expect(APP().some((l) => l.id === 'rv-radar-frame' && l.type === 'raster' && !(l.layout || {}).visibility)).toBe(true);
    expect(windBasemapImagery(APP(), 'wind')).toBeNull();
  });
  it('the ocean mask\'s own layers are left to OceanMask (it repaints them on its own sync)', () => {
    expect(windBasemapMutePlan(APP(), 'wind', 0.85, 0.9).some((p) => /^ocean-mask-/.test(p.id))).toBe(false);
  });
  it('the sync finds the wind layer\'s slot although getStyle() leaves custom layers out: nothing above it is touched', () => {
    const map = fakeMap(APP()), win = {};
    expect(map.getStyle().layers.some((l) => l.id === 'wind')).toBe(false);
    expect(syncWindBasemapMute(map, 'light', true, 'wind', win)).toMatchObject({ applied: true, layers: 6, amount: 0.85 });
    expect(map.getPaintProperty('park-above', 'fill-color')).toBe('hsl(100, 45%, 80%)');
    expect(map.getPaintProperty('water', 'fill-color')).toBe(muteColor('hsl(196, 80%, 70%)', 0.85, 0.9));
  });
  it('read-back says WHY nothing is muted: applied is false with the imagery\'s id, never true with 0 layers', () => {
    const map = fakeMap(APP({ on: ['esri-satellite'] })), win = {}, before = map.paint();
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    expect(win.__WIND_BASEMAP_MUTE__).toMatchObject({ applied: false, layers: 0, amount: 0, reason: 'imagery:esri-satellite-layer' });
    expect(map.paint()).toBe(before);
    const bare = fakeMap([{ id: 'road', type: 'line', paint: { 'line-color': '#fff' } }, { id: 'wind', type: 'custom' }]);
    expect(syncWindBasemapMute(bare, 'light', true, 'wind', {})).toMatchObject({ applied: false, layers: 0 });
  });
  it('satellite switched on while muted: stale, restored exactly; switched off again: stale, muted again; steady: no work', () => {
    const map = fakeMap(APP()), before = map.paint();
    expect(windBasemapMuteStale(map, 'beach', true, 'wind', {})).toBe(true);          // wind on, not muted yet
    syncWindBasemapMute(map, 'beach', true, 'wind', {});
    const muted = map.paint(), w = map.writes;
    expect(windBasemapMuteStale(map, 'beach', true, 'wind', {})).toBe(false);
    map.setLayoutProperty('esri-satellite-layer', 'visibility', 'visible');
    map.setPaintProperty('esri-satellite-layer', 'raster-opacity', 1);
    expect(windBasemapMuteStale(map, 'beach', true, 'wind', {})).toBe(true);
    expect(syncWindBasemapMute(map, 'beach', true, 'wind', {})).toMatchObject({ applied: false, reason: 'imagery:esri-satellite-layer' });
    expect(JSON.parse(map.paint()).filter((p) => !p || p['raster-opacity'] === undefined)).toEqual(JSON.parse(before).filter((p) => !p || p['raster-opacity'] === undefined));
    expect(windBasemapMuteStale(map, 'beach', true, 'wind', {})).toBe(false);
    map.setLayoutProperty('esri-satellite-layer', 'visibility', 'none');
    expect(windBasemapMuteStale(map, 'beach', true, 'wind', {})).toBe(true);
    expect(syncWindBasemapMute(map, 'beach', true, 'wind', {})).toMatchObject({ applied: true, layers: 6 });
    expect(JSON.parse(map.paint())[0]).toEqual(JSON.parse(muted)[0]);
    expect(map.writes).toBeGreaterThan(w);
    expect(windBasemapMuteStale(map, 'beach', false, 'wind', {})).toBe(true);         // wind off while muted
    expect(windBasemapMuteStale(map, 'dark', true, 'wind', {})).toBe(true);           // another theme's amount
  });
  it('a write that throws part-way is undone by the next sync, and the re-plan starts from the ORIGINAL colours', () => {
    const map = fakeMap(APP());
    map.failOn = 'water';
    expect(syncWindBasemapMute(map, 'light', true, 'wind', {})).toMatchObject({ applied: false, error: 'style mid-load' });
    expect(syncWindBasemapMute(map, 'light', true, 'wind', {})).toMatchObject({ applied: true, layers: 6 });
    expect(map.getPaintProperty('land', 'background-color')).toBe(muteColor('hsl(35, 12%, 89%)', 0.85));   // muted once, not twice
    expect(map.getPaintProperty('water', 'fill-color')).toBe(muteColor('hsl(196, 80%, 70%)', 0.85, 0.9));
  });
});

describe('syncWindBasemapMute', () => {
  it('mutes while the wind is on, is idempotent, and restores the exact original colours', () => {
    const map = fakeMap(), before = map.paint();
    const r = syncWindBasemapMute(map, 'light', true, 'wind', {});
    expect(r).toMatchObject({ applied: true, layers: 6, amount: 0.85 });
    expect(map.paint()).not.toBe(before);
    const w = map.writes;
    expect(syncWindBasemapMute(map, 'light', true, 'wind', {}).applied).toBe(true);
    expect(map.writes).toBe(w);                                  // no second write
    expect(syncWindBasemapMute(map, 'light', false, 'wind', {}).applied).toBe(false);
    expect(map.paint()).toBe(before);
  });
  it('never mutes without the wind layer (the plan would reach the labels), nor in dark by default', () => {
    const map = fakeMap(STYLE().filter((l) => l.id !== 'wind')), before = map.paint();
    expect(syncWindBasemapMute(map, 'light', true, 'wind', {}).applied).toBe(false);
    expect(syncWindBasemapMute(fakeMap(), 'dark', true, 'wind', {}).applied).toBe(false);
    expect(map.paint()).toBe(before);
  });
  it('read-back: window.__WIND_BASEMAP_MUTE__ records the last sync', () => {
    const map = fakeMap(), win = {};
    syncWindBasemapMute(map, 'beach', true, 'wind', win);
    expect(win.__WIND_BASEMAP_MUTE__).toMatchObject({ applied: true, layers: 6, amount: 0.85, waterL: 0.94, theme: 'beach' });
    syncWindBasemapMute(map, 'beach', false, 'wind', win);
    expect(win.__WIND_BASEMAP_MUTE__).toMatchObject({ applied: false, layers: 0, amount: 0, theme: 'beach' });
  });
  it('the kill switch restores on the next sync', () => {
    const map = fakeMap(), before = map.paint();
    syncWindBasemapMute(map, 'beach', true, 'wind', {});
    syncWindBasemapMute(map, 'beach', true, 'wind', { __RAW_DISABLE_WIND_BASEMAP_MUTE__: true });
    expect(map.paint()).toBe(before);
  });
  it('a theme diffed into the same style: colours someone else rewrote are never overwritten with stale ones', () => {
    const map = fakeMap();
    syncWindBasemapMute(map, 'light', true, 'wind', {});
    map.setPaintProperty('water', 'fill-color', 'hsl(200, 60%, 60%)');   // the new theme's water arrives by diff
    syncWindBasemapMute(map, 'beach', false, 'wind', {});               // wind off: restore what is still ours
    expect(map.getPaintProperty('water', 'fill-color')).toBe('hsl(200, 60%, 60%)');
    expect(map.getPaintProperty('land', 'background-color')).toBe('hsl(35, 12%, 89%)');
    syncWindBasemapMute(map, 'beach', true, 'wind', {});                // and the new theme's colours get muted afresh
    expect(map.getPaintProperty('water', 'fill-color')).toBe(muteColor('hsl(200, 60%, 60%)', 0.85, 0.94));
  });
  it('a lever change re-plans from the original colours, not from the muted ones', () => {
    const map = fakeMap();
    syncWindBasemapMute(map, 'light', true, 'wind', {});
    syncWindBasemapMute(map, 'light', true, 'wind', { __RAW_WIND_BASEMAP_MUTE__: 0.5 });
    expect(map.getPaintProperty('land', 'background-color')).toBe(muteColor('hsl(35, 12%, 89%)', 0.5));
  });
});

describe('wiring', () => {
  const layer = fs.readFileSync(path.join(__dirname, 'WebGLWindLayer.js'), 'utf8');
  it('the wind layer syncs the mute on its toggle, after (re)adding itself to a style, and restores on teardown', () => {
    expect(layer).toContain("import { syncWindBasemapMute, windBasemapMuteStale } from './windBasemapMute';");
    expect(layer).toContain('syncWindBasemapMute(mapInstance, themeRef.current, active, LAYER_ID);');
    expect(layer).toContain('syncWindBasemapMute(mapInstance, themeRef.current, activeRef.current, LAYER_ID);');
    expect(layer).toContain('syncWindBasemapMute(mapInstance, themeRef.current, false, LAYER_ID);');
    const add = layer.indexOf('mapInstance.addLayer(customLayer, beforeId);'), sync = layer.lastIndexOf('syncWindBasemapMute(mapInstance, themeRef.current, activeRef.current, LAYER_ID);');
    expect(add).toBeGreaterThan(0);
    expect(sync).toBeGreaterThan(add);                                   // the plan is "below the wind layer": it must exist
  });
  it('a theme change re-syncs once the map settles (a diffed style keeps the wind layer, so the re-add hook never runs)', () => {
    expect(layer).toContain("mapInstance.once('idle', resync);");
    expect(layer).toContain('const resync = () => syncWindBasemapMute(mapInstance, themeRef.current, activeRef.current, LAYER_ID);');
    expect(layer).toContain('}, [theme, mapInstance]);');
  });
  it('every style change asks whether the mute is stale (imagery shown or hidden under the wind), and syncs only then', () => {
    expect(layer).toContain('} else if (windBasemapMuteStale(mapInstance, themeRef.current, activeRef.current, LAYER_ID)) {');
    const probe = layer.indexOf('windBasemapMuteStale(mapInstance'), handler = layer.indexOf('const handleStyleData = () => {'), bound = layer.indexOf("mapInstance.on('styledata', handleStyleData);");
    expect(probe).toBeGreaterThan(handler);
    expect(bound).toBeGreaterThan(probe);
  });
  it('THE STACK THESE TESTS ASSUME IS THE APP\'S: hidden rasters under the wind, the wind layer\'s id, the mask\'s ids', () => {
    const app = fs.readFileSync(path.join(__dirname, 'MapWebGL.js'), 'utf8'), mask = fs.readFileSync(path.join(__dirname, 'OceanMask.js'), 'utf8');
    expect(layer).toContain("var LAYER_ID = 'webgl-wind-particles';");
    expect(app).toContain('id="esri-satellite-layer"');
    expect(app).toContain("layout={{ visibility: activeLayers.includes('satellite') ? 'visible' : 'none' }}");
    expect(app).toContain("if (mapInstance.getLayer('webgl-wind-particles')) setOmSlotsBeforeId('webgl-wind-particles');");   // the slots sit just under the wind
    expect(app).toContain("visibility: (!hideForTransition && activeLayers.includes(layerKey)) ? 'visible' : 'none'");
    for (const id of ['MASK_BUFFER', 'MASK_FILL', 'MASK_LINE', 'MASK_INLAND_WATERWAY', 'MASK_INLAND_WATER']) expect(mask).toMatch(new RegExp(`const ${id}\\s*= 'ocean-mask-`));
  });
});
