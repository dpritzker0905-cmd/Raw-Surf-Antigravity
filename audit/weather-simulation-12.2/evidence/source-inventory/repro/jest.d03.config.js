// AUDIT 12.2 read-only harness: re-runs the 11.0 D-03 repro against HEAD.
// Mutates no production source. rootDir is the repo root so the audit repro dir is reachable.
module.exports = {
  rootDir: 'C:/Users/dprit/Raw-Surf',
  testEnvironment: 'jsdom',
  testMatch: ['**/audit/weather-simulation-11.0/repro/d03-scrub-flag-leak.test.js'],
  transform: {
    '^.+\.(js|jsx)$': ['babel-jest', { presets: ['C:/Users/dprit/Raw-Surf/frontend/node_modules/babel-preset-react-app'] }],
  },
  transformIgnorePatterns: ['/node_modules/'],
};
