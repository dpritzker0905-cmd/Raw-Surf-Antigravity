const path = require('path');
const { createRequire } = require('module');
const deps = process.env.RAW_SUPPORT_TEST_DEPS;
if (!deps) throw new Error('Set RAW_SUPPORT_TEST_DEPS to an existing frontend node_modules directory');
const runtime = createRequire(path.join(deps, '..', 'package.json'));
const root = path.resolve(__dirname, '../../../../frontend');
const config = {
  rootDir: root,
  testEnvironment: runtime.resolve('jest-environment-jsdom'),
  testMatch: ['<rootDir>/src/components/GromManage.recovery.test.js',
    '<rootDir>/src/components/GromManage.labels.test.js',
    '<rootDir>/src/components/GromHQ.competition.test.js',
    '<rootDir>/src/components/GromHQ.activity.test.js',
    '<rootDir>/src/components/GromHQ.recovery.test.js',
    '<rootDir>/src/components/grom/PurchaseRequestsPanel.recovery.test.js',
    '<rootDir>/src/components/grom/PurchaseRequestsPanel.actions.test.js',
    '<rootDir>/src/components/grom/AskMyParentPanel.recovery.test.js',
    '<rootDir>/src/components/GromLimitedFeed.recovery.test.js',
    '<rootDir>/src/components/grom/guardianPanels.test.js'],
  moduleDirectories: ['node_modules', deps],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  setupFilesAfterEnv: [runtime.resolve('@testing-library/jest-dom')],
  cacheDirectory: path.join(process.env.RAW_GUARDIAN_TEST_OUTPUT || __dirname, '.jest-cache'),
  transform: { '^.+\\.[jt]sx?$': [runtime.resolve('babel-jest'), {
    presets: [[runtime.resolve('@babel/preset-env'), { targets: { node: 'current' } }],
      [runtime.resolve('@babel/preset-react'), { runtime: 'automatic' }]],
  }] },
};
runtime('jest').run(['--config', JSON.stringify(config), '--runInBand', ...process.argv.slice(2)]);
