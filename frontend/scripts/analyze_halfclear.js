/**
 * analyze_halfclear.js — post-hoc "half heatmap clear" detector for zoomburst frame captures.
 *
 * The wind/marine heatmap tints the basemap with the Beaufort ramp (blue→teal→green→yellow):
 * a heatmap-covered pixel has elevated CHROMA (max-min channel) over the neutral-gray basemap.
 * A "half clear" = the colored fraction of one SIDE/QUADRANT of the map crop collapses for a
 * frame or few while an adjacent region stays colored — invisible to engine-state sampling and
 * often too soft-edged for the straight-seam detector.
 *
 * Usage: node analyze_halfclear.js <dir-with-burst_*.png> [chromaThresh=22]
 * Reports per-frame colored fraction (whole + 4 quadrants), the run median, and any frame whose
 * whole-crop OR a quadrant drops sharply below the running median (candidate half-clear).
 */
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

function decodePNG(buf) {
  let pos = 8, w = 0, h = 0, ct = 6, idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = ct === 6 ? 4 : 3;
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[rp++];
    const line = raw.slice(rp, rp + stride); rp += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, ch, data: out };
}

// map crop (same as the zoomburst seam detector), split into 2x2 quadrants
const CROP = { x0: 220, x1: 1010, y0: 60, y1: 760 };
function coloredFractions(png, chromaThresh) {
  const { w, ch, data } = png;
  const midX = (CROP.x0 + CROP.x1) >> 1, midY = (CROP.y0 + CROP.y1) >> 1;
  const cnt = { all: 0, NW: 0, NE: 0, SW: 0, SE: 0 };
  const tot = { all: 0, NW: 0, NE: 0, SW: 0, SE: 0 };
  for (let y = CROP.y0; y < CROP.y1; y += 2) {
    for (let x = CROP.x0; x < CROP.x1; x += 2) {
      const i = (y * w + x) * ch;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      const colored = chroma > chromaThresh;
      const q = (y < midY ? 'N' : 'S') + (x < midX ? 'W' : 'E');
      tot.all++; tot[q]++;
      if (colored) { cnt.all++; cnt[q]++; }
    }
  }
  const frac = k => tot[k] ? cnt[k] / tot[k] : 0;
  return { all: frac('all'), NW: frac('NW'), NE: frac('NE'), SW: frac('SW'), SE: frac('SE') };
}

function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; }

const dir = process.argv[2];
const chromaThresh = Number(process.argv[3] || 22);
if (!dir) { console.error('usage: node analyze_halfclear.js <dir> [chromaThresh]'); process.exit(1); }
const files = fs.readdirSync(dir).filter(f => /^burst_\d+\.png$/.test(f)).sort();
if (!files.length) { console.error('no burst_*.png in ' + dir); process.exit(1); }

const rows = [];
for (const f of files) {
  try {
    const png = decodePNG(fs.readFileSync(path.join(dir, f)));
    rows.push({ f, ...coloredFractions(png, chromaThresh) });
  } catch (e) { /* skip unreadable frame */ }
}

const medAll = median(rows.map(r => r.all));
const medQ = { NW: median(rows.map(r => r.NW)), NE: median(rows.map(r => r.NE)), SW: median(rows.map(r => r.SW)), SE: median(rows.map(r => r.SE)) };
// candidate half-clear: a QUADRANT collapses well below its own median while the diagonal-opposite quadrant stays colored
const DROP = 0.55;   // quadrant < 55% of its median
const KEEP = 0.80;   // opposite quadrant still >= 80% of its median
const opp = { NW: 'SE', NE: 'SW', SW: 'NE', SE: 'NW' };
const flags = [];
for (const r of rows) {
  for (const q of ['NW', 'NE', 'SW', 'SE']) {
    if (medQ[q] > 0.05 && r[q] < DROP * medQ[q] && r[opp[q]] >= KEEP * medQ[opp[q]]) {
      flags.push({ f: r.f, quad: q, qFrac: +r[q].toFixed(3), qMed: +medQ[q].toFixed(3), oppFrac: +r[opp[q]].toFixed(3), allFrac: +r.all.toFixed(3), allMed: +medAll.toFixed(3) });
      break;
    }
  }
}
// also: whole-crop sharp drops (a full-ish clear)
const wholeDrops = rows.filter(r => medAll > 0.05 && r.all < 0.5 * medAll).map(r => ({ f: r.f, allFrac: +r.all.toFixed(3), allMed: +medAll.toFixed(3) }));

console.log(`frames: ${rows.length} | chromaThresh ${chromaThresh}`);
console.log(`median colored fraction — all ${medAll.toFixed(3)} | NW ${medQ.NW.toFixed(3)} NE ${medQ.NE.toFixed(3)} SW ${medQ.SW.toFixed(3)} SE ${medQ.SE.toFixed(3)}`);
console.log(`\nHALF-CLEAR CANDIDATES (a quadrant collapses while its opposite stays colored): ${flags.length}`);
flags.slice(0, 40).forEach(x => console.log(`  ${x.f}  quad ${x.quad} ${x.qFrac} (med ${x.qMed})  opp ${x.oppFrac}  whole ${x.allFrac}/${x.allMed}`));
console.log(`\nWHOLE-CROP CLEARS (all < 50% median): ${wholeDrops.length}`);
wholeDrops.slice(0, 20).forEach(x => console.log(`  ${x.f}  all ${x.allFrac} (med ${x.allMed})`));
// min-colored frames (for manual review)
const byAll = [...rows].sort((a, b) => a.all - b.all).slice(0, 6);
console.log(`\nLOWEST colored-fraction frames (review these images):`);
byAll.forEach(r => console.log(`  ${r.f}  all ${r.all.toFixed(3)} | NW ${r.NW.toFixed(2)} NE ${r.NE.toFixed(2)} SW ${r.SW.toFixed(2)} SE ${r.SE.toFixed(2)}`));
