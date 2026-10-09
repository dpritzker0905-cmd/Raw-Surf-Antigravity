/**
 * Wind bench: bundle the page with the app's OWN webpack (no new dependency) around the REAL
 * WebGLWindEngine.js, from the working tree or from a git ref extracted with `git archive`.
 * The output goes to the bench's out/ folder: never frontend/public, never the app bundle.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FRONTEND = path.resolve(__dirname, '..', '..');
const REPO = path.resolve(FRONTEND, '..');
const NODE_MODULES = path.join(FRONTEND, 'node_modules');
const ENGINE_REL = path.join('components', 'map', 'WebGLWindEngine.js');

const git = (args, opts = {}) => execFileSync('git', args, { cwd: REPO, maxBuffer: 1 << 30, ...opts });

/** Where the engine comes from: the working tree, or `frontend/src` at `ref` (cached by commit). */
function engineSource(ref, cacheDir) {
  if (!ref) {
    const head = git(['rev-parse', '--short=12', 'HEAD']).toString().trim();
    const dirty = git(['status', '--porcelain', '--', 'frontend/src']).toString().trim() ? '+dirty' : '';
    return { srcRoot: path.join(FRONTEND, 'src'), label: `working tree @ ${head}${dirty}` };
  }
  const sha = git(['rev-parse', '--verify', `${ref}^{commit}`]).toString().trim();
  const dir = path.join(cacheDir, `src-${sha.slice(0, 12)}`);
  const srcRoot = path.join(dir, 'frontend', 'src');
  if (!fs.existsSync(path.join(srcRoot, ENGINE_REL))) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const tarball = git(['archive', '--format=tar', sha, 'frontend/src']);
    // cwd, not `-C dir`: Git Bash's GNU tar reads "C:\..." as host:path and fails on Windows.
    execFileSync('tar', ['-x', '-f', '-'], { cwd: dir, input: tarball, maxBuffer: 1 << 30 });
  }
  if (!fs.existsSync(path.join(srcRoot, ENGINE_REL))) throw new Error(`${ref} has no frontend/src/${ENGINE_REL.replace(/\\/g, '/')}`);
  return { srcRoot, label: `${ref} @ ${sha.slice(0, 12)}` };
}

function buildBench({ srcRoot, outDir }) {
  const webpack = require(path.join(NODE_MODULES, 'webpack'));
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'page', 'index.html'), path.join(outDir, 'index.html'));
  return new Promise((resolve, reject) => {
    webpack({
      mode: 'development',
      devtool: false,
      target: 'web',
      performance: { hints: false },
      entry: path.join(__dirname, 'page', 'bench-entry.js'),
      output: { path: outDir, filename: 'bench.js' },
      resolve: { modules: [NODE_MODULES], alias: { 'wind-bench-engine$': path.join(srcRoot, ENGINE_REL) } },
      plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
    }, (err, stats) => {
      if (err) return reject(err);
      const info = stats.toJson({ all: false, errors: true, warnings: true, assets: true });
      if (stats.hasErrors()) return reject(new Error(info.errors.map((e) => e.message || e).join('\n')));
      resolve({ bytes: info.assets.reduce((a, x) => a + x.size, 0), warnings: info.warnings.length });
    });
  });
}

module.exports = { FRONTEND, REPO, engineSource, buildBench };
