import { createRequire } from 'module';
const require = createRequire(new URL('../../package.json', import.meta.url));
const { chromium } = require('playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(new URL('./out/ground-truth.local.html', import.meta.url).href);
await page.waitForFunction(() => document.querySelector('#readout table'), null, { timeout: 240000 });
const cases = JSON.parse(process.env.CASES);
for (const c of cases) {
  await page.evaluate((c) => { setPaused(true); Object.assign(params, c.set); if (c.rules) params.rules = c.rules; rebuildTables(); if (c.geo) initializeSystem(); render(); measure(); }, c);
  if (c.shot) await (await page.$('#canvas-container canvas')).screenshot({ path: c.shot });
  console.log('== ' + JSON.stringify(c.set) + (c.rules ? ' rules=' + c.rules : ''));
  console.log(await page.evaluate(() => document.querySelector('#readout').innerText + '\n' + document.querySelector('#palette').innerText));
}
console.log(errs.join('\n'));
await browser.close();
