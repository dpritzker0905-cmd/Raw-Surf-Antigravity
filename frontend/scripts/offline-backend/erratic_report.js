// Summarize scn_erratic_fuzz.js runs (2026-10-27): totals, violations by invariant, clusters (one per distinct signature) with their
// instances, timing per action type, long tasks, the host audit and the pixel verdicts.
//   node erratic_report.js <runs dir> [out.json]
const fs = require('fs');
const path = require('path');
const { judgeRun } = require('./erratic_pixels.js');

const dir = process.argv[2];
const files = fs.readdirSync(dir).filter((f) => /^run-s\d+\.json$/.test(f)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
const pct = (a, p) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };
const zb = (z) => (z == null ? '?' : z < 4 ? 'z<4' : z < 6.5 ? 'z4-6.5' : z < 8 ? 'z6.5-8' : 'z8+');
const tot = { sequences: 0, actions: 0, frames: 0, byView: {}, byProfile: {}, backendSlow: 0, harnessErrors: 0, errors: [] };
const viol = {}; const transient = {}; const clusters = {}; const timing = {}; const over500 = {}; const hosts = {}; const aborted = {}; let ws = 0;
const long = { n: 0, over200: 0, max: 0 }; const pixel = {}; const pixelBad = [];
const add = (k, n = 1) => { viol[k] = (viol[k] || 0) + n; };
const cl = (kind, sig, inst) => { const k = `${kind} | ${sig}`; (clusters[k] = clusters[k] || { kind, sig, n: 0, seeds: new Set(), inst: [] }); const c = clusters[k]; c.n += 1; c.seeds.add(inst.seed); if (c.inst.length < 8) c.inst.push(inst); };
for (const f of files) {
  const o = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (o.error) { tot.errors.push({ seed: o.seed, error: o.error }); continue; }
  tot.sequences += 1; tot.actions += o.actions.length; tot.frames += o.frames || 0;
  tot.byView[o.view] = (tot.byView[o.view] || 0) + 1; tot.byProfile[o.profile] = (tot.byProfile[o.profile] || 0) + 1;
  if (o.backendSlow) tot.backendSlow += 1;
  tot.harnessErrors += (o.harnessErrors || []).length;
  for (const [k, v] of Object.entries(o.transient || {})) transient[k] = (transient[k] || 0) + v;
  const before = (i) => o.actions.slice(Math.max(0, i - 3), i + 1).map((x) => x.type + (x.type === 'model' || x.type === 'layer' ? `:${x.a.name}` : '') + (x.type === 'fault' ? `:${x.a.kind}` : '')).join('>');
  for (const e of o.episodes) {
    if (!e.counts) continue;
    add(e.kind);
    const s = e.sel || {}; const r = e.res || {}; const g = e.gpu || {};
    let sig;
    if (e.kind === 'inv1_blank') sig = `after ${o.actions[e.action] ? o.actions[e.action].type : '?'} ${zb(s.zoom)}`;
    else if (e.kind === 'inv1_alpha0') sig = `band ${s.band ? 'on' : 'off'} rating ${r.rating} bandMult ${g.bandMult} heldBy ${g.heldBy} blend ${g.blend}`;
    else if (/inv2_(mislabel|nearest)/.test(e.kind)) sig = `${s.model} ${r.via} est ${r.est} ${r.basis || ''}`;
    else if (e.kind === 'inv3_loading_idle') sig = `${s.model}/${s.layer} ${zb(s.zoom)} band ${s.band ? 'on' : 'off'} res ${r.via} rating ${r.rating}`;
    else if (/inv4/.test(e.kind)) sig = `${o.view} dom ${e.bandDom} flag ${e.bandFlag}`;
    else sig = `${s.model}/${s.layer} ${zb(s.zoom)}`;
    cl(e.kind, sig, { seed: o.seed, view: o.view, action: e.action, before: e.action != null ? before(e.action) : null, t: e.t, frames: e.frames, durMs: e.durMs, sinceAction: e.sinceAction,
      fault: e.fault, sel: s, res: r, status: e.status, hidden: e.hidden, gpu: g, offH: e.offH, extra: { bandDom: e.bandDom, bandFlag: e.bandFlag, sinceOff: e.sinceOff, loadingMs: e.loadingMs, resRun: e.resRun, baseRun: e.baseRun } });
  }
  if (o.firstPaintMs === null) { add('inv1_boot_no_first_paint'); cl('inv1_boot_no_first_paint', `${o.model0}/${o.layer0} @${o.start.place}`, { seed: o.seed, view: o.view, diag: o.firstPaintMiss }); }
  for (const a of o.actions) {
    if (a.outcome === 'missed') {
      const k = `inv3_never_exact_${a.missClass}`; add(k);
      const ms = a.missState || {}; const r = ms.res || {};
      cl(k, `${a.type} ${a.sel.model}/${a.sel.layer} ${zb(a.sel.zoom)} res ${r.has ? `${r.model}/${r.layer} ${r.store ? 'store' : r.series ? 'series' : 'grid'} rating ${r.rating}` : 'none'}`,
        { seed: o.seed, view: o.view, action: a.i, before: before(a.i), sel: a.sel, expected: a.expected, res: r, status: ms.status, inflight: ms.inflight, pending: ms.pending, backendSlow: o.backendSlow, drop: ms.diag && ms.diag.drop, heatmap: ms.diag && ms.diag.heatmap });
    }
    if (a.type === 'band' && a.sel && a.sel.layer && a.sel.band === true && a.arm && a.arm.bandMs == null && a.settled) { add('inv4_band_on_nothing_shown'); cl('inv4_band_on_nothing_shown', `${a.sel.model} ${zb(a.sel.zoom)}`, { seed: o.seed, view: o.view, action: a.i, sel: a.sel }); }
    for (const v of (a.infobox && a.infobox.violations) || []) { add(v); cl(v, `${a.sel ? a.sel.model + '/' + a.sel.layer : ''}`, { seed: o.seed, view: o.view, action: a.i, ib: a.infobox }); }
    if (a.settled && a.arm && a.arm.exactMs != null && !o.backendSlow) {
      (timing[a.type] = timing[a.type] || []).push(a.arm.exactMs);
      if (a.arm.exactMs > 500) (over500[a.type] = over500[a.type] || []).push({ seed: o.seed, i: a.i, ms: a.arm.exactMs, via: a.arm.via, sel: a.sel });
    }
  }
  if ((o.consoleAppErrors || []).length) { add('inv7_console_error', o.consoleAppErrors.length); for (const c of o.consoleAppErrors) cl('inv7_console_error', c.text.replace(/\d+/g, 'N').slice(0, 110), { seed: o.seed, t: c.t, text: c.text.slice(0, 300) }); }
  for (const e of o.pageErrors || []) { add('inv7_page_error'); cl('inv7_page_error', e.text.split('\n')[0].slice(0, 110), { seed: o.seed, t: e.t, text: e.text.slice(0, 500) }); }
  for (const e of o.rejections || []) { add('inv7_unhandled_rejection'); cl('inv7_unhandled_rejection', e.r.split('\n')[0].slice(0, 110), { seed: o.seed, t: e.t, r: e.r }); }
  for (const r of o.repeats || []) { const k = r.faulted ? 'inv7_repeated_ask_under_fault' : 'inv7_repeated_ask'; add(k); cl(k, r.key.replace(/valid_time=[^&]+/, 'valid_time=T').replace(/bbox=[^&]+/, 'bbox=B').slice(0, 120), { seed: o.seed, n: r.n, burst: r.burst, key: r.key, statuses: r.statuses, ts: r.ts.slice(0, 8) }); }
  for (const [h, n] of Object.entries(o.hosts || {})) hosts[h] = (hosts[h] || 0) + n;
  for (const [h, n] of Object.entries(o.aborted || {})) aborted[h] = (aborted[h] || 0) + n;
  ws += (o.blockedWs || []).length;
  const ls = o.longTaskSummary || {}; long.n += ls.n || 0; long.over200 += ls.over200 || 0; long.max = Math.max(long.max, ls.max || 0);
  for (const r of judgeRun(o)) { pixel[r.verdict] = (pixel[r.verdict] || 0) + 1; if (/mismatch|nothing|off_small/.test(r.verdict)) pixelBad.push({ seed: o.seed, ...r }); }
}
const T = Object.fromEntries(Object.entries(timing).map(([k, v]) => [k, { n: v.length, p50: pct(v, 0.5), p95: pct(v, 0.95), over500: (over500[k] || []).length }]));
const C = Object.values(clusters).map((c) => ({ ...c, seeds: [...c.seeds] })).sort((a, b) => b.seeds.length - a.seeds.length || b.n - a.n);
const out = { totals: tot, violations: viol, transient, timing: T, longTasks: long, hosts, aborted, blockedWebSockets: ws, pixel, pixelBad: pixelBad.slice(0, 50), clusters: C, over500 };
console.log(JSON.stringify({ totals: tot, violations: viol, transient, timing: T, longTasks: long, hosts, blockedWebSockets: ws, pixel }, null, 1));
console.log('\nCLUSTERS (kind | signature: instances in seeds)');
for (const c of C) console.log(`${c.n} in ${c.seeds.length} seeds [${c.seeds.slice(0, 10).join(',')}]  ${c.kind} | ${c.sig}`);
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
