// LIGHT PATH, the solver's library: a fast replica of what the palette checker scores, so a search can run with the colour-blind floor
// as a CONSTRAINT (LESSONS L-V45) instead of reading it afterwards.
//
// The checker is the authority (check.mjs + cvd_check.py: coloraide's Vienot 1999 protan/deutan and Brettel 1997 tritan, CIEDE2000 in
// CIELAB D65). This file ports those three filters and that distance to plain JS so a search can score a candidate in microseconds;
// `node light-path-lib.mjs --verify` scores random colour pairs both ways and prints the largest disagreement (it must be ~1e-9).
// A replica is for solving; every table it produces is still run through check.mjs --strict and Jest (LESSONS L-V23, rule 4).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// coloraide 8.13, filters/cvd.py (linear sRGB in, linear sRGB out).
const VIENOT = {
  protan: [[1.1238276122216405e-01, 8.8761723877783620e-01, 5.5511151231257830e-17], [1.1238276122216398e-01, 8.8761723877783620e-01, -2.7755575615628914e-17],
    [4.0057682730469425e-03, -4.0057682730469390e-03, 1.0]],
  deutan: [[2.9275011427843560e-01, 7.0724988572156440e-01, 1.1102230246251565e-16], [2.9275011427843560e-01, 7.0724988572156440e-01, -5.5511151231257830e-17],
    [-2.2336587034129083e-02, 2.2336587034129093e-02, 1.0]],
};
const LRGB_TO_LMS = [[0.178824041258, 0.4351609057000001, 0.04119349692], [0.034556423182, 0.27155382458, 0.038671308360000003], [0.000299565576, 0.0018430896, 0.01467086136]];
const BRETTEL_TRITAN = {
  w1: [[7.392856536180033, -11.148044821248138, 0], [-0.34194012421930653, 3.5501661175064, 0], [-4.2050692716448586, 10.89115898202731, 0]],
  w2: [[8.0643934576311, -12.42414705871019, 0], [-0.9956078228581946, 4.7923119863996835, 0], [-0.2150297288038942, 3.3090019545637928, 0]],
  sep: [0.344781556122, -0.6551784438780001, 0.0],
};
const RGB2XYZ = [[0.4123907992659595, 0.357584339383878, 0.1804807884018343], [0.21263900587151036, 0.7151686787677559, 0.07219231536073371],
  [0.01933081871559185, 0.11919477979462598, 0.9505321522496606]];
const WHITE = [0.3127 / 0.329, 1, (1 - 0.3127 - 0.329) / 0.329];

const mm = (M, v) => [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]];
export const dec = (c) => (Math.abs(c) <= 0.04045 ? c / 12.92 : Math.sign(c) * Math.pow((Math.abs(c) + 0.055) / 1.055, 2.4));
export const enc = (c) => (Math.abs(c) <= 0.0031308 ? 12.92 * c : Math.sign(c) * (1.055 * Math.pow(Math.abs(c), 1 / 2.4) - 0.055));
const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
/** CIELAB D65 of a LINEAR sRGB colour. */
export function labOfLinear(lin) {
  const xyz = mm(RGB2XYZ, lin), fx = f(xyz[0] / WHITE[0]), fy = f(xyz[1] / WHITE[1]), fz = f(xyz[2] / WHITE[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/** CIELAB D65 of an encoded sRGB colour (0-1). */
export const labOf = (rgb) => labOfLinear(rgb.map(dec));
export const lchOf = (rgb) => { const q = labOf(rgb); return { L: q[0], C: Math.hypot(q[1], q[2]), h: (Math.atan2(q[2], q[1]) * 180 / Math.PI + 360) % 360, a: q[1], b: q[2] }; };
/** Encoded sRGB (possibly out of gamut) of a CIELAB D65 colour. */
const XYZ2RGB = [[3.2409699419045226, -1.537383177570094, -0.4986107602930034], [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786]];
export function rgbOfLab(L, a, b) {
  const fy = (L + 16) / 116, fx = a / 500 + fy, fz = fy - b / 200, inv = (t) => (t * t * t > 216 / 24389 ? t * t * t : (116 * t - 16) / (24389 / 27));
  return mm(XYZ2RGB, [inv(fx) * WHITE[0], inv(fy) * WHITE[1], inv(fz) * WHITE[2]]).map(enc);
}
export const rgbOfLch = (L, C, h) => rgbOfLab(L, C * Math.cos(h * Math.PI / 180), C * Math.sin(h * Math.PI / 180));

/** The colour a dichromat sees, as CIELAB D65: kind = 'protan' | 'deutan' (Vienot) | 'tritan' (Brettel) | 'normal'. */
export function simLab(rgb, kind) {
  const lin = rgb.map(dec);
  if (kind === 'normal') return labOfLinear(lin);
  if (kind === 'tritan') { const lms = mm(LRGB_TO_LMS, lin), side = lms[0] * BRETTEL_TRITAN.sep[0] + lms[1] * BRETTEL_TRITAN.sep[1] + lms[2] * BRETTEL_TRITAN.sep[2]; return labOfLinear(mm(side > 0 ? BRETTEL_TRITAN.w2 : BRETTEL_TRITAN.w1, lms)); }
  return labOfLinear(mm(VIENOT[kind], lin));
}

/** CIEDE2000 between two CIELAB colours (kL = kC = kH = 1), as coloraide computes it. */
export function de2000(p, q) {
  const [l1, a1, b1] = p, [l2, a2, b2] = q, rad = Math.PI / 180;
  const c1 = Math.hypot(a1, b1), c2 = Math.hypot(a2, b2), cm = (c1 + c2) / 2, c7 = Math.pow(cm, 7), g = 0.5 * (1 - Math.sqrt(c7 / (c7 + 6103515625)));
  const ap1 = (1 + g) * a1, ap2 = (1 + g) * a2, cp1 = Math.hypot(ap1, b1), cp2 = Math.hypot(ap2, b2);
  const hp1 = cp1 === 0 ? 0 : (Math.atan2(b1, ap1) / rad + 360) % 360, hp2 = cp2 === 0 ? 0 : (Math.atan2(b2, ap2) / rad + 360) % 360;
  const dl = l2 - l1, dc = cp2 - cp1;
  let dh = 0;
  if (cp1 * cp2 !== 0) { dh = hp2 - hp1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin(dh * rad / 2);
  const lpm = (l1 + l2) / 2, cpm = (cp1 + cp2) / 2;
  let hpm = hp1 + hp2;
  if (cp1 * cp2 !== 0) { if (Math.abs(hp1 - hp2) > 180) hpm += hpm < 360 ? 360 : -360; hpm /= 2; }
  const t = 1 - 0.17 * Math.cos((hpm - 30) * rad) + 0.24 * Math.cos(2 * hpm * rad) + 0.32 * Math.cos((3 * hpm + 6) * rad) - 0.20 * Math.cos((4 * hpm - 63) * rad);
  const dt = 30 * Math.exp(-Math.pow((hpm - 275) / 25, 2)), cpm7 = Math.pow(cpm, 7), rc = 2 * Math.sqrt(cpm7 / (cpm7 + 6103515625));
  const l50 = (lpm - 50) * (lpm - 50), sl = 1 + 0.015 * l50 / Math.sqrt(20 + l50), sc = 1 + 0.045 * cpm, sh = 1 + 0.015 * cpm * t, rt = -Math.sin(2 * dt * rad) * rc;
  return Math.sqrt((dl / sl) * (dl / sl) + (dc / sc) * (dc / sc) + (dH / sh) * (dH / sh) + rt * (dc / sc) * (dH / sh));
}
export const KINDS = ['protan', 'deutan', 'tritan'];
/** The checker's colour-blind distance between two encoded sRGB colours: the smallest over the three dichromats. */
export function cvdDE(a, b) { let w = Infinity, k = ''; for (const kind of KINDS) { const d = de2000(simLab(a, kind), simLab(b, kind)); if (d < w) { w = d; k = kind; } } return { de: w, kind: k }; }
export const normalDE = (a, b) => de2000(labOf(a), labOf(b));

// ── self-check against the authority ────────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--verify')) {
  const py = [path.join(HERE, '.venv', 'Scripts', 'python.exe'), path.join(HERE, '.venv', 'bin', 'python')].find((p) => fs.existsSync(p));
  if (!py) { console.error('no ./.venv with coloraide: cannot verify'); process.exit(2); }
  let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pairs = Array.from({ length: 4000 }, () => [[rnd(), rnd(), rnd()], [rnd(), rnd(), rnd()]]);
  const tmp = path.join(os.tmpdir(), 'light-path-verify.json');
  fs.writeFileSync(tmp, JSON.stringify(pairs));
  const code = ['import json,sys', 'from coloraide import Color', 'P=json.load(open(sys.argv[1]))', 'out=[]',
    'for a,b in P:', '  row=[Color("srgb",a).delta_e(Color("srgb",b),method="2000")]',
    '  for kind,method in (("protan","vienot"),("deutan","vienot"),("tritan","brettel")):',
    '    row.append(Color("srgb",a).filter(kind,method=method).delta_e(Color("srgb",b).filter(kind,method=method),method="2000"))',
    '  out.append(row)', 'print(json.dumps(out))'].join('\n');
  const r = spawnSync(py, ['-c', code, tmp], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) { console.error(r.stderr); process.exit(2); }
  const ref = JSON.parse(r.stdout); let worst = 0;
  pairs.forEach(([a, b], i) => { const mine = [normalDE(a, b), ...KINDS.map((k) => de2000(simLab(a, k), simLab(b, k)))]; mine.forEach((v, j) => { worst = Math.max(worst, Math.abs(v - ref[i][j])); }); });
  console.log(`replica vs coloraide over ${pairs.length} random pairs x (normal, protan, deutan, tritan): largest disagreement ${worst.toExponential(2)} dE2000`);
  process.exit(worst < 1e-6 ? 0 : 1);
}
