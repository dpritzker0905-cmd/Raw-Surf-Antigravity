// Real-frame parity read for ICON swell_2 option B (2026-11-14). Inputs: GFS swell_2, EURO swell_2 (plain) and EURO swell_2
// (Gulf-filled) global_mid frames from the PUBLIC weather-frames CDN (byte-identical mirrors of /grid's world products), read-only.
// Run with the browser's own modules copied as .mjs into ./js (staticFrameCodec, iconSwell2Blend, marineDirectionBlend), and a
// directory holding man.json ([{vt, <set key>: file}]) and the downloaded .bin frames:  node real-frame-parity.mjs <dir>
// A = blend(GFS, filled EURO): today's world-span map. C = blend(GFS, plain EURO): today's mid-clip map AND the stored product.
import fs from 'fs';
import zlib from 'zlib';
import { parseFrame, buildVectors, isGzip } from './js/staticFrameCodec.mjs';
import { blendIconSwell2 } from './js/iconSwell2Blend.mjs';
const R = process.argv[2];
const man = JSON.parse(fs.readFileSync(`${R}/man.json`));
const load = (f) => { let b = fs.readFileSync(`${R}/${f}`); if (isGzip(b)) b = zlib.gunzipSync(b); return buildVectors(parseFrame(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))); };
const inGulf = (v) => v.lat >= 17.5 && v.lat <= 31 && v.lng >= -98.5 && v.lng <= -79.5;
const valid = (v) => v.is_valid !== false && v.isOcean !== false;
const tot = { cells: 0, gulf: 0, diff: 0, diffGulf: 0, diffOut: 0, validFlip: 0, validFlipGulf: 0, maxDh: 0, maxDhOut: 0, filledCells: 0, filledCellsGulf: 0, fillEqGfs: 0, fillDhMax: 0, countEq: true, maxDdir: 0, maxDper: 0, dirOver1: 0, filledInDiff: 0 };
const perTime = [];
for (const row of man) {
  const G = load(row['GFS/marine/swell_2/global_mid']);
  const EP = load(row['EURO/marine/swell_2/global_mid']);
  const EF = load(row['EURO/marine/swell_2/global_mid_filled']);
  if (!(G.length === EP.length && EP.length === EF.length)) tot.countEq = false;
  const A = blendIconSwell2({ vectors: G }, { vectors: EF }, 0, null, { quiet: true }).grid.vectors;
  const C = blendIconSwell2({ vectors: G }, { vectors: EP }, 0, null, { quiet: true }).grid.vectors;
  let d = 0, dg = 0;
  for (let i = 0; i < A.length; i++) {
    const a = A[i], c = C[i], g = inGulf(a);
    tot.cells++; if (g) tot.gulf++;
    if (!valid(EP[i]) && valid(EF[i])) { tot.filledCells++; if (g) tot.filledCellsGulf++; const dh = Math.abs(EF[i].speed - G[i].speed); tot.fillDhMax = Math.max(tot.fillDhMax, valid(G[i]) ? dh : 0); if (valid(G[i]) && dh === 0) tot.fillEqGfs++; }
    const va = valid(a), vc = valid(c);
    const dh = Math.abs((a.speed || 0) - (c.speed || 0));
    const differs = va !== vc || dh > 0 || (va && vc && (a.direction !== c.direction || a.period !== c.period));
    if (va !== vc) { tot.validFlip++; if (g) tot.validFlipGulf++; }
    if (differs) { if (!valid(EP[i]) && valid(EF[i])) tot.filledInDiff++; if (va && vc) { const dd = Math.abs((((a.direction - c.direction) % 360) + 540) % 360 - 180); tot.maxDdir = Math.max(tot.maxDdir, dd); if (dd > 1) tot.dirOver1++; tot.maxDper = Math.max(tot.maxDper, Math.abs(a.period - c.period)); } tot.diff++; d++; if (g) { tot.diffGulf++; dg++; } else { tot.diffOut++; tot.maxDhOut = Math.max(tot.maxDhOut, dh); } tot.maxDh = Math.max(tot.maxDh, dh); }
  }
  perTime.push([row.vt, d, dg]);
}
console.log(JSON.stringify({ ...tot, perTime }, null, 1));
