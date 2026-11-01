// WAVE PALETTE JACOBIAN: every input that moves the on-screen wave colour, at once (the owner's lens, 2026-10-12, as in
// mirror-jacobian.mjs for the wind). The SIGNAL is the height, read along the legend's own axis (each anchor an equal share).
// The NUISANCES are what moves the colour of one and the same height: the zoom (wash alpha 0.65 at world -> 0.77 coastal), the
// swell lighting (HEATMAP_FS adds up to (0.03, 0.05, 0.08) by the swell's facing, a texture inside every frame), the basemap
// water drifting 4% lighter or darker, and the wave texture's 8-bit step (10 m / 255). Colour vision and grey-scale are read as
// the share of the signal each keeps.
// This file lays the colours by the checker's own model (wave-lib.mjs); wave_jacobian.py measures them in CAM16-UCS (coloraide,
// the space colorcet and colorspacious judge colour maps in) and prints the matrix.
//
// Usage: node wave-jacobian.mjs [--json out.json] [--no-refs]      (then it runs wave_jacobian.py on that file when ./.venv exists)
// REFERENCES (--no-refs leaves them out): published sequential maps laid on the SAME anchors, through the SAME wash, as yardsticks
// for "state of the art": ColorBrewer YlGnBu and BuPu (7-class; the cartographic standard, and the families A and B belong to),
// and viridis and magma reversed (matplotlib's perceptually uniform maps, 7 samples), on v2's anchors. They were not designed for a wash at 65%
// over a cyan sea; that is the point of laying them through it.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { BASEMAP, ALPHAS, loadPalettes, composite } from './wave-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const REFS = {
  'YlGnBu (Brewer)': ['#ffffcc', '#c7e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#0c2c84'],
  'BuPu (Brewer)': ['#edf8fb', '#bfd3e6', '#9ebcda', '#8c96c6', '#8c6bb1', '#88419d', '#6e016b'],
  'viridis (reversed)': ['#fde725', '#8fd744', '#35b779', '#21908c', '#31688e', '#443a83', '#440154'],
  'magma (reversed)': ['#fcfdbf', '#feaf77', '#f1605d', '#b63679', '#721f81', '#2d1160', '#000004'],
};
const mod = loadPalettes();
const palettes = { ...mod.WAVE_PALETTES };
if (!args.includes('--no-refs')) for (const [name, cols] of Object.entries(REFS)) {
  const c = cols.map(hex);
  palettes[name] = { heights: mod.WAVE_PALETTES.v2.heights, cap: mod.WAVE_PALETTES.v2.cap, over: null, light: c, beach: c, ref: true };
}
const N = 20;   // samples per anchor segment along the legend axis
const out = { alphas: ALPHAS, texelM: 10 / 255, palettes: {} };
for (const [id, P] of Object.entries(palettes)) {
  out.palettes[id] = { ref: !!P.ref, anchors: P.heights.length };
  for (const theme of ['light', 'beach']) {
    const H = P.heights, hs = [];
    for (let i = 0; i < H.length - 1; i++) for (let k = 0; k < N; k++) hs.push(H[i] + (H[i + 1] - H[i]) * k / N);
    hs.push(H[H.length - 1]);
    const w = BASEMAP[theme].water, wUp = w.map((v) => Math.min(255, v * 1.04)), wDn = w.map((v) => v * 0.96);
    const at = (h, a, dir, water = null) => composite(P, theme, Math.min(h, P.cap), a, dir, false, water);
    out.palettes[id][theme] = {
      heights: hs,
      base: hs.map((h) => at(h, ALPHAS.world, 0.5)),
      coastal: hs.map((h) => at(h, ALPHAS.coastal, 0.5)),
      lit0: hs.map((h) => at(h, ALPHAS.world, 0)),
      lit1: hs.map((h) => at(h, ALPHAS.world, 1)),
      waterUp: hs.map((h) => at(h, ALPHAS.world, 0.5, wUp)),
      waterDn: hs.map((h) => at(h, ALPHAS.world, 0.5, wDn)),
      texel: hs.map((h) => at(h + 10 / 255, ALPHAS.world, 0.5)),
      // A rendered crest core over the wash (wave-lib crestOver is the checker's; read here only as a watch column).
    };
  }
}
const jsonPath = arg('--json') || path.join(os.tmpdir(), 'wave-jacobian.json');
fs.writeFileSync(jsonPath, JSON.stringify(out));
const py = [path.join(HERE, '.venv', 'Scripts', 'python.exe'), path.join(HERE, '.venv', 'bin', 'python')].find((p) => fs.existsSync(p));
if (py) process.exit(spawnSync(py, [path.join(HERE, 'wave_jacobian.py'), jsonPath, ...(arg('--out') ? ['--out', arg('--out')] : [])], { stdio: 'inherit' }).status || 0);
console.log(`wrote ${jsonPath}; run: .venv/Scripts/python wave_jacobian.py ${jsonPath}`);
