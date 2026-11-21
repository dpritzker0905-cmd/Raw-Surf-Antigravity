import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import PastTab from './PastTab';
import SessionDetailDrawer from './SessionDetailDrawer';
import ReviewModal from '../ReviewModal';
import apiClient from '../../lib/apiClient';

jest.mock('../../lib/apiClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../../utils/media', () => ({ getFullUrl: value => value }));
jest.mock('../../utils/logger', () => ({ error: jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const booking = {
  id: 'synthetic-booking', photographer_id: 'synthetic-photographer', photographer_name: 'Synthetic Photographer',
  status: 'Completed', session_date: '2026-10-01T12:00:00Z', duration: 60,
  location: 'Synthetic beach', booking_type: 'scheduled', participants: [],
};
const bookings = [booking];
const props = { isOpen: true, onClose: jest.fn(), session: booking, userRole: 'surfer', userId: 'synthetic-reviewer' };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const mount = async (view, theme = 'dark') => {
  let result;
  await act(async () => {
    result = render(view === 'past'
      ? <PastTab pastBookings={bookings} userId="synthetic-reviewer" theme={theme} />
      : <SessionDetailDrawer {...props} theme={theme} />);
    await Promise.resolve();
  });
  return result;
};
const chooseRating = rating => {
  const dialog = screen.getByRole('dialog');
  const overall = within(dialog).getAllByTestId('review-modal-page')[0];
  fireEvent.click(overall.querySelectorAll('button')[rating - 1]);
  return dialog;
};
const submit = rating => {
  fireEvent.click(screen.getByText('Leave a Review').closest('button'));
  const dialog = chooseRating(rating);
  fireEvent.click(within(dialog).getByText('Submit Review').closest('button'));
};
const expectDisplayedRating = (view, rating) => {
  const label = screen.getByText(view === 'past' ? 'Reviewed' : 'Review submitted');
  expect(label.parentElement.querySelectorAll('svg.fill-yellow-400')).toHaveLength(rating);
};

beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
  apiClient.get.mockResolvedValue({ data: { has_reviewed: false } });
  apiClient.post.mockResolvedValue({ data: { id: 'synthetic-review' } });
});
afterEach(() => { cleanup(); jest.clearAllTimers(); jest.useRealTimers(); });

const successCases = ['past', 'drawer'].flatMap(view => ['light', 'dark', 'beach'].flatMap(theme =>
  [1, 2, 3, 4, 5].map(rating => [view, theme, rating])));
test.each(successCases)('%s in %s shows the actually submitted %i-star rating', async (view, theme, rating) => {
  await mount(view, theme); const pending = deferred(); apiClient.post.mockReturnValue(pending.promise);
  submit(rating);
  expect(apiClient.post).toHaveBeenCalledWith('/reviews?reviewer_id=synthetic-reviewer', expect.objectContaining({
    reviewee_id: 'synthetic-photographer', rating,
  }));
  expect(screen.queryByText(view === 'past' ? 'Reviewed' : 'Review submitted')).not.toBeInTheDocument();
  await act(async () => { pending.resolve({ data: { id: 'synthetic-review' } }); await pending.promise; });
  expectDisplayedRating(view, rating);
});

test.each(['past', 'drawer'])('%s preserves an existing server-reported rating', async view => {
  apiClient.get.mockResolvedValue({ data: { has_reviewed: true, rating: 2 } });
  await mount(view); expectDisplayedRating(view, 2); expect(apiClient.post).not.toHaveBeenCalled();
});

test.each(['past', 'drawer'])('%s does not invent a submitted rating after a failed POST', async view => {
  await mount(view); const pending = deferred(); apiClient.post.mockReturnValue(pending.promise); submit(2);
  await act(async () => { pending.reject({ response: { status: 503, data: { detail: 'Unavailable' } } }); await Promise.resolve(); });
  expect(screen.queryByText(view === 'past' ? 'Reviewed' : 'Review submitted')).not.toBeInTheDocument();
});

test.each([['live', 'live_session_id'], ['scheduled', 'booking_id'], ['on_demand', 'dispatch_id']])('single %s review carries its chosen rating without changing the session payload', async (sessionType, key) => {
  const onReviewSubmitted = jest.fn();
  render(<ReviewModal isOpen onClose={jest.fn()} reviewerId="synthetic-reviewer" sessionId="synthetic-session"
    sessionType={sessionType} reviewee={{ id: 'synthetic-photographer', full_name: 'Synthetic Photographer' }}
    onReviewSubmitted={onReviewSubmitted} />);
  const dialog = chooseRating(3);
  await act(async () => { fireEvent.click(within(dialog).getByText('Submit Review').closest('button')); await Promise.resolve(); });
  expect(apiClient.post).toHaveBeenCalledWith('/reviews?reviewer_id=synthetic-reviewer', {
    reviewee_id: 'synthetic-photographer', rating: 3, comment: null,
    photo_quality_rating: null, communication_rating: null, punctuality_rating: null,
    session_type: sessionType, [key]: 'synthetic-session',
  });
  expect(onReviewSubmitted).toHaveBeenCalledWith(3);
});


test.each(['past', 'drawer'])('%s displays the rating actually posted when stars change while awaiting confirmation', async view => {
  await mount(view); const pending = deferred(); apiClient.post.mockReturnValue(pending.promise); submit(1);
  chooseRating(4);
  expect(apiClient.post).toHaveBeenCalledWith('/reviews?reviewer_id=synthetic-reviewer', expect.objectContaining({ rating: 1 }));
  await act(async () => { pending.resolve({ data: { id: 'synthetic-review' } }); await pending.promise; });
  expectDisplayedRating(view, 1);
});
