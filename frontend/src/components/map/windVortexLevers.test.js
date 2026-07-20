/**
 * R-GATED VORTEX LEVERS — the enumerating gate (2026-07-19, queue #2).
 *
 * A circulation's slow annulus rendered as near-still sparse marks because the shipped gamma
 * (contrast for TRANSLATION) damped its motion and the ink budget recycled its marks in ~0.15 s.
 * The levers: rotation dominance R = |curl|·Lcell/(speed+2) from 4 fine-texture taps gates
 * (1) gamma back to LINEAR truth and (2) a ~3× lifetime persistence — ONLY inside the fine
 * overlay (10° base cells cannot resolve a vortex; gating there would fire on smear).
 *
 * Calibration lives IN this test as a JS mirror of the shader formula over synthetic fields
 * (probe_wind_vortex_synth.js is the standalone twin): weak-forming-low annulus must gate IN,
 * synthetic ambient must gate OUT, and the smoothstep(0.25, 0.8) window must hold both. Drift
 * in the shader constants breaks the source pins; drift in the formula breaks the numbers.
 */
import { ADVECT_FS, DRAW_VS } from './WebGLWindShaders';

// ── 1. Source pins ──

describe('vortex lever shader wiring', () => {
  it('ADVECT_FS carries the R-gate: 4-tap curl, calibrated smoothstep window, fw seam scaling', () => {
    expect(ADVECT_FS).toContain('uniform float u_vortex_levers;');
    expect(ADVECT_FS).toContain('uniform vec2 u_fine_texel;');
    expect(ADVECT_FS).toContain('uniform vec2 u_fine_cell_km;');
    // curl_z = dv/dx - du/dy, central differences
    expect(ADVECT_FS).toMatch(/curlz\s*=\s*\(wr\.y\s*-\s*wl\.y\)\s*\/\s*\(2\.0\s*\*\s*dxKm\)\s*-\s*\(wu2\.x\s*-\s*wd2\.x\)\s*\/\s*\(2\.0\s*\*\s*dyKm\)/);
    // R with the analyzer's exact s0 = 2 kn noise floor
    expect(ADVECT_FS).toMatch(/Rdom\s*=\s*abs\(curlz\)\s*\*\s*dyKm\s*\/\s*\(length\(wind\)\s*\+\s*2\.0\)/);
    // the calibrated gate window, scaled by the SAME feather weight the velocity blend uses
    expect(ADVECT_FS).toMatch(/vortexGate\s*=\s*smoothstep\(0\.25,\s*0\.8,\s*Rdom\)\s*\*\s*fw/);
  });

  it('persistence: gated ×0.35 with the 0.002 mortality floor, applied AFTER the ink budget', () => {
    expect(ADVECT_FS).toMatch(/dropRate\s*=\s*max\(dropRate\s*\*\s*mix\(1\.0,\s*0\.35,\s*vortexGate\),\s*0\.002\)/);
    // ordering: the ink-budget mix and calm floor still precede it (their pins live in
    // windParticleDensity.test.js — here just assert relative order in source)
    const inkIdx = ADVECT_FS.indexOf('mix(legacyDrop, max(legacyDrop, inkFlatDrop)');
    const persistIdx = ADVECT_FS.indexOf('mix(1.0, 0.35, vortexGate)');
    expect(inkIdx).toBeGreaterThan(-1);
    expect(persistIdx).toBeGreaterThan(inkIdx);
  });

  it('levers are ADVECT-only and theme-free: DRAW_VS carries no gate, ADVECT_FS no theme', () => {
    expect(DRAW_VS).not.toContain('u_vortex_levers');
    expect(ADVECT_FS).not.toMatch(/u_theme/);
  });
});

// ── 2. Numeric calibration mirror ──

const KM_LAT = 110.57, KM_LNG = 111.32;
const smoothstep = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Build a field on a 0.25° Gulf box and return an R sampler mirroring the shader math. */
function fieldR({ vortex, shear, ambient }) {
  const cols = 53, rows = 37, dlng = 0.25, dlat = 0.25, west = -95, south = 20;
  const u = new Float64Array(cols * rows), v = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const lat = south + r * dlat;
    const cosLat = Math.max(0.2, Math.cos(lat * Math.PI / 180));
    for (let c = 0; c < cols; c++) {
      const lng = west + c * dlng;
      let uu = ambient.u, vv = ambient.v;
      if (vortex) {
        const dx = (lng - vortex.lng) * KM_LNG * cosLat, dy = (lat - vortex.lat) * KM_LAT;
        const rad = Math.hypot(dx, dy);
        const vt = rad <= vortex.coreKm ? vortex.vmax * (rad / vortex.coreKm) : vortex.vmax * (vortex.coreKm / rad);
        if (rad > 0.1) { uu += vt * (-dy / rad); vv += vt * (dx / rad); }
      }
      if (shear) {
        const dy = (lat - shear.lat) * KM_LAT;
        uu += shear.du * Math.tanh(dy / (shear.widthKm / 2));
      }
      u[r * cols + c] = uu; v[r * cols + c] = vv;
    }
  }
  const at = (r, c) => {
    r = Math.max(0, Math.min(rows - 1, r)); c = Math.max(0, Math.min(cols - 1, c));
    return [u[r * cols + c], v[r * cols + c]];
  };
  const Rat = (r, c) => {
    const lat = south + r * dlat;
    const dxKm = dlng * KM_LNG * Math.max(0.2, Math.cos(lat * Math.PI / 180));
    const dyKm = dlat * KM_LAT;
    const curlz = (at(r, c + 1)[1] - at(r, c - 1)[1]) / (2 * dxKm)
      - (at(r + 1, c)[0] - at(r - 1, c)[0]) / (2 * dyKm);
    const speed = Math.hypot(...at(r, c));
    return Math.abs(curlz) * dyKm / (speed + 2.0);
  };
  return { Rat, rows, cols, dlat, dlng, south, west };
}

describe('R-gate calibration (numeric mirror of probe_wind_vortex_synth + analyze)', () => {
  it('a WEAK forming low (10 kn Vmax) gates IN across its annulus', () => {
    const f = fieldR({ vortex: { lng: -88.5, lat: 24.5, coreKm: 120, vmax: 10 }, ambient: { u: -4, v: 0 } });
    const cr = Math.round((24.5 - f.south) / f.dlat), cc = Math.round((-88.5 - f.west) / f.dlng);
    const gates = [];
    for (let dr = -4; dr <= 4; dr++) for (let dc = -4; dc <= 4; dc++) {
      if (Math.hypot(dr, dc) <= 4) gates.push(smoothstep(0.25, 0.8, f.Rat(cr + dr, cc + dc)));
    }
    gates.sort((a, b) => a - b);
    const median = gates[Math.floor(gates.length / 2)];
    expect(median).toBeGreaterThan(0.15);                       // the annulus meaningfully gates in
    expect(Math.max(...gates)).toBeGreaterThan(0.9);            // the core gates fully
  });

  it('a STRONG invest analog (25 kn Vmax) fully gates its core', () => {
    const f = fieldR({ vortex: { lng: -88.5, lat: 24.5, coreKm: 100, vmax: 25 }, ambient: { u: -6, v: 0 } });
    const cr = Math.round((24.5 - f.south) / f.dlat), cc = Math.round((-88.5 - f.west) / f.dlng);
    expect(smoothstep(0.25, 0.8, f.Rat(cr, cc))).toBe(1);
  });

  it('uniform ambient flow NEVER gates (zero false positives away from features)', () => {
    const f = fieldR({ ambient: { u: -6, v: 0 } });
    let maxGate = 0;
    for (let r = 2; r < f.rows - 2; r++) for (let c = 2; c < f.cols - 2; c++) {
      maxGate = Math.max(maxGate, smoothstep(0.25, 0.8, f.Rat(r, c)));
    }
    expect(maxGate).toBe(0);
  });

  it('DOCUMENTED false positive: a shear line gates in along the line only', () => {
    // Per-texel curl cannot tell a shear line from rotation (that needs a ring integral the
    // shader does not have). The accepted cost: linear-truth motion + persistence ON the line —
    // a real flow feature — while cells >2° away stay ungated.
    const f = fieldR({ shear: { lat: 24.5, du: 12, widthKm: 120 }, ambient: { u: 0, v: 0 } });
    const onLine = Math.round((24.5 - f.south) / f.dlat);
    const off = Math.round((28.0 - f.south) / f.dlat);
    expect(smoothstep(0.25, 0.8, f.Rat(onLine, 26))).toBeGreaterThan(0.5);
    expect(smoothstep(0.25, 0.8, f.Rat(off, 26))).toBe(0);
  });
});
