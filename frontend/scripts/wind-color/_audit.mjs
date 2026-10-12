// Scratch: does each theme's wind FIELD follow dark's logic, on its own map? (model: mirror-model.mjs; colour-blind: light-path-lib.mjs)
import { MODEL, groundOf, sample, tintOver, drawnField } from './mirror-model.mjs';
import { lchOf, cvdDE, normalDE } from './light-path-lib.mjs';
const STOPS = [0, 3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63, 75];
const name = (q) => { if (q.C < 9) return 'near-grey'; const h = q.h, T = [[20, 'red'], [50, 'red-orange'], [75, 'orange'], [100, 'gold/yellow'], [125, 'yellow-green'], [160, 'green'], [200, 'teal/aqua'], [250, 'azure'], [285, 'blue'], [310, 'violet/periwinkle'], [345, 'magenta/orchid'], [361, 'rose/red']]; return T.find((t) => h < t[0])[1]; };
const arc = (a, b) => { let d = (b - a) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; };
const f1 = (x) => x.toFixed(1);
const out = {};
for (const theme of ['dark', 'light', 'beach']) {
  const F = drawnField(theme); out[theme] = {};
  for (const surf of Object.keys(MODEL[theme].surfaces)) {
    const bm = groundOf(theme, surf), map = lchOf(bm), row = (kn) => { const c = tintOver(theme, kn, sample(F, kn), bm); return { kn, c, q: lchOf(c), off: normalDE(c, bm) }; };
    const K = Array.from({ length: 76 }, (_, kn) => row(kn));
    // turn-backs along speed: lightness (as distance from the map), hue, and distance from the map
    const turns = (vals, min) => { const t = []; let dir = 0, ext = vals[0], extKn = 0; for (let k = 1; k < vals.length; k++) { const d = vals[k] - ext; if (dir === 0) { if (Math.abs(d) >= min) { dir = Math.sign(d); ext = vals[k]; extKn = k; } } else if (Math.sign(d) === dir || d === 0) { ext = vals[k]; extKn = k; } else if (Math.abs(d) >= min) { t.push({ at: extKn, size: Math.abs(d) }); dir = -dir; ext = vals[k]; extKn = k; } } return t; };
    const lightAway = K.map((r) => Math.abs(r.q.L - map.L));
    const hueTurns = []; { let prev = null, dir = 0, last = null; for (const r of K) { if (r.kn > 60) break; if (r.q.C < 8) continue; if (prev !== null) { const d = arc(prev, r.q.h), s = Math.abs(d) > 4 ? Math.sign(d) : 0; if (s && dir && s !== dir) hueTurns.push(last); if (s) dir = s; } prev = r.q.h; last = r.kn; } }
    let edge = { d: 0 }; for (let k = 1; k <= 60; k++) { const d = normalDE(K[k - 1].c, K[k].c); if (d > edge.d) edge = { d, kn: k }; }
    const S = STOPS.map((kn) => K[kn]); let floor = { de: 99 }, normal = { de: 99 };
    for (let i = 2; i < S.length; i++) { const c = cvdDE(S[i - 1].c, S[i].c); if (c.de < floor.de) floor = { ...c, pair: `${S[i - 1].kn}-${S[i].kn}` }; const n = normalDE(S[i - 1].c, S[i].c); if (n < normal.de) normal = { de: n, pair: `${S[i - 1].kn}-${S[i].kn}` }; }
    out[theme][surf] = { map, S, lightTurns: turns(K.slice(0, 61).map((r) => r.q.L), 1.0), awayTurns: turns(lightAway.slice(0, 61), 1.0), offTurns: turns(K.slice(0, 61).map((r) => r.off), 1.5), hueTurns, edge, floor, normal };
  }
}
console.log('WHAT EACH SPEED LOOKS LIKE ON SCREEN (field over land | over sea): L* / colour name (hue)');
for (const kn of STOPS) { let s = String(kn).padStart(3) + ' kn |'; for (const theme of ['dark', 'light', 'beach']) { for (const surf of ['land', 'water']) { const r = out[theme][surf].S[STOPS.indexOf(kn)]; s += ` ${f1(r.q.L).padStart(5)} ${(name(r.q) + ' ' + Math.round(r.q.h)).padEnd(22)}`; } s += '|'; } console.log(s); }
for (const theme of ['dark', 'light', 'beach']) for (const surf of ['land', 'water']) { const o = out[theme][surf];
  console.log(`\n${theme.toUpperCase()} over ${surf} (map L* ${f1(o.map.L)} C* ${f1(o.map.C)})`);
  console.log(`  lightness turns back (0-60 kn, > 1 L*): ${o.lightTurns.length ? o.lightTurns.map((t) => `at ${t.at} kn by ${f1(t.size)}`).join('; ') : 'never'}`);
  console.log(`  distance from the map (dE00) turns back (> 1.5): ${o.offTurns.length ? o.offTurns.map((t) => `at ${t.at} kn by ${f1(t.size)}`).join('; ') : 'never'}  [calm ${f1(o.S[0].off)}, 3 kn ${f1(o.S[1].off)}, 10 kn ${f1(o.S[3].off)}, 21 kn ${f1(o.S[5].off)}, 40 kn ${f1(o.S[8].off)}, 75 kn ${f1(o.S[12].off)}]`);
  console.log(`  hue turns back (0-60 kn): ${o.hueTurns.length ? o.hueTurns.length + ' time(s), at ' + o.hueTurns.join(', ') + ' kn' : 'never'}`);
  console.log(`  hardest edge: ${f1(o.edge.d)} dE00 between ${o.edge.kn - 1} and ${o.edge.kn} kn`);
  console.log(`  neighbouring bands from 3 kn: colour-blind weakest ${f1(o.floor.de)} (${o.floor.pair} kn, ${o.floor.kind}); normal vision weakest ${f1(o.normal.de)} (${o.normal.pair} kn)`); }
