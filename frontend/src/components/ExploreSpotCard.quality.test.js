/**
 * The Explore spot card shows quality beside size (audit 15.0, 2026-09-26).
 *
 * `/explore/surf-spots` fills each spot's `current_conditions` from the hub producer, which carries
 * `rating` + `rating_level` since #96 (checked live: 13th Beach 6.9 ft "Overhead", rated 27.4 poor).
 * The card rendered only the size and a SIZE label, so a blown-out overhead day and a groomed one
 * looked identical. This mounts the REAL card and checks the quality renders as a word with a full
 * aria sentence in both places the size does, and not at all when the spot is unrated.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import ExploreSpotCard from './ExploreSpotCard';

// The repo's pattern (SpotHub.confidence.test.js): react-router-dom v7 is ESM, so it is mocked by name.
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });
let mockTheme = 'dark';
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
afterEach(() => { mockTheme = 'dark'; });

const spot = (current_conditions) => ({
  id: 'thirteenth', name: '13th Beach', region: 'Victoria', latitude: -38.28, longitude: 144.47,
  current_conditions, forecast: [], recent_reports: [], active_photographers: [], gallery: [],
});

it('shows the quality word beside the size for a rated spot', () => {
  render(<ExploreSpotCard spot={spot({
    wave_height_ft: 6.9, label: 'Overhead', wave_period: 14.7, rating: 27.4, rating_level: 'poor',
  })} />);
  const notes = screen.getAllByTestId('spot-quality-compact');
  expect(notes).toHaveLength(2);                       // the header pill and the conditions bar
  for (const n of notes) {
    expect(n).toHaveAttribute('aria-label', 'Surf quality: Poor, 27 out of 100');
    expect(n).toHaveTextContent('Poor');
  }
  expect(screen.getAllByText('6.9ft')).toHaveLength(2);
  expect(screen.getByText('Overhead')).toBeInTheDocument();
});

it('renders the size alone when the spot is unrated (no invented quality)', () => {
  render(<ExploreSpotCard spot={spot({ wave_height_ft: 2.1, label: 'Knee High' })} />);
  expect(screen.queryByTestId('spot-quality-compact')).toBeNull();
  expect(screen.getAllByText('2.1ft')).toHaveLength(2);
});

// The card surface is bg-zinc-900/80 in every theme, so the forecast chips must stay light-on-dark in
// light, dark and beach: theme tokens (beach amber-900 text, light gray-500) vanish on that surface.
it.each(['light', 'dark', 'beach'])('forecast chips stay light-on-dark in the %s theme', (theme) => {
  mockTheme = theme;
  render(<ExploreSpotCard spot={{ ...spot({ wave_height_ft: 5, label: 'Head High' }), forecast: [
    { date: '2026-10-06', wave_height_max: 6, label: 'Overhead' },
  ] }} userSubscriptionTier="free" />);
  const height = screen.getByText('6ft');
  expect(height).toHaveClass('text-white');
  const chip = height.parentElement;
  expect(chip).toHaveClass('bg-zinc-800');
  expect(chip.firstChild).toHaveClass('text-gray-400');
  for (const cls of [...chip.classList, ...height.classList, ...chip.firstChild.classList]) {
    expect(cls).not.toMatch(/amber|bg-gray-100|text-gray-500|text-gray-900/);
  }
});

it('daily badge follows the supplied date even when the first row is not tomorrow', () => {
  process.env.REACT_APP_FORECAST_STATE_IDENTITY = 'true';
  const now = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-04T12:00:00Z'));
  try {
    render(<ExploreSpotCard spot={{ ...spot({ wave_height_ft: 5, label: 'Head High' }), forecast: [
      { date: '2026-10-06', wave_height_max: 6, label: 'Overhead' },
      { date: '2026-10-07', wave_height_max: 6, label: 'Overhead' },
    ] }} />);
    expect(screen.getByText('Tue')).toBeInTheDocument();
    expect(screen.getByText('Wed')).toBeInTheDocument();
    expect(screen.queryByText('Tom')).toBeNull();
  } finally { now.mockRestore(); delete process.env.REACT_APP_FORECAST_STATE_IDENTITY; }
});
