/**
 * coastband-probe.js — establish the REGIME before trusting any band number.
 *
 * The stock ladder returned band=0 at every stop AND at its positive control, which by contract
 * voids the zeros: an instrument with no demonstrated sensitivity cannot report an absence.
 * Three things to settle, each a claim rather than an assumption:
 *   1. Is `window.__MARINE_ENGINE__` actually falsy at capture time? (every engine-sourced field
 *      read null while every __RAW_GPU__ field read fine — that is the signature, not the proof)
 *   2. WHICH grid is resident? The legend read "~223 km grid (2°)" — a coarse global grid sets
 *      `_rawWideTrigger`, which forces the overlay on through the REPLACE branch (`coverage_gap`)
 *      independently of MIDZOOM_OVERLAY_CARVE_MIN_Z. If so, the carve threshold is not the
 *      operative gate here and LOP-0002's `reason:'off'` regime was never entered.
 *   3. Does `__RAW_BASEMAP_WATER_MASK__=false` (injected before load, so no stale overlay covers
 *      the view) actually change the state? That is the candidate positive control: it removes
 *      basemap water truth and leaves the generalized coastline geojson — the exact mechanism.
 */
const path = require('path');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.CB_BASE || 'https://dev--rawsurf.netlify.app';
const KILL = process.env.CB_KILL_WATERMASK === '1';
const log = (m) => console.log('[probe] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'Admin Officer',
  username: 'adminuser', role: 'admin', subscription_tier: 'premium', is_admin: true };
const findWaves = () => {
  const all = Array.from(document.querySelectorAll('button'));
  let b = all.find((x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim()) === 'Waves');
  if (!b) {
    const exp = all.find((x) => /weather controls/i.test((x.getAttribute('aria-label') || '') + (x.title || '')) && !/collapse/i.test((x.getAttribute('aria-label') || '') + (x.title || '')));
    if (exp) exp.click();
  }
  return b || null;
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  if (KILL) {
    await page.addInitScript(() => { window.__RAW_BASEMAP_WATER_MASK__ = false; });
    log('INIT SCRIPT: __RAW_BASEMAP_WATER_MASK__ = false (before any map load)');
  }
  await page.goto(BASE + '/auth', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(({ u }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(u));
    localStorage.setItem(`tos-accepted-${u.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
    localStorage.setItem('raw-surf-theme', 'beach');
  }, { u: USER });
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.map, null, { timeout: 120000 });
  const engineAtLoad = await page.evaluate(() => !!window.__MARINE_ENGINE__);
  log('__MARINE_ENGINE__ present right after map: ' + engineAtLoad);
  await page.waitForFunction(`(${findWaves.toString()})() !== null`, null, { timeout: 60000 });
  await page.evaluate(`(() => { const b = (${findWaves.toString()})(); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); })()`);
  await page.waitForTimeout(15000);

  for (const z of [8.4, 7.5, 6.5]) {
    await page.evaluate((zz) => window.map.jumpTo({ center: [-79.35, 26.85], zoom: zz }), z);
    await page.waitForTimeout(9000);
    const s = await page.evaluate(() => {
      const g = window.__RAW_GPU__ || {};
      const e = window.__MARINE_ENGINE__;
      // hunt the engine on window if the named handle is gone
      let found = null;
      if (!e) {
        for (const k of Object.keys(window)) {
          try { const v = window[k];
            if (v && typeof v === 'object' && v._cachedMaskBounds !== undefined) { found = k; break; }
          } catch (x) {}
        }
      }
      const legend = (() => {
        const el = [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && /km grid/.test(n.textContent || ''));
        return el ? el.textContent.trim() : null;
      })();
      const keys = e ? Object.keys(e).filter((k) => /wave|mask|coarse|grid|overlay/i.test(k)).slice(0, 40) : null;
      const bb = (o) => (o ? { w: +o.west?.toFixed(2), e: +o.east?.toFixed(2), span: +(o.east - o.west).toFixed(2) } : null);
      return {
        z: +window.map.getZoom().toFixed(2),
        engineTruthy: !!e, engineType: e ? typeof e : 'undefined', engineAltKey: found,
        engineKeys: keys,
        waveBounds: e ? bb(e._waveData && e._waveData.bounds) : null,
        maskBounds: e ? bb(e._cachedMaskBounds) : null,
        coarseBounds: e ? bb(e._coarseBaseData && e._coarseBaseData.bounds) : null,
        overlayBounds: e ? bb(e._overlayMaskBounds) : null,
        repatch: e ? e._lastMaskRepatchReason : null,
        probeState: e ? e._probeState : null,
        gpuOverlay: g.overlayMask || null,
        gpuMaskDelivered: g.maskDelivered || null,
        gpuBasemapWaterMask: g.basemapWaterMask || null,
        legend,
        killFlag: window.__RAW_BASEMAP_WATER_MASK__,
      };
    });
    log('z' + z + ' -> ' + JSON.stringify(s, null, 1));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
