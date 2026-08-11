/**
 * MISSION 1 stage 2 — TEMPORARY audit harness, delete after the run.
 *
 * Drives the REAL `sampleValueFromDecodedTiles` over a REAL production grid (fetched by
 * audit/weather-simulation-11.2/evidence/forensics/M1_fetch_height_flip_fixture.py) at 130 real
 * Florida spots, in BOTH states of `__RAW_NEARSHORE_RENORM__`, and asks which one lands closer to
 * the backend point lane — the only lane scored against buoys.
 *
 * ⚠️ ORIENTATION IS THE TRAP. The sampler indexes rows NORTH-first
 * (`ty = (1 - (lat - south)/span) * (rows-1)`), while the normalizer emits vectors SOUTH→NORTH.
 * Get it wrong and every number below is a mirrored fiction that still looks plausible. The
 * orientation control runs FIRST and the measurement is not reported unless it passes.
 */
const fs = require('fs');
const { sampleValueFromDecodedTiles } = require('./forecastHelpers');

const FIXTURE = 'C:/Users/dprit/Raw-Surf/audit/weather-simulation-11.2/evidence/forensics/M1_fixture.json';
const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const { cols, rows, bounds, speeds } = fx.grid;
const [W, S, E, N] = bounds;

/** Rebuild the tile in the sampler's own row order (north row first). */
function northFirst(vals) {
  const out = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const src = (rows - 1 - r) * cols;          // south->north  =>  north-first
    for (let c = 0; c < cols; c++) out[r * cols + c] = vals[src + c];
  }
  return out;
}
const southFirst = (vals) => Float32Array.from(vals);

function install(values) {
  window.__DECODED_OM_TILES__ = new Map([['k', {
    variable: 'wave_height', model: 'ncep_gfswave025', timeIndex: 0, timestamp: 1,
    bounds: [W, S, E, N], nx: cols, ny: rows, values,
  }]]);
}

/** The grid's own value at a coordinate — nearest cell, computed independently of the sampler. */
function gridNearest(lat, lng) {
  const cx = Math.round(((lng - W) / (E - W)) * (cols - 1));
  const ry = Math.round(((lat - S) / (N - S)) * (rows - 1));   // south-first index
  const c = Math.max(0, Math.min(cols - 1, cx));
  const r = Math.max(0, Math.min(rows - 1, ry));
  return speeds[r * cols + c];
}

const withFlag = (v, fn) => {
  const prev = window.__RAW_NEARSHORE_RENORM__;
  if (v === undefined) delete window.__RAW_NEARSHORE_RENORM__; else window.__RAW_NEARSHORE_RENORM__ = v;
  try { return fn(); } finally { window.__RAW_NEARSHORE_RENORM__ = prev; }
};

const pct = (a, p) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : NaN;

describe('M1 — height flip vs the scored lane', () => {
  test('ORIENTATION CONTROL: north-first must beat south-first against the grid itself', () => {
    const ocean = fx.spots.filter(s => gridNearest(s.lat, s.lng) > 0).slice(0, 60);
    expect(ocean.length).toBeGreaterThan(20);          // the control needs a population

    const err = (builder) => {
      install(builder(speeds));
      return withFlag(undefined, () => {
        const d = [];
        for (const s of ocean) {
          const r = sampleValueFromDecodedTiles(s.lat, s.lng, 'wave_height', 0, 'GFS');
          const v = r && typeof r.value === 'number' ? r.value : null;
          const g = gridNearest(s.lat, s.lng);
          if (v != null && v > 0 && g > 0) d.push(Math.abs(v - g));
        }
        return d.reduce((a, b) => a + b, 0) / Math.max(1, d.length);
      });
    };
    const eN = err(northFirst);
    const eS = err(southFirst);
    // eslint-disable-next-line no-console
    console.log(`\nORIENTATION CONTROL  mean|sampler-grid|  north-first ${eN.toFixed(4)} m  vs  south-first ${eS.toFixed(4)} m`);
    expect(eN).toBeLessThan(eS);       // if this fails, every number below is mirrored
  });

  test('which flag state is closer to the backend point lane?', () => {
    install(northFirst(speeds));
    const rows_ = []; let nulls = 0; let zeros = 0;
    for (const s of fx.spots) {
      if (typeof s.point_speed !== 'number' || s.point_speed <= 0) continue;
      const rOn = withFlag(undefined, () => sampleValueFromDecodedTiles(s.lat, s.lng, 'wave_height', 0, 'GFS'));
      const rOff = withFlag(false, () => sampleValueFromDecodedTiles(s.lat, s.lng, 'wave_height', 0, 'GFS'));
      const on = rOn && typeof rOn.value === 'number' ? rOn.value : null;
      const off = rOff && typeof rOff.value === 'number' ? rOff.value : null;
      if (on == null || off == null) { nulls += 1; continue; }
      if (on <= 0 || off <= 0) { zeros += 1; continue; }
      rows_.push({ p: s.point_speed, on, off, dOn: Math.abs(on - s.point_speed), dOff: Math.abs(off - s.point_speed) });
    }
    expect(rows_.length).toBeGreaterThan(30);

    const movers = rows_.filter(r => Math.abs(r.on - r.off) > 1e-9);
    const ratios = movers.map(r => r.on / r.off).filter(x => isFinite(x) && x > 0);
    const dOn = rows_.map(r => r.dOn), dOff = rows_.map(r => r.dOff);
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    const onWins = rows_.filter(r => r.dOn < r.dOff).length;

    // eslint-disable-next-line no-console
    console.log(`
=== M1 RESULT — ${rows_.length} spots with a point-lane value, grid ${cols}x${rows} ===
  sampler returned NULL   : ${nulls}   (all four corners land -> the tile lane shows nothing)
  sampler returned <= 0   : ${zeros}
  usable rows             : ${rows_.length}
  movers (ON != OFF)      : ${movers.length}/${rows_.length}
  ratio ON/OFF            : p50 ${pct(ratios, 0.5).toFixed(2)}x   p90 ${pct(ratios, 0.9).toFixed(2)}x   max ${Math.max(...ratios).toFixed(2)}x

  |tile - point| (m)        ON        OFF
    mean                  ${mean(dOn).toFixed(4)}    ${mean(dOff).toFixed(4)}
    p50                   ${pct(dOn, 0.5).toFixed(4)}    ${pct(dOff, 0.5).toFixed(4)}
    p90                   ${pct(dOn, 0.9).toFixed(4)}    ${pct(dOff, 0.9).toFixed(4)}

  spots where ON is closer to the scored lane: ${onWins}/${rows_.length} (${(100 * onWins / rows_.length).toFixed(0)}%)
  VERDICT: ${mean(dOn) < mean(dOff) ? 'ON is closer -> the flip moves the tile lane TOWARD the validated one' : 'OFF is closer -> the flip moves it AWAY'}
`);
    expect(rows_.length).toBeGreaterThan(0);   // reporting harness; the verdict is the console block
  });
});
