import React from 'react';
import { render, screen } from '@testing-library/react';

// The chip's WIND branch and its precedence (gate 2): the readers are mocked here; their own logic is tested in staleLayerState.test.js.
const mockRated = jest.fn(() => null);
const mockWind = jest.fn(() => null);
jest.mock('./staleLayerState', () => ({ readRatedRunState: () => mockRated(), readWindStaleState: (sel) => mockWind(sel) }));
// eslint-disable-next-line import/first
import StaleLayerChip, { readStaleChip } from './StaleLayerChip';

const NEAREST = { state: 'nearest', short: 'Wind: nearest stored time', text: 'Showing Mon 4 AM: the nearest stored forecast' };
afterEach(() => { mockRated.mockReset(); mockRated.mockReturnValue(null); mockWind.mockReset(); mockWind.mockReturnValue(null); });

test('wind on and showing its nearest stored forecast: the wind chip, named with the wind line', () => {
  mockWind.mockReturnValue(NEAREST);
  render(<StaleLayerChip stale={{ model: 'GFS', layer: 'waves', hour: 4, windOn: true }} onOpen={() => {}} />);
  const chip = screen.getByRole('button', { name: NEAREST.text });
  expect(chip).toHaveTextContent('Wind: nearest stored time');
  expect(chip).toHaveAttribute('data-stale-chip', 'wind');
  expect(mockWind).toHaveBeenCalledWith({ model: 'GFS', hour: 4 });
});

test('wind off, or wind exact (the reader says nothing): no chip', () => {
  mockWind.mockReturnValue(NEAREST);
  expect(readStaleChip({ model: 'GFS', hour: 4, windOn: false })).toBe(null);
  mockWind.mockReturnValue(null);
  expect(readStaleChip({ model: 'GFS', hour: 4, windOn: true })).toBe(null);
});

test('both lag: the rating band speaks first (one chip, never two)', () => {
  mockRated.mockReturnValue({ short: 'Ratings 6 h old', text: 'Surf ratings from the Monday 1 AM run, 6 h older than the wave heights.' });
  mockWind.mockReturnValue(NEAREST);
  expect(readStaleChip({ model: 'GFS', hour: 4, windOn: true })).toEqual({ kind: 'ratings', short: 'Ratings 6 h old',
    text: 'Surf ratings from the Monday 1 AM run, 6 h older than the wave heights.' });
});
