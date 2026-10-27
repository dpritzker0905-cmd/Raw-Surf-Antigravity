// Jest and React Testing Library setup
// This file is auto-loaded by CRA/craco before each test suite.

import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

if (typeof window !== 'undefined' && window.URL) {
  window.URL.createObjectURL = window.URL.createObjectURL || (() => 'blob:mock-url');
  window.URL.revokeObjectURL = window.URL.revokeObjectURL || (() => {});
}

// STATIC FRAMES are ON by default in the app (staticFrames.js, owner 2026-10-21). Suites that are not about them keep the
// /grid + /grid_series path they were written against (the kill switch restores it exactly); staticFrames.test.js clears it.
if (typeof window !== 'undefined') window.__RAW_DISABLE_STATIC_FRAMES__ = true;

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
