/**
 * Land exclusion in the zoomlab verdict (2026-07-18 EVE-2): the DEAD_BAND detectors must not
 * flag quiet columns that sit over LAND (the engine-mask ground truth in trace.water). The
 * Florida peninsula parked under mid-screen columns at the staircase's mid-zoom settled steps
 * and was reported as DEAD_BAND_PERSISTENT across three sessions of traces — a testing-system
 * false positive that masqueraded as a sim defect. Traces without water samples keep the
 * legacy behavior (no silent loosening of old traces).
 */
const { analyzeTrace } = require('../../scripts/zoomlab-verdict');

// 40-column frame: active everywhere (8.0) except a quiet band at cols 9-12 (0.1).
function frameWithBand(t) {
  const anim = new Array(40).fill(8.0);
  for (let c = 9; c <= 12; c++) anim[c] = 0.1;
  return { t, z: 6.5, L: 100, anim };
}

function waterSample(t, landCols) {
  const w = new Array(40).fill(1);
  for (const c of landCols) w[c] = 0.1;
  return { t, z: 6.5, w };
}

const NFRAMES = 10;
const frames = Array.from({ length: NFRAMES }, (_, i) => frameWithBand(i * 500));

describe('zoomlab-verdict land exclusion', () => {
  it('legacy: without water ground truth the band is a persistent finding', () => {
    const v = analyzeTrace({ frames });
    expect(v.findings.some((f) => f.type === 'DEAD_BAND_PERSISTENT')).toBe(true);
    expect(v.waterSamples).toBe(0);
  });

  it('band over land columns is excluded, not a finding', () => {
    const water = [waterSample(0, [9, 10, 11, 12]), waterSample(2000, [9, 10, 11, 12]), waterSample(4000, [9, 10, 11, 12])];
    const v = analyzeTrace({ frames, water });
    expect(v.findings.filter((f) => f.type.startsWith('DEAD_BAND'))).toHaveLength(0);
    expect(v.landExcludedBandFrames).toBe(NFRAMES);
  });

  it('band over WATER columns still counts even when water data is present', () => {
    const water = [waterSample(0, [30, 31]), waterSample(2000, [30, 31]), waterSample(4000, [30, 31])];
    const v = analyzeTrace({ frames, water });
    expect(v.findings.some((f) => f.type === 'DEAD_BAND_PERSISTENT')).toBe(true);
    expect(v.landExcludedBandFrames).toBe(0);
  });

  it('stale water samples (beyond waterMaxAgeMs) fall back to legacy counting', () => {
    const water = [waterSample(60000, [9, 10, 11, 12])];
    const v = analyzeTrace({ frames, water });
    expect(v.findings.some((f) => f.type === 'DEAD_BAND_PERSISTENT')).toBe(true);
  });

  it('mixed band mostly over water still counts (mean above landWaterMin)', () => {
    // cols 9-12 quiet; only col 9 is land -> mean water = (0.1+1+1+1)/4 = 0.78 >= 0.35
    const water = [waterSample(0, [9]), waterSample(2000, [9]), waterSample(4000, [9])];
    const v = analyzeTrace({ frames, water });
    expect(v.findings.some((f) => f.type === 'DEAD_BAND_PERSISTENT')).toBe(true);
  });

  it('UNKNOWN columns (-1: no mask source) count as water — never excluded on ignorance', () => {
    const mk = (t) => { const s = waterSample(t, []); for (let c = 9; c <= 12; c++) s.w[c] = -1; return s; };
    const v = analyzeTrace({ frames, water: [mk(0), mk(2000), mk(4000)] });
    expect(v.findings.some((f) => f.type === 'DEAD_BAND_PERSISTENT')).toBe(true);
    expect(v.landExcludedBandFrames).toBe(0);
  });
});
