/**
 * GATE 6 CPU PROFILE — name the functions inside the stall.
 *
 * GATE6_stall_attribution.js established WHERE the long frames enter: React's scheduler
 * (`performWorkUntilDeadline`, up to 800 ms in one message-loop turn) and MapLibre's RAF wrapper
 * (`browser.ts:23`, recurring ~442 ms). Both are ENTRY POINTS. LoAF cannot see past them, so this
 * takes a real CPU profile over CDP and aggregates SELF time per function, then resolves the top
 * frames through the deployed source maps.
 *
 * ★ Entry point != hot function. "It happens inside MapLibre's frame callback" is a location, not a
 *   cause; the custom marine and wind layers draw inside that same callback. Only self-time
 *   separates them.
 *
 * Usage: HEADED=1 node GATE6_cpu_profile.js [url] [profileSeconds]
 */
const path = require('path');
const { createRequire } = require('module');
const req = createRequire(path.resolve(__dirname, '../../../../frontend/package.json'));
const { chromium } = req('@playwright/test');
const { SourceMapConsumer } = req('source-map');

const TARGET = process.argv[2] || 'https://dev--rawsurf.netlify.app/map';
const SECS = Number(process.argv[3] || 30);
const LAYER = process.env.LAYER || 'Waves';

(async () => {
  const browser = await chromium.launch({
    headless: process.env.HEADED !== '1',
    args: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('raw-surf-user', JSON.stringify({
        id: 'dev-mock-user-id', email: 'dev@rawsurf.com', full_name: 'Dev Mock',
        username: 'devmock', role: 'admin', subscription_tier: 'premium', is_admin: true
      }));
    } catch (e) {}
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); // microseconds

  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(20000);

  // ⛔ WORKLOAD CONTROL. A getParameter total is only comparable across runs if the same amount of
  // texture work happened. Fewer textures created — a cold backend serving no field, say — would
  // lower the total for a reason that has nothing to do with any optimisation. Report the counters
  // so the denominator is visible instead of assumed.
  const counters = () => page.evaluate(() => {
    const g = window.__RAW_GPU__ || {};
    const d = window.__WebGLMarineLayer_DIAG__ || {};
    return { textureCount: g.textureCount, textureUploadCount: g.textureUploadCount,
      encodeDupCount: g.encodeDupCount, vectors: d.backendGridVectorCount, waveData: d.waveDataPresent };
  });
  const before = await counters();

  await cdp.send('Profiler.start');
  const btn = page.locator('button', { hasText: new RegExp(`^${LAYER}$`) }).first();
  await btn.click();
  console.log(`profiling ${SECS}s from the moment ${LAYER} was activated (aria-pressed=${await btn.getAttribute('aria-pressed')})`);
  await page.waitForTimeout(SECS * 1000);
  const { profile } = await cdp.send('Profiler.stop');
  const after = await counters();
  console.log(`\nWORKLOAD  before: ${JSON.stringify(before)}`);
  console.log(`WORKLOAD  after : ${JSON.stringify(after)}`);
  console.log(`WORKLOAD  delta : textures +${(after.textureCount || 0) - (before.textureCount || 0)}`
    + `  uploads +${(after.textureUploadCount || 0) - (before.textureUploadCount || 0)}`
    + `  vectors ${after.vectors}`);
  await browser.close();

  // ---- aggregate SELF time per node -------------------------------------
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const total = profile.timeDeltas.reduce((a, b) => a + b, 0);
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i];
    const dt = profile.timeDeltas[i] || 0;
    self.set(id, (self.get(id) || 0) + dt);
  }
  const rows = [...self.entries()].map(([id, us]) => {
    const n = byId.get(id);
    const f = n?.callFrame || {};
    return { us, fn: f.functionName || '(anonymous)', url: f.url || '', line: f.lineNumber, col: f.columnNumber };
  }).filter((r) => r.us > 0).sort((a, b) => b.us - a.us);

  console.log(`\n=== CPU profile: ${(total / 1000).toFixed(0)} ms wall, ${profile.samples.length} samples ===`);
  console.log('Top self-time frames (ms, % of profiled wall):\n');

  const cache = {};
  const resolve = async (url, line, col) => {
    const file = (url || '').split('/').pop();
    if (!file || !/\.js$/.test(file)) return null;
    if (!(file in cache)) {
      try {
        const r = await fetch(`${url}.map`);
        cache[file] = r.ok ? await r.json() : null;
      } catch (e) { cache[file] = null; }
    }
    if (!cache[file]) return null;
    const consumer = await new SourceMapConsumer(cache[file]);
    const o = consumer.originalPositionFor({ line: line + 1, column: col, bias: SourceMapConsumer.LEAST_UPPER_BOUND })
      || consumer.originalPositionFor({ line: line + 1, column: col, bias: SourceMapConsumer.GREATEST_LOWER_BOUND });
    consumer.destroy();
    return o && o.source ? `${o.source}:${o.line}${o.name ? ` (${o.name})` : ''}` : null;
  };

  for (const r of rows.slice(0, 22)) {
    const ms = (r.us / 1000).toFixed(1);
    const pctv = ((r.us / total) * 100).toFixed(1);
    const orig = await resolve(r.url, r.line, r.col);
    const where = orig || `${(r.url || '(native)').split('/').pop()}:${r.line}:${r.col}`;
    console.log(`${ms.padStart(8)}ms ${pctv.padStart(5)}%  ${r.fn.padEnd(28)} ${where}`);
  }

  // ---- NAMED TOTALS: rank is not a measurement ----------------------------------------
  // ⛔ A top-N list answers "what is biggest", NOT "did X change". Between two runs a cost can drop
  // out of the top 22 because it shrank, because the workload shrank, OR because the sampler started
  // attributing it to the JS caller instead of the native frame — and those look identical in a
  // ranked list. Sum the ones under investigation explicitly, every run, at whatever rank.
  const NAMED = ['getParameter', 'getImageData', 'drawImage', 'texImage2D', 'texSubImage2D', 'readPixels'];
  console.log('\n=== NAMED NATIVE TOTALS (reported at any rank, so runs are comparable) ===');
  for (const name of NAMED) {
    const us = rows.filter((r) => r.fn === name).reduce((s, r) => s + r.us, 0);
    const n = rows.filter((r) => r.fn === name).length;
    console.log(`  ${name.padEnd(16)} ${(us / 1000).toFixed(1).padStart(8)}ms  ${((us / total) * 100).toFixed(2).padStart(5)}%  (${n} frame(s))`);
  }
  // The JS wrappers that CALL those natives — if a native total falls while its caller rises, the
  // work moved in the attribution, it did not go away.
  // ⛔ THE FIRST VERSION OF THIS BLOCK MATCHED ON `r.url`, WHICH IS THE BUNDLE PATH
  // (`main.a4ced6ed.js`), NOT the original source. It matched nothing, printed nothing, and looked
  // like "no JS callers found" instead of "this filter cannot work". Resolve first, then match.
  // ★ A filter that can only ever return empty is not a measurement — and it fails silently.
  const CALLERS = ['WebGLStateIsolation', 'WebGLMarineTextureState', 'marineMaskShelter',
    'inlandWaterGuard', 'WebGLMarineMaskRenderer', 'WebGLWindUtils'];
  const callerTotals = new Map(CALLERS.map((c) => [c, 0]));
  for (const r of rows.slice(0, 80)) {
    const orig = await resolve(r.url, r.line, r.col);
    if (!orig) continue;
    for (const c of CALLERS) if (orig.includes(c)) callerTotals.set(c, callerTotals.get(c) + r.us);
  }
  console.log('  -- JS callers of the above (resolved through source maps, top 80 frames) --');
  for (const [c, us] of [...callerTotals].sort((a, b) => b[1] - a[1])) {
    if (us > 0) console.log(`  ${c.padEnd(24)} ${(us / 1000).toFixed(1).padStart(8)}ms  ${((us / total) * 100).toFixed(2).padStart(5)}%`);
  }

  // ---- WINDOWED: what ran during the WORST stall, not just across the whole run ----------
  // ⚠️ A 30 s aggregate answers "what costs the most overall". It does NOT answer "what was the
  // 1.2 s frame". Those can be different functions entirely — a cost spread thinly across every
  // frame outranks a single huge stall in the totals while being invisible in the stall itself.
  // Bucket the samples and rank buckets by how BLOCKED they were (least idle).
  const BUCKET_US = 250000; // 250 ms
  const buckets = new Map();
  let t = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    t += profile.timeDeltas[i] || 0;
    const b = Math.floor(t / BUCKET_US);
    if (!buckets.has(b)) buckets.set(b, { idle: 0, busy: 0, per: new Map() });
    const rec = buckets.get(b);
    const n = byId.get(profile.samples[i]);
    const fn = n?.callFrame?.functionName || '(anonymous)';
    const dt = profile.timeDeltas[i] || 0;
    if (fn === '(idle)') rec.idle += dt;
    else {
      rec.busy += dt;
      const key = `${fn}|${n?.callFrame?.url || ''}|${n?.callFrame?.lineNumber}|${n?.callFrame?.columnNumber}`;
      rec.per.set(key, (rec.per.get(key) || 0) + dt);
    }
  }
  const worst = [...buckets.entries()]
    .map(([b, r]) => ({ b, ...r, busyPct: r.busy / (r.busy + r.idle || 1) }))
    .sort((a, b) => b.busy - a.busy).slice(0, 3);

  console.log(`\n=== WORST ${BUCKET_US / 1000}ms WINDOWS (ranked by blocked time) ===`);
  for (const w of worst) {
    console.log(`\n--- t+${((w.b * BUCKET_US) / 1000).toFixed(0)}ms after activation: busy ${(w.busy / 1000).toFixed(0)}ms `
      + `(${(w.busyPct * 100).toFixed(0)}% of the window) ---`);
    const top = [...w.per.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    for (const [key, us] of top) {
      const [fn, url, line, col] = key.split('|');
      const orig = await resolve(url, Number(line), Number(col));
      console.log(`   ${(us / 1000).toFixed(1).padStart(7)}ms  ${fn.padEnd(26)} ${orig || (url || '(native)').split('/').pop()}`);
    }
  }
})().catch((e) => { console.error('PROFILE ERROR:', e.message); process.exit(1); });
