import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }), { virtual: true });
import useExploreData from '../hooks/useExploreData';
import ExploreTrending from '../components/explore/ExploreTrending';
import apiClient from '../lib/apiClient';

jest.mock('../lib/apiClient', () => ({ get: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn(), debug: jest.fn() }));
jest.mock('../components/SocialAdCard', () => ({ SocialAdCard: () => null }));
jest.mock('../components/explore/PostMediaPreview', () => () => null);
const empty = { popular_spots: [], live_photographers: [], trending_posts: [] };
const ignore = () => {};

function Journey() {
  const [trending, setTrending] = useState(empty);
  const [loading, setLoading] = useState(false);
  const { fetchTrending, trendingError } = useExploreData({
    setTrending, setLoading, setSpotConditions: ignore, setTrendingHashtags: ignore,
  });
  return <><button onClick={fetchTrending}>Load Explore</button>
    {loading ? <p>Loading</p> : <ExploreTrending trending={trending}
      spotConditions={{}} error={trendingError} onRetry={fetchTrending} />}</>;
}

beforeEach(() => jest.clearAllMocks());

test('failed request is not presented as an empty community and can recover', async () => {
  apiClient.get.mockRejectedValueOnce(new Error('Network Error'));
  render(<Journey />);
  fireEvent.click(screen.getByText('Load Explore'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load Explore');
  expect(screen.queryByText('Discover the surf community')).not.toBeInTheDocument();
  let resolve;
  apiClient.get.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  apiClient.get.mockResolvedValue({ data: { hashtags: [] } });
  fireEvent.click(screen.getByRole('button', { name: 'Retry Explore' }));
  expect(screen.getByText('Loading')).toBeInTheDocument();
  resolve({ data: empty });
  expect(await screen.findByText('Discover the surf community')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(apiClient.get.mock.calls.filter(([url]) => url === '/explore/trending')).toHaveLength(2);
});

test('successful empty response retains the genuine empty state', async () => {
  apiClient.get.mockResolvedValue({ data: empty });
  render(<Journey />);
  fireEvent.click(screen.getByText('Load Explore'));
  await waitFor(() => expect(screen.queryByText('Loading')).not.toBeInTheDocument());
  expect(screen.getByText('Discover the surf community')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('retry restores real response spot cards and their hub navigation', async () => {
  apiClient.get.mockRejectedValueOnce(new Error('timeout'));
  render(<Journey />);
  fireEvent.click(screen.getByText('Load Explore'));
  await screen.findByRole('alert');
  apiClient.get.mockResolvedValueOnce({ data: {
    ...empty, popular_spots: [{ id: 'spot-123', name: 'Test break' }],
  } });
  apiClient.get.mockResolvedValue({ data: { conditions: {}, hashtags: [] } });
  fireEvent.click(screen.getByRole('button', { name: 'Retry Explore' }));
  fireEvent.click(await screen.findByTestId('trending-spot-spot-123'));
  expect(mockNavigate).toHaveBeenCalledWith('/spot-hub/spot-123');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('another failed retry remains recoverable without an automatic request loop', async () => {
  apiClient.get.mockRejectedValue(new Error('unavailable'));
  render(<Journey />);
  fireEvent.click(screen.getByText('Load Explore'));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Retry Explore' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.queryByText('Discover the surf community')).not.toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledTimes(2);
});
