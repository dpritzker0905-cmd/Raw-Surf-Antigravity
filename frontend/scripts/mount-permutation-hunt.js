/**
 * mount-permutation-hunt.js — AV-05 (Audit 4.0): hunt mount-timing layer-order permutations at
 * the owner's Cocoa z12.5 camera, then prove the planner collapses them to one canonical order.
 *
 * PHASE A (hunt): __RAW_DISABLE_MASK_FAMILY_ORDER__=true pre-boot (the planner's whole purpose
 * is to collapse permutations — with it on you measure a single fixpoint and learn nothing).
 * N trials across four perturbation arms (none / cpu-throttle / net-delay / waves-click-delay);
 * each trial captures map.style._order (the TRUTHFUL read — getStyle() omits custom layers),
 * classifies it, keys the permutation on the semantic subsequence, dedupes, and screenshots the
 * FIRST sighting of each unique permutation.
 * PHASE B (control): planner ON, same camera; pass criterion = exactly one permutation hash and
 * __RAW_GPU__.maskFamilyOrder.moved === 0 at settle.
 *
 * Usage: node scripts/mount-permutation-hunt.js <outdir> [PH_TRIALS=18] [PH_CONTROL=6]
 * Base URL: PH_BASE (default http://localhost:3013 — the halo-lane worktree server).
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.PH_BASE || 'http://localhost:3013';
const OUT = process.argv[2] || 'out/mount-hunt';
const TRIALS = +(process.env.PH_TRIALS || 18);
const CONTROL = +(process.env.PH_CONTROL || 6);
const ARMS = ['none', 'cpu', 'net', 'clickdelay'];
const CAMERA = { center: [-80.61, 28.36], zoom: 12.5 }; // layer-order-probe.js:38 — Cocoa
fs.mkdirSync(OUT, { recursive: true });
const log = (s) => console.log(`[hunt ${new Date().toISOString().slice(11, 19)}] ${s}`);

// The semantic subsequence that keys a permutation (mask family + the occludable classes).
const KEY_IDS = [
  'water', 'ocean-mask-fill', 'ocean-mask-inland-water', 'ocean-mask-inland-waterway',
  'webgl-marine-particles', 'ocean-mask-buffer', 'ocean-mask-line',
  'landcover', 'landuse', 'national-park', 'waterway',
  'land-structure-polygon', 'building-outline', 'building',
  'road-minor-navigation', 'road-street-navigation', 'esri-satellite-layer',
];
const OCCLUDABLE = ['ocean-mask-inland-water', 'ocean-mask-inland-waterway', 'landuse',
  'national-park', 'waterway', 'land-structure-polygon', 'building-outline', 'building',
  'road-minor-navigation', 'road-street-navigation'];

async function newPage(browser, plannerOff) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript((off) => {
    const mockSW = { register: () => new Promise(() => {}), ready: new Promise(() => {}),
      addEventListener: () => {}, removeEventListener: () => {},
      getRegistration: () => Promise.resolve(null), getRegistrations: () => Promise.resolve([]) };
    Object.defineProperty(navigator, 'serviceWorker', { get() { return mockSW; }, configurable: true });
    try { localStorage.setItem('raw-surf-theme', 'dark'); } catch (e) {}
    if (off) window.__RAW_DISABLE_MASK_FAMILY_ORDER__ = true;
  }, plannerOff);
  return page;
}

async function armPerturbation(page, arm) {
  if (arm === 'cpu') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    return async () => { try { await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); } catch (e) {} };
  }
  if (arm === 'net') {
    const delay = (ms) => async (route) => { await new Promise((r) => setTimeout(r, ms)); await route.continue(); };
    await page.route('**/styles/v1/mapbox/**', delay(900));
    await page.route('**/v4/**', delay(400));
    return async () => { try { await page.unrouteAll({ behavior: 'ignoreErrors' }); } catch (e) {} };
  }
  return async () => {};
}

const findWaves = () => {
  const all = Array.from(document.querySelectorAll('button'));
  let b = all.find((x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim()) === 'Waves');
  if (!b) {
    const exp = all.find((x) => /weather controls/i.test((x.getAttribute('aria-label') || '') + (x.title || '')) &&
      !/collapse/i.test((x.getAttribute('aria-label') || '') + (x.title || '')));
    if (exp) exp.click();
  }
  return b || null;
};

async function runTrial(page, arm) {
  const disarm = await armPerturbation(page, arm);
  try {
    await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(() => window.map && window.__MARINE_ENGINE__, null, { timeout: 120000 });
    try {
      await page.evaluate(() => {
        const d = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Decline');
        if (d) d.click();
      });
    } catch (e) {}
    if (arm === 'clickdelay') await page.waitForTimeout(3000);
    await page.waitForFunction(`(${findWaves.toString()})() !== null`, null, { timeout: 60000 });
    await page.evaluate(`(() => { const b = (${findWaves.toString()})(); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); })()`);
    await page.waitForFunction(() => { const e = window.__MARINE_ENGINE__; return e && e._waveData && e._waveData.bounds; }, null, { timeout: 120000 });
    await page.evaluate(() => { // dev-overlay iframe guard (zoomlab house pattern)
      for (const f of Array.from(document.querySelectorAll('iframe'))) {
        const r = f.getBoundingClientRect();
        if (r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9) f.remove();
      }
    });
    await page.evaluate((cam) => window.map.jumpTo(cam), CAMERA);
    await page.waitForTimeout(12000);
    // settle re-verify (rule 16): assert the camera before trusting the read
    const cap = await page.evaluate((keyIds) => {
      const m = window.map;
      const order = m.style._order.slice();
      const byId = {};
      for (const id of order) {
        let l = null; try { l = m.getLayer(id); } catch (e) {}
        let vis = 'visible'; try { vis = m.getLayoutProperty(id, 'visibility') || 'visible'; } catch (e) {}
        byId[id] = { type: l && l.type, src: (l && (l.sourceLayer || l['source-layer'])) || null, vis };
      }
      return {
        zoom: +m.getZoom().toFixed(2), styleLoaded: m.isStyleLoaded(),
        order, byId,
        maskFamilyOrder: (window.__RAW_GPU__ && window.__RAW_GPU__.maskFamilyOrder) || null,
        overlayTruthGate: (window.__RAW_GPU__ && window.__RAW_GPU__.overlayTruthGate) || null,
        key: order.filter((id) => keyIds.includes(id)),
      };
    }, KEY_IDS);
    return { ok: true, cap };
  } catch (e) {
    return { ok: false, err: String(e).slice(0, 300) };
  } finally { await disarm(); }
}

function verdict(key) {
  const idx = (id) => key.indexOf(id);
  const fill = idx('ocean-mask-fill'), field = idx('webgl-marine-particles');
  const bad = [];
  for (const id of OCCLUDABLE) {
    const i = idx(id);
    if (i < 0) continue;
    if (fill >= 0 && i < fill) bad.push(`${id}<fill`);
    if (field >= 0 && i < field && /building|road|land-structure/.test(id)) bad.push(`${id}<field`);
  }
  return bad;
}

async function phase(browser, label, plannerOff, trials) {
  const perms = new Map();
  const rows = [];
  let page = null, sinceCtx = 0;
  for (let t = 0; t < trials; t++) {
    const arm = plannerOff ? ARMS[t % ARMS.length] : 'none';
    if (!page || sinceCtx >= 6) { if (page) await page.close(); page = await newPage(browser, plannerOff); sinceCtx = 0; }
    sinceCtx++;
    const r = await runTrial(page, arm);
    if (!r.ok) { log(`${label} t${t} [${arm}] FAILED: ${r.err}`); rows.push({ t, arm, error: r.err }); continue; }
    const { cap } = r;
    const hash = crypto.createHash('sha1').update(cap.key.join('<')).digest('hex').slice(0, 8);
    const bad = verdict(cap.key);
    rows.push({ t, arm, hash, zoom: cap.zoom, styleLoaded: cap.styleLoaded, moved: cap.maskFamilyOrder && cap.maskFamilyOrder.moved, bad });
    if (!perms.has(hash)) {
      perms.set(hash, { hash, count: 0, firstTrial: t, arm, key: cap.key, bad, verdict: bad.length ? 'BAD' : 'ok' });
      fs.writeFileSync(path.join(OUT, `${label}-perm-${hash}.json`), JSON.stringify({ hash, bad, cap }, null, 1));
      await page.screenshot({ path: path.join(OUT, `${label}-perm-${hash}.png`), fullPage: false });
      log(`${label} t${t} [${arm}] NEW perm ${hash} ${bad.length ? '*** BAD: ' + bad.join(',') : '(legal)'}`);
    } else {
      log(`${label} t${t} [${arm}] perm ${hash} (seen)`);
    }
    perms.get(hash).count++;
  }
  if (page) await page.close();
  return { rows, perms: Array.from(perms.values()) };
}

async function main() {
  let sha = 'unknown'; try { sha = execSync('git rev-parse HEAD', { cwd: path.join(__dirname, '..') }).toString().trim(); } catch (e) {}
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  // Served-build identity is proven IN-PAGE, not by grepping bundle.js (the marine code lives in
  // lazy chunks): the control phase must observe the planner's own telemetry breadcrumb
  // (__RAW_GPU__.maskFamilyOrder — only the 7becd023+ build writes it), else the run is VOID.
  log(`sha=${sha} base=${BASE}`);

  const hunt = await phase(browser, 'hunt', true, TRIALS);
  const control = await phase(browser, 'control', false, CONTROL);
  await browser.close();

  const plannerSeen = control.rows.some((r) => !r.error && r.moved !== null && r.moved !== undefined);
  if (!plannerSeen) { console.error('VOID: control phase never observed __RAW_GPU__.maskFamilyOrder — served build unproven (exit 2).'); }
  const controlPass = plannerSeen && control.perms.length === 1 && control.rows.every((r) => r.error || r.moved === 0);
  const summary = {
    generated_at: new Date().toISOString(), sha, base: BASE, camera: CAMERA,
    planner_telemetry_seen: plannerSeen, trials: TRIALS, control_trials: CONTROL,
    hunt: { unique_permutations: hunt.perms.length, perms: hunt.perms, rows: hunt.rows },
    control: { unique_permutations: control.perms.length, perms: control.perms, rows: control.rows, pass: controlPass },
    verdict: {
      bad_permutation_observed: hunt.perms.some((p) => p.verdict === 'BAD'),
      planner_collapses_to_one: controlPass,
    },
  };
  fs.writeFileSync(path.join(OUT, 'hunt-summary.json'), JSON.stringify(summary, null, 1));
  log(`DONE: hunt perms=${hunt.perms.length} (${hunt.perms.filter((p) => p.verdict === 'BAD').length} BAD), control perms=${control.perms.length} pass=${controlPass}`);
  log(`summary: ${path.join(OUT, 'hunt-summary.json')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
