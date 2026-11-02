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
    [path.join(frontend, 'src/contexts/AuthContext'), path.join(__dirname, 'browser-auth.js')],
    [path.join(frontend, 'src/lib/apiClient'), path.join(__dirname, 'browser-transport.js')],
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
    plugins: [new webpack.NormalModuleReplacementPlugin(/(?:AuthContext|apiClient)$/, resource => {
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
  config.content = [path.join(frontend, 'src/components/admin/AdminSupportDashboard.js'),
    path.join(frontend, 'src/contexts/ThemeContext.js'),
    path.join(frontend, 'src/components/ui/*.{js,jsx}'), path.join(__dirname, 'browser-fixture.jsx')];
  const styles = await runtime('postcss')([runtime('tailwindcss')(config)]).process(css, { from: undefined });
  fs.writeFileSync(path.join(output, 'fixture.css'), styles.css);
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'none'");
    if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end(html); return; }
    const asset = { '/fixture.js': ['fixture.js', 'text/javascript'], '/fixture.css': ['fixture.css', 'text/css'] }[request.url];
    if (!asset) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', asset[1]); fs.createReadStream(path.join(output, asset[0])).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { chromium, expect } = runtime('@playwright/test');
  let browser;
  const results = [];
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
        await page.goto(origin);
        const expectedBackground = { light: '0 0% 100%', dark: '0 0% 8%', beach: '0 0% 0%' }[theme];
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--background').trim())).toBe(expectedBackground);
        const row = id => page.getByRole('button', { name: new RegExp(`TEST-${id}`) });
        const title = id => page.getByText(`Ticket: TEST-${id}`, { exact: true });
        const editor = page.getByRole('textbox', { name: 'Type your reply...' });
        const note = page.getByRole('checkbox', { name: 'Internal note' });
        const hold = (method, id) => page.evaluate(([method, id]) => window.supportFixture.hold(method, id), [method, id]);
        const finish = (method, id, failed = false) => page.evaluate(([method, id, failed]) => window.supportFixture.finish(method, id, failed), [method, id, failed]);
        await expect(row('A')).toBeVisible();
        await hold('get', 'A'); await row('A').click();
        await hold('get', 'B'); await row('B').click();
        await finish('get', 'B'); await expect(title('B')).toBeVisible();
        await finish('get', 'A'); await expect(title('B')).toBeVisible();
        await expect(page.getByText('Details for A')).toHaveCount(0);
        await row('A').click(); await expect(title('A')).toBeVisible();
        await editor.fill('Private draft only for A'); await note.check();
        await row('B').click(); await expect(title('B')).toBeVisible();
        await expect(editor).toHaveValue(''); await expect(note).not.toBeChecked();
        await editor.fill('Draft only for B');
        await row('A').click(); await expect(title('A')).toBeVisible();
        await expect(editor).toHaveValue('Private draft only for A'); await expect(note).toBeChecked();
        await hold('post', 'A'); await page.getByRole('button', { name: 'Add Note', exact: true }).click();
        await row('B').click(); await expect(title('B')).toBeVisible();
        await editor.fill('B draft survives delayed A submission');
        await finish('post', 'A');
        await expect(title('B')).toBeVisible(); await expect(editor).toHaveValue('B draft survives delayed A submission');
        await expect(note).not.toBeChecked();
        await row('A').click(); await expect(title('A')).toBeVisible(); await expect(editor).toHaveValue('');
        await hold('get', 'B'); await row('B').click();
        await expect(page.getByRole('status')).toHaveText(/Loading ticket details/);
        await expect(editor).toHaveCount(0); await finish('get', 'B', true);
        await expect(page.getByRole('alert')).toHaveText('Failed to load ticket details');
        await expect(editor).toHaveCount(0);
        await page.getByRole('button', { name: 'Retry ticket details' }).click();
        await expect(title('B')).toBeVisible(); await expect(editor).toHaveValue('B draft survives delayed A submission');
        await row('A').focus(); await page.keyboard.press('Space'); await expect(title('A')).toBeVisible();
        await hold('put', 'A'); await page.getByRole('combobox', { name: 'Ticket status' }).click();
        await page.getByRole('option', { name: 'Resolved', exact: true }).click();
        await row('B').click(); await expect(title('B')).toBeVisible(); await finish('put', 'A');
        await expect(title('B')).toBeVisible(); await expect(editor).toHaveValue('B draft survives delayed A submission');
        await expect(row('B')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('button', { name: 'Send Reply', exact: true })).toBeEnabled();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        assert.equal(overflow, false, `${theme}/${device} horizontal overflow`);
        assert.deepEqual(external, []); assert.deepEqual(errors, []);
        const posts = await page.evaluate(() => window.supportFixture.requests.filter(r => r.method === 'post'));
        assert.deepEqual(posts, [{ method: 'post', url: '/admin/support/tickets/A/reply', body: { message: 'Private draft only for A', is_internal_note: true } }]);
        const screenshot = `${theme}-${device}.png`;
        await page.screenshot({ path: path.join(__dirname, screenshot), fullPage: true });
        results.push({ theme, device, viewport, expectedBackground, passed: true, screenshot, externalRequests: 0, pageErrors: 0, horizontalOverflow: false,
          scenarios: ['out-of-order selection', 'per-ticket text/note mode', 'delayed reply completion', 'detail failure/retry', 'keyboard Space selection', 'delayed update completion', 'exact reply contract'] });
        console.log(`PASS ${theme}/${device}`);
        await context.close();
      }
    }
    fs.writeFileSync(path.join(__dirname, 'browser-results.json'), JSON.stringify({ engine: 'Chromium', browserVersion: browser.version(), results }, null, 2) + '\n');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
