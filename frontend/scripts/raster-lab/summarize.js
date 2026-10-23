// Summarize raster-lab JSONL into per-layer rollups per arm and per-combo rows (markdown + JSON).
//   node summarize.js <results.jsonl>... [--md out.md] [--json out.json] [--timeout 20000]
// Per combo: toggle first/full ms; single FRAME-CHANGING steps p50/p95/max of ms to fully drawn (a step that never got there
// counts as the timeout; a step whose hour maps to the same frame as the step before, e.g. EURO's 3-hourly axis, is counted
// apart); the long jump; frames shown STALE (another hour under the new label), BLANK, MIXED (two hours lit at once) and with
// a per-tile FADE-in, summed over the steps and the jump; the revisit (back to hour 0) and the reload toggle when measured;
// requests and bytes per toggle and the step median. The contract: step p50 <= 50 / p95 <= 100 ms, stale/blank/mixed 0.
const fs = require('fs');
const args = process.argv.slice(2);
const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const TIMEOUT = +opt('--timeout', 20000);

const rows = [];
for (const f of files) for (const line of fs.readFileSync(f, 'utf8').split('\n')) { if (line.trim()) rows.push(JSON.parse(line)); }

const q = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const med = (arr) => q(arr, 0.5);
const fmtMs = (v) => (v == null ? '-' : v >= 10000 ? `${(v / 1000).toFixed(0)} s` : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)}`);
const fmtB = (v) => (v == null ? '-' : v >= 1e6 ? `${(v / 1e6).toFixed(2)} MB` : v >= 1e3 ? `${Math.round(v / 1e3)} KB` : `${v} B`);
const ORDER = ['rain', 'radar', 'satellite', 'pressure', 'temperature', 'water_temp', 'fog'];

function combo(r) {
  const acts = r.actions || [];
  const tg = acts.find((a) => a.kind === 'toggle') || {};
  // A radar step past the end of its axis (the wheel did not move) is not a step.
  const steps = acts.filter((a) => a.kind === 'step' && a.target != null
    && !(r.layer === 'radar' && a.ids && a.ids.length === 1 && a.msFull == null && a.blank === 0 && a.partial === 0));
  let lj = acts.find((a) => a.kind === 'long') || {};
  // Radar's long jump goes to the last frame; when the steps already ended there it moves nothing: not a jump.
  if (r.layer === 'radar' && lj.kind && lj.msFull == null && lj.ids && lj.ids.length === 1 && !lj.blank && !lj.partial) lj = {};
  const back = acts.find((a) => a.kind === 'back') || null;
  const rel = acts.find((a) => a.kind === 'reload_toggle') || null;
  const prevExp = (a) => { const i = acts.indexOf(a); return i > 0 ? acts[i - 1].exp : null; };
  const sameFrame = steps.filter((a) => r.layer !== 'radar' && a.exp && a.exp === prevExp(a));
  const changing = steps.filter((a) => !sameFrame.includes(a));
  const stepMs = changing.map((a) => (a.msFull == null ? TIMEOUT : a.msFull));
  const sum = (arr, k) => arr.reduce((s, a) => s + (a[k] || 0), 0);
  const moved = [...changing, lj, ...(back ? [back] : [])].filter((a) => a && a.kind);
  const all = [tg, ...moved].filter((a) => a && a.kind);
  return {
    arm: r.arm || r.tag, vp: r.vp, layer: r.layer, model: r.model, zoom: r.zoom, error: r.error || null,
    toggleFirst: tg.msFirst, toggleFull: tg.msFull, toggleTimedOut: !!tg.timedOut, toggleReq: tg.req, toggleBytes: tg.bytes,
    steps: changing.length, sameFrameSteps: sameFrame.length, stepList: stepMs,
    stepP50: q(stepMs, 0.5), stepP95: q(stepMs, 0.95), stepMax: stepMs.length ? Math.max(...stepMs) : null,
    stepsInstant: stepMs.filter((v) => v <= 100).length, stepsTimedOut: changing.filter((a) => a.msFull == null).length,
    longMs: lj.msFull, longTimedOut: !!lj.timedOut, backMs: back ? back.msFull : null, reloadToggleMs: rel ? rel.msFull : null,
    staleFrames: sum(moved, 'stale'), blankFrames: sum(moved, 'blank'), partialFrames: sum(moved, 'partial'),
    staleAdmitted: sum(moved, 'staleAdmitted'), staleSilentLate: sum(moved, 'staleSilentLate'),
    mixedFrames: sum(all, 'mixed'), fadingFrames: sum(all, 'fadingFrames'), decodeErrors: (r.decodeErrors || []).length,
    stepReqMed: med(changing.map((a) => a.req || 0)), stepBytesMed: med(changing.map((a) => a.bytes || 0)),
  };
}

const out = rows.map(combo);
out.sort((a, b) => a.vp.localeCompare(b.vp) || ORDER.indexOf(a.layer) - ORDER.indexOf(b.layer) || a.model.localeCompare(b.model) || a.zoom - b.zoom || a.arm.localeCompare(b.arm));

const roll = {};
for (const c of out) {
  const k = `${c.vp}|${c.layer}|${c.arm}`;
  const g = (roll[k] = roll[k] || { vp: c.vp, layer: c.layer, arm: c.arm, n: 0, toggle: [], steps: [], long: [], back: [], reload: [], stale: 0, admitted: 0, silentLate: 0, blank: 0, mixed: 0, fading: 0, decodeErrors: 0 });
  g.n += 1; g.toggle.push(c.toggleFull != null ? c.toggleFull : 30000); g.steps.push(...c.stepList);
  if (c.longMs != null) g.long.push(c.longMs);
  if (c.backMs != null) g.back.push(c.backMs);
  if (c.reloadToggleMs != null) g.reload.push(c.reloadToggleMs);
  g.stale += c.staleFrames; g.admitted += c.staleAdmitted; g.silentLate += c.staleSilentLate; g.blank += c.blankFrames; g.mixed += c.mixedFrames; g.fading += c.fadingFrames; g.decodeErrors += c.decodeErrors;
}
const rolls = Object.values(roll).sort((a, b) => a.vp.localeCompare(b.vp) || ORDER.indexOf(a.layer) - ORDER.indexOf(b.layer) || a.arm.localeCompare(b.arm));
let md2 = '| vp | layer | arm | combos | toggle p50 / max | step p50 / p95 | steps <=100 ms | long jump p50 | back to h0 p50 | reload toggle p50 | stale (admitted / silent > 350 ms) | blank | mixed | tile fades | decode errors |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
for (const g of rolls) {
  md2 += `| ${g.vp} | ${g.layer} | ${g.arm} | ${g.n} | ${fmtMs(med(g.toggle))} / ${fmtMs(Math.max(...g.toggle))} | ${fmtMs(q(g.steps, 0.5))} / ${fmtMs(q(g.steps, 0.95))} | `
    + `${g.steps.filter((v) => v <= 100).length}/${g.steps.length} | ${fmtMs(med(g.long))} | ${fmtMs(med(g.back))} | ${fmtMs(med(g.reload))} | ${g.stale} (${g.admitted} / ${g.silentLate}) | ${g.blank} | ${g.mixed} | ${g.fading} | ${g.decodeErrors} |\n`;
}
let md = '| vp | layer | model | z | arm | toggle first / full | step p50 / p95 / max (<=100 ms) | long | back | reload | stale | blank | mixed | toggle req / bytes | step req / bytes |\n';
md += '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
for (const c of out) {
  md += `| ${c.vp} | ${c.layer} | ${c.model} | ${c.zoom} | ${c.arm} | ${fmtMs(c.toggleFirst)} / ${fmtMs(c.toggleFull)}${c.toggleTimedOut ? ' (to)' : ''} | `
    + `${fmtMs(c.stepP50)} / ${fmtMs(c.stepP95)} / ${fmtMs(c.stepMax)} (${c.stepsInstant}/${c.steps}${c.stepsTimedOut ? `, ${c.stepsTimedOut} to` : ''}) | `
    + `${fmtMs(c.longMs)}${c.longTimedOut ? ' (to)' : ''} | ${fmtMs(c.backMs)} | ${fmtMs(c.reloadToggleMs)} | ${c.staleFrames} | ${c.blankFrames} | ${c.mixedFrames} | ${c.toggleReq} / ${fmtB(c.toggleBytes)} | ${c.stepReqMed} / ${fmtB(c.stepBytesMed)} |`
    + (c.error ? ` ERROR ${c.error.slice(0, 60)}` : '') + '\n';
}
const mdAll = `## Per layer and arm (all models and zooms)\n\n${md2}\n## Per combo\n\n${md}`;
if (opt('--md')) fs.writeFileSync(opt('--md'), mdAll);
if (opt('--json')) {
  fs.writeFileSync(opt('--json'), JSON.stringify({ combos: out.map(({ stepList, ...c }) => c), rollup: rolls.map((g) => ({ vp: g.vp, layer: g.layer, arm: g.arm, n: g.n,
    toggleP50: med(g.toggle), stepP50: q(g.steps, 0.5), stepP95: q(g.steps, 0.95), instant: g.steps.filter((v) => v <= 100).length, steps: g.steps.length,
    longP50: med(g.long), backP50: med(g.back), reloadP50: med(g.reload), stale: g.stale, staleAdmitted: g.admitted, staleSilentLate: g.silentLate, blank: g.blank, mixed: g.mixed, fading: g.fading, decodeErrors: g.decodeErrors })) }, null, 1));
}
console.log(mdAll);
