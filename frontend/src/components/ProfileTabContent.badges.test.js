import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProfileTabContent from './ProfileTabContent';

jest.mock('./StokedTab', () => ({ StokedTab: () => null }));
jest.mock('./CrewLeaderboard', () => ({ CrewLeaderboard: () => null }));
jest.mock('./SurfboardsTab', () => ({ SurfboardsTab: () => null }));
jest.mock('./ProfileReviewsSection', () => ({ ProfileReviewsSection: () => null }));
jest.mock('./MediaGridItem', () => ({ MediaGridItem: () => null }));

afterEach(cleanup);
const mount = (view, theme, badges, total_xp = 0) => render(<ProfileTabContent activeTab={view}
  impactScore={{ is_photographer: true }} gamificationStats={{ total_xp, badges }}
  profileUserId="synthetic-profile" isOwnProfile={false} theme={theme} />);
const views = ['stats', 'crew'].flatMap(view => ['light', 'dark', 'beach'].map(theme => [view, theme]));
const definitions = [
  ['the_patron', 'The Patron', 'Supports the surf community', 'heart'],
  ['the_workhorse', 'The Workhorse', 'Consistent session shooter', 'camera'],
  ['the_sharpshooter', 'The Sharpshooter', 'High gallery conversion rate', 'trending-up'],
  ['the_benefactor', 'The Benefactor', 'Major community contributor', 'sparkles'],
];
test.each(views)('%s in %s resolves the actual response shape to existing badge labels and icons', (view, theme) => {
  const badges = definitions.map(([badge_type], index) => ({ id: `synthetic-${index}`, badge_type, tier: 'bronze', xp_earned: 25 }));
  mount(view, theme, badges);
  for (const [,label,description,icon] of definitions) {
    const tile = screen.getByTitle(description);
    expect(tile).toHaveTextContent(label);
    expect(tile.querySelector(`svg.lucide-${icon}`)).toBeInTheDocument();
  }
  expect(screen.getByText('4 earned')).toBeInTheDocument();
});
test.each(views)('%s in %s preserves explicit presentation fields', (view, theme) => {
  mount(view, theme, [{ id: 'synthetic-override', badge_type: 'the_patron', name: 'Custom earned badge',
    description: 'Custom description', icon_emoji: 'TEST-ICON' }]);
  const tile = screen.getByTitle('Custom description');
  expect(tile).toHaveTextContent('Custom earned badge'); expect(tile).toHaveTextContent('TEST-ICON');
  expect(screen.queryByText('The Patron')).not.toBeInTheDocument();
});
test.each(views)('%s in %s resolves null or empty display fields without inventing badge awards', (view, theme) => {
  mount(view, theme, [{ id: 'synthetic-null', badge_type: 'the_patron', name: null, description: '', icon_emoji: null }]);
  expect(screen.getByTitle('Supports the surf community')).toHaveTextContent('The Patron');
  expect(screen.getByText('1 earned')).toBeInTheDocument();
  expect(screen.queryByText('The Workhorse')).not.toBeInTheDocument();
});
test.each(views)('%s in %s keeps an unknown badge generic', (view, theme) => {
  mount(view, theme, [{ id: 'synthetic-unknown', badge_type: 'synthetic-future-type' }]);
  const label = screen.getByText('Badge');
  expect(label.parentElement.querySelector('svg.lucide-award')).toBeInTheDocument();
  expect(screen.queryByText('The Patron')).not.toBeInTheDocument();
  expect(screen.queryByText('synthetic-future-type')).not.toBeInTheDocument();
});
test.each(views)('%s in %s does not fabricate badges from an empty list', (view, theme) => {
  mount(view, theme, []);
  expect(screen.queryByText('Badges')).not.toBeInTheDocument();
  expect(screen.queryByText('The Patron')).not.toBeInTheDocument();
});
test.each([null, undefined])('crew XP remains visible without badges: %p', badges => {
  mount('crew', 'dark', badges, 25);
  expect(screen.getByText('25 XP')).toBeInTheDocument();
  expect(screen.getByText('0 earned')).toBeInTheDocument();
  expect(screen.queryByText('The Patron')).not.toBeInTheDocument();
});
