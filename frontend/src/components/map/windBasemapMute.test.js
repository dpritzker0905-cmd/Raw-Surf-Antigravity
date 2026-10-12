/**
 * BASEMAP MUTE UNDER THE WIND (2026-10-09): the owner's "ambiguity to the wind color vs the color of the map" in light and
 * beach. The path bench (scripts/wind-bench/path-run.js) measured the hue fidelity these tests protect; here: the colour
 * maths, the plan over a style, and the sync's safety (idempotent, exact restore, never a stale colour written back).
 */
import fs from 'fs';
import path from 'path';
import {
  WIND_BASEMAP_MUTE, windBasemapMuteAmount, windBasemapWaterL, parseColor, oklab, muteColor, muteValue, windBasemapMutePlan, syncWindBasemapMute,
  windBasemapImagery, windBasemapMuteStale, WIND_BORDER_INK, windBorderInk, inkColor, inkValue, windBorderInkPlan,
} from './windBasemapMute';
import { windLayerBeforeId } from './WebGLWindUtils';

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
  it('a colour whose numbers do not parse is not a colour (rgb(0 0 0 / 50%) once read as alpha NaN, and was written as one)', () => {
    for (const s of ['rgb(0 0 0 / 50%)', 'rgb(a, b, c)', 'rgba(1, 2, 3, x)', 'hsl(x, 50%, 50%)']) expect(parseColor(s)).toBeNull();
    expect(parseColor('rgb(0 0 0)')).toEqual([0, 0, 0, 1]);                          // the space form itself is read
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
      if (map.refuse && map.refuse(id, p, v)) return;              // MapLibre: an invalid value is an error EVENT, and no write (style_layer.ts)
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
  it('a style that has just LOADED (a theme diffed in, or a rebuilt style) always syncs: the stale check cannot see a diff', () => {
    // 2026-10-12, an independent review, then observed on the real library (scripts/wind-bench/switch-run.js): the theme's idle
    // re-sync ran on the OLD style, 19 ms after the change; the new style was diffed in at 121 ms and wrote its own colours over
    // the restyle; the record still read "this theme, muted, inked", so nothing synced and the new theme stayed the style's own.
    expect(layer).toContain('const handleStyleData = (ev) => {');
    expect(layer).toContain("} else if ((ev && ev.type === 'style.load') || windBasemapMuteStale(mapInstance, themeRef.current, activeRef.current, LAYER_ID)) {");
    expect(layer).toContain("mapInstance.on('style.load', handleStyleData);");
    // and the bench's theme-change probe replays this handler, not its own idea of it
    const probe = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'scripts', 'wind-bench', 'page', 'switch-probe.js'), 'utf8');
    expect(probe).toContain("ev.type === 'style.load'");
    expect(probe).toContain('mute.windBasemapMuteStale(map, theme, true, WIND_ID)');
  });
  it('every other style change asks whether the mute is stale (imagery shown or hidden under the wind), and syncs only then', () => {
    expect(layer).toContain("} else if ((ev && ev.type === 'style.load') || windBasemapMuteStale(mapInstance, themeRef.current, activeRef.current, LAYER_ID)) {");
    const probe = layer.indexOf('windBasemapMuteStale(mapInstance'), handler = layer.indexOf('const handleStyleData = (ev) => {'), bound = layer.indexOf("mapInstance.on('styledata', handleStyleData);");
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

/**
 * BORDER INK UNDER THE WIND (2026-10-12, owner: "the labels and borders need to be more visible. In dark mode they are white
 * boarders and labels. So in beach and light mode, there maybe needs to be black borders and labels?"). The border bench
 * (scripts/wind-bench/border-run.js) measured the contrast these tests protect; here: which lines, which property, and the
 * sync's safety (the mute's own: one record, exact restore, never a stale colour written back).
 *
 * THE REAL STYLES' borders-and-labels block, paint as served on 2026-10-12 (navigation-day-v1 layers 96-117, outdoors-v11
 * 98-120, navigation-night-v1 96-117), over the mute's own ground, with the wind layer and its coastline added where the app
 * adds them (WebGLWindLayer.js: just before the style's first admin-* layer).
 */
const zoomed = (...stops) => ['interpolate', ['linear'], ['zoom'], ...stops];
const BORDERS = {
  light: { casing: ['hsl(60, 0%, 99%)', 'hsl(250, 100%, 100%)'], state: ['hsl(250, 53%, 75%)', 'hsl(250, 90%, 85%)'], country: 'hsl(250, 90%, 80%)', text: 'hsl(230, 20%, 5%)', halo: 'hsl(60, 5%, 100%)' },
  beach: { casing: ['hsl(35, 12%, 89%)', 'hsl(230, 49%, 90%)'], state: ['hsl(230, 14%, 77%)', 'hsl(230, 8%, 62%)'], country: 'hsl(230, 8%, 51%)', text: 'hsl(0, 0%, 0%)', halo: 'hsl(0, 0%, 100%)' },
  dark: { casing: ['hsl(214, 17%, 31%)', 'hsl(250, 30%, 46%)'], state: ['hsl(250, 6%, 60%)', 'hsl(250, 10%, 70%)'], country: 'hsl(250, 10%, 65%)', text: 'hsl(215, 30%, 75%)', halo: 'hsl(214, 24%, 30%)' },
};
const BORDER_LINES = ['admin-1-boundary', 'admin-0-boundary', 'admin-0-boundary-disputed'];
function REAL(theme, { windOnTop = false } = {}) {
  const c = BORDERS[theme];
  const top = [
    { id: 'admin-1-boundary-bg', type: 'line', paint: { 'line-color': zoomed(8, c.casing[0], 16, c.casing[1]), 'line-opacity': zoomed(7, 0, 8, 0.75), 'line-width': zoomed(7, 3.75, 12, 5.5), 'line-dasharray': [1, 0], 'line-blur': zoomed(3, 0, 8, 3) } },
    { id: 'admin-0-boundary-bg', type: 'line', paint: { 'line-color': zoomed(6, c.casing[0], 8, c.casing[1]), 'line-opacity': zoomed(3, 0, 4, 0.5), 'line-width': zoomed(3, 3.5, 10, 8), 'line-blur': zoomed(3, 0, 10, 2) } },
    { id: 'admin-1-boundary', type: 'line', paint: { 'line-color': zoomed(3, c.state[0], 7, c.state[1]), 'line-opacity': zoomed(2, 0, 3, 1), 'line-width': zoomed(7, 0.75, 12, 1.5), 'line-dasharray': ['step', ['zoom'], ['literal', [2, 0]], 7, ['literal', [2, 2, 6, 2]]] } },
    { id: 'admin-0-boundary', type: 'line', paint: { 'line-color': c.country, 'line-width': zoomed(3, 0.5, 10, 2), 'line-dasharray': [10, 0] } },
    { id: 'admin-0-boundary-disputed', type: 'line', paint: { 'line-color': c.country, 'line-width': zoomed(3, 0.5, 10, 2), 'line-dasharray': ['step', ['zoom'], ['literal', [3.25, 3.25]], 6, ['literal', [2.5, 2.5]]] } },
    { id: 'settlement-major-label', type: 'symbol', paint: { 'text-color': c.text, 'text-halo-color': c.halo, 'text-halo-width': 1, 'text-halo-blur': 1 } },
    { id: 'state-label', type: 'symbol', paint: { 'text-color': c.text, 'text-halo-color': c.halo, 'text-halo-width': 1 } },
    { id: 'country-label', type: 'symbol', paint: { 'text-color': c.text, 'text-halo-color': zoomed(2, 'hsla(60, 5%, 100%, 0.75)', 3, c.halo), 'text-halo-width': 1.25 } },
  ];
  const style = [...STYLE().filter((l) => !['wind', 'admin-1-boundary', 'place-label', 'water-label'].includes(l.id)), ...top];
  const wind = [{ id: 'wind', type: 'custom' }, { id: 'wind-coastline', type: 'line', paint: { 'line-color': 'rgb(45, 58, 72)', 'line-opacity': 0.42 } }];
  if (windOnTop) return [...style, ...wind];                                  // the under-labels kill: the wind above every style layer
  style.splice(style.findIndex((l) => l.id === windLayerBeforeId(style, theme, {})), 0, ...wind);
  return style;
}
const INK = 'rgba(27, 30, 45, 0.85)';
const inked = (theme, ink = WIND_BORDER_INK.color[theme]) => ({ 'admin-1-boundary': zoomed(3, ink, 7, ink), 'admin-0-boundary': ink, 'admin-0-boundary-disputed': ink });

describe('inkColor / inkValue: every colour literal becomes the ink, and the expression around it stays', () => {
  it('a colour becomes the ink; its own alpha multiplies in, so a transparent literal stays invisible', () => {
    expect(inkColor('hsl(250, 90%, 80%)', INK)).toBe('rgba(27, 30, 45, 0.85)');
    expect(inkColor('hsla(250, 90%, 80%, 0.5)', INK)).toBe('rgba(27, 30, 45, 0.425)');
    expect(parseColor(inkColor('transparent', INK))[3]).toBe(0);
    expect(inkColor('#a0c8f0', 'hsl(230, 25%, 14%)')).toBe('rgba(27, 30, 45, 1)');   // the ink may be given in any form the styles use
  });
  it('what is not a colour comes back as is; so does everything when the ink is not a colour', () => {
    for (const s of ['admin', 'interpolate', 'zoom', '', 7, null, undefined, true]) expect(inkColor(s, INK)).toBe(s);
    expect(inkColor('hsl(250, 90%, 80%)', 'not a colour')).toBe('hsl(250, 90%, 80%)');
    expect(inkValue(zoomed(3, 'hsl(250, 53%, 75%)', 7, 'hsl(250, 90%, 85%)'), null)).toEqual(zoomed(3, 'hsl(250, 53%, 75%)', 7, 'hsl(250, 90%, 85%)'));
  });
  it('a zoom interpolation keeps its operator, its input and its stops: it is not flattened to one colour', () => {
    const expr = zoomed(3, 'hsl(250, 53%, 75%)', 7, 'hsl(250, 90%, 85%)'), kept = JSON.stringify(expr);
    expect(inkValue(expr, INK)).toEqual(['interpolate', ['linear'], ['zoom'], 3, INK, 7, INK]);
    expect(JSON.stringify(expr)).toBe(kept);                                   // the style's own value is not mutated
  });
  it('step, match and legacy {stops}: operators, inputs, labels and numbers kept', () => {
    expect(inkValue(['step', ['zoom'], 'hsl(0, 0%, 60%)', 7, '#8080ff'], INK)).toEqual(['step', ['zoom'], INK, 7, INK]);
    expect(inkValue(['match', ['get', 'disputed'], 'true', 'hsl(0, 60%, 60%)', 'hsl(250, 90%, 80%)'], INK)).toEqual(['match', ['get', 'disputed'], 'true', INK, INK]);
    expect(inkValue({ base: 1.2, stops: [[3, 'hsl(250, 53%, 75%)'], [7, '#d0c8ff']] }, INK)).toEqual({ base: 1.2, stops: [[3, INK], [7, INK]] });
  });
});

describe('windBorderInk: the ink a theme lays, its kill and its lever', () => {
  it('pinned default: one dark slate ink at 0.7 in light and beach', () => {
    // border bench 2026-10-12 (the real basemaps, in motion, pixel ratio 1.5; a line's L* against its ground under field + particles,
    // zooms 4 / 6 / 8): dark 11.9 / 20.9 / 28.5; at 0.7 light 39.9 / 36.5 / 35.0 and beach 38.9 / 34.4 / 31.6 (today 7.6 / 2.8 / 5.8
    // and 4.0 / 4.7 / 3.0). 0.7 is the lightest strength measured, and at or above dark's line at those three zooms in both themes
    // (not at zoom 9: beach 0.96 of dark's, 0.85 in near-calm air; the inked line itself holds 30 to 46 L* wherever it was read).
    expect(WIND_BORDER_INK.color).toEqual({ light: 'rgba(27, 30, 45, 0.7)', beach: 'rgba(27, 30, 45, 0.7)' });
    expect(inkColor('#fff', 'hsl(230, 25%, 14%)')).toBe('rgba(27, 30, 45, 1)');       // the colour the owner was shown live
    const L = (s) => oklab(parseColor(s))[0];                                         // an ink: far darker than any border colour the styles draw
    for (const theme of ['light', 'beach']) for (const c of [...BORDERS[theme].state, BORDERS[theme].country]) expect(L(WIND_BORDER_INK.color[theme])).toBeLessThan(L(c) - 0.3);
  });
  it('light and beach have one, dark never does', () => {
    expect(windBorderInk('light', {})).toBe(WIND_BORDER_INK.color.light);
    expect(windBorderInk('beach', {})).toBe(WIND_BORDER_INK.color.beach);
    expect(windBorderInk('dark', {})).toBeNull();
    expect(windBorderInk('nope', {})).toBeNull();
    for (const theme of ['light', 'beach']) expect(parseColor(WIND_BORDER_INK.color[theme])).not.toBeNull();
    expect(Object.keys(WIND_BORDER_INK.color).sort()).toEqual(['beach', 'light']);
  });
  it('the kill is exactly true; anything else leaves the ink on', () => {
    expect(windBorderInk('light', { __RAW_DISABLE_WIND_BORDER_INK__: true })).toBeNull();
    expect(windBorderInk('beach', { __RAW_DISABLE_WIND_BORDER_INK__: true })).toBeNull();
    for (const v of [1, 'true', false, null, undefined]) expect(windBorderInk('light', { __RAW_DISABLE_WIND_BORDER_INK__: v })).toBe(WIND_BORDER_INK.color.light);
  });
  it('the lever gives another ink where a theme has one; never in dark; a lever that is not a colour is ignored; the kill wins', () => {
    expect(windBorderInk('light', { __RAW_WIND_BORDER_INK__: 'rgba(0, 0, 0, 0.6)' })).toBe('rgba(0, 0, 0, 0.6)');
    expect(windBorderInk('beach', { __RAW_WIND_BORDER_INK__: 'hsl(230, 25%, 14%)' })).toBe('hsl(230, 25%, 14%)');
    expect(windBorderInk('dark', { __RAW_WIND_BORDER_INK__: 'rgba(0, 0, 0, 0.6)' })).toBeNull();
    for (const v of ['nope', 0.5, true, null]) expect(windBorderInk('light', { __RAW_WIND_BORDER_INK__: v })).toBe(WIND_BORDER_INK.color.light);
    expect(windBorderInk('light', { __RAW_DISABLE_WIND_BORDER_INK__: true, __RAW_WIND_BORDER_INK__: 'rgba(0, 0, 0, 0.6)' })).toBeNull();
  });
});

describe('windBorderInkPlan: the border lines ABOVE the wind, their colour and nothing else', () => {
  it.each(['light', 'beach', 'dark'])('%s: the three border lines, line-color only, from the style\'s own value to the inked one', (theme) => {
    const style = REAL(theme), plan = windBorderInkPlan(style, 'wind', INK), want = inked(theme, INK);
    expect(plan.map((p) => `${p.id}:${p.prop}`)).toEqual(BORDER_LINES.map((id) => `${id}:line-color`));
    for (const p of plan) {
      expect(p.from).toEqual(style.find((l) => l.id === p.id).paint['line-color']);
      expect(p.to).toEqual(want[p.id]);
    }
  });
  it('the casings, the coastline, the names, the roads and every area under the wind are not in it', () => {
    const ids = new Set(windBorderInkPlan(REAL('light'), 'wind', INK).map((p) => p.id));
    for (const id of ['admin-1-boundary-bg', 'admin-0-boundary-bg', 'wind-coastline', 'state-label', 'country-label', 'settlement-major-label', 'road-primary', 'waterway', 'water', 'land']) expect(ids.has(id)).toBe(false);
  });
  it('a border line UNDER the wind is left alone (the under-labels kill puts the wind on top: unmeasured there, today\'s look is kept)', () => {
    expect(windBorderInkPlan(REAL('light', { windOnTop: true }), 'wind', INK)).toEqual([]);
    const below = [{ id: 'admin-0-boundary', type: 'line', paint: { 'line-color': '#aaa' } }, { id: 'wind', type: 'custom' }, { id: 'admin-1-boundary', type: 'line', paint: { 'line-color': '#bbb' } }];
    expect(windBorderInkPlan(below, 'wind', INK).map((p) => p.id)).toEqual(['admin-1-boundary']);
  });
  it('only LINE layers named admin-*, and only where the style sets a colour', () => {
    const odd = [{ id: 'wind', type: 'custom' }, { id: 'admin-fill', type: 'fill', paint: { 'fill-color': '#aaa' } }, { id: 'admin-label', type: 'symbol', paint: { 'text-color': '#aaa' } },
      { id: 'admin-0-boundary', type: 'line', paint: { 'line-width': 2 } }, { id: 'admin-9', type: 'line' }, { id: 'boundary-admin', type: 'line', paint: { 'line-color': '#aaa' } }, null];
    expect(windBorderInkPlan(odd, 'wind', INK)).toEqual([]);
  });
  it('nothing without an ink, without layers, or without the wind layer in the list ("above the wind" has no meaning then)', () => {
    expect(windBorderInkPlan(REAL('light'), 'wind', null)).toEqual([]);
    expect(windBorderInkPlan(REAL('light'), 'wind', 'not a colour')).toEqual([]);
    expect(windBorderInkPlan(null, 'wind', INK)).toEqual([]);
    expect(windBorderInkPlan(REAL('light').filter((l) => l.id !== 'wind'), 'wind', INK)).toEqual([]);
  });
});

describe('syncWindBasemapMute lays the border ink with the mute: one record, one restore', () => {
  const lineColors = (map) => Object.fromEntries(BORDER_LINES.map((id) => [id, map.getPaintProperty(id, 'line-color')]));
  it.each(['light', 'beach'])('%s, wind on: the three border lines take the ink; wind off: every paint value is back, byte for byte', (theme) => {
    const map = fakeMap(REAL(theme)), win = {}, before = map.paint(), ink = WIND_BORDER_INK.color[theme];
    const r = syncWindBasemapMute(map, theme, true, 'wind', win);
    expect(r.ink).toEqual({ applied: true, layers: 3, color: ink });
    expect(lineColors(map)).toEqual(inked(theme));
    expect(map.paint()).not.toBe(before);
    expect(syncWindBasemapMute(map, theme, false, 'wind', win).ink).toEqual({ applied: false, layers: 0, reason: 'wind off' });
    expect(map.paint()).toBe(before);
  });
  it('dark is untouched: no ink, no write, and the read-back says why', () => {
    const map = fakeMap(REAL('dark')), win = {}, before = map.paint();
    expect(syncWindBasemapMute(map, 'dark', true, 'wind', win).ink).toEqual({ applied: false, layers: 0, reason: 'theme' });
    expect(map.writes).toBe(0);
    expect(map.paint()).toBe(before);
    expect(win.__WIND_BORDER_INK__).toMatchObject({ applied: false, layers: 0, reason: 'theme', theme: 'dark' });
    // and a lever cannot ink it either, though the mute's own lever still mutes dark's ground (as before)
    const lev = fakeMap(REAL('dark'));
    expect(syncWindBasemapMute(lev, 'dark', true, 'wind', { __RAW_WIND_BORDER_INK__: INK, __RAW_WIND_BASEMAP_MUTE__: 0.5 })).toMatchObject({ applied: true, layers: 6, ink: { applied: false, reason: 'theme' } });
    expect(lineColors(lev)).toEqual(lineColors(fakeMap(REAL('dark'))));
  });
  it('only line-color moves: widths, opacities, dashes, the casings, the coastline and the names keep the style\'s own values', () => {
    const map = fakeMap(REAL('light')), fresh = fakeMap(REAL('light')), style = REAL('light'), above = style.slice(style.findIndex((l) => l.id === 'wind') + 1);
    syncWindBasemapMute(map, 'light', true, 'wind', {});
    expect(above.map((l) => l.id)).toEqual(['wind-coastline', 'admin-1-boundary-bg', 'admin-0-boundary-bg', ...BORDER_LINES, 'settlement-major-label', 'state-label', 'country-label']);
    for (const l of above) {
      for (const prop of Object.keys(l.paint)) {
        if (BORDER_LINES.includes(l.id) && prop === 'line-color') continue;
        expect(map.getPaintProperty(l.id, prop)).toEqual(fresh.getPaintProperty(l.id, prop));
      }
    }
  });
  it('the mute\'s own answer keeps its shape: `layers` counts the muted areas, never the inked lines', () => {
    const map = fakeMap(REAL('light')), win = {};
    expect(syncWindBasemapMute(map, 'light', true, 'wind', win)).toMatchObject({ applied: true, layers: 6, amount: 0.85 });
    expect(win.__WIND_BASEMAP_MUTE__).toMatchObject({ applied: true, layers: 6, amount: 0.85, waterL: 0.9, theme: 'light' });
    expect(win.__WIND_BASEMAP_MUTE__.ink).toBeUndefined();
  });
  it('read-back: window.__WIND_BORDER_INK__ says what was drawn (lines > 0 and the colour), or why nothing was', () => {
    const map = fakeMap(REAL('beach')), win = {};
    syncWindBasemapMute(map, 'beach', true, 'wind', win);
    expect(win.__WIND_BORDER_INK__).toMatchObject({ applied: true, layers: 3, color: WIND_BORDER_INK.color.beach, theme: 'beach' });
    expect(typeof win.__WIND_BORDER_INK__.at).toBe('number');
    const bare = fakeMap([{ id: 'land', type: 'background', paint: { 'background-color': 'hsl(35, 12%, 89%)' } }, { id: 'wind', type: 'custom' }]), w2 = {};
    syncWindBasemapMute(bare, 'light', true, 'wind', w2);
    expect(w2.__WIND_BORDER_INK__).toMatchObject({ applied: false, layers: 0, reason: 'no border lines above the wind' });   // never applied: true with 0 lines
    expect(w2.__WIND_BASEMAP_MUTE__).toMatchObject({ applied: true, layers: 1 });
  });
  it('idempotent: a second sync writes nothing', () => {
    const map = fakeMap(REAL('light'));
    syncWindBasemapMute(map, 'light', true, 'wind', {});
    const w = map.writes;
    expect(w).toBeGreaterThan(0);
    expect(syncWindBasemapMute(map, 'light', true, 'wind', {}).ink).toEqual({ applied: true, layers: 3, color: WIND_BORDER_INK.color.light });
    expect(map.writes).toBe(w);
  });
  it('its own kill restores the lines on the next sync and leaves the mute', () => {
    const map = fakeMap(REAL('light')), win = {};
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    win.__RAW_DISABLE_WIND_BORDER_INK__ = true;
    expect(windBasemapMuteStale(map, 'light', true, 'wind', win)).toBe(true);
    expect(syncWindBasemapMute(map, 'light', true, 'wind', win)).toMatchObject({ applied: true, layers: 6, amount: 0.85, ink: { applied: false, layers: 0, reason: 'kill' } });
    expect(lineColors(map)).toEqual(lineColors(fakeMap(REAL('light'))));
    expect(map.getPaintProperty('water', 'fill-color')).toBe(muteColor('hsl(196, 80%, 70%)', 0.85, 0.9));
    expect(windBasemapMuteStale(map, 'light', true, 'wind', win)).toBe(false);
    delete win.__RAW_DISABLE_WIND_BORDER_INK__;                                       // and it comes back the same way
    expect(windBasemapMuteStale(map, 'light', true, 'wind', win)).toBe(true);
    expect(syncWindBasemapMute(map, 'light', true, 'wind', win).ink).toEqual({ applied: true, layers: 3, color: WIND_BORDER_INK.color.light });
    expect(lineColors(map)).toEqual(inked('light'));
  });
  it('the MUTE\'S kill, or its lever at 0, leaves the whole map the style\'s own, borders included (an older kill keeps its meaning, L-V25)', () => {
    for (const off of [{ __RAW_DISABLE_WIND_BASEMAP_MUTE__: true }, { __RAW_WIND_BASEMAP_MUTE__: 0 }]) {
      const map = fakeMap(REAL('light')), before = map.paint();
      syncWindBasemapMute(map, 'light', true, 'wind', {});
      expect(windBasemapMuteStale(map, 'light', true, 'wind', off)).toBe(true);
      expect(syncWindBasemapMute(map, 'light', true, 'wind', off)).toMatchObject({ applied: false, layers: 0, amount: 0, ink: { applied: false, layers: 0, reason: 'mute off' } });
      expect(map.paint()).toBe(before);
      expect(windBasemapMuteStale(map, 'light', true, 'wind', off)).toBe(false);       // nothing to lay: no work on later style changes
    }
    // a weaker mute (the lever between 0 and 1) is still a restyled map: the ink stays
    const map = fakeMap(REAL('beach'));
    expect(syncWindBasemapMute(map, 'beach', true, 'wind', { __RAW_WIND_BASEMAP_MUTE__: 0.5 })).toMatchObject({ applied: true, amount: 0.5, ink: { applied: true, layers: 3 } });
    // and both kills together say the ink's own first
    expect(syncWindBasemapMute(fakeMap(REAL('light')), 'light', true, 'wind', { __RAW_DISABLE_WIND_BASEMAP_MUTE__: true, __RAW_DISABLE_WIND_BORDER_INK__: true }).ink).toEqual({ applied: false, layers: 0, reason: 'kill' });
  });
  it('the theme changes on the same style (light to dark): the ink and the mute come off exactly', () => {
    const map = fakeMap(REAL('light')), before = map.paint();
    syncWindBasemapMute(map, 'light', true, 'wind', {});
    expect(windBasemapMuteStale(map, 'dark', true, 'wind', {})).toBe(true);
    expect(syncWindBasemapMute(map, 'dark', true, 'wind', {})).toMatchObject({ applied: false, ink: { applied: false, reason: 'theme' } });
    expect(map.paint()).toBe(before);
  });
  it('a theme diffed into the same style: a border colour someone else rewrote is never overwritten with a stale one', () => {
    const map = fakeMap(REAL('light'));
    syncWindBasemapMute(map, 'light', true, 'wind', {});
    map.setPaintProperty('admin-0-boundary', 'line-color', BORDERS.beach.country);   // beach's country line arrives by diff
    syncWindBasemapMute(map, 'beach', false, 'wind', {});                            // wind off: restore what is still ours
    expect(map.getPaintProperty('admin-0-boundary', 'line-color')).toBe(BORDERS.beach.country);
    expect(map.getPaintProperty('admin-1-boundary', 'line-color')).toEqual(zoomed(3, ...[BORDERS.light.state[0], 7, BORDERS.light.state[1]]));
    syncWindBasemapMute(map, 'beach', true, 'wind', {});                             // and the new colour is inked afresh
    expect(map.getPaintProperty('admin-0-boundary', 'line-color')).toBe(WIND_BORDER_INK.color.beach);
    syncWindBasemapMute(map, 'beach', false, 'wind', {});
    expect(map.getPaintProperty('admin-0-boundary', 'line-color')).toBe(BORDERS.beach.country);
  });
  it('a lever change re-plans from the style\'s own colours, not from the inked ones', () => {
    const map = fakeMap(REAL('light')), before = map.paint();
    syncWindBasemapMute(map, 'light', true, 'wind', {});
    const lever = { __RAW_WIND_BORDER_INK__: 'rgba(0, 0, 0, 0.6)' };
    expect(windBasemapMuteStale(map, 'light', true, 'wind', lever)).toBe(true);
    expect(syncWindBasemapMute(map, 'light', true, 'wind', lever).ink).toEqual({ applied: true, layers: 3, color: 'rgba(0, 0, 0, 0.6)' });
    expect(lineColors(map)).toEqual(inked('light', 'rgba(0, 0, 0, 0.6)'));
    syncWindBasemapMute(map, 'light', false, 'wind', lever);
    expect(map.paint()).toBe(before);
  });
  it('the wind layer on top of the style (the under-labels kill): the borders are under it and are not inked; the mute still runs', () => {
    const map = fakeMap(REAL('light', { windOnTop: true })), win = {};
    expect(syncWindBasemapMute(map, 'light', true, 'wind', win)).toMatchObject({ applied: true, layers: 6, ink: { applied: false, layers: 0, reason: 'no border lines above the wind' } });
    expect(lineColors(map)).toEqual(lineColors(fakeMap(REAL('light'))));
  });
  it.each([['light', 'beach'], ['beach', 'light'], ['dark', 'light'], ['light', 'dark']])('A THEME CHANGE IN THE APP\'S ORDER, %s to %s: re-synced on the old style, then the new style diffed in over it; the next sync restyles the new theme', (from, to) => {
    const map = fakeMap(REAL(from)), win = {}, own = fakeMap(REAL(to));
    syncWindBasemapMute(map, from, true, 'wind', win);
    syncWindBasemapMute(map, to, true, 'wind', win);                                  // 1. the idle re-sync: the new theme's name, the OLD style
    for (const l of REAL(to)) for (const [prop, v] of Object.entries(l.paint || {})) map.setPaintProperty(l.id, prop, v);   // 2. the diff
    expect(map.paint()).toBe(own.paint());                                            // the new theme's own colours: nothing restyled
    if (to !== 'dark') {
      expect(windBasemapMuteStale(map, to, true, 'wind', win)).toBe(false);           // 3. the record still reads "this theme, muted, inked":
      expect(win.__WIND_BORDER_INK__).toMatchObject({ applied: true, layers: 3 });    //    the stale check cannot see a diff, nor can the read-back
    }
    const r = syncWindBasemapMute(map, to, true, 'wind', win);                        // 4. so the layer syncs on every style.load (wiring, above)
    if (to === 'dark') expect(r).toMatchObject({ applied: false, ink: { applied: false, reason: 'theme' } });
    else {
      expect(r).toMatchObject({ applied: true, layers: 6, ink: { applied: true, layers: 3, color: WIND_BORDER_INK.color[to] } });
      expect(lineColors(map)).toEqual(inked(to));
      expect(map.getPaintProperty('water', 'fill-color')).toBe(muteColor('hsl(196, 80%, 70%)', 0.85, WIND_BASEMAP_MUTE.waterL[to]));
    }
    syncWindBasemapMute(map, to, false, 'wind', win);
    expect(map.paint()).toBe(own.paint());                                            // and off again: the new theme's style, byte for byte
  });
  it('a line the style REFUSES is not counted: the read-back says what took, never what was asked for', () => {
    // MapLibre validates a paint value and, when it is invalid, fires an error event and writes nothing; it does not throw.
    const one = fakeMap(REAL('light')), w1 = {};
    one.refuse = (id) => id === 'admin-0-boundary';
    expect(syncWindBasemapMute(one, 'light', true, 'wind', w1).ink).toEqual({ applied: true, layers: 2, color: WIND_BORDER_INK.color.light });
    expect(one.getPaintProperty('admin-0-boundary', 'line-color')).toBe(BORDERS.light.country);
    const all = fakeMap(REAL('light')), w2 = {}, before = all.paint();
    all.refuse = (id) => BORDER_LINES.includes(id);
    expect(syncWindBasemapMute(all, 'light', true, 'wind', w2)).toMatchObject({ applied: true, layers: 6, ink: { applied: false, layers: 0, reason: 'the style refused the ink' } });
    expect(w2.__WIND_BORDER_INK__).toMatchObject({ applied: false, layers: 0, reason: 'the style refused the ink' });
    syncWindBasemapMute(all, 'light', false, 'wind', w2);                             // and what was never written is never "restored"
    expect(all.paint()).toBe(before);
  });
  it('never without the wind layer; a write that throws part-way is undone by the next sync, from the style\'s own colours', () => {
    const none = fakeMap(REAL('light').filter((l) => l.id !== 'wind')), before = none.paint();
    expect(syncWindBasemapMute(none, 'light', true, 'wind', {}).ink).toEqual({ applied: false, layers: 0, reason: 'no wind layer' });
    expect(none.paint()).toBe(before);
    const map = fakeMap(REAL('light')), clean = map.paint();
    map.failOn = 'admin-0-boundary';
    expect(syncWindBasemapMute(map, 'light', true, 'wind', {})).toMatchObject({ applied: false, error: 'style mid-load', ink: { applied: false, layers: 0 } });
    expect(syncWindBasemapMute(map, 'light', true, 'wind', {}).ink).toEqual({ applied: true, layers: 3, color: WIND_BORDER_INK.color.light });
    expect(lineColors(map)).toEqual(inked('light'));                                  // inked once, from the original
    syncWindBasemapMute(map, 'light', false, 'wind', {});
    expect(map.paint()).toBe(clean);
  });
});

describe('BORDER INK ON THE APP\'S STACK: it stands down with the mute when imagery shows under the wind', () => {
  // The app's hidden satellite photo and weather-wash slots under the wind, its radar frame above (APP(), pinned to MapWebGL.js by the
  // wiring test above), around the real styles' border block. A dark line on a satellite photo's dark ground would be the old problem
  // turned over, and the picture under a weather wash is unmeasured: today's borders are kept there.
  function STACK(theme, opts) {
    const app = APP(opts).filter((l) => !['admin-1-boundary', 'place-label', 'water-label'].includes(l.id)), real = REAL(theme), at = real.findIndex((l) => l.id === 'wind-coastline');
    return [...app.filter((l) => l.id !== 'rv-radar-frame' && l.id !== 'spot-geofences-layer'), ...real.slice(at), ...app.filter((l) => l.id === 'rv-radar-frame' || l.id === 'spot-geofences-layer')];
  }
  const colour = (map) => map.getPaintProperty('admin-0-boundary', 'line-color');
  it('hidden satellite and weather slots under the wind do NOT stand it down: the borders are inked in the app\'s stack', () => {
    for (const theme of ['light', 'beach']) {
      const map = fakeMap(STACK(theme)), win = {};
      expect(syncWindBasemapMute(map, theme, true, 'wind', win)).toMatchObject({ applied: true, layers: 6, ink: { applied: true, layers: 3 } });
      expect(win.__WIND_BORDER_INK__).toMatchObject({ applied: true, layers: 3, color: WIND_BORDER_INK.color[theme] });
      expect(map.getPaintProperty('park-above', 'fill-color')).toBe('hsl(100, 45%, 80%)');      // a fill above the wind is nobody's border
      expect(map.getPaintProperty('spot-geofences-layer', 'circle-color')).toBe('#06b6d4');
    }
  });
  it('a satellite photo or a weather wash SHOWING under the wind: no ink, and the read-back names the layer', () => {
    for (const [on, id] of [[['esri-satellite'], 'esri-satellite-layer'], [['rain-slot'], 'rain-slot-1-layer']]) {
      const map = fakeMap(STACK('light', { on })), win = {}, before = map.paint();
      expect(syncWindBasemapMute(map, 'light', true, 'wind', win).ink).toEqual({ applied: false, layers: 0, reason: `imagery:${id}` });
      expect(map.paint()).toBe(before);
      expect(win.__WIND_BORDER_INK__).toMatchObject({ applied: false, reason: `imagery:${id}` });
    }
  });
  it('satellite switched on while inked: stale, the style\'s own borders back exactly; switched off: stale, inked again; steady: no work', () => {
    const map = fakeMap(STACK('beach')), own = colour(map);
    syncWindBasemapMute(map, 'beach', true, 'wind', {});
    expect(colour(map)).toBe(WIND_BORDER_INK.color.beach);
    expect(windBasemapMuteStale(map, 'beach', true, 'wind', {})).toBe(false);
    map.setLayoutProperty('esri-satellite-layer', 'visibility', 'visible');
    map.setPaintProperty('esri-satellite-layer', 'raster-opacity', 1);
    expect(windBasemapMuteStale(map, 'beach', true, 'wind', {})).toBe(true);
    expect(syncWindBasemapMute(map, 'beach', true, 'wind', {}).ink).toEqual({ applied: false, layers: 0, reason: 'imagery:esri-satellite-layer' });
    expect(colour(map)).toBe(own);
    map.setLayoutProperty('esri-satellite-layer', 'visibility', 'none');
    expect(windBasemapMuteStale(map, 'beach', true, 'wind', {})).toBe(true);
    expect(syncWindBasemapMute(map, 'beach', true, 'wind', {}).ink).toMatchObject({ applied: true, layers: 3 });
    expect(colour(map)).toBe(WIND_BORDER_INK.color.beach);
    const w = map.writes;
    syncWindBasemapMute(map, 'beach', true, 'wind', {});
    expect(map.writes).toBe(w);
  });
  it('a raster ABOVE the wind (a radar frame) is not under the borders\' ground: the ink stays', () => {
    const map = fakeMap(STACK('light'));
    expect(STACK('light').some((l) => l.id === 'rv-radar-frame' && l.type === 'raster')).toBe(true);
    expect(syncWindBasemapMute(map, 'light', true, 'wind', {}).ink).toMatchObject({ applied: true, layers: 3 });
  });
  it('THE ORDER THESE TESTS ASSUME IS THE APP\'S: the wind layer is added just before the first admin-* layer, the coastline with it', () => {
    const layer = fs.readFileSync(path.join(__dirname, 'WebGLWindLayer.js'), 'utf8');
    expect(layer).toContain('beforeId = windLayerBeforeId(styleLayers, themeRef.current);');
    expect(layer).toContain('mapInstance.addLayer(customLayer, beforeId);');
    expect(layer).toContain('if (coast && !mapInstance.getLayer(coast.id)) mapInstance.addLayer(coast, beforeId);');
    for (const theme of ['light', 'beach', 'dark']) {
      const order = REAL(theme).map((l) => l.id), wind = order.indexOf('wind');
      expect(order[wind + 2]).toBe('admin-1-boundary-bg');
      for (const id of BORDER_LINES) expect(order.indexOf(id)).toBeGreaterThan(wind);
    }
  });
});
