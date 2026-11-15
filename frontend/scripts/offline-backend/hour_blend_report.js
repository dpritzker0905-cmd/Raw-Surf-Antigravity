// Scores scn_hour_blend.js's two arms against the gate (docs/weather-program/log/2026-11-15-fable-crest-hour-blend.md).
//   node hour_blend_report.js <dir> [theme]
const fs = require('fs'); const path = require('path');
const dir = process.argv[2]; const theme = process.argv[3] || 'dark';
const load = (arm) => fs.readFileSync(path.join(dir, `hb-${arm}-${theme}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const A = load('A'); const B = load('B');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const f = (x, n = 3) => (Number.isFinite(x) ? x.toFixed(n) : 'n/a');
const out = []; const say = (s) => { out.push(s); console.log(s); };
let fail = 0; const verdict = (name, ok, text) => { if (!ok) fail += 1; say(`${ok ? 'PASS' : 'FAIL'} ${name}: ${text}`); };

// every view must have drawn ITS layer (the first run's swell views drew waves: the store had no swell)
const wrong = [...A, ...B].filter((r) => r.steps.some((x) => (x.rec || '').split('|')[1] !== r.layer)).map((r) => `${r.arm}${r.view}`);
verdict('LAYER', wrong.length === 0, wrong.length ? `the drawn record names another layer in: ${wrong.join(' ')} (the run is void)` : 'every view drew its own layer in both arms');

// H1
say('view  layer       z    A step  A floor  B step  B/A    blended(B)  left out');
const rows = A.map((a) => {
  const b = B.find((x) => x.view === a.view); const sa = a.steps.map((s) => s.step); const sb = b.steps.map((s) => s.step);
  const fl = mean(a.steps.map((s) => s.floor)); const leftOut = !(mean(sa) >= 2 * fl);
  const blended = b.steps.filter((s) => s.mixSeen > 0).length;
  say(`${String(a.view).padEnd(5)} ${a.layer.padEnd(11)} ${String(a.z).padEnd(4)} ${f(mean(sa)).padEnd(7)} ${f(fl).padEnd(8)} ${f(mean(sb)).padEnd(7)} ${f(mean(sb) / mean(sa), 2).padEnd(6)} ${blended}/${b.steps.length}         ${leftOut ? 'YES' : ''}`);
  return { a, b, sa, sb, leftOut, blended };
});
const kept = rows.filter((r) => !r.leftOut);
const voided = rows.length - kept.length > 3;
const pa = mean(kept.flatMap((r) => r.sa)); const pb = mean(kept.flatMap((r) => r.sb));
const worse = kept.filter((r) => mean(r.sb) > mean(r.sa)).map((r) => r.a.view);
if (voided) verdict('H1', false, `VOID: ${rows.length - kept.length} of ${rows.length} views carry no pop in arm A`);
else verdict('H1', pb <= 0.5 * pa && worse.length === 0, `pooled step A ${f(pa)} -> B ${f(pb)} (${f(100 * pb / pa, 1)}% of A; line 50%), ${kept.flatMap((r) => r.sa).length} boundaries per arm, ${rows.length - kept.length} view(s) left out; views worse in B: ${worse.length ? worse.join(',') : 'none'}`);
const bl = kept.flatMap((r) => r.b.steps.map((s, i) => ({ blended: s.mixSeen > 0, a: r.sa[i], b: r.sb[i] })));
const onlyBl = bl.filter((x) => x.blended);
say(`     blended boundaries only: ${onlyBl.length} of ${bl.length}; step A ${f(mean(onlyBl.map((x) => x.a)))} -> B ${f(mean(onlyBl.map((x) => x.b)))} (${f(100 * mean(onlyBl.map((x) => x.b)) / mean(onlyBl.map((x) => x.a)), 1)}%); not blended: A ${f(mean(bl.filter((x) => !x.blended).map((x) => x.a)))} B ${f(mean(bl.filter((x) => !x.blended).map((x) => x.b)))}`);

// H2
const ga = med(A.map((r) => r.timing.gpuMedian)); const gb = med(B.map((r) => r.timing.gpuMedian));
const gia = med(A.map((r) => r.timing.gpuMedianInBlend)); const gib = med(B.map((r) => r.timing.gpuMedianInBlend));
const perView = A.map((a) => { const b = B.find((x) => x.view === a.view); return `${a.view}:${f(a.timing.gpuMedian, 2)}>${f(b.timing.gpuMedian, 2)}`; }).join(' ');
verdict('H2', gb <= 1.1 * ga && gib <= 1.1 * gia, `GPU ms per frame, median over views: whole scrub A ${f(ga)} B ${f(gb)} (${f(100 * (gb / ga - 1), 1)}%); frames inside the blend windows A ${f(gia)} B ${f(gib)} (${f(100 * (gib / gia - 1), 1)}%); line +10%. Timer query: ${A[0].timing.ext}. Per view A>B: ${perView}`);
say(`     frame interval median A ${f(med(A.map((r) => r.timing.frameMsMedian)), 1)} ms, B ${f(med(B.map((r) => r.timing.frameMsMedian)), 1)} ms`);

// H3: per product. For every (grid size, valid time) both arms had resident after a step in the same view, the bytes must be equal.
const keyOf = (x) => `${x.dims}|${(x.rec || '').split('|')[3]}`;
let pairs = 0; let equal = 0; const diffs = [];
for (const r of rows) {
  const am = new Map(r.a.steps.map((x) => [keyOf(x), x.hash]));
  for (const [k, h] of new Map(r.b.steps.map((x) => [keyOf(x), x.hash]))) { if (!am.has(k)) continue; pairs += 1; if (am.get(k) === h && h) equal += 1; else diffs.push(`v${r.a.view} ${k}: ${am.get(k)} vs ${h}`); }
}
verdict('H3', pairs >= 40 && equal === pairs, `${equal} of ${pairs} (grid, valid time) pairs resident in both arms have identical wave-texture bytes (at least 40 pairs required)${diffs.length ? '; first differences: ' + diffs.slice(0, 3).join(' ; ') : ''}`);

// H4
const ends = B.flatMap((r) => r.steps); const okEnd = ends.filter((s) => s.endBlendObj === false && s.endUni === 0 && s.endMix === 0).length;
verdict('H4', okEnd === ends.length, `${okEnd} of ${ends.length} steps at rest 420 ms later: no blend object, shader mix uniform 0, telemetry mix 0`);

// H5: a view is scored only if ITS positive control trips; fewer than 6 scorable views voids the check.
const scorable = B.filter((r) => r.edges && r.edges[0].control > 1.15);
const E = scorable.flatMap((r) => r.edges.map((e) => ({ ...e, view: r.view })));
const held = E.filter((e) => e.mixHeld === 0.5); const worst = held.length ? Math.max(...held.map((e) => e.ratio)) : NaN;
const controls = B.map((r) => `${r.view}:${r.edges ? r.edges[0].control : 'n/a'}`).join(' ');
if (scorable.length < 6) verdict('H5', false, `VOID: the positive control tripped in only ${scorable.length} of ${B.length} views (controls ${controls})`);
else verdict('H5', held.length > 0 && worst <= 1.15 && mean(held.map((e) => e.ratio)) <= 1.05,
  `${scorable.length} of ${B.length} views scorable (positive controls ${controls}; must exceed 1.15); ${held.length} boundaries held at 0.5 (of ${E.length}; the rest were hard swaps by design): edge ratio worst ${f(worst, 4)} (line 1.15), mean ${f(mean(held.map((e) => e.ratio)), 4)} (line 1.05); edge pixels are ${f(100 * mean(E.map((e) => e.e0 / e.pixels)), 1)}% of the frame`);
say(`     mean change of the picture f=0 -> 0.5: ${f(mean(held.map((e) => e.d05)))}, f=0 -> 1: ${f(mean(held.map((e) => e.d01)))} (the held frame sits ${f(100 * mean(held.map((e) => e.d05)) / mean(held.map((e) => e.d01)), 0)}% of the way)`);
say(`     particle draw vertices per frame, arm B, per view (min-max): ${B.map((r) => `${r.particleVerts.min}-${r.particleVerts.max}`).join(' ')}`);

// H6
const da = mean(A.flatMap((r) => r.drag.filter((x) => x != null))); const db = mean(B.flatMap((r) => r.drag.filter((x) => x != null)));
verdict('H6', db <= da, `drag (one step per 100 ms): mean step A ${f(da)} B ${f(db)} (${f(100 * db / da, 1)}% of A)`);
say(`     arm B telemetry, last view: ${JSON.stringify(B[B.length - 1].tel)}`);
say(`     page errors: A ${A.flatMap((r) => r.errors).length}, B ${B.flatMap((r) => r.errors).length}`);
say(fail ? `${fail} gate line(s) FAIL` : 'every measured gate line passes (H7 is unit tests + the off-path check)');
