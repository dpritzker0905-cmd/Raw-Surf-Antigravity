// STALL PROFILE — who owns the main-thread stalls in a lab trace (2026-10-20).
//
// Input: the trace.json lab.js writes with LAB_TRACE=1 (it includes V8 CPU samples and GC events) and the build directory
// the lab served (its source maps turn minified positions back into original files and function names).
// Method: every main-thread task (RunTask) longer than STALL_MS is a stall. Every CPU sample inside a stall is attributed
//   1. to its LEAF when the leaf is a browser native that names the work (texImage2D, getImageData, JSON.parse, GC...),
//   2. else to the nearest frame (leaf upward) that maps to an original source file, bucketed by STAGES below.
// Samples are ~sampling-interval apart, so "ms" = samples x interval: an estimate, reported with the sample count.
// Output: per-stage ms and share of stall time, top original functions, the worst stalls with their top stages, GC events.
//
//   node frontend/scripts/visual-lab/stall_profile.js <trace.json> <build dir> [STALL_MS=50]
const fs = require('fs');
const path = require('path');
const { SourceMapConsumer } = require('source-map');

const [tracePath, buildDir, stallArg] = process.argv.slice(2);
const STALL_US = (+(stallArg || 50)) * 1000;

// First match wins. Leaf natives first, then original source paths (webpack:// paths from the source maps).
const NATIVE = [
  ['upload (texImage/texSubImage/bufferData)', /^(texImage2D|texSubImage2D|texImage3D|texSubImage3D|texStorage2D|texStorage3D|bufferData|bufferSubData|generateMipmap)$/],
  ['land mask raster (canvas getImageData/drawImage/fill)', /^(getImageData|putImageData|drawImage|fill|stroke|fillRect|createImageData|clearRect)$/],
  ['JSON parse', /^(parse|JSON\.parse|json)$/],
  ['GC', /^\(garbage collector\)$/],
  ['WebGL draw/state', /^(drawArrays|drawElements|uniform\w+|bindTexture|useProgram|readPixels|vertexAttribPointer|bindBuffer|enableVertexAttribArray|activeTexture|getUniformLocation|texParameteri|pixelStorei|getError|finish|flush)$/],
];
const STAGES = [
  // Tested against "<original source>:<function name>"; first match wins, from the leaf-most mapped frame upward.
  ['shader compile (createProgram / MapLibre program)', /createProgram|compileShader|linkProgram|webgl\/program\.ts/],
  ['GPU sync: GL state capture (getParameter)', /WebGLStateIsolation/],
  ['land mask build', /Mask|mask|inlandWater|[Ss]helter|coastBuffer/],
  ['convert grid -> texture', /WebGLMarineTextureEncoder|TextureEncoder|marineGridSeries|GridSeries|gridDecode|normalizeGrid|marineGridShape|vectorBudget|SimulationFieldBuilder/],
  ['fetch / manifest glue', /backendWeatherServiceClient|useMarineDataFetcher|marineFetch|fetchBackend|apiClient|openMeteoProtocol/],
  ['marine orchestration / commit', /useMarineOrchestrator|marineCommitArbiter|marineTransitionCoordinator|MarineTransition|marineRenderParity|enqueueMarineUpdate|weatherTruthTracker/],
  ['marine engine draw', /WebGLMarineEngine|WebGLMarineLayer|WebGLMarineShaders|WebGLMarineTextureState|crest|Crest|waveSet/],
  ['wind engine', /[Ww]ind/],
  ['React render/commit', /react-dom|scheduler\/|react-reconciler/],
  ['MapLibre (tiles, style, draw)', /maplibre/],
  ['other app code', /^(?!.*node_modules)/],
  ['other library', /node_modules/],
];

function classify(stack, srcOf) {
  const leaf = stack[0];
  for (const [name, re] of NATIVE) if (re.test(leaf.callFrame.functionName) && !leaf.callFrame.url) return { stage: name, where: leaf.callFrame.functionName };
  if (leaf.callFrame.functionName === '(program)') return { stage: 'browser/native (program)', where: '(program)' };
  if (leaf.callFrame.functionName === '(idle)') return { stage: 'idle', where: '(idle)' };
  for (const node of stack) {
    const s = srcOf(node.callFrame);
    if (!s) continue;
    const tag = `${s.source}:${s.name || node.callFrame.functionName || ''}`;
    for (const [name, re] of STAGES) if (re.test(tag)) return { stage: name, where: `${s.source.replace(/^webpack:\/\/[^/]*\//, '')}:${s.name || node.callFrame.functionName || '?'}` };
  }
  const f = leaf.callFrame;
  return { stage: 'unmapped', where: `${f.functionName || '(anon)'} ${f.url ? path.basename(f.url) : ''}` };
}

(async () => {
  const events = JSON.parse(fs.readFileSync(tracePath, 'utf8')).traceEvents;
  // The renderer main thread: the CrRendererMain thread that carries the most CPU-profile samples.
  const names = new Map();
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args.name);
  const profiles = new Map();   // id -> {key, startTime, nodes: Map, samples: [], times: []}
  for (const e of events) {
    if (e.name === 'Profile' && e.args && e.args.data) profiles.set(e.id, { key: `${e.pid}:${e.tid}`, t: e.args.data.startTime, nodes: new Map(), samples: [], times: [] });
    if (e.name === 'ProfileChunk' && e.args && e.args.data) {
      const p = profiles.get(e.id); if (!p) continue;
      const d = e.args.data; const cp = d.cpuProfile || {};
      for (const n of cp.nodes || []) p.nodes.set(n.id, n);
      const deltas = d.timeDeltas || [];
      (cp.samples || []).forEach((s, i) => { p.t += deltas[i] || 0; p.samples.push(s); p.times.push(p.t); });
    }
  }
  let main = [...profiles.values()].filter((p) => names.get(p.key) === 'CrRendererMain').sort((a, b) => b.samples.length - a.samples.length)[0];
  // Fallback: the CDP Profiler profile lab.js writes next to the trace (Chrome drops the tracing cpu_profiler category in
  // this mode). Its startTime/timeDeltas share the trace clock (base::TimeTicks, microseconds). Main thread = the
  // CrRendererMain thread with the most long RunTask events.
  const profFile = path.join(path.dirname(tracePath), 'profile.json');
  if (!main && fs.existsSync(profFile)) {
    const pr = JSON.parse(fs.readFileSync(profFile, 'utf8'));
    const counts = new Map();
    for (const e of events) if (e.ph === 'X' && e.name === 'RunTask' && e.dur >= STALL_US && names.get(`${e.pid}:${e.tid}`) === 'CrRendererMain') counts.set(`${e.pid}:${e.tid}`, (counts.get(`${e.pid}:${e.tid}`) || 0) + 1);
    const key = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    main = { key: key ? key[0] : '0:0', nodes: new Map(), samples: pr.samples, times: [], fromProfile: true };
    for (const n of pr.nodes) main.nodes.set(n.id, n);
    let t = pr.startTime; pr.timeDeltas.forEach((d) => { t += d; main.times.push(t); });
  }
  if (!main) throw new Error('no CPU profile in the trace and no profile.json next to it');
  const interval = (main.times[main.times.length - 1] - main.times[0]) / Math.max(1, main.times.length - 1);
  // Each sample stands for the time until the next one (capped at 4x the mean, so a pause in sampling is not billed).
  const w = main.times.map((t, i) => Math.min((main.times[i + 1] ?? t + interval) - t, 4 * interval));
  for (const n of main.nodes.values()) if (n.parent != null && main.nodes.get(n.parent)) (main.nodes.get(n.parent).children ||= []);
  const parentOf = new Map(); for (const n of main.nodes.values()) for (const c of n.children || []) parentOf.set(c, n.id);
  for (const n of main.nodes.values()) if (n.parent != null) parentOf.set(n.id, n.parent);
  const stackOf = (id) => { const out = []; let cur = id; while (cur != null && main.nodes.has(cur)) { out.push(main.nodes.get(cur)); cur = parentOf.get(cur); } return out; };

  // Source maps for every script URL in the build.
  const consumers = new Map();
  const srcOf = (cf) => {
    if (!cf.url || !/\/static\/js\//.test(cf.url)) return null;
    const file = path.join(buildDir, 'static', 'js', path.basename(new URL(cf.url).pathname));
    const c = consumers.get(file);
    if (!c) return null;
    const pos = c.originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber });
    return pos && pos.source ? { source: pos.source, name: pos.name, line: pos.line } : null;
  };
  const urls = new Set(); for (const n of main.nodes.values()) if (n.callFrame.url) urls.add(n.callFrame.url);
  for (const u of urls) {
    if (!/\/static\/js\//.test(u)) continue;
    const file = path.join(buildDir, 'static', 'js', path.basename(new URL(u).pathname));
    if (fs.existsSync(file + '.map') && !consumers.has(file)) consumers.set(file, await new SourceMapConsumer(JSON.parse(fs.readFileSync(file + '.map', 'utf8'))));
  }

  const [mpid, mtid] = main.key.split(':').map(Number);
  // Stalls: with a CDP profile, unbroken stretches of NON-idle main-thread samples >= STALL_MS (what the user sees as a
  // frozen frame; back-to-back tasks with no idle between them count as one stretch). The trace's RunTask events are
  // used only when the CPU samples came from the trace itself.
  let tasks;
  if (main.fromProfile) {
    tasks = []; let start = null, last = null;
    const idleAt = (i) => (main.nodes.get(main.samples[i]) || { callFrame: {} }).callFrame.functionName === '(idle)';
    for (let i = 0; i <= main.times.length; i++) {
      const busy = i < main.times.length && !idleAt(i);
      if (busy && start == null) start = main.times[i];
      if (busy) last = main.times[i];
      if (!busy && start != null) { const dur = last - start + interval; if (dur >= STALL_US) tasks.push({ ts: start, dur }); start = null; }
    }
  } else {
    tasks = events.filter((e) => e.ph === 'X' && e.pid === mpid && e.tid === mtid && (e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask') && e.dur >= STALL_US)
      .sort((a, b) => a.ts - b.ts);
  }
  const gcs = events.filter((e) => e.ph === 'X' && e.pid === mpid && e.tid === mtid && /^(MinorGC|MajorGC|V8\.GCScavenger|V8\.GCFinalizeMC|V8\.GC_MARK_COMPACTOR)$/.test(e.name));
  const t0 = main.times[0];
  // Step markers (LABSTEP_<n>_<label>): the first sample whose stack holds one marks that step's start.
  const steps = [];
  for (let i = 0; i < main.samples.length; i++) {
    const m = stackOf(main.samples[i]).map((n) => n.callFrame.functionName).find((f) => /^LABSTEP_/.test(f));
    if (m && !steps.find((s) => s.name === m)) steps.push({ name: m, t: main.times[i] });
  }
  const stepAt = (t) => { let cur = steps.length ? 'before first step (load + setup)' : '-'; for (const s of steps) if (s.t <= t) cur = s.name.replace(/^LABSTEP_/, ''); return cur; };
  const lineOf = (stack) => { for (const node of stack) { const s = srcOf(node.callFrame); if (s && !/node_modules|webpack\/(bootstrap|runtime)/.test(s.source)) { return { key: `${s.source.replace(/^webpack:\/\/[^/]*\//, '')}:${s.line}`, source: s.source, line: s.line }; } } return null; };
  const lines = new Map(); const byStep = new Map(); const stageByStep = new Map();
  const stage = new Map(); const fn = new Map(); const perStall = [];
  let si = 0;
  for (const task of tasks) {
    const local = new Map();
    while (si < main.times.length && main.times[si] < task.ts) si++;
    let j = si;
    for (; j < main.times.length && main.times[j] <= task.ts + task.dur; j++) {
      const stack = stackOf(main.samples[j]); const wt = w[j];
      const { stage: st, where } = classify(stack, srcOf);
      stage.set(st, (stage.get(st) || 0) + wt); local.set(st, (local.get(st) || 0) + wt);
      { const sk = stepAt(task.ts); const m = stageByStep.get(sk) || new Map(); m.set(st, (m.get(st) || 0) + wt); stageByStep.set(sk, m); }
      const k = `${st} | ${where}`; fn.set(k, (fn.get(k) || 0) + wt);
      const ln = lineOf(stack); if (ln) { const e = lines.get(ln.key) || { ...ln, us: 0 }; e.us += wt; lines.set(ln.key, e); }
    }
    const gcMs = gcs.filter((g) => g.ts >= task.ts && g.ts <= task.ts + task.dur).reduce((a, g) => a + g.dur, 0) / 1000;
    const step = stepAt(task.ts);
    const bs = byStep.get(step) || { stalls: 0, ms: 0, maxMs: 0 }; bs.stalls++; bs.ms += task.dur / 1000; bs.maxMs = Math.max(bs.maxMs, task.dur / 1000); byStep.set(step, bs);
    perStall.push({ atS: +((task.ts - t0) / 1e6).toFixed(2), step, ms: Math.round(task.dur / 1000), samples: j - si, gcMs: +gcMs.toFixed(1),
      top: [...local.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ${Math.round(n / 1000)}ms`) });
  }
  const totalStallMs = tasks.reduce((a, t) => a + t.dur, 0) / 1000;
  const totalSamples = [...stage.values()].reduce((a, b) => a + b, 0);
  const ms = (n) => Math.round(n / 1000);
  // Source text of the hottest original lines (sourcesContent of the maps), so upload/readPixels/draw lines are visible.
  const textOf = (source, line) => { for (const c of consumers.values()) { const t = c.sourceContentFor(source, true); if (t) return (t.split(String.fromCharCode(10))[line - 1] || '').trim().slice(0, 140); } return ''; };
  const report = {
    trace: path.basename(tracePath), stallThresholdMs: STALL_US / 1000, samplingIntervalUs: Math.round(interval),
    stalls: tasks.length, stallMsTotal: Math.round(totalStallMs), stallMsMax: tasks.length ? Math.round(Math.max(...tasks.map((t) => t.dur)) / 1000) : 0,
    stallMsP50: tasks.length ? Math.round([...tasks].map((t) => t.dur).sort((a, b) => a - b)[Math.floor(tasks.length / 2)] / 1000) : 0,
    gcEventMsInStalls: +perStall.reduce((a, s) => a + s.gcMs, 0).toFixed(1),
    sampledMsInStalls: ms(totalSamples),
    byStage: [...stage.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ stage: k, ms: ms(n), share: +(n / totalSamples * 100).toFixed(1) })),
    byStep: [...byStep.entries()].map(([k, v]) => ({ step: k, stalls: v.stalls, ms: Math.round(v.ms), maxMs: Math.round(v.maxMs) })),
    stageByStep: Object.fromEntries([...stageByStep.entries()].map(([k, m]) => [k, Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]).map(([st, us]) => [st, ms(us)]))])),
    hotLines: [...lines.values()].sort((a, b) => b.us - a.us).slice(0, 30).map((e) => ({ at: e.key, ms: ms(e.us), code: textOf(e.source, e.line) })),
    topFunctions: [...fn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, n]) => ({ fn: k, ms: ms(n) })),
    worstStalls: [...perStall].sort((a, b) => b.ms - a.ms).slice(0, 12),
  };
  console.log(JSON.stringify(report, null, 1));
  for (const c of consumers.values()) c.destroy && c.destroy();
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });
