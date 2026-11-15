// Scores scn_hour_blend_mid.js (H8, H5's exact reference, H9) against the gate:
// docs/weather-program/log/2026-11-15-fable-crest-hour-blend.md, sections 9 and 10.   node hour_blend_mid_report.js <dir> [theme]
const fs = require('fs'); const path = require('path');
const rows = fs.readFileSync(path.join(process.argv[2], `hm-${process.argv[3] || 'dark'}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const sum = (a, k) => a.reduce((s, t) => s + (typeof k === 'function' ? k(t) : t[k]), 0);
const f = (x, n = 3) => (Number.isFinite(x) ? x.toFixed(n) : 'n/a'); const pc = (x) => (Number.isFinite(x) ? (100 * x).toFixed(1) + '%' : 'n/a');
let fail = 0; const verdict = (name, state, text) => { if (state !== 'PASS') fail += 1; console.log(`${state} ${name}: ${text}`); };

const wrong = rows.filter((r) => r.drawnLayer !== r.layer).map((r) => r.view);
verdict('LAYER', wrong.length ? 'VOID' : 'PASS', wrong.length ? `another layer was drawn in views ${wrong.join(',')}` : `every one of the ${rows.length} views drew its own layer`);

// H8
const all = rows.flatMap((r) => r.triples.map((t) => ({ ...t, view: r.view })));
const ok = all.filter((t) => !t.leftOut); const out = all.filter((t) => t.leftOut);
const ratio = sum(ok, 'eBlend') / sum(ok, 'eCut');
const perView = rows.map((r) => { const t = r.triples.filter((x) => !x.leftOut); return { view: r.view, n: t.length, r: t.length ? sum(t, 'eBlend') / sum(t, 'eCut') : NaN }; });
const worse = perView.filter((v) => v.r > 1).map((v) => v.view);
const h8 = ok.length < 30 ? 'VOID' : ratio < 0.25 ? 'VOID' : (ratio <= 0.6 && worse.length === 0 ? 'PASS' : 'FAIL');
verdict('H8', h8, `${ok.length} of ${all.length} triples scored (30 required; left out: ${out.length ? out.map((t) => `v${t.view}j${t.j}:${t.leftOut}`).join(' ') : 'none'}). ERROR(blend) ${f(sum(ok, 'eBlend') / ok.length)} against ERROR(cut) ${f(sum(ok, 'eCut') / ok.length)} luminance units = ${pc(ratio)} (pass at most 60%, void below 25%). Views where the blend is worse than the cut: ${worse.length ? worse.join(',') : 'none'}`);
console.log(`     per view: ${perView.map((v) => `${v.view}:${Number.isFinite(v.r) ? (100 * v.r).toFixed(0) + '%' : 'n/a'}(${v.n})`).join(' ')}`);
console.log(`     the two textures mixed were h and h+6 in every scored triple (checked per triple; a triple that mixed anything else is left out as mixed_wrong_hours)`);
// flat control
const flat = sum(ok, 'eFlat') / sum(ok, 'eCut');
console.log(`     FLAT CONTROL: the 12 h-apart average scores ${pc(flat)} of the cut. ${flat < 0.6 ? 'It is UNDER 60%, so H8 cannot be read alone: read it with the retention figures below.' : 'It is not under 60%: mean absolute error does not reward the washed-out picture here.'}`);
console.log(`     contrast against the REAL middle hour (std of luminance, held / real): mean ${f(sum(ok, 'retTruth') / ok.length)}, min ${f(Math.min(...ok.map((t) => t.retTruth)))}; the flat control's: mean ${f(sum(ok, 'flatRetTruth') / ok.length)}`);
// value space
const v = ok.filter((t) => t.values);
if (v.length) {
  console.log(`     VALUE SPACE (${v.length} triples, from the texture bytes): height error, mix of h and h+6 against the real h+3: ${f(sum(v, (t) => t.values.hBlend) / v.length)} m; nearest hour: ${f(sum(v, (t) => t.values.hCut) / v.length)} m; ratio ${pc(sum(v, (t) => t.values.hBlend) / sum(v, (t) => t.values.hCut))}`);
  console.log(`                  direction error: mix ${f(sum(v, (t) => t.values.dBlend) / v.length, 2)} deg; nearest hour ${f(sum(v, (t) => t.values.dCut) / v.length, 2)} deg`);
  console.log(`                  height contrast of the mix against the real middle hour (std ratio): mean ${f(sum(v, (t) => t.values.hRetTruth) / v.length)}, min ${f(Math.min(...v.map((t) => t.values.hRetTruth)))} (the moving train alone would keep 0.69 at 6 h; parts that do not move raise it)`);
}

// H5 two-sided, against the exact reference
const ref = ok.filter((t) => t.refDiff != null);
const worstDiff = Math.max(...ref.map((t) => t.refDiff)); const worstRet = Math.max(...ref.map((t) => Math.abs(t.retM - t.retRef)));
verdict('H5-reference', !ref.length ? 'VOID' : (worstDiff <= 0.5 && worstRet <= 0.03 ? 'PASS' : 'FAIL'),
  `${ref.length} held pictures against the exact average of the two hours' bytes drawn at rest: largest mean absolute luminance difference ${f(worstDiff)} (line 0.5), mean ${f(sum(ref, 'refDiff') / ref.length)}; largest retention difference ${f(worstRet, 4)} (line 0.03). Retention of the held picture mean ${f(sum(ref, 'retM') / ref.length)}, of the reference ${f(sum(ref, 'retRef') / ref.length)}`);

// H9
const sw = rows.flatMap((r) => (r.swaps || []).map((s) => ({ ...s, view: r.view })));
const sok = sw.filter((s) => !s.miss); const miss = {}; for (const s of sw.filter((x) => x.miss)) miss[s.miss] = (miss[s.miss] || 0) + 1;
const sr = sum(sok, 'eHeld') / sum(sok, 'eCoarse'); const over = sok.filter((s) => s.eHeld > s.eCoarse);
const h9 = sok.length < 12 ? 'VOID' : (over.length === 0 && sr >= 0.35 && sr <= 0.65 ? 'PASS' : 'FAIL');
verdict('H9', h9, `${sok.length} of ${sw.length} grid swaps inside one hour scored (12 required; not scored: ${JSON.stringify(miss)}). Held picture against the fine grid ${f(sum(sok, 'eHeld') / Math.max(1, sok.length))}, coarse picture against the fine grid ${f(sum(sok, 'eCoarse') / Math.max(1, sok.length))} = ${pc(sr)} (band 35% to 65%); swaps where the held picture is further from the fine grid than the coarse one: ${over.length}`);
if (sok.length) console.log(`     per swap %: ${sok.map((s) => `v${s.view}:${(100 * s.eHeld / s.eCoarse).toFixed(0)}`).join(' ')}; grids ${[...new Set(sok.map((s) => `${s.coarse}>${s.fine}`))].join(' ')}`);
console.log(`     page errors: ${rows.flatMap((r) => r.errors).length}`);
console.log(fail ? `${fail} line(s) not passed` : 'every truth line passes');
