/**
 * coastband-selftest.js — prove the band detector is not structurally blind.
 *
 * The stock ladder read band=0 and so did the `__RAW_BASEMAP_WATER_MASK__=false` control, which
 * leaves the zeros unproven: a detector that can only ever emit 0 would produce exactly this.
 * Rather than assert sensitivity, INJECT a band of known width into the real captured transect —
 * overwrite the first K water samples of the Waves-ON frame with that sample's own basemap colour,
 * which is precisely what an unpainted strip looks like — and require the detector to return K.
 *
 * This tests the DETECTOR, not the renderer. It cannot prove the renderer has no band; it can prove
 * that if the renderer had one this many pixels wide, the number reported would not have been 0.
 *
 *   node scripts/coastband-selftest.js <outdir>
 */
const fs = require('fs');
const path = require('path');
const outdir = process.argv[2] || path.join(__dirname, 'coastband-out');
const raw = JSON.parse(fs.readFileSync(path.join(outdir, 'coastband-raw.json'), 'utf8'));
const an = JSON.parse(fs.readFileSync(path.join(outdir, 'coastband-analysis2.json'), 'utf8'));
const median = (a) => { const v = a.slice().sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
const offByZ = Object.fromEntries(raw.passes.waves_off.map((p) => [p.targetZ.toFixed(2), p]));

// the detector's seaward half, verbatim in behaviour: hue references learned offshore, B-G cut
function measureBand(onRGB, offRGB, water, coast) {
  const bg = (c) => (c ? c[2] - c[1] : null);
  let last = coast; while (last + 1 < onRGB.length && water[last + 1] === true) last++;
  const far = coast + 40 <= last;
  const a = Math.min(coast + (far ? 40 : 5), last), b = Math.min(coast + (far ? 80 : 25), last);
  const refUn = median(offRGB.slice(a, b + 1).map(bg).filter(Number.isFinite));
  const refPa = median(onRGB.slice(a, b + 1).map(bg).filter(Number.isFinite));
  if (Math.abs(refUn - refPa) < 15) return { sep: Math.abs(refUn - refPa), band: null };
  const cut = (refUn + refPa) / 2;
  const painted = (i) => { const v = bg(onRGB[i]); return v === null ? false : (refPa < refUn ? v < cut : v > cut); };
  let band = 0;
  for (let i = coast; i < onRGB.length && water[i] === true; i++) { if (painted(i)) break; band++; }
  return { sep: Math.abs(refUn - refPa), band };
}

const INJECT = [1, 2, 3, 5, 8, 13, 21];
let pass = 0, fail = 0, skipped = 0;
console.log('\nDETECTOR SELF-TEST — inject a band of K px, require the detector to report K\n');
console.log('stop                    transect  sep   ' + INJECT.map((k) => 'K=' + String(k).padEnd(4)).join('') + ' verdict');
console.log('-'.repeat(104));
for (const r of an.rows) {
  if (r.verdict !== 'OK' || r.coastIdx === undefined) { skipped++; continue; }
  const on = raw.passes.waves_on.find((p) => p.stop === r.stop);
  const off = offByZ[r.targetZ.toFixed(2)];
  const tOn = on.sample.transects.find((t) => t.id === r.transect);
  const tOff = off.sample.transects.find((t) => t.id === r.transect);
  const base = measureBand(tOn.rgb, tOff.rgb, tOff.water, r.coastIdx);
  const got = [];
  let ok = true;
  for (const K of INJECT) {
    const spoof = tOn.rgb.slice();
    for (let i = r.coastIdx; i < r.coastIdx + K && i < spoof.length; i++) spoof[i] = tOff.rgb[i];  // unpainted = basemap
    const m = measureBand(spoof, tOff.rgb, tOff.water, r.coastIdx);
    got.push(m.band);
    if (m.band !== K + base.band) ok = false;
  }
  if (ok) pass++; else fail++;
  console.log(r.stop.padEnd(24) + r.transect.padEnd(9) + String(base.sep).padStart(4) + '  ' +
    got.map((g) => String(g).padEnd(6)).join('') + (ok ? 'PASS' : 'FAIL (expected ' + INJECT.map((k) => k + base.band).join(',') + ')'));
}
console.log(`\n${pass} pass · ${fail} fail · ${skipped} not measurable`);
console.log(fail === 0 && pass > 0
  ? 'The detector reports an injected band exactly, at every width from 1 px up. A real 1 px band\nwould not have been read as 0 — so the zeros are an absence of band, not an absence of sensitivity.'
  : '*** the detector does NOT recover injected bands — every zero it produced is void ***');
