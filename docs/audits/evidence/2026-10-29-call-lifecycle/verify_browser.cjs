// Actual hook; fake transport/media/RTC, isolated Chrome and clock. No real calls.
const fs = require('fs'); const path = require('path'); const http = require('http'); const assert = require('assert/strict');
const root = path.resolve(__dirname, '../../../..');
const req = require('module').createRequire(path.join(root, 'frontend/package.json'));
const webpack = req('webpack');
const crypto = require('crypto');
const hookPath = path.join(root, 'frontend/src/hooks/useWebRTCCall.js');
const sourceHash = () => crypto.createHash('sha256').update(fs.readFileSync(hookPath)).digest('hex');
const baseline = process.argv.includes('--baseline');
// Keep the historical source in memory only; the same AST pass strips its ICE configuration.
const baselineSource = baseline ? require('child_process').execFileSync('git', ['show', 'HEAD:frontend/src/hooks/useWebRTCCall.js'], { cwd: root, encoding: 'utf8' }) : null;
const output = path.resolve(process.argv[2]); fs.mkdirSync(output, { recursive: true });
(async () => {
  const sourceBefore = sourceHash();
  await new Promise((resolve, reject) => webpack({
    mode: 'production', context: root, entry: path.join(__dirname, 'browser-entry.jsx'), devtool: false, cache: false,
    output: { path: output, filename: 'fixture.js' }, optimization: { minimize: false },
    resolve: { extensions: ['.js', '.jsx', '.mjs'], modules: [path.join(root, 'frontend/node_modules')] },
    resolveLoader: { modules: [path.join(root, 'frontend/node_modules')] },
    module: { rules: [{ test: /\.[cm]?jsx?$/, exclude: /node_modules/, use: {
      loader: req.resolve('babel-loader'), options: { babelrc: false, configFile: false,
        presets: [[req.resolve('@babel/preset-react'), { runtime: 'automatic' }]],
        // The actual hook has legacy ICE service configuration; exclude it from every fixture output.
        plugins: [function({ types: t }) { return { visitor: { Program(p, state) {
          if (baselineSource && path.resolve(state.filename) === hookPath) {
            p.node.body = req('@babel/parser').parse(baselineSource, { sourceType: 'module', plugins: ['jsx'] }).program.body;
          }
        }, VariableDeclarator(p) {
          if (p.node.id.name === 'ICE_SERVERS') p.node.init = t.arrayExpression([]);
        } } }; }],
      },
    } }] },
    plugins: [new webpack.NormalModuleReplacementPlugin(/(?:apiClient|audioUnlock|logger|useWebRTCSignaling|useWebRTCMedia|sonner)(?:\.js)?$/, path.join(__dirname, 'browser-stubs.js'))],
  }, (error, stats) => error || stats.hasErrors() ? reject(new Error(error ? error.message : 'Fixture compilation failed')) : resolve()));
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'none'; media-src 'none'");
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'application/javascript' : 'text/html');
    response.end(request.url === '/fixture.js' ? fs.readFileSync(path.join(output, 'fixture.js')) : '<!doctype html><title>Isolated call lifecycle</title><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser; const checks = []; const errors = []; const external = [];
  try {
    browser = await req('playwright').chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : (external.push('blocked'), route.abort()));
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.name));
    await page.clock.install({ time: new Date('2026-10-29T18:00:00Z') });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByText('Start A', { exact: true }).click();
    await page.waitForFunction(() => window.__callFixture.api.callState === 'outgoing');
    await page.clock.runFor(10000);
    await page.getByText('End', { exact: true }).click();
    await page.waitForFunction(() => window.__callFixture.api.callState === 'idle');
    await page.getByText('Start B', { exact: true }).click();
    await page.waitForFunction(() => window.__callFixture.api.callState === 'outgoing');
    await page.clock.runFor(21000);
    assert.equal(await page.getByTestId('state').textContent(), 'outgoing'); checks.push('old_timeout_does_not_end_new_call');
    await page.clock.runFor(9000);
    await page.waitForFunction(() => window.__callFixture.api.callState === 'idle');
    assert.equal(await page.evaluate(() => window.__callFixture.signals.filter(s => s.type === 'call_end').at(-1).target), 'fixture-b');
    checks.push('own_timeout_targets_current_recipient');
    await page.getByText('Start B', { exact: true }).click();
    await page.waitForFunction(() => window.__callFixture.api.callState === 'outgoing');
    await page.getByText('Connect', { exact: true }).click();
    await page.waitForFunction(() => window.__callFixture.api.callState === 'in-call');
    await page.clock.runFor(5000);
    assert.equal(await page.getByTestId('duration').textContent(), '5');
    await page.getByText('Duplicate events', { exact: true }).click();
    assert.equal(await page.getByTestId('duration').textContent(), '5');
    assert.equal(await page.evaluate(() => window.__callFixture.intervals.size), 2);
    await page.clock.runFor(5000);
    assert.equal(await page.getByTestId('duration').textContent(), '10');
    assert.equal(await page.evaluate(() => window.__callFixture.statsCalls), 2);
    checks.push('duplicate_events_preserve_duration_and_single_stats_monitor');
    await page.getByText('End', { exact: true }).click();
    await page.waitForFunction(() => window.__callFixture.api.callState === 'idle');
    assert.equal(await page.evaluate(() => window.__callFixture.intervals.size), 0);
    await page.evaluate(() => window.__callFixture.unmount());
    await page.clock.runFor(60000);
    assert.equal(await page.evaluate(() => window.__callFixture.intervals.size), 0);
    assert.equal(await page.evaluate(() => window.__callFixture.statsCalls), 2);
    checks.push('end_and_unmount_clear_owned_intervals');
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    assert.equal(sourceHash(), sourceBefore, 'Hook changed during browser verification; repeat against stable source');
    const report = { passed: checks.length, checks, page_errors: errors.length, external_requests: external.length, source_sha256: sourceBefore,
      evidence: 'Actual React hook in Chrome with controlled media, RTC, signaling, API and clock; no real call or deployed acceptance.' };
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
    await context.close();
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
