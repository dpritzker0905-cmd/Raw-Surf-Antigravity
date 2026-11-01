/**
 * ONE unread-count poller, however many navs show the badges, and none while the tab is hidden.
 *
 * The defect (live trace of dev, 2026-10-23): Sidebar, TopNav and BottomNav are all mounted (CSS hides them per
 * breakpoint) and each polled on its own, so /notifications/{id}/unread-count (Sidebar + TopNav) and
 * /messages/unread-counts/{id} (Sidebar + BottomNav) were each sent twice every 30 s, hidden tab or not.
 */
import { renderHook, act } from '@testing-library/react';
import { useUnreadCounts, UNREAD_POLL_MS } from './useUnreadCounts';

// The hook keeps module-level state: each test signs in a NEW user (a user switch resets it), and RTL's automatic
// cleanup unmounts every subscriber after each test, which stops the poller.
let userSeq = 0;
let userId;
const mockGet = jest.fn();
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: { get: (...a) => mockGet(...a) } }));
jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

let visibility = 'visible';
const notifCalls = () => mockGet.mock.calls.filter(([u]) => u.startsWith('/notifications/')).length;
const msgCalls = () => mockGet.mock.calls.filter(([u]) => u.startsWith('/messages/unread-counts/')).length;
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const advance = (ms) => act(async () => { jest.advanceTimersByTime(ms); await Promise.resolve(); });
const setVisibility = (v) => act(async () => { visibility = v; document.dispatchEvent(new Event('visibilitychange')); });

beforeAll(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

beforeEach(() => {
  jest.useFakeTimers();
  visibility = 'visible';
  mockGet.mockImplementation((url) => Promise.resolve({
    data: url.includes('/messages/') ? { total: 2 } : { unread_count: 5 },
  }));
  userSeq += 1;
  userId = `u${userSeq}`;
});

afterEach(() => {
  jest.useRealTimers();
  mockGet.mockReset();
});

/** Sidebar, TopNav and BottomNav mounted together, as AppLayout does. */
const mountThree = () => renderHook(() => [useUnreadCounts(userId), useUnreadCounts(userId), useUnreadCounts(userId)]);

it('three navs mounted together send each count once, and every subscriber sees it', async () => {
  const { result } = mountThree();
  await flush();
  expect(notifCalls()).toBe(1);
  expect(msgCalls()).toBe(1);
  result.current.forEach((c) => expect(c).toMatchObject({ notifications: 5, messages: 2 }));
});

it('polls once per interval for all subscribers', async () => {
  mountThree();
  await flush();
  await advance(UNREAD_POLL_MS);
  await flush();
  expect(notifCalls()).toBe(2);
  expect(msgCalls()).toBe(2);
});

it('sends nothing while the tab is hidden, then catches up once when it is shown', async () => {
  mountThree();
  await flush();
  await setVisibility('hidden');
  await advance(UNREAD_POLL_MS * 4);
  expect(notifCalls()).toBe(1);
  await setVisibility('visible');
  await flush();
  expect(notifCalls()).toBe(2);
  expect(msgCalls()).toBe(2);
});

it('does not catch up on a return before a tick was missed', async () => {
  mountThree();
  await flush();
  await setVisibility('hidden');
  await advance(1000);
  await setVisibility('visible');
  await flush();
  expect(notifCalls()).toBe(1);
});

it('refresh() shares a request already in flight', async () => {
  const { result } = mountThree();
  await act(async () => { result.current[0].refresh(); result.current[1].refresh(); });
  await flush();
  expect(notifCalls()).toBe(1);
  await act(async () => { await result.current[0].refresh(); });
  expect(notifCalls()).toBe(2);
});

it('stops polling when the last subscriber unmounts', async () => {
  const { unmount } = mountThree();
  await flush();
  unmount();
  await advance(UNREAD_POLL_MS * 3);
  expect(notifCalls()).toBe(1);
});

it('keeps the last count when one request fails', async () => {
  const { result } = mountThree();
  await flush();
  mockGet.mockImplementation((url) => (url.includes('/messages/')
    ? Promise.reject(new Error('offline'))
    : Promise.resolve({ data: { unread_count: 7 } })));
  await advance(UNREAD_POLL_MS);
  await flush();
  expect(result.current[0]).toMatchObject({ notifications: 7, messages: 2 });
});
