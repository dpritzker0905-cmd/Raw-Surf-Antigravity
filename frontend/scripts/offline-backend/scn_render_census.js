// RENDER CENSUS (2026-11-15; the researcher's #912 item #4, the director's (b)). Offline only. Which React components render on a
// scrub step, how often, and for how long, on the throttled phone profile. Needs a PROFILING build (`craco build --profile`: React's
// profiling renderer and unmangled function names). A fake React DevTools hook, installed before React loads, sees every commit:
// a fiber that did work in the commit (flags & PerformedWork) is one render of its component; its selfBaseDuration is its own time.
//   AB_BASE=http://127.0.0.1:<spa of the profiling build> PORT=4298 OUT=census.json node scn_render_census.js
// Env: VIEW (phone), CPU (4), ZOOM (6), STEPS (10), LAYER (waves), MODEL (GFS), CENTER (-75,30), DWELL (900), FLAGS ('{}' JSON).
if (process.env.AB_LIVE === '1') throw Error('scn_render_census is offline only (never load the live box)');
const fs = require('fs');
const L = require('./ab_lib.js');

const PORT = +(process.env.PORT || 4298);
const OUT = process.env.OUT || 'render-census.json';
const VIEW = process.env.VIEW || 'phone';
const CPU = +(process.env.CPU || 4);
const ZOOM = +(process.env.ZOOM || 6);
const STEPS = +(process.env.STEPS || 10);
const LAYER = process.env.LAYER || 'waves';
const MODEL = process.env.MODEL || 'GFS';
const DWELL = +(process.env.DWELL || 900);
const FLAGS = process.env.FLAGS ? JSON.parse(process.env.FLAGS) : {};
const [CLNG, CLAT] = (process.env.CENTER || '-75,30').split(',').map(Number);
const VP = {
  desktop: { width: 1280, height: 800, dpr: 1, contextOptions: {} },
  phone: { width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' } },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs in the page before React: a minimal DevTools hook that tallies each commit while window.__RC__.on is true.
const HOOK = () => {
  const RC = (window.__RC__ = { on: false, commits: 0, byName: {}, steps: [], cur: null });
  const nameOf = (t) => (t && (t.displayName || t.name)) || (t && t.render && (t.render.displayName || t.render.name)) || (t && t.type && nameOf(t.type)) || null;
  const isComp = (f) => typeof f.type === 'function' || (f.type && typeof f.type === 'object');
  // A fiber RENDERED in this commit only if it is a NEW object here (worked fibers are swapped in from their alternate; a
  // skipped subtree keeps the same objects, with their STALE flags from whenever they last rendered) AND it did work
  // (PerformedWork). Without the first test every skipped subtree reads as rendered (the census's first cut did).
  let lastCurrent = new WeakSet();
  let thisCurrent = new WeakSet();
  const rendered = (f) => !lastCurrent.has(f) && (f.flags & 1) !== 0;
  // A ROOT of a re-render: a component that rendered while its nearest component ancestor did not (it re-rendered on its own:
  // its state, a context or a store subscription), so the cascade below it starts there.
  const parentComp = (f) => { let p = f.return; while (p && !isComp(p)) p = p.return; return p; };
  const walk = (fiber, acc) => {
    const stack = [fiber];
    while (stack.length) {
      const f = stack.pop();
      if (!f) continue;
      thisCurrent.add(f);
      if (isComp(f) && rendered(f)) {                    // a new object that did work: rendered in this commit
        const n = nameOf(f.type) || '(anonymous)';
        const e = (acc[n] = acc[n] || { renders: 0, selfMs: 0, roots: 0 });
        e.renders += 1; e.selfMs += f.selfBaseDuration || 0;
        const pc = parentComp(f);
        if (!pc || !rendered(pc)) {
          e.roots += 1;
          const pn = pc ? (nameOf(pc.type) || '(anonymous)') : '(root)';
          e.under = e.under || {}; e.under[pn] = (e.under[pn] || 0) + 1;
        }
      }
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), inject() { return 1; }, onScheduleFiberRoot() {}, onPostCommitFiberRoot() {},
    onCommitFiberUnmount() {}, checkDCE() {},
    onCommitFiberRoot(_id, root) {
      if (!RC.on) { thisCurrent = new WeakSet(); walk(root.current, {}); lastCurrent = thisCurrent; return; }   // keep the baseline
      RC.commits += 1;
      const acc = RC.cur || RC.byName;
      thisCurrent = new WeakSet();
      walk(root.current, acc);
      lastCurrent = thisCurrent;
      if (RC.cur) RC.cur.__commits = (RC.cur.__commits || 0) + 1;
    },
  };
};

(async () => {
  const vp = VP[VIEW];
  const { browser, page } = await L.launch({ port: PORT, width: vp.width, height: vp.height, dpr: vp.dpr, contextOptions: vp.contextOptions });
  const out = { view: VIEW, cpu: CPU, zoom: ZOOM, layer: LAYER, model: MODEL, flags: FLAGS, at: new Date().toISOString(), steps: [] };
  try {
    await page.addInitScript(HOOK);
    await page.addInitScript((flags) => { for (const [k, v] of Object.entries(flags)) window[k] = v; }, FLAGS);
    if (VIEW === 'phone' && CPU > 1) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU }); }
    await page.goto(L.BASE + '/map', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window.__MAP_INSTANCE__ || window.map), null, { timeout: 120000 });
    await sleep(1500);
    await page.evaluate((m) => window.setActiveModel && window.setActiveModel(m), MODEL);
    await L.jump(page, CLNG, CLAT, ZOOM);
    await page.evaluate((l) => window.toggleLayer(l), LAYER);
    await sleep(12000);
    await page.evaluate(() => {
      const body = document.getElementById('weather-mobile-timeline-body');
      if (!body || !body.inert) return;
      const h = [...document.querySelectorAll('button[aria-controls="weather-mobile-timeline-body"][aria-expanded="false"]')]
        .find((b) => b.offsetParent !== null && /Open timeline/.test(b.getAttribute('aria-label') || ''));
      if (h) h.click();
    });
    await sleep(1500);
    out.hookSeen = await page.evaluate(() => !!window.__RC__);
    for (let i = 0; i < STEPS; i += 1) {
      await page.evaluate(() => { window.__RC__.cur = {}; window.__RC__.on = true; });
      const w = page.locator('[role="slider"][aria-label*="timeline wheel"]').filter({ visible: true }).first();
      if (await w.count()) { await w.focus().catch(() => {}); await page.keyboard.press('ArrowRight'); }
      await sleep(DWELL);
      const step = await page.evaluate(() => { const s = window.__RC__.cur; window.__RC__.on = false; window.__RC__.cur = null; return s; });
      out.steps.push(step);
    }
    // per component: renders per step (median) and own ms per step (median)
    const names = new Set(out.steps.flatMap((s) => Object.keys(s).filter((k) => k !== '__commits')));
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
    out.table = [...names].map((n) => ({ name: n,
      rendersPerStep: med(out.steps.map((s) => (s[n] ? s[n].renders : 0))),
      rootsPerStep: med(out.steps.map((s) => (s[n] ? s[n].roots : 0))),
      under: Object.assign({}, ...out.steps.map((s) => (s[n] && s[n].under) || {})),
      selfMsPerStep: +med(out.steps.map((s) => (s[n] ? s[n].selfMs : 0))).toFixed(2) }))
      .sort((a, b) => b.selfMsPerStep - a.selfMsPerStep || b.rendersPerStep - a.rendersPerStep);
    out.commitsPerStep = med(out.steps.map((s) => s.__commits || 0));
    out.totalSelfMsPerStep = +med(out.steps.map((s) => Object.entries(s).filter(([k]) => k !== '__commits').reduce((t, [, e]) => t + e.selfMs, 0))).toFixed(1);
    out.componentsPerStep = med(out.steps.map((s) => Object.keys(s).filter((k) => k !== '__commits').length));
  } catch (e) { out.error = String(e && e.message || e).slice(0, 200); }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`census ${VIEW} z${ZOOM} ${LAYER}: ${out.commitsPerStep} commits / step, ${out.componentsPerStep} components / step, ${out.totalSelfMsPerStep} ms own render / step${out.error ? ' ERROR ' + out.error : ''}`);
  for (const r of (out.table || []).slice(0, 25)) console.log(`  ${String(r.selfMsPerStep).padStart(7)} ms  x${String(r.rendersPerStep).padStart(3)}  ${r.name}`);
  console.log('RE-RENDER ROOTS per step (a component that rendered while its parent component did not), under which parent:');
  for (const r of [...(out.table || [])].filter((x) => x.rootsPerStep > 0).sort((a, b) => b.rootsPerStep - a.rootsPerStep).slice(0, 25)) {
    console.log(`  x${String(r.rootsPerStep).padStart(3)}  ${r.name}   under ${Object.keys(r.under || {}).slice(0, 3).join(', ')}`);
  }
})();
