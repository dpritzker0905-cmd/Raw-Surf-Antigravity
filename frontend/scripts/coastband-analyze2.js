/**
 * coastband-analyze2.js — the corrected detector, measured in BOTH directions.
 *
 * WHY v1 WAS NOT ENOUGH. v1 called a pixel "field painted" when the Waves-ON frame differed from
 * the Waves-OFF frame. Looking at the pixels killed that: the difference map is green over LAND as
 * well as water, because toggling Waves restyles the basemap (landuse reorder, water fill-opacity).
 * So "differs" != "the field painted here", and a 100% paint fraction meant nothing.
 *
 * On WATER the ON-OFF comparison survives, but only once it is shown that bare water in an ON-style
 * frame still reads as the basemap water colour. The `__RAW_BASEMAP_WATER_MASK__=false` run supplies
 * exactly that: it strips basemap water truth from the mask, so the same frame contains both painted
 * and unpainted water. This script reads the bare-water colour out of it instead of assuming one.
 *
 * AND THE DIRECTION v1 COULD NOT SEE. A generalized coastline is not biased seaward. Where it lies
 * landward of truth the field falls SHORT (a strip of bare water = the band). Where it lies seaward
 * the field BLEEDS onto real land. v1 measured only the shortfall, so a clean shortfall number could
 * have sat next to an ugly bleed and been reported as "no defect". Both are measured here:
 *
 *   band_px  — samples from the shoreline seaward that are basemap WATER and NOT field-coloured
 *   bleed_px — samples from the shoreline landward that are basemap LAND and ARE field-coloured
 *
 * The field colour is taken per transect from the water 5..25 samples offshore, so it tracks the
 * heatmap's local value rather than a hard-coded cyan.
 *
 *   node scripts/coastband-analyze2.js <outdir> [label]
 */
const fs = require('fs');
const path = require('path');

const outdir = process.argv[2];
const label = process.argv[3] || path.basename(outdir);
const raw = JSON.parse(fs.readFileSync(path.join(outdir, 'coastband-raw.json'), 'utf8'));
const RUN = 20;            // sustained samples needed to call a land->water transition
const FIELD_TOL = 24;      // max per-channel distance to call a pixel "the field colour"
// Window used to learn the field colour. It must sit OUTSIDE any plausible band, or a wide band
// contaminates its own reference: the self-test showed a 21 px injected band silently turning the
// references inseparable, so the detector returned VOID instead of 21. Learn it well offshore and
// fall back inward only when the transect is too short, recording which window was used.
const OFFSHORE_FAR = [40, 80];
const OFFSHORE_NEAR = [5, 25];

const geoKm = (a, b) => {
  const R = 6371.0088, rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const d3 = (p, q) => (!p || !q) ? Infinity : Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));
const median = (a) => { const v = a.slice().sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
const medRGB = (arr) => { const c = arr.filter(Boolean); return c.length ? [0, 1, 2].map((k) => median(c.map((p) => p[k]))) : null; };
const hex = (c) => (c ? '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('') : 'none');

const tmeta = Object.fromEntries(raw.transects.map((t) => [t.id, t]));
const offByZ = Object.fromEntries(raw.passes.waves_off.map((p) => [p.targetZ.toFixed(2), p]));
const rows = [];

for (const on of raw.passes.waves_on) {
  const off = offByZ[on.targetZ.toFixed(2)];
  if (!off) continue;
  for (const tOn of on.sample.transects) {
    const tOff = off.sample.transects.find((x) => x.id === tOn.id);
    const meta = tmeta[tOn.id];
    const r = {
      stop: on.stop, z: on.state.z, targetZ: on.targetZ, transect: tOn.id, coast: meta.coast,
      carveDisabled: on.carveDisabled, overlayOn: on.state.overlayOn, overlayReason: on.state.overlayReason,
      grid: on.state.gridLegend, engineHandle: on.state.engineHandle,
    };
    if (!tOff || tOff.n !== tOn.n || tOn.offscreen || tOff.offscreen) { r.verdict = 'VOID_FRAME'; rows.push(r); continue; }
    const w = tOff.water;
    if (w.filter((x) => x === false).length < RUN || w.filter((x) => x === true).length < RUN) {
      r.verdict = 'VOID_NO_TRANSITION'; rows.push(r); continue;
    }
    let coast = -1;
    for (let i = 0; i + RUN <= tOn.n; i++) {
      if (w[i] !== true) continue;
      let ok = true; for (let k = 0; k < RUN; k++) if (w[i + k] !== true) { ok = false; break; }
      if (ok && w.slice(0, i).some((x) => x === false)) { coast = i; break; }
    }
    if (coast < 0) { r.verdict = 'VOID_NO_TRANSITION'; rows.push(r); continue; }

    const kmPerPx = geoKm(meta.from, meta.to) / tOn.n;
    r.coastIdx = coast; r.kmPerDevPx = +kmPerPx.toFixed(4);

    // learn the field colour offshore, and the basemap water colour from the SAME samples in OFF
    const lastWater = (() => { let i = coast; while (i <= tOn.n && w[i] === true) i++; return i - 1; })();
    const far = coast + OFFSHORE_FAR[0] <= lastWater;
    const [o0, o1] = far ? OFFSHORE_FAR : OFFSHORE_NEAR;
    r.refWindow = far ? 'far' : 'near';
    const winA = Math.min(coast + o0, lastWater), winB = Math.min(coast + o1, lastWater);
    const fieldC = medRGB(tOn.rgb.slice(winA, winB + 1));
    const baseWaterC = medRGB(tOff.rgb.slice(winA, winB + 1));
    r.fieldColor = hex(fieldC); r.basemapWaterColor = hex(baseWaterC);
    r.fieldVsBasemapWater = fieldC && baseWaterC ? d3(fieldC, baseWaterC) : null;
    // if the field colour is indistinguishable from basemap water, the detector is BLIND here
    if (r.fieldVsBasemapWater !== null && r.fieldVsBasemapWater < FIELD_TOL) {
      r.verdict = 'VOID_FIELD_INDISTINGUISHABLE'; rows.push(r); continue;
    }

    // DISCRIMINATOR. A flat colour-distance test to the offshore field colour false-positives near
    // the shore: the basemap shades shallow water lighter (measured: #89b6ee -> #6ea5f2 over ~4
    // samples) and the field composites over it, so genuinely-painted near-shore pixels sit outside
    // any lightness tolerance and get counted as band. B-G is immune to that — it separates the
    // basemap's BLUE water from the field's CYAN by hue, not brightness, and both references are
    // read from this transect rather than hard-coded.
    const bg = (c) => (c ? c[2] - c[1] : null);
    const refUnpainted = median(tOff.rgb.slice(winA, winB + 1).map(bg).filter(Number.isFinite));
    const refPainted = median(tOn.rgb.slice(winA, winB + 1).map(bg).filter(Number.isFinite));
    r.bgUnpainted = refUnpainted; r.bgPainted = refPainted; r.bgSeparation = Math.abs(refUnpainted - refPainted);
    if (!(r.bgSeparation >= 15)) { r.verdict = 'VOID_HUE_INSEPARABLE'; rows.push(r); continue; }
    const bgCut = (refUnpainted + refPainted) / 2;
    const painted = (i) => { const v = bg(tOn.rgb[i]); return v === null ? false : (refPainted < refUnpainted ? v < bgCut : v > bgCut); };
    // seaward the hue test decides; landward "is this land wearing the field's colour" is a full
    // colour question (land is neither blue nor cyan), so that direction keeps the distance test.
    const isField = (i) => (w[i] === true ? painted(i) : d3(tOn.rgb[i], fieldC) <= FIELD_TOL);
    // SHORTFALL: seaward from the shoreline, basemap water that the field did not paint
    let band = 0;
    for (let i = coast; i <= tOn.n && w[i] === true; i++) { if (isField(i)) break; band++; }
    // BLEED: landward from the shoreline, basemap land that carries the field colour
    let bleed = 0;
    for (let i = coast - 1; i >= 0 && w[i] === false; i--) { if (!isField(i)) break; bleed++; }
    // coverage sanity: the field must actually be present offshore or both numbers are meaningless
    const seaward = []; for (let i = coast; i <= tOn.n && w[i] === true; i++) seaward.push(i);
    const cover = seaward.length ? seaward.filter(isField).length / seaward.length : 0;

    r.band_px = band; r.band_km = +(band * kmPerPx).toFixed(3);
    r.bleed_px = bleed; r.bleed_km = +(bleed * kmPerPx).toFixed(3);
    r.fieldCoverSeaward = +cover.toFixed(3);
    r.verdict = cover < 0.2 ? 'VOID_FIELD_ABSENT' : 'OK';
    rows.push(r);
  }
}

const P = (s, n) => String(s ?? '').padEnd(n);
const L = (s, n) => String(s ?? '').padStart(n);
console.log(`\n=== ${label} ===  build ${raw.deployed_build} · theme ${raw.theme} · ${raw.env.renderer.slice(0, 46)}`);
console.log(P('stop', 24) + P('transect', 9) + L('z', 5) + L('ovl', 6) + P('  reason', 16) +
  L('band px', 8) + L('band km', 8) + L('bleed px', 9) + L('bleed km', 9) + L('cover', 7) + L('field', 9) + L('water', 9) + '  verdict');
console.log('-'.repeat(146));
for (const r of rows) {
  if (r.verdict !== 'OK') { console.log(P(r.stop, 24) + P(r.transect, 9) + L(r.z, 5) + '   ' + r.verdict); continue; }
  console.log(P(r.stop, 24) + P(r.transect, 9) + L(r.z, 5) + L(String(r.overlayOn), 6) + P('  ' + r.overlayReason, 16) +
    L(r.band_px, 8) + L(r.band_km.toFixed(2), 8) + L(r.bleed_px, 9) + L(r.bleed_km.toFixed(2), 9) +
    L((r.fieldCoverSeaward * 100).toFixed(0) + '%', 7) + L(r.fieldColor, 9) + L(r.basemapWaterColor, 9) + '  OK');
}
const ok = rows.filter((r) => r.verdict === 'OK');
const st = (a, f) => { const v = a.map(f).filter(Number.isFinite).sort((x, y) => x - y); return v.length ? { n: v.length, min: v[0], med: v[Math.floor(v.length / 2)], max: v[v.length - 1] } : null; };
console.log('\nSHORTFALL band  px ' + JSON.stringify(st(ok, (r) => r.band_px)) + '  km ' + JSON.stringify(st(ok, (r) => r.band_km)));
console.log('BLEED onto land px ' + JSON.stringify(st(ok, (r) => r.bleed_px)) + '  km ' + JSON.stringify(st(ok, (r) => r.bleed_km)));
console.log('\nper-zoom (median across transects) — fixed ground error holds KM constant, screen-space holds PX constant');
for (const z of [...new Set(ok.map((r) => r.targetZ))].sort((a, b) => b - a)) {
  const g = ok.filter((r) => r.targetZ === z);
  console.log('  z' + z.toFixed(2) + '  band ' + L(st(g, (r) => r.band_px).med, 4) + ' px / ' + L(st(g, (r) => r.band_km).med.toFixed(2), 5) +
    ' km   bleed ' + L(st(g, (r) => r.bleed_px).med, 4) + ' px / ' + L(st(g, (r) => r.bleed_km).med.toFixed(2), 5) + ' km   (n=' + g.length + ')');
}
fs.writeFileSync(path.join(outdir, 'coastband-analysis2.json'),
  JSON.stringify({ label, deployed_build: raw.deployed_build, theme: raw.theme, renderer: raw.env.renderer,
    field_tol: FIELD_TOL, rows }, null, 1));
console.log('\nwritten: ' + path.join(outdir, 'coastband-analysis2.json'));
