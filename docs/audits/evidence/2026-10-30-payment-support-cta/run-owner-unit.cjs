const path = require('path');
const { createRequire } = require('module');
const runtime = createRequire(path.join(process.env.RAW_SUPPORT_TEST_DEPS, '../package.json'));
const ownFrontend = path.resolve(__dirname, '../../../../frontend');
const target = process.env.RAW_SUPPORT_HANDOFF_ROOT;
const mappings = target ? {
  '^\\.\\./BookingPaymentSuccess$': path.join(target, 'frontend/src/components/BookingPaymentSuccess.js'),
  '^\\.\\./DispatchPaymentSuccess$': path.join(target, 'frontend/src/components/DispatchPaymentSuccess.js'),
  'contexts/AuthContext$': path.join(ownFrontend, 'src/contexts/AuthContext.js'),
  'lib/apiClient$': path.join(ownFrontend, 'src/lib/apiClient.js'),
  'utils/logger$': path.join(ownFrontend, 'src/utils/logger.js'),
  'RequestProSelfieModal$': path.join(ownFrontend, 'src/components/RequestProSelfieModal.js'),
} : {};
runtime('jest').run(['--config', JSON.stringify({ rootDir: path.resolve(__dirname, '../../../../frontend'),
  moduleNameMapper: mappings,
  testEnvironment: runtime.resolve('jest-environment-jsdom'), testMatch: [
    '<rootDir>/src/components/support/PaymentSupportHandoff.test.js', '<rootDir>/src/__tests__/supportSessionReturn.test.js',
    '<rootDir>/src/__tests__/authRedirectLoop.test.js', '<rootDir>/src/components/support/SupportInbox.test.js',
    '<rootDir>/src/components/support/SupportInbox.uppercase.test.js', '<rootDir>/src/components/support/SupportAuth.test.js'],
  moduleDirectories: ['node_modules', process.env.RAW_SUPPORT_TEST_DEPS], cacheDirectory: path.join(__dirname, '.run/jest'),
  transform: { '^.+\\.[jt]sx?$': [runtime.resolve('babel-jest'), { presets: [
    [runtime.resolve('@babel/preset-env'), { targets: { node: 'current' } }],
    [runtime.resolve('@babel/preset-react'), { runtime: 'automatic' }],
  ] }] },
}), '--runInBand', ...process.argv.slice(2)]);
