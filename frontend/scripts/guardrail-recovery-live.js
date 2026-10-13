/**
 * guardrail-recovery-live.js — the deployed proof that was owed.
 *
 * The fix shipped with an explicit gap: "not yet verified on a deployed build". Everything until
 * now was unit tests plus a local dev check, and the guardrail SELF-EXEMPTS on localhost, so the
 * one behaviour that matters — a real trip followed by a real recovery — could not be observed
 * anywhere but a deployed host. This runs it end to end on the dev alias, with the guardrail LEFT
 * ON, and watches the build's own console for each transition:
 *
 *   1. [rating-band] PAINTING OK                       the band is up
 *   2. [WebGLGuardrail] ... 12 consecutive seconds     the trip
 *   3. the legend disclosure appears                   option 1 doing its job
 *   4. [WebGLGuardrail] Recovery attempt 1/2           option 2 firing after the 60 s backoff
 *   5. [rating-band] PAINTING OK                       the band is back
 *
 * SwiftShader runs at ~1 FPS, which is what makes the trip reproducible here — it is the same
 * condition a genuinely slow GPU produces, so this is a real exercise of the path, not a simulation.
 * Nothing is forced: no __DISABLE_WEBGL_GUARDRAIL__, no force_marine_fallback.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.GR_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'guardrail-recovery-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[recovery-live] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'Admin Officer',
  username: 'adminuser', role: 'admin', subscription_tier: 'premium', is_admin: true };

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const timeline = [];
  const mark = (kind, text) => {
    timeline.push({ t: ((Date.now() - t0) / 1000).toFixed(1), kind, text: text.slice(0, 150) });
    log(`  t+${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${kind}  ${text.slice(0, 110)}`);
  };
  page.on('console', (m) => {
    const t = m.text();
    if (/Recovery attempt/.test(t)) mark('RECOVERY', t);
    else if (/12 consecutive seconds/.test(t)) mark('TRIP', t);
    else if (/\[rating-band\] PAINTING/.test(t)) mark('BAND_ON', t);
    else if (/\[rating-band\] OFF/.test(t)) mark('BAND_OFF', t);
  });

  await page.goto(BASE + '/auth', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.evaluate(({ u }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(u));
    localStorage.setItem(`tos-accepted-${u.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
    localStorage.setItem('raw-surf-theme', 'beach');
    localStorage.removeItem('force_marine_fallback');       // nothing forced — a REAL trip only
  }, { u: USER });
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => !!window.map, null, { timeout: 120000 });
  const build = await page.evaluate(async () => {
    try { const r = await fetch('/service-worker.js', { cache: 'no-store' }); const t = await r.text();
      const m = t.match(/BUILD_VERSION\s*=\s*'([^']+)'/); return m ? m[1] : '?'; } catch (e) { return '?'; }
  });
  log('build under test: ' + build);

  await page.waitForFunction(() => [...document.querySelectorAll('button')]
    .some((b) => (b.textContent || '').trim() === 'Waves'), null, { timeout: 60000 });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Waves');
    if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
    const r = [...document.querySelectorAll('button')].find((x) => /Surf Rating:/.test(x.textContent || ''));
    if (r && /OFF/.test(r.textContent)) r.click();
  });
  await page.evaluate(() => window.map.jumpTo({ center: [-80.0, 26.6], zoom: 9 }));

  // Sample the fallback flag and the legend notice every 5 s across the whole window.
  const samples = [];
  let noticeSeenWhileFailed = false, recoveredFlag = false, everFailed = false;
  for (let i = 0; i < 46; i++) {                       // ~230 s: grace + trip + 60 s backoff + margin
    await page.waitForTimeout(5000);
    const s = await page.evaluate(() => ({
      failed: !!(window.__WEBGL_GUARDRAIL_FALLBACK__ && window.__WEBGL_GUARDRAIL_FALLBACK__.webglMarineFailed),
      notice: [...document.querySelectorAll('[role="status"]')]
        .filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim())[0] || null,
    }));
    samples.push({ t: +((Date.now() - t0) / 1000).toFixed(1), ...s });
    if (s.failed) {
      if (!everFailed) { everFailed = true; mark('FALLBACK', 'webglMarineFailed = true'); }
      if (s.notice && /Simplified wave layer/.test(s.notice)) {
        if (!noticeSeenWhileFailed) mark('NOTICE', s.notice);
        noticeSeenWhileFailed = true;
      }
    } else if (everFailed && !recoveredFlag) {
      recoveredFlag = true; mark('RESTORED', 'webglMarineFailed = false');
      await page.screenshot({ path: path.join(outdir, 'GR_after_recovery.png') });
    }
    if (everFailed && !s.failed && noticeSeenWhileFailed) break;
  }

  const noticeGoneAfter = await page.evaluate(() => [...document.querySelectorAll('[role="status"]')]
    .filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim())
    .filter((t) => /Simplified wave layer/.test(t)).length === 0);

  const verdict = {
    build,
    tripped: everFailed,
    noticeShownWhileDown: noticeSeenWhileFailed,
    recovered: recoveredFlag,
    noticeClearedAfterRecovery: recoveredFlag ? noticeGoneAfter : null,
    recoveryLogSeen: timeline.some((x) => x.kind === 'RECOVERY'),
    bandRepaintedAfterRecovery: (() => {
      const r = timeline.findIndex((x) => x.kind === 'RESTORED');
      return r >= 0 && timeline.slice(r).some((x) => x.kind === 'BAND_ON');
    })(),
  };
  log('');
  log('VERDICT ' + JSON.stringify(verdict, null, 1));
  fs.writeFileSync(path.join(outdir, 'recovery-live.json'),
    JSON.stringify({ base: BASE, verdict, timeline, samples }, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
