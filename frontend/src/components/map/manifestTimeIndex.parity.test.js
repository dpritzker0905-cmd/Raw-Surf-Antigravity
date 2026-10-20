import recorded from '../../tests/fixtures/products-manifest-offline.fixture.json';
import { getSharedValidTime, setCachedManifest, latestTimeDiag } from './backendWeatherServiceClient';
import { getManifestTimeIndex, nearestValidTime, manifestGroupKey } from './manifestTimeIndex';

/**
 * PARITY: getSharedValidTime through the manifest time index returns byte-identical results (the ISO string AND the
 * diagnostic record: selected time, delta, fallback reason) to the original linear scan, which still runs under
 * window.__RAW_DISABLE_MANIFEST_TIME_INDEX__ = true. Ties included: equal times at several manifest positions (the
 * recorded manifest holds each time once per resolution tier), and targets exactly between two times, where the scan keeps
 * whichever appears FIRST in manifest order.
 */

const HOUR = 3600000;
const toProducts = (fx) => fx.rows.map(([model, domain, layer, valid_time_start]) => ({ model, domain, layer, valid_time_start }));
const RECORDED = { products: toProducts(recorded) };

function both(manifest, offset, layer, model, opts) {
  setCachedManifest(manifest);
  const run = (killed) => {
    window.__RAW_DISABLE_MANIFEST_TIME_INDEX__ = killed;
    for (const k of Object.keys(latestTimeDiag)) delete latestTimeDiag[k];
    const value = getSharedValidTime(offset, layer, model, opts);
    return JSON.stringify({ value, diag: { ...latestTimeDiag } });
  };
  const fast = run(false);
  const slow = run(true);
  return { fast, slow };
}

afterEach(() => { delete window.__RAW_DISABLE_MANIFEST_TIME_INDEX__; setCachedManifest(null); });

describe('manifest time index — parity with the linear scan', () => {
  it('RECORDED manifest: every model x layer x domain, offsets -12..396 h in half hours, two anchors (ties at the half hours)', () => {
    const firstMs = Math.min(...RECORDED.products.map((p) => Date.parse(p.valid_time_start)));
    const anchors = [firstMs + 30 * 60000, firstMs + 90 * 60000 + 1];
    const models = ['GFS', 'ICON', 'euro', 'CMEMS'];
    const layers = ['waves', 'swell_2', 'WIND_WAVES', 'wind', 'nope'];
    let n = 0; let snapped = 0; let ties = 0; let fallbacks = 0;
    for (const anchorMs of anchors) {
      for (const model of models) {
        for (const layer of layers) {
          for (const domain of (layer === 'wind' ? [null, 'marine'] : [null])) {
            for (let off = -12; off <= 396; off += 0.5) {
              const { fast, slow } = both(RECORDED, off, layer, model, { anchorMs, domain });
              expect(fast).toBe(slow);
              n++;
              const d = JSON.parse(fast).diag;
              const rec = Object.values(d)[0];
              if (rec.selectedManifestValidTime) snapped++; else fallbacks++;
              if (rec.manifestDeltaHours === 1.5) ties++;
            }
          }
        }
      }
    }
    // The sweep exercised all three outcomes, not just one of them.
    expect(n).toBeGreaterThan(30000);
    expect(snapped).toBeGreaterThan(10000);
    expect(ties).toBeGreaterThan(1000);
    expect(fallbacks).toBeGreaterThan(1000);
  });

  it('ADVERSARIAL manifests: shuffled, duplicate times, unparseable dates, mixed case, numeric times, ties in both orders', () => {
    const T0 = Date.parse('2026-10-19T00:00:00Z');
    const iso = (h) => new Date(T0 + h * HOUR).toISOString().replace('.000Z', 'Z');
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const shuffle = (xs) => { const a = xs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const manifests = [
      // A tie between 03Z and 06Z with the LATER time first in the manifest, then the earlier one first.
      { products: [{ model: 'GFS', domain: 'marine', layer: 'waves', valid_time_start: iso(6) }, { model: 'GFS', domain: 'marine', layer: 'waves', valid_time_start: iso(3) }] },
      { products: [{ model: 'GFS', domain: 'marine', layer: 'waves', valid_time_start: iso(3) }, { model: 'GFS', domain: 'marine', layer: 'waves', valid_time_start: iso(6) }] },
      // Only unparseable dates: matches exist, nothing is nearest (the "Infinity h delta" reason).
      { products: [{ model: 'GFS', domain: 'marine', layer: 'waves', valid_time_start: 'not a date' }, { model: 'GFS', domain: 'marine', layer: 'waves', valid_time_start: null }] },
      // Mixed case, numeric epoch times, other formats, a far-away product.
      { products: [
        { model: 'gfs', domain: 'MARINE', layer: 'Waves', valid_time_start: T0 + 9 * HOUR },
        { model: 'Gfs', domain: 'marine', layer: 'waves', valid_time_start: '2026-10-19T12:00:00.000+00:00' },
        { model: 'GFS', domain: 'marine', layer: 'waves', valid_time_start: 'garbage' },
        { model: 'GFS', domain: 'wind', layer: 'wind', valid_time_start: iso(1) },
        { model: 'EURO', domain: 'marine', layer: 'waves', valid_time_start: iso(240) },
      ] },
    ];
    // Random dense manifests: 3-hourly and 6-hourly times, duplicated, shuffled, a few bad rows.
    for (let m = 0; m < 6; m++) {
      const ps = [];
      for (let h = 0; h <= 384; h += (h >= 144 ? 6 : 3)) {
        const copies = 1 + Math.floor(rnd() * 3);
        for (let c = 0; c < copies; c++) ps.push({ model: rnd() < 0.5 ? 'GFS' : 'EURO', domain: 'marine', layer: rnd() < 0.5 ? 'waves' : 'swell_1', valid_time_start: iso(h) });
      }
      for (let b = 0; b < 5; b++) ps.push({ model: 'GFS', domain: 'marine', layer: 'waves', valid_time_start: 'bad' + b });
      manifests.push({ products: shuffle(ps) });
    }
    let n = 0; let ties = 0;
    for (const manifest of manifests) {
      for (const model of ['GFS', 'EURO', 'ICON']) {
        for (const layer of ['waves', 'swell_1']) {
          for (const anchorMs of [T0, T0 + 45 * 60000]) {
            // -7.5 + 0.75k lands on every 3-hour midpoint from both anchors (exact ties); -8 + 0.75k never would.
            for (let off = -7.5; off <= 400; off += 0.75) {
              const { fast, slow } = both(manifest, off, layer, model, { anchorMs });
              expect(fast).toBe(slow);
              n++;
              const rec = Object.values(JSON.parse(fast).diag)[0];
              if (rec.manifestDeltaHours === 1.5 || rec.manifestDeltaHours === 3) ties++;
            }
          }
        }
      }
    }
    expect(n).toBeGreaterThan(30000);
    expect(ties).toBeGreaterThan(1000);
  });

  it('the tie rule itself: equally far neighbours resolve to the one EARLIER in manifest order', () => {
    const T0 = Date.parse('2026-10-19T00:00:00Z');
    const mk = (order) => ({ products: order.map((h) => ({ model: 'GFS', domain: 'marine', layer: 'waves', valid_time_start: new Date(T0 + h * HOUR).toISOString() })) });
    setCachedManifest(mk([6, 3]));
    expect(getSharedValidTime(4.5, 'waves', 'GFS', { anchorMs: T0 })).toBe(new Date(T0 + 6 * HOUR).toISOString());
    setCachedManifest(mk([3, 6]));
    expect(getSharedValidTime(4.5, 'waves', 'GFS', { anchorMs: T0 })).toBe(new Date(T0 + 3 * HOUR).toISOString());
  });

  it('a malformed row (no model) gets no index, so the original scan runs and fails exactly as before', () => {
    const manifest = { products: [{ domain: 'marine', layer: 'waves', valid_time_start: '2026-10-19T00:00:00Z' }] };
    expect(getManifestTimeIndex(manifest.products)).toBeNull();
    setCachedManifest(manifest);
    window.__RAW_DISABLE_MANIFEST_TIME_INDEX__ = false;
    let fastErr = null; try { getSharedValidTime(0, 'waves', 'GFS', { anchorMs: 0 }); } catch (e) { fastErr = String(e); }
    window.__RAW_DISABLE_MANIFEST_TIME_INDEX__ = true;
    let slowErr = null; try { getSharedValidTime(0, 'waves', 'GFS', { anchorMs: 0 }); } catch (e) { slowErr = String(e); }
    expect(fastErr).not.toBeNull();
    expect(fastErr).toBe(slowErr);
  });

  it('builds the index ONCE per manifest and rebuilds for a new one', () => {
    const products = RECORDED.products.slice();
    const a = getManifestTimeIndex(products);
    expect(getManifestTimeIndex(products)).toBe(a);
    const b = getManifestTimeIndex(products.slice());
    expect(b).not.toBe(a);
    const g = a.get(manifestGroupKey('GFS', 'marine', 'waves'));
    expect(g.count).toBe(460);
    expect(g.times.length).toBe(115);   // four resolution tiers per time collapse to one entry
    expect(nearestValidTime({ times: [], first: [] }, 0)).toEqual({ ms: null, diffMs: Infinity });
  });
});
