/**
 * THE COAST IN THE BORDERS' INK (2026-10-12, DECISIONS D-028). The owner, on the deployed build: "I still cannot see the map as well
 * through the wind animations on light or beach modes. Dark mode I can see the map underneath it, better." The wind's own coastline
 * stroke (WebGLWindUtils.js WIND_COASTLINE) is drawn in the ink the borders take (windBasemapMute.js windCoastInk), and the layer's
 * style handler puts the stroke back when a theme change has dropped it (WebGLWindLayer.js). The bench measured the stroke
 * (scripts/wind-bench/border-run.js --lines coast) and the theme change (switch-run.js); here: the plan, the sync's safety with the
 * stroke in its record, and what the independent review of the first build found. Fixtures: basemapStyle.testutil.js.
 */
import fs from 'fs';
import path from 'path';
import { syncWindBasemapMute, windBasemapMuteStale, WIND_BORDER_INK, windBorderInkPlan, WIND_COAST_LINE, windCoastInk, parseColor } from './windBasemapMute';
import { WIND_COASTLINE, windCoastlineLayer, windCoastlineWanted } from './WebGLWindUtils';
import { fakeMap, BORDER_LINES, REAL, INK } from './basemapStyle.testutil';
import './WindColorRamp';   // the app's gate on the land's depth (D-026) is set by this module: the mute is tested as the app loads it

describe('THE COAST IN THE BORDERS\' INK (D-028): the wind\'s own coastline stroke is drawn in the ink the borders take', () => {
  const coast = (map) => ({ color: map.getPaintProperty('wind-coastline', 'line-color'), opacity: map.getPaintProperty('wind-coastline', 'line-opacity') });
  const own = (theme) => ({ color: WIND_COASTLINE.color[theme], opacity: WIND_COASTLINE.opacity[theme] }), OWN = own('light');
  it('the id this file inks is the id the layer is added under, and the stroke it replaces is the one the layer still draws', () => {
    expect(WIND_COAST_LINE).toBe(WIND_COASTLINE.id);
    const water = [{ id: 'water', type: 'fill', source: 'composite', 'source-layer': 'water' }];
    for (const theme of ['light', 'beach']) {
      const spec = windCoastlineLayer(water, theme, true, {});
      expect(spec.id).toBe(WIND_COAST_LINE);
      expect(parseColor(spec.paint['line-color'])).toEqual([45, 58, 72, 1]);            // the pale-ground stroke: what the kill gives back
      expect(typeof spec.paint['line-opacity']).toBe('number');                         // a literal: the plan writes a literal over it and restores it
    }
  });
  it('windCoastInk: 1 where the borders are inked; 0 in dark, under the ink\'s kill and under its own; the lever is its opacity', () => {
    expect(windCoastInk('light', {})).toBe(1);
    expect(windCoastInk('beach', {})).toBe(1);
    expect(windCoastInk('dark', {})).toBe(0);
    expect(windCoastInk('dark', { __RAW_WIND_COAST_INK__: 0.8, __RAW_WIND_BORDER_INK__: INK })).toBe(0);
    expect(windCoastInk('light', { __RAW_DISABLE_WIND_BORDER_INK__: true })).toBe(0);
    expect(windCoastInk('light', { __RAW_DISABLE_WIND_COAST_INK__: true })).toBe(0);
    expect(windCoastInk('light', { __RAW_WIND_COAST_INK__: 0.6 })).toBe(0.6);
    for (const bad of [0, 0.05, 1.2, '0.6', null, NaN]) expect(windCoastInk('light', { __RAW_WIND_COAST_INK__: bad })).toBe(1);
  });
  it('the plan: two entries for the coast (its colour, its opacity), marked; none unless asked for, and none where no border takes the ink', () => {
    const style = REAL('light'), ink = WIND_BORDER_INK.color.light;
    expect(windBorderInkPlan(style, 'wind', ink).filter((p) => p.id === 'wind-coastline')).toEqual([]);               // the default argument: the plan before D-028
    expect(windBorderInkPlan(style, 'wind', ink, 0)).toEqual(windBorderInkPlan(style, 'wind', ink));
    const plan = windBorderInkPlan(style, 'wind', ink, 1);
    expect(plan.filter((p) => p.coast)).toEqual([
      { id: 'wind-coastline', prop: 'line-color', from: 'rgb(45, 58, 72)', to: 'rgba(27, 30, 45, 0.7)', coast: true },
      { id: 'wind-coastline', prop: 'line-opacity', from: 0.42, to: 1, coast: true },
    ]);
    expect(plan.filter((p) => !p.coast)).toEqual(windBorderInkPlan(style, 'wind', ink));                              // the borders' entries are untouched
    expect(windBorderInkPlan(REAL('light', { windOnTop: true }), 'wind', ink, 1)).toEqual([]);                        // the under-labels kill: no border above the wind, no coast either
    expect(windBorderInkPlan(style.filter((l) => !BORDER_LINES.includes(l.id)), 'wind', ink, 1)).toEqual([]);         // it RIDES the borders' ink
  });
  it.each(['light', 'beach'])('%s, wind on: the stroke is the ink at the ink\'s own strength, and the read-back says so; wind off: byte for byte back', (theme) => {
    const map = fakeMap(REAL(theme)), win = {}, before = map.paint();
    const r = syncWindBasemapMute(map, theme, true, 'wind', win);
    expect(coast(map)).toEqual({ color: WIND_BORDER_INK.color[theme], opacity: 1 });
    expect(r.coast).toEqual({ applied: true, opacity: 1 });
    expect(win.__WIND_COAST_INK__).toMatchObject({ applied: true, opacity: 1, theme });
    expect(r.ink).toEqual({ applied: true, layers: 3, color: WIND_BORDER_INK.color[theme] });                         // the borders' read-back keeps its shape and its count
    const w = map.writes;
    expect(syncWindBasemapMute(map, theme, true, 'wind', win).coast).toEqual({ applied: true, opacity: 1 });          // idempotent
    expect(map.writes).toBe(w);
    expect(syncWindBasemapMute(map, theme, false, 'wind', win).coast).toEqual({ applied: false, opacity: 0, reason: 'wind off' });
    expect(coast(map)).toEqual(own(theme));
    expect(own('beach').opacity).toBe(0.28);                                                                          // the fixture is each theme's own stroke, not light's for all
    expect(map.paint()).toBe(before);
  });
  it('its own kill: the stroke as the layer drew it, the borders still inked, stale both ways, and the reason is named', () => {
    const map = fakeMap(REAL('light')), win = {};
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    win.__RAW_DISABLE_WIND_COAST_INK__ = true;
    expect(windBasemapMuteStale(map, 'light', true, 'wind', win)).toBe(true);
    const r = syncWindBasemapMute(map, 'light', true, 'wind', win);
    expect(coast(map)).toEqual(OWN);
    expect(r).toMatchObject({ applied: true, layers: 6, ink: { applied: true, layers: 3 }, coast: { applied: false, opacity: 0, reason: 'kill' } });
    expect(map.getPaintProperty('admin-0-boundary', 'line-color')).toBe(WIND_BORDER_INK.color.light);
    expect(windBasemapMuteStale(map, 'light', true, 'wind', win)).toBe(false);
    delete win.__RAW_DISABLE_WIND_COAST_INK__;
    expect(windBasemapMuteStale(map, 'light', true, 'wind', win)).toBe(true);
    expect(syncWindBasemapMute(map, 'light', true, 'wind', win).coast).toEqual({ applied: true, opacity: 1 });
    expect(coast(map)).toEqual({ color: WIND_BORDER_INK.color.light, opacity: 1 });
  });
  it('it rides the ink: the ink\'s kill, the mute\'s kill and dark leave the stroke alone, each with the ink\'s own reason', () => {
    for (const [theme, win, reason] of [['light', { __RAW_DISABLE_WIND_BORDER_INK__: true }, 'kill'], ['beach', { __RAW_DISABLE_WIND_BASEMAP_MUTE__: true }, 'mute off'], ['dark', {}, 'theme']]) {
      const map = fakeMap(REAL(theme));
      expect(syncWindBasemapMute(map, theme, true, 'wind', win).coast).toEqual({ applied: false, opacity: 0, reason });
      expect(coast(map)).toEqual(own(theme));
      expect(win.__WIND_COAST_INK__).toMatchObject({ applied: false, reason, theme });
    }
    const dark = fakeMap(REAL('dark'));
    syncWindBasemapMute(dark, 'dark', true, 'wind', {});
    expect(dark.writes).toBe(0);                                                                                       // dark is never touched
  });
  it('the lever is the stroke\'s opacity under the ink; the border lever moves the coast\'s colour with the borders\'', () => {
    const map = fakeMap(REAL('light')), win = { __RAW_WIND_COAST_INK__: 0.6 };
    expect(syncWindBasemapMute(map, 'light', true, 'wind', win).coast).toEqual({ applied: true, opacity: 0.6 });
    expect(coast(map)).toEqual({ color: WIND_BORDER_INK.color.light, opacity: 0.6 });
    win.__RAW_WIND_COAST_INK__ = 0.9;
    expect(windBasemapMuteStale(map, 'light', true, 'wind', win)).toBe(true);
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    expect(coast(map).opacity).toBe(0.9);
    const lev = fakeMap(REAL('light'));
    syncWindBasemapMute(lev, 'light', true, 'wind', { __RAW_WIND_BORDER_INK__: INK });
    expect(coast(lev)).toEqual({ color: INK, opacity: 1 });
  });
  it('a stroke the style REFUSES is not reported as inked, and one that is missing is named', () => {
    const map = fakeMap(REAL('light'));
    map.refuse = (id) => id === 'wind-coastline';
    expect(syncWindBasemapMute(map, 'light', true, 'wind', {})).toMatchObject({ ink: { applied: true, layers: 3 }, coast: { applied: false, opacity: 0, reason: 'the style refused the ink' } });
    const none = fakeMap(REAL('light').filter((l) => l.id !== 'wind-coastline'));
    expect(syncWindBasemapMute(none, 'light', true, 'wind', {})).toMatchObject({ ink: { applied: true, layers: 3 }, coast: { applied: false, reason: 'no coastline above the wind' } });
  });
  it('a theme change that re-adds the stroke with the new theme\'s paint: the old record never writes over it, and the next sync inks it', () => {
    const map = fakeMap(REAL('light')), win = {};
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    map.setPaintProperty('wind-coastline', 'line-color', 'rgb(45, 58, 72)');           // the layer re-added by the app for the new theme (WebGLWindLayer.js)
    map.setPaintProperty('wind-coastline', 'line-opacity', 0.28);
    syncWindBasemapMute(map, 'beach', true, 'wind', win);
    expect(coast(map)).toEqual({ color: WIND_BORDER_INK.color.beach, opacity: 1 });
    syncWindBasemapMute(map, 'beach', false, 'wind', win);
    expect(coast(map)).toEqual({ color: 'rgb(45, 58, 72)', opacity: 0.28 });           // restored to the NEW layer's own, not to light's 0.42
  });
});

describe('THE COAST INK AFTER ITS INDEPENDENT REVIEW (D-028): what the first build got wrong', () => {
  const stroke = (map) => [map.getPaintProperty('wind-coastline', 'line-color'), map.getPaintProperty('wind-coastline', 'line-opacity')];
  const WATER = [{ id: 'water', type: 'fill', source: 'composite', 'source-layer': 'water' }];
  const layerOf = (theme) => windCoastlineLayer(WATER, theme, true, {});
  const LAYER = fs.readFileSync(path.join(__dirname, 'WebGLWindLayer.js'), 'utf8');

  it('THE APP PUTS THE STROKE BACK: a diffed theme change keeps the custom wind layer and drops the coastline, and the handler re-adds it before anything else', () => {
    const handler = LAYER.slice(LAYER.indexOf('const handleStyleData = (ev) => {'), LAYER.indexOf("mapInstance.on('styledata', handleStyleData);"));
    const back = handler.indexOf("if (mapInstance.getLayer(LAYER_ID) && !mapInstance.getLayer(WIND_COASTLINE.id) && windCoastlineWanted(themeRef.current) && mapInstance.getLayer('water')) {");
    expect(back).toBeGreaterThan(0);
    expect(handler).toContain('if (coast) mapInstance.addLayer(coast, windLayerBeforeId(styleLayers, themeRef.current));');
    expect(back).toBeLessThan(handler.indexOf('if (!mapInstance.getLayer(LAYER_ID)) {'));                             // before the branch that adds the wind layer
    expect(back).toBeLessThan(handler.indexOf('windBasemapMuteStale(mapInstance'));                                    // and before the stale check that then inks it
    expect(LAYER).toContain("mapInstance.on('style.load', handleStyleData);");
  });
  it('windCoastlineWanted is the layer\'s own gate, asked before the style is read: its kill and its themes lever, and nothing else', () => {
    for (const theme of ['light', 'beach', 'dark']) expect(windCoastlineWanted(theme, {})).toBe(true);
    expect(windCoastlineWanted('light', { __RAW_DISABLE_WIND_COASTLINE__: true })).toBe(false);
    expect(windCoastlineWanted('dark', { __RAW_WIND_COASTLINE_THEMES__: 'light,beach' })).toBe(false);
    expect(windCoastlineWanted('retro', {})).toBe(false);
    for (const [theme, win] of [['light', {}], ['light', { __RAW_DISABLE_WIND_COASTLINE__: true }], ['dark', { __RAW_WIND_COASTLINE_THEMES__: 'light' }]]) expect(!!windCoastlineLayer(WATER, theme, true, win)).toBe(windCoastlineWanted(theme, win));
  });
  it('THE WHOLE SEQUENCE, light to beach by a diff: the stroke goes, the handler\'s steps put it back and ink it, and the wind going off leaves beach\'s own stroke', () => {
    const map = fakeMap(REAL('light')), win = {};
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    expect(stroke(map)).toEqual([WIND_BORDER_INK.color.light, 1]);
    map.removeLayer('wind-coastline');                                               // the library's diff: the new style does not name it
    expect(windBasemapMuteStale(map, 'beach', true, 'wind', win)).toBe(true);
    expect(syncWindBasemapMute(map, 'beach', true, 'wind', win).coast).toEqual({ applied: false, opacity: 0, reason: 'no coastline above the wind' });   // a sync that runs before the handler: no throw, and it says so
    expect(windBasemapMuteStale(map, 'beach', true, 'wind', win)).toBe(false);
    map.addLayer(layerOf('beach'), 'admin-1-boundary-bg');                           // the handler's first step
    expect(windBasemapMuteStale(map, 'beach', true, 'wind', win)).toBe(true);        // its second: the stale check sees a stroke the record never met
    expect(syncWindBasemapMute(map, 'beach', true, 'wind', win).coast).toEqual({ applied: true, opacity: 1 });
    expect(stroke(map)).toEqual([WIND_BORDER_INK.color.beach, 1]);
    expect(windBasemapMuteStale(map, 'beach', true, 'wind', win)).toBe(false);
    syncWindBasemapMute(map, 'beach', false, 'wind', win);
    expect(stroke(map)).toEqual([WIND_COASTLINE.color.beach, 0.28]);
  });
  it('a stroke added AFTER a sync is not left un-inked behind an early return (the review ran it: stale read false and the second sync wrote nothing)', () => {
    const map = fakeMap(REAL('light').filter((l) => l.id !== 'wind-coastline')), win = {};
    expect(syncWindBasemapMute(map, 'light', true, 'wind', win).coast).toMatchObject({ applied: false, reason: 'no coastline above the wind' });
    map.addLayer(layerOf('light'), 'admin-1-boundary-bg');
    expect(windBasemapMuteStale(map, 'light', true, 'wind', win)).toBe(true);
    expect(syncWindBasemapMute(map, 'light', true, 'wind', win).coast).toEqual({ applied: true, opacity: 1 });
    expect(stroke(map)).toEqual([WIND_BORDER_INK.color.light, 1]);
    // under the coast's own kill a stroke that comes or goes is nobody's business: not stale, no work
    const k = fakeMap(REAL('light').filter((l) => l.id !== 'wind-coastline')), kw = { __RAW_DISABLE_WIND_COAST_INK__: true };
    syncWindBasemapMute(k, 'light', true, 'wind', kw);
    k.addLayer(layerOf('light'), 'admin-1-boundary-bg');
    expect(windBasemapMuteStale(k, 'light', true, 'wind', kw)).toBe(false);
  });
  it('it rides the ink that TOOK: every border refused and the stroke accepted is NOT a coast in ink', () => {
    const map = fakeMap(REAL('light'));
    map.refuse = (id) => /^admin-/.test(id);
    const r = syncWindBasemapMute(map, 'light', true, 'wind', {});
    expect(r.ink).toEqual({ applied: false, layers: 0, reason: 'the style refused the ink' });
    expect(r.coast).toEqual({ applied: false, opacity: 0, reason: 'no border line took the ink' });
    expect(stroke(map)).toEqual([WIND_COASTLINE.color.light, 0.42]);
  });
  it.each([['line-opacity'], ['line-color']])('never half a stroke: with its %s refused the other value goes back too, the read-back says refused, and the restore is exact', (prop) => {
    const map = fakeMap(REAL('light')), before = map.paint();
    map.refuse = (id, p) => id === 'wind-coastline' && p === prop;
    const r = syncWindBasemapMute(map, 'light', true, 'wind', {});
    expect(r.coast).toEqual({ applied: false, opacity: 0, reason: 'the style refused the ink' });
    expect(r.ink).toEqual({ applied: true, layers: 3, color: WIND_BORDER_INK.color.light });
    expect(stroke(map)).toEqual([WIND_COASTLINE.color.light, 0.42]);                 // not the ink at 0.42, and not slate at 1
    map.refuse = null;
    syncWindBasemapMute(map, 'light', false, 'wind', {});
    expect(map.paint()).toBe(before);
  });
  it('a rebuilt stroke whose own opacity equals ours is the NEW layer\'s: the old record does not write its 0.42 over it', () => {
    const map = fakeMap(REAL('light')), win = {};
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    map.setPaintProperty('wind-coastline', 'line-color', WIND_COASTLINE.color.beach);    // the layer re-added for the new theme under the opacity lever at 1
    map.setPaintProperty('wind-coastline', 'line-opacity', 1);
    expect(syncWindBasemapMute(map, 'beach', true, 'wind', win).coast).toEqual({ applied: true, opacity: 1 });
    expect(stroke(map)).toEqual([WIND_BORDER_INK.color.beach, 1]);
    syncWindBasemapMute(map, 'beach', false, 'wind', win);
    expect(stroke(map)).toEqual([WIND_COASTLINE.color.beach, 1]);                         // the new layer's own, to the end
  });
  it('every reason the read-back can give is one a reader can act on: no map, and a style that throws', () => {
    expect(syncWindBasemapMute(null, 'light', true, 'wind', {}).coast).toEqual({ applied: false, opacity: 0, reason: 'no map' });
    const map = fakeMap(REAL('light'));
    map.getStyle = () => { throw new Error('style not loaded'); };
    expect(syncWindBasemapMute(map, 'light', true, 'wind', {}).coast).toEqual({ applied: false, opacity: 0, reason: 'error: style not loaded' });
  });
  it('KNOWN AND LEFT (the review, low): in the fetch window of a dark-to-light change the re-sync can run on dark\'s style under light\'s name; with the theme still dark nothing is ever written', () => {
    const map = fakeMap(REAL('dark'));
    syncWindBasemapMute(map, 'dark', true, 'wind', { __RAW_WIND_COAST_INK__: 0.9, __RAW_WIND_BORDER_INK__: INK, __RAW_WIND_BASEMAP_MUTE__: 0 });
    expect(map.writes).toBe(0);
    expect(stroke(map)).toEqual([WIND_COASTLINE.color.dark, 0.45]);
  });
});
