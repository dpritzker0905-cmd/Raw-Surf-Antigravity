const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const assert = require('assert/strict');
const { createRequire } = require('module');

async function main() {
  const root = path.resolve(process.env.RAW_SUPPORT_COMBINED_ROOT);
  const frontend = path.join(root, 'frontend');
  const deps = process.env.RAW_SUPPORT_TEST_DEPS;
  const runtime = createRequire(path.join(deps, '../package.json'));
  const out = path.join(__dirname, '.run/browser'); fs.mkdirSync(out, { recursive: true });
  const observed = ['lib/apiClient.js', 'lib/sessionRejection.js', 'lib/userScopedStorage.js', 'components/Auth.js',
    'components/security/MfaSignInSteps.js', 'components/support/supportRoutes.js', 'components/support/SupportInbox.js',
    'components/support/SupportRoute.js', 'components/routing/ProtectedRoute.js'];
  const hashes = () => Object.fromEntries(observed.map(p => [p, { sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(frontend, 'src', p))).digest('hex') }]));
  const before = hashes();
  const source = name => JSON.stringify(path.join(frontend, 'src', name));
  fs.writeFileSync(path.join(out, 'entry.jsx'), `import React from 'react'; import {createRoot} from 'react-dom/client';
import {BrowserRouter,Route,Routes} from 'react-router-dom';import {Toaster} from 'sonner';
import {configureAdapter} from ${JSON.stringify(path.join(__dirname, 'adapter.js'))};
import {AuthProvider} from ${JSON.stringify(path.join(__dirname, 'auth.jsx'))};
import {ThemeProvider} from ${source('contexts/ThemeContext.js')};import {Auth} from ${source('components/Auth.js')};
import SupportRoute from ${source('components/support/SupportRoute.js')};configureAdapter();
createRoot(document.getElementById('root')).render(<BrowserRouter><AuthProvider><ThemeProvider><Routes>
<Route path="/auth" element={<Auth/>}/><Route path="/support" element={<SupportRoute/>}/>
<Route path="/support/tickets/:ticketId" element={<SupportRoute/>}/></Routes><Toaster/></ThemeProvider></AuthProvider></BrowserRouter>);`);
  fs.writeFileSync(path.join(out, 'shell.jsx'), 'export default function Shell({children}) { return children; }');
  const replacements = new Map([
    ['contexts/AuthContext', path.join(__dirname, 'auth.jsx')],
    ['components/routing/AppLayout', path.join(out, 'shell.jsx')],
    ['components/routing/TosReacceptanceGate', path.join(out, 'shell.jsx')],
  ].map(([p, target]) => [path.resolve(frontend, 'src', p), target]));
  const webpack = runtime('webpack');
  const compiler = webpack({ mode: 'development', devtool: false, context: frontend, entry: path.join(out, 'entry.jsx'),
    output: { path: out, filename: 'fixture.js' }, resolve: { extensions: ['.js', '.jsx', '.json'], modules: [deps, 'node_modules'],
      alias: { '@actual-client': path.join(frontend, 'src/lib/apiClient.js'), '@actual-rejection': path.join(frontend, 'src/lib/sessionRejection.js') } },
    module: { rules: [{ test: /\.[jt]sx?$/, exclude: /node_modules/, use: { loader: runtime.resolve('babel-loader'), options: {
      presets: [[runtime.resolve('@babel/preset-env'), { targets: { chrome: '110' } }], [runtime.resolve('@babel/preset-react'), { runtime: 'automatic' }]],
    } } }] }, plugins: [new webpack.DefinePlugin({ 'process.env.REACT_APP_BACKEND_URL': JSON.stringify('') }), new webpack.NormalModuleReplacementPlugin(/.*/, resource => {
      const replacement = replacements.get(path.resolve(resource.context, resource.request).replace(/\.(js|jsx)$/, ''));
      if (replacement) resource.request = replacement;
    })],
  });
  await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors()
    ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve())));
  const config = runtime(path.join(frontend, 'tailwind.config.js'));
  config.content = [path.join(frontend, 'src/components/{support,security,ui}/*.{js,jsx}'), path.join(frontend, 'src/components/Auth.js')];
  const styles = await runtime('postcss')([runtime('tailwindcss')(config)]).process(fs.readFileSync(path.join(frontend, 'src/index.css'), 'utf8').replace(/^@import[^\n]*\n/gm, ''), { from: undefined });
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
  const ID = 'abcdef01-2345-4789-abcd-ef0123456789'; const target = `/support/tickets/${ID}`;
  const results = [];
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const theme of ['light', 'dark', 'beach']) for (const [device, viewport] of Object.entries({ desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } })) {
      for (const mode of ['automatic', 'repeat-refusal']) {
        const useMfa = (device === 'mobile') === (mode === 'automatic');
        const context = await browser.newContext({ viewport, serviceWorkers: 'block' }); const external = [], errors = [], documents = [];
        await context.route('**/*', route => { if (route.request().url().startsWith(`${origin}/`)) return route.continue(); external.push(route.request().url()); return route.abort(); });
        await context.addInitScript(({ theme, mode, useMfa }) => {
          localStorage.setItem('raw-surf-theme', theme);
          if (!sessionStorage.getItem('return-initialized')) {
            sessionStorage.setItem('return-initialized', 'true'); sessionStorage.setItem('return-mfa', String(useMfa));
            localStorage.setItem('raw-surf-user', JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', role: 'Grom' }));
            localStorage.setItem('rawsurf_cached_feed', 'Synthetic previous-account cache');
            if (mode === 'repeat-refusal') sessionStorage.setItem('raw-surf-session-rejected-at', String(Date.now()));
          }
        }, { theme, mode, useMfa });
        const page = await context.newPage(); page.on('pageerror', e => { errors.push(e.message); console.error('FIXTURE PAGE ERROR:', e.message); });
        page.on('request', r => { if (r.resourceType() === 'document') documents.push(new URL(r.url()).pathname); });
        await page.goto(`${origin}/support/tickets/${ID.toUpperCase()}?discard=fixture#discard`);
        if (mode === 'repeat-refusal') {
          const action = page.getByRole('button', { name: 'Sign in', exact: true }); await expect(action).toBeVisible();
          assert.equal(new URL(page.url()).pathname, `/support/tickets/${ID.toUpperCase()}`);
          // Simulate another writer restoring the refused user: actual Auth must still remain on the form.
          await page.evaluate(() => localStorage.setItem('raw-surf-user', JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', role: 'Grom' })));
          await action.click();
        }
        await page.waitForURL(url => url.pathname === '/auth');
        assert.equal(new URL(page.url()).searchParams.get('redirect'), target);
        assert.equal(new URL(page.url()).hash, '');
        await expect(page.getByTestId('login-email-input')).toBeVisible();
        assert.equal(await page.evaluate(() => localStorage.getItem('rawsurf_cached_feed')), null);
        assert(await page.evaluate(() => Boolean(sessionStorage.getItem('raw-surf-session-rejected-at'))));
        await page.getByTestId('signup-tab').click(); await page.getByTestId('category-surfer').click();
        await page.getByTestId('back-to-categories').click(); await page.getByTestId('login-tab').click();
        assert.equal(new URL(page.url()).searchParams.get('redirect'), target);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.getByTestId('login-email-input').fill('return@example.invalid'); await page.getByTestId('login-email-input').press('Tab');
        await page.getByTestId('login-password-input').fill('synthetic-input'); await page.getByTestId('login-submit').click();
        if (useMfa) { await page.getByTestId('mfa-code-input').fill('123456'); await page.getByRole('button', { name: 'Verify and sign in', exact: true }).click(); }
        await expect(page).toHaveURL(origin + target); await expect(page.getByText('Synthetic restored conversation', { exact: true })).toBeVisible();
        assert.equal(await page.evaluate(() => sessionStorage.getItem('raw-surf-session-rejected-at')), null);
        assert.equal(documents.filter(p => p === '/auth').length, 1);
        const calls = await page.evaluate(() => JSON.parse(sessionStorage.getItem('return-api-log') || '[]'));
        assert(calls.some(r => r.status === 401)); assert(calls.some(r => r.url.startsWith('/support/tickets') && r.status === 200));
        if (mode === 'automatic') await page.screenshot({ path: path.join(out, `${theme}-${device}.png`), fullPage: true });
        await page.evaluate(() => window.returnFixture.setUser({ id: '22222222-2222-4222-8222-222222222222', role: 'Surfer' }));
        await expect(page.getByText('Synthetic restored conversation', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('region', { name: 'Support conversation' }).getByRole('alert')).toContainText('Ticket unavailable');
        assert.equal(new URL(page.url()).pathname, target);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.deepEqual(external, []); assert.deepEqual(errors, []);
        results.push({ theme, device, mode, login: useMfa ? 'actual MFA challenge UI, synthetic verifier' : 'password', passed: true,
          authDocumentLoads: 1, externalRequests: 0, pageErrors: 0, horizontalOverflow: false, calls,
          cases: ['real Axios 401 handler', 'canonical return without query/hash', 'actual Auth tab/category/back return',
            'real session guard and account-cache purge', 'actual password/MFA Auth completion', 'one hard sign-in load',
            ...(mode === 'repeat-refusal' ? ['restored refused session cannot auto-forward'] : []),
            'wrong-account content removed without auth navigation'] });
        console.log(`PASS ${theme}/${device}/${mode}/${useMfa ? 'MFA' : 'password'}`); await context.close();
      }
    }
    assert.deepEqual(hashes(), before, 'Frozen source unchanged');
    fs.writeFileSync(path.join(__dirname, 'browser-results.json'), JSON.stringify({ passed: results.length, total: 12, source: before,
      node: process.version, browser: browser.version(), results, seams: ['real Axios interceptors, Auth/MFA/ProtectedRoute/SupportInbox/session guards/router/Theme/CSS',
        'synthetic session provider and Axios adapter; AppLayout/ToS frames substituted; separate route table; no backend/provider/device/full-shell claim'] }, null, 2) + '\n');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
