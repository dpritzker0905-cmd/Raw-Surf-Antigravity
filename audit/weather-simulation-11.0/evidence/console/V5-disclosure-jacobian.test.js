/**
 * LANE 5 independent re-measurement of d1b40987's central claim.
 *
 * The commit says, of `computeHeatmapStatus`:
 *   BEFORE  warns in  3/12   (EURO/swell_1, EURO/swell_2, EURO/wind_waves)
 *   AFTER   warns in 12/12
 *   CONTROL healthy producer -> 0/12 before AND after
 *   NO REGRESSION  no_copernicus_coverage still EURO+swell only (3/12)
 *
 * This runs the REAL shipped module (AFTER) against the REAL baseline module extracted from
 * `git show 9f4f8570:` (BEFORE) — a paired A/B over the same 3 models x 4 layers, with the
 * producer pinned. Read-only w.r.t. the repo source.
 */
const BEFORE = require('./V5-before-forecastDiagnostics.js');
const AFTER = require('C:/Users/dprit/Raw-Surf/frontend/src/components/map/forecastDiagnostics.js');

const MODELS = ['GFS', 'ICON', 'EURO'];
const LAYERS = ['waves', 'swell_1', 'swell_2', 'wind_waves'];

function sweep(fn) {
  const warn = [];
  const silent = [];
  for (const activeModel of MODELS) {
    for (const activeLayer of LAYERS) {
      const r = fn({ activeModel, activeLayer, renderMarineData: null });
      (r === 'retained_stale_warning' ? warn : silent).push(`${activeModel}/${activeLayer}=${r}`);
    }
  }
  return { warn, silent };
}

function sweepRaw(fn) {
  const out = {};
  for (const activeModel of MODELS) {
    for (const activeLayer of LAYERS) {
      out[`${activeModel}/${activeLayer}`] = fn({ activeModel, activeLayer, renderMarineData: null });
    }
  }
  return out;
}

beforeEach(() => {
  delete window.__MARINE_FETCH_DIAG__;
  delete window.__WebGLMarineLayer_DIAG__;
  delete window.__MARINE_HEATMAP_STATUS__;
});

describe('V5 — the disclosure Jacobian, re-measured independently', () => {
  it('DEFECT ARM: producer pinned at {status:"retained_previous_hour"}', () => {
    window.__MARINE_HEATMAP_STATUS__ = { status: 'retained_previous_hour' };
    const b = sweep(BEFORE.computeHeatmapStatus);
    const a = sweep(AFTER.computeHeatmapStatus);
    console.log(`  BEFORE warns ${b.warn.length}/12 -> ${b.warn.join(', ')}`);
    console.log(`  AFTER  warns ${a.warn.length}/12 -> ${a.warn.join(', ')}`);
    console.log(`  BEFORE silent ${b.silent.length}/12 -> ${b.silent.join(', ')}`);
    expect(b.warn.length).toBe(3);
    expect(a.warn.length).toBe(12);
  });

  it('CONTROL ARM: healthy producer must warn 0/12 in BOTH arms (no cry-wolf)', () => {
    window.__MARINE_HEATMAP_STATUS__ = { status: 'ok' };
    const b = sweep(BEFORE.computeHeatmapStatus);
    const a = sweep(AFTER.computeHeatmapStatus);
    console.log(`  CONTROL before warns ${b.warn.length}/12   after warns ${a.warn.length}/12`);
    console.log(`  CONTROL after raw: ${JSON.stringify(sweepRaw(AFTER.computeHeatmapStatus))}`);
    expect(b.warn.length).toBe(0);
    expect(a.warn.length).toBe(0);
  });

  it('NO-REGRESSION ARM: no_copernicus_coverage stays EURO+swell only (3/12) after', () => {
    window.__MARINE_HEATMAP_STATUS__ = { status: 'no_copernicus_coverage' };
    const raw = sweepRaw(AFTER.computeHeatmapStatus);
    const cop = Object.entries(raw).filter(([, v]) => v === 'no_copernicus_coverage');
    console.log(`  AFTER no_copernicus_coverage in ${cop.length}/12 -> ${cop.map(([k]) => k).join(', ')}`);
    console.log(`  AFTER raw: ${JSON.stringify(raw)}`);
    expect(cop.length).toBe(3);
  });

  it('RESIDUAL: EURO/waves with a genuine no_copernicus_coverage is STILL silent', () => {
    window.__MARINE_HEATMAP_STATUS__ = { status: 'no_copernicus_coverage' };
    const v = AFTER.computeHeatmapStatus({ activeModel: 'EURO', activeLayer: 'waves', renderMarineData: null });
    console.log(`  EURO/waves + no_copernicus_coverage -> ${v}`);
    expect(v).toBeNull();
  });

  it('READY REACHABILITY: the commit claims `ready` is unreachable today', () => {
    window.__MARINE_HEATMAP_STATUS__ = { status: 'ok' };
    window.__WebGLMarineLayer_DIAG__ = {
      renderedProvider: 'copernicus',
      activeMarineLayer: 'swell_1',
      componentLayer: 'swell_1',
      webglSourceVectorCount: 289,   // the field the producer ACTUALLY writes
    };
    const v = AFTER.computeHeatmapStatus({ activeModel: 'EURO', activeLayer: 'swell_1', renderMarineData: null });
    console.log(`  EURO/swell_1 with a fully-rendered producer payload -> ${v}`);
    expect(v).not.toBe('ready');
  });
});
