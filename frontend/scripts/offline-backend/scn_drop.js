// After one far scrub jump, read the layer's own record of why it dropped the frame.
const L = require('./ab_lib.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const { browser, page } = await L.launch({ port: +(process.env.PORT || 4100) });
  try {
    await L.openMap(page); await L.jump(page, -108, 16, 2.6); await L.clickText(page, 'Waves'); await sleep(12000);
    await page.evaluate(() => document.querySelector('[role="slider"][aria-label*="Forecast timeline"]').focus());
    await page.keyboard.press('PageUp'); await sleep(12000);
    console.log(JSON.stringify(await page.evaluate(() => ({ drop: window.__SWELL2_LAST_DROP__, reason: window.__WEBGL_MARINE_UPLOAD_REASON__, ups: window.__WEBGL_MARINE_UPLOAD_COUNT__, parity: window.__MARINE_RENDER_HOUR_PARITY__ }))));
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
