/**
 * ThemeContext.test.js Tests for theme auto-detection and switching.
 */
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../contexts/ThemeContext';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const html = fs.readFileSync(path.resolve(__dirname, '../../public/index.html'), 'utf8');
const bootstrap = html.match(/<script id="theme-bootstrap">([\s\S]*?)<\/script>/)[1];

beforeEach(() => {
  jest.restoreAllMocks();
  localStorage.clear();
  document.documentElement.className = 'no-god-mode';
  document.head.innerHTML = '<meta id="theme-color-meta"><meta name="apple-mobile-web-app-status-bar-style">';
});
afterEach(() => jest.restoreAllMocks());

const wrapper = ({ children }) => <ThemeProvider>{children}</ThemeProvider>;

test('defaults to dark even when device preference is light', () => {
  // Mock matchMedia to return light
  window.matchMedia = jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    addEventListener: jest.fn(),
  }));

  const { result } = renderHook(() => useTheme(), { wrapper });
  expect(result.current.theme).toBe('dark');
});

test('uses saved preference from localStorage', () => {
  localStorage.setItem('raw-surf-theme', 'dark');
  const { result } = renderHook(() => useTheme(), { wrapper });
  expect(result.current.theme).toBe('dark');
});

test('defaults to dark when device preference is dark', () => {
  window.matchMedia = jest.fn().mockImplementation(query => ({
    matches: query === '(prefers-color-scheme: dark)',
    media: query,
    addEventListener: jest.fn(),
  }));

  const { result } = renderHook(() => useTheme(), { wrapper });
  expect(result.current.theme).toBe('dark');
});

test.each([
  [null, 'dark'], ['', 'dark'], ['light', 'light'], ['dark', 'dark'], ['beach', 'beach'],
  ['unknown', 'dark'], ['dark light', 'dark'], ['__proto__', 'dark'],
])('bootstrap and React agree for saved %p -> %s', (saved, expected) => {
  if (saved !== null) localStorage.setItem('raw-surf-theme', saved);
  vm.runInNewContext(bootstrap, { document, localStorage });
  const expectedClass = expected === 'beach' ? 'beach-mode' : expected;
  expect(document.documentElement.classList.contains(expectedClass)).toBe(true);
  expect(document.documentElement.classList.contains('no-god-mode')).toBe(true);
  const before = document.documentElement.className;
  const { result } = renderHook(() => useTheme(), { wrapper });
  expect(result.current.theme).toBe(expected);
  expect(document.documentElement.className).toBe(before);
  expect(document.documentElement.style.colorScheme).toBe(expected === 'light' ? 'light' : 'dark');
  expect(localStorage.getItem('raw-surf-theme')).toBe(expected);
});

test('blocked storage still permits render and in-session theme changes', () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  expect(() => vm.runInNewContext(bootstrap, { document, localStorage })).not.toThrow();
  const { result } = renderHook(() => useTheme(), { wrapper });
  expect(result.current.theme).toBe('dark');
  act(() => result.current.toggleTheme('light'));
  expect(result.current.theme).toBe('light');
  expect(document.documentElement.classList.contains('light')).toBe(true);
});

test('invalid selection cannot corrupt a valid saved beach theme', () => {
  localStorage.setItem('raw-surf-theme', 'beach');
  const { result } = renderHook(() => useTheme(), { wrapper });
  act(() => result.current.toggleTheme('invalid theme'));
  expect(result.current.theme).toBe('beach');
  expect(localStorage.getItem('raw-surf-theme')).toBe('beach');
  expect(document.documentElement.className).toBe('no-god-mode beach-mode');
  expect(document.getElementById('theme-color-meta').content).toBe('#000000');
});

test('toggleTheme switches theme', () => {
  localStorage.setItem('raw-surf-theme', 'light');
  const { result } = renderHook(() => useTheme(), { wrapper });
  
  act(() => {
    result.current.toggleTheme('dark');
  });
  
  expect(result.current.theme).toBe('dark');
  expect(localStorage.getItem('raw-surf-theme')).toBe('dark');
});
