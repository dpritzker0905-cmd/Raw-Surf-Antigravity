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
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'none'");
    if (request.url === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); return; }
    const asset = { '/fixture.js': ['fixture.js', 'text/javascript'], '/fixture.css': ['fixture.css', 'text/css'] }[request.url];
    if (!asset) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', `${asset[1]}; charset=utf-8`); fs.createReadStream(path.join(output, asset[0])).pipe(response);
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
        assert.equal(await page.evaluate(() => document.characterSet), 'UTF-8');
        const expectedBackground = { light: '0 0% 100%', dark: '0 0% 8%', beach: '0 0% 0%' }[theme];
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--background').trim())).toBe(expectedBackground);
        const row = id => page.getByRole('button', { name: new RegExp(`TEST-${id}`) });
        const title = id => page.getByText(`Ticket: TEST-${id}`, { exact: true });
        const editor = page.getByRole('textbox', { name: 'Type your reply...' });
        const metrics = page.getByRole('region', { name: 'Support metrics' });
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
        await page.evaluate(() => window.supportFixture.setMetrics({ avg_first_response_hours: 2.25 }));
        await hold('post', 'A'); await page.getByRole('button', { name: 'Add Note', exact: true }).click();
        await row('B').click(); await expect(title('B')).toBeVisible();
        await editor.fill('B draft survives delayed A submission');
        await finish('post', 'A');
        await expect(metrics.getByText('2.25h', { exact: true })).toBeVisible();
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
        await page.evaluate(() => window.supportFixture.setMetrics({ open_tickets: 13 }));
        await hold('put', 'A'); await page.getByRole('combobox', { name: 'Ticket status', exact: true }).click();
        try {
          await page.getByRole('option', { name: 'Resolved', exact: true }).click({ timeout: 5000 });
        } catch (error) {
          await page.screenshot({ path: path.join(__dirname, 'dropdown-failure.png'), fullPage: true });
          const diagnostic = { theme, device, viewport,
            trigger: await page.locator('[aria-label="Ticket status"]').boundingBox(),
            option: await page.getByRole('option', { name: 'Resolved', exact: true }).boundingBox(),
            message: error.message };
          fs.writeFileSync(path.join(__dirname, 'dropdown-failure.json'), JSON.stringify(diagnostic, null, 2) + '\n');
          throw error;
        }
        await row('B').click(); await expect(title('B')).toBeVisible(); await finish('put', 'A');
        await expect(metrics.getByText('13', { exact: true })).toBeVisible();
        await expect(title('B')).toBeVisible(); await expect(editor).toHaveValue('B draft survives delayed A submission');
        await expect(row('B')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('button', { name: 'Send Reply', exact: true })).toBeEnabled();
        const next = page.getByRole('button', { name: 'Next ticket page' });
        const previous = page.getByRole('button', { name: 'Previous ticket page' });
        const range = text => page.getByText(text, { exact: true });
        const choose = async (label, option) => {
          await page.getByRole('combobox', { name: label, exact: true }).click();
          await page.getByRole('option', { name: option, exact: true }).click();
        };
        await expect(range('Showing 1–50 of 123 tickets')).toBeVisible();
        await expect(previous).toBeDisabled();
        await next.focus(); await page.keyboard.press('Enter');
        await expect(range('Showing 51–100 of 123 tickets')).toBeVisible();
        await expect(page.getByText('Request 51', { exact: true })).toBeVisible();
        await expect(title('B')).toBeVisible(); await expect(editor).toHaveValue('B draft survives delayed A submission');
        await next.click(); await expect(range('Showing 101–123 of 123 tickets')).toBeVisible();
        await expect(page.getByText('Request 123', { exact: true })).toHaveCount(1); await expect(next).toBeDisabled();
        await previous.click(); await expect(range('Showing 51–100 of 123 tickets')).toBeVisible();
        await choose('Filter ticket status', 'Closed'); await expect(range('Showing 1–50 of 61 tickets')).toBeVisible();
        await next.click(); await expect(range('Showing 51–61 of 61 tickets')).toBeVisible();
        await choose('Filter ticket priority', 'High'); await expect(range('Showing 1–20 of 20 tickets')).toBeVisible();
        await choose('Filter ticket priority', 'All Priority'); await expect(range('Showing 1–50 of 61 tickets')).toBeVisible();
        const search = page.getByRole('textbox', { name: 'Search tickets...' });
        await search.fill('Request 122'); await page.getByRole('button', { name: 'Search tickets', exact: true }).click();
        await expect(range('Showing 1–1 of 1 tickets')).toBeVisible(); await expect(next).toBeDisabled();
        await search.fill(''); await search.press('Enter'); await expect(range('Showing 1–50 of 61 tickets')).toBeVisible();
        await choose('Filter ticket status', 'All Status'); await expect(range('Showing 1–50 of 123 tickets')).toBeVisible();
        await page.evaluate(() => window.supportFixture.holdPage(50)); await next.click();
        await expect(page.getByRole('status')).toHaveText(/Loading tickets/); await expect(next).toBeDisabled();
        await choose('Filter ticket status', 'Closed'); await expect(range('Showing 1–50 of 61 tickets')).toBeVisible();
        await page.evaluate(() => window.supportFixture.finishPage(50));
        await expect(range('Showing 1–50 of 61 tickets')).toBeVisible();
        await page.evaluate(() => window.supportFixture.holdPage(50)); await next.click();
        await page.evaluate(() => window.supportFixture.finishPage(50, true));
        await expect(page.getByRole('alert')).toHaveText('Failed to load tickets');
        await expect(page.getByText('No tickets found')).toHaveCount(0);
        await page.getByRole('button', { name: 'Retry ticket list' }).click();
        await expect(range('Showing 51–61 of 61 tickets')).toBeVisible();
        await page.evaluate(() => window.supportFixture.truncate(60));
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await expect(range('Showing 1–30 of 30 tickets')).toBeVisible();
        await expect(title('B')).toBeVisible(); await expect(editor).toHaveValue('B draft survives delayed A submission');
        await expect(previous).toBeDisabled(); await expect(next).toBeDisabled();
        await page.evaluate(() => window.supportFixture.holdMetrics());
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await expect(metrics.getByText('Loading support metrics...')).toBeVisible();
        await expect(metrics.getByText('2.25h', { exact: true })).toHaveCount(0);
        await page.evaluate(() => window.supportFixture.finishMetrics(0, {}, true));
        await expect(metrics.getByRole('alert')).toHaveText('Failed to load support metrics');
        await expect(metrics.getByText('Open Tickets')).toHaveCount(0);
        await expect(editor).toHaveValue('B draft survives delayed A submission');
        const listsBeforeRetry = await page.evaluate(() => window.supportFixture.requests.filter(r => r.url.includes('tickets?')).length);
        await metrics.getByRole('button', { name: 'Retry support metrics' }).focus(); await page.keyboard.press('Space');
        await expect(metrics.getByText('2.25h', { exact: true })).toBeVisible();
        const listsAfterRetry = await page.evaluate(() => window.supportFixture.requests.filter(r => r.url.includes('tickets?')).length);
        assert.equal(listsAfterRetry, listsBeforeRetry, 'Metrics retry must not replay list or mutations');
        await page.evaluate(() => window.supportFixture.holdMetrics()); await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await page.evaluate(() => window.supportFixture.holdMetrics()); await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await page.evaluate(() => window.supportFixture.finishMetrics(1, { open_tickets: 19 }));
        await expect(metrics.getByText('19', { exact: true })).toBeVisible();
        await page.evaluate(() => window.supportFixture.finishMetrics(0, { open_tickets: 31 }));
        await expect(metrics.getByText('19', { exact: true })).toBeVisible(); await expect(metrics.getByText('31', { exact: true })).toHaveCount(0);
        await page.evaluate(() => window.supportFixture.holdMetrics()); await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await page.evaluate(() => window.supportFixture.holdMetrics()); await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await page.evaluate(() => window.supportFixture.finishMetrics(1, { open_tickets: 49 }));
        await page.evaluate(() => window.supportFixture.finishMetrics(0, {}, true));
        await expect(metrics.getByText('49', { exact: true })).toBeVisible(); await expect(metrics.getByRole('alert')).toHaveCount(0);
        await expect(metrics.getByText('Tickets created in last 30 days')).toBeVisible();
        await expect(editor).toHaveValue('B draft survives delayed A submission');
        await page.evaluate(() => window.supportFixture.setMetrics({ avg_first_response_hours: 0, avg_resolution_hours: 0,
          first_response_sample_count: 0, resolution_sample_count: 0 }));
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await expect(metrics.getByText('No response measurements', { exact: true })).toBeVisible();
        await expect(metrics.getByText('No resolution measurements', { exact: true })).toBeVisible();
        try {
          await expect(metrics.getByText('—', { exact: true })).toHaveCount(2);
        } catch (error) {
          fs.writeFileSync(path.join(__dirname, 'encoding-diagnostic.json'), JSON.stringify({ theme, device,
            characterSet: await page.evaluate(() => document.characterSet), metricsText: await metrics.innerText(), message: error.message }, null, 2) + '\n');
          throw error;
        }
        await expect(metrics.getByText('0h', { exact: true })).toHaveCount(0);
        await page.evaluate(() => window.supportFixture.setMetrics({ first_response_sample_count: 1, resolution_sample_count: 1 }));
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await expect(metrics.getByText('1 response measurement', { exact: true })).toBeVisible();
        await expect(metrics.getByText('1 resolution measurement', { exact: true })).toBeVisible();
        await expect(metrics.getByText('0h', { exact: true })).toHaveCount(2); await expect(metrics.getByText('—', { exact: true })).toHaveCount(0);
        await page.evaluate(() => { window.supportFixture.removeSampleCounts(); window.supportFixture.setMetrics({ avg_first_response_hours: 1.25 }); });
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await expect(metrics.getByText('1.25h', { exact: true })).toBeVisible(); await expect(metrics.getByText('0h', { exact: true })).toHaveCount(1);
        await expect(metrics.getByText('No response measurements', { exact: true })).toHaveCount(0);
        await page.evaluate(() => window.supportFixture.setMetrics({ first_response_sample_count: 0, resolution_sample_count: 1,
          avg_first_response_hours: 0, avg_resolution_hours: 0 }));
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await expect(metrics.getByText('No response measurements', { exact: true })).toBeVisible();
        await expect(metrics.getByText('1 resolution measurement', { exact: true })).toBeVisible();
        await expect(metrics.getByText('—', { exact: true })).toHaveCount(1); await expect(metrics.getByText('0h', { exact: true })).toHaveCount(1);
        await expect(editor).toHaveValue('B draft survives delayed A submission');
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        assert.equal(overflow, false, `${theme}/${device} horizontal overflow`);
        assert.deepEqual(external, []); assert.deepEqual(errors, []);
        const posts = await page.evaluate(() => window.supportFixture.requests.filter(r => r.method === 'post'));
        assert.deepEqual(posts, [{ method: 'post', url: '/admin/support/tickets/A/reply', body: { message: 'Private draft only for A', is_internal_note: true } }]);
        const screenshot = `${theme}-${device}.png`;
        await page.screenshot({ path: path.join(__dirname, screenshot), fullPage: true });
        results.push({ theme, device, viewport, expectedBackground, characterSet: 'UTF-8', passed: true, screenshot, externalRequests: 0, pageErrors: 0, horizontalOverflow: false,
          scenarios: ['out-of-order selection', 'per-ticket text/note mode', 'delayed reply completion', 'detail failure/retry', 'keyboard Space selection', 'delayed update completion', 'exact reply contract',
            'all 123 tickets reachable', 'keyboard page activation', 'last page and previous navigation', 'filters reset offset', 'filtered second page', 'search submit and clear',
            'stale page versus filter ordering', 'failed page GET-only retry', 'shrinking total clamps offset', 'detail and draft retained across pages',
            'metrics refresh after reply and update', 'manual metrics refresh pending/failure', 'metrics-only keyboard retry', 'out-of-order metrics success/failure', 'accurate cohort label and retained draft',
            'zero samples render unavailable', 'measured zero remains zero hours', 'older backend compatibility', 'independent response/resolution counts'] });
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
