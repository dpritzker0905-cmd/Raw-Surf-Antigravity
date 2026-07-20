/**
 * probe_wind_vortex_synth.js — synthetic calibration fields for the R-gate (2026-07-19, #2).
 *
 * The live field the day the levers were built held NO vortex (analyzer verdict: R inside ≈
 * ambient), so the R-gate threshold is calibrated from BOTH sides synthetically:
 *   - TRUE-POSITIVE: Rankine vortices through the analyzer — a strong invest analog (25 kn Vmax)
 *     and the case that actually matters, a WEAK forming low (10 kn Vmax) whose slow air the
 *     shipped gamma damps into stillness.
 *   - FALSE-POSITIVE: a straight shear line (strong du/dy, zero closed circulation). A cheap
 *     per-texel R = |curl|·L/(speed+s0) CANNOT tell a shear line from a vortex (only the ring
 *     circulation can, and the shader has no ring) — this field measures how high R runs there,
 *     so the gate's cost on shear lines is a KNOWN number, not a surprise.
 *
 * Emits analyzer-shaped dump JSONs (same contract as probe_wind_vortex_dump.js) into
 * wind-vortex-out/, then run: node probe_wind_vortex_analyze.js wind-vortex-out/synth_<case>.json 6.5
 */
const path = require('path');
const fs = require('fs');

const OUTDIR = path.join(__dirname, 'wind-vortex-out');
fs.mkdirSync(OUTDIR, { recursive: true });

const KM_LAT = 110.57, KM_LNG = 111.32;

function makeField({ name, cols, rows, dlng, dlat, west, south, ambient, vortices, shear }) {
  const u = new Array(cols * rows), v = new Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const lat = south + r * dlat;
    const cosLat = Math.max(0.2, Math.cos(lat * Math.PI / 180));
    for (let c = 0; c < cols; c++) {
      const lng = west + c * dlng;
      let uu = ambient.u, vv = ambient.v;
      for (const vx of (vortices || [])) {
        const dxKm = (lng - vx.lng) * KM_LNG * cosLat;
        const dyKm = (lat - vx.lat) * KM_LAT;
        const rKm = Math.hypot(dxKm, dyKm);
        // Rankine: solid-body inside coreKm, 1/r decay outside; cyclonic (counter-clockwise NH).
        const vt = rKm <= vx.coreKm ? vx.vmax * (rKm / vx.coreKm) : vx.vmax * (vx.coreKm / rKm);
        if (rKm > 0.1) {
          uu += vt * (-dyKm / rKm);
          vv += vt * (dxKm / rKm);
        }
      }
      if (shear) {
        // Straight east-west shear line at shear.lat: u swings ±shear.du across shear.widthKm.
        const dyKm = (lat - shear.lat) * KM_LAT;
        uu += shear.du * Math.tanh(dyKm / (shear.widthKm / 2));
      }
      u[r * cols + c] = +uu.toFixed(3);
      v[r * cols + c] = +vv.toFixed(3);
    }
  }
  let uMin = [Infinity, Infinity], uMax = [-Infinity, -Infinity], maxSpeed = 0;
  for (let i = 0; i < u.length; i++) {
    uMin = [Math.min(uMin[0], u[i]), Math.min(uMin[1], v[i])];
    uMax = [Math.max(uMax[0], u[i]), Math.max(uMax[1], v[i])];
    maxSpeed = Math.max(maxSpeed, Math.hypot(u[i], v[i]));
  }
  const dump = {
    meta: {
      engineCols: cols, engineRows: rows,
      engineBounds: { west, south, east: west + (cols - 1) * dlng, north: south + (rows - 1) * dlat },
      truthTag: { model: 'SYNTH', layer: 'wind' }, coverage_scope: 'viewport', fromFineOverlay: true,
      maxWindSpeed: Math.max(10, Math.min(maxSpeed, 80)), uMin, uMax,
      crop: { c0: 0, r0: 0, cols2: cols, rows2: rows, west, south, dlng, dlat },
      cropOriginVector: { lat: south, lng: west },
      viewport: { lng: west + (cols - 1) * dlng / 2, lat: south + (rows - 1) * dlat / 2, zoom: 6.5 },
      synth: name,
    },
    u, v,
  };
  const out = path.join(OUTDIR, `synth_${name}.json`);
  fs.writeFileSync(out, JSON.stringify(dump));
  console.log(`wrote ${out} (${cols}x${rows} @ ${dlng}deg, maxSpeed ${maxSpeed.toFixed(1)} kn)`);
  return out;
}

// Gulf-box geometry matching the real fine tier: 13x9 deg at 0.25 deg.
const GEO = { cols: 53, rows: 37, dlng: 0.25, dlat: 0.25, west: -95, south: 20 };

makeField({ ...GEO, name: 'rankine_strong', ambient: { u: -6, v: 0 },
  vortices: [{ lng: -88.5, lat: 24.5, coreKm: 100, vmax: 25 }] });
makeField({ ...GEO, name: 'rankine_weak', ambient: { u: -4, v: 0 },
  vortices: [{ lng: -88.5, lat: 24.5, coreKm: 120, vmax: 10 }] });
makeField({ ...GEO, name: 'shear_line', ambient: { u: 0, v: 0 },
  shear: { lat: 24.5, du: 12, widthKm: 120 } });
