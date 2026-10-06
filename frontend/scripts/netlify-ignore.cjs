// Netlify runs this from build.base. Resolve the repository first; unknown state builds.
const { execFileSync } = require('child_process');
function needsBuild(paths) {
  return paths.some(path => path.startsWith('frontend/') || path.startsWith('netlify/')
    || path.startsWith('scripts/') || ['netlify.toml', '.node-version', '.nvmrc', '.npmrc',
      '.yarnrc', '.yarnrc.yml', 'package.json', 'package-lock.json', 'yarn.lock'].includes(path));
}
function ignored(env = process.env) {
  const refs = [env.CACHED_COMMIT_REF, env.COMMIT_REF];
  if (refs.some(ref => !/^[a-f0-9]{7,64}$/i.test(ref || ''))) return false;
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    const paths = execFileSync('git', ['-C', root, 'diff', '--name-only', '-z', ...refs, '--'], { encoding: 'utf8' }).split('\0').filter(Boolean);
    return !needsBuild(paths);
  } catch (_) { return false; }
}
module.exports = { needsBuild, ignored };
if (require.main === module) process.exit(ignored() ? 0 : 1);
