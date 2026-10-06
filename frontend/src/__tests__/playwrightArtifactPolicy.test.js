import fs from 'fs';
import path from 'path';
import vm from 'vm';
import crypto from 'crypto';

test.each([false, true])('deployed E2E credential present=%s never enables raw traces', present => {
  const code = present ? crypto.randomBytes(24).toString('hex').toUpperCase() : '';
  const sandbox = {
    module: { exports: {} }, URL, console: { warn: jest.fn() },
    process: { env: { CI: 'true', E2E_ACCESS_CODE: code } },
    require: () => ({ defineConfig: value => value, devices: {} }),
  };
  vm.runInNewContext(fs.readFileSync(path.resolve('playwright.config.js'), 'utf8'), sandbox);
  const config = sandbox.module.exports;
  expect(config.use.trace).toBe('off');
  for (const project of config.projects) expect(project.use.trace).toBeUndefined();
  if (present) {
    expect(config.use.storageState.origins[0].localStorage[0].value).toBe(code);
  } else {
    expect(config.use.storageState).toBeUndefined();
    expect(sandbox.console.warn).toHaveBeenCalledTimes(1);
  }
  expect(config.use.screenshot).toBe('only-on-failure');
  expect(config.use.video).toBe('retain-on-failure');
});
