// Lane 5 read-only harness. Imports frontend/src modules; asserts on observable return values only.
module.exports = {
  rootDir: 'C:/Users/dprit/Raw-Surf',
  roots: ['C:/Users/dprit/Raw-Surf/audit/weather-simulation-11.0/evidence/console'],
  testEnvironment: 'jsdom',
  testMatch: ['**/V5-*.test.js'],
  transform: {
    '^.+\\.jsx?$': ['babel-jest', {
      configFile: false,
      babelrc: false,
      presets: [
        ['C:/Users/dprit/Raw-Surf/frontend/node_modules/@babel/preset-env', { targets: { node: 'current' } }],
      ],
    }],
  },
  transformIgnorePatterns: ['/node_modules/'],
};
