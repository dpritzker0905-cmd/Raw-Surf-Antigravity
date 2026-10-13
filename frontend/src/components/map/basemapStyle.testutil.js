/**
 * Test-only fixtures shared by windBasemapMute.test.js and windCoastInk.test.js (moved here unchanged on 2026-10-12, when the coast
 * ink's tests took the first file over the 800-line ratchet). Not production code and not a test file (jest runs *.test.js only).
 *
 * STYLE      a small basemap with the wind layer in it;
 * fakeMap    a map that keeps a live style (paint as set) and counts writes; like MapLibre it leaves custom layers out of getStyle();
 * APP        the app's stack around the basemap (the hidden satellite photo and weather-wash slots under the wind, radar above);
 * REAL       the real styles' borders-and-labels block, paint as served on 2026-10-12, with the wind layer and each theme's own
 *            coastline stroke added where the app adds them;
 * STACK      REAL's block inside the app's stack.
 */
import { windLayerBeforeId, WIND_COASTLINE } from './WebGLWindUtils';

export const STYLE = () => [
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

/**
 * A map that keeps a live style (paint values as set) and counts writes. Like MapLibre (5.24 _serializedAllLayers),
 * getStyle() LEAVES CUSTOM LAYERS OUT: the wind layer's own slot is only in style._order.
 */
export function fakeMap(layers = STYLE()) {
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
    addLayer: (l, before) => { live.set(l.id, JSON.parse(JSON.stringify(l))); const o = map.style._order, at = before ? o.indexOf(before) : -1; if (at >= 0) o.splice(at, 0, l.id); else o.push(l.id); },
    removeLayer: (id) => { live.delete(id); map.style._order = map.style._order.filter((x) => x !== id); },
  };
  return map;
}

/**
 * THE APP'S STACK around the basemap (MapWebGL.js, OceanMask.js; pinned by the wiring tests below). The app keeps its
 * satellite photo and 18 weather-wash slots MOUNTED AND HIDDEN under the wind layer, the ocean mask's own fills too, and
 * draws radar frames above it. `on` shows layers by id prefix (visibility), `opacity` gives the shown ones an opacity.
 */
export const WASHES = ['rain', 'satellite', 'pressure', 'temperature', 'water_temp', 'fog'];
export function APP({ on = [], opacity = ['interpolate', ['linear'], ['zoom'], 2, 0.6, 12, 0.78] } = {}) {
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

export const zoomed = (...stops) => ['interpolate', ['linear'], ['zoom'], ...stops];
export const BORDERS = {
  light: { casing: ['hsl(60, 0%, 99%)', 'hsl(250, 100%, 100%)'], state: ['hsl(250, 53%, 75%)', 'hsl(250, 90%, 85%)'], country: 'hsl(250, 90%, 80%)', text: 'hsl(230, 20%, 5%)', halo: 'hsl(60, 5%, 100%)' },
  beach: { casing: ['hsl(35, 12%, 89%)', 'hsl(230, 49%, 90%)'], state: ['hsl(230, 14%, 77%)', 'hsl(230, 8%, 62%)'], country: 'hsl(230, 8%, 51%)', text: 'hsl(0, 0%, 0%)', halo: 'hsl(0, 0%, 100%)' },
  dark: { casing: ['hsl(214, 17%, 31%)', 'hsl(250, 30%, 46%)'], state: ['hsl(250, 6%, 60%)', 'hsl(250, 10%, 70%)'], country: 'hsl(250, 10%, 65%)', text: 'hsl(215, 30%, 75%)', halo: 'hsl(214, 24%, 30%)' },
};
export const BORDER_LINES = ['admin-1-boundary', 'admin-0-boundary', 'admin-0-boundary-disputed'];
export function REAL(theme, { windOnTop = false } = {}) {
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
  const wind = [{ id: 'wind', type: 'custom' }, { id: 'wind-coastline', type: 'line', paint: { 'line-color': WIND_COASTLINE.color[theme], 'line-opacity': WIND_COASTLINE.opacity[theme] } }];   // each theme's own stroke (WebGLWindUtils.js)
  if (windOnTop) return [...style, ...wind];                                  // the under-labels kill: the wind above every style layer
  style.splice(style.findIndex((l) => l.id === windLayerBeforeId(style, theme, {})), 0, ...wind);
  return style;
}
export const INK = 'rgba(27, 30, 45, 0.85)';

/** The real styles' border block inside the app's stack: the hidden photo and slots under the wind, the radar frame above. */
export function STACK(theme, opts) {
  const app = APP(opts).filter((l) => !['admin-1-boundary', 'place-label', 'water-label'].includes(l.id)), real = REAL(theme), at = real.findIndex((l) => l.id === 'wind-coastline');
  return [...app.filter((l) => l.id !== 'rv-radar-frame' && l.id !== 'spot-geofences-layer'), ...real.slice(at), ...app.filter((l) => l.id === 'rv-radar-frame' || l.id === 'spot-geofences-layer')];
}
