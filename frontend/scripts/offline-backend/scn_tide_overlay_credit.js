// TIDE OVERLAY CREDIT on a phone (2026-11-22, the advisor on #923): is the overlay's data credit VISIBLE in full at 375 px in
// each theme, and clear of the mobile scrubber / wheel? Offline only: the launcher keeps the app's API host unreached; this file
// answers /api/weather/point-tide from a local stub with a credited own-tide payload and /api/surf-spots with three North Shore
// spots, so the overlay draws markers and its credit. Writes one screenshot per theme plus a JSON of the credit's and the
// wheel's boxes (overlap and truncation checked in the page).
//
//   AB_BASE=http://127.0.0.1:<spa> OUT=<dir> node scn_tide_overlay_credit.js        Env: THEMES (light,dark,beach)
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('offline only');
const OUT = process.env.OUT || 'tide-credit-out';
const THEMES = (process.env.THEMES || 'light,dark,beach').split(',');
fs.mkdirSync(OUT, { recursive: true });

const now = Date.now();
const h0 = Math.floor(now / 3600e3) * 3600e3 - 6 * 3600e3;
const series = [...Array(78)].map((_, i) => ({ t: new Date(h0 + i * 3600e3).toISOString().replace('.000', ''),
  h: Math.round(0.4 * Math.sin((2 * Math.PI * i) / 12.42) * 1000) / 1000 }));
const PAYLOAD = {
  available: true, now: new Date(now).toISOString(), series, events: [], timezone: 'Pacific/Honolulu', datum: 'MSL',
  source: 'model-msl', cell_km: 11, coverage: [{ start: series[0].t, end: series[series.length - 1].t }],
  provider: 'FES2022 (CNES; LEGOS, NOVELTIS, CLS via AVISO) + Copernicus Marine',
  source_url: 'https://doi.org/10.24400/527896/A01-2024.004',
  credit_detail: 'The FES2022 Tide product was funded by CNES, produced by LEGOS, NOVELTIS and CLS and made freely available by AVISO. '
    + 'CNES, 2024. FES2022 (Finite Element Solution) Tidal model (Version 2024). CNES. https://doi.org/10.24400/527896/A01-2024.004. '
    + 'Licence: https://www.aviso.altimetry.fr/fileadmin/documents/data/License_Aviso.pdf.',
};
const SPOTS = [
  { id: 'p1', name: 'Pipeline', latitude: 21.665, longitude: -158.053, is_active: true },
  { id: 'p2', name: 'Sunset Beach', latitude: 21.678, longitude: -158.041, is_active: true },
  { id: 'p3', name: 'Haleiwa', latitude: 21.596, longitude: -158.108, is_active: true },
];

const stub = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const body = u.pathname.endsWith('/point-tide') ? PAYLOAD : { detail: 'not served by this stub' };
  res.writeHead(u.pathname.endsWith('/point-tide') ? 200 : 404, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
});

(async () => {
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const port = stub.address().port;
  const results = {};
  for (const theme of THEMES) {
    const { browser, page, log } = await L.launch({ port, width: 375, height: 812, dpr: 2, gpu: false,
      contextOptions: { isMobile: true, hasTouch: true } });
    await page.route(/\/api\/surf-spots(\?|$)/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(SPOTS) }));
    await page.addInitScript((t) => { localStorage.setItem('raw-surf-theme', t); localStorage.setItem('__TIDE_OVERLAY__', 'true'); }, theme);
    await L.openMap(page);
    await L.jump(page, -158.07, 21.64, 11.5);
    const measure = () => page.evaluate(() => {
        const el = document.querySelector('[data-testid="tide-overlay-credit"]');
        const r = el.getBoundingClientRect();
        const box = (x) => { const b = x.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; };
        const wheels = [...document.querySelectorAll('[role="slider"]')].filter((x) => x.offsetParent).map(box);
        const overlaps = wheels.filter((w) => !(w.right <= r.left || w.left >= r.right || w.bottom <= r.top || w.top >= r.bottom));
        // OCCLUSION: what is actually drawn on top at points across the credit (a bottom nav or panel can cover it while it is
        // "in the viewport"). Every probe must hit the credit itself or one of its children.
        const probes = [[0.1, 0.3], [0.5, 0.3], [0.9, 0.3], [0.1, 0.75], [0.5, 0.75], [0.9, 0.75]].map(([fx, fy]) => {
          const x = r.left + fx * r.width; const y = r.top + fy * r.height; const hit = document.elementFromPoint(x, y);
          return { x: Math.round(x), y: Math.round(y), ok: !!hit && (hit === el || el.contains(hit)),
            hit: hit ? `${hit.tagName.toLowerCase()}${hit.getAttribute('data-testid') ? '#' + hit.getAttribute('data-testid') : ''}` : null };
        });
        return { text: el.textContent, box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, height: r.height },
          occluded: probes.filter((p) => !p.ok), visibleEverywhere: probes.every((p) => p.ok),
          clipped: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1, inViewport: r.left >= 0 && r.right <= innerWidth
            && r.top >= 0 && r.bottom <= innerHeight, wheels, overlapsWheel: overlaps.length > 0,
          markers: document.querySelectorAll('[data-testid="tide-marker"]').length };
      });
    const shot = async (tag) => {
      let credit;
      try { await page.waitForSelector('[data-testid="tide-overlay-credit"]', { timeout: 20000 }); await page.waitForTimeout(1500); credit = await measure(); }
      catch (e) { credit = { error: String(e).slice(0, 200) }; }
      const file = path.join(OUT, `tide-credit-375-${theme}${tag}.png`);
      await page.screenshot({ path: file });
      return { file, credit };
    };
    results[theme] = { map: await shot('') };
    // The forecast wheel shows once a weather layer is on: open the layer sheet, pick Waves, close the sheet, measure again.
    try {
      await page.locator('button[aria-label="Weather layers"], button[aria-label="Expand weather controls"]').filter({ visible: true }).first().click({ timeout: 10000 });
      await page.waitForTimeout(800);
      await page.locator('button').filter({ hasText: /^\s*Waves\s*$/ }).filter({ visible: true }).first().click({ timeout: 10000 });
      await page.waitForTimeout(800);
      const close = page.locator('button[aria-label^="Close weather layers"]').filter({ visible: true }).first();
      if (await close.count()) await close.click({ timeout: 5000 });
      results[theme].wheel = await shot('-wheel');
    } catch (e) { results[theme].wheel = { error: String(e).slice(0, 200) }; }
    results[theme].errors = log.errors.slice(0, 3);
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, 'tide-credit-375.json'), JSON.stringify(results, null, 1));
  console.log(JSON.stringify(results, null, 1));
  stub.close();
})();
