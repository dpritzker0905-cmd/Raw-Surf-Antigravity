/**
 * The shipped lake asset against the REAL Natural Earth land (2026-10-24): every lake in public/wave_lakes.json must be found inside
 * a land polygon by cutLakes (else it would silently stay land), and the lakes EURO carries valid inland nodes on (static-frames'
 * trace of #497's nodes: the Great Lakes, Winnipeg, Victoria, Taihu at 32N 120E, Lagoa Mirim at 32S 54W) must be carried by a real
 * 2-degree lattice, while the lower Amazon (a river), Okeechobee, Salton, Nicaragua and Ladoga must not be.
 */
import fs from 'fs';
import path from 'path';
import { _setWaveLakesForTest, cutLakes, lakesCarried } from './waveLakes';

const ASSET = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'public/wave_lakes.json'), 'utf8'));
const LAND = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'public/ne_50m_land.json'), 'utf8'));

// A 2-degree world lattice (EURO's mid tier) with exactly these nodes valid.
function lattice(nodes, model = 'EURO') {
  const on = new Set(nodes.map(([lat, lng]) => `${lat},${lng}`)); const vectors = [];
  for (let lat = -80; lat <= 84; lat += 2) for (let lng = -180; lng <= 180; lng += 2) vectors.push({ lat, lng, speed: 1, is_valid: on.has(`${lat},${lng}`) });
  return { __sourceModel: model, cols: 181, rows: 83, bounds: { west: -180, south: -80, east: 180, north: 84 }, vectors };
}

beforeEach(() => { _setWaveLakesForTest(ASSET); });
afterEach(() => { _setWaveLakesForTest(null); });

describe('the shipped asset', () => {
  it('holds the nine lakes, each with outlines and anchors', () => {
    expect(ASSET.lakes.map((l) => l.id)).toEqual(['superior', 'michigan', 'huron', 'erie', 'ontario', 'winnipeg', 'victoria', 'taihu', 'mirim']);
    for (const l of ASSET.lakes) { expect(l.g50.length).toBeGreaterThan(0); expect(l.g10.length).toBeGreaterThan(0); expect(l.anchors.length).toBeGreaterThan(0); }
  });
  it('every lake is cut out of a real land polygon at both resolutions (none silently stays land)', () => {
    for (const res of [50, 10]) {
      const v = cutLakes(LAND, ASSET.lakes, res);
      expect(v.__waveLakesCut).toBe(ASSET.lakes.length);
    }
  });
});

describe('which lakes real EURO nodes carry', () => {
  it('Taihu (32N 120E) and Lagoa Mirim (32S 54W) are carried; so are the others they sit beside', () => {
    expect(lakesCarried(lattice([[32, 120]]))).toEqual(['taihu']);
    expect(lakesCarried(lattice([[-32, -54]]))).toEqual(['mirim']);
    expect(lakesCarried(lattice([[52, -98]]))).toEqual(['winnipeg']);
    expect(lakesCarried(lattice([[0, 32], [-2, 34]]))).toEqual(['victoria']);
  });
  it('the lower Amazon (2S 54W), Okeechobee, Salton Sea, Nicaragua and Ladoga carry no lake', () => {
    for (const node of [[-2, -54], [26, -80], [34, -116], [12, -86], [60, 32]]) expect(lakesCarried(lattice([node]))).toEqual([]);
  });
  it('GFS and ICON never carry one, with the same nodes valid', () => {
    for (const model of ['GFS', 'ICON']) expect(lakesCarried(lattice([[32, 120], [-32, -54], [52, -98]], model))).toEqual([]);
  });
});
