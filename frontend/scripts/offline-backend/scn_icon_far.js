// Production-context bundle, no stored ICON tail. Judge the engine and texture bytes, never parity.
// MODE=trend (all 72 hours), fallback (ICON anchor refused), or kill (both old drops must return).
const assert = require('assert/strict');
const fs = require('fs');
const L = require('./ab_lib.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MODE = process.env.MODE || 'trend';
const WINDOW_MS = +(process.env.WINDOW_MS || 24000);
const FIRST = +(process.env.FIRST || 169), LAST = +(process.env.LAST || 240);
if (process.env.AB_LIVE === '1') throw Error('D1 acceptance must run offline');
assert(['trend', 'fallback', 'kill'].includes(MODE));
const timeline = '[role="slider"][aria-label*="Forecast timeline"]';

(async () => {
  const {browser, page, log} = await L.launch({port: +(process.env.PORT || 4100), live: false, hooks: {
    beforeWeather: async url => {
      const delay = +(url.pathname.endsWith('/grid_series') ? process.env.LAT_SERIES || 0 : process.env.LAT_GRID || 0);
      if (delay) await sleep(delay);
    }
  }});
  const rows = [];
  let refusedAnchors = 0;
  try {
    // D1 is the direct-grid client-estimator path. Cached series frames would bypass it
    // and snap to their 3-hour lattice, so force this supported path explicitly.
    await page.addInitScript(() => { window.__MARINE_SERIES__ = false; });
    if (MODE === 'kill') await page.addInitScript(() => { window.__RAW_DISABLE_ICON_FAR_HOUR_RENDER__ = true; });
    if (MODE === 'fallback' || (MODE === 'kill' && process.env.KILL_FALLBACK === '1')) {
      // Refuse ICON's native anchor through the same fetch failure the client handles in production.
      await page.route(/\/api\/weather\/grid\?/, async route => {
        const url = new URL(route.request().url());
        const anchorHour = Math.round((Date.parse(url.searchParams.get('valid_time')) - Math.round(Date.now() / 3600000) * 3600000) / 3600000);
        if (url.searchParams.get('model') === 'ICON' && anchorHour === 168) {
          refusedAnchors++;
          return route.fulfill({status: 503, headers: {'access-control-allow-origin': '*'}, body: '{}'});
        }
        return route.fallback();
      });
    }
    const snap = () => page.evaluate(() => {
      const data = window.__MARINE_ENGINE__?._waveData;
      const grid = data?.waveGrid;
      const texture = data?.u_waveTexture;
      return {hour: grid?.hourOffset, provider: grid?.__gridProvider, model: grid?.__sourceModel,
        estimated: grid?.is_estimated, basis: grid?.estimate_basis,
        upload: texture && window.__TEX__?.uploads.get(texture),
        wheel: Number([...document.querySelectorAll('[role="slider"][aria-label*="Forecast timeline"]')]
          .find(el => el.offsetParent !== null)?.getAttribute('aria-valuenow')),
        drop: window.__SWELL2_LAST_DROP__ || null};
    });
    const seek = async hour => {
      const wheel = page.locator(timeline).filter({visible: true}).first();
      await wheel.focus();
      const current = Number(await wheel.getAttribute('aria-valuenow'));
      const delta = hour - current;
      for (let i = 0; i < Math.floor(Math.abs(delta) / 24); i++) await page.keyboard.press(delta > 0 ? 'PageUp' : 'PageDown');
      for (let i = 0; i < Math.abs(delta) % 24; i++) await page.keyboard.press(delta > 0 ? 'ArrowRight' : 'ArrowLeft');
      assert.equal(Number(await wheel.getAttribute('aria-valuenow')), hour, 'timeline did not select requested hour');
    };
    await L.openMap(page); await L.jump(page, -108, 16, 3);
    await L.clickText(page, 'Waves'); await L.clickText(page, 'ICON');
    await page.waitForFunction(() => {
      const d = window.__MARINE_ENGINE__?._waveData;
      return d?.waveGrid?.__sourceModel === 'ICON' && d.waveGrid.hourOffset === 0
        && window.__TEX__?.uploads.has(d.u_waveTexture);
    }, null, {timeout: WINDOW_MS});
    const native = await snap();
    let previous = null;
    for (let hour = FIRST; hour <= LAST; hour++) {
      await page.evaluate(() => { window.__SWELL2_LAST_DROP__ = null; });
      await seek(hour);
      const t0 = Date.now(); let s;
      do {
        s = await snap();
        const rejectedRecovery = MODE === 'kill' && process.env.KILL_FALLBACK === '1' && refusedAnchors > 0
          && log.requests.some(r => r.q?.model === 'GFS' && Date.parse(r.q.valid_time) > Date.now() + 180 * 3600000)
          && Date.now() - t0 >= 2000;
        if (MODE === 'kill' ? s.drop || rejectedRecovery : s.hour === hour && s.upload && s.upload.seq !== previous?.upload.seq) break;
        await sleep(100);
      } while (Date.now() - t0 < WINDOW_MS);
      if (MODE === 'kill') {
        const reason = process.env.KILL_FALLBACK === '1' ? 'model_mismatch' : 'provider_not_whitelisted';
        if (process.env.KILL_FALLBACK === '1') {
          assert(refusedAnchors > 0, 'missing-anchor control was not exercised');
          assert.equal(s.hour, native.hour, 'kill changed the held native hour');
          assert.equal(s.upload?.hash, native.upload.hash, 'kill uploaded substitute content');
        } else assert.equal(s.drop?.reason, reason, JSON.stringify(s));
        assert.notEqual(s.hour, hour, 'kill unexpectedly delivered the repaired hour');
      } else {
        assert.equal(s.hour, hour, 'engine held wrong hour: ' + JSON.stringify(s));
        assert(s.upload?.hash, 'no typed-byte upload recorded for resident wave texture');
        if (previous) {
          assert.notEqual(s.upload.seq, previous.upload.seq, 'no new texture upload');
          assert.notEqual(s.upload.hash, previous.upload.hash, 'uploaded content stayed frozen');
        }
        const expected = MODE === 'fallback' ? 'estimated' : hour > 240 ? 'gfs_euro_blend' : hour > 168 ? 'gfs_trend' : null;
        if (expected) assert.equal(s.provider, expected, 'scenario did not exercise intended provider');
        if (MODE === 'fallback') {
          assert.equal(s.estimated, true); assert.equal(s.model, 'ICON');
          assert.equal(s.basis?.type, 'icon_persistence_gfs_blend');
          assert(s.basis.persistence_anchor_product_id, 'stored recovery has no native ICON anchor');
        }
      }
      rows.push({requested: hour, ms: Date.now() - t0, ...s});
      console.log(JSON.stringify(rows.at(-1)));
      previous = s;
    }
    const result = {mode: MODE, first: FIRST, last: LAST, passed: rows.length, native, refusedAnchors, rows, hosts: log.hosts,
      blockedWs: log.blockedWs.length, errors: log.errors};
    if (process.env.OUTPUT) fs.writeFileSync(process.env.OUTPUT, JSON.stringify(result, null, 2) + '\n');
    console.log('PASS', MODE, rows.length, MODE === 'kill' ? 'expected rejection controls' : 'held-hour / upload-hash steps');
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({drop: window.__SWELL2_LAST_DROP__,
      parity: window.__MARINE_RENDER_HOUR_PARITY__, upload: window.__WEBGL_MARINE_UPLOAD_SIG_DIFF__,
      reason: window.__WEBGL_MARINE_UPLOAD_REASON__, estimate: window.__ICON_EXTENDED_ESTIMATE_DIAG__}));
    const failure = {mode: MODE, error: error.message, rows, diagnostics,
      requests: log.requests.slice(-20), errors: log.errors, console: log.console.slice(-12)};
    if (process.env.OUTPUT) fs.writeFileSync(process.env.OUTPUT, JSON.stringify(failure, null, 2) + '\n');
    console.error(JSON.stringify(failure, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(e => { console.error('FAIL', e.stack); process.exitCode = 1; });
