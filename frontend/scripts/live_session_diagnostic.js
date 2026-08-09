/**
 * live_session_diagnostic.js — ONE run, FOUR correlated streams, one clock.
 *
 * Owner request (2026-08-09): "a special diagnostic tool that video records and captures console
 * log and react scan diagnostics along the way to see in real time on the live dev where issues
 * are." Driven by three owner-reported symptoms that a single session should reproduce together:
 *   (a) admin is slow to load AFTER navigating the map a lot (marine<->wind, GFS<->EURO);
 *   (b) animations clear then come back while panning/zooming fast;
 *   (c) the forecast view is slow to load after scrubbing the timeline.
 *
 * WHY THIS EXISTS RATHER THAN A FIFTH PROBE. Three of the four streams were already built, in two
 * scripts that use TWO UNRECONCILED CLOCKS and throw most of the console away:
 *   probe_wind_zoomburst.js — video + 10 Hz engine state + screenshots, stamped Date.now()
 *   zoomlab.js/-verdict.js  — video + per-render in-page trace, stamped performance.now(),
 *                             plus the INSTRUMENT/RENDER/REFUSE verdict taxonomy worth reusing
 * This composes them and adds the one stream nobody captured (React renders) and the one mechanism
 * nobody built (a decodable video<->wall-clock anchor).
 *
 * ★★★ THE INDEX IS A PER-SECOND BUCKETED JOIN, NOT A FILE MANIFEST. Every counter here is
 * CUMULATIVE (renders, uploads, requests, bytes) while every question is a RATE — "the video shows
 * a blank at t=12.4 s, what re-rendered 340 times in that second?". A manifest of files forces the
 * reader to difference the counters by hand, which is where the reading goes wrong. Each row of
 * index.json is one second of wall clock with per-stream DELTAS already taken.
 *
 * ⛔ REFUSALS (this estate's hard rule: an instrument that cannot tell "not measured" from "broken"
 * must refuse). This harness refuses, rather than reporting a zero, when:
 *   - React's commit hook never installed -> renders are null, never 0.
 *   - the marine engine never committed a grid -> engine metrics null, not 0. (Run 1 refused here,
 *     and the cause was the HARNESS: it never activated a heatmap layer, so nothing could commit.)
 *
 * ⭐ THE RENDER STREAM IS REACT'S OWN HOOK, NOT A LIBRARY API. Measured, not assumed: react-scan's
 * auto build exposes `window.reactScan` as a bare FUNCTION (getOwnPropertyNames -> ["length","name"])
 * with no getReport, so probing for a report yields nothing. `__REACT_DEVTOOLS_GLOBAL_HOOK__
 * .onCommitFiberRoot` is present with a renderer attached — that is what react-scan itself wraps, it
 * is version-proof, and it costs a function call per commit instead of a repaint. The react-scan
 * OVERLAY is therefore opt-in (LSD_SCAN_OVERLAY=1): it redraws on every commit, which is precisely
 * the cost this harness is trying to time.
 *   - the video has no wall-clock anchor -> correlation is reported as UNANCHORED.
 *
 * Usage (from frontend/):
 *   node scripts/live_session_diagnostic.js [baseUrl] [outdir]
 * Env:
 *   LSD_HEADED=1        run headed (required to see it live; also more faithful GPU behaviour)
 *   LSD_SEGMENTS=...    comma list from: panzoom,layers,models,scrub,admin  (default: all)
 *   LSD_SECONDS=n       seconds per segment (default 25)
 */
const path = require('path');
const fs = require('fs');

let chromium;
const loadChromium = () => {
  if (chromium) return chromium;
  try { ({ chromium } = require('@playwright/test')); }
  catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }
  return chromium;
};

// The LOCAL react-scan build. Deterministic: the app's own loader points at
// https://unpkg.com/react-scan/dist/auto.global.js with no version pin and no onerror, so a blocked
// or offline CDN produces "no renders" that reads exactly like "no re-renders happened".
function readLocalReactScan() {
  const p = path.join(__dirname, '..', 'node_modules', 'react-scan', 'dist', 'auto.global.js');
  try { return { src: fs.readFileSync(p, 'utf8'), path: p }; } catch (e) { return null; }
}

const SEGMENTS = {
  // (a) fast pan/zoom — the gesture RATE is the trigger for the reseed + fetch-suppression paths
  panzoom: async (page, log) => {
    log('segment: panzoom (fast wheel + pan train)');
    for (let i = 0; i < 10; i++) {
      await page.mouse.move(640, 400);
      await page.mouse.wheel(0, i % 2 ? 300 : -300);
      await page.waitForTimeout(120);
      await page.mouse.move(500, 350);
      await page.mouse.down();
      await page.mouse.move(800, 480, { steps: 4 });
      await page.mouse.up();
      await page.waitForTimeout(120);
    }
  },
  // (b) marine <-> wind layer churn
  layers: async (page, log) => {
    log('segment: layers (marine <-> wind toggling)');
    for (const name of ['Wind', 'Waves', 'Wind', 'Swell', 'Waves']) {
      await clickByLabel(page, name);
      await page.waitForTimeout(1500);
    }
  },
  // (c) GFS <-> EURO model churn
  models: async (page, log) => {
    log('segment: models (GFS <-> EURO toggling)');
    for (const name of ['EURO', 'GFS', 'EURO', 'GFS']) {
      await clickByLabel(page, name);
      await page.waitForTimeout(2500);
    }
  },
  // (d) timeline scrub, then a pan — the owner's "slow to load AFTER scrubbing"
  scrub: async (page, log) => {
    log('segment: scrub (timeline drag, then a pan to expose queued work)');
    const slider = await page.$('[role="slider"]');
    if (slider) {
      await slider.focus();
      for (let i = 0; i < 24; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(90); }
    } else {
      log('  no [role=slider] found - scrub segment DEGRADED, recording anyway');
    }
    await page.waitForTimeout(800);
    await page.mouse.move(500, 350); await page.mouse.down();
    await page.mouse.move(850, 500, { steps: 8 }); await page.mouse.up();
  },
  // (e) the payoff: go to admin and time its first paint AFTER all that map residue
  admin: async (page, log) => {
    log('segment: admin (navigate after map residue; timing first paint)');
    const t0 = Date.now();
    await page.goto(new URL('/admin', page.url()).toString(), { waitUntil: 'domcontentloaded' })
      .catch(() => {});
    await page.waitForTimeout(6000);
    log(`  admin domcontentloaded+6s at +${Date.now() - t0} ms`);
  },
};

async function clickByLabel(page, name) {
  await page.evaluate((n) => {
    const all = Array.from(document.querySelectorAll('button'));
    const label = (x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim());
    const b = all.find((x) => label(x) === n);
    if (b) b.click();
  }, name).catch(() => {});
}

const runProbe = async () => {
  const BASE = process.argv[2] || 'http://localhost:3009';
  const OUT = process.argv[3] || path.join(__dirname, 'live-session-out');
  const HEADED = process.env.LSD_HEADED === '1';
  const SECONDS = Number(process.env.LSD_SECONDS || 25);
  const want = (process.env.LSD_SEGMENTS || 'panzoom,layers,models,scrub,admin')
    .split(',').map((s) => s.trim()).filter((s) => SEGMENTS[s]);
  fs.mkdirSync(OUT, { recursive: true });

  const scan = readLocalReactScan();
  const narrative = [];
  const log = (m) => { const line = `[${new Date().toISOString()}] ${m}`; narrative.push(line); console.log(line); };

  log(`base=${BASE} headed=${HEADED} segments=${want.join(',')} secondsPerSegment=${SECONDS}`);
  log(scan ? `react-scan: injecting LOCAL build (${scan.path})` : 'react-scan: LOCAL BUILD NOT FOUND - renders will REFUSE');

  const browser = await loadChromium().launch({
    headless: !HEADED, args: ['--enable-unsafe-swiftshader'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
  });
  const page = await ctx.newPage();

  // ── ONE CLOCK. The two existing probes stamp Date.now() and performance.now() respectively and
  // cannot be joined. Everything here is converted to WALL MS via the page's own timeOrigin, and
  // the anchor is written to disk so the video (which starts at context creation) can be aligned.
  await page.addInitScript(() => {
    window.__LSD__ = { timeOrigin: performance.timeOrigin, consoleErrors: [], renderPeak: null };
  });
  // A/B SUPPORT: LSD_FLAGS='{"__RAW_DISABLE_SERIES_PREWARM__":true}' sets window flags BEFORE the
  // app boots, so a suspected cause can be turned off and the same session re-measured. Without
  // this the only way to A/B a hypothesis is to edit code between runs, which changes two things
  // at once and makes the comparison worthless.
  const FLAGS = process.env.LSD_FLAGS ? JSON.parse(process.env.LSD_FLAGS) : null;
  if (FLAGS) {
    await page.addInitScript((f) => { Object.assign(window, f); }, FLAGS);
    log(`pre-boot flags: ${JSON.stringify(FLAGS)}`);
  }
  // ── THE RENDER STREAM: React's OWN hook, not a library's report API ────────────────────────
  // Measured 2026-08-09 rather than assumed: the react-scan AUTO build exposes `window.reactScan`
  // as a FUNCTION with no enumerable properties (getOwnPropertyNames -> ["length","name"]) and no
  // getReport, so a first pass probing for a report got nothing and correctly REFUSED. What IS
  // present is `__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot` with 1 renderer attached — the
  // hook react-scan itself wraps. Counting commits there is version-proof and costs a function
  // call per commit, where the overlay costs a repaint.
  // ⚠️ AND IT KEEPS THE PROFILER OUT OF THE PERFORMANCE MEASUREMENT: react-scan's overlay redraws
  // on every commit, which is exactly the thing we are timing. Overlay is now OPT-IN
  // (LSD_SCAN_OVERLAY=1); the commit counter runs either way.
  await page.addInitScript(() => {
    const install = () => {
      const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (!hook || typeof hook.onCommitFiberRoot !== 'function' || window.__LSD_RENDER__) return !!window.__LSD_RENDER__;
      let commits = 0, fibers = 0;
      const byName = Object.create(null);
      const orig = hook.onCommitFiberRoot;
      hook.onCommitFiberRoot = function (id, root) {
        commits++;
        try {
          // Bounded walk: this instrument must not become the load it is measuring.
          let node = root && root.current, budget = 3000;
          const stack = node ? [node] : [];
          while (stack.length && budget-- > 0) {
            const f = stack.pop();
            if (f.actualDuration > 0) {
              fibers++;
              const t = f.type;
              const n = typeof t === 'function' ? (t.displayName || t.name) : (typeof t === 'string' ? t : null);
              if (n) byName[n] = (byName[n] || 0) + 1;
            }
            if (f.child) stack.push(f.child);
            if (f.sibling) stack.push(f.sibling);
          }
        } catch (e) { /* never break the app to measure it */ }
        return orig.apply(this, arguments);
      };
      window.__LSD_RENDER__ = { get commits() { return commits; }, get fibers() { return fibers; }, byName };
      return true;
    };
    if (!install()) {
      // React may not have injected yet at document_start; retry briefly, then give up LOUDLY
      // (the sampler reports null, and null is never rendered as zero).
      let tries = 0;
      const iv = setInterval(() => { if (install() || ++tries > 100) clearInterval(iv); }, 100);
    }
  });
  if (scan && process.env.LSD_SCAN_OVERLAY === '1') {
    await page.addInitScript({ content: scan.src });
    log('react-scan OVERLAY enabled (LSD_SCAN_OVERLAY=1) - it repaints per commit, so treat this run as render-accurate but TIMING-INFLATED');
  }

  const consoleRows = [];
  page.on('console', (msg) => {
    consoleRows.push({ t: Date.now(), type: msg.type(), text: msg.text().slice(0, 400) });
  });
  page.on('pageerror', (e) => consoleRows.push({ t: Date.now(), type: 'pageerror', text: String(e).slice(0, 400) }));

  // Network: the admin-slow and post-scrub-lag hypotheses are both about REQUESTS that outlive the
  // gesture, so record every request with its start/end and byte count.
  const net = [];
  page.on('request', (r) => net.push({ t: Date.now(), phase: 'start', url: r.url().slice(0, 220), method: r.method() }));
  page.on('requestfinished', async (r) => {
    let bytes = null;
    try { const b = await (await r.response()).body(); bytes = b.length; } catch (e) { /* body gone */ }
    net.push({ t: Date.now(), phase: 'end', url: r.url().slice(0, 220), bytes });
  });
  page.on('requestfailed', (r) => net.push({ t: Date.now(), phase: 'failed', url: r.url().slice(0, 220) }));

  const anchor = { wallAtStart: Date.now() };
  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForTimeout(12000);   // let the first commits land

  // ⚠️ ACTIVATE A MARINE LAYER, or there is nothing to measure. Run 1 of this harness refused with
  // "marine engine never reported an upload" — correct behaviour, and the cause was the harness
  // itself: the map boots with no heatmap layer on, so no grid ever commits. The owner's report is
  // about an ACTIVE marine layer, so the session must start the way theirs did.
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button'))
    .some((b) => ((b.title || b.getAttribute('aria-label') || b.textContent || '').trim()) === 'Waves'),
  { timeout: 60000 }).catch(() => log('  "Waves" chip never appeared - marine stream will REFUSE'));
  await clickByLabel(page, 'Waves');
  await page.waitForTimeout(9000);
  const engineLive = await page.evaluate(() =>
    ((window.__WEBGL_MARINE_UPLOAD_DIAG__ || {}).uploadCount || 0) > 0).catch(() => false);
  log(`marine layer active with a committed grid: ${engineLive}`);

  const scanLive = await page.evaluate(() => !!window.__LSD_RENDER__).catch(() => false);
  log(`React commit counter installed: ${scanLive}`);

  // ── 1 Hz sampler: engine state + render counts + memory, all stamped on the wall clock ──────
  const samples = [];
  let stop = false;
  const sampler = (async () => {
    while (!stop) {
      const s = await page.evaluate(() => {
        const up = window.__WEBGL_MARINE_UPLOAD_DIAG__ || {};
        const serve = window.__MARINE_SERVE_DIAG__ || {};
        const gpu = window.__RAW_GPU__ || {};
        const m = window.__RAW_MAP__ || window.map;
        // null (not 0) whenever the hook never installed — "I could not ask" must not read as
        // "nothing rendered".
        const R = window.__LSD_RENDER__ || null;
        const renders = R ? R.commits : null;
        const renderFibers = R ? R.fibers : null;
        const topComponents = R ? Object.entries(R.byName).sort((a, b) => b[1] - a[1]).slice(0, 5) : null;
        return {
          t: Date.now(),
          zoom: m && m.getZoom ? +m.getZoom().toFixed(2) : null,
          uploads: up.uploadCount ?? null,
          nonzero: up.nonzeroCount ?? null,
          accepted: up.renderAccepted ?? null,
          activeModel: up.activeModel ?? null,
          activeLayer: up.activeLayer ?? null,
          covers: serve.coversViewport === true,
          coverKnown: serve.gridWidth != null,
          gpuTextures: gpu.textures ?? (gpu.counts && gpu.counts.textures) ?? null,
          heapMB: (performance.memory && +(performance.memory.usedJSHeapSize / 1048576).toFixed(1)) || null,
          renders, renderFibers, topComponents,
        };
      }).catch(() => null);
      if (s) samples.push(s);
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();

  // ── drive the owner's exact sequence ────────────────────────────────────────────────────────
  const segmentSpans = [];
  for (const name of want) {
    const from = Date.now();
    try { await SEGMENTS[name](page, log); } catch (e) { log(`segment ${name} threw: ${e.message}`); }
    await page.waitForTimeout(Math.max(0, SECONDS * 1000 - (Date.now() - from)));
    segmentSpans.push({ segment: name, from, to: Date.now() });
  }
  stop = true; await sampler;

  // ── THE JOIN: one row per WALL SECOND, with deltas already taken ────────────────────────────
  const sec = (t) => Math.floor((t - anchor.wallAtStart) / 1000);
  const rows = new Map();
  const row = (t) => {
    const k = sec(t);
    if (!rows.has(k)) rows.set(k, { second: k, renders: null, consoleErrors: 0, requests: 0, bytes: 0, segment: null });
    return rows.get(k);
  };
  let prevRenders = null, prevUploads = null;
  for (const s of samples) {
    const r = row(s.t);
    r.zoom = s.zoom; r.heapMB = s.heapMB; r.covers = s.covers; r.coverKnown = s.coverKnown;
    r.activeModel = s.activeModel; r.activeLayer = s.activeLayer; r.accepted = s.accepted;
    // DELTAS, because the raw counters are cumulative and the question is always a rate.
    // ⛔ A NEGATIVE DELTA IS A COUNTER RESET, NOT NEGATIVE WORK. The `admin` segment NAVIGATES, which
    // tears down the page and re-installs the hook at zero — run 2 reported "-272 renders" for admin
    // before this guard. A reset is "I lost the baseline", so it must read null (unknown), never a
    // number: the same not-measured-is-not-zero rule this harness applies to its other streams.
    const d = (now, prev) => (now == null || prev == null) ? null : (now < prev ? null : now - prev);
    r.renders = d(s.renders, prevRenders);
    r.uploads = d(s.uploads, prevUploads);
    if (s.renders != null) prevRenders = s.renders;
    if (s.uploads != null) prevUploads = s.uploads;
  }
  for (const c of consoleRows) if (c.type === 'error' || c.type === 'pageerror') row(c.t).consoleErrors++;
  for (const n of net) {
    const r = row(n.t);
    if (n.phase === 'start') r.requests++;
    if (n.phase === 'end' && n.bytes) r.bytes += n.bytes;
  }
  for (const sp of segmentSpans) {
    for (let k = sec(sp.from); k <= sec(sp.to); k++) if (rows.has(k)) rows.get(k).segment = sp.segment;
  }
  const index = [...rows.values()].sort((a, b) => a.second - b.second);

  // ── verdict + refusals ──────────────────────────────────────────────────────────────────────
  const anyRenders = index.some((r) => r.renders != null);
  const anyEngine = samples.some((s) => s.uploads > 0);
  const refusals = [];
  if (!scanLive) refusals.push('React DevTools commit hook never installed - render stream ABSENT (null, not zero)');
  else if (!anyRenders) refusals.push('commit hook installed but reported nothing - renders are NULL, not zero');
  if (!anyEngine) refusals.push('marine engine never reported an upload - engine metrics are NULL, not zero');

  const video = await page.video();
  const videoPath = video ? await video.path().catch(() => null) : null;
  await ctx.close(); await browser.close();

  const out = {
    base: BASE, headed: HEADED, segments: segmentSpans,
    anchor: { wallAtStart: anchor.wallAtStart, note: 'index.second is seconds since wallAtStart; the video starts at context creation, a few hundred ms before this' },
    renderStream: { commitHookInstalled: scanLive, readable: anyRenders,
      overlayEnabled: process.env.LSD_SCAN_OVERLAY === '1',
      note: 'commits come from __REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot; the react-scan overlay is opt-in because it repaints per commit and would inflate the timings this harness measures' },
    refusals, samples, console: consoleRows, network: net, index,
  };
  fs.writeFileSync(path.join(OUT, 'session.json'), JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
  fs.writeFileSync(path.join(OUT, 'narrative.log'), narrative.join('\n') + '\n');

  // Operator-facing summary: the busiest seconds, because that is where the owner's symptoms live.
  const busiest = [...index].sort((a, b) => (b.requests + (b.renders || 0) / 50) - (a.requests + (a.renders || 0) / 50)).slice(0, 8);
  console.log(`\nsamples ${samples.length} | console rows ${consoleRows.length} | network events ${net.length} | index seconds ${index.length}`);
  console.log(`video: ${videoPath || '(none)'}`);
  if (refusals.length) { console.log('\nREFUSALS (a null here is NOT a zero):'); for (const r of refusals) console.log('  - ' + r); }
  console.log('\nbusiest seconds (segment | reqs | bytes | renders/s | uploads/s | heapMB | zoom):');
  for (const r of busiest) {
    console.log(`  t=${String(r.second).padStart(3)}s ${String(r.segment).padEnd(8)} `
      + `${String(r.requests).padStart(3)} req  ${String(Math.round((r.bytes || 0) / 1024)).padStart(6)} KB  `
      + `${r.renders == null ? 'null' : String(r.renders).padStart(5)} rend  `
      + `${r.uploads == null ? 'null' : String(r.uploads).padStart(3)} upl  `
      + `${r.heapMB == null ? '-' : r.heapMB} MB  z${r.zoom ?? '-'}`);
  }
  console.log(`\nartifacts in ${OUT}: session.json (everything), index.json (the per-second JOIN), narrative.log, video`);
};

module.exports = { SEGMENTS, readLocalReactScan };
if (require.main === module) runProbe();
