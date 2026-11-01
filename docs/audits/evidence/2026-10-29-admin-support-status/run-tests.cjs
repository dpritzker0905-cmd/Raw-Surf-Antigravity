const path = require('path');
const { createRequire } = require('module');

// Read existing dependencies; install nothing and write caches only to this workspace.
const deps = process.env.RAW_SUPPORT_TEST_DEPS;
if (!deps) throw new Error('Set RAW_SUPPORT_TEST_DEPS to an existing frontend node_modules directory');
const runtime = createRequire(path.join(deps, '..', 'package.json'));
const root = path.resolve(__dirname, '../../../../frontend');
const config = {
  rootDir: root,
  testEnvironment: runtime.resolve('jest-environment-jsdom'),
  testMatch: ['<rootDir>/src/components/admin/AdminSupportDashboard.test.js',
    '<rootDir>/src/components/admin/AdminSupportDashboard.pagination.test.js',
    '<rootDir>/src/components/admin/AdminSupportDashboard.metrics.test.js',
    '<rootDir>/src/components/admin/AdminSupportDashboard.samples.test.js',
    '<rootDir>/src/components/admin/AdminSupportDashboard.status.test.js'],
  moduleDirectories: ['node_modules', deps],
  cacheDirectory: path.join(__dirname, '.jest-cache'),
  transform: {
    '^.+\\.[jt]sx?$': [runtime.resolve('babel-jest'), {
      presets: [
        [runtime.resolve('@babel/preset-env'), { targets: { node: 'current' } }],
        [runtime.resolve('@babel/preset-react'), { runtime: 'automatic' }],
      ],
    }],
  },
};
runtime('jest').run(['--config', JSON.stringify(config), '--runInBand', ...process.argv.slice(2)]);
