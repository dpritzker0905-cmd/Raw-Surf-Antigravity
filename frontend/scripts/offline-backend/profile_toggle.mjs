// Where does the wind toggle's time go? (2026-10-24, PR C.) Reads a .cpuprofile written by scn_wind_toggle.js PROFILE=1, keeps the
// samples of the first WINDOW_MS after the profile started (the click), maps every frame through the build's source maps and prints
// the self time and the inclusive time per original source function.
//   node profile_toggle.mjs <profile.cpuprofile> <build dir (the served bundle: static/js/*.map)> [WINDOW_MS=400]
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { SourceMapConsumer } = require(process.env.SOURCE_MAP_LIB || 'source-map');
const [profFile, buildDir, winArg] = process.argv.slice(2);
const WINDOW_MS = +(winArg || 400);
const prof = JSON.parse(fs.readFileSync(profFile, 'utf8'));
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);

const consumers = new Map();
async function consumerFor(url) {
  const file = (url.split('/static/js/')[1] || '').split('?')[0];
  if (!file) return null;
  if (!consumers.has(file)) {
    const p = path.join(buildDir, 'static', 'js', file + '.map');
    consumers.set(file, fs.existsSync(p) ? await new SourceMapConsumer(JSON.parse(fs.readFileSync(p, 'utf8'))) : null);
  }
  return consumers.get(file);
}
async function label(node) {
  const cf = node.callFrame;
  if (!cf.url) return cf.functionName || `(${cf.functionName || 'native'})`;
  const c = await consumerFor(cf.url);
  if (!c) return `${cf.functionName || '(anon)'} @ ${cf.url.split('/').pop()}`;
  const o = c.originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber });
  if (!o.source) return `${cf.functionName || '(anon)'} @ ${cf.url.split('/').pop()}`;
  const src = o.source.replace(/^.*?\/src\//, 'src/').replace(/^.*node_modules\//, 'nm/');
  return `${o.name || cf.functionName || '(anon)'} @ ${src}:${o.line}`;
}

// sample i is at time sum(timeDeltas[0..i]) after startTime. The window starts at the click: the first sample whose stack holds
// scn_wind_toggle.js's __wt_click_marker (else at the profile's start).
const times = []; { let acc = 0; for (const d of prof.timeDeltas) times.push((acc += d) / 1000); }
const inStack = (id, name) => { const seen = new Set(); for (let cur = id; cur != null && !seen.has(cur); cur = parent.get(cur)) { seen.add(cur); if (byId.get(cur).callFrame.functionName === name) return true; } return false; };
const markIdx = prof.samples.findIndex((id) => inStack(id, '__wt_click_marker'));
const t0 = markIdx >= 0 ? times[markIdx] : 0;
console.log(markIdx >= 0 ? `click mark at +${t0.toFixed(0)} ms into the profile` : 'no click mark: window from the profile start');
// UNTIL=<function name>: end the window at the first sample (after the click) whose stack holds that function, e.g.
// UNTIL=setWindData for the part of the click's task that runs before the wind data reaches the engine.
let untilIdx = Infinity;
if (process.env.UNTIL) {
  for (let i = Math.max(0, markIdx); i < prof.samples.length; i++) {
    if (await (async () => { for (let cur = prof.samples[i], n = 0; cur != null && n < 400; cur = parent.get(cur), n++) {
      if ((await label(byId.get(cur))).split(' @ ')[0].endsWith(process.env.UNTIL)) return true; } return false; })()) { untilIdx = i; break; }
  }
  console.log(untilIdx === Infinity ? `UNTIL ${process.env.UNTIL}: not reached in the profile` : `UNTIL ${process.env.UNTIL} at +${(times[untilIdx] - (markIdx >= 0 ? times[markIdx] : 0)).toFixed(0)} ms`);
}
const self = new Map(); const incl = new Map();
for (let i = Math.max(0, markIdx); i < prof.samples.length; i++) {
  const t = times[i] - t0;
  if (t > WINDOW_MS || i >= untilIdx) break;
  const dt = ((prof.timeDeltas[i + 1] || 0) / 1000) || 0.25;
  const id = prof.samples[i];
  self.set(id, (self.get(id) || 0) + dt);
  const seen = new Set();
  for (let cur = id; cur != null; cur = parent.get(cur)) { if (seen.has(cur)) break; seen.add(cur); incl.set(cur, (incl.get(cur) || 0) + dt); }
}
const agg = async (m) => {
  const out = new Map();
  for (const [id, ms] of m) { const k = await label(byId.get(id)); out.set(k, (out.get(k) || 0) + ms); }
  return [...out.entries()].sort((a, b) => b[1] - a[1]);
};
const selfRows = await agg(self); const inclRows = await agg(incl);
const total = [...self.values()].reduce((a, b) => a + b, 0);
console.log(`window ${WINDOW_MS} ms, sampled ${total.toFixed(0)} ms`);
console.log('--- self time (ms)');
for (const [k, ms] of selfRows.slice(0, 25)) console.log(ms.toFixed(1).padStart(7), k);
console.log('--- inclusive time (ms), app sources only');
for (const [k, ms] of inclRows.filter(([k]) => k.includes('src/')).slice(0, 30)) console.log(ms.toFixed(1).padStart(7), k);

// OWNERS=1: each sample's time charged to its nearest owning React component or hook (the closest app frame named like
// `Component` or `useThing`), the "which state update / component costs what" view; idle and (program) are left out.
if (process.env.OWNERS) {
  const owners = new Map(); let charged = 0;
  for (const [id, ms] of self) {
    const leaf = await label(byId.get(id));
    if (leaf.startsWith('(idle)') || leaf.startsWith('(program)') || leaf.startsWith('(garbage')) continue;
    // The OUTERMOST app frame on the stack: the entry React, the scheduler or MapLibre called into (an effect body, a render,
    // an event handler, an rAF callback), named by its file and line. Stacks with no app frame are MapLibre / React / browser.
    let owner = '(no app frame: maplibre / react / browser)';
    for (let cur = id; cur != null; cur = parent.get(cur)) {
      const l = await label(byId.get(cur));
      if (l.includes(' @ ') && !l.includes(' @ nm/') && !l.includes(' @ src/')) owner = l;
    }
    owners.set(owner, (owners.get(owner) || 0) + ms); charged += ms;
  }
  console.log(`--- owners (self time charged to the nearest component / hook; ${charged.toFixed(0)} ms of CPU)`);
  for (const [k, ms] of [...owners.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(ms.toFixed(1).padStart(7), k);
}

// TIMELINE=1: the window in 4 ms slices, each named by the app frame (outermost first, 2 deep) most of its samples sat in;
// runs of the same name collapse to one line. Idle and (program) slices show where the toggle waits on a frame or a timer.
if (process.env.TIMELINE) {
  const SLICE = 4, rows = [];
  const appChain = async (id) => {
    const chain = [];
    for (let cur = id; cur != null; cur = parent.get(cur)) {
      const l = await label(byId.get(cur));
      if (l.includes(' @ ') && !l.includes(' @ nm/') && !l.includes(' @ src/')) chain.unshift(l.replace(/ @ components\/map\//, ' @ '));
    }
    if (chain.length) return chain.slice(0, 2).join(' > ');
    return (await label(byId.get(id))).startsWith('(') ? (await label(byId.get(id))) : 'maplibre/react';
  };
  for (let i = Math.max(0, markIdx), s = 0; i < prof.samples.length; i++) {
    const t = times[i] - t0;
    if (t > WINDOW_MS) break;
    const k = Math.floor(t / SLICE);
    (rows[k] = rows[k] || new Map());
    const name = await appChain(prof.samples[i]);
    rows[k].set(name, (rows[k].get(name) || 0) + 1);
    s += 1;
  }
  console.log('--- timeline (ms from the click: dominant frame)');
  let prev = null, from = 0;
  const flush = (to) => { if (prev !== null) console.log(`${String(from).padStart(4)}-${String(to).padEnd(4)} ${prev}`); };
  for (let k = 0; k < rows.length; k++) {
    const m = rows[k]; const top = m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : '(no samples)';
    if (top !== prev) { flush(k * SLICE); prev = top; from = k * SLICE; }
  }
  flush(rows.length * SLICE);
}

// CALLERS=<name>: who calls it, by inclusive time — each node whose label starts with <name>, with its 6 nearest app callers.
if (process.env.CALLERS) {
  const stacks = new Map();
  for (const [id, ms] of incl) {
    if (!(await label(byId.get(id))).startsWith(process.env.CALLERS)) continue;
    const chain = [];
    for (let cur = parent.get(id); cur != null && chain.length < 6; cur = parent.get(cur)) {
      const l = await label(byId.get(cur));
      if (l.includes(' @ ') && !l.includes(' @ nm/')) chain.push(l);   // app and MapLibre frames; React/node_modules glue left out
    }
    const k = chain.join('  <-  ');
    stacks.set(k, (stacks.get(k) || 0) + ms);
  }
  console.log(`--- callers of ${process.env.CALLERS}`);
  for (const [k, ms] of [...stacks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(ms.toFixed(1).padStart(7), k);
}
