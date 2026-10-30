import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ProfileReviewsSection from './ProfileReviewsSection';
import apiClient from '../lib/apiClient';

jest.mock('../lib/apiClient', () => ({ get: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));
jest.mock('../utils/media', () => ({ getFullUrl: (value) => value }));
jest.mock('./ui/avatar', () => ({
  Avatar: ({ children }) => <span>{children}</span>,
  AvatarFallback: ({ children }) => <span>{children}</span>,
  AvatarImage: () => null,
}));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const response = (name) => ({ data: {
  average_rating: 5, total_reviews: 1,
  recent_reviews: [{ id: name, reviewer_name: name, rating: 5, created_at: '2026-10-29T12:00:00Z' }],
} });
const settle = async (request, value, rejected = false) => act(async () => {
  if (rejected) request.reject(value); else request.resolve(value);
});

beforeEach(() => jest.resetAllMocks());

it.each(['light', 'dark', 'beach'])('keeps the latest profile after an old response in %s', async (theme) => {
  const old = deferred(); const current = deferred();
  apiClient.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const view = render(<ProfileReviewsSection profileUserId="old" theme={theme} />);
  view.rerender(<ProfileReviewsSection profileUserId="current" theme={theme} />);
  await settle(current, response('Current reviewer'));
  await settle(old, response('Old reviewer'));
  expect(screen.getByText('Current reviewer')).toBeInTheDocument();
  expect(screen.queryByText('Old reviewer')).not.toBeInTheDocument();
});

it('ignores an old rejection and finalizer while the next profile is loading', async () => {
  const old = deferred(); const current = deferred();
  apiClient.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const view = render(<ProfileReviewsSection profileUserId="old" />);
  view.rerender(<ProfileReviewsSection profileUserId="current" />);
  await settle(old, new Error('old request failed'), true);
  expect(screen.queryByText('No reviews yet')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await settle(current, response('Current reviewer'));
  expect(screen.getByText('Current reviewer')).toBeInTheDocument();
});

it('invalidates reviews when the same profile changes role', async () => {
  const old = deferred(); const current = deferred();
  apiClient.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const view = render(<ProfileReviewsSection profileUserId="same" />);
  view.rerender(<ProfileReviewsSection profileUserId="same" isPhotographer />);
  await settle(current, response('Photographer reviewer'));
  await settle(old, response('Surfer reviewer'));
  expect(apiClient.get).toHaveBeenLastCalledWith('/reviews/photographer/same/stats');
  expect(screen.getByText('Photographer reviewer')).toBeInTheDocument();
  expect(screen.queryByText('Surfer reviewer')).not.toBeInTheDocument();
});

it('clears a removed identity and ignores its pending response', async () => {
  const old = deferred();
  apiClient.get.mockReturnValue(old.promise);
  const view = render(<ProfileReviewsSection profileUserId="old" />);
  view.rerender(<ProfileReviewsSection profileUserId={null} />);
  await settle(old, response('Old reviewer'));
  expect(screen.queryByText('Old reviewer')).not.toBeInTheDocument();
  expect(screen.getByText('No reviews yet')).toBeInTheDocument();
});

it('shows a recoverable failure instead of claiming there are no reviews', async () => {
  apiClient.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response('Recovered reviewer'));
  render(<ProfileReviewsSection profileUserId="current" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load reviews');
  expect(screen.queryByText('No reviews yet')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading reviews' }));
  expect(await screen.findByText('Recovered reviewer')).toBeInTheDocument();
});
