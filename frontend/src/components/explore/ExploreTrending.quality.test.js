/**
 * Explore "Popular Spots" shows quality beside size (audit 15.0, 2026-09-26).
 *
 * `/conditions/batch` now carries `rating` + `rating_level` (absent unless rated). This mounts the
 * REAL ExploreTrending, which is the one live consumer of the batch (SpotConditionCard is only used by
 * _deprecated/, and ExploreSpotCard reads `current_conditions`, which the listing always sends as
 * null), and checks the quality renders as a word with a full aria sentence, and not at all when the
 * spot is unrated.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import ExploreTrending from './ExploreTrending';

// The repo's pattern (SpotHub.confidence.test.js): react-router-dom v7 is ESM, so it is mocked by name.
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });

const spot = (id, name) => ({ id, name, thumbnail: null, image_url: null });

function renderTrending(spotConditions) {
  return render(
    <ExploreTrending
        trending={{ popular_spots: [spot('a', 'Peniche'), spot('b', 'Ericeira')], trending_posts: [], live_photographers: [] }}
        spotConditions={spotConditions}
        user={null}
    />,
  );
}

it('shows the quality word beside the size for a rated spot', () => {
  renderTrending({
    a: { wave_height_ft: 4.3, rating: 72.4, rating_level: 'good' },
    b: { wave_height_ft: 2.1 },
  });
  const notes = screen.getAllByTestId('spot-quality-compact');
  expect(notes).toHaveLength(1);                         // b is unrated: no invented quality
  expect(notes[0]).toHaveAttribute('aria-label', 'Surf quality: Good, 72 out of 100');
  expect(notes[0]).toHaveTextContent('Good');
  expect(screen.getByText('4.3ft')).toBeInTheDocument();
  expect(screen.getByText('2.1ft')).toBeInTheDocument();
});

it('renders sizes alone when the batch carries no quality (frozen-client shape)', () => {
  renderTrending({ a: { wave_height_ft: 4.3 }, b: { wave_height_ft: 2.1 } });
  expect(screen.queryByTestId('spot-quality-compact')).toBeNull();
});
