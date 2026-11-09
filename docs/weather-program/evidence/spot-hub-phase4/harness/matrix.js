const fs = require('fs');
const { open } = require('./common');
const OUT = process.argv[2];
const THEMES = ['light', 'dark', 'beach'];
const VPS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const NOISE = /ws\/call|Signaling WS|ERR_FAILED|RainViewer|Backend Weather Service\] (Grid|Point) fetch error|ExactPoint Forensic|LayerAccessResolver\] Failed/;
const results = [];
const H = 3600e3;
async function sliderChecks(page, sel) {
  const s = page.locator(sel).first();
  const r = { label: await s.getAttribute('aria-label'), tabindex: await s.getAttribute('tabindex'), max: Number(await s.getAttribute('aria-valuemax')) };
  await s.focus();
  const v0 = Number(await s.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
  r.arrowRight = Number(await s.getAttribute('aria-valuenow')) === Math.min(r.max, v0 + 1);
  await page.keyboard.press('Home'); await page.waitForTimeout(150);
  r.home = Number(await s.getAttribute('aria-valuenow')) === 0;
  r.firstText = await s.getAttribute('aria-valuetext');
  await page.keyboard.press('End'); await page.waitForTimeout(150);
  r.end = Number(await s.getAttribute('aria-valuenow')) === r.max;
  r.lastText = await s.getAttribute('aria-valuetext');
  r.focusRing = await s.evaluate((el) => getComputedStyle(el).boxShadow !== 'none' || getComputedStyle(el).outlineStyle !== 'none');
  return r;
}
async function hub(theme, vpName, kill = false) {
  const { browser, page, errors } = await open({ theme, vp: VPS[vpName], phone: vpName === 'phone', kill });
  const reqs = []; page.on('request', (q) => reqs.push(q.url()));
  await page.goto('http://127.0.0.1:3000/spot-hub/spot-1?timeOffset=0', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const r = { surface: 'hub', theme, vp: vpName, kill };
  r.chart = await page.locator('[data-testid=spot-forecast-chart]').count();
  r.seriesRequests = reqs.filter((u) => u.includes('/weather/spot-series/')).length;
  r.oldCards = await page.getByText(/day forecast, from tomorrow/).count();
  if (r.chart) {
    r.days = await page.locator('[data-testid=spot-chart-day]').count();
    r.dayLabels = await page.locator('[data-testid=spot-chart-day]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    r.dayPressed = await page.locator('[data-testid=spot-chart-day][aria-pressed]').count();
    r.locked = await page.locator('[data-testid=spot-chart-locked-day]').count();
    r.upgrade = await page.locator('[data-testid=spot-chart-upgrade]').count();
    r.barLevels = [...new Set(await page.locator('[data-testid=spot-chart-bar]').evaluateAll((els) => els.map((e) => e.getAttribute('data-level'))))];
    r.bars = await page.locator('[data-testid=spot-chart-bar]').count();
    r.barFills = [...new Set(await page.locator('[data-testid=spot-chart-bar] rect[rx]').evaluateAll((els) => els.map((e) => e.getAttribute('fill'))))];
    r.slider = await sliderChecks(page, '[data-testid=spot-chart-slider]');
    r.endOffsetH = Number(new URL(page.url()).searchParams.get('timeOffset'));
    r.readout = await page.locator('[data-testid=spot-chart-readout]').innerText();
    await page.keyboard.press('Home'); await page.waitForTimeout(300);
    r.hScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  }
  await page.screenshot({ path: `${OUT}/hub-free-${theme}-${vpName}${kill ? '-killswitch' : ''}.png`, fullPage: true });
  r.errors = [...new Set(errors)].filter((e) => !NOISE.test(e)).map((e) => e.slice(0, 160));
  r.noiseErrors = [...new Set(errors)].filter((e) => NOISE.test(e)).length;
  results.push(r); await browser.close();
}
async function map(theme, vpName, kill = false) {
  const { browser, page, errors, ctx } = await open({ theme, vp: VPS[vpName], phone: vpName === 'phone', kill, geo: { latitude: 33.37, longitude: -117.58 } });
  const reqs = []; page.on('request', (q) => reqs.push(q.url()));
  await page.goto('http://127.0.0.1:3000/map', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  await page.evaluate(() => window.toggleLayer && window.toggleLayer('waves'));
  await page.waitForTimeout(2500);
  // GPS marker infobox (a GPS fix is not a catalogued spot: no series, no chart)
  const gpsBtn = page.locator('[data-testid=gps-location-btn]');
  const g = { surface: 'gps-infobox', theme, vp: vpName, kill, gpsBtn: await gpsBtn.count() };
  if (g.gpsBtn) { await gpsBtn.first().click({ force: true }); await page.waitForTimeout(3500); }
  g.mini = await page.locator('[data-testid=spot-mini-chart]').count();
  g.infobox = await page.getByText(/GFS (Forecast|Live)/).count();
  await page.screenshot({ path: `${OUT}/infobox-gps-${theme}-${vpName}${kill ? '-killswitch' : ''}.png` });
  results.push(g);
  // pinned spot -> drawer
  await page.fill('[data-testid=map-spot-search-input]', 'Fixture');
  await page.waitForTimeout(800);
  await page.click('[data-testid=search-result-spot-1]');
  await page.waitForTimeout(4500);
  const d = { surface: 'drawer', theme, vp: vpName, kill };
  d.chart = await page.locator('[data-testid=spot-forecast-chart]').count();
  d.oldRows = await page.locator('button[aria-label^="Surf forecast,"], button[aria-label="Calendar"]').count();
  if (d.chart) {
    d.days = await page.locator('[data-testid=spot-forecast-chart] [data-testid=spot-chart-day]').count();
    d.locked = await page.locator('[data-testid=spot-forecast-chart] [data-testid=spot-chart-locked-day]').count();
    const before = await page.evaluate(() => document.querySelector('[data-testid=spot-chart-slider]').getAttribute('aria-valuenow'));
    d.slider = await sliderChecks(page, '[data-testid=spot-forecast-chart] [data-testid=spot-chart-slider]');
    await page.keyboard.press('Home'); await page.waitForTimeout(400);
  }
  await page.screenshot({ path: `${OUT}/drawer-free-${theme}-${vpName}${kill ? '-killswitch' : ''}.png` });
  results.push(d);
  // close the drawer -> the selected spot's infobox
  await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
  const i = { surface: 'spot-infobox', theme, vp: vpName, kill };
  i.mini = await page.locator('[data-testid=spot-mini-chart]').count();
  if (i.mini) {
    i.miniVisible = await page.locator('[data-testid=spot-mini-chart]').first().isVisible();
    i.miniLabel = await page.locator('[data-testid=spot-mini-chart-slider]').first().getAttribute('aria-label');
    i.miniReadout = await page.locator('[data-testid=spot-mini-chart-readout]').first().innerText();
    i.miniBars = await page.locator('[data-testid=spot-mini-chart] [data-testid=spot-chart-bar]').count();
  }
  await page.screenshot({ path: `${OUT}/infobox-spot-${theme}-${vpName}${kill ? '-killswitch' : ''}.png` });
  results.push(i);
  const errs = [...new Set(errors)];
  d.errors = errs.filter((e) => !NOISE.test(e)).map((e) => e.slice(0, 160));
  d.noiseErrors = errs.filter((e) => NOISE.test(e)).length;
  d.seriesRequests = reqs.filter((u) => u.includes('/weather/spot-series/')).length;
  await browser.close();
}
(async () => {
  for (const th of THEMES) for (const vp of Object.keys(VPS)) { await hub(th, vp); await map(th, vp); }
  for (const th of THEMES) { await hub(th, 'desktop', true); }
  await hub('dark', 'phone', true); await map('dark', 'desktop', true); await map('light', 'phone', true);
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
  console.log('done', results.length);
})();
