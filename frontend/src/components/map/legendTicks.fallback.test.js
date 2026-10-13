import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { LegendTicks } from './legendTicks';

const ticks = [{ label: '0', pct: 0 }, { label: '20+', pct: 100 }];
const storageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');

afterEach(() => {
  ['__MARINE_ENGINE__', '__MARINE_PROJECTION_DIAG__', '__WEBGL_GUARDRAIL_FALLBACK__', '__SURF_MODE__'].forEach(k => delete window[k]);
  Object.defineProperty(window, 'localStorage', storageDescriptor);
  jest.useRealTimers();
});

test.each(['text-white/60', 'text-slate-600', 'text-amber-900'])('fallback does not label a retained native grid as the raster resolution (%s)', className => {
  window.__WEBGL_GUARDRAIL_FALLBACK__ = { webglMarineFailed: true };
  window.__MARINE_PROJECTION_DIAG__ = { resolution: 2, resolutionSource: 'backend' };
  window.__MARINE_ENGINE__ = { _waveData: { waveGrid: { bounds: { west: -180, south: -80, east: 180, north: 85 }, cols: 46, rows: 20 } } };
  render(<LegendTicks ticks={ticks} showResolution className={className} />);
  expect(screen.queryByText(/km grid/)).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent(/simplified wave layer/i);
  expect(screen.getByRole('status').className).toContain(className);
});

test('fallback entry suppresses the native label and recovery reads the current drawn grid', () => {
  jest.useFakeTimers();
  window.__MARINE_PROJECTION_DIAG__ = { resolution: 2, resolutionSource: 'backend' };
  window.__MARINE_ENGINE__ = { _waveData: { waveGrid: { bounds: { west: -180, south: -80, east: 180, north: 85 }, cols: 181, rows: 82 } } };
  render(<LegendTicks ticks={ticks} showResolution />);
  expect(screen.getByText(/km grid/)).toBeInTheDocument();
  act(() => { window.dispatchEvent(new CustomEvent('rawsurf:marine-fallback', { detail: { marineFailed: true } })); });
  expect(screen.queryByText(/km grid/)).toBeNull();
  window.__MARINE_ENGINE__._waveData.waveGrid = { bounds: { west: -82, south: 26, east: -78, north: 30 }, cols: 17, rows: 17 };
  act(() => { window.dispatchEvent(new CustomEvent('rawsurf:marine-fallback', { detail: { marineFailed: false } })); });
  expect(screen.queryByText(/km grid/)).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
});

test.each(['getter', 'getItem'])('blocked storage %s leaves the legend usable', failure => {
  delete window.__SURF_MODE__;
  const blocked = () => { throw new DOMException('blocked', 'SecurityError'); };
  Object.defineProperty(window, 'localStorage', { configurable: true, get: failure === 'getter' ? blocked : () => ({ getItem: blocked }) });
  expect(() => render(<LegendTicks ticks={ticks} showResolution />)).not.toThrow();
  expect(screen.getByText('20+')).toBeInTheDocument();
});
