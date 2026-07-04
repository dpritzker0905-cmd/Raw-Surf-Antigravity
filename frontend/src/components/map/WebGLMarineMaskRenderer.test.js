/**
 * Per-polygon culling for the mercator land mask (2026-07-03) — THE all-black regional mask root.
 * The 10m land GeoJSON has ~10 CONTINENT-scale MultiPolygon features, so the feature-level bbox
 * test passes for nearly all of them on any regional target; their far-side member polygons then
 * project through wrapLngRelative with ±360° x-jumps near the anti-center meridian and their fill
 * sweeps the ENTIRE canvas black. An all-black ocean mask makes ADVECT drop every particle and
 * masks out the regional heatmap — the "crests dead at close zoom until any bounds-changing
 * commit" state (live repro at (-79.9, 28.3) z9; isolated replica: FL tile drew 9/10 features →
 * 0% ocean; global control 63.8% ocean).
 */
import { getPolygonBbox, polygonOverlapsTarget, overlayBasemapWaterOnMask, classifySheltered } from './WebGLMarineMaskRenderer';

// jsdom has no 2D canvas — keep the sheltered-water canvas wrapper out of the painter tests
// (its pure grid core is covered directly by the classifySheltered describe below).
beforeAll(() => { window.__RAW_DISABLE_SHELTERED_WATER__ = true; });
afterAll(() => { delete window.__RAW_DISABLE_SHELTERED_WATER__; });

// A rectangular polygon-coordinates array (outer ring only).
const rect = (west, south, east, north) => [[
  [west, south], [east, south], [east, north], [west, north], [west, south],
]];

// The FL regional target: bounds -82..-79 / 27..30, center -80.5.
const target = { wrappedWest: -82, wrappedEast: -79, south: 27, north: 30, center: -80.5 };
const overlaps = (poly) => polygonOverlapsTarget(
  getPolygonBbox(poly), target.wrappedWest, target.wrappedEast, target.south, target.north, target.center
);

describe('per-polygon mask culling (all-black regional mask fix)', () => {
  it('culls a far-side polygon (Eurasia-like) that crosses the anti-center meridian', () => {
    // lng 30..170 spans the anti-center meridian (99.5°E for center -80.5) — the exact geometry
    // whose wrapped projection smeared the whole canvas black.
    expect(overlaps(rect(30, 10, 170, 70))).toBe(false);
  });

  it('culls a same-hemisphere polygon far outside the box (South America)', () => {
    expect(overlaps(rect(-80, -55, -35, 10))).toBe(false);
  });

  it('keeps a polygon overlapping the target box (Florida/NA mainland)', () => {
    expect(overlaps(rect(-168, 7, -52, 83))).toBe(true);   // North America mainland
    expect(overlaps(rect(-81, 24, -79.8, 30.7))).toBe(true); // Florida peninsula
  });

  it('keeps nearby islands within the 1° pad', () => {
    expect(overlaps(rect(-78.9, 26.5, -77.0, 27.2))).toBe(true); // Bahamas at the east edge + pad
  });

  it('culls by latitude even when longitudes overlap (Antarctica-like)', () => {
    expect(overlaps(rect(-180, -90, 180, -60))).toBe(false);
  });

  it('caches the polygon bbox on the coordinates array', () => {
    const poly = rect(-81, 24, -79.8, 30.7);
    const b1 = getPolygonBbox(poly);
    const b2 = getPolygonBbox(poly);
    expect(b2).toBe(b1);
    expect(b1).toEqual({ west: -81, east: -79.8, south: 24, north: 30.7 });
  });
});

describe('overlayBasemapWaterOnMask — finest-tile truth (the Lido gap-island, 2026-07-04)', () => {
  // Gap-islands (Lido class) are land BETWEEN two water polygons — not a hole ring in either — so
  // an overzoomed parent tile that paints across them cannot be healed by the hole-reassert pass.
  // The painter must therefore take its polygons from the RENDERED (finest) tiles, and only fall
  // back to the all-loaded-levels source query when the render query yields nothing.
  const mkCtx = () => {
    const calls = [];
    const ctx = { fillStyle: '#000' };
    for (const m of ['save', 'beginPath', 'rect', 'clip', 'fillRect', 'moveTo', 'lineTo', 'closePath', 'fill', 'restore']) {
      ctx[m] = (...a) => calls.push([m, ...a]);
    }
    return { ctx, calls };
  };
  const mkCanvas = (ctx) => ({ width: 256, height: 128, getContext: () => ctx });
  const bounds = { west: 11, south: 44, east: 13, north: 46 };
  const oceanFeat = {
    properties: { class: 'ocean' },
    geometry: { type: 'Polygon', coordinates: [[[11.5, 44.5], [12.5, 44.5], [12.5, 45.5], [11.5, 45.5], [11.5, 44.5]]] },
  };
  const mkMap = ({ rendered, source }) => ({
    getStyle: () => ({ layers: [{ id: 'water', type: 'fill', source: 'composite', 'source-layer': 'water' }] }),
    getBounds: () => ({ getWest: () => 12.2, getEast: () => 12.5, getSouth: () => 45.3, getNorth: () => 45.5 }),
    queryRenderedFeatures: jest.fn(() => rendered),
    querySourceFeatures: jest.fn(() => source),
  });

  it('prefers the RENDERED (finest-tile) water polygons and never touches the all-levels source query', () => {
    const { ctx } = mkCtx();
    const map = mkMap({ rendered: [oceanFeat], source: [oceanFeat] });
    const ok = overlayBasemapWaterOnMask(mkCanvas(ctx), bounds, map);
    expect(ok).toBe(true);
    expect(map.queryRenderedFeatures).toHaveBeenCalledWith({ layers: ['water'] });
    // WATER polygons must never come from the all-levels source query (the wetland pass may
    // source-query landuse_overlay/landcover — painting land black is parent-tile-safe).
    expect(map.querySourceFeatures).not.toHaveBeenCalledWith('composite', { sourceLayer: 'water' });
  });

  it('falls back to querySourceFeatures when the render query returns nothing', () => {
    const { ctx } = mkCtx();
    const map = mkMap({ rendered: [], source: [oceanFeat] });
    const ok = overlayBasemapWaterOnMask(mkCanvas(ctx), bounds, map);
    expect(ok).toBe(true);
    expect(map.querySourceFeatures).toHaveBeenCalledWith('composite', { sourceLayer: 'water' });
  });

  it('falls back to querySourceFeatures when the render query throws (style mid-load)', () => {
    const { ctx } = mkCtx();
    const map = mkMap({ rendered: [], source: [oceanFeat] });
    map.queryRenderedFeatures = jest.fn(() => { throw new Error('style not loaded'); });
    expect(overlayBasemapWaterOnMask(mkCanvas(ctx), bounds, map)).toBe(true);
    expect(map.querySourceFeatures).toHaveBeenCalled();
  });

  it('returns false when neither query yields features (patch left untouched, NE base mask stands)', () => {
    const { ctx, calls } = mkCtx();
    const map = mkMap({ rendered: [], source: [] });
    expect(overlayBasemapWaterOnMask(mkCanvas(ctx), bounds, map)).toBe(false);
    expect(calls.filter(([m]) => m === 'fillRect').length).toBe(0);
  });
});

describe('overlayBasemapWaterOnMask — wetland/tidal-flat black-out (Venice lagoon marshes, 2026-07-04)', () => {
  // Sea-connected lagoons arrive as OCEAN-class water (OSM coastline convention), so marshes drawn
  // on top as landcover WETLAND polygons must repaint black or crest dashes march over visible land.
  const mkCtx = () => {
    const calls = [];
    const ctx = {};
    let style = '#000';
    Object.defineProperty(ctx, 'fillStyle', { get: () => style, set: (v) => { style = v; calls.push(['fillStyle', v]); } });
    for (const m of ['save', 'beginPath', 'rect', 'clip', 'fillRect', 'moveTo', 'lineTo', 'closePath', 'restore']) {
      ctx[m] = (...a) => calls.push([m, ...a]);
    }
    ctx.fill = (...a) => calls.push(['fill', style, ...a]);
    return { ctx, calls };
  };
  const bounds = { west: 11, south: 44, east: 13, north: 46 };
  const oceanFeat = {
    properties: { class: 'ocean' },
    geometry: { type: 'Polygon', coordinates: [[[11.5, 44.5], [12.5, 44.5], [12.5, 45.5], [11.5, 45.5], [11.5, 44.5]]] },
  };
  const marshFeat = {
    properties: { class: 'wetland' },
    geometry: { type: 'Polygon', coordinates: [[[12.28, 45.42], [12.34, 45.42], [12.34, 45.47], [12.28, 45.47], [12.28, 45.42]]] },
  };
  const grassFeat = {
    properties: { class: 'grass' },
    geometry: { type: 'Polygon', coordinates: [[[12.2, 45.2], [12.3, 45.2], [12.3, 45.3], [12.2, 45.3], [12.2, 45.2]]] },
  };
  const mkMap = () => ({
    getStyle: () => ({ layers: [
      { id: 'water', type: 'fill', source: 'composite', 'source-layer': 'water' },
    ] }),
    getBounds: () => ({ getWest: () => 12.2, getEast: () => 12.5, getSouth: () => 45.3, getNorth: () => 45.5 }),
    queryRenderedFeatures: jest.fn(({ layers }) => (layers.includes('water') ? [oceanFeat] : [])),
    // Wetlands come from the SOURCE query (the style renders no wetland layer, so a render query
    // can never see them); Mapbox Streets schema: landuse_overlay.
    querySourceFeatures: jest.fn((src, { sourceLayer }) =>
      (sourceLayer === 'landuse_overlay' ? [marshFeat, grassFeat] : [])),
  });

  it('paints wetland polygons BLACK after the water passes; non-wetland classes are ignored', () => {
    const { ctx, calls } = mkCtx();
    const map = mkMap();
    const ok = overlayBasemapWaterOnMask({ width: 256, height: 128, getContext: () => ctx }, bounds, map);
    expect(ok).toBe(true);
    expect(map.querySourceFeatures).toHaveBeenCalledWith('composite', { sourceLayer: 'landuse_overlay' });
    expect(map.querySourceFeatures).toHaveBeenCalledWith('composite', { sourceLayer: 'landcover' });
    const fills = calls.filter(([m]) => m === 'fill');
    // Order: white water fill(s) first, then black passes; the LAST fill is the black marsh polygon
    // (grass filtered out — only one wetland feature traces after the whites).
    expect(fills[0][1]).toBe('#ffffff');
    expect(fills[fills.length - 1][1]).toBe('#000000');
    const blackFills = fills.filter(([, s]) => s === '#000000');
    expect(blackFills.length).toBe(1);   // exactly the marsh — grass did NOT paint
  });

  it('keeps the water-only patch when the tiles carry no wetland features', () => {
    const { ctx, calls } = mkCtx();
    const map = mkMap();
    map.querySourceFeatures = jest.fn(() => []);
    expect(overlayBasemapWaterOnMask({ width: 256, height: 128, getContext: () => ctx }, bounds, map)).toBe(true);
    const fills = calls.filter(([m]) => m === 'fill');
    expect(fills.filter(([, s]) => s === '#000000').length).toBe(0); // nothing painted black beyond hole pass
  });
});

describe('classifySheltered — enclosed-basin connectivity (sheltered-water suppression, 2026-07-04)', () => {
  // Build a binary water grid from ASCII rows: '.' = water, '#' = land.
  const gridFrom = (rows) => {
    const h = rows.length, w = rows[0].length;
    const water = new Uint8Array(w * h);
    rows.forEach((r, y) => { for (let x = 0; x < w; x++) water[y * w + x] = r[x] === '.' ? 1 : 0; });
    return { water, w, h };
  };
  const W = 30, H = 15;
  // Base scene: open sea in cols 0-9 (touches the border), land everywhere else unless carved.
  const mkRows = (carve) => {
    const rows = [];
    for (let y = 0; y < H; y++) {
      let r = '';
      for (let x = 0; x < W; x++) r += (x < 10 || carve(x, y)) ? '.' : '#';
      rows.push(r);
    }
    return rows;
  };
  const lagoon = (x, y) => (x >= 21 && x <= 28 && y >= 4 && y <= 11);
  const at = (w) => (x, y) => y * w + x;

  it('a lagoon behind a channel NARROWER than the gap threshold is SHELTERED', () => {
    // 1-px channel at row 7 → erosion radius 2 seals it.
    const { water, w, h } = gridFrom(mkRows((x, y) => lagoon(x, y) || (y === 7 && x >= 10 && x <= 20)));
    const { sheltered, count } = classifySheltered(water, w, h, 2);
    const i = at(w);
    expect(sheltered[i(24, 7)]).toBe(1);   // lagoon center suppressed
    expect(sheltered[i(4, 7)]).toBe(0);    // open sea untouched
    expect(count).toBeGreaterThan(20);
  });

  it('the same lagoon behind a WIDE entrance stays OPEN', () => {
    // 7-row channel (rows 4-10) → core survives erosion → flood reaches the lagoon.
    const { water, w, h } = gridFrom(mkRows((x, y) => lagoon(x, y) || (y >= 4 && y <= 10 && x >= 10 && x <= 20)));
    const { sheltered, count } = classifySheltered(water, w, h, 2);
    expect(sheltered[at(w)(24, 7)]).toBe(0);
    expect(count).toBe(0);
  });

  it('open sea alone marks nothing sheltered', () => {
    const rows = []; for (let y = 0; y < H; y++) rows.push('.'.repeat(W));
    const { water, w, h } = gridFrom(rows);
    expect(classifySheltered(water, w, h, 2).count).toBe(0);
  });

  it('a fully enclosed BASIN-SCALE water body is entirely sheltered', () => {
    // 16x10 = 160 px ≥ the min-area gate (16·nPx² = 64) — a real lagoon/harbor basin.
    const pond = (x, y) => (x >= 12 && x <= 27 && y >= 3 && y <= 12);
    const { water, w, h } = gridFrom(mkRows(pond));
    const { sheltered, count } = classifySheltered(water, w, h, 2);
    expect(sheltered[at(w)(19, 7)]).toBe(1);
    expect(count).toBe(160);   // the whole pond
  });

  it('a SHORT narrow passage between open seas releases; a LONG one stays suppressed (Canal Grande, live z16)', () => {
    // The passage-vs-canal discriminator is PROXIMITY TO THE OPEN CORE, not area alone: a short
    // strait hugs the core at both ends (>50% of its pixels within 2·nPx of open water) and is
    // fairway; a long dead-end-like channel (an urban canal at ds resolution) only touches the
    // core at its mouth — swell honestly dies in it, so it stays sheltered.
    const mk = (chanFrom, chanTo, rightSeaFrom) => {
      const rows = [];
      for (let y = 0; y < H; y++) {
        let r = '';
        for (let x = 0; x < W; x++) {
          const leftSea = x < 10, rightSea = x >= rightSeaFrom, channel = (y === 7 && x >= chanFrom && x < chanTo);
          r += (leftSea || rightSea || channel) ? '.' : '#';
        }
        rows.push(r);
      }
      return gridFrom(rows);
    };
    // SHORT: 6-px channel between the seas → released (fairway).
    const shortCase = mk(10, 16, 16);
    expect(classifySheltered(shortCase.water, shortCase.w, shortCase.h, 2).count).toBe(0);
    // LONG: 15-px channel → the middle is far from any open core → stays sheltered.
    const longCase = mk(10, 25, 25);
    expect(classifySheltered(longCase.water, longCase.w, longCase.h, 2).count).toBeGreaterThan(0);
  });
});
