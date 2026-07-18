/**
 * ladder-contract.js — LIVE contract probe: the resolver tier ladder + product edge integrity.
 * The client's bbox-shaping (getSnapConfig tiers, clampViewportBbox manifest clip) is written
 * against this contract; both 2026-07-18 snap-overshoot bugs were the client holding a stale
 * model of it. Run nightly (marine-nightly.yml) and after any resolver/normalizer change.
 *
 *   node ladder-contract.js            # against prod (default)
 *   PROBE_BASE=... node ladder-contract.js
 *
 * Exit 1 on any violation. Checks (GFS/ICON/EURO waves unless noted):
 *   T1  in-tile ≤2° bbox  → fine 0.25°/cell        (close-zoom supply for the rated/unrated parity)
 *   T2  8° bbox           → mid ≤2.5°/cell, NEVER the ~10° coarse   (the z6.5 flap tier)
 *   T3  ≥16° bbox         → any tier is legal, must still cover + parse
 *   E1  global product     → ±180 seam columns BOTH live (fencepost head #3 regression watch)
 *   E2  FL regional        → east col -79 fully valid    (fencepost heads #1/#2 regression watch)
 */
const BASE = process.env.PROBE_BASE || 'https://raw-surf-antigravity.onrender.com';

const nowValidTime = () => {
  const t = new Date(Math.floor(Date.now() / (3 * 3600e3)) * 3 * 3600e3);
  return t.toISOString().replace(/\.\d{3}Z/, 'Z');
};

let failures = 0;
const fail = (msg) => { failures++; console.error('  ✗ ' + msg); };
const ok = (msg) => console.log('  ✓ ' + msg);

async function grid(model, layer, bbox, vt) {
  const domain = layer === 'wind' ? 'wind' : 'marine';
  const url = `${BASE}/api/weather/grid?model=${model}&domain=${domain}&layer=${layer}&valid_time=${encodeURIComponent(vt)}` +
    (bbox ? `&bbox=${bbox}` : '');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const p = await r.json();
  const g = p.grid;
  const span = (g.bounds.east < g.bounds.west ? g.bounds.east + 360 : g.bounds.east) - g.bounds.west;
  return { p, g, span, cellDeg: span / Math.max(1, g.cols - 1) };
}

function colValidity(g) {
  const byLng = new Map();
  for (const v of g.vectors) {
    if (!byLng.has(v.lng)) byLng.set(v.lng, { valid: 0, total: 0 });
    const c = byLng.get(v.lng);
    c.total++;
    if (v.is_valid !== false && (v.speed > 0 || (v.value !== null && v.value !== undefined))) c.valid++;
  }
  const lngs = [...byLng.keys()].sort((a, b) => a - b);
  return { lngs, at: (lng) => byLng.get(lng) };
}

async function main() {
  const vt = nowValidTime();
  console.log(`ladder-contract vs ${BASE} @ ${vt}`);

  for (const model of ['GFS', 'ICON', 'EURO']) {
    console.log(`[${model}/waves]`);
    // T1: in-tile close-zoom bbox (inside florida_east_coast) → fine.
    try {
      const t1 = await grid(model, 'waves', '-81.5,26.5,-79.5,28', vt);
      if (t1.cellDeg <= 0.26) ok(`T1 fine: ${t1.cellDeg.toFixed(2)}°/cell (${t1.p.product_id})`);
      else fail(`T1 in-tile 2° bbox served ${t1.cellDeg.toFixed(2)}°/cell (${t1.p.product_id}) — fine tier lost`);
    } catch (e) { fail('T1 ' + e.message); }
    // T2: mid-span bbox → mid tier, never the ~10° coarse.
    try {
      const t2 = await grid(model, 'waves', '-86,24,-78,31', vt);
      if (t2.cellDeg <= 2.6) ok(`T2 mid: ${t2.cellDeg.toFixed(2)}°/cell (${t2.p.product_id})`);
      else fail(`T2 8° bbox served ${t2.cellDeg.toFixed(2)}°/cell (${t2.p.product_id}) — demoted past the mid tier`);
    } catch (e) { fail('T2 ' + e.message); }
    // T3 + E1: global product parses; ±180 seam columns both live.
    try {
      const t3 = await grid(model, 'waves', null, vt);
      const cv = colValidity(t3.g);
      const west = cv.at(cv.lngs[0]), east = cv.at(cv.lngs[cv.lngs.length - 1]);
      if (east.valid > 0 && west.valid > 0 && east.valid === west.valid) {
        ok(`E1 seam: west ${west.valid}/${west.total} == east ${east.valid}/${east.total}`);
      } else if (east.valid === 0 || west.valid === 0) {
        fail(`E1 dead seam column: west ${west.valid}/${west.total}, east ${east.valid}/${east.total} (fencepost head #3 regression)`);
      } else {
        ok(`E1 seam live (west ${west.valid}, east ${east.valid} — asymmetry tolerated)`);
      }
    } catch (e) { fail('E1 ' + e.message); }
    // E2: FL regional east edge fully valid.
    try {
      const e2 = await grid(model, 'waves', '-85,24,-79,31', vt);
      const cv = colValidity(e2.g);
      const east = cv.at(cv.lngs[cv.lngs.length - 1]);
      if (east.valid === east.total) ok(`E2 FL east col ${cv.lngs[cv.lngs.length - 1]}: ${east.valid}/${east.total}`);
      else fail(`E2 FL east col ${cv.lngs[cv.lngs.length - 1]}: ${east.valid}/${east.total} (fencepost regression)`);
    } catch (e) { fail('E2 ' + e.message); }
  }

  console.log(failures === 0 ? 'CONTRACT PASS' : `CONTRACT FAIL — ${failures} violation(s)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error('contract runner error:', e); process.exit(1); });
