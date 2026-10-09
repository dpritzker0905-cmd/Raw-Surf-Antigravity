#!/usr/bin/env node
/**
 * Wind bench: the one command. Builds the page around the REAL wind engine, renders the matrix in
 * headless Chromium on this machine's GPU, prints the table and the positive-control verdict, and
 * writes a contact sheet. Offline: it never touches the backend. See README.md.
 *
 *   node scripts/wind-bench/run.js                 # full matrix: 13 views x 3 themes x 2 variants (~5 min)
 *   node scripts/wind-bench/run.js --control       # positive control only (2 runs, ~10 s)
 *   node scripts/wind-bench/run.js --seeds 3       # replicates: count only artifacts that recur (~14 min)
 *   node scripts/wind-bench/run.js --ref origin/dev --themes dark
 *   node scripts/wind-bench/run.js --serve         # serve the page for a browser tab instead
 *
 * Exit: 0 control PASS · 1 control FAIL (or --strict and the candidate has an artifact) · 2 BLIND or error.
 */
const fs = require('fs');
const path = require('path');
const { FRONTEND, engineSource, buildBench } = require('./build');
const { POSITIVE_CONTROL, buildMatrix, controlConfigs } = require('./matrix');
const { configKey, formatTable, contactSheetHtml } = require('./report');
const { mergeSeeds, controlAcrossSeeds } = require('./replicates');
const { serveDir, gpuArgs } = require('./serve');

const SOURCE_LINES = fs.readFileSync(__filename, 'utf8').split('\n');
const HELP = SOURCE_LINES.slice(2, SOURCE_LINES.findIndex((l) => l.trim() === '*/')).map((l) => l.replace(/^ \*\s?/, '')).join('\n');
const usageError = (msg) => Object.assign(new Error(msg), { usage: true });

function parseArgs(argv) {
  const opts = { frames: 180, res: 384, gl: 'gpu', out: path.join(__dirname, 'out'), control: true };
  const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw usageError(`${a} needs a value`); return argv[++i]; };
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--control') opts.controlOnly = true;
    else if (a === '--no-control') opts.control = false;
    else if (a === '--views') opts.views = list(val());
    else if (a === '--themes') opts.themes = list(val());
    else if (a === '--variants') opts.variants = list(val());
    else if (a === '--frames') opts.frames = Number(val());
    else if (a === '--res') opts.res = Number(val());
    else if (a === '--ref') opts.ref = val();
    else if (a === '--serve') opts.serve = true;
    else if (a === '--port') opts.port = Number(val());
    else if (a === '--gl') opts.gl = val();
    else if (a === '--headed') opts.headed = true;
    else if (a === '--out') opts.out = path.resolve(val());
    else if (a === '--json') opts.json = path.resolve(val());
    else if (a === '--strict') opts.strict = true;
    else if (a === '--real-clock') opts.clock = 'real';
    else if (a === '--seed') opts.seed = Number(val());
    else if (a === '--seeds') opts.seeds = Number(val());
    else throw usageError(`unknown option ${a} (try --help)`);
  }
  return opts;
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
}

async function runHeadless(url, configs, opts) {
  const { chromium } = require(path.join(FRONTEND, 'node_modules', 'playwright'));
  const browser = await chromium.launch({ headless: !opts.headed, args: gpuArgs(opts.gl) });
  const errors = new Map();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    page.on('pageerror', (e) => errors.set(e.message, (errors.get(e.message) || 0) + 1));
    page.on('console', (m) => { if (m.type() === 'error') errors.set(m.text(), (errors.get(m.text()) || 0) + 1); });
    await page.goto(url);
    await page.waitForFunction(() => window.__WIND_BENCH__ && window.__WIND_BENCH__.renderer);
    const env = await page.evaluate(() => ({ ready: window.__WIND_BENCH__.ready, renderer: window.__WIND_BENCH__.renderer, dpr: window.__WIND_BENCH__.dpr }));
    if (!env.ready) throw new Error(`no WebGL2 context (renderer: ${env.renderer})`);
    console.log(`renderer: ${env.renderer} · canvas DPR ${env.dpr}`);
    if (/swiftshader/i.test(env.renderer) && opts.gl !== 'swiftshader') console.log('⚠ software rendering: verdicts hold, ms/frame does not describe a real device');
    const results = [];
    for (let i = 0; i < configs.length; i++) {
      const t0 = Date.now();
      const r = await page.evaluate((cfg) => window.__WIND_BENCH__.runOne(cfg), configs[i]);
      results.push(r);
      const flag = r.artifacts ? `  ← ${r.artifacts} artifact${r.artifacts > 1 ? 's' : ''}` : '';
      const fine = r.fineActive === false ? '  ⚠ engine did not take the regional grid' : '';
      console.log(`[${pad2(i + 1, configs.length)}/${configs.length}] ${configKey(r).padEnd(30)} ink ${String(r.ink).padStart(5)}  ${((Date.now() - t0) / 1000).toFixed(1)} s${flag}${fine}`);
    }
    return { results, renderer: env.renderer, errors };
  } finally {
    await browser.close();
  }
}

const pad2 = (i, n) => String(i).padStart(String(n).length);

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return 0; }
  const source = engineSource(opts.ref, path.join(opts.out, 'cache'));
  const benchDir = path.join(opts.out, 'bench');
  const built = await buildBench({ srcRoot: source.srcRoot, outDir: benchDir });
  console.log(`engine: ${source.label} · bundle ${(built.bytes / 1024).toFixed(0)} KiB`);
  const server = await serveDir(opts.out, opts.port);
  const base = `http://127.0.0.1:${server.address().port}`;

  if (opts.serve) {
    console.log(`bench page:  ${base}/bench/index.html   (?auto=control | dark | full runs on load)`);
    const runsDir = path.join(opts.out, 'runs');
    const runs = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).sort() : [];
    if (runs.length) console.log(`last sheet:  ${base}/runs/${runs[runs.length - 1]}/contact-sheet.html`);
    console.log('Ctrl+C to stop.');
    return new Promise(() => {});
  }

  try {
    const shape = { views: opts.views, themes: opts.themes, variants: opts.variants, frames: opts.frames, res: opts.res, clock: opts.clock, seed: opts.seed, seeds: opts.seeds };
    let configs;
    try { configs = opts.controlOnly ? controlConfigs(shape) : buildMatrix(shape); } catch (e) { throw usageError(e.message); }
    if (opts.control && !opts.controlOnly) {
      const have = new Set(configs.map(configKey));
      configs = configs.concat(controlConfigs(shape).filter((c) => !have.has(configKey(c))));
    }
    const { results, renderer, errors } = await runHeadless(`${base}/bench/index.html`, configs, opts);
    const merged = mergeSeeds(results);
    const control = controlAcrossSeeds(results);

    const table = formatTable(merged, control);
    console.log('\n' + table);
    const runDir = path.join(opts.out, 'runs', `${stamp()}${opts.ref ? '-' + opts.ref.replace(/[^\w.-]+/g, '_') : ''}`);
    fs.mkdirSync(runDir, { recursive: true });
    const meta = { engine: source.label, renderer, frames: opts.frames, particles: `${opts.res}²`, seeds: opts.seeds || 1, date: new Date().toISOString() };
    const slim = (rows) => rows.map(({ shot, ...r }) => r);
    const report = JSON.stringify({ meta, control, merged: slim(merged), results: slim(results) }, null, 1);
    fs.writeFileSync(path.join(runDir, 'contact-sheet.html'), contactSheetHtml(merged, control, meta));
    fs.writeFileSync(path.join(runDir, 'report.json'), report);
    fs.writeFileSync(path.join(runDir, 'table.txt'), table + '\n');
    if (opts.json) fs.writeFileSync(opts.json, report);
    console.log(`\ncontact sheet: ${path.join(runDir, 'contact-sheet.html')}`);
    if (errors.size) {
      console.log(`page errors (${errors.size} distinct):`);
      [...errors].slice(0, 8).forEach(([msg, n]) => console.log(`  ${n}x ${msg.slice(0, 200)}`));
    }
    const glErrors = results.filter((r) => r.glError);
    if (glErrors.length) console.log(`⚠ GL errors in ${glErrors.length} runs: ${glErrors.map(configKey).join(', ')}`);

    if (!control) { console.log('positive control not run (--no-control): no verdict.'); return glErrors.length ? 2 : 0; }
    if (control.status === 'BLIND' || glErrors.length) return 2;
    if (control.status === 'FAIL') return 1;
    const strictHits = merged.filter((r) => r.variant === 'candidate' && r.artifacts > 0);
    if (opts.strict && strictHits.length) {
      console.log(`--strict: candidate has artifacts in ${strictHits.map(configKey).join(', ')}`);
      return 1;
    }
    return 0;
  } finally {
    server.close();
  }
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error(e.usage ? e.message : (e.stack || e.message)); process.exitCode = 2; });
