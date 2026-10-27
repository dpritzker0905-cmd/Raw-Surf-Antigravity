// Offline comparison of the screenshots scn_position.js saved: shifts between thinned/exact renders of the flag-off and flag-on servers.
//   node cmp_position.js <dir>      (needs pos_4100_{thinned,exact}.png and pos_4101_{thinned,exact}.png, clip from the run)
const fs = require('fs'); const path = require('path');
const { decodePng } = require(path.join(__dirname, '../../e2e/pngPixels.js'));
const dir = process.argv[2]; const dDegPerPx = +(process.argv[3] || 0.0705);
const A0 = decodePng(fs.readFileSync(path.join(dir, 'pos_4100_exact.png')));
const clip = { x0: Math.round(A0.width * 0.25), x1: Math.round(A0.width * 0.75), y0: 120, y1: A0.height - 120 };
const rows = (f) => { const A = decodePng(fs.readFileSync(path.join(dir, f))); const r = []; for (let y = clip.y0; y < clip.y1; y++) { let acc = 0; let n = 0; for (let x = clip.x0; x < clip.x1; x += 2) { const p = (y * A.width + x) * A.bpp; acc += 0.2126 * A.data[p] + 0.7152 * A.data[p + 1] + 0.0722 * A.data[p + 2]; n++; } r.push(acc / n); } return r; };
const shift = (a, b, M = 90) => { const m = (v) => v.reduce((x, y) => x + y, 0) / v.length; const ma = m(a); const mb = m(b); let best = { s: 0, c: -2 }; for (let s = -M; s <= M; s++) { let nu = 0; let da = 0; let db = 0; for (let y = M; y < a.length - M; y++) { const x = a[y] - ma; const z = b[y - s] - mb; nu += x * z; da += x * x; db += z * z; } const c = nu / Math.sqrt(da * db + 1e-12); if (c > best.c) best = { s, c }; } return best; };
const R = { offT: rows('pos_4100_thinned.png'), offE: rows('pos_4100_exact.png'), onT: rows('pos_4101_thinned.png'), onE: rows('pos_4101_exact.png') };
const rep = (name, a, b) => { const r = shift(R[a], R[b]); console.log(name.padEnd(34), 'shift', String(r.s).padStart(4), 'px =', (r.s * dDegPerPx).toFixed(2).padStart(6), 'deg =', String(Math.round(r.s * dDegPerPx * 111)).padStart(5), 'km | corr', r.c.toFixed(3)); };
rep('exact(off) vs exact(on)  [null]', 'offE', 'onE');
rep('thinned(off) vs exact(off)', 'offE', 'offT');
rep('thinned(on)  vs exact(on)', 'onE', 'onT');
rep('thinned(off) vs thinned(on)', 'onT', 'offT');
