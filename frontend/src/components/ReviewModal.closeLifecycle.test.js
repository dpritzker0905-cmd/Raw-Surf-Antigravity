import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ReviewModal from './ReviewModal';
import apiClient from '../lib/apiClient';

jest.mock('../lib/apiClient', () => ({ post: jest.fn() }));
jest.mock('../utils/media', () => ({ getFullUrl: value => value }));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const props = () => ({ isOpen: true, onClose: jest.fn(), reviewerId: 'test-reviewer', sessionId: 'test-session',
  reviewee: { id: 'test-reviewee', full_name: 'Test Photographer' } });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const tick = ms => act(() => { jest.advanceTimersByTime(ms); });
const submit = async multi => {
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getAllByTestId('review-modal-page')[0].querySelectorAll('button')[2]);
  await act(async () => {
    fireEvent.click(within(dialog).getByText(multi ? /Submit.*Review/ : 'Submit Review').closest('button'));
    await Promise.resolve();
  });
};
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); apiClient.post.mockResolvedValue({ data: {} }); });
afterEach(() => { cleanup(); jest.clearAllTimers(); jest.useRealTimers(); });

test.each(['light', 'dark', 'beach'])('current %s dialog closes at 1500ms, not 1499ms', async theme => {
  const p = { ...props(), theme }; render(<ReviewModal {...p} />); await submit();
  tick(1499); expect(p.onClose).not.toHaveBeenCalled(); tick(1); expect(p.onClose).toHaveBeenCalledTimes(1);
});
test('unmount cancels the submitted dialog close', async () => {
  const p = props(); const view = render(<ReviewModal {...p} />); await submit(); view.unmount(); tick(1500);
  expect(p.onClose).not.toHaveBeenCalled();
});
test('closed then reopened dialog is not closed by earlier submission', async () => {
  const p = props(); const view = render(<ReviewModal {...p} />); await submit(); tick(500);
  view.rerender(<ReviewModal {...p} isOpen={false} />); view.rerender(<ReviewModal {...p} />); tick(1500);
  expect(p.onClose).not.toHaveBeenCalled();
});
test.each(['sessionId', 'reviewerId', 'sessionType', 'reviewee'])('changing %s cancels the prior close', async key => {
  const p = props(); const view = render(<ReviewModal {...p} />); await submit();
  const changed = key === 'reviewee' ? { id: 'different-reviewee' } : key === 'sessionType' ? 'scheduled' : 'different-id';
  view.rerender(<ReviewModal {...p} {...{ [key]: changed }} />); tick(1500); expect(p.onClose).not.toHaveBeenCalled();
});
test('late success after close and reopen cannot arm a new close timer', async () => {
  const pending = deferred(); apiClient.post.mockReturnValue(pending.promise);
  const p = props(); const view = render(<ReviewModal {...p} />); await submit();
  view.rerender(<ReviewModal {...p} isOpen={false} />); view.rerender(<ReviewModal {...p} />);
  await act(async () => { pending.resolve({ data: {} }); await pending.promise; }); tick(1500);
  expect(p.onClose).not.toHaveBeenCalled();
});
test('callback change uses latest committed callback without resetting the delay', async () => {
  const p = props(); const nextClose = jest.fn(); const view = render(<ReviewModal {...p} />); await submit(); tick(1000);
  view.rerender(<ReviewModal {...p} onClose={nextClose} reviewee={{ ...p.reviewee }} />); tick(500);
  expect(p.onClose).not.toHaveBeenCalled(); expect(nextClose).toHaveBeenCalledTimes(1);
});
test('failed POST does not schedule successful auto-close', async () => {
  apiClient.post.mockRejectedValue({ response: { status: 503, data: { detail: 'Unavailable' } } });
  const p = props(); render(<ReviewModal {...p} />); await submit(); tick(1500); expect(p.onClose).not.toHaveBeenCalled();
});
test.each([false, true])('multi-review close is scoped when participant changes=%s', async changed => {
  const p = { ...props(), participants: [{ id: 'test-surfer', full_name: 'Test Surfer' }] };
  const view = render(<ReviewModal {...p} />); await submit(true);
  if (changed) view.rerender(<ReviewModal {...p} participants={[{ id: 'other-surfer' }]} />);
  tick(1500); expect(p.onClose).toHaveBeenCalledTimes(changed ? 0 : 1);
});
