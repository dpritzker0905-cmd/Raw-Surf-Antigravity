// Resolve the first-visit probe's minified stacks to source files and lines, and print, per step, the timers that stood between
// the keydown and the fine grid's request. Reads <OUT>/probe.jsonl and the build's source maps.
//   node first_visit_probe_report.js <OUT> [<build dir, default ../../build>]
const fs = require('fs'); const path = require('path');
const { SourceMapConsumer } = require('source-map');

(async () => {
  const out = process.argv[2]; const build = process.argv[3] || path.join(__dirname, '../../build');
  if (!out) { console.log('usage: node first_visit_probe_report.js <OUT> [build]'); process.exit(2); }
  const rows = fs.readFileSync(path.join(out, 'probe.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const consumers = new Map();
  const consumer = async (file) => {
    if (!consumers.has(file)) { const m = path.join(build, 'static/js', file + '.map'); consumers.set(file, fs.existsSync(m) ? await new SourceMapConsumer(JSON.parse(fs.readFileSync(m, 'utf8'))) : null); }
    return consumers.get(file);
  };
  const resolve = async (frame) => {
    const m = /([\w.-]+\.js):(\d+):(\d+)/.exec(frame); if (!m) return null;
    const c = await consumer(m[1]); if (!c) return `${m[1]}:${m[2]}:${m[3]}`;
    const p = c.originalPositionFor({ line: +m[2], column: +m[3] }); if (!p.source) return null;
    return `${p.source.replace(/^.*\/src\//, 'src/').replace(/^webpack:\/\/[^/]*\//, '')}:${p.line}${p.name ? ` (${p.name})` : ''}`;
  };
  const where = async (stack) => { const o = []; for (const f of stack || []) { const r = await resolve(f); if (r && !/node_modules/.test(r) && !o.includes(r)) o.push(r); if (o.length >= 4) break; } return o; };
  const tally = new Map();
  for (const r of rows) {
    const byId = new Map(r.timers.map((x) => [x.id, x]));
    // the fine request: the first /grid (or /grid_series) request of the step that carries a bbox, else the first request
    const fine = r.fetches.find((q) => q.q && q.q.bbox) || r.fetches[0];
    console.log(`\nview ${r.view} z${r.z} step ${r.step}: grid ${r.grids.map((g) => `${g.sig}@${g.t}`).join(' -> ')}`);
    if (!fine) { console.log('   no request left'); continue; }
    console.log(`   ${fine.path} left @${fine.t} ms; called from: ${(await where(fine.stack)).join(' < ') || 'unresolved'}`);
    let c = byId.get(fine.from); let guard = 0; const chain = [];
    while (c && guard++ < 12) { chain.unshift(c); c = byId.get(c.from); }
    if (!chain.length) console.log('   it did not leave from a timer (a promise, an event or an effect led to it)');
    for (const t of chain) {
      const w = await where(t.stack); const key = `${t.delay} ms @ ${w[0] || 'unresolved'}`;
      console.log(`   timer ${t.delay} ms: set @${t.set}, fired @${t.fired}; set at: ${w.join(' < ') || 'unresolved'}`);
      const e = tally.get(key) || { n: 0, wait: 0 }; e.n += 1; e.wait += (t.fired || 0) - (t.set || 0); tally.set(key, e);
    }
    // long timers that fired before the request but are NOT in its chain (candidates when the chain is broken by a promise)
    const others = r.timers.filter((t) => t.delay >= 200 && t.fired != null && t.fired <= fine.t + 5 && t.set >= -5 && !chain.includes(t));
    for (const t of others.slice(0, 6)) console.log(`   (also fired before it: ${t.delay} ms set @${t.set} fired @${t.fired}; ${(await where(t.stack)).slice(0, 2).join(' < ')})`);
    for (const l of (r.logs || []).filter((x) => x.t <= fine.t + 50).slice(0, 6)) console.log(`   log @${l.t}: ${l.text.slice(0, 150)}`);
  }
  console.log('\n== timers in the chain behind the fine request, over all steps (count, mean wait) ==');
  for (const [k, v] of [...tally].sort((a, b) => b[1].wait - a[1].wait)) console.log(`   ${String(v.n).padStart(3)} x  mean ${Math.round(v.wait / v.n)} ms   ${k}`);
  const lefts = rows.map((r) => (r.fetches.find((q) => q.q && q.q.bbox) || r.fetches[0])).filter(Boolean).map((q) => q.t).sort((a, b) => a - b);
  if (lefts.length) console.log(`\nrequest left after the keydown: median ${lefts[Math.floor(lefts.length / 2)]} ms, range ${lefts[0]}-${lefts[lefts.length - 1]} ms, ${lefts.length} of ${rows.length} steps`);
})();
