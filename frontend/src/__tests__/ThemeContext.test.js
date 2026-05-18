/**
 * ThemeContext.test.js Tests for theme auto-detection and switching.
 */
import React from 'react';
import { renderHook, act } from '@testing-library/react-hooks';
import { ThemeProvider, useTheme } from '../contexts/ThemeContext';

beforeEach(() => {
  localStorage.clear();
});

const wrapper = ({ children }) => <ThemeProvider>{children}</ThemeProvider>;

test('defaults to light when no preference saved and no system preference', () => {
  // Mock matchMedia to return light
  window.matchMedia = jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    addEventListener: jest.fn(),
  }));

  const { result } = renderHook(() => useTheme(), { wrapper });
  expect(result.current.theme).toBe('light');
});

test('uses saved preference from localStorage', () => {
  localStorage.setItem('raw-surf-theme', 'dark');
  const { result } = renderHook(() => useTheme(), { wrapper });
  expect(result.current.theme).toBe('dark');
});

test('auto-detects dark mode from system preference', () => {
  window.matchMedia = jest.fn().mockImplementation(query => ({
    matches: query === '(prefers-color-scheme: dark)',
    media: query,
    addEventListener: jest.fn(),
  }));

  const { result } = renderHook(() => useTheme(), { wrapper });
  expect(result.current.theme).toBe('dark');
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
