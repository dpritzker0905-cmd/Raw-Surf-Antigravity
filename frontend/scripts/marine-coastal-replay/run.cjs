// Disposable real-app pages. The existing CI dev-server setup supplies its test auth/basemap.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../node_modules/@playwright/test');
const { makeTargets, hash } = require('./fixture.cjs');
const { replayCoastalHandoff } = require('./browser.cjs');
const { verifyReplay, names } = require('./verify.cjs');
const out = path.resolve(process.argv[2] || '/tmp/zoomlab-out');
const base = process.env.ZL_BASE || 'http://localhost:3009';
const save = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n');

async function boot(page) {
  await page.goto(base + '/map', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.map && window.__MARINE_ENGINE__, null, { timeout: 90000 });
  await page.evaluate(() => {
    const decline = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Decline');
    if (decline) decline.click();
  });
  await page.waitForFunction(() => {
    const buttons = [...document.querySelectorAll('button')];
    if (buttons.some(b => (b.title || b.getAttribute('aria-label') || b.textContent).trim() === 'Waves')) return true;
    const expand = buttons.find(b => /weather controls/i.test((b.getAttribute('aria-label') || '') + b.title)
      && !/collapse/i.test((b.getAttribute('aria-label') || '') + b.title));
    if (expand) expand.click();
    return false;
  }, null, { timeout: 45000 });
  await page.evaluate(() => {
    const waves = [...document.querySelectorAll('button')].find(b =>
      (b.title || b.getAttribute('aria-label') || b.textContent).trim() === 'Waves');
    if (waves.getAttribute('aria-pressed') !== 'true') waves.click();
    window.map.jumpTo({ center: [-80.2, 28.33], zoom: 8 });
  });
  await page.waitForFunction(() => window.__MARINE_ENGINE__?._waveData?.waveGrid?.vectors?.length > 0
    && window.__MARINE_ENGINE__?._landGeoJSON?.features?.length > 0, null, { timeout: 90000 });
  await page.waitForTimeout(10000);
}

async function inputs() {
  if (process.env.COASTAL_REPLAY_INPUT) return JSON.parse(fs.readFileSync(process.env.COASTAL_REPLAY_INPUT, 'utf8'));
  const validTime = new Date(Math.floor(Date.now()/3600000)*3600000).toISOString();
  const result = { capturedAt: new Date().toISOString(), urls: {} };
  for (const [name, bbox] of [['coarse', '-180,-80,180,85'], ['regional', '-90,18,-70,38']]) {
    const url = new URL('https://raw-surf-antigravity.onrender.com/api/weather/grid');
    for (const [key, value] of Object.entries({ model: 'GFS', domain: 'marine', layer: 'waves', valid_time: validTime, bbox })) url.searchParams.set(key, value);
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw Error(`${name} input HTTP ${response.status}`);
    result[name] = await response.json(); result.urls[name] = url.href;
    save('coastal-input.json', result);
  }
  return result;
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const input = await inputs(); save('coastal-input.json', input);
  const targets = makeTargets(input);
  const launchArgs = ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
  const browser = await chromium.launch({ headless: true, args: launchArgs,
    ...(process.env.HANDOFF_BROWSER_CHANNEL ? { channel: process.env.HANDOFF_BROWSER_CHANNEL } : {}) });
  const report = { diagnosticOnly: true, sourceCommit: process.env.GITHUB_SHA, browserVersion: browser.version(),
    launchArgs, rawInputHashes: { coarse: hash(input.coarse), regional: hash(input.regional) }, results: [] };
  const write = () => save('coastal-replay.json', report);
  try {
    for (const name of names) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
      const errors = [], networkFailures = [];
      try {
        await context.addInitScript(() => {
          const mockSW = { register: () => new Promise(() => {}), ready: new Promise(() => {}),
            addEventListener: () => {}, removeEventListener: () => {},
            getRegistration: () => Promise.resolve(null), getRegistrations: () => Promise.resolve([]) };
          Object.defineProperty(navigator, 'serviceWorker', { get: () => mockSW, configurable: true });
        });
        const page = await context.newPage();
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error' || m.text().includes('Render error')) errors.push(m.text().slice(0, 500)); });
        page.on('requestfailed', r => networkFailures.push({ url: r.url().split('?')[0], error: r.failure()?.errorText }));
        await boot(page);
        const renderer = await page.evaluate(() => {
          const gl = window.map.painter.context.gl, ext = gl.getExtension('WEBGL_debug_renderer_info');
          return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
            attributes: gl.getContextAttributes() };
        });
        try {
          report.results.push({ name, errors, networkFailures, ...renderer,
            ...await page.evaluate(replayCoastalHandoff, { targets, blend: name.startsWith('blend') }) });
        } catch (error) {
          report.results.push({ name, errors, networkFailures, ...renderer,
            partial: await page.evaluate(() => window.__COASTAL_REPLAY_PARTIAL__ || null), failure: error.message });
          throw error;
        }
        await page.screenshot({ path: path.join(out, name + '.png') });
        write(); console.log(`${name}: ${report.results.at(-1).frames.length} frames, ${report.results.at(-1).starts} handoff starts`);
      } catch (error) { report.failure = `${name}: ${error.message}`; write(); throw error; }
      finally { await context.close(); }
    }
    const summary = verifyReplay(report); save('coastal-summary.json', summary);
    console.log(JSON.stringify(summary));
  } finally { write(); await browser.close(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { boot };
