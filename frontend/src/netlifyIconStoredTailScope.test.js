const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Run the actual Netlify command with inert node/npm executables. No install,
// build, network request or forecast fetch is made by this scope probe.
const config = fs.readFileSync(path.resolve(__dirname, '../../netlify.toml'), 'utf8');
const command = JSON.parse(config.match(/^\s*command\s*=\s*("(?:[^"\\]|\\.)*")\s*$/m)[1]);
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'rawsurf-netlify-scope-'));
const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/sh';
const bin = sandbox.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
for (const name of ['node', 'npm']) {
  fs.writeFileSync(path.join(sandbox, name), '#!/bin/sh\nprintf "FLAG=%s\\n" "${REACT_APP_ICON_STORED_TAIL-unset}"\n', { mode: 0o755 });
}
afterAll(() => fs.rmSync(sandbox, { recursive: true, force: true }));

const cases = [
  ['dev branch deploy', 'branch-deploy', 'dev', undefined, 'true'],
  ['dev branch explicitly disabled before owner flip', 'branch-deploy', 'dev', 'false', 'true'],
  ['production', 'production', 'main', undefined, 'unset'],
  ['production from dev', 'production', 'dev', undefined, 'unset'],
  ['preview from dev', 'deploy-preview', 'dev', undefined, 'unset'],
  ['preview repair branch', 'deploy-preview', 'codex/dev-icon-tail-enable', undefined, 'unset'],
  ['another branch', 'branch-deploy', 'staging', undefined, 'unset'],
  ['similar branch name', 'branch-deploy', 'dev-next', undefined, 'unset'],
  ['local Netlify dev', 'dev', 'dev', undefined, 'unset'],
  ['missing context', undefined, 'dev', undefined, 'unset'],
  ['missing branch', 'branch-deploy', undefined, undefined, 'unset'],
  ['production keeps an existing disabled value', 'production', 'main', 'false', 'false'],
];

test.each(cases)('%s has the authorized flag in every build subprocess', (_, context, branch, prior, expected) => {
  const env = { PATH: `${bin}:/usr/bin:/bin`, SystemRoot: process.env.SystemRoot || '', HOME: sandbox };
  if (context !== undefined) env.CONTEXT = context;
  if (branch !== undefined) env.BRANCH = branch;
  if (prior !== undefined) env.REACT_APP_ICON_STORED_TAIL = prior;
  const run = spawnSync(shell, ['-c', command], { env, encoding: 'utf8', timeout: 5000 });
  expect(run.error).toBeUndefined();
  expect(run.status).toBe(0);
  expect(run.stdout.trim().split(/\r?\n/)).toEqual(Array(3).fill(`FLAG=${expected}`));
});
