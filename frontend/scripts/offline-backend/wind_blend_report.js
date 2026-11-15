// Scores the wind hour blend's instruments against the gate (docs/weather-program/log/2026-11-15-fable-wind-hour-blend.md).
//   node wind_blend_report.js scrub <dir> [theme] [desktop|phone]     (scn_wind_blend.js: W1, W2, W3, W4, W8b, W9)
//   node wind_blend_report.js truth <dir> [theme] [desktop|phone]     (scn_wind_blend_truth.js: W5, W6, W7, W8a)
const fs = require('fs'); const path = require('path');
const [mode, dir, theme = 'dark', vp = 'desktop'] = process.argv.slice(2);
const load = (f) => fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const sum = (a, k) => a.reduce((s, t) => s + (typeof k === 'function' ? k(t) : t[k]), 0);
const f = (x, n = 3) => (Number.isFinite(x) ? x.toFixed(n) : 'n/a'); const pc = (x) => (Number.isFinite(x) ? (100 * x).toFixed(1) + '%' : 'n/a');
let fail = 0; const verdict = (name, state, text) => { if (state !== 'PASS') fail += 1; console.log(`${state} ${name}: ${text}`); };

if (mode === 'scrub') {
  const A = load(`wb-A-${theme}-${vp}.jsonl`); const B = load(`wb-B-${theme}-${vp}.jsonl`);
  const unsettled = A.flatMap((r) => r.settles.map((s, i) => (s.ok ? null : `v${r.view}h${i + 1}`)).filter(Boolean));
  console.log(`settled: ${unsettled.length ? 'NOT settled within 10 s: ' + unsettled.join(' ') : 'every hour of every view'}; settle time median ${f(med(A.flatMap((r) => r.settles.map((s) => s.ms))), 0)} ms`);
  console.log('view  zoom  A step  A floor  B step  B/A   blended(B)  base grids (B)        left out');
  const rows = A.map((a) => { const b = B.find((x) => x.view === a.view); const sa = a.steps.map((s) => s.step); const sb = b.steps.map((s) => s.step); const fl = mean(a.steps.map((s) => s.floor));
    const leftOut = !(mean(sa) >= 2 * Math.max(fl, 0.02));
    console.log(`${String(a.view).padEnd(5)} ${String(a.z).padEnd(5)} ${f(mean(sa)).padEnd(7)} ${f(fl).padEnd(8)} ${f(mean(sb)).padEnd(7)} ${f(mean(sb) / mean(sa), 2).padEnd(5)} ${b.steps.filter((s) => s.mixSeen > 0).length}/${b.steps.length}         ${[...new Set(b.steps.map((s) => s.dims))].join(',').padEnd(21)} ${leftOut ? 'YES' : ''}`);
    return { a, b, sa, sb, leftOut }; });
  const kept = rows.filter((r) => !r.leftOut); const pa = mean(kept.flatMap((r) => r.sa)); const pb = mean(kept.flatMap((r) => r.sb));
  const worse = kept.filter((r) => mean(r.sb) > mean(r.sa)).map((r) => r.a.view);
  verdict('W1', rows.length - kept.length > 3 ? 'VOID' : (pb <= 0.5 * pa && !worse.length ? 'PASS' : 'FAIL'), `pooled step A ${f(pa)} -> B ${f(pb)} (${pc(pb / pa)} of A; line 50%), ${kept.flatMap((r) => r.sa).length} boundaries per arm, ${rows.length - kept.length} view(s) left out; views worse in B: ${worse.length ? worse.join(',') : 'none'}. Blended in B: ${sum(rows, (r) => r.b.steps.filter((s) => s.mixSeen > 0).length)} of ${sum(rows, (r) => r.b.steps.length)}. Smoothness only.`);
  const ga = med(A.map((r) => r.timing.gpuMedian)); const gb = med(B.map((r) => r.timing.gpuMedian)); const gia = med(A.map((r) => r.timing.gpuMedianInBlend)); const gib = med(B.map((r) => r.timing.gpuMedianInBlend));
  verdict('W2', gb <= 1.1 * ga && gib <= 1.1 * gia ? 'PASS' : 'FAIL', `GPU ms per frame, median over views: whole scrub A ${f(ga)} B ${f(gb)} (${f(100 * (gb / ga - 1), 1)}%); inside the blend windows A ${f(gia)} B ${f(gib)} (${f(100 * (gib / gia - 1), 1)}%); line +10%. Timer query: ${A[0].timing.ext}. Per view A>B: ${A.map((a) => { const b = B.find((x) => x.view === a.view); return `${a.view}:${f(a.timing.gpuMedian, 2)}>${f(b.timing.gpuMedian, 2)}|${f(a.timing.gpuMedianInBlend, 2)}>${f(b.timing.gpuMedianInBlend, 2)}`; }).join(' ')}`);
  let pairs = 0; let equal = 0; const diffs = [];
  for (const r of rows) { const key = (s) => `${s.dims}|${s.valid}`; const am = new Map(r.a.steps.map((s) => [key(s), s.hash])); for (const [k, h] of new Map(r.b.steps.map((s) => [key(s), s.hash]))) { if (!am.has(k)) continue; pairs += 1; if (h && am.get(k) === h) equal += 1; else diffs.push(`v${r.a.view} ${k}`); } }
  verdict('W3', pairs >= 40 && equal === pairs ? 'PASS' : 'FAIL', `${equal} of ${pairs} (grid, valid time) pairs held as the base in both arms have identical bytes and u/v range (40 required)${diffs.length ? '; differ: ' + diffs.slice(0, 4).join(' ; ') : ''}`);
  const ends = B.flatMap((r) => r.steps); const okEnd = ends.filter((s) => !s.endBlend && !s.endPrev && s.endMix === 0 && Object.values(s.endUni).every((v) => v === 0)).length;
  verdict('W4', okEnd === ends.length ? 'PASS' : 'FAIL', `${okEnd} of ${ends.length} steps at rest 420 ms later: no blend, no kept texture, the mix uniform 0 in the colour, advection and draw programs`);
  const vertsOk = [...A, ...B].every((r) => r.markVerts.min === r.markVerts.max);
  const dips = rows.map((r) => { const ma = mean(r.a.marks.map((m) => m.after)); const mb = mean(r.b.marks.map((m) => m.after)); return { view: r.a.view, ratio: mb / ma, a: ma, b: mb }; });
  const dipFail = dips.filter((d) => d.ratio < 0.95);
  verdict('W8b', vertsOk && !dipFail.length ? 'PASS' : 'FAIL', `particle vertices per frame constant in every view and arm: ${vertsOk} (${[...new Set([...A, ...B].map((r) => `${r.markVerts.min}-${r.markVerts.max}`))].join(' ')}); the particle picture's mean luminance in the 200 ms after a step, B / A per view: ${dips.map((d) => `${d.view}:${f(d.ratio, 3)}`).join(' ')} (line: not below 0.95)`);
  const da = mean(A.flatMap((r) => r.drag.filter((x) => x != null))); const db = mean(B.flatMap((r) => r.drag.filter((x) => x != null)));
  verdict('W9', db <= da ? 'PASS' : 'FAIL', `drag (a step per 100 ms): mean step A ${f(da)} B ${f(db)} (${pc(db / da)} of A)`);
  const t = B[B.length - 1].tel; console.log(`     arm B telemetry over the run: ${JSON.stringify(t && { starts: t.starts, gridSwaps: t.gridSwaps, restarts: t.restarts, kept: t.kept, ends: t.ends, errors: t.errors, skips: t.skips })}; page errors A ${A.flatMap((r) => r.errors).length} B ${B.flatMap((r) => r.errors).length}`);
} else {
  const R = load(`wt-${theme}-${vp}.jsonl`);
  const self = R.flatMap((r) => r.self.map((s) => ({ ...s, view: r.view }))).filter((s) => s.stable && s.mixes && s.mixes[0] === 1 && s.mixes[1] === 0.5);
  const ctlOk = self.length > 0 && self.every((s) => s.shifted >= 1.0);
  verdict('W5', self.length < 12 || !ctlOk ? 'VOID' : (self.every((s) => s.prevOnly <= 0.01 && s.half <= 0.01) ? 'PASS' : 'FAIL'), `${self.length} cases (12 required), grids ${[...new Set(self.map((s) => s.dims))].join(' ')}: an exact copy as the earlier field, drawn alone: largest difference from the picture at rest ${f(Math.max(...self.map((s) => s.prevOnly)), 4)}; mixed half and half: ${f(Math.max(...self.map((s) => s.half)), 4)} (line 0.01). POSITIVE CONTROL (the copy one cell east and north): smallest difference ${f(Math.min(...self.map((s) => s.shifted)), 2)}, largest ${f(Math.max(...self.map((s) => s.shifted)), 2)} (must be at least 1.0 in every case). The picture at rest read again: ${f(Math.max(...self.map((s) => s.restAgain)), 4)}`);
  const all = R.flatMap((r) => r.triples.map((t) => ({ ...t, view: r.view }))); const ok = all.filter((t) => !t.leftOut); const out = all.filter((t) => t.leftOut);
  const br = ok.filter((t) => t.bracket && t.sameGrid);
  verdict('W6', !br.length ? 'VOID' : (Math.max(...br.map((t) => t.bracket.outside)) <= 0.01 ? 'PASS' : 'FAIL'), `${br.length} same-grid held pictures in the value view: pixels outside the bracket of the two rounded references (one level of allowance), largest ${pc(Math.max(...br.map((t) => t.bracket.outside)))}, mean ${pc(mean(br.map((t) => t.bracket.outside)))} (line 1%); WITHOUT the allowance: largest ${pc(Math.max(...br.map((t) => t.bracket.outside0)))}, mean ${pc(mean(br.map((t) => t.bracket.outside0)))}. The two references differ by ${f(mean(br.map((t) => t.bracket.loHi)))} levels on average. Bytes the shader mixed against the hours stored: ${ok.filter((t) => t.mixing && t.mixing.prevVsTh === 0 && t.mixing.baseVsTh6 === 0).length} of ${ok.length} identical`);
  const v = ok.filter((t) => t.values);
  const perView = R.map((r) => { const t = r.triples.filter((x) => !x.leftOut && x.values); const cut = t.length ? sum(t, (x) => x.values.eCut) / t.length : NaN; return { view: r.view, n: t.length, cut, ratio: t.length ? sum(t, (x) => x.values.eBlend) / sum(t, (x) => x.values.eCut) : NaN }; });
  const quiet = perView.filter((p) => p.n && p.cut < 0.5).map((p) => p.view);
  const vs = v.filter((t) => !quiet.includes(t.view)); const ratio = sum(vs, (t) => t.values.eBlend) / sum(vs, (t) => t.values.eCut);
  const worse = perView.filter((p) => p.n && !quiet.includes(p.view) && p.ratio > 1).map((p) => p.view);
  verdict('W7', vs.length < 30 || ratio < 0.25 ? 'VOID' : (ratio <= 0.6 && !worse.length ? 'PASS' : 'FAIL'), `${vs.length} of ${all.length} triples scored in value space (30 required; left out: ${out.length ? out.map((t) => `v${t.view}j${t.j}:${t.leftOut}`).join(' ') : 'none'}; not same-grid: ${ok.length - v.length}; views with no signal (cut below 0.5 kn): ${quiet.length ? quiet.join(',') : 'none'}). Mean vector difference from the real middle hour: half-way mix ${f(sum(vs, (t) => t.values.eBlend) / vs.length)} kn, nearest hour ${f(sum(vs, (t) => t.values.eCut) / vs.length)} kn = ${pc(ratio)} (pass at most 60%, void below 25%; expected about 40%). Views where the mix is worse: ${worse.length ? worse.join(',') : 'none'}`);
  console.log(`     per view (% of cut, cut in kn): ${perView.map((p) => `${p.view}:${Number.isFinite(p.ratio) ? (100 * p.ratio).toFixed(0) + '%' : 'n/a'}/${f(p.cut, 2)}`).join(' ')}`);
  const pr = sum(ok, 'pBlend') / sum(ok, 'pCut');
  console.log(`     PICTURE space (colour field, ${ok.length} triples, held picture 3 s after the jump): mix ${f(sum(ok, 'pBlend') / ok.length)}, nearest hour ${f(sum(ok, 'pCut') / ok.length)} luminance units = ${pc(pr)}; truth read twice: largest difference ${f(Math.max(...ok.map((t) => t.truthNoise)))}. ${pr <= 0.6 === (ratio <= 0.6) ? 'Agrees with the value-space verdict.' : 'CONTRADICTS the value-space verdict.'}`);
  const ret = sum(vs, (t) => t.values.retention * t.values.nodes) / sum(vs, (t) => t.values.nodes); const ctl = ok.filter((t) => t.control12h != null);
  const ctlFalls = ctl.length > 0 && mean(ctl.map((t) => t.control12h)) < 0.85;
  verdict('W8a', !ctlFalls ? 'VOID' : (ret >= 0.85 ? 'PASS' : 'FAIL'), `speed kept through the half-way mix of h and h+6, pooled over nodes: ${f(ret)} (line 0.85). POSITIVE CONTROL, the moving part alone for two hours 12 h apart: mean ${f(mean(ctl.map((t) => t.control12h)))}, largest ${f(Math.max(...ctl.map((t) => t.control12h)))} (must fall below 0.85). The moving part alone for h and h+6: ${f(mean(ok.filter((t) => t.moving6h != null).map((t) => t.moving6h)))} (a wave 92 degrees of phase apart keeps 0.69)`);
  console.log(`     page errors: ${R.flatMap((r) => r.errors).length}`);
}
console.log(fail ? `${fail} line(s) not passed` : 'every line scored here passes');
