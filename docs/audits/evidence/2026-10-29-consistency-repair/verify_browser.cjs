// Run: node <this file> <private-output-directory>. Owns and closes its loopback server/browser.
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '../../../..');
const req = require('module').createRequire(path.join(root, 'frontend/package.json'));
const webpack = req('webpack');
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: true });

async function build() {
  await new Promise((resolve, reject) => webpack({
    mode: 'production', context: root, entry: path.join(__dirname, 'browser-entry.jsx'),
    devtool: false, cache: false, output: { path: output, filename: 'fixture.js' },
    optimization: { minimize: false },
    resolve: { extensions: ['.js', '.jsx', '.mjs'], modules: [path.join(root, 'frontend/node_modules')] },
    resolveLoader: { modules: [path.join(root, 'frontend/node_modules')] },
    module: { rules: [{ test: /\.[cm]?jsx?$/, exclude: /node_modules/, use: {
      loader: req.resolve('babel-loader'), options: { babelrc: false, configFile: false,
        presets: [[req.resolve('@babel/preset-react'), { runtime: 'automatic' }]] },
    } }] },
    plugins: [
      new webpack.NormalModuleReplacementPlugin(/(?:AuthContext|ThemeContext)(?:\.js)?$/, path.join(__dirname, 'browser-context.js')),
      new webpack.NormalModuleReplacementPlugin(/apiClient(?:\.js)?$/, path.join(__dirname, 'browser-api.js')),
    ],
  }, (error, stats) => error || stats.hasErrors()
    ? reject(new Error(error ? error.message : stats.toString({ all: false, errors: true }))) : resolve()));
  const css = await req('postcss')([req('tailwindcss')({
    ...require(path.join(root, 'frontend/tailwind.config.js')),
    content: [path.join(root, 'frontend/src/**/*.{js,jsx}')],
  })]).process('@tailwind base;\n@tailwind components;\n@tailwind utilities;', { from: undefined });
  fs.writeFileSync(path.join(output, 'fixture.css'), css.css);
}

(async () => {
  await build();
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'");
    if (request.url === '/fixture.js' || request.url === '/fixture.css') {
      response.setHeader('Content-Type', request.url.endsWith('.js') ? 'application/javascript' : 'text/css');
      response.end(fs.readFileSync(path.join(output, request.url.slice(1))));
    } else {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><title>Raw Surf isolated consistency fixture</title></head><body style="margin:0"><div id="root"></div><script src="/fixture.js"></script></body></html>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const results = [];
  try {
    browser = await req('playwright').chromium.launch({ channel: 'chrome', headless: true });
    for (const width of [390, 1440]) for (const theme of ['light', 'dark', 'beach']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
      const external = [];
      const errors = [];
      await context.route('**/*', route => {
        if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue();
        external.push(route.request().url()); return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/?theme=${theme}`);
      await page.getByText('Notification fixture 1', { exact: true }).waitFor();
      const markAll = page.getByRole('button', { name: /mark all/i });
      assert.equal(await markAll.count(), 1, 'Global unread item outside latest50 must expose read-all');
      await page.getByRole('button', { name: /load older/i }).click();
      await page.getByText('Older unread fixture', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'No horizontal overflow');
      await page.screenshot({ path: path.join(output, `${theme}-${width}.png`), fullPage: false });
      await markAll.click();
      await page.waitForFunction(() => window.__consistencyFixture.rows.every(row => row.is_read));
      await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(button => /mark all/i.test(button.textContent)));
      await page.goto(`http://127.0.0.1:${server.address().port}/?theme=${theme}&mode=reviews`);
      await page.getByText('Synthetic reviewer', { exact: true }).waitFor();
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      results.push({ theme, width, history: true, global_unread_control: true, read_all: true, reviews: true, external_requests: 0, page_errors: 0 });
      await context.close();
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, source: 'actual React components with synthetic in-memory service; local Chrome; not deployed acceptance' }, null, 2));
    console.log(JSON.stringify({ passed: results.length, results }));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
