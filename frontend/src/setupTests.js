// Jest and React Testing Library setup
// This file is auto-loaded by CRA/craco before each test suite.

import '@testing-library/jest-dom';

// Silence React 18 act() deprecation warnings since the project still uses CRA
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('act(')) return;
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});
