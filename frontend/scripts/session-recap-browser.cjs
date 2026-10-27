// Bounded, offline browser qualification of the real recap/gallery consumer and action hooks.
// Run from frontend with RECAP_BROWSER_OUTPUT pointing to a fresh, private output directory.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const cp = require('child_process');
const front = path.resolve(__dirname, '..');
const root = path.dirname(front);
const deps = path.join(front, 'node_modules');
const webpack = require(path.join(deps, 'webpack'));
const { chromium } = require(path.join(deps, 'playwright'));
const out = process.env.RECAP_BROWSER_OUTPUT;
if (!out || fs.existsSync(out)) throw Error('A fresh RECAP_BROWSER_OUTPUT directory is required');
fs.mkdirSync(out, { recursive: true });
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const sourceCommit = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const requests = [], unexpected = [], fixtureState = new Map();
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#164e63"/><path d="M0 300 Q160 100 320 300 T640 300" stroke="#67e8f9" stroke-width="24" fill="none"/><text x="24" y="440" fill="white" font-size="24">SYNTHETIC MEDIA</text></svg>';
const image = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
const photos = id => [0, 1].map(i => ({ id: `${id}-photo-${i}`, photographer_id: 'fixture-pro', title: `Synthetic Photo ${i + 1}`, media_type: 'photo', preview_url: image, price_credits: 5 }));
function galleries(scenario) {
  if (scenario === 'missing') return [];
  const old = scenario === 'old';
  const gallery = id => ({ id, photographer_id: 'fixture-pro', title: id === 'fixture-b' ? 'Second synthetic session gallery' : scenario === 'long-title' ? 'Synthetic dawn session with an unusually long gallery title for small screen verification' : 'Synthetic dawn session', live_session_id: 'session-a', surf_spot_name: 'Fixture Beach', item_count: 2, created_at: new Date(Date.now() - (old ? 72 : 1) * 3600000).toISOString() });
  return scenario === 'multiple' ? [gallery('fixture-a'), gallery('fixture-b')] : [gallery('fixture-a'), { ...gallery('fixture-next'), title: 'Next synthetic session', live_session_id: 'session-b' }];
}
function reply(request, url, method, body) {
  const scenario = request.headers['x-fixture-scenario'] || 'ready';
  const id = request.headers['x-fixture-case'] || 'unknown';
  const state = fixtureState.get(id) || { listReads: 0, delivered: false };
  fixtureState.set(id, state);
  const pathname = url.pathname;
  let status = 200, data;
  if (method === 'GET' && pathname === '/galleries/photographer/fixture-pro') {
    state.listReads++;
    if (scenario === 'denied') status = 403;
    if (scenario === 'not-found') status = 404;
    if (scenario === 'retry' && state.listReads === 1) status = 503;
    data = scenario === 'malformed-list' ? { unexpected: 'not an array' } : galleries(scenario);
  } else if (method === 'GET' && /^\/gallery\/[^/]+\/session-participants$/.test(pathname)) {
    data = scenario === 'malformed-roster' ? { participants: null } : { participants: scenario === 'empty' ? [] : [0, 1].map(i => ({ surfer_id: `fixture-surfer-${i}`, full_name: `Synthetic Surfer ${i + 1}`, photos_credit_remaining: 1, items_distributed: state.delivered ? 2 : 0 })), session: { is_linked: true, session_type: 'live' } };
  } else if (method === 'GET' && /^\/galleries\/[^/]+\/items$/.test(pathname)) {
    data = scenario === 'malformed-items' ? { unexpected: 'not an array' } : scenario === 'empty' ? [] : photos(pathname.split('/')[2]);
  } else if (method === 'GET' && pathname === '/gallery/photographer/fixture-pro') data = photos('fixture-a');
  else if (method === 'GET' && pathname.endsWith('/ai-clusters')) data = { clusters: [] };
  else if (method === 'GET' && pathname.endsWith('/watermark-settings')) data = { watermark_style: 'text', watermark_text: 'SYNTHETIC FIXTURE', watermark_opacity: 0.5, watermark_position: 'bottom-right' };
  else if (method === 'GET' && pathname.endsWith('/conditions-status')) data = { has_spot: false, has_active_report: false };
  else if (method === 'POST' && /^\/gallery\/[^/]+\/distribute$/.test(pathname)) { if (scenario === 'action-error') status = 503; else state.delivered = true; data = { total_distributed: 4 }; }
  else if (method === 'POST' && pathname === '/gallery/trigger-ai-match') { if (scenario === 'action-error') status = 503; data = { matches_found: 2, items_processed: 2 }; }
  else if (method === 'POST' && pathname === '/gallery/generate-watermark-preview') data = { preview_url: image };
  else if (method === 'GET' && pathname === '/profiles/search') data = [{ id: 'fixture-search-surfer', full_name: 'Synthetic Search Surfer', username: 'fixture-surfer' }];
  else if (method === 'POST' && /^\/gallery\/[^/]+\/tag-item$/.test(pathname)) data = { already_tagged: false };
  else { status = 418; data = { detail: 'Unexpected synthetic fixture request' }; unexpected.push({ id, method, pathname }); }
  if (status !== 200) data = { detail: `Synthetic ${status} fixture response` };
  requests.push({ id, scenario, method, pathname, query: Object.fromEntries(url.searchParams), body, status });
  return { status, data, delay: scenario === 'slow' && pathname === '/galleries/photographer/fixture-pro' && state.listReads === 1 ? 500 : method === 'POST' ? 180 : 10 };
}
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter,Routes,Route,Link}from'react-router-dom';import SessionRecapPage from '${front.replace(/\\/g, '/')}/src/pages/SessionRecapPage';import{GalleryPage}from'${front.replace(/\\/g, '/')}/src/components/GalleryPage';import{ThemeProvider}from'${front.replace(/\\/g, '/')}/src/contexts/ThemeContext';import{Toaster}from'sonner';localStorage.setItem('raw-surf-theme',new URLSearchParams(location.search).get('theme')||'dark');window.__recapRequests=[];window.__fixtureScenario=new URLSearchParams(location.search).get('scenario')||'ready';window.__fixtureCase=new URLSearchParams(location.search).get('case')||'unknown';createRoot(document.getElementById('root')).render(<ThemeProvider><BrowserRouter><div className="w-full min-w-0 flex flex-col"><nav aria-label="Synthetic fixture navigation" style={{padding:8}}><Link to={'/session-recap/session-b'+location.search}>Fixture: next session</Link></nav><main className="w-full min-w-0"><Routes><Route path="/session-recap/:sessionId" element={<SessionRecapPage/>}/><Route path="/gallery" element={<GalleryPage/>}/></Routes></main><Toaster/></div></BrowserRouter></ThemeProvider>);`;
const mocks = {
  AuthContext: `export const useAuth=()=>({user:{id:'fixture-pro',role:'Photographer',full_name:'Synthetic Photographer'}});`,
  PersonaContext: `export const usePersona=()=>({getEffectiveRole:x=>x,isGodMode:false,activePersona:null});`,
  PricingContext: `const pricing={generalSettings:null,lastUpdated:0,getDisplayPrice:()=>({price:5}),updateGeneralSettings:async()=>({success:true}),setItemCustomPrice:async()=>({success:true,data:{}}),clearItemCustomPrice:async()=>({success:true})};export const usePricing=()=>pricing;`,
  apiClient: `export const BACKEND_URL='';export const API_URL='/fixture-api';async function call(method,url,body,options={}){const u=new URL('/fixture-api'+url,location.origin);Object.entries(options.params||{}).forEach(([k,v])=>u.searchParams.set(k,v));const receipt={method,url:u.pathname.slice(12)+u.search,body};window.__recapRequests.push(receipt);const response=await fetch(u,{method,signal:options.signal,headers:{'Content-Type':'application/json','x-fixture-scenario':window.__fixtureScenario,'x-fixture-case':window.__fixtureCase},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();receipt.status=response.status;if(!response.ok){const e=new Error(data.detail);e.response={status:response.status,data};throw e;}return{data};}export default{get:(u,o)=>call('GET',u,undefined,o),post:(u,b,o)=>call('POST',u,b,o),put:(u,b,o)=>call('PUT',u,b,o),patch:(u,b,o)=>call('PATCH',u,b,o),delete:(u,o)=>call('DELETE',u,undefined,o)};`,
};
async function compile() {
  process.env.BABEL_ENV = 'development';
  fs.writeFileSync(path.join(out, 'entry.js'), entry);
  for (const [name, contents] of Object.entries(mocks)) fs.writeFileSync(path.join(out, name + '.js'), contents);
  const sourceFiles = [];
  await new Promise((resolve, reject) => webpack({ mode: 'development', devtool: false, entry: path.join(out, 'entry.js'), output: { path: out, filename: 'app.js' }, resolve: { modules: [deps, 'node_modules'], extensions: ['.js', '.jsx'], alias: { '@': path.join(front, 'src') } }, module: { rules: [{ test: /\.jsx?$/, exclude: /node_modules/, use: { loader: path.join(deps, 'babel-loader'), options: { babelrc: false, configFile: false, presets: [[path.join(deps, 'babel-preset-react-app'), { runtime: 'automatic' }]] } } }] }, plugins: [new webpack.NormalModuleReplacementPlugin(/contexts[\\/]AuthContext$|contexts[\\/]PersonaContext$|contexts[\\/]PricingContext$|lib[\\/]apiClient$/, resource => { resource.request = path.join(out, resource.request.split(/[\\/]/).pop() + '.js'); })] }, (error, stats) => {
    if (error || stats.hasErrors()) return reject(error || Error(stats.toString({ all: false, errors: true })));
    for (const file of stats.compilation.fileDependencies) if (file.startsWith(path.join(front, 'src')) && fs.statSync(file).isFile()) sourceFiles.push({ path: path.relative(root, file).replace(/\\/g, '/'), rawSha256: sha(fs.readFileSync(file)) });
    resolve();
  }));
  const cssDir = process.env.RECAP_BROWSER_CSS_DIR || path.join(root, '..', 'recap-production-build', 'static', 'css');
  const cssPath = path.join(cssDir, fs.readdirSync(cssDir).find(name => /^main\..+\.css$/.test(name)));
  const css = fs.readFileSync(cssPath, 'utf8');
  fs.writeFileSync(path.join(out, 'style.css'), css.replace(/@import[^;]+;/g, ''));
  fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  return { sourceFiles, css: { path: cssPath, originalSha256: sha(css), fixtureSha256: sha(fs.readFileSync(path.join(out, 'style.css'))), note: 'Actual checkpoint production CSS; external font imports removed; system fallback font, not branded-font acceptance' } };
}
async function main() {
  const compiled = await compile();
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname.startsWith('/fixture-api/')) {
      let body = ''; for await (const part of request) body += part;
      const result = reply(request, new URL(url.pathname.slice(12) + url.search, 'http://localhost'), request.method, body ? JSON.parse(body) : null);
      setTimeout(() => { response.writeHead(result.status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result.data)); }, result.delay); return;
    }
    const name = ['/app.js', '/style.css'].includes(url.pathname) ? url.pathname.slice(1) : 'index.html';
    response.writeHead(200, { 'Content-Type': name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html' }); response.end(fs.readFileSync(path.join(out, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-proxy-server'] });
  const browserVersion = browser.version();
  const results = [], network = [], consoleMessages = [];
  let counter = 0;
  const selected = (theme, width, scenario) => (!process.env.RECAP_BROWSER_THEMES || process.env.RECAP_BROWSER_THEMES.split(',').includes(theme)) && (!process.env.RECAP_BROWSER_WIDTHS || process.env.RECAP_BROWSER_WIDTHS.split(',').includes(String(width))) && (!process.env.RECAP_BROWSER_SCENARIOS || process.env.RECAP_BROWSER_SCENARIOS.split(',').includes(scenario));
  async function newCase(theme, viewport, scenario) {
    const id = `${++counter}-${theme}-${viewport.width}-${scenario}`;
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    page.setDefaultTimeout(6000);
    page.on('pageerror', error => consoleMessages.push({ id, kind: 'pageerror', message: error.message }));
    page.on('console', msg => { if (['error', 'warning'].includes(msg.type())) consoleMessages.push({ id, kind: msg.type(), message: msg.text() }); });
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(origin + '/')) return route.continue();
      network.push({ id, url, disposition: 'intercepted fixture; no external request sent' });
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg });
    });
    await page.goto(`${origin}/session-recap/session-a?theme=${theme}&scenario=${scenario}&case=${id}`, { waitUntil: 'domcontentloaded' });
    return { page, id, theme, viewport, scenario, checks: [], observations: [] };
  }
  async function check(row, name, fn) { try { await fn(); row.checks.push({ name, passed: true }); } catch (error) { row.checks.push({ name, passed: false, error: error.message.slice(0, 900) }); } }
  async function layout(row) {
    row.layout = await row.page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, themeClasses: document.documentElement.className, bodyBackground: getComputedStyle(document.body).backgroundColor, overflow: document.documentElement.scrollWidth > innerWidth + 1, fonts: document.fonts.status, expanded: [...document.querySelectorAll('button[aria-expanded]')].map(e => ({ name: e.textContent.trim(), expanded: e.getAttribute('aria-expanded') })), clipped: [...document.querySelectorAll('button,a,h1,h3')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height && (r.left < -1 || r.right > innerWidth + 1) && !e.closest('[class*="overflow-x-auto"]'); }).map(e => ({ tag: e.tagName, name: e.textContent.trim().slice(0, 100) })) }));
    row.layout.overflowingNodes = await row.page.evaluate(() => [...document.querySelectorAll('div,button,p,h1,h3')].map(e => ({ tag: e.tagName, classes: e.className, width: e.getBoundingClientRect().width, client: e.clientWidth, scroll: e.scrollWidth, name: e.textContent.trim().slice(0, 80), display: getComputedStyle(e).display, minWidth: getComputedStyle(e).minWidth, overflow: getComputedStyle(e).overflowX })).filter(x => x.width > innerWidth || x.scroll > x.client + 1).slice(0, 20));
    await check(row, 'no page horizontal overflow', () => { if (row.layout.overflow) throw Error(JSON.stringify(row.layout)); });
    await check(row, 'primary controls remain inside viewport', () => { const clipped = row.layout.clipped.filter(x => x.tag === 'BUTTON'); if (clipped.length) throw Error(JSON.stringify(clipped)); });
    await row.page.evaluate(() => document.fonts.ready);
    const media = row.page.locator('[data-testid^="gallery-item-"] img').first();
    if (await media.count()) { await media.scrollIntoViewIfNeeded(); await media.evaluate(e => e.decode()); await row.page.getByRole('link', { name: 'Fixture: next session' }).scrollIntoViewIfNeeded(); }
    await row.page.screenshot({ path: path.join(out, row.id + '.png'), fullPage: true });
    row.screenshot = row.id + '.png';
  }
  async function ready(row) { await row.page.getByTestId('gallery-page').waitFor(); await row.page.getByTestId('gallery-item-fixture-a-photo-0').waitFor(); }
  async function noWrites(row, label) { await check(row, label, async () => { const list = await row.page.evaluate(() => window.__recapRequests.filter(r => r.method !== 'GET')); if (list.length) throw Error(JSON.stringify(list)); }); }
  try {
    for (const theme of ['light', 'dark', 'beach']) for (const viewport of [{ width: 320, height: 740 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
      if (!selected(theme, viewport.width, 'ready')) continue;
      const row = await newCase(theme, viewport, 'ready'), page = row.page;
      await ready(row); await noWrites(row, 'recap entry performs no writes'); await layout(row);
      const toggle = page.getByRole('button', { name: /^Session Gallery/ });
      await check(row, 'keyboard collapse/expand restores actions', async () => { await toggle.focus(); await toggle.press('Enter'); if (await page.getByRole('button', { name: 'Manual Tag', exact: true }).count()) throw Error('Collapsed actions remain'); await toggle.press('Enter'); await page.getByRole('button', { name: 'Manual Tag', exact: true }).waitFor(); });
      await check(row, 'distribution targets exact selected gallery', async () => { const button = page.getByRole('button', { name: 'Distribute All to Lockers', exact: true }); await button.click(); await page.waitForFunction(() => document.querySelector('button[aria-label="Distribute All to Lockers"]')?.disabled); await page.waitForFunction(() => window.__recapRequests.some(r => r.method === 'POST' && r.url.includes('/distribute?') && r.status === 200)); const req = await page.evaluate(() => window.__recapRequests.filter(r => r.method === 'POST')); if (req.length !== 1 || req[0].url !== '/gallery/fixture-a/distribute?photographer_id=fixture-pro') throw Error(JSON.stringify(req)); });
      await check(row, 'AI action targets exact selected gallery', async () => { await page.getByRole('button', { name: 'AI Tag', exact: true }).click(); await page.waitForFunction(() => window.__recapRequests.some(r => r.url.includes('/trigger-ai-match?') && r.status === 200)); const req = await page.evaluate(() => window.__recapRequests.find(r => r.url.includes('/trigger-ai-match?'))); if (req.body.gallery_id !== 'fixture-a') throw Error(JSON.stringify(req)); });
      await check(row, 'manual action opens accessible tag/assign dialog', async () => {
        await page.getByText('AI matched 2 items to surfers! (2 processed)', { exact: true }).waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: 'Manual Tag', exact: true }).click(); const dialog = page.getByRole('dialog', { name: /Tag & Assign/ }); await dialog.waitFor({ timeout: 1800 });
        const bounds = await dialog.boundingBox(); if (bounds.x < -1 || bounds.x + bounds.width > viewport.width + 1 || bounds.y < -1 || bounds.y + bounds.height > viewport.height + 1) throw Error('Dialog exceeds viewport: ' + JSON.stringify(bounds));
        if (!await dialog.evaluate(e => e.contains(document.activeElement))) throw Error('Dialog did not receive focus');
        if (await dialog.evaluate(e => {
          const title = e.querySelector('h2'), close = e.querySelector('button.absolute');
          if (!title || !close) return true;
          const range = document.createRange(); range.selectNodeContents(title); const text = range.getBoundingClientRect(), button = close.getBoundingClientRect();
          return text.right > button.left - 2 && text.top < button.bottom && text.bottom > button.top;
        })) throw Error('Dialog title overlaps its close control');
        await page.keyboard.press('Tab'); if (!await dialog.evaluate(e => e.contains(document.activeElement))) throw Error('Focus escaped dialog');
        await page.screenshot({ path: path.join(out, row.id + '-manual-dialog.png') }); row.manualScreenshot = row.id + '-manual-dialog.png';
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
      });
      row.requests = await page.evaluate(() => window.__recapRequests); delete row.page; results.push(row); await page.close();
    }
    for (const theme of ['light', 'dark', 'beach']) for (const scenario of ['missing', 'denied', 'not-found', 'malformed-list', 'malformed-roster', 'malformed-items', 'retry', 'multiple', 'empty', 'old', 'long-title', 'slow', 'action-error', 'manual-assignment']) {
      if (!selected(theme, 360, scenario)) continue;
      const row = await newCase(theme, { width: 360, height: 800 }, scenario), page = row.page;
      await check(row, 'scenario renders and responds correctly', async () => {
        if (['missing', 'denied', 'not-found', 'malformed-list', 'malformed-roster', 'malformed-items', 'retry'].includes(scenario)) {
          const message = scenario === 'missing' ? 'No gallery was found' : scenario === 'denied' ? 'You do not have access' : scenario === 'not-found' ? 'no longer available' : 'Could not load';
          await page.getByRole('alert').filter({ hasText: message }).waitFor();
          if (scenario === 'retry') { await page.getByRole('button', { name: 'Try again' }).dblclick(); await ready(row); if (await page.evaluate(() => window.__recapRequests.filter(r => r.url === '/galleries/photographer/fixture-pro').length) !== 3) throw Error('Retry request counts: route initial + retry + Gallery Hub background list expected'); }
          else if (scenario === 'missing') { await page.getByRole('link', { name: 'Open Gallery Hub' }).click(); await page.getByRole('heading', { name: 'Gallery Hub', exact: true }).waitFor(); row.observations.push('Ordinary Gallery Hub automatic preview is retained after explicit navigation'); }
        } else if (scenario === 'multiple') {
          await page.getByRole('button', { name: 'Second synthetic session gallery', exact: true }).waitFor();
          if (await page.evaluate(() => window.__recapRequests.some(r => r.url.includes('/session-participants')))) throw Error('Gallery was chosen without consent');
          await page.getByRole('button', { name: 'Second synthetic session gallery', exact: true }).click(); await page.getByTestId('gallery-item-fixture-b-photo-0').waitFor();
          await page.getByRole('button', { name: 'AI Tag', exact: true }).click(); await page.waitForFunction(() => window.__recapRequests.some(r => r.body?.gallery_id === 'fixture-b' && r.status === 200));
        } else if (scenario === 'empty') { await page.getByText('No items in this gallery yet').waitFor(); if (await page.getByRole('button', { name: 'Distribute All to Lockers' }).isEnabled()) throw Error('Empty roster distribution is enabled'); }
        else if (scenario === 'old') { await ready(row); await page.getByRole('status').filter({ hasText: 'older than 48 hours' }).waitFor(); if (await page.getByRole('button', { name: /^Session Gallery/ }).count()) throw Error('Old summary still present'); }
        else if (scenario === 'slow') { await page.getByRole('status').filter({ hasText: 'Loading session recap' }).waitFor(); await page.getByRole('link', { name: 'Fixture: next session' }).click(); await page.getByTestId('gallery-item-fixture-next-photo-0').waitFor(); if (await page.getByTestId('gallery-item-fixture-a-photo-0').count()) throw Error('Stale session mounted'); }
        else if (scenario === 'action-error') { await ready(row); await page.getByRole('button', { name: 'Distribute All to Lockers' }).click(); await page.getByText('Synthetic 503 fixture response', { exact: true }).waitFor(); if (!await page.getByRole('button', { name: 'Distribute All to Lockers' }).isEnabled()) throw Error('Distribution failed without re-enabling'); }
        else if (scenario === 'manual-assignment') {
          await ready(row); await noWrites(row, 'manual entry starts without writes');
          await page.getByRole('button', { name: 'Manual Tag', exact: true }).click(); const dialog = page.getByRole('dialog', { name: /Tag & Assign/ }); await dialog.waitFor();
          await dialog.getByRole('textbox', { name: 'Search surfer by name or username...' }).fill('Fixture');
          await dialog.getByRole('button', { name: 'Tag & Send to Synthetic Search Surfer', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
          const tagged = await page.evaluate(() => window.__recapRequests.filter(r => r.method === 'POST'));
          if (tagged.length !== 2 || tagged.some(r => r.url !== '/gallery/fixture-a/tag-item?photographer_id=fixture-pro' || r.body.surfer_id !== 'fixture-search-surfer') || tagged.map(r => r.body.item_id).sort().join(',') !== 'fixture-a-photo-0,fixture-a-photo-1') throw Error(JSON.stringify(tagged));
        }
        else await ready(row);
      });
      if (!['multiple', 'missing', 'action-error', 'manual-assignment'].includes(scenario)) await noWrites(row, 'reads/error/selection state causes no preview or other writes');
      await layout(row); row.requests = await page.evaluate(() => window.__recapRequests); delete row.page; results.push(row); await page.close();
    }
  } finally { await browser.close(); server.close(); }
  const report = { sourceCommit, workingDiffSha256: sha(cp.execFileSync('git', ['diff', '--', 'frontend/src'], { cwd: root })), sourceScope: 'Real SessionRecapPage route, GalleryPage and descendants, installed router, real gallery action hooks; fixture Auth/Pricing/Persona/API only. Corrected block-level fixture content wrapper; App shell/auth/server/provider/media entitlement acceptance excluded.', ...compiled, harnessSha256: sha(fs.readFileSync(__filename)), browser: 'Installed local Chrome in isolated Playwright profile; reduced motion; no real mobile device', browserVersion, nodeVersion: process.version, results, requests, unexpected, interceptedExternalImages: network, consoleMessages, failures: results.flatMap(r => r.checks.filter(c => !c.passed).map(c => ({ id: r.id, ...c }))), unrun: ['real mounted API authorization/private media/provider journeys', 'native iOS/Android/Safari, physical-device acceptance', 'App shell/navigation/serviceworker/deployed acceptance', 'branded remote fonts'] };
  fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ sourceCommit, cases: results.length, failedChecks: report.failures.length, unexpected: unexpected.length, pageErrors: consoleMessages.filter(x => x.kind === 'pageerror').length, output: out }));
  process.exitCode = report.failures.length || unexpected.length || consoleMessages.some(x => x.kind === 'pageerror') ? 1 : 0;
}
main().catch(error => { fs.writeFileSync(path.join(out, 'harness-error.txt'), error.stack); console.error(error); process.exitCode = 1; });
