// Agent G red-team harness for finding D-01. Read-only w.r.t. the repo source:
// it only IMPORTS frontend/src modules and asserts on their observable state.
module.exports = {
  rootDir: 'C:/Users/dprit/Raw-Surf',
  roots: ['C:/Users/dprit/Raw-Surf/audit/weather-simulation-11.0'],
  testEnvironment: 'node',
  testMatch: ['**/D01-*.test.js'],
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
