const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { createRequire } = require('module');
const assert = require('assert/strict');

async function main() {
  const root = path.resolve(process.env.RAW_SUPPORT_COMBINED_ROOT);
  const frontend = path.join(root, 'frontend');
  const deps = process.env.RAW_SUPPORT_TEST_DEPS;
  const runtime = createRequire(path.join(deps, '../package.json'));
  const out = path.join(__dirname, '.run/browser'); fs.mkdirSync(out, { recursive: true });
  const sourcePaths = ['components/support/SupportInbox.js', 'components/support/supportRoutes.js', 'components/Auth.js',
    'components/support/SupportRoute.js', 'components/routing/ProtectedRoute.js'];
  const hashes = () => Object.fromEntries(sourcePaths.map(p => [p, { sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(frontend, 'src', p))).digest('hex') }]));
  const before = hashes();
  const imports = name => JSON.stringify(path.join(frontend, 'src', name));
  fs.writeFileSync(path.join(out, 'entry.jsx'), `import React from 'react'; import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom'; import { AuthProvider } from ${JSON.stringify(path.join(__dirname, 'auth.jsx'))};
import { ThemeProvider } from ${imports('contexts/ThemeContext.js')}; import { Auth } from ${imports('components/Auth.js')};
import SupportRoute from ${imports('components/support/SupportRoute.js')};
createRoot(document.getElementById('root')).render(<BrowserRouter><AuthProvider><ThemeProvider><Routes>
<Route path="/auth" element={<Auth />} /><Route path="/support" element={<SupportRoute />} />
<Route path="/support/tickets/:ticketId" element={<SupportRoute />} /></Routes></ThemeProvider></AuthProvider></BrowserRouter>);`);
  fs.writeFileSync(path.join(out, 'shell.jsx'), `export default function Shell({children}) { return children; }`);
  fs.writeFileSync(path.join(out, 'mfa.jsx'), 'export const MfaChallengeStep=()=>null; export const MfaSetupStep=()=>null; export const PasskeySignInButton=()=>null;');
  const replacements = new Map([
    ['contexts/AuthContext', path.join(__dirname, 'auth.jsx')], ['lib/apiClient', path.join(__dirname, 'transport.js')],
    ['components/routing/AppLayout', path.join(out, 'shell.jsx')], ['components/routing/TosReacceptanceGate', path.join(out, 'shell.jsx')],
    ['components/security/MfaSignInSteps', path.join(out, 'mfa.jsx')],
  ].map(([relative, target]) => [path.resolve(frontend, 'src', relative), target]));
  const webpack = runtime('webpack');
  const compiler = webpack({ mode: 'development', devtool: false, context: frontend, entry: path.join(out, 'entry.jsx'),
    output: { path: out, filename: 'fixture.js' }, resolve: { extensions: ['.js', '.jsx', '.json'], modules: [deps, 'node_modules'] },
    module: { rules: [{ test: /\.[jt]sx?$/, exclude: /node_modules/, use: { loader: runtime.resolve('babel-loader'), options: {
      presets: [[runtime.resolve('@babel/preset-env'), { targets: { chrome: '110' } }], [runtime.resolve('@babel/preset-react'), { runtime: 'automatic' }]],
    } } }] }, plugins: [new webpack.NormalModuleReplacementPlugin(/.*/, resource => {
      const replacement = replacements.get(path.resolve(resource.context, resource.request).replace(/\.(js|jsx)$/, ''));
      if (replacement) resource.request = replacement;
    })],
  });
  await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors()
    ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve())));
  const config = runtime(path.join(frontend, 'tailwind.config.js'));
  config.content = [path.join(frontend, 'src/components/support/*.js'), path.join(frontend, 'src/components/Auth.js'), path.join(frontend, 'src/components/ui/*.{js,jsx}')];
  const css = fs.readFileSync(path.join(frontend, 'src/index.css'), 'utf8').replace(/^@import[^\n]*\n/gm, '');
  const styles = await runtime('postcss')([runtime('tailwindcss')(config)]).process(css, { from: undefined });
  fs.writeFileSync(path.join(out, 'fixture.css'), styles.css);
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'none'");
    const asset = { '/fixture.js': 'text/javascript', '/fixture.css': 'text/css' }[request.url];
    response.setHeader('Content-Type', `${asset || 'text/html'}; charset=utf-8`);
    if (asset) fs.createReadStream(path.join(out, request.url.slice(1))).pipe(response);
    else response.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { chromium, expect } = runtime('@playwright/test'); let browser;
  const ID = 'abcdef01-2345-4789-abcd-ef0123456789'; const upper = `/support/tickets/${ID.toUpperCase()}`;
  const results = [];
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const theme of ['light', 'dark', 'beach']) for (const [device, viewport] of Object.entries({ desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } })) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' }); const external = [], errors = [];
      await context.route('**/*', route => { if (route.request().url().startsWith(`${origin}/`)) return route.continue(); external.push(route.request().url()); return route.abort(); });
      await context.addInitScript(value => localStorage.setItem('raw-surf-theme', value), theme);
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + upper); await expect(page.getByTestId('login-tab')).toBeVisible();
      assert.equal(new URL(page.url()).searchParams.get('redirect'), upper);
      await page.getByTestId('category-surfer').click(); await page.getByTestId('login-tab').click();
      assert.equal(new URL(page.url()).searchParams.get('redirect'), `/support/tickets/${ID}`);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.locator('input[type=email]').fill('uppercase@example.invalid'); await page.locator('input[type=email]').press('Tab');
      await page.locator('input[type=password]').fill('synthetic-input'); await expect(page.locator('input[type=email]')).toHaveValue('uppercase@example.invalid');
      await page.locator('form').getByRole('button', { name: 'Log In', exact: true }).click();
      await expect(page).toHaveURL(`${origin}/support/tickets/${ID}`); await expect(page.getByText('Synthetic case details', { exact: true })).toBeVisible();
      const reply = page.getByLabel('Your reply', { exact: true }); await reply.fill('Case alias draft');
      const reads = await page.evaluate(() => window.uppercaseFixture.requests.filter(r => r.method === 'get' && !r.url.includes('?')).length);
      await page.evaluate(value => { history.pushState({}, '', value); dispatchEvent(new PopStateEvent('popstate')); }, upper);
      await expect(reply).toHaveValue('Case alias draft');
      assert.equal(await page.evaluate(() => window.uppercaseFixture.requests.filter(r => r.method === 'get' && !r.url.includes('?')).length), reads);
      await page.goto(origin + upper); await expect(page.getByText('Synthetic case details', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /TEST-CASE Synthetic case request/ })).toHaveAttribute('aria-pressed', 'true');
      await reply.fill('Synthetic uppercase browser reply'); await page.evaluate(() => { window.uppercaseFixture.failReply = true; });
      await page.getByRole('button', { name: 'Send reply', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Reply not confirmed');
      await page.getByRole('button', { name: 'Send reply', exact: true }).click(); await expect(reply).toHaveValue('');
      const posts = await page.evaluate(() => window.uppercaseFixture.requests.filter(r => r.method === 'post'));
      assert.equal(posts.length, 2); assert.deepEqual(posts[0], posts[1]); assert.equal(posts[0].url, `/support/tickets/${ID}/messages`);
      await expect(page.getByText('Synthetic uppercase browser reply', { exact: true })).toHaveCount(1);
      await page.screenshot({ path: path.join(out, `${theme}-${device}.png`), fullPage: true });
      await page.evaluate(() => window.uppercaseFixture.setUser({ id: '22222222-2222-4222-8222-222222222222', role: 'Surfer' }));
      await expect(page.getByText('Synthetic case details', { exact: true })).toHaveCount(0); await expect(page.getByRole('alert')).toContainText('Ticket unavailable');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.deepEqual(external, []); assert.deepEqual(errors, []);
      results.push({ theme, device, passed: true, externalRequests: 0, pageErrors: 0, horizontalOverflow: false,
        cases: ['uppercase signed-out route', 'actual Auth canonical return', 'Grom owner reader', 'case aliases retain draft/detail',
          'uppercase direct reload', 'canonical selection', 'canonical retry URL/key and one reply', 'account switch hides old conversation'] });
      console.log(`PASS ${theme}/${device}`); await context.close();
    }
    assert.deepEqual(hashes(), before, 'Frozen support source unchanged');
    fs.writeFileSync(path.join(__dirname, 'browser-results.json'), JSON.stringify({ passed: results.length, total: 6, results, source: before,
      node: process.version, browser: browser.version(), seams: ['synthetic Auth identity/API; actual Auth/ProtectedRoute/SupportRoute/Inbox/Theme/CSS/router',
        'fixture route table; AppLayout/ToS/MFA frames substituted; backend actual API separately verified; no full-App/device/provider claim'] }, null, 2) + '\n');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
