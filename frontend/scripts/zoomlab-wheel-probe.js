/* zoomlab-wheel-probe.js — why does page.mouse.wheel not zoom the map on this host?
 * Opens /map like zoomlab, then: elementFromPoint at the wheel target, scrollZoom state,
 * one wheel with zoom readback, and a fallback wheel via CDP + via map.scrollZoom API. */
const path = require('path');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }
const BASE = process.env.ZL_BASE || 'http://localhost:3011';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => {
    const mockSW = { register: () => new Promise(() => {}), ready: new Promise(() => {}),
      addEventListener: () => {}, removeEventListener: () => {},
      getRegistration: () => Promise.resolve(null), getRegistrations: () => Promise.resolve([]) };
    Object.defineProperty(navigator, 'serviceWorker', { get() { return mockSW; }, configurable: true });
  });
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.map && window.map.loaded !== undefined, null, { timeout: 60000 });
  await page.waitForTimeout(4000);
  const probe1 = await page.evaluate(() => {
    const el = document.elementFromPoint(640, 400);
    const chain = [];
    let e = el;
    while (e && chain.length < 6) { chain.push(e.tagName + '.' + (e.className && String(e.className).slice(0, 60))); e = e.parentElement; }
    return {
      at: chain,
      zoom: window.map.getZoom(),
      scrollZoomEnabled: window.map.scrollZoom && window.map.scrollZoom.isEnabled(),
      canvasRect: window.map.getCanvas().getBoundingClientRect(),
    };
  });
  console.log('PROBE1', JSON.stringify(probe1, null, 1));
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(1500);
  const z1 = await page.evaluate(() => window.map.getZoom());
  console.log('after page.mouse.wheel:', z1);
  // CDP raw wheel at the canvas center
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY: 120 });
  await page.waitForTimeout(1500);
  const z2 = await page.evaluate(() => window.map.getZoom());
  console.log('after CDP mouseWheel:', z2);
  // Synthetic DOM WheelEvent on the canvas
  const z3 = await page.evaluate(() => new Promise((res) => {
    const c = window.map.getCanvas();
    c.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, clientX: 640, clientY: 400, bubbles: true, cancelable: true }));
    setTimeout(() => res(window.map.getZoom()), 1500);
  }));
  console.log('after DOM WheelEvent on canvas:', z3);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
