/**
 * coastband-analyze.js — turn coastband-raw.json into a band-width ladder and run the sign test.
 *
 * band = the run of samples, starting at the basemap land->water transition and going seaward,
 *        that are basemap WATER but where the Waves-ON frame equals the Waves-OFF frame
 *        (i.e. the marine field did not paint there).
 *
 * Reported at three difference thresholds so the number is not an artefact of one cutoff, and in
 * BOTH device pixels and kilometres. The Jacobian test is on the KM column: a fixed ground error
 * (coastline generalization) is invariant in z; a screen-space cause is invariant in PIXELS.
 *
 * Usage: node scripts/coastband-analyze.js <outdir>
 */
const fs = require('fs');
const path = require('path');

const outdir = process.argv[2] || path.join(__dirname, 'coastband-out');
const raw = JSON.parse(fs.readFileSync(path.join(outdir, 'coastband-raw.json'), 'utf8'));
const THRESHOLDS = [8, 16, 24];
const RUN = 20;          // samples of sustained water needed to call a land->water transition
const MIN_PAINT_FRAC = 0.20;  // below this the field is not present on this transect => VOID

const geoKm = (a, b) => {
  const R = 6371.0088, rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const la1 = a[1] * rad, la2 = b[1] * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const dist = (p, q) => (!p || !q) ? null : Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));

const tMeta = Object.fromEntries(raw.transects.map((t) => [t.id, t]));
const offByZ = Object.fromEntries(raw.passes.waves_off.map((p) => [p.targetZ.toFixed(2), p]));

const rows = [];
for (const on of raw.passes.waves_on) {
  const off = offByZ[on.targetZ.toFixed(2)];
  if (!off) { rows.push({ stop: on.stop, verdict: 'NO_BASEMAP_FRAME' }); continue; }
  for (const tOn of on.sample.transects) {
    const tOff = off.sample.transects.find((x) => x.id === tOn.id);
    const meta = tMeta[tOn.id];
    const row = {
      stop: on.stop, z: on.state.z, targetZ: on.targetZ, transect: tOn.id, coast: meta.coast,
      carveDisabled: on.carveDisabled, overlayOn: on.state.overlayOn, overlayReason: on.state.overlayReason,
      dataSpan: on.state.dataSpan, maskSpan: on.state.maskSpan, repatch: on.state.repatchReason,
    };
    if (!tOff) { row.verdict = 'NO_MATCHING_TRANSECT'; rows.push(row); continue; }
    if (tOff.n !== tOn.n) { row.verdict = 'SAMPLE_COUNT_MISMATCH'; row.detail = `${tOn.n} vs ${tOff.n}`; rows.push(row); continue; }
    if (tOn.offscreen || tOff.offscreen) { row.verdict = 'OFFSCREEN'; row.detail = `${tOn.offscreen}/${tOff.offscreen}`; rows.push(row); continue; }

    const w = tOff.water;
    const nLand = w.filter((x) => x === false).length, nWater = w.filter((x) => x === true).length;
    row.nSamples = tOn.n + 1; row.nLand = nLand; row.nWater = nWater;
    // the instrument must be able to tell "no transition" from "no band"
    if (nLand < RUN || nWater < RUN) { row.verdict = 'VOID_NO_TRANSITION'; rows.push(row); continue; }

    // first index that begins a sustained water run AND has land somewhere before it
    let coast = -1;
    for (let i = 0; i + RUN <= tOn.n; i++) {
      if (w[i] !== true) continue;
      let ok = true;
      for (let k = 0; k < RUN; k++) if (w[i + k] !== true) { ok = false; break; }
      if (!ok) continue;
      if (w.slice(0, i).some((x) => x === false)) { coast = i; break; }
    }
    if (coast < 0) { row.verdict = 'VOID_NO_TRANSITION'; rows.push(row); continue; }
    row.coastIdx = coast;

    const kmPerPx = geoKm(meta.from, meta.to) / tOn.n;
    row.kmPerDevPx = +kmPerPx.toFixed(4);

    const d = [];
    for (let i = 0; i <= tOn.n; i++) d.push(dist(tOn.rgb[i], tOff.rgb[i]));
    row.deltaMedianWater = (() => {
      const v = d.slice(coast).filter((x) => x !== null).sort((a, b) => a - b);
      return v.length ? v[Math.floor(v.length / 2)] : null;
    })();
    row.deltaMaxWater = Math.max(...d.slice(coast).filter((x) => x !== null), 0);

    row.bands = {};
    for (const T of THRESHOLDS) {
      const painted = d.map((x) => x !== null && x > T);
      const waterRun = [];
      for (let i = coast; i <= tOn.n; i++) { if (w[i] !== true) break; waterRun.push(i); }
      const frac = waterRun.length ? waterRun.filter((i) => painted[i]).length / waterRun.length : 0;
      let band = 0;
      for (let i = coast; i <= tOn.n && w[i] === true; i++) { if (painted[i]) break; band++; }
      row.bands['T' + T] = {
        band_px: band, band_km: +(band * kmPerPx).toFixed(3),
        paintFrac: +frac.toFixed(3), waterRun: waterRun.length,
        verdict: frac < MIN_PAINT_FRAC ? 'VOID_FIELD_ABSENT' : 'OK',
      };
    }
    row.verdict = row.bands['T16'].verdict;
    rows.push(row);
  }
}

// ── table ──
const pad = (s, n) => String(s === null || s === undefined ? '' : s).padEnd(n);
const padL = (s, n) => String(s === null || s === undefined ? '' : s).padStart(n);
console.log('\ndeployed build : ' + raw.deployed_build + '   theme: ' + raw.theme + '   renderer: ' + raw.env.renderer);
console.log('viewport 1280x800 @dpr2 · band measured in DEVICE px · T = per-channel max |ON-OFF|\n');
console.log(pad('stop', 24) + pad('transect', 9) + padL('z', 6) + padL('ovlOn', 7) + pad('  reason', 22) +
  padL('T8px', 6) + padL('T16px', 7) + padL('T24px', 7) + padL('T16 km', 8) + padL('km/px', 8) + padL('paint%', 8) + '  verdict');
console.log('-'.repeat(130));
for (const r of rows) {
  if (!r.bands) { console.log(pad(r.stop, 24) + pad(r.transect || '', 9) + padL(r.z || '', 6) + '   ' + r.verdict + (r.detail ? ' ' + r.detail : '')); continue; }
  console.log(pad(r.stop, 24) + pad(r.transect, 9) + padL(r.z, 6) + padL(String(r.overlayOn), 7) + pad('  ' + r.overlayReason, 22) +
    padL(r.bands.T8.band_px, 6) + padL(r.bands.T16.band_px, 7) + padL(r.bands.T24.band_px, 7) +
    padL(r.bands.T16.band_km.toFixed(2), 8) + padL(r.kmPerDevPx.toFixed(3), 8) +
    padL((r.bands.T16.paintFrac * 100).toFixed(0), 8) + '  ' + r.verdict);
}

// ── the sign test: is band_km invariant in z (geometry) or is band_px invariant (screen space)? ──
const ok = rows.filter((r) => r.bands && r.bands.T16.verdict === 'OK' && !r.carveDisabled);
const below = ok.filter((r) => r.targetZ < 8);
const at = ok.filter((r) => r.targetZ >= 8);
const stats = (a, f) => {
  const v = a.map(f).filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!v.length) return null;
  return { n: v.length, min: v[0], med: v[Math.floor(v.length / 2)], max: v[v.length - 1] };
};
console.log('\n── SIGN TEST ' + '─'.repeat(60));
console.log('z >= 8 (carve engaged, stock):  px ' + JSON.stringify(stats(at, (r) => r.bands.T16.band_px)) +
  '\n                                km ' + JSON.stringify(stats(at, (r) => r.bands.T16.band_km)));
console.log('z <  8 (carve OFF by design):   px ' + JSON.stringify(stats(below, (r) => r.bands.T16.band_px)) +
  '\n                                km ' + JSON.stringify(stats(below, (r) => r.bands.T16.band_km)));
const pos = rows.filter((r) => r.carveDisabled && r.bands);
console.log('POSITIVE CONTROL (z8.40, carve disabled): px ' + JSON.stringify(stats(pos, (r) => r.bands.T16.band_px)) +
  ' km ' + JSON.stringify(stats(pos, (r) => r.bands.T16.band_km)));
console.log('\nInvariance below z8 — a FIXED-GROUND-ERROR cause holds km constant; a SCREEN-SPACE cause holds px constant.');
for (const z of [...new Set(below.map((r) => r.targetZ))].sort((a, b) => b - a)) {
  const g = below.filter((r) => r.targetZ === z);
  console.log('  z' + z.toFixed(2) + '  px med ' + padL(stats(g, (r) => r.bands.T16.band_px).med, 4) +
    '   km med ' + stats(g, (r) => r.bands.T16.band_km).med.toFixed(2) +
    '   (n=' + g.length + ')');
}

fs.writeFileSync(path.join(outdir, 'coastband-analysis.json'), JSON.stringify({
  deployed_build: raw.deployed_build, theme: raw.theme, renderer: raw.env.renderer,
  generated_at: raw.generated_at, thresholds: THRESHOLDS, rows,
}, null, 1));
console.log('\nwritten: ' + path.join(outdir, 'coastband-analysis.json'));
