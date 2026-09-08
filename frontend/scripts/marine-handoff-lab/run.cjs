const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '../../..');
const webpack = require(path.join(root, 'frontend/node_modules/webpack'));
const { chromium } = require(path.join(root, 'frontend/node_modules/@playwright/test'));
const out = path.resolve(process.argv[2] || path.join(root, 'frontend/test-results/marine-handoff-lab'));
process.env.NODE_ENV = 'test';
async function main() {
  if (process.argv[2] === '--verify') {
    verifyResults(JSON.parse(fs.readFileSync(process.argv[3], 'utf8')));
    return;
  }
  fs.mkdirSync(out, { recursive: true });
  await new Promise((resolve, reject) => webpack({
    mode: 'development', context: root, target: 'web', devtool: false,
    entry: path.join(__dirname, 'browser.js'),
    output: { path: out, filename: 'bundle.js', publicPath: '' },
    resolve: { modules: [path.join(root, 'frontend/node_modules'), 'node_modules'],
      extensions: ['.js', '.jsx', '.json'], alias: { '@': path.join(root, 'frontend/src') } },
    module: { rules: [{ test: /\.jsx?$/, exclude: /node_modules/, use: {
      loader: path.join(root, 'frontend/node_modules/babel-loader'), options: {
        babelrc: false, configFile: false, presets: [path.join(root, 'frontend/node_modules/babel-preset-react-app')],
      } } }] },
    plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'test' }) })],
  }, (error, stats) => {
    if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true })));
    else resolve();
  }));
  const browser = await chromium.launch({ headless: true,
    ...(process.env.HANDOFF_BROWSER_CHANNEL ? { channel: process.env.HANDOFF_BROWSER_CHANNEL } : {}) });
  const results = [];
  try {
    for (const [name, options] of [['on_time', { delayFrames: 0 }], ['delayed', { delayFrames: 10 }],
      ['delayed_repeat', { delayFrames: 10 }], ['value_control', { delayFrames: 0, incomingHeight: 5 }],
      ['blend', { delayFrames: 10, blend: true }], ['blend_repeat', { delayFrames: 10, blend: true }],
      ['on_time_blend', { delayFrames: 0, blend: true }],
      ['delayed_60hz', { delayFrames: 60, frameMs: 1000 / 60 }],
      ['blend_60hz', { delayFrames: 60, frameMs: 1000 / 60, blend: true }]]) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && m.text().includes('Render error'))) errors.push(m.text()); });
      await page.route('https://handoff.test/', route => route.fulfill({ contentType: 'text/html',
        body: '<html><body style="margin:0"></body></html>' }));
      await page.goto('https://handoff.test/');
      await page.addScriptTag({ path: path.join(out, 'bundle.js') });
      if (errors.length) throw new Error('Bundle boot: ' + JSON.stringify(errors));
      const data = await page.evaluate(o => window.runHandoffLab(o), options);
      fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(data.image.split(',')[1], 'base64'));
      delete data.image;
      results.push({ name, errors, ...data });
      await page.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  const summary = verifyResults(results);
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
}

function verifyResults(results) {
  assert.deepEqual(results.map(r => r.name), ['on_time', 'delayed', 'delayed_repeat', 'value_control',
    'blend', 'blend_repeat', 'on_time_blend', 'delayed_60hz', 'blend_60hz'], 'missing experiment leg');
  const frames = name => results.find(r => r.name === name).snapshots.filter(s => s.phase === 'handoff');
  const pixels = name => frames(name).map(s => s.pixelSha256);
  const step = name => Math.max(...frames(name).slice(1).map((s, i) => Math.abs(s.L - frames(name)[i].L)));
  const summary = results.map(r => ({ name: r.name, errors: r.errors, layerErrors: r.layerErrors,
    minPainted: Math.min(...r.snapshots.map(x => x.painted)), maxStep: step(r.name),
    minMult: Math.min(...r.snapshots.map(x => x.mult ?? 1)) }));
  console.log(JSON.stringify(summary));
  for (const r of results) {
    assert.deepEqual(r.errors, [], r.name + ': browser/render error');
    assert.equal(r.layerErrors, 0, r.name + ': disabled layer');
    assert(r.snapshots.length === 1 + Math.ceil(2000 / r.frameMs) + Math.ceil(4000 / r.frameMs), r.name + ': missing frames');
    assert(r.snapshots.every(s => s.glError === 0 && Number.isFinite(s.L) && s.painted > 0 && /^[a-f0-9]{64}$/.test(s.pixelSha256)), r.name + ': invalid/blank draw');
    // The first coarse upload is a setup frame, before the measured resident/handoff window.
    // Edge and Ubuntu disagree on how many of its faint pixels exceed the eight-level threshold.
    // Keep setup nonblank; require the original spatial floor throughout resident warmup/handoff.
    assert(r.snapshots.filter(s => s.phase !== 'coarse').every(s => s.painted > 190000), r.name + ': measured coverage gap');
    assert.deepEqual([...new Set(r.snapshots.map(s => s.resident))], ['fixed-global', 'fixed-regional', 'fixed-incoming'], r.name + ': skipped a commit');
  }
  assert(step('delayed') > 20 && step('on_time') < 2, 'control failed to reproduce the delay-dependent discontinuity');
  assert.deepEqual(pixels('delayed'), pixels('delayed_repeat'), 'baseline replay is not deterministic');
  assert.deepEqual(pixels('blend'), pixels('blend_repeat'), 'candidate replay is not deterministic');
  assert.deepEqual(pixels('on_time'), pixels('on_time_blend'), 'opt-in changed an on-time handoff');
  assert.notDeepEqual(pixels('value_control'), pixels('on_time'), 'draw is insensitive to changed wave data');
  for (const suffix of ['', '_60hz']) {
    const name = 'blend' + suffix, prior = 'delayed' + suffix;
    const arrival = results.find(r => r.name === name).delayFrames, f = frames(name);
    assert.equal(f[arrival].handoff.scale, 0, name + ': treatment never engaged');
    assert(Math.abs(f[arrival].L - f[arrival - 1].L) < 1, name + ': replacement still steps');
    assert(step(name) < .4 * step(prior), name + ': inadequate controlled improvement');
    assert.deepEqual(pixels(name).slice(-10), pixels(prior).slice(-10), name + ': final rendering changed');
  }
  console.log('PASS: real WebGL controls, repeatability, continuity, convergence and unchanged on-time path. Coastal/app validation remains separate.');
  return summary;
}
module.exports = { verifyResults };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
