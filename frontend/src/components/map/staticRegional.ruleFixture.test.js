/**
 * The shared box -> {tile, covers, window} fixture for the regional tile rule (2026-10-24).
 *
 * The client rule (staticRegional.js: pickRegionalTile + regionalClipWindow) and its Python port (the server's MARINE_REGIONAL_TILE_FIRST,
 * #508: the smallest containing manifest tile, an exact area tie -> none, the 1-deg snapped box inside the data extent, the served window
 * covering the request at margin 0) must agree on every box. This test regenerates the cases from the REAL functions and compares them
 * with the committed JSON, so the client cannot drift from it; the server test reads the same file (frontend/src/tests/fixtures/
 * regional_rule_boxes.json) so the two ports cannot drift from each other.
 *
 *   WRITE_REGIONAL_RULE_FIXTURE=1 CI=true npx react-scripts test --watchAll=false src/components/map/staticRegional.ruleFixture
 *
 * rewrites the file (review the diff: a changed case is a changed rule). Tiles: the 19 pilot boxes (PILOT_BOXES, pinned to
 * pilot_regions.py) with the manifest coverage = the box, and each tile's DATA lattice = the 0.25-deg nodes inside the box (so
 * us_southeast_midatlantic's coverage east -74.4 has its last node at -74.5, us_northeast's west -76.1 starts at -76.0, ...); plus one
 * SYNTHETIC tile (`synthetic_offset_lattice`, 0.5-deg nodes at x.25) where the snapped box sits inside the data but the served window
 * still misses the request (no real pilot tile has an offset lattice; the case pins the rule for when one does).
 */
import fs from 'fs';
import path from 'path';
import { setCachedManifest } from './backendWeatherServiceClientCoverage';
import { PILOT_BOXES, _setRegionalCodecForTest, pickRegionalTile, regionalClipWindow } from './staticRegional';

const FIXTURE = path.resolve(process.cwd(), 'src/tests/fixtures/regional_rule_boxes.json');
const RES = 0.25;
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const fmt = (x) => String(r4(x));
const boxStr = (w, s, e, n) => [w, s, e, n].map(fmt).join(',');

function tileGrid(w, s, e, n, res) {
  const west = r4(Math.ceil(w / res - 1e-9) * res); const east = r4(Math.floor(e / res + 1e-9) * res);
  const south = r4(Math.ceil(s / res - 1e-9) * res); const north = r4(Math.floor(n / res + 1e-9) * res);
  return { bounds: { west, south, east, north }, cols: Math.round((east - west) / res) + 1, rows: Math.round((north - south) / res) + 1, resolution: res };
}

const TILES = [
  ...PILOT_BOXES.map(([id, w, s, e, n]) => ({ id, coverage: { west: w, south: s, east: e, north: n }, grid: tileGrid(w, s, e, n, RES) })),
  // the synthetic offset lattice: 0.5-deg nodes at x.25 (0.25 ... 9.75), well away from every real pilot box
  // an exact AREA TIE (both 10 x 10 deg, overlapping at 22..30 x 20..30) and a smaller tile inside both: no real pilot boxes overlap
  { id: 'synthetic_tie_a', synthetic: true, coverage: { west: 20, south: 20, east: 30, north: 30 }, grid: tileGrid(20, 20, 30, 30, RES) },
  { id: 'synthetic_tie_b', synthetic: true, coverage: { west: 22, south: 20, east: 32, north: 30 }, grid: tileGrid(22, 20, 32, 30, RES) },
  { id: 'synthetic_small', synthetic: true, coverage: { west: 22.5, south: 21, east: 29.5, north: 29 }, grid: tileGrid(22.5, 21, 29.5, 29, RES) },
  { id: 'synthetic_offset_lattice', synthetic: true, coverage: { west: 0.25, south: 0.25, east: 9.75, north: 9.75 }, grid: { bounds: { west: 0.25, south: 0.25, east: 9.75, north: 9.75 }, cols: 20, rows: 20, resolution: 0.5 } },
];

function boxesFor(t) {
  const { west: w, south: s, east: e, north: n } = t.coverage; const cx = (w + e) / 2; const cy = (s + n) / 2; const out = [];
  const add = (kind, a, b, c, d) => out.push({ kind, box: boxStr(a, b, c, d) });
  add('tile', w, s, e, n);                                                     // the tile's own box
  add('z8-small', cx - 1, cy - 0.75, cx + 1, cy + 0.75);                       // a z8 view-sized box in the middle
  add('z9-small', cx - 0.5, cy - 0.4, cx + 0.5, cy + 0.4);
  add('inside-0.01', w + 0.01, s + 0.01, e - 0.01, n - 0.01);                   // 0.01 inside every edge
  add('corner-sw', w + 0.01, s + 0.01, w + 1.2, s + 1.1);
  add('corner-ne', e - 1.2, n - 1.1, e - 0.01, n - 0.01);
  add('past-west', w - 0.5, cy - 0.5, w + 1, cy + 0.5);                        // 0.5 past an edge: not inside the tile
  add('past-east', e - 1, cy - 0.5, e + 0.5, cy + 0.5);
  add('past-south', cx - 0.5, s - 0.5, cx + 0.5, s + 1);
  add('past-north', cx - 0.5, n - 1, cx + 0.5, n + 0.5);
  add('near-east', e - 1.3, cy - 0.5, e - 0.05, cy + 0.5);                      // inside the coverage, its snapped box can pass the data edge
  add('near-west', w + 0.05, cy - 0.5, w + 1.3, cy + 0.5);
  add('near-north', cx - 0.5, n - 1.3, cx + 0.5, n - 0.05);
  add('near-south', cx - 0.5, s + 0.05, cx + 0.5, s + 1.3);
  return out;
}

const EXTRA = [   // boxes that belong to no single tile
  ['world', -180, -80, 180, 85], ['mid-ocean', -40, 10, -30, 20], ['atlantic-straddle-fl-se', -82.5, 30.5, -78.5, 31.5],
  ['two-tiles-ne-se', -76, 36.5, -72, 38.5], ['antimeridian-east-edge', 175, -20, 179.9, -15],
  ['synthetic-tie', 22.2, 29.2, 29.8, 29.9], ['synthetic-smallest-wins', 24, 22, 28, 27], ['synthetic-only-a', 20.5, 22, 21.5, 24],
  ['synthetic-snapped-inside-window-misses', 1.1, 1.1, 2.9, 2.9], ['synthetic-covered', 1.3, 1.3, 2.7, 2.7],
].map(([kind, a, b, c, d]) => ({ kind, box: boxStr(a, b, c, d) }));

function compute() {
  window.__RAW_ENABLE_REGIONAL_BUNDLES__ = true;
  window.__RAW_STATIC_REGIONAL_TRACE__ = [];
  _setRegionalCodecForTest({ sha12: async () => 'x', gunzip: async (b) => b });
  setCachedManifest({ products: TILES.map((t) => ({ model: 'GFS', domain: 'marine', layer: 'waves', region_id: t.id, coverage: t.coverage })) });
  const byId = new Map(TILES.map((t) => [t.id, t]));
  const cases = [];
  const all = [...TILES.flatMap((t) => boxesFor(t).map((c) => ({ ...c, of: t.id }))), ...EXTRA.map((c) => ({ ...c, of: null }))];
  for (const c of all) {
    const tile = pickRegionalTile({ model: 'GFS', layer: 'waves', bboxStr: c.box });
    const reason = window.__RAW_STATIC_REGIONAL_TRACE__[window.__RAW_STATIC_REGIONAL_TRACE__.length - 1];
    const win = tile ? regionalClipWindow(c.box, byId.get(tile.id).grid, 'GFS') : null;
    cases.push({ kind: c.kind, of: c.of, box: c.box, tile: tile ? tile.id : null, reason: tile ? null : (reason && reason.pick) || null,
      covers: win ? win.covers : null, snapInside: win ? win.snapInside : null, snapped: win ? win.snapped : null,
      window: win ? { ...win.bounds, cols: win.cols, rows: win.rows } : null });
  }
  return { cases };
}

describe('the regional tile rule fixture (client <-> server shared)', () => {
  afterEach(() => { delete window.__RAW_ENABLE_REGIONAL_BUNDLES__; delete window.__RAW_STATIC_REGIONAL_TRACE__; _setRegionalCodecForTest(); setCachedManifest(null); });

  it('the committed JSON equals what pickRegionalTile + regionalClipWindow compute for every box', () => {
    const { cases } = compute();
    const doc = {
      what: 'Shared fixture for the regional tile rule: a box (the bbox string the client sends) -> the tile pickRegionalTile picks (null = none and why), and for a picked '
        + 'tile the Step 3 window regionalClipWindow computes (covers = the margin-0 partial_coverage test AND the snapped box inside the data extent).',
      rule: ['model GFS, marine waves; manifest tiles = the 19 pilot boxes (coverage = the box) + one synthetic offset-lattice tile',
        'tile: the smallest manifest coverage containing the whole request; an exact area tie -> none; world-span tiles are not regional',
        'window: 1-deg snap (floor west/south, ceil east/north), clamp, then clamp to the tile DATA extent, then the lattice nodes inside',
        'covers: snapped box inside the data extent AND window.bounds contain the request (margin 0)'],
      generator: 'frontend/src/components/map/staticRegional.ruleFixture.test.js (WRITE_REGIONAL_RULE_FIXTURE=1 rewrites this file)',
      tiles: TILES.map((t) => ({ id: t.id, synthetic: !!t.synthetic, coverage: t.coverage, data: t.grid })),
      cases,
    };
    if (process.env.WRITE_REGIONAL_RULE_FIXTURE === '1') {
      fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
      fs.writeFileSync(FIXTURE, `${JSON.stringify(doc, null, 1)}\n`);
    }
    const committed = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    expect(committed).toEqual(JSON.parse(JSON.stringify(doc)));
  });

  it('the fixture exercises each outcome (so a rule change cannot pass vacuously)', () => {
    const { cases } = compute();
    const picked = cases.filter((c) => c.tile);
    expect(picked.length).toBeGreaterThan(150);
    expect(cases.filter((c) => c.tile === null).length).toBeGreaterThan(40);
    expect(picked.filter((c) => c.covers === true).length).toBeGreaterThan(60);
    expect(picked.filter((c) => c.covers === false).length).toBeGreaterThan(10);
    expect(picked.filter((c) => c.covers === false && c.snapInside === false).length).toBeGreaterThan(5);        // snapped past the data
    const misses = picked.find((c) => c.kind === 'synthetic-snapped-inside-window-misses');
    expect(misses).toMatchObject({ tile: 'synthetic_offset_lattice', snapInside: true, covers: false });          // the offset-lattice case
    expect(cases.find((c) => c.kind === 'synthetic-covered')).toMatchObject({ tile: 'synthetic_offset_lattice', covers: true });
    const se = cases.find((c) => c.of === 'us_southeast_midatlantic' && c.kind === 'near-east');
    expect(se.window.east).toBeLessThanOrEqual(-74.5);                                                          // the fractional -74.4 edge: last node -74.5
    expect(cases.find((c) => c.kind === 'world')).toMatchObject({ tile: null });
    expect(cases.find((c) => c.kind === 'synthetic-tie')).toMatchObject({ tile: null, reason: 'tie' });             // an exact area tie -> none
    expect(cases.find((c) => c.kind === 'synthetic-smallest-wins')).toMatchObject({ tile: 'synthetic_small' });
    expect(cases.find((c) => c.kind === 'synthetic-only-a')).toMatchObject({ tile: 'synthetic_tie_a' });
  });
});
