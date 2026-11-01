/**
 * NO apiClient CALL STARTS WITH '/api' (audit 2026-10-18, F-06).
 *
 * apiClient's axios base URL is `${BACKEND_URL}/api`, so apiClient.post('/api/x') requests /api/api/x and 404s.
 * It silently broke account deletion (DeleteAccountSection) and the Career challenges tab (ChallengesTab).
 *
 * KNOWN_BROKEN is shrink-only: GearHub's PATCH '/api/profiles/me' has the same prefix bug, but the backend has no
 * PATCH /api/profiles/me route to receive it, so dropping the prefix alone would not make it work (a backend
 * contract question, tracked as a follow-up in the PR). Do not add to this list; fix the path instead.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..');
const KNOWN_BROKEN = ['components/GearHub.js'];

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
  return /\.(js|jsx|ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
});

const DOUBLE_PREFIX = /\bapiClient\s*\.\s*(get|post|put|patch|delete|head|request)\s*\(\s*[`'"]\/api(\/|['"`])/;

it('no apiClient call passes a path that begins with /api', () => {
  const offenders = walk(SRC)
    .filter((f) => DOUBLE_PREFIX.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
    .filter((f) => !KNOWN_BROKEN.includes(f));
  expect(offenders).toEqual([]);
});

it('the known-broken list only names files that still have the problem', () => {
  const stale = KNOWN_BROKEN.filter((f) => !DOUBLE_PREFIX.test(fs.readFileSync(path.join(SRC, f), 'utf8')));
  expect(stale).toEqual([]);
});
