const path = require('path');
const { createRequire } = require('module');
const deps = process.env.RAW_SUPPORT_TEST_DEPS;
const runtime = createRequire(path.join(deps, '../package.json'));
runtime('jest').run(['--config', JSON.stringify({ rootDir: path.resolve(__dirname, '../../../../frontend'),
  testEnvironment: runtime.resolve('jest-environment-jsdom'),
  testMatch: ['<rootDir>/src/__tests__/supportSessionReturn.test.js', '<rootDir>/src/__tests__/authRedirectLoop.test.js',
    '<rootDir>/src/components/support/SupportInbox.test.js', '<rootDir>/src/components/support/SupportInbox.uppercase.test.js',
    '<rootDir>/src/components/support/SupportAuth.test.js'],
  moduleDirectories: ['node_modules', deps], cacheDirectory: path.join(__dirname, '.run/jest'),
  transform: { '^.+\\.[jt]sx?$': [runtime.resolve('babel-jest'), { presets: [
    [runtime.resolve('@babel/preset-env'), { targets: { node: 'current' } }],
    [runtime.resolve('@babel/preset-react'), { runtime: 'automatic' }],
  ] }] },
}), '--runInBand', ...process.argv.slice(2)]);
