/**
 * THE STORIES BAR MUST NOT LOOP ON THE VIEWER'S LOCATION.
 *
 * The defect (live trace of dev, 2026-10-23): /feed sent 432 GET /api/stories/feed in about two minutes from one tab,
 * every one with the same viewer_lat/viewer_lon, to the one 1-CPU box that serves production and dev. The fetch effect
 * also asked for the location; each answer was a NEW object, which made a new `fetchStories`, which re-ran the effect,
 * which fetched and asked again. It only loops when location is allowed (a denied request never sets state).
 *
 * The contract: one fetch on mount, at most one more when the location first arrives (it decides which story
 * locations are shown), one location request per user, and one realtime channel per user.
 */
import { renderHook, act } from '@testing-library/react';

jest.mock('../lib/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));
jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: jest.fn() }));

const mockChannel = { on: jest.fn(), subscribe: jest.fn() };
jest.mock('../lib/supabase', () => ({
  supabase: { channel: jest.fn(), removeChannel: jest.fn() },
}));

import apiClient from '../lib/apiClient';
import { supabase } from '../lib/supabase';
import useStoriesActions from './useStoriesActions';

const USER = { id: 'u1' };
// act() flushes React's queued updates only when it returns, so a loop advances one round per act: settle in rounds.
const settle = async (rounds = 10) => {
  for (let i = 0; i < rounds; i += 1) await act(() => new Promise((r) => setTimeout(r, 30)));
};
const feedCalls = () => apiClient.get.mock.calls.filter(([url]) => url.startsWith('/stories/feed'));

let getCurrentPosition;
beforeEach(() => {
  jest.clearAllMocks();
  // CRA's Jest config resets mock implementations before every test, so they are set here.
  mockChannel.on.mockReturnValue(mockChannel);
  mockChannel.subscribe.mockReturnValue(mockChannel);
  supabase.channel.mockReturnValue(mockChannel);
  apiClient.get.mockResolvedValue({ data: { photographer_stories: [], surfer_stories: [], all: [] } });
  // A granted browser answers every request with the SAME position, a few ms later.
  getCurrentPosition = jest.fn((ok) => setTimeout(() => ok({ coords: { latitude: 28.378, longitude: -80.6076 } }), 5));
  Object.defineProperty(global.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } });
});

it('fetches once on mount and once when the location arrives, then stops (location allowed)', async () => {
  renderHook(() => useStoriesActions({ user: USER, selectedTier: 'all', onTierChange: jest.fn() }));
  await settle();
  const calls = feedCalls().map(([url]) => url);
  expect(calls).toHaveLength(2);
  expect(calls[0]).not.toContain('viewer_lat');
  expect(calls[1]).toContain('viewer_lat=28.378');
  expect(getCurrentPosition).toHaveBeenCalledTimes(1);
});

it('fetches exactly once when location is denied', async () => {
  getCurrentPosition.mockImplementation((ok, err) => setTimeout(() => err({ code: 1 }), 5));
  renderHook(() => useStoriesActions({ user: USER, selectedTier: 'all', onTierChange: jest.fn() }));
  await settle();
  expect(feedCalls()).toHaveLength(1);
});

it('keeps one realtime channel when the location arrives', async () => {
  renderHook(() => useStoriesActions({ user: USER, selectedTier: 'all', onTierChange: jest.fn() }));
  await settle();
  expect(supabase.channel).toHaveBeenCalledTimes(1);
  expect(supabase.removeChannel).not.toHaveBeenCalled();
});

it('a realtime DELETE refetches with the latest location', async () => {
  renderHook(() => useStoriesActions({ user: USER, selectedTier: 'all', onTierChange: jest.fn() }));
  await settle();
  const onDelete = mockChannel.on.mock.calls.find(([, filter]) => filter.event === 'DELETE')[2];
  apiClient.get.mockClear();
  await act(async () => { onDelete({ old: { id: 's1' } }); });
  expect(feedCalls()).toHaveLength(1);
  expect(feedCalls()[0][0]).toContain('viewer_lat=28.378');
});
