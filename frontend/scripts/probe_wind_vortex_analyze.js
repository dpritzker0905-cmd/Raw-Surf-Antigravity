/**
 * probe_wind_vortex_analyze.js — the circulation-centre instrument (2026-07-19).
 * Input: a grid dump from probe_wind_vortex_dump.js (the EXACT u/v field the engine renders).
 *
 * Answers, with numbers, BEFORE any shader is edited:
 *  1. Is there a vortex in the field, and does a shader-computable "rotation dominance" metric
 *     R = |curl|·L / (speed + s0) discriminate its core/annulus from ambient air?
 *  2. What does the CURRENT pipeline do to particles in the annulus — visibility (size),
 *     lifetime (ink-budget drop rate), motion (gamma-damped advection) — using the exact
 *     shipped constants from WebGLWindShaders.js / WebGLWindEngine.js?
 *  3. What do the proposed levers recover (gamma restore -> linear truth, persistence,
 *     sub-1kn visibility inside the vortex)?
 *
 * Usage: node probe_wind_vortex_analyze.js [dumpfile] [zoom]
 */
const path = require('path');
const fs = require('fs');

const DUMP = process.argv[2] || path.join(__dirname, 'wind-vortex-out', 'gulf_grid.json');
const ZOOM = Number(process.argv[3] || 6);
const d = JSON.parse(fs.readFileSync(DUMP, 'utf8'));
if (d.error) { console.log('dump error:', d.error); process.exit(1); }
const { crop, uMin, uMax, maxWindSpeed } = d.meta;
const { cols2: C, rows2: R_, dlng, dlat, west, south } = crop;
const U = d.u, V = d.v;

const latOf = (r) => south + r * dlat;
const lngOf = (c) => west + c * dlng;
const at = (r, c) => {
  r = Math.max(0, Math.min(R_ - 1, r)); c = Math.max(0, Math.min(C - 1, c));
  return [U[r * C + c], V[r * C + c]];
};
const speedAt = (r, c) => { const [u, v] = at(r, c); return Math.hypot(u, v); };

// ---- 1. curl + rotation dominance ------------------------------------------------------------
// curl_z = dv/dx - du/dy (x east, y north), central differences, physical spacing.
// R = |curl| * Ltexel / (speed + s0): dimensionless "rotation dominance". s0 keeps calm-noise down.
const S0 = 2.0;
const KM_LAT = 110.57, KM_LNG = 111.32;
const curl = new Float64Array(C * R_), dom = new Float64Array(C * R_);
for (let r = 0; r < R_; r++) {
  const cosLat = Math.max(0.2, Math.cos(latOf(r) * Math.PI / 180));
  const dxKm = dlng * KM_LNG * cosLat, dyKm = dlat * KM_LAT;
  for (let c = 0; c < C; c++) {
    const dvdx = (at(r, c + 1)[1] - at(r, c - 1)[1]) / (2 * dxKm);
    const dudy = (at(r + 1, c)[0] - at(r - 1, c)[0]) / (2 * dyKm);
    const cz = dvdx - dudy;                      // kn / km
    curl[r * C + c] = cz;
    dom[r * C + c] = Math.abs(cz) * dyKm / (speedAt(r, c) + S0);
  }
}

// Percentile helper
const pct = (arr, p) => {
  const s = Array.from(arr).sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))];
};

console.log('=== FIELD ===');
console.log(`crop ${C}x${R_} @ ${dlng.toFixed(3)}°x${dlat.toFixed(3)}°, origin ${south.toFixed(2)},${west.toFixed(2)}`);
const speeds = new Float64Array(C * R_);
for (let i = 0; i < C * R_; i++) speeds[i] = Math.hypot(U[i], V[i]);
console.log(`speed kn: min ${Math.min(...speeds).toFixed(2)} p50 ${pct(speeds, 50).toFixed(2)} p95 ${pct(speeds, 95).toFixed(2)} max ${Math.max(...speeds).toFixed(2)}`);
console.log(`dominance R: p50 ${pct(dom, 50).toFixed(3)} p90 ${pct(dom, 90).toFixed(3)} p99 ${pct(dom, 99).toFixed(3)} max ${Math.max(...dom).toFixed(3)}`);

// ---- 2. vortex candidates: high-dominance clusters around a low-speed core -------------------
// Greedy: take the max-R cell, flood its neighbourhood (radius 6 cells), suppress, repeat.
const cand = [];
const supp = new Uint8Array(C * R_);
for (let k = 0; k < 5; k++) {
  let bi = -1, bv = 0;
  for (let i = 0; i < C * R_; i++) if (!supp[i] && dom[i] > bv) { bv = dom[i]; bi = i; }
  if (bi < 0 || bv < 0.15) break;
  const br = Math.floor(bi / C), bc = bi % C;
  // circulation check: mean tangential wind on a ring radius 2 cells (positive = cyclonic NH)
  let circ = 0, n = 0;
  for (let a = 0; a < 16; a++) {
    const th = a / 16 * 2 * Math.PI;
    const rr = Math.round(br + 2 * Math.sin(th)), cc = Math.round(bc + 2 * Math.cos(th));
    const [uu, vv] = at(rr, cc);
    circ += -uu * Math.sin(th) + vv * Math.cos(th); n++;
  }
  circ /= n;
  // annulus speed stats (radius 1..5 cells)
  const ann = [];
  for (let rr = br - 5; rr <= br + 5; rr++) for (let cc = bc - 5; cc <= bc + 5; cc++) {
    const dr = rr - br, dc = cc - bc, rad = Math.hypot(dr, dc);
    if (rad >= 1 && rad <= 5 && rr >= 0 && rr < R_ && cc >= 0 && cc < C) ann.push(speedAt(rr, cc));
  }
  cand.push({
    lat: latOf(br), lng: lngOf(bc), R: bv, curl: curl[bi], coreSpeed: speedAt(br, bc),
    circulation: circ, annP50: pct(ann, 50), annMin: Math.min(...ann), annMax: Math.max(...ann),
  });
  for (let rr = br - 6; rr <= br + 6; rr++) for (let cc = bc - 6; cc <= bc + 6; cc++)
    if (rr >= 0 && rr < R_ && cc >= 0 && cc < C) supp[rr * C + cc] = 1;
}
console.log('\n=== VORTEX CANDIDATES (dominance peaks) ===');
for (const x of cand) console.log(
  `  ${x.lat.toFixed(2)},${x.lng.toFixed(2)}  R=${x.R.toFixed(3)} curl=${x.curl.toFixed(4)}kn/km ` +
  `core=${x.coreSpeed.toFixed(1)}kn circ=${x.circulation.toFixed(2)}kn(${x.circulation > 0 ? 'CYCLONIC' : 'anticyc'}) ` +
  `annulus p50=${x.annP50.toFixed(1)} [${x.annMin.toFixed(1)}..${x.annMax.toFixed(1)}]kn`);

// Discrimination: R inside best candidate's annulus vs ambient
if (cand.length) {
  const best = cand[0];
  const br = Math.round((best.lat - south) / dlat), bc = Math.round((best.lng - west) / dlng);
  const inR = [], outR = [];
  for (let r = 0; r < R_; r++) for (let c = 0; c < C; c++) {
    const rad = Math.hypot(r - br, c - bc);
    (rad <= 5 ? inR : outR).push(dom[r * C + c]);
  }
  console.log(`\n  discrimination: R inside(<=5 cells) p50=${pct(inR, 50).toFixed(3)} p90=${pct(inR, 90).toFixed(3)}` +
    ` | ambient p50=${pct(outR, 50).toFixed(3)} p90=${pct(outR, 90).toFixed(3)} p99=${pct(outR, 99).toFixed(3)}`);
}

// ---- 3. what the CURRENT pipeline does to the annulus (exact shipped constants) --------------
const smoothstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const speedMaxData = Math.hypot(uMax[0], uMax[1]);
const GAMMA = 1.15, FPS = 60, SPEED_FACTOR = 0.55;
const sss = (z) => z > 6 ? SPEED_FACTOR * Math.pow(0.5, z) * 0.00025 : Math.max(2.5e-6, SPEED_FACTOR * Math.pow(0.5, z) * 0.00025);
const worldPx = (z) => 512 * Math.pow(2, z);

function pipeline(speed, z, latDeg, opts = {}) {
  const { gammaRestore = 0, dropScale = 1, vortexFloor = false } = opts;
  const merc = Math.max(0.1, Math.cos(latDeg * Math.PI / 180));
  const speedNorm = Math.max(0.02, Math.min(1, speed / Math.max(speedMaxData, 1)));
  const gammaTerm = mix(Math.pow(speedNorm, GAMMA - 1), 1.0, gammaRestore);
  const offMerc = (speed / merc) * sss(z) * gammaTerm;
  const pxPerFrame = offMerc * worldPx(z);
  // size (DRAW_VS, dpr 1)
  const sBase = speed < 0.5 ? 0 : 2.5 + 2.5 * smoothstep(1, 30, speed);
  const zoomBoost = 1 + smoothstep(5, 11, z) * 1.5;
  const fzs = mix(0.62, 1.0, smoothstep(3, 7, z));
  let size = sBase * zoomBoost;
  const inFloorBand = vortexFloor ? (speed >= 0.35 && speed < 10) : (speed >= 1.0 && speed < 10);
  if (inFloorBand) size = Math.max(size, mix(3.4, 4.2, smoothstep(10, 1, speed)) * fzs);
  // drop rate (ADVECT_FS, density_uniform ON)
  const sFloor = inFloorBand ? mix(3.4, 4.2, smoothstep(10, 1, speed)) * fzs : 0;
  const sCss = Math.max(sBase, sFloor);
  const legacy = 0.002 + 0.008 * speed;
  let drop = Math.max(legacy, (sCss * sCss) / 130);
  drop *= dropScale;
  const lifeFrames = 1 / Math.max(drop, 1e-6);
  return {
    size: +size.toFixed(2), drop: +drop.toFixed(4), lifeS: +(lifeFrames / FPS).toFixed(2),
    pxS: +(pxPerFrame * FPS).toFixed(1), arcPx: +(pxPerFrame * lifeFrames).toFixed(1),
  };
}

const LAT = cand.length ? cand[0].lat : 24;
console.log(`\n=== PIPELINE ON THE ANNULUS (z=${ZOOM}, lat=${LAT.toFixed(1)}, speedMaxData=${speedMaxData.toFixed(1)}kn, dpr1) ===`);
console.log('speed |     SHIPPED                       |  +gammaRestore    |  +persist(x0.35)  | +vortexFloor(<1kn draws)');
console.log('  kn  | size  life(s) px/s  arc(px)       |  px/s   arc       |  life   arc       | size');
for (const s of [0.4, 0.7, 1, 2, 3, 5, 8, 12]) {
  const a = pipeline(s, ZOOM, LAT);
  const b = pipeline(s, ZOOM, LAT, { gammaRestore: 1 });
  const c = pipeline(s, ZOOM, LAT, { gammaRestore: 1, dropScale: 0.35 });
  const e = pipeline(s, ZOOM, LAT, { gammaRestore: 1, dropScale: 0.35, vortexFloor: true });
  console.log(`${String(s).padStart(5)} | ${String(a.size).padStart(5)} ${String(a.lifeS).padStart(6)} ${String(a.pxS).padStart(6)} ${String(a.arcPx).padStart(6)}        | ${String(b.pxS).padStart(6)} ${String(b.arcPx).padStart(6)}    | ${String(c.lifeS).padStart(6)} ${String(c.arcPx).padStart(6)}    | ${String(e.size).padStart(5)}`);
}

// Arc as a fraction of the circle at ~2 cells radius from the core (what "rotation reads" needs)
if (cand.length) {
  const rad2Km = 2 * dlat * KM_LAT;
  const radPx = rad2Km / (40075 / worldPx(ZOOM) * Math.max(0.1, Math.cos(LAT * Math.PI / 180)));
  const circum = 2 * Math.PI * radPx;
  console.log(`\n  annulus r~2 cells = ${radPx.toFixed(0)} px on screen at z${ZOOM}; circumference ${circum.toFixed(0)} px`);
  const s = cand[0].annP50;
  const a = pipeline(s, ZOOM, LAT), c = pipeline(s, ZOOM, LAT, { gammaRestore: 1, dropScale: 0.35 });
  console.log(`  at annulus p50 ${s.toFixed(1)}kn: SHIPPED arc ${a.arcPx}px = ${(a.arcPx / circum * 100).toFixed(1)}% of circle | LEVERS arc ${c.arcPx}px = ${(c.arcPx / circum * 100).toFixed(1)}%`);
}
