const { chromium } = require('playwright');
const ALLOWED = /^http:\/\/127\.0\.0\.1:(3000|8765)\//;
async function open({ theme = 'dark', vp = { width: 1440, height: 900 }, tier = 'free', kill = false, geo = null, phone = false }) {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone,
    permissions: geo ? ['geolocation'] : [], geolocation: geo || undefined });
  const blocked = []; const errors = [];
  await ctx.route('**/*', (r) => { const u = r.request().url(); if (ALLOWED.test(u) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); blocked.push(u); return r.abort(); });
  await ctx.addInitScript(({ theme, tier, kill }) => {
    localStorage.setItem('raw-surf-theme', theme);
    localStorage.setItem('__RAW_TUNER__', '0'); localStorage.setItem('__RAW_DIAG__', '0');
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: false, timestamp: Date.now() }));
    localStorage.setItem('raw-surf-user', JSON.stringify({ id: 'u-fixture', email: 'fixture@example.invalid', full_name: 'Fixture Surfer', username: 'fixture', role: 'Surfer', subscription_tier: tier, access_token: 'fixture-token' }));
    if (kill) window.__RAW_DISABLE_SPOT_HUB_CHARTS__ = true;
  }, { theme, tier, kill });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  return { browser, ctx, page, blocked, errors };
}
module.exports = { open };
