import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Explore } from './Explore';
import apiClient from '../lib/apiClient';

let mockParams = new URLSearchParams();
let mockNavigationKey = 'initial';
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [mockParams, jest.fn()],
  useLocation: () => ({ key: mockNavigationKey }),
}), { virtual: true });
jest.mock('../lib/apiClient', () => ({ get: jest.fn() }));
jest.mock('../utils/logger', () => ({ debug: jest.fn(), error: jest.fn() }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'light' }) }));
jest.mock('../hooks/useWebSocket', () => ({ useConditionsSync: () => ({}), useLiveStreamSync: () => ({}) }));
jest.mock('../hooks/useSwipeNavigation', () => () => ({ contentRef: null, swipeHandlers: {} }));
jest.mock('../hooks/useExploreConditions', () => () => ({}));
jest.mock('./explore/ExploreWavesTab', () => () => null);
jest.mock('./explore/HashtagsTab', () => () => null);
jest.mock('./explore/ExploreConditionsTab', () => () => null);
jest.mock('./explore/ExploreTrending', () => () => <div>Trending content</div>);
jest.mock('./explore/ExploreSponsorsTab', () => () => null);
jest.mock('./explore/ExplorePostsTab', () => () => null);
jest.mock('./explore/ExplorePeopleTab', () => () => null);
jest.mock('./explore/ExploreSurfSpotsTab', () => () => null);
jest.mock('./explore/ExploreSearchResults', () => ({ isSearching, searchResults, searchQuery }) => (
  <div data-testid="explore-results">
    {isSearching ? 'Searching' : searchResults.users.map(user => user.full_name).join(',') || `No results: ${searchQuery}`}
  </div>
));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const result = name => ({ data: { users: [{ id: name, full_name: name }], spots: [], posts: [] } });
const type = text => fireEvent.change(screen.getByTestId('explore-search-input'), { target: { value: text } });
const debounce = async () => { await act(async () => { jest.advanceTimersByTime(300); }); };
const finish = async (request, value) => { await act(async () => { request.resolve(value); }); };
const configure = search => apiClient.get.mockImplementation((url, config) => {
  if (url === '/explore/search') return search(config.params);
  if (url === '/explore/trending') return Promise.resolve({ data: { live_photographers: [], popular_spots: [], trending_posts: [] } });
  return Promise.resolve({ data: { hashtags: [] } });
});

beforeEach(() => {
  jest.useFakeTimers();
  mockParams = new URLSearchParams();
  mockNavigationKey = 'initial';
  localStorage.clear();
  apiClient.get.mockReset();
  configure(() => Promise.resolve(result('matching-result')));
  Element.prototype.scrollIntoView = jest.fn();
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

it('runs the decoded View All query from the URL on mount', async () => {
  mockParams = new URLSearchParams('q=reef%20%26%20sand');
  render(<Explore />);
  expect(screen.getByTestId('explore-search-input')).toHaveValue('reef & sand');
  await debounce();
  expect(apiClient.get).toHaveBeenCalledWith('/explore/search', expect.objectContaining({ params: { q: 'reef & sand', type: 'all' } }));
  expect(screen.getByTestId('explore-results')).toHaveTextContent('matching-result');
});

it('updates an already mounted page when URL search changes, and clears it on URL removal', async () => {
  mockParams = new URLSearchParams('q=reef');
  const view = render(<Explore />);
  await debounce();
  mockParams = new URLSearchParams('q=beach');
  view.rerender(<Explore />);
  expect(screen.getByTestId('explore-search-input')).toHaveValue('beach');
  await debounce();
  expect(apiClient.get).toHaveBeenCalledWith('/explore/search', expect.objectContaining({ params: { q: 'beach', type: 'all' } }));
  mockParams = new URLSearchParams();
  view.rerender(<Explore />);
  expect(screen.getByTestId('explore-search-input')).toHaveValue('');
});

it('invalidates old results before the next debounce and prevents stale recent history', async () => {
  const old = deferred();
  const current = deferred();
  configure(({ q }) => q === 'reef' ? old.promise : current.promise);
  render(<Explore />);
  type('reef');
  await debounce();
  type('beach');
  await finish(old, result('old-reef'));
  expect(screen.getByTestId('explore-results')).not.toHaveTextContent('old-reef');
  expect(localStorage.getItem('rs-recent-searches')).toBeNull();
  await debounce();
  await finish(current, result('current-beach'));
  expect(screen.getByTestId('explore-results')).toHaveTextContent('current-beach');
  expect(JSON.parse(localStorage.getItem('rs-recent-searches'))).toEqual(['beach']);
});

it('keeps the selected tab response when the earlier all-tab request finishes last', async () => {
  const old = deferred();
  const current = deferred();
  configure(({ type: tab }) => tab === 'all' ? old.promise : current.promise);
  render(<Explore />);
  type('reef');
  await debounce();
  fireEvent.click(screen.getByTestId('tab-users'));
  await debounce();
  await finish(current, result('people-result'));
  await finish(old, result('all-result'));
  expect(screen.getByTestId('explore-results')).toHaveTextContent('people-result');
  expect(screen.getByTestId('explore-results')).not.toHaveTextContent('all-result');
});

it('clear control empties the input and prevents a late request from populating history', async () => {
  const request = deferred();
  configure(() => request.promise);
  render(<Explore />);
  type('reef');
  await debounce();
  fireEvent.click(screen.getByRole('button', { name: /clear search|close/i }));
  expect(screen.getByTestId('explore-search-input')).toHaveValue('');
  await finish(request, result('late-result'));
  expect(screen.queryByTestId('explore-results')).not.toBeInTheDocument();
  expect(localStorage.getItem('rs-recent-searches')).toBeNull();
});

it('shortening a query invalidates its request and clears the busy state', async () => {
  const request = deferred();
  configure(() => request.promise);
  render(<Explore />);
  type('reef');
  await debounce();
  type('r');
  await finish(request, result('late-result'));
  expect(screen.queryByTestId('explore-results')).not.toBeInTheDocument();
  expect(localStorage.getItem('rs-recent-searches')).toBeNull();
});

it('does not retain prior results when a new search fails', async () => {
  configure(({ q }) => q === 'reef' ? Promise.resolve(result('old-reef')) : Promise.reject(new Error('search failed')));
  render(<Explore />);
  type('reef');
  await debounce();
  expect(screen.getByTestId('explore-results')).toHaveTextContent('old-reef');
  type('beach');
  await debounce();
  expect(screen.getByTestId('explore-results')).not.toHaveTextContent('old-reef');
});

it('does not write recent history after unmount', async () => {
  const request = deferred();
  configure(() => request.promise);
  const { unmount } = render(<Explore />);
  type('reef');
  await debounce();
  unmount();
  await finish(request, result('late-result'));
  expect(localStorage.getItem('rs-recent-searches')).toBeNull();
});

it('does not let the old request stop the new tab loading state', async () => {
  const old = deferred();
  const current = deferred();
  configure(({ type: tab }) => tab === 'all' ? old.promise : current.promise);
  render(<Explore />);
  type('reef');
  await debounce();
  fireEvent.click(screen.getByTestId('tab-users'));
  await debounce();
  await finish(old, result('old-all'));
  expect(screen.getByTestId('explore-results')).toHaveTextContent('Searching');
  await finish(current, result('current-people'));
  expect(screen.getByTestId('explore-results')).toHaveTextContent('current-people');
});

it('runs one current search in StrictMode and records recent queries without refetching', async () => {
  localStorage.setItem('rs-recent-searches', JSON.stringify(['old-place', 'reef']));
  mockParams = new URLSearchParams('q=reef');
  render(<React.StrictMode><Explore /></React.StrictMode>);
  await debounce();
  await debounce();
  expect(apiClient.get.mock.calls.filter(([url]) => url === '/explore/search')).toHaveLength(1);
  expect(JSON.parse(localStorage.getItem('rs-recent-searches'))).toEqual(['reef', 'old-place']);
  type('beach');
  await debounce();
  await debounce();
  expect(apiClient.get.mock.calls.filter(([url]) => url === '/explore/search')).toHaveLength(2);
  expect(JSON.parse(localStorage.getItem('rs-recent-searches'))).toEqual(['beach', 'reef', 'old-place']);
});

it('honors a new navigation to the same URL query after the local input was edited', async () => {
  mockParams = new URLSearchParams('q=reef');
  const view = render(<Explore />);
  await debounce();
  type('beach');
  await debounce();
  mockNavigationKey = 'new-navigation-to-reef';
  view.rerender(<Explore />);
  expect(screen.getByTestId('explore-search-input')).toHaveValue('reef');
  await debounce();
  const requests = apiClient.get.mock.calls.filter(([url]) => url === '/explore/search');
  expect(requests[requests.length - 1][1].params.q).toBe('reef');
});
