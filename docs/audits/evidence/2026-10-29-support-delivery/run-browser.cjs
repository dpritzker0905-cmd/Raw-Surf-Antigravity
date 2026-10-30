const fs = require('fs');
const path = require('path');
const http = require('http');
const { createRequire } = require('module');
const assert = require('assert/strict');

async function main() {
  const deps = process.env.RAW_SUPPORT_TEST_DEPS;
  if (!deps) throw new Error('Set RAW_SUPPORT_TEST_DEPS to existing frontend node_modules');
  const runtime = createRequire(path.join(deps, '..', 'package.json'));
  const frontend = path.resolve(__dirname, '../../../../frontend');
  const output = path.join(__dirname, '.browser');
  fs.mkdirSync(output, { recursive: true });
  const webpack = runtime('webpack');
  const replacements = new Map([
    [path.join(frontend, 'src/contexts/AuthContext'), path.join(__dirname, 'browser-auth.jsx')],
    [path.join(frontend, 'src/lib/apiClient'), path.join(__dirname, 'browser-transport.js')],
    [path.join(frontend, 'src/components/security/MfaSignInSteps'), path.join(__dirname, 'browser-mfa.jsx')],
    [path.join(frontend, 'src/components/routing/AppLayout'), path.join(__dirname, 'browser-shell.jsx')],
    [path.join(frontend, 'src/components/routing/TosReacceptanceGate'), path.join(__dirname, 'browser-shell.jsx')],
  ]);
  const compiler = webpack({
    mode: 'development', devtool: false, context: frontend,
    entry: path.join(__dirname, 'browser-fixture.jsx'),
    output: { path: output, filename: 'fixture.js' },
    resolve: { extensions: ['.js', '.jsx', '.json'], modules: [deps, 'node_modules'] },
    module: { rules: [{ test: /\.[jt]sx?$/, exclude: /node_modules/, use: {
      loader: runtime.resolve('babel-loader'), options: { presets: [
        [runtime.resolve('@babel/preset-env'), { targets: { chrome: '110' } }],
        [runtime.resolve('@babel/preset-react'), { runtime: 'automatic' }],
      ] },
    } }] },
    plugins: [new webpack.NormalModuleReplacementPlugin(/(?:AuthContext|apiClient|MfaSignInSteps|AppLayout|TosReacceptanceGate)$/, resource => {
      const replacement = replacements.get(path.resolve(resource.context, resource.request));
      if (replacement) resource.request = replacement;
    })],
  });
  await new Promise((resolve, reject) => compiler.run((error, stats) => {
    compiler.close(() => {});
    if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true })));
    else resolve();
  }));
  const css = fs.readFileSync(path.join(frontend, 'src/index.css'), 'utf8').replace(/^@import[^\n]*\n/gm, '');
  const config = runtime(path.join(frontend, 'tailwind.config.js'));
  config.content = [path.join(frontend, 'src/components/support/*.{js,jsx}'), path.join(frontend, 'src/components/Auth.js'), path.join(frontend, 'src/components/admin/AdminSupportDashboard.js'),
    path.join(frontend, 'src/contexts/ThemeContext.js'),
    path.join(frontend, 'src/components/ui/*.{js,jsx}'), path.join(__dirname, 'browser-fixture.jsx')];
  const styles = await runtime('postcss')([runtime('tailwindcss')(config)]).process(css, { from: undefined });
  fs.writeFileSync(path.join(output, 'fixture.css'), styles.css);
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'none'");
    if (request.url === '/' || request.url.startsWith('/support') || request.url.startsWith('/auth')) { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); return; }
    const asset = { '/fixture.js': ['fixture.js', 'text/javascript'], '/fixture.css': ['fixture.css', 'text/css'] }[request.url];
    if (!asset) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', `${asset[1]}; charset=utf-8`); fs.createReadStream(path.join(output, asset[0])).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { chromium, expect } = runtime('@playwright/test');
  const A = '44444444-4444-4444-8444-444444444444';
  const B = '55555555-5555-4555-8555-555555555555';
  const results = [];
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const theme of ['light', 'dark', 'beach']) {
      for (const [device, viewport] of Object.entries({ desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } })) {
        const context = await browser.newContext({ viewport });
        const external = [], errors = [];
        await context.route('**/*', route => {
          if (route.request().url().startsWith(`${origin}/`)) return route.continue();
          external.push(route.request().url()); return route.abort();
        });
        await context.addInitScript(value => localStorage.setItem('raw-surf-theme', value), theme);
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${origin}/support/tickets/${A}`);
        await expect(page.getByTestId('login-tab')).toBeVisible();
        assert.equal(new URL(page.url()).searchParams.get('redirect'), `/support/tickets/${A}`);
        await page.getByTestId('category-surfer').click();
        assert.equal(new URL(page.url()).searchParams.get('redirect'), `/support/tickets/${A}`);
        await page.getByTestId('login-tab').click();
        assert.equal(new URL(page.url()).searchParams.get('redirect'), `/support/tickets/${A}`);
        await page.locator('input[type=email]').fill('fixture@example.invalid');
        await page.locator('input[type=password]').fill('fictional-password');
        await page.locator('form').getByRole('button', { name: 'Log In', exact: true }).click();
        await expect(page).toHaveURL(`${origin}/support/tickets/${A}`);
        await expect(page.getByText('Fictional details A', { exact: true })).toBeVisible();
        assert.equal(await page.evaluate(() => document.characterSet), 'UTF-8');
        const expectedBackground = { light: '0 0% 100%', dark: '0 0% 8%', beach: '0 0% 0%' }[theme];
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--background').trim()), expectedBackground);
        await expect(page.getByRole('checkbox', { name: 'Internal note' })).toHaveCount(0);
        const reply = page.getByLabel('Your reply', { exact: true });
        await reply.fill('A retained reply');
        await page.evaluate(() => { window.supportFixture.failReply = true; });
        await page.getByRole('button', { name: 'Send reply', exact: true }).click();
        await expect(page.getByRole('alert')).toContainText('Reply not confirmed');
        await expect(reply).toHaveValue('A retained reply');
        await page.getByRole('button', { name: 'Send reply', exact: true }).click();
        await expect(reply).toHaveValue('');
        const replyCalls = await page.evaluate(() => window.supportFixture.requests.filter(row => row.url.endsWith('/messages')));
        assert.equal(replyCalls.length, 2); assert.deepEqual(replyCalls[0].body, replyCalls[1].body);
        assert.match(replyCalls[0].body.client_message_id, /^[0-9a-f-]{36}$/i);
        await reply.fill('A unsubmitted draft');
        await page.getByRole('button', { name: /Fictional request B/ }).focus(); await page.keyboard.press('Space');
        await expect(page.getByText('Fictional details B', { exact: true })).toBeVisible();
        await expect(reply).toHaveValue(''); await reply.fill('B unsubmitted draft');
        await page.getByRole('button', { name: /Fictional request A/ }).click();
        await expect(page.getByText('Fictional details A', { exact: true })).toBeVisible(); await expect(reply).toHaveValue('A unsubmitted draft');
        await page.evaluate(id => window.supportFixture.holdDetail(id), B);
        await page.getByRole('button', { name: /Fictional request B/ }).click();
        await expect(page.getByRole('status')).toHaveText('Loading conversation…');
        await expect(reply).toHaveCount(0);
        await page.getByRole('button', { name: /Fictional request A/ }).click();
        await expect(page.getByText('Fictional details A', { exact: true })).toBeVisible();
        await page.evaluate(id => window.supportFixture.releaseDetail(id), B);
        await expect(page.getByText('Fictional details B', { exact: true })).toHaveCount(0); await expect(reply).toHaveValue('A unsubmitted draft');
        await page.getByLabel('Subject', { exact: true }).fill('Fictional new request');
        await page.getByLabel('How can we help?', { exact: true }).fill('Fictional new description');
        await page.evaluate(() => { window.supportFixture.failCreate = true; });
        await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
        await expect(page.getByRole('alert')).toContainText('Ticket not confirmed');
        await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
        await expect(page.getByText('Fictional new description', { exact: true })).toBeVisible();
        const creationCalls = await page.evaluate(() => window.supportFixture.requests.filter(row => row.method === 'post' && row.url === '/support/tickets'));
        assert.equal(creationCalls.length, 2); assert.deepEqual(creationCalls[0].body, creationCalls[1].body);
        await page.evaluate(() => window.supportFixture.setUser({ id: '22222222-2222-4222-8222-222222222222', role: 'Surfer' }));
        await expect(page.getByRole('alert')).toContainText('Ticket unavailable');
        await expect(page.getByText('Fictional new description', { exact: true })).toHaveCount(0);
        await page.evaluate(() => window.supportFixture.setUser({ id: '11111111-1111-4111-8111-111111111111', role: 'Grom' }));
        await expect(page.getByText('Fictional new description', { exact: true })).toBeVisible();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []); assert.deepEqual(external, []);
        const screenshot = `${theme}-${device}.png`; await page.screenshot({ path: path.join(__dirname, screenshot), fullPage: true });
        results.push({ theme, device, viewport, passed: true, screenshot, externalRequests: 0, pageErrors: 0, horizontalOverflow: false, characterSet: 'UTF-8',
          cases: ['actual protected/auth return after tab/category change', 'authenticated Grom support adapter', 'public owner reader', 'reply retry request identity', 'per-ticket drafts', 'late detail response guard', 'creation retry identity', 'account switch hides prior content'] });
        console.log(`PASS ${theme}/${device}`); await context.close();
      }
    }
    fs.writeFileSync(path.join(__dirname, 'browser-results.json'), JSON.stringify({ browserVersion: browser.version(), results }, null, 2) + '\n');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
