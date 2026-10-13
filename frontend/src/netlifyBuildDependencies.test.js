const { needsBuild, ignored } = require('../scripts/netlify-ignore.cjs');
test.each(['frontend/src/app.js', 'frontend/public/service-worker.js', 'frontend/package.json',
  'frontend/package-lock.json', 'frontend/craco.config.js', 'frontend/.npmrc',
  'frontend/update-sw-version.js', 'netlify.toml', '.node-version', 'netlify/functions/proxy.js',
  'scripts/prebuild.cjs'])('build dependency triggers production rebuild: %s', path => {
  expect(needsBuild([path])).toBe(true);
});
test('backend/docs-only changes do not rebuild frontend', () => {
  expect(needsBuild(['backend/routes/weather.py', 'docs/weather-program/STATE.md'])).toBe(false);
});
test.each([{}, { CACHED_COMMIT_REF: 'missing', COMMIT_REF: 'abcdef123' },
  { CACHED_COMMIT_REF: 'abcdef123', COMMIT_REF: '--output=private' }])('unknown or invalid history builds safely: %s', env => {
  expect(ignored(env)).toBe(false);
});
