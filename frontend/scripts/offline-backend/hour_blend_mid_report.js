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
const gridsUsed = {}; for (const t of ok) if (t.grids) { const k = t.grids.join(' | '); gridsUsed[k] = (gridsUsed[k] || 0) + 1; }
const mixedGrid = ok.filter((t) => t.grids && new Set(t.grids).size > 1).length;
console.log(`     grids (h | hidden h+3 | h+6 at rest | earlier field mixed | resident mixed): ${Object.entries(gridsUsed).map(([k, n]) => `${n}x [${k}]`).join('; ')}. Triples in which the grid changed: ${mixedGrid} of ${ok.length}`);
if (mixedGrid) { const mg = ok.filter((t) => new Set(t.grids).size > 1); const sg = ok.filter((t) => new Set(t.grids).size === 1); console.log(`     grid-change triples alone: ${pc(sum(mg, 'eBlend') / sum(mg, 'eCut'))} of the cut (${mg.length}); same-grid triples: ${sg.length ? pc(sum(sg, 'eBlend') / sum(sg, 'eCut')) : 'n/a'} (${sg.length})`); }
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

// the diagnosis of the reference difference (section 13.3): reported, no verdict
const dg = ok.filter((t) => t.diag);
if (dg.length) console.log(`     DIAGNOSIS (${dg.length} pictures): held against the reference rounded DOWN ${f(sum(dg, (t) => t.diag.toLo) / dg.length)}, rounded UP ${f(sum(dg, (t) => t.diag.toHi) / dg.length)}, nearest ${f(sum(dg, 'refDiff') / dg.length)}; the DOWN and UP references differ by ${f(sum(dg, (t) => t.diag.loHi) / dg.length)}; the same picture read twice at rest differs by ${f(sum(dg, (t) => t.diag.noise) / dg.length)}; the hour at rest after the lab restored its bytes against the first reading of it ${f(sum(dg, (t) => t.diag.restVsReal) / dg.length)}`);

// H9
const sw = rows.flatMap((r) => (r.swaps || []).map((s) => ({ ...s, view: r.view })));
const GREY = rows[0] && rows[0].mode === 'grey'; const FLOOR = GREY ? 1.0 : 0;
const sok = sw.filter((s) => !s.miss && s.eCoarse >= FLOOR); const miss = {}; for (const s of sw.filter((x) => x.miss)) miss[s.miss] = (miss[s.miss] || 0) + 1;
const sr = sum(sok, 'eHeld') / sum(sok, 'eCoarse'); const over = sok.filter((x) => x.eHeld > x.eCoarse);
const ctl = sok.filter((x) => x.eShift >= 1.25 * x.eHeld).length; const ctlOk = sok.length > 0 && ctl >= 0.8 * sok.length;
const band = GREY ? [0.45, 0.55] : [0.35, 0.65];
const h9 = sok.length < 12 || !ctlOk ? 'VOID' : (over.length === 0 && sr >= band[0] && sr <= band[1] ? 'PASS' : 'FAIL');
verdict('H9', h9, `${sok.length} of ${sw.length} forced swaps scored (12 required; not scored: ${JSON.stringify(miss)}). HELD against FINE ${f(sum(sok, 'eHeld') / Math.max(1, sok.length))}, COARSE against FINE ${f(sum(sok, 'eCoarse') / Math.max(1, sok.length))} = ${pc(sr)} (band ${band[0] * 100}% to ${band[1] * 100}%${GREY ? ', value view, swaps under 1.0 grey unit not scored' : ''}); swaps where HELD is further from FINE than COARSE: ${over.length}. POSITIVE CONTROL (earlier grid moved one coarse cell east): error ${f(sum(sok, 'eShift') / Math.max(1, sok.length))}, at least 25% above the unshifted HELD in ${ctl} of ${sok.length} swaps (80% required)`);
if (sok.length) console.log(`     per swap HELD/COARSE %: ${sok.map((x) => `v${x.view}:${(100 * x.eHeld / x.eCoarse).toFixed(0)}`).join(' ')}; grids ${[...new Set(sok.map((x) => `${x.coarse}>${x.fine}`))].join(' ')}; FINE read again after the lab: differs by ${f(sum(sok, 'restNoise') / sok.length)}`);
console.log(`     page errors: ${rows.flatMap((r) => r.errors).length}`);
console.log(fail ? `${fail} line(s) not passed` : 'every truth line passes');
