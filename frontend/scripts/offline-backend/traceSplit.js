// Split a Chromium trace into per-step phases (2026-11-18; part B of log 2026-11-18-opus-phone-trace-and-box-check.md).
// Steps are delimited by user-timing marks `rc-step-<i>` (performance.mark at each key); a step's window runs to the next mark or
// the end mark `rc-step-end`. Per window: the renderer main thread's busy ms (top-level tasks), script (top-level script entries),
// style + layout, paint + composite, and the GPU process main thread's busy ms. React's own render ms comes from the census hook.
const SCRIPT = new Set(['FunctionCall', 'EventDispatch', 'TimerFire', 'FireAnimationFrame', 'RunMicrotasks', 'EvaluateScript', 'v8.callFunction']);
const LAYOUT = new Set(['UpdateLayoutTree', 'Layout', 'RecalculateStyles', 'ParseAuthorStyleSheet']);
const PAINT = new Set(['PrePaint', 'Paint', 'Layerize', 'Commit', 'CompositeLayers', 'UpdateLayer', 'PaintImage']);
const TASK = new Set(['RunTask', 'ThreadControllerImpl::RunTask']);

function threadIds(events) {
  const names = {};
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') names[`${e.pid}:${e.tid}`] = e.args && e.args.name;
  const pick = (re) => Object.keys(names).filter((k) => re.test(names[k] || ''));
  return { main: new Set(pick(/^CrRendererMain$/)), gpu: new Set(pick(/^CrGpuMain$/)) };
}

// Sum of durations of events named in `set` that are not nested inside another such event on the same thread.
function topLevelSum(evs, set, lo, hi) {
  const xs = evs.filter((e) => set.has(e.name) && e.ph === 'X' && e.ts < hi && e.ts + (e.dur || 0) > lo).sort((a, b) => a.ts - b.ts);
  let sum = 0; let end = -Infinity;
  for (const e of xs) {
    const s = Math.max(e.ts, lo); const f = Math.min(e.ts + (e.dur || 0), hi);
    if (s >= end) { sum += Math.max(0, f - s); end = f; } else if (f > end) { sum += f - end; end = f; }
  }
  return sum / 1000;   // us -> ms
}

function splitTrace(traceJson, steps) {
  const events = Array.isArray(traceJson) ? traceJson : traceJson.traceEvents;
  const { main, gpu } = threadIds(events);
  const marks = {};
  for (const e of events) if (typeof e.name === 'string' && /^rc-step-/.test(e.name) && (e.ph === 'R' || e.ph === 'I' || e.ph === 'n' || e.ph === 'b' || e.ph === 'X')) {
    if (!(e.name in marks)) marks[e.name] = e.ts;
  }
  const mainEv = events.filter((e) => main.has(`${e.pid}:${e.tid}`));
  const gpuEv = events.filter((e) => gpu.has(`${e.pid}:${e.tid}`));
  const out = [];
  for (let i = 0; i < steps; i += 1) {
    const lo = marks[`rc-step-${i}`]; const hi = marks[`rc-step-${i + 1}`] || marks['rc-step-end'];
    if (!(lo > 0) || !(hi > lo)) { out.push(null); continue; }
    out.push({
      windowMs: +((hi - lo) / 1000).toFixed(1),
      busyMs: +topLevelSum(mainEv, TASK, lo, hi).toFixed(1),
      scriptMs: +topLevelSum(mainEv, SCRIPT, lo, hi).toFixed(1),
      layoutMs: +topLevelSum(mainEv, LAYOUT, lo, hi).toFixed(1),
      paintMs: +topLevelSum(mainEv, PAINT, lo, hi).toFixed(1),
      gpuMs: +topLevelSum(gpuEv, TASK, lo, hi).toFixed(1),
    });
  }
  return { threads: { main: main.size, gpu: gpu.size }, marks: Object.keys(marks).length, steps: out };
}

module.exports = { splitTrace, topLevelSum };
