// Usage: node verify_browser.cjs <private-output-directory> [--baseline]
// Only fixture bundles/evidence are written. Application files and Git state are never changed.
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert/strict');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../../../..');
const req = require('module').createRequire(path.join(root, 'frontend/package.json'));
const webpack = req('webpack');
const output = path.resolve(process.argv[2]);
const baseline = process.argv.includes('--baseline');
const baselineRevision = '0890cd877f586736751c46fecbd9ba59078f6f03';
const runtimePaths = [
  'frontend/src/utils/notificationDeepLinks.js', 'frontend/src/hooks/useNotificationInbox.js',
  'frontend/src/components/NotificationsPage.js', 'frontend/src/components/NotificationsDrawer.js',
];
const evidencePaths = [...runtimePaths,
  'frontend/src/utils/notificationDeepLinks.supportReply.test.js',
  'frontend/src/hooks/useNotificationInbox.activation.test.js',
  'frontend/src/components/Notifications.supportReply.test.js',
  ...['browser-entry.jsx', 'browser-stubs.js', 'verify_browser.cjs'].map(file => path.relative(root, path.join(__dirname, file)).replaceAll('\\', '/')),
];
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const fingerprints = () => Object.fromEntries(evidencePaths.map(file => [file, digest(fs.readFileSync(path.join(root, file)))]));
const before = fingerprints();
const baselineSources = new Map(baseline ? runtimePaths.map(file => [path.resolve(root, file),
  execFileSync('git', ['show', `${baselineRevision}:${file}`], { cwd: root, encoding: 'utf8' })]) : []);
const accountA = 'fedcba98-7654-3210-fedc-ba9876543210';
const accountB = '00000000-0000-0000-0000-000000000002';
const ticketPath = '/support/tickets/abcdef01-2345-6789-abcd-ef0123456789';
const checks = [];
const errors = [];
const external = [];
const call = (page, action, ...args) => page.evaluate(({ action, args }) => window.__supportFixture[action](...args), { action, args });
const settle = page => call(page, 'settle');
const snapshot = page => page.evaluate(() => window.__supportFixture.snapshot());
const row = page => page.getByRole('button', { name: /^Support reply for fixture A/ });
const count = (value, operation) => value.requests.filter(request => request.operation === operation).length;
const navigationCount = value => value.navigations.filter(location => location.pathname !== '/notifications').length;
const used = (page, operation) => page.waitForFunction(operation => window.__supportFixture.gates.some(item => item.operation === operation && item.used), operation);
const requestsSettled = page => page.waitForFunction(() => window.__supportFixture.requests.every(request => request.settled));
const expectDestination = async (page, destination = ticketPath) => {
  await page.waitForFunction(destination => window.location.pathname === destination, destination);
  await settle(page);
  const value = await snapshot(page);
  assert.equal(navigationCount(value), 1, 'Exactly one router navigation');
  return value;
};
const noNavigation = value => assert.equal(navigationCount(value), 0, 'No route change from a retired or rejected activation');
const clickTwice = page => row(page).evaluate(button => { button.click(); button.click(); });
const cases = [];
const add = (surface, name, params, run, theme = 'dark', width = 390) => cases.push({ surface, name, params, run, theme, width });

for (const surface of ['page', 'drawer']) {
  for (const isRead of [false, true]) {
    add(surface, `valid_${isRead ? 'read' : 'unread'}_route`, { read: isRead }, async page => {
      await row(page).click(); const value = await expectDestination(page);
      assert.equal(count(value, 'markRead'), isRead ? 0 : 1);
      assert.equal(value.closes, surface === 'drawer' ? 1 : 0);
    });
    add(surface, `invalid_${isRead ? 'read' : 'unread'}_no_effects`, { read: isRead, invalid: true }, async page => {
      await row(page).evaluate(button => button.click()); await settle(page);
      const value = await snapshot(page); noNavigation(value);
      assert.equal(count(value, 'markRead'), 0); assert.equal(value.closes, 0);
      assert.equal(value.badgeRefreshes, 0); assert.equal(value.countUpdates, 0);
    });
    add(surface, `duplicate_${isRead ? 'read' : 'unread'}_activation`, { read: isRead }, async page => {
      if (!isRead) await call(page, 'hold', 'markRead');
      await clickTwice(page);
      if (!isRead) { await used(page, 'markRead'); await call(page, 'release', 'markRead'); }
      const value = await expectDestination(page);
      assert.equal(count(value, 'markRead'), isRead ? 0 : 1);
      assert.equal(value.closes, surface === 'drawer' ? 1 : 0);
    });
  }
  add(surface, 'held_read_account_A_B_A', {}, async page => {
    await call(page, 'hold', 'markRead'); await row(page).click(); await used(page, 'markRead');
    await call(page, 'switchOwner', accountB); await page.waitForFunction(id => window.__supportFixture.owner === id, accountB);
    await call(page, 'switchOwner', accountA); await page.waitForFunction(id => window.__supportFixture.owner === id, accountA);
    await row(page).waitFor(); await call(page, 'release', 'markRead'); await requestsSettled(page); await settle(page);
    const value = await snapshot(page); noNavigation(value);
    assert.equal(value.badgeRefreshes, 0); assert.equal(value.closes, 0); assert.equal(value.countUpdates, 0);
  });
  add(surface, 'held_read_unmount', {}, async page => {
    await call(page, 'hold', 'markRead'); await row(page).click(); await used(page, 'markRead');
    await call(page, 'setMounted', false); await page.waitForFunction(() => !window.__supportFixture.mounted);
    await call(page, 'release', 'markRead'); await requestsSettled(page); await settle(page);
    const value = await snapshot(page); noNavigation(value);
    assert.equal(value.badgeRefreshes, 0); assert.equal(value.closes, 0); assert.equal(value.countUpdates, 0);
  });
  add(surface, 'read_failure_then_retry', {}, async page => {
    await call(page, 'failNext', 'markRead'); await row(page).click(); await requestsSettled(page); await settle(page);
    noNavigation(await snapshot(page)); assert.equal((await snapshot(page)).closes, 0);
    await row(page).click(); const value = await expectDestination(page);
    assert.equal(count(value, 'markRead'), 2);
  });
  add(surface, 'refresh_failure_then_retry', {}, async page => {
    await call(page, 'failNext', 'getNotifications'); await row(page).click(); await requestsSettled(page); await settle(page);
    noNavigation(await snapshot(page)); assert.equal((await snapshot(page)).closes, 0);
    await page.getByRole('button', { name: 'Retry notifications' }).click(); await row(page).waitFor();
    await row(page).click(); const value = await expectDestination(page);
    assert.equal(count(value, 'markRead'), 1, 'Reloaded read-only activation must not repeat the write');
  });
  add(surface, 'legacy_refresh_failure_still_routes', { legacy: true }, async page => {
    await call(page, 'failNext', 'getNotifications'); await row(page).click();
    await expectDestination(page, '/post/synthetic-post');
  });
  for (const key of ['Enter', 'Space']) {
    add(surface, `native_keyboard_${key}`, {}, async page => {
      await row(page).focus(); await page.keyboard.press(key); await expectDestination(page);
    });
  }
  for (const theme of ['light', 'dark', 'beach']) for (const width of [390, 1440]) {
    add(surface, 'theme_viewport_activation', {}, async page => {
      await row(page).click(); await expectDestination(page);
    }, theme, width);
  }
}
add('drawer', 'held_read_close_reopen', {}, async page => {
  await call(page, 'hold', 'markRead'); await row(page).click(); await used(page, 'markRead');
  await call(page, 'setOpen', false); await page.waitForFunction(() => !window.__supportFixture.open);
  await call(page, 'setOpen', true); await page.waitForFunction(() => window.__supportFixture.open);
  await row(page).waitFor(); await call(page, 'release', 'markRead'); await requestsSettled(page); await settle(page);
  const value = await snapshot(page); noNavigation(value);
  assert.equal(value.badgeRefreshes, 0); assert.equal(value.closes, 0); assert.equal(value.countUpdates, 0);
});

async function build() {
  fs.mkdirSync(output, { recursive: true });
  await new Promise((resolve, reject) => webpack({
    mode: 'production', context: root, entry: path.join(__dirname, 'browser-entry.jsx'), devtool: false, cache: false,
    output: { path: output, filename: 'fixture.js' }, optimization: { minimize: false },
    resolve: { extensions: ['.js', '.jsx', '.mjs'], modules: [path.join(root, 'frontend/node_modules')] },
    resolveLoader: { modules: [path.join(root, 'frontend/node_modules')] },
    module: { rules: [{ test: /\.[cm]?jsx?$/, exclude: /node_modules/, use: { loader: req.resolve('babel-loader'), options: {
      babelrc: false, configFile: false, presets: [[req.resolve('@babel/preset-react'), { runtime: 'automatic' }]],
      plugins: [function() { return { visitor: { Program(program, state) {
        const source = baselineSources.get(path.resolve(state.filename));
        if (source) program.node.body = req('@babel/parser').parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body;
      } } }; }],
    } } }] },
    plugins: [new webpack.NormalModuleReplacementPlugin(/(?:AuthContext|ThemeContext|notificationService|useUnreadCounts|ui\/sheet)(?:\.js)?$/, path.join(__dirname, 'browser-stubs.js'))],
  }, (error, stats) => error || stats.hasErrors()
    ? reject(new Error(error ? error.message : stats.toString({ all: false, errors: true }))) : resolve()));
}

(async () => {
  await build();
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'");
    if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'application/javascript' : 'text/html');
    response.end(request.url === '/fixture.js' ? fs.readFileSync(path.join(output, 'fixture.js'))
      : '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synthetic support consumer</title><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  let browserVersion;
  try {
    browser = await req('playwright').chromium.launch({ channel: 'chrome', headless: true });
    browserVersion = browser.version();
    for (const item of cases) {
      const context = await browser.newContext({ viewport: { width: item.width, height: 900 }, serviceWorkers: 'block' });
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (external.push('blocked'), route.abort()));
      const page = await context.newPage(); page.setDefaultTimeout(2500);
      const localErrors = [];
      page.on('pageerror', error => { localErrors.push(error.name); errors.push(error.name); });
      const result = { surface: item.surface, name: item.name, theme: item.theme, width: item.width, passed: false };
      try {
        const query = new URLSearchParams({ surface: item.surface, theme: item.theme, ...item.params });
        await page.goto(`${origin}/notifications?${query}`);
        await page.waitForFunction(() => window.__supportFixture?.ready);
        await row(page).waitFor(); await settle(page);
        await item.run(page); result.passed = true;
      } catch (error) {
        result.error_type = error.name;
        result.error_summary = error.message.split('\n')[0].slice(0, 240);
        result.observed = await snapshot(page).catch(() => ({ fixture_unavailable: true }));
      } finally {
        await page.evaluate(async () => {
          const fixture = window.__supportFixture;
          if (!fixture) return;
          fixture.unmount();
          for (const gate of fixture.gates) if (!gate.released) { gate.released = true; gate.resolve(); }
          await fixture.settle();
        }).catch(() => {});
        result.page_errors = localErrors.length;
        if (localErrors.length) result.passed = false;
        await context.close();
      }
      checks.push(result);
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  const after = fingerprints();
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  const report = {
    baseline, baseline_revision: baseline ? baselineRevision : null, browser: 'Chrome', browser_version: browserVersion,
    passed: checks.filter(check => check.passed).length, total: checks.length, checks,
    fingerprints: before, source_and_fixture_unchanged: unchanged,
    baseline_runtime_fingerprints: baseline ? Object.fromEntries(runtimePaths.map(file => [file, digest(baselineSources.get(path.resolve(root, file)))])) : null,
    page_errors: errors.length, external_requests: external.length, browser_closed: true, fixture_server_closed: !server.listening,
    qualification: 'Actual Page, Drawer, shared inbox hook, deep-link resolver, BrowserRouter, button and keyboard behavior in local Chrome. Synthetic account/theme/API/unread-count boundaries, Sheet frame, and ticket/legacy route destinations. No production CSS, portal/focus-trap, real auth, inbox backend, email, provider, deployment or physical-device acceptance.',
  };
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(__dirname, baseline ? 'browser-baseline-results.json' : 'browser-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ baseline, passed: report.passed, total: report.total, page_errors: report.page_errors,
    external_requests: report.external_requests, source_and_fixture_unchanged: unchanged, browser_closed: true, fixture_server_closed: !server.listening }));
  if (report.passed !== report.total || errors.length || external.length || !unchanged) process.exitCode = 1;
})().catch(error => { console.error(error.name + ': ' + error.message.slice(0, 1600)); process.exitCode = 2; });
