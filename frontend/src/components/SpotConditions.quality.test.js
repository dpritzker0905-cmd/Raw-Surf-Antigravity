/**
 * SURF QUALITY ON THE SPOT HUB (audit 15.0, 2026-09-26) — bound to the shipped component.
 *
 * The backend computed a rating for `/conditions/{spot_id}` on every request and the route's
 * whitelist dropped it, so the hub showed a size and never a quality. This mounts the REAL
 * <SpotConditions> (mocked API client, the confidence suite's harness) in all three themes and
 * both layouts, and checks the quality is a WORD with a full aria sentence, never colour alone.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import SpotConditions from './SpotConditions';
import { qualityLabel } from './SpotQualityBadge';

let mockTheme = 'dark';

jest.mock('../lib/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import apiClient from '../lib/apiClient';

function mockApi(extra) {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/conditions/') && !url.startsWith('/conditions/forecast/')) {
      return Promise.resolve({
        data: { current: { wave_height_ft: 4.2, wave_period: 12, swell_height_ft: 3.1, ...extra } },
      });
    }
    return Promise.resolve({ data: {} });
  });
}

beforeEach(() => {
  mockTheme = 'dark';
  jest.clearAllMocks();
});

const GOOD = { rating: 72.4, rating_level: 'good', surf_regime: 'shelf' };

it.each(['light', 'dark', 'beach'])('full layout names the quality in words in %s', async (theme) => {
  mockTheme = theme;
  mockApi(GOOD);
  render(<SpotConditions spotId="spot-1" spotName="Peniche" />);
  const note = await screen.findByTestId('spot-quality');
  expect(note).toHaveAttribute('role', 'note');
  expect(note).toHaveAttribute('aria-label', 'Surf quality: Good, 72 out of 100');
  expect(screen.getByTestId('spot-quality-level')).toHaveTextContent('Good');
  expect(note).toHaveTextContent('72/100');
});

it.each(['light', 'dark', 'beach'])('compact layout carries it too in %s', async (theme) => {
  mockTheme = theme;
  mockApi({ rating: 20, rating_level: 'poor' });
  render(<SpotConditions spotId="spot-1" spotName="Peniche" compact />);
  const note = await screen.findByTestId('spot-quality-compact');
  expect(note).toHaveAttribute('aria-label', 'Surf quality: Poor, 20 out of 100');
  expect(note).toHaveTextContent('Poor');
});

it('renders nothing when the rating did not run: unknown is not bad', async () => {
  mockApi({});
  render(<SpotConditions spotId="spot-1" spotName="Peniche" />);
  await screen.findByText('Wave Height');
  expect(screen.queryByTestId('spot-quality')).toBeNull();
});

it('names the offshore stand-in when the breaking transform failed open', async () => {
  mockApi({ surf_regime: 'offshore_estimate' });
  render(<SpotConditions spotId="spot-1" spotName="Peniche" />);
  expect(await screen.findByText('Offshore height (surf estimate unavailable)')).toBeInTheDocument();
  expect(screen.queryByText('Wave Height')).toBeNull();
});

it('qualityLabel refuses unknown levels and non-numeric scores', () => {
  expect(qualityLabel({ rating_level: 'unknown', rating: 50 })).toBeNull();
  expect(qualityLabel({ rating_level: 'good', rating: null })).toBeNull();
  expect(qualityLabel({ rating_level: 'good', rating: NaN })).toBeNull();
  expect(qualityLabel(null)).toBeNull();
  expect(qualityLabel({ rating_level: 'fair_good', rating: 63.6 })).toBe('Surf quality: Fair to Good, 64 out of 100');
});
