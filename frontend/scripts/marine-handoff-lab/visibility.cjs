// Exact-pixel regression, not a frame-rate or release benchmark.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('../../node_modules/@playwright/test');
const { compileLab } = require('./run.cjs');

function verifyVisibility(rows) {
  assert.deepEqual(rows.map(r => r.legacyDraws), [true, false, false, true], 'Missing control/repeat');
  const expected = [];
  for (const rating of [false, true]) for (const theme of ['light', 'dark', 'beach'])
    for (const debug of ['normal', 'why', 'part_fbo']) for (const opacity of [1, 0, 0, 1])
      expected.push({ rating, theme, debug, opacity });
  for (const row of rows) {
    assert.deepEqual(row.errors, [], 'Browser error'); assert.equal(row.layerErrors, 0, 'Disabled layer');
    assert.equal(row.snapshots.length, 133, 'Missing frame');
    assert(row.snapshots.every(s => s.glError === 0 && Number.isFinite(s.L) && /^[a-f0-9]{64}$/.test(s.pixelSha256)), 'Invalid frame');
    const cases = row.snapshots.filter(s => s.phase === 'visibility');
    assert.deepEqual(cases.map(s => s.scenario), expected, 'Missing render case');
    assert(cases.every(s => s.ratingActive === s.scenario.rating), 'Rating path not exercised');
    assert(cases.filter(s => s.scenario.opacity === 1).every(s => s.painted > 0), 'Blank visible draw');
    for (const theme of ['light', 'dark', 'beach']) {
      const visible = cases.filter(s => s.scenario.rating && s.scenario.theme === theme && s.scenario.debug === 'normal' && s.scenario.opacity === 1);
      assert.notEqual(visible[0].pixelSha256, visible[1].pixelSha256, 'Frozen rating animation');
    }
    assert.deepEqual(row.snapshots.map(s => s.pixelSha256), rows[0].snapshots.map(s => s.pixelSha256), 'Pixels changed');
    assert.deepEqual(row.snapshots.map(s => s.submissions.advection), rows[0].snapshots.map(s => s.submissions.advection), 'Simulation changed');
    assert.equal(row.submissions.advection, 133, 'Simulation did not run every frame');
    assert.deepEqual(row.submissions, row.snapshots.at(-1).submissions, 'Invalid submission evidence');
  }
  for (const name of ['heatmap', 'crests']) {
    assert(rows[1].submissions[name] < rows[0].submissions[name], 'No submission reduction: ' + name);
    assert.equal(rows[1].submissions[name], rows[2].submissions[name], 'Repair did not repeat');
    assert.equal(rows[0].submissions[name], rows[3].submissions[name], 'Control did not repeat');
  }
  return { diagnosticOnly: true, frames: 532, renderCasesPerLeg: 72,
    control: rows[0].submissions, repair: rows[1].submissions,
    scope: 'Fixed-clock actual WebGL; synthetic all-water input. Exact framebuffer/simulation parity, not performance or scientific acceptance.' };
}

async function main() {
  const out = path.resolve(process.argv[2]); fs.mkdirSync(out, { recursive: true });
  await compileLab(out);
  const browser = await chromium.launch({ headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    ...(process.env.HANDOFF_BROWSER_CHANNEL ? { channel: process.env.HANDOFF_BROWSER_CHANNEL } : {}) });
  const rows = [];
  try {
    for (const legacyDraws of [true, false, false, true]) {
      const page = await browser.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' || m.text().includes('Render error')) errors.push(m.text()); });
      try {
        await page.route('https://visibility.test/', r => r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
        await page.goto('https://visibility.test/');
        await page.addScriptTag({ path: path.join(out, 'bundle.js') });
        const data = await page.evaluate(o => window.runHandoffLab(o), { delayFrames: 10, blend: true, visibilityCases: true, legacyDraws });
        delete data.image; rows.push({ ...data, errors });
        fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(rows, null, 2) + '\n');
        console.log(JSON.stringify({ legacyDraws, errors, submissions: data.submissions }));
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
  const summary = verifyVisibility(rows);
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
}
module.exports = { verifyVisibility };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
