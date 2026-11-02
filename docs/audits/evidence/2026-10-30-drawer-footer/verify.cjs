// Independent real shell/ToS/Sheet seam on the integration owner's frozen source.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { createRequire } = require('module');
const assert = require('assert/strict');
const cp = require('child_process');

async function main() {
  const root = path.resolve(process.env.RAW_SUPPORT_COMBINED_ROOT || '');
  const deps = process.env.RAW_SUPPORT_TEST_DEPS;
  assert(root.includes('repair-integration-20261030') && deps, 'Explicit frozen candidate and existing dependencies required');
  const runtime = createRequire(path.join(deps, '../package.json'));
  const out = path.join(__dirname, '.run'); fs.mkdirSync(out, { recursive: true });
  const frontend = path.join(root, 'frontend');
  const src = path.join(frontend, 'src');
  const app = fs.readFileSync(path.join(src, 'App.js'), 'utf8');
  assert(app.includes('path="/support" element={<Lazy><SupportRoute /></Lazy>}'));
  assert(app.includes('path="/support/tickets/:ticketId" element={<Lazy><SupportRoute /></Lazy>}'));
  const observed = ['lib/apiClient.js', 'components/support/supportRoutes.js', 'App.js', 'components/routing/AppLayout.js', 'components/routing/ProtectedRoute.js',
    'components/routing/TosReacceptanceGate.js', 'components/support/SupportRoute.js', 'components/support/SupportInbox.js',
    'components/Auth.js', 'components/TopNav.js', 'components/Sidebar.js', 'components/BottomNav.js', 'components/RightSidebar.js',
    'components/NotificationsDrawer.js', 'components/NotificationsPage.js', 'components/ui/sheet.jsx',
    'hooks/useNotificationInbox.js', 'hooks/useUnreadCounts.js', 'services/notificationService.js', 'utils/notificationDeepLinks.js'];
  const fingerprint = () => Object.fromEntries(observed.map(relative => [relative, {
    gitBlob: cp.execFileSync('git', ['hash-object', '--path', `frontend/src/${relative}`, path.join(src, relative)], { cwd: root, encoding: 'utf8' }).trim(),
    sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(src, relative))).digest('hex'),
  }]));
  const before = fingerprint();
  const replacements = new Map();
  const replace = (relative, fixture) => replacements.set(path.resolve(src, relative), path.join(__dirname, fixture));
  replace('contexts/AuthContext', 'auth.jsx'); replace('lib/apiClient', 'transport.js');
  for (const name of ['useWebRTCCall', 'usePushNotifications', 'useActiveSession']) replace(`hooks/${name}`, 'disabled-hooks.js');
  replace('utils/audioUnlock', 'disabled-hooks.js'); replace('hooks/useRoutePreloader', 'disabled-preloader.js');
  const excluded = ['components/Home', 'components/PasswordReset', 'components/PushNotificationPrompt',
    'components/SurfPassport', 'components/DutyStationDrawer', 'components/TopNavDrawerTray', 'components/ViolationBanner',
    'components/ImpersonationBanner', 'components/PersonaMaskBanner', 'components/security/MfaSignInSteps',
    ...['IncomingCallModal', 'OutgoingCallModal', 'InCallView', 'PermissionDeniedModal'].map(n => `components/messages/${n}`)];
  for (const match of app.matchAll(/React\.lazy\(\(\) => import\('([^']+)'\)/g)) {
    if (!match[1].endsWith('/support/SupportRoute') && !match[1].endsWith('/NotificationsPage')) excluded.push(match[1]);
  }
  const names = new Set(['Home', 'ForgotPassword', 'ResetPassword', 'SurfPassport', 'DutyStationIcon', 'TopNavDrawerTray',
    'ImpersonationBanner', 'PersonaMaskBanner', 'ViolationBanner', 'MfaChallengeStep', 'MfaSetupStep', 'PasskeySignInButton']);
  for (const match of app.matchAll(/default: m\.([A-Za-z0-9_]+)/g)) names.add(match[1]);
  fs.writeFileSync(path.join(out, 'unrelated.jsx'), `const Empty = () => null; export default Empty;\n${[...names].map(n => `export const ${n} = Empty;`).join('\n')}`);
  fs.writeFileSync(path.join(out, 'empty.js'), 'export default {};');
  for (const relative of excluded) replacements.set(path.resolve(src, relative), path.join(out, 'unrelated.jsx'));
  fs.writeFileSync(path.join(out, 'entry.jsx'), `import React from 'react'; import { createRoot } from 'react-dom/client';\nimport App from ${JSON.stringify(path.join(src, 'App.js'))}; createRoot(document.getElementById('root')).render(<App />);`);
  const webpack = runtime('webpack');
  const compiler = webpack({ mode: 'development', devtool: false, context: frontend,
    entry: path.join(out, 'entry.jsx'), output: { path: out, filename: 'shell.js', publicPath: '/' },
    resolve: { extensions: ['.js', '.jsx', '.json'], modules: [deps, 'node_modules'] },
    module: { rules: [{ test: /\.[jt]sx?$/, exclude: /node_modules/, use: { loader: runtime.resolve('babel-loader'),
      options: { presets: [[runtime.resolve('@babel/preset-env'), { targets: { chrome: '110' } }],
        [runtime.resolve('@babel/preset-react'), { runtime: 'automatic' }]] } } }] },
    plugins: [new webpack.NormalModuleReplacementPlugin(/.*/, resource => {
      if (/\.css$/.test(resource.request)) { resource.request = path.join(out, 'empty.js'); return; }
      const replacement = replacements.get(path.resolve(resource.context, resource.request).replace(/\.(js|jsx)$/, ''));
      if (replacement) resource.request = replacement;
    })],
  });
  await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => {
    if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true })));
    else resolve();
  })));
  const css = ['index.css', 'App.css', 'styles/wraparound.css'].map(p => fs.readFileSync(path.join(src, p), 'utf8')).join('\n').replace(/^@import[^\n]*\n/gm, '');
  const config = runtime(path.join(frontend, 'tailwind.config.js'));
  config.content = [path.join(src, 'components/{routing,support,ui}/**/*.{js,jsx}'),
    ...['Auth', 'TopNav', 'Sidebar', 'RightSidebar', 'BottomNav', 'NotificationsDrawer', 'NotificationsPage', 'ActiveSessionBanner', 'AdaptiveBackground'].map(n => path.join(src, `components/${n}.js`))];
  const styles = await runtime('postcss')([runtime('tailwindcss')(config)]).process(css, { from: undefined });
  fs.writeFileSync(path.join(out, 'shell.css'), styles.css);
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/shell.css"></head><body><div id="root"></div><script src="/shell.js"></script></body></html>';
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'none'");
    const name = request.url.split('?')[0].slice(1);
    if (/^[A-Za-z0-9_.-]+\.(js|css)$/.test(name) && fs.existsSync(path.join(out, name))) {
      response.setHeader('Content-Type', name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8');
      fs.createReadStream(path.join(out, name)).pipe(response); return;
    }
    if (name === 'logo.svg') { response.setHeader('Content-Type', 'image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg"/>'); return; }
    if (/\.(png|jpg|svg|ico)$/.test(name)) { response.writeHead(204); response.end(); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { chromium, expect } = runtime('@playwright/test');
  const ticket = '44444444-4444-4444-8444-444444444444';
  const results = []; let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const theme of ['light', 'dark', 'beach']) for (const [device, viewport] of Object.entries({ desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } })) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      const external = [], errors = [];
      await context.route('**/*', route => {
        if (route.request().url().startsWith(`${origin}/`)) return route.continue();
        external.push(route.request().url()); return route.abort();
      });
      await context.addInitScript(value => {
        localStorage.setItem('raw-surf-theme', value); localStorage.setItem('raw-surf-cookie-consent', 'accepted');
      }, theme);
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      const extraChecks = []; const footerChecks = [];
      const record = (name, value) => { extraChecks.push({ name, passed: Boolean(value) }); assert(value, name); };
      await page.goto(`${origin}/support/tickets/${ticket}`);
      await expect(page.getByTestId('login-tab')).toBeVisible();
      assert.equal(new URL(page.url()).searchParams.get('redirect'), `/support/tickets/${ticket}`);
      await page.getByTestId('category-surfer').click(); await page.getByTestId('login-tab').click();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.locator('input[type=email]').fill('shell@example.invalid');
      await page.locator('input[type=email]').press('Tab');
      await page.locator('input[type=password]').fill('synthetic-input');
      await expect(page.locator('input[type=email]')).toHaveValue('shell@example.invalid');
      await page.locator('form').getByRole('button', { name: 'Log In', exact: true }).click();
      await expect(page).toHaveURL(`${origin}/support/tickets/${ticket}`);
      const tos = page.getByRole('dialog'); await expect(tos).toBeVisible();
      await expect(page.getByTestId('tos-gate-accept-button')).toBeDisabled();
      await page.getByRole('checkbox', { name: 'I have read and understood the updated Terms of Service' }).focus();
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab'); assert(await tos.evaluate(node => node.contains(document.activeElement)), 'ToS traps keyboard focus');
      }
      const confirm = page.getByRole('checkbox', { name: 'I have read and understood the updated Terms of Service' });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await confirm.focus(); await expect(confirm).toBeFocused();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(confirm).toBeFocused(); await page.keyboard.press('Space'); await expect(confirm).toBeChecked();
      await page.getByTestId('tos-gate-accept-button').click(); await expect(tos).toHaveCount(0);
      await expect(page.getByText('Synthetic conversation details', { exact: true })).toBeVisible();
      await expect(page.locator('#main-content')).toHaveCount(1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.getByLabel('Your reply', { exact: true }).fill('Retained while viewing notifications');
      // The product drawer entry is mobile. Open natively, then test desktop reflow when applicable.
      if (device === 'desktop') await page.setViewportSize({ width: 390, height: 844 });
      const bell = page.getByTestId('topnav-notifications'); await bell.focus(); await page.keyboard.press('Enter');
      const sheet = page.getByRole('dialog', { name: 'Notifications', exact: true }); await expect(sheet).toBeVisible();
      if (device === 'desktop') await page.setViewportSize(viewport);
      await expect(sheet.getByText('New support reply', { exact: true })).toBeVisible();
      await sheet.getByRole('button', { name: /New support reply/ }).focus();
      for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); /* Sheet is intentionally nonmodal; no new trap policy is asserted. */ }
      // Complete finite CSS entry animations before measuring actual on-screen geometry.
      await page.screenshot({ path: path.join(out, `${theme}-${device}-sheet.png`), fullPage: true, animations: 'disabled' });
      const sheetBounds = await sheet.boundingBox();
      const sheetWithinViewport = sheetBounds.x >= -1 && sheetBounds.y >= -1 &&
        sheetBounds.x + sheetBounds.width <= viewport.width + 1 && sheetBounds.y + sheetBounds.height <= viewport.height + 1;
      const desktopEdges = device !== 'desktop' ? null : await sheet.evaluate(node => {
        const r = node.getBoundingClientRect();
        return [[r.left + 12, r.top + 48], [r.right - 12, r.top + 48],
          [r.left + 12, r.bottom - 48], [r.right - 12, r.bottom - 48]].map(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return { x, y, visible: Boolean(hit && (hit === node || node.contains(hit))),
            interceptedBy: hit?.closest('[data-testid]')?.getAttribute('data-testid') || hit?.tagName || null };
        });
      });
      if (desktopEdges) console.log('DESKTOP EDGES', theme, JSON.stringify(desktopEdges));
      const footerHit = await sheet.getByRole('button', { name: 'View All Notifications', exact: true }).evaluate(node => {
        const rect = node.getBoundingClientRect();
        const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return { reachable: Boolean(top && (top === node || node.contains(top))),
          x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          interceptedBy: top?.closest('[data-testid]')?.getAttribute('data-testid') || top?.tagName || null };
      });
      console.log(`BOUNDS ${theme}/${device}: inside=${sheetWithinViewport} box=${JSON.stringify(sheetBounds)}`);
      console.log(`FOOTER ${theme}/${device}: ${JSON.stringify(footerHit)}`);
      if (device === 'desktop') {
        const desktopTarget = page.getByTestId('nav-notifications');
        await page.keyboard.press('Escape'); await expect(sheet).toHaveCount(0);
        await expect(desktopTarget).toBeFocused();
        record('Escape after mobile-to-desktop resize focuses visible connected desktop notification link',
          await desktopTarget.evaluate(node => node.isConnected && document.activeElement === node && node.getBoundingClientRect().width > 0));
        // Desktop has a notification-page link, not a visible drawer opener. Mount the
        // drawer through its existing controlled mobile invoker to test desktop-only layout.
        await bell.evaluate(node => node.click()); await expect(sheet).toBeVisible();
        await page.screenshot({ path: path.join(out, `${theme}-desktop-controlled-open.png`), animations: 'disabled' });
        const opened = await sheet.boundingBox();
        record('controlled desktop opening remains within viewport', opened.x >= 0 && opened.x + opened.width <= viewport.width && opened.y >= 0 && opened.y + opened.height <= viewport.height);
        for (const width of [768, 1024, 1440]) {
          await page.setViewportSize({ width, height: viewport.height });
          await page.screenshot({ path: path.join(out, `${theme}-desktop-${width}.png`), animations: 'disabled' });
          const visible = await sheet.evaluate(node => {
            const r = node.getBoundingClientRect();
            const points = [[r.left + 12, r.top + 48], [r.right - 12, r.top + 48],
              [r.left + 12, r.bottom - 48], [r.right - 12, r.bottom - 48]];
            return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight &&
              points.every(([x, y]) => { const hit = document.elementFromPoint(x, y); return hit && (hit === node || node.contains(hit)); });
          });
          record(`desktop ${width}px drawer edges visible above navigation`, visible);
          record(`desktop ${width}px no horizontal overflow`, !await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
        }
        await sheet.getByRole('button', { name: 'Close', exact: true }).click();
        await expect(sheet).toHaveCount(0); await expect(desktopTarget).toBeFocused();
        record('ordinary desktop close restores visible desktop fallback', true);
        await bell.evaluate(node => node.click()); await expect(sheet).toBeVisible();
        const editor = page.getByLabel('Your reply', { exact: true }); const box = await editor.boundingBox();
        await editor.click({ position: { x: box.width - 12, y: 10 } });
        await expect(sheet).toHaveCount(0); await expect(editor).toBeFocused();
        record('nonmodal outside interaction keeps intentional editor focus', true);
        await bell.evaluate(node => node.click()); await expect(sheet).toBeVisible();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(out, `${theme}-desktop-return-mobile.png`), animations: 'disabled' });
        const mobile = await sheet.boundingBox();
        record('open desktop-to-mobile reflow stays within viewport', mobile.x >= -1 && mobile.x + mobile.width <= 391 && mobile.y >= -1 && mobile.y + mobile.height <= 845);
      }
      await page.keyboard.press('Escape'); await expect(sheet).toHaveCount(0);
      // Allow Radix's asynchronous close cleanup to settle; preserve a failure as evidence.
      try { await expect(bell).toBeFocused({ timeout: 1500 }); } catch { /* recorded below, never counted as pass */ }
      const focusRestored = await bell.evaluate(node => document.activeElement === node);
      const focusAfterEscape = await page.evaluate(() => ({ tag: document.activeElement.tagName,
        testId: document.activeElement.getAttribute('data-testid'), label: document.activeElement.getAttribute('aria-label') }));
      console.log(`FOCUS ${theme}/${device}: restored=${focusRestored} target=${JSON.stringify(focusAfterEscape)}`);
      await expect(page.getByLabel('Your reply', { exact: true })).toHaveValue('Retained while viewing notifications');
      await bell.press('Space'); await expect(sheet).toBeVisible();
      record('reopened bell reports expanded dialog', await bell.getAttribute('aria-expanded') === 'true' && await bell.getAttribute('aria-haspopup') === 'dialog');
      await sheet.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(sheet).toHaveCount(0); await expect(bell).toBeFocused();
      record('ordinary mobile close restores invoker and collapsed state', await bell.getAttribute('aria-expanded') === 'false');
      await bell.press('Space'); await expect(sheet).toBeVisible();
      await sheet.getByRole('button', { name: /New support reply/ }).press('Enter'); await expect(sheet).toHaveCount(0);
      await expect(page).toHaveURL(`${origin}/support/tickets/${ticket}`);
      assert.equal(await page.evaluate(() => window.shellFixture.requests.filter(r => r.method === 'post' && /\/notifications\/.+\/read$/.test(r.url)).length), 1);
      if (device === 'desktop') await page.setViewportSize(viewport);
      await page.reload(); await expect(page.getByText('Synthetic conversation details', { exact: true })).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      assert.equal(await page.evaluate(() => window.shellFixture.requests.filter(r => r.url.includes('/compliance/tos-status/')).length), 0, 'ToS per-account/version cache reused');
      if (device === 'desktop') {
        // Deliberately detach only the synthetic invoker to exercise a stale-ref fallback.
        await bell.evaluate(node => node.click()); await expect(sheet).toBeVisible();
        await bell.evaluate(node => node.remove());
        await page.keyboard.press('Escape'); await expect(sheet).toHaveCount(0);
        const target = page.getByTestId('nav-notifications'); await expect(target).toBeFocused();
        record('disconnected mobile invoker falls back to connected visible desktop link', await target.evaluate(node => node.isConnected && document.activeElement === node));
        await target.press('Enter'); await expect(page).toHaveURL(`${origin}/notifications`);
        record('native desktop notification entry retains full-page navigation', true);
        await page.goto(`${origin}/support/tickets/${ticket}`);
        await expect(page.getByText('Synthetic conversation details', { exact: true })).toBeVisible();
      }
      const footerSizes = [{width:390,height:844},{width:390,height:480},{width:320,height:480},{width:667,height:375},{width:1440,height:1000},{width:390,height:844}];
      for (const [index, size] of footerSizes.entries()) {
        await page.setViewportSize(size);
        if (size.width < 768) await bell.press('Space'); else await bell.evaluate(node => node.click());
        await expect(sheet).toBeVisible();
        // Fill the real scroll region with synthetic rows; no backend traffic or source edits.
        await page.evaluate(() => {
          const original = window.shellFixture.notices[0];
          if (window.shellFixture.notices.length < 20) for(let i=1;i<25;i++) window.shellFixture.notices.push({...original,id:crypto.randomUUID(),title:'Synthetic long history '+i});
        });
        await page.keyboard.press('Escape'); await expect(sheet).toHaveCount(0);
        if (size.width < 768) await bell.press('Space'); else await bell.evaluate(node => node.click());
        await expect(sheet).toBeVisible();
        await page.screenshot({path:path.join(out,`${theme}-${device}-${size.width}x${size.height}-footer.png`),animations:'disabled'});
        const resizeChecks = [];
        const transitions = index === 0 ? [{width:1440,height:1000},{width:390,height:844},{width:1440,height:1000},{width:390,height:844}] : index === 4 ? [{width:390,height:844},{width:1440,height:1000}] : [];
        for (const next of transitions) {
          await page.setViewportSize(next);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await page.screenshot({path:path.join(out,`${theme}-${device}-${index}-${next.width}x${next.height}-open-resize.png`),animations:'disabled'});
          const visible = await sheet.evaluate(node => {
            const r=node.getBoundingClientRect(),f=node.querySelector('[aria-label="View All Notifications"]'),b=f.getBoundingClientRect();
            const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2),scroll=node.querySelector('.modal-body');
            return r.x>=-1&&r.right<=innerWidth+1&&r.y>=-1&&r.bottom<=innerHeight+1&&(hit===f||f.contains(hit))&&scroll.clientHeight>0&&document.documentElement.scrollWidth<=innerWidth;
          });
          resizeChecks.push({size:next,passed:visible});
        }
        const metrics = await sheet.evaluate(node => {
          const r=node.getBoundingClientRect(), button=node.querySelector('[aria-label="View All Notifications"]'),f=button.getBoundingClientRect();
          const n=document.querySelector('[data-testid="bottom-nav"]'),nb=n.getBoundingClientRect();
          const scroll=node.querySelector('.modal-body'),hit=document.elementFromPoint(f.x+f.width/2,f.y+f.height/2);
          const children=[...node.children].map(x=>({tag:x.tagName,h:x.getBoundingClientRect().height}));
          const old=scroll.scrollTop;scroll.scrollTop=scroll.scrollHeight;
          return {drawer:{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom},footer:{x:f.x,y:f.y,width:f.width,height:f.height},nav:{y:nb.y,height:nb.height},safe:getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom'),
            footerHit:hit===button||button.contains(hit),interceptor:hit?.closest('[data-testid]')?.getAttribute('data-testid')||hit?.tagName,
            scrollable:scroll.clientHeight>0&&scroll.scrollHeight>scroll.clientHeight&&scroll.scrollTop>old,scrollHeight:scroll.scrollHeight,clientHeight:scroll.clientHeight,children};
        });
        let native=false; const activationMode = ['click','Enter','Space','click','Enter','Space'][index];
        try { const footer=sheet.getByRole('button',{name:'View All Notifications',exact:true});if(activationMode==='click') await footer.click({timeout:1500});else {await footer.focus();await expect(footer).toBeFocused();await footer.press(activationMode);}await expect(page).toHaveURL(`${origin}/notifications`);native=true; } catch { await page.keyboard.press('Escape'); }
        const noOverflow=!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
        footerChecks.push({size,metrics,activationMode,resizeChecks,nativeActivation:native,noOverflow,passed:metrics.footerHit&&metrics.scrollable&&native&&noOverflow&&resizeChecks.every(row=>row.passed)});
        console.log('FOOTER CASE',theme,device,JSON.stringify(footerChecks.at(-1)));
        await page.goto(`${origin}/support/tickets/${ticket}`);await expect(page.getByText('Synthetic conversation details',{exact:true})).toBeVisible();
        if(size.width<768){await page.getByTestId('bottomnav-create').click();await expect(page).toHaveURL(`${origin}/create`);await page.goto(`${origin}/support/tickets/${ticket}`);await expect(page.getByText('Synthetic conversation details',{exact:true})).toBeVisible();}
      }
      await page.evaluate(() => window.shellFixture.setUser({ id: '22222222-2222-4222-8222-222222222222', role: 'Surfer' }));
      await expect(page.getByText('Synthetic conversation details', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('alert')).toContainText('Ticket unavailable');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      const requests = await page.evaluate(() => window.shellFixture.requests.map(r => ({ method: r.method, url: r.url })));
      results.push({ theme, device, passed: focusRestored && sheetWithinViewport && (!desktopEdges || desktopEdges.every(point => point.visible)) && extraChecks.every(row => row.passed) && footerChecks.every(row => row.passed), focusRestored, focusAfterEscape,
        sheetWithinViewport, sheetBounds, footerHit, desktopEdges, extraChecks, footerChecks,
        screenshot: `.run/${theme}-${device}-sheet.png`, requests,
        externalRequests: 0, pageErrors: 0, horizontalOverflow: false, cases: ['actual App routes', 'sign-in return across category/tab',
          'real ToS confirmation/focus/cache', 'unlinked Grom support', 'real shell', 'real nonmodal Radix Sheet portal/six Tab steps/Escape/focus return',
          'native Enter/Space activation and one read', 'desktop drawer reflow', 'draft retained across drawer', 'refresh', 'wrong-account content removal'] });
      console.log(`CHECKED ${theme}/${device}; focus restoration ${focusRestored ? 'PASS' : 'FAIL'}`); await context.close();
    }
    const after = fingerprint(); assert.deepEqual(after, before, 'Frozen candidate source remained unchanged');
    fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify({ passed: results.filter(r => r.passed).length, total: 6,
      candidateParent: cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      browserVersion: browser.version(), node: process.version, source: before, results,
      boundaries: { auth: 'synthetic provider; random ephemeral local marker, no JWT verification', api: 'in-memory transport',
        actual: observed, disabled: [...replacements.keys()].map(p => path.relative(src, p)), css: 'actual Tailwind/index/App/wraparound; remote font imports removed',
        backend: 'separately owned by integration chat; this fixture does not send requests' } }, null, 2) + '\n');
    if (results.some(r => !r.passed)) process.exitCode = 1;
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
