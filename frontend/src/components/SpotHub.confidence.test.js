/**
 * FORECAST CONFIDENCE ON THE SPOT HUB — the surface that had the data and no consumer.
 *
 * ⛔⛔ WHY THIS FILE EXISTS. `/explore/spot-details` has served
 * `current_conditions.forecast_confidence` since the ensemble shipped, and this screen dropped it.
 * Measured live 2026-08-07 at ANCÃO (5db54ca6…): the payload carried
 * `{level: 'high', relative_spread: 0.092}` while the rendered hub contained no occurrence of the
 * word "confidence". Three separate handoffs named "load a EURO spot hub in a browser and look" as
 * the way to verify the ensemble had reached users — a check that could only ever have failed here,
 * for a reason that had nothing to do with the sampler those documents were investigating.
 *
 * ★ A CAPABILITY REACHES A SCREEN ONLY WHERE SOMETHING RENDERS IT. A field arriving in a payload is
 * not reach. `forecast_confidence` appeared in exactly ONE frontend file (`SpotConditions.js`),
 * which only the map's spot drawer mounts.
 *
 * These tests mount the REAL `<SpotHub>` behind a mocked API client — the lesson from the sibling
 * suite, which spent months asserting against a private copy of its subject.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { getThemeTokens } from '../utils/themeTokens';
import { confidenceDot, confidenceLabel } from './SpotConditions';

let mockTheme = 'dark';

// `virtual: true` because react-router-dom v7 is ESM and jest's CJS resolver cannot load it; the
// mock is registered by name without ever resolving the real package.
jest.mock('react-router-dom', () => ({
  useParams: () => ({ spotId: 'spot-1' }),
  useNavigate: () => jest.fn(),
  useLocation: () => ({ pathname: '/spot-hub/spot-1', search: '', state: null }),
  useSearchParams: () => [new URLSearchParams('model=EURO'), jest.fn()],
}), { virtual: true });
jest.mock('../lib/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', subscription_tier: 'premium' } }),
}));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
// Child surfaces are not the subject; stub them so an unrelated failure cannot masquerade as one
// of ours (and so this stays fast).
jest.mock('./spot-hub/SpotHubConditionsTab', () => () => null);
jest.mock('./spot-hub/SpotHubIntelTab', () => () => null);
jest.mock('./spot-hub/SpotHubMediaTab', () => () => null);
jest.mock('./spot-hub/SpotHubPhotographers', () => () => null);
jest.mock('./spot-hub/SpotHubLivePulse', () => () => null);
jest.mock('./spot-hub/BookingTypeModal', () => () => null);
jest.mock('./spot-hub/PhotographerRequestModal', () => () => null);
jest.mock('./ScheduledBookingDrawer', () => ({ ScheduledBookingDrawer: () => null }));

import apiClient from '../lib/apiClient';
import SpotHub from './SpotHub';

// The real shape, copied from the live production payload rather than invented.
const FC = {
  level: 'high',
  spread_m: 0.044,
  relative_spread: 0.092,
  basis: 'ecmwf_waef_member_spread',
  calibrated: false,
};

function mockApi(forecastConfidence) {
  apiClient.get.mockImplementation((url) => {
    if (url.includes('/explore/spot-details/')) {
      return Promise.resolve({
        data: {
          id: 'spot-1',
          name: 'ANCAO',
          region: 'Algarve',
          latitude: 37.032,
          longitude: -8.039,
          current_conditions: {
            label: 'Knee High',
            wave_height_ft: 2.1,
            wave_period: 4.41,
            wave_direction: 286,
            swell_height_ft: 0.7,
            ...(forecastConfidence ? { forecast_confidence: forecastConfidence } : {}),
          },
        },
      });
    }
    return Promise.resolve({ data: {} });
  });
}

// jsdom implements neither observer; SpotHub uses IntersectionObserver for its hero header and
// ResizeObserver for the map. Neither is the subject here — stub them so the component can mount.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeAll(() => {
  global.IntersectionObserver = global.IntersectionObserver || NoopObserver;
  global.ResizeObserver = global.ResizeObserver || NoopObserver;
});

beforeEach(() => {
  mockTheme = 'dark';
  jest.clearAllMocks();
});

it('renders the level word, the sentence, and hides the dot from assistive tech', async () => {
  mockApi(FC);
  render(<SpotHub />);
  const node = await screen.findByTestId('spothub-forecast-confidence');
  expect(node).toHaveAttribute('aria-label', confidenceLabel(FC));
  expect(within(node).getByTestId('spothub-forecast-confidence-level')).toHaveTextContent('High');
  expect(node.querySelector('[aria-hidden="true"]')).toBeTruthy();
  // `calibrated: false` is stated, not hidden — legibility, not validated skill.
  expect(node).toHaveTextContent('uncalibrated');
});

it('ABSENT means no ensemble — the block does not render, and never says "Low"', async () => {
  mockApi(null);
  render(<SpotHub />);
  // ⭐ THE ANCHOR IS THE CONTROL. "Today's Conditions" is the card that CONTAINS the block, so its
  // presence proves the block would have rendered had the payload carried one. Without this, the
  // assertion below would also pass on a component that failed to render at all.
  await screen.findByText(/Today's Conditions/);
  expect(screen.queryByTestId('spothub-forecast-confidence')).toBeNull();
  expect(screen.queryByText('Low')).toBeNull();
});

it('...and the SAME anchor shows the block WITH an ensemble — the paired positive', async () => {
  mockApi(FC);
  render(<SpotHub />);
  await screen.findByText(/Today's Conditions/);
  expect(screen.queryByTestId('spothub-forecast-confidence')).not.toBeNull();
});

it('THREE THEMES: light, dark and beach render three DISTINCT dot classes', async () => {
  const seen = [];
  for (const theme of ['light', 'dark', 'beach']) {
    mockTheme = theme;
    mockApi(FC);
    const { unmount } = render(<SpotHub />);
    const node = await screen.findByTestId('spothub-forecast-confidence');
    const cls = node.querySelector('[aria-hidden="true"]').className;
    const t = getThemeTokens(theme);
    // Agrees with the shared helper — this surface must not invent its own vocabulary.
    expect(cls).toContain(confidenceDot(FC.level, t.isLight, t.isBeach));
    seen.push(cls);
    unmount();
  }
  // ⚠️ SpotHub read only `isLight` before this block landed. Had `isBeach` not been added, beach
  // would have silently rendered as dark and this is the assertion that would have caught it.
  expect(new Set(seen).size).toBe(3);
});
