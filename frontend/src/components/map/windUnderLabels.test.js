/**
 * WIND UNDER THE LABELS (2026-10-09, owner: "on light mode, its hard to see the continent/land below the hurricane ... when
 * zoomed up a little closer ... keep the coloring ... make the land a little more visible, without ruining the wind
 * animation"; then "check beach mode ... similar changes ... maybe slightly less bold"). The wind layer used to be appended
 * on top of every basemap layer; in light and beach it now goes just before the basemap's first 'admin-*' layer, so borders
 * and place names draw crisp above the tint and the streaks; dark followed ("a light border and labels ... designed for the
 * dark map"). Layer orders below are the real Mapbox styles (fetched 2026-10-09): navigation-day-v1 (light), outdoors-v11
 * (beach), navigation-night-v1 (dark).
 */
import fs from 'fs';
import path from 'path';
import { windLayerBeforeId, WIND_UNDER_LABELS, windCoastlineLayer, WIND_COASTLINE } from './WebGLWindUtils';

const tail = (ids) => ids.map((id) => ({ id }));
const NAV_DAY = tail(['land', 'water', 'road-primary-navigation', 'aerialway', 'admin-1-boundary-bg', 'admin-0-boundary-bg',
  'admin-1-boundary', 'admin-0-boundary', 'road-label-navigation', 'settlement-major-label', 'state-label', 'country-label']);
const OUTDOORS = tail(['land', 'water', 'hillshade', 'aerialway', 'admin-1-boundary-bg', 'admin-0-boundary-bg', 'admin-1-boundary',
  'contour-label', 'settlement-label', 'state-label', 'country-label']);
const NAV_NIGHT = tail(['land', 'water', 'road-primary-navigation', 'aerialway', 'admin-1-boundary-bg', 'admin-0-boundary-bg',
  'admin-1-boundary', 'admin-0-boundary', 'road-label-navigation', 'settlement-major-label', 'state-label', 'country-label']);

describe('windLayerBeforeId', () => {
  it('every theme goes under the borders + labels block', () => {
    expect(WIND_UNDER_LABELS.themes).toEqual(['light', 'beach', 'dark']);
    expect(windLayerBeforeId(NAV_DAY, 'light', {})).toBe('admin-1-boundary-bg');
    expect(windLayerBeforeId(OUTDOORS, 'beach', {})).toBe('admin-1-boundary-bg');
    expect(windLayerBeforeId(NAV_NIGHT, 'dark', {})).toBe('admin-1-boundary-bg');
  });
  it('the theme lever extends or narrows it; the kill switch restores the top for every theme', () => {
    expect(windLayerBeforeId(NAV_NIGHT, 'dark', { __RAW_WIND_UNDER_LABELS_THEMES__: 'light,beach' })).toBeUndefined();
    expect(windLayerBeforeId(OUTDOORS, 'beach', { __RAW_WIND_UNDER_LABELS_THEMES__: 'light' })).toBeUndefined();
    expect(windLayerBeforeId(NAV_DAY, 'light', { __RAW_DISABLE_WIND_UNDER_LABELS__: true })).toBeUndefined();
  });
  it('a style without admin layers (fallback basemap, style mid-load) keeps the layer on top', () => {
    expect(windLayerBeforeId(tail(['background', 'water', 'land']), 'light', {})).toBeUndefined();
    expect(windLayerBeforeId(undefined, 'light', {})).toBeUndefined();
    expect(windLayerBeforeId([null, { id: 7 }, { id: 'admin-0-boundary' }], 'light', {})).toBe('admin-0-boundary');
  });
  it('wiring: the layer is added with that anchor', () => {
    const src = fs.readFileSync(path.join(__dirname, 'WebGLWindLayer.js'), 'utf8');
    expect(src).toContain('beforeId = windLayerBeforeId(styleLayers, themeRef.current);');
    expect(src).toContain('mapInstance.addLayer(customLayer, beforeId);');
  });
});

describe('windCoastlineLayer: the basemap\'s own coastline, just above the wind', () => {
  const WATER = { id: 'water', type: 'fill', source: 'composite', 'source-layer': 'water' };
  const STYLE = [{ id: 'land' }, WATER, { id: 'admin-1-boundary-bg' }, { id: 'state-label' }];
  it('light 0.42 / beach 0.28 (slate) and dark 0.45 (pale slate, for the dark map) trace the water fill\'s own source', () => {
    const c = windCoastlineLayer(STYLE, 'light', true, {});
    expect(c).toMatchObject({ id: 'wind-coastline', type: 'line', source: 'composite', 'source-layer': 'water', layout: { visibility: 'visible' } });
    expect(c.paint['line-opacity']).toBe(0.42);
    expect(c.paint['line-color']).toBe(WIND_COASTLINE.color.light);
    expect(windCoastlineLayer(STYLE, 'beach', true, {}).paint['line-opacity']).toBe(0.28);
    const d = windCoastlineLayer(STYLE, 'dark', true, {});
    expect(d.paint['line-opacity']).toBe(0.45);
    expect(d.paint['line-color']).toBe('rgb(200, 214, 228)');   // a LIGHT line on the dark map
  });
  it('hidden while wind is off; levers for themes and opacity (clamped); kill switch; no water fill -> none', () => {
    expect(windCoastlineLayer(STYLE, 'light', false, {}).layout.visibility).toBe('none');
    expect(windCoastlineLayer(STYLE, 'dark', true, { __RAW_WIND_COASTLINE_THEMES__: 'light,beach' })).toBeNull();
    expect(windCoastlineLayer(STYLE, 'beach', true, { __RAW_WIND_COASTLINE_THEMES__: 'light' })).toBeNull();
    expect(windCoastlineLayer(STYLE, 'light', true, { __RAW_WIND_COASTLINE_OPACITY__: 0.6 }).paint['line-opacity']).toBe(0.6);
    expect(windCoastlineLayer(STYLE, 'light', true, { __RAW_WIND_COASTLINE_OPACITY__: 5 }).paint['line-opacity']).toBe(0.42);
    expect(windCoastlineLayer(STYLE, 'light', true, { __RAW_DISABLE_WIND_COASTLINE__: true })).toBeNull();
    expect(windCoastlineLayer([{ id: 'land' }, { id: 'water', type: 'line' }], 'light', true, {})).toBeNull();
  });
  it('wiring: added right after the wind layer with the same anchor, follows the wind toggle, removed with the layer', () => {
    const src = fs.readFileSync(path.join(__dirname, 'WebGLWindLayer.js'), 'utf8');
    expect(src).toContain('const coast = windCoastlineLayer(styleLayers, themeRef.current, activeRef.current);');
    expect(src).toContain('if (coast && !mapInstance.getLayer(coast.id)) mapInstance.addLayer(coast, beforeId);');
    expect(src).toContain("mapInstance.setLayoutProperty(WIND_COASTLINE.id, 'visibility', active ? 'visible' : 'none')");
    expect(src).toContain('if (mapInstance.getLayer(WIND_COASTLINE.id)) mapInstance.removeLayer(WIND_COASTLINE.id);');
  });
});
