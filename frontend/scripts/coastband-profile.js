/**
 * coastband-profile.js — print the raw colour profile along one transect.
 *
 * The ON-minus-OFF detector is REFUTED: its difference map is green over LAND as well as water, so
 * "Waves OFF" is not a basemap reference — toggling the layer restyles the whole basemap. Before
 * building a second detector, look at what the pixels actually are.
 *
 *   node scripts/coastband-profile.js <outdir> <stop> <transect>
 */
const fs = require('fs');
const path = require('path');
const [outdir, stop, tid] = [process.argv[2], process.argv[3] || 'z7.50', process.argv[4] || 'FL-A'];
const raw = JSON.parse(fs.readFileSync(path.join(outdir, 'coastband-raw.json'), 'utf8'));
const on = raw.passes.waves_on.find((p) => p.stop === stop);
const off = raw.passes.waves_off.find((p) => Math.abs(p.targetZ - on.targetZ) < 1e-6);
const tOn = on.sample.transects.find((t) => t.id === tid);
const tOff = off.sample.transects.find((t) => t.id === tid);
const hex = (c) => (c ? '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('') : '   none  ');
const dist = (p, q) => (!p || !q) ? -1 : Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));

console.log(`\n${stop} / ${tid}  z=${on.state.z}  n=${tOn.n}  overlay=${on.state.overlayReason}`);
console.log('i    water   ON        OFF       |d|   stepON');
let prevOn = null;
for (let i = 0; i <= tOn.n; i++) {
  const step = prevOn ? dist(tOn.rgb[i], prevOn) : 0;
  prevOn = tOn.rgb[i];
  const w = tOff.water[i];
  console.log(String(i).padStart(4) + '  ' + String(w === true ? 'WATER' : w === false ? 'land ' : '  ?  ').padEnd(7) +
    hex(tOn.rgb[i]) + '  ' + hex(tOff.rgb[i]) + '  ' +
    String(dist(tOn.rgb[i], tOff.rgb[i])).padStart(4) + '  ' + String(step).padStart(5) + (step > 10 ? '  <== STEP' : ''));
}
