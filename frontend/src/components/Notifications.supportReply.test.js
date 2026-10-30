import React, { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import NotificationsPage from './NotificationsPage';
import NotificationsDrawer from './NotificationsDrawer';
import { getNotifications, getUnreadCount, markRead, markAllRead } from '../services/notificationService';
import { refreshUnreadCounts } from '../hooks/useUnreadCounts';

let mockUser;
let mockTheme;
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
// CRA's Jest resolver cannot use react-router-dom 7's absent legacy main file.
// Its actual router implementation supplies MemoryRouter, navigation and history.
jest.mock('react-router-dom', () => {
  global.TextEncoder = global.TextEncoder || require('util').TextEncoder;
  global.TextDecoder = global.TextDecoder || require('util').TextDecoder;
  return jest.requireActual('react-router');
}, { virtual: true });
jest.mock('../services/notificationService', () => ({
  getNotifications: jest.fn(), getUnreadCount: jest.fn(), markRead: jest.fn(), markAllRead: jest.fn(),
}));
jest.mock('../hooks/useUnreadCounts', () => ({ refreshUnreadCounts: jest.fn() }));
jest.mock('./ui/sheet', () => ({
  Sheet: ({ children, open }) => open ? <div>{children}</div> : null,
  SheetContent: ({ children }) => <div>{children}</div>,
  SheetHeader: ({ children }) => <div>{children}</div>,
  SheetTitle: ({ children }) => <h1>{children}</h1>,
}));

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TICKET = '33333333-3333-4333-8333-333333333333';
const MESSAGE = '44444444-4444-4444-8444-444444444444';
const NOTICE = '55555555-5555-4555-8555-555555555555';
const DESTINATION = `/support/tickets/${TICKET}`;
const payload = (recipient = OWNER) => ({ ticket_id: TICKET, message_id: MESSAGE, recipient_id: recipient });
const notification = (overrides = {}) => ({
  id: NOTICE, type: 'support_reply', title: 'Support replied to your ticket', body: 'A fictional support reply.',
  is_read: false, created_at: '2026-10-29T16:00:00Z', data: payload(), ...overrides,
});
const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const resolve = (pending, value) => act(async () => { pending.resolve(value); await Promise.resolve(); });
const reject = (pending) => act(async () => { pending.reject(new Error('Synthetic read failure')); await Promise.resolve(); });

function LocationObserver({ onLocation }) {
  const location = useLocation();
  useEffect(() => { onLocation(location.pathname, location.state, location.key); }, [location, onLocation]);
  return <output data-testid="support-test-location">{location.pathname}</output>;
}

function mount(surface, open = true) {
  const close = jest.fn(); const count = jest.fn(); const locations = jest.fn();
  const tree = (isOpen) => <MemoryRouter initialEntries={['/notifications']}>
    <LocationObserver onLocation={locations} />
    {surface === 'page' ? <NotificationsPage /> : <NotificationsDrawer isOpen={isOpen} onClose={close} onCountUpdate={count} />}
  </MemoryRouter>;
  const view = render(tree(open));
  return { ...view, close, count, locations, update: (isOpen = true) => view.rerender(tree(isOpen)) };
}
const row = () => screen.getByRole('button', { name: /^Support replied to your ticket/ });
const path = () => screen.getByTestId('support-test-location').textContent;
function noActivation(view) {
  expect(path()).toBe('/notifications');
  expect(view.close).not.toHaveBeenCalled();
  expect(view.count).not.toHaveBeenCalled();
}
function activated(view, surface, destination = DESTINATION) {
  expect(path()).toBe(destination);
  expect(view.locations.mock.calls.filter(([pathname]) => pathname === destination)).toHaveLength(1);
  expect(view.close).toHaveBeenCalledTimes(surface === 'drawer' ? 1 : 0);
}

beforeEach(() => {
  jest.resetAllMocks();
  mockUser = { id: OWNER }; mockTheme = 'dark';
  getNotifications.mockResolvedValue({ data: [notification()] });
  getUnreadCount.mockResolvedValue({ data: { unread_count: 1 } });
  markRead.mockResolvedValue({ data: {} }); markAllRead.mockResolvedValue({ data: {} });
});

const invalidPayloads = [
  ['missing payload', undefined], ['null', null], ['array', []], ['JSON array', '[]'],
  ['JSON scalar', '"not an object"'], ['number', 42], ['malformed JSON', '{'],
  ['missing message', { ticket_id: TICKET, recipient_id: OWNER }],
  ['extra redirect field', { ...payload(), route: '/credits' }],
  ['malformed ticket ID', { ...payload(), ticket_id: '../another-ticket' }],
  ['malformed message ID', { ...payload(), message_id: 'not-a-uuid' }],
  ['different recipient', payload(OTHER)],
];

describe.each(['page', 'drawer'])('%s support reply consumer', surface => {
  it.each(invalidPayloads.flatMap(([name, data]) => [false, true].map(is_read => [name, is_read, data])))(
  'rejects %s with is_read=%s before any side effect', async (_name, is_read, data) => {
    getNotifications.mockResolvedValue({ data: [notification({ data, is_read })] });
    const view = mount(surface); await flush();
    const fetches = getNotifications.mock.calls.length; const counts = getUnreadCount.mock.calls.length;
    fireEvent.click(row()); await flush();
    noActivation(view); expect(markRead).not.toHaveBeenCalled(); expect(markAllRead).not.toHaveBeenCalled();
    expect(refreshUnreadCounts).not.toHaveBeenCalled();
    expect(getNotifications).toHaveBeenCalledTimes(fetches); expect(getUnreadCount).toHaveBeenCalledTimes(counts);
    expect(screen.getByText('1 unread')).toBeInTheDocument();
  });

  it.each(['dark', 'light', 'beach'])('waits for write and both authoritative reads before navigating in %s', async theme => {
    mockTheme = theme;
    getNotifications.mockResolvedValueOnce({ data: [notification({ data: JSON.stringify(payload()) })] });
    const write = deferred(); const rows = deferred(); const unread = deferred();
    markRead.mockReturnValue(write.promise);
    getNotifications.mockReturnValueOnce(rows.promise); getUnreadCount.mockReturnValueOnce({ data: { unread_count: 1 } }).mockReturnValueOnce(unread.promise);
    const view = mount(surface); await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Social' }));
    fireEvent.click(row()); await flush();
    expect(markRead).toHaveBeenCalledTimes(1); expect(markRead).toHaveBeenCalledWith(NOTICE); noActivation(view);
    await resolve(write, { data: {} }); noActivation(view);
    await resolve(rows, { data: [notification({ is_read: true })] }); noActivation(view);
    await resolve(unread, { data: { unread_count: 0 } }); await flush();
    activated(view, surface); expect(view.count).toHaveBeenCalledTimes(surface === 'drawer' ? 1 : 0);
    expect(refreshUnreadCounts).toHaveBeenCalledWith({ force: true });
  });

  it('does not navigate after a failed mark-read and allows a successful retry', async () => {
    const write = deferred(); markRead.mockReturnValueOnce(write.promise);
    const view = mount(surface); await flush();
    fireEvent.click(row()); await reject(write); await flush();
    noActivation(view); expect(row()).not.toBeDisabled(); expect(refreshUnreadCounts).not.toHaveBeenCalled();
    getNotifications.mockResolvedValue({ data: [notification({ is_read: true })] });
    getUnreadCount.mockResolvedValue({ data: { unread_count: 0 } });
    fireEvent.click(row()); await flush();
    expect(markRead).toHaveBeenCalledTimes(2); activated(view, surface);
  });

  it('does not navigate when the authoritative refresh fails; reload permits read-only activation', async () => {
    const view = mount(surface); await flush();
    getNotifications.mockRejectedValueOnce(new Error('Synthetic refresh failure'));
    fireEvent.click(row()); await flush();
    noActivation(view); expect(screen.getByRole('alert')).toHaveTextContent('Could not load notifications');
    getNotifications.mockResolvedValue({ data: [notification({ is_read: true })] });
    getUnreadCount.mockResolvedValue({ data: { unread_count: 0 } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry notifications' })); await flush();
    fireEvent.click(row()); await flush();
    expect(markRead).toHaveBeenCalledTimes(1); activated(view, surface);
  });

  it('serializes same-tick already-read activation without a read mutation', async () => {
    getNotifications.mockResolvedValue({ data: [notification({ is_read: true })] });
    const view = mount(surface); await flush(); const button = row();
    act(() => { fireEvent.click(button); fireEvent.click(button); }); await flush();
    activated(view, surface); expect(markRead).not.toHaveBeenCalled();
    expect(refreshUnreadCounts).not.toHaveBeenCalled(); expect(view.count).not.toHaveBeenCalled();
  });

  it.each(['{Enter}', ' '])('supports native row keyboard activation using %s', async key => {
    getNotifications.mockResolvedValue({ data: [notification({ is_read: true })] });
    const view = mount(surface); await flush(); row().focus();
    await userEvent.keyboard(key); await flush();
    await waitFor(() => activated(view, surface)); expect(markRead).not.toHaveBeenCalled();
  });

  it('drops an already-read activation across committed A to B to A renders', async () => {
    getNotifications.mockResolvedValue({ data: [notification({ is_read: true })] });
    const view = mount(surface); await flush();
    act(() => { fireEvent.click(row()); mockUser = { id: OTHER }; view.update(); });
    act(() => { mockUser = { id: OWNER }; view.update(); });
    await flush(); noActivation(view); expect(markRead).not.toHaveBeenCalled();
    expect(refreshUnreadCounts).not.toHaveBeenCalled();
  });

  it('drops an already-read activation if unmounted before its callback', async () => {
    getNotifications.mockResolvedValue({ data: [notification({ is_read: true })] });
    const view = mount(surface); await flush(); const transitions = view.locations.mock.calls.length;
    act(() => { fireEvent.click(row()); view.unmount(); }); await flush();
    expect(view.locations).toHaveBeenCalledTimes(transitions); expect(view.close).not.toHaveBeenCalled();
    expect(view.count).not.toHaveBeenCalled(); expect(markRead).not.toHaveBeenCalled();
  });

  it('drops a delayed mutation after A to B to A instead of reviving the old activation', async () => {
    const write = deferred(); markRead.mockReturnValue(write.promise);
    getNotifications.mockImplementation(id => Promise.resolve({ data: [notification({ data: payload(id) })] }));
    const view = mount(surface); await flush(); fireEvent.click(row());
    mockUser = { id: OTHER }; view.update(); await flush();
    mockUser = { id: OWNER }; view.update(); await flush();
    const fetches = getNotifications.mock.calls.length;
    await resolve(write, { data: {} }); await flush();
    noActivation(view); expect(refreshUnreadCounts).not.toHaveBeenCalled();
    expect(getNotifications).toHaveBeenCalledTimes(fetches); expect(row()).not.toBeDisabled();
    expect(screen.getByText('1 unread')).toBeInTheDocument();
  });

  it('drops a delayed authoritative refresh after an account cycle', async () => {
    const oldRows = deferred(); const oldCount = deferred();
    const view = mount(surface); await flush();
    getNotifications.mockReturnValueOnce(oldRows.promise); getUnreadCount.mockReturnValueOnce(oldCount.promise);
    fireEvent.click(row()); await flush();
    mockUser = { id: OTHER }; view.update(); await flush();
    mockUser = { id: OWNER }; view.update(); await flush();
    await resolve(oldRows, { data: [notification({ is_read: true })] }); await resolve(oldCount, { data: { unread_count: 0 } }); await flush();
    noActivation(view); expect(row()).toHaveAccessibleName('Support replied to your ticket, unread');
    expect(screen.getByText('1 unread')).toBeInTheDocument();
  });

  it('drops delayed completion after unmount', async () => {
    const write = deferred(); markRead.mockReturnValue(write.promise);
    const view = mount(surface); await flush(); fireEvent.click(row()); view.unmount();
    const transitions = view.locations.mock.calls.length;
    await resolve(write, { data: {} }); await flush();
    expect(view.locations).toHaveBeenCalledTimes(transitions); expect(view.close).not.toHaveBeenCalled();
    expect(view.count).not.toHaveBeenCalled(); expect(refreshUnreadCounts).not.toHaveBeenCalled();
  });

  it('does not load or activate an accountless inbox', async () => {
    mockUser = null; const view = mount(surface); await flush();
    expect(screen.queryByRole('button', { name: /^Support replied/ })).not.toBeInTheDocument();
    expect(getNotifications).not.toHaveBeenCalled(); expect(markRead).not.toHaveBeenCalled();
    expect(refreshUnreadCounts).not.toHaveBeenCalled(); noActivation(view);
  });

  it.each([
    ['booking_confirmed', { booking_id: 'booking-fixture' }, '/bookings', { bookingId: 'booking-fixture' }],
    ['new_message', { conversation_id: 'conversation-fixture' }, '/messages/conversation-fixture', null],
    ['credit_refund', {}, '/credits', null],
  ])('preserves existing %s destination', async (type, data, destination, locationState) => {
    getNotifications.mockResolvedValue({ data: [notification({ type, data, is_read: true })] });
    const view = mount(surface); await flush(); fireEvent.click(row()); await flush();
    activated(view, surface, destination); expect(markRead).not.toHaveBeenCalled();
    expect(view.locations.mock.calls.at(-1)[1]).toEqual(locationState);
  });

  it.each([
    ['mention', { post_id: 'post-fixture' }, '/post/post-fixture'],
    ['booking_confirmed', { booking_id: 'booking-fixture' }, '/bookings'],
  ])('preserves %s navigation after a successful read with a failed refresh', async (type, data, destination) => {
    getNotifications.mockResolvedValue({ data: [notification({ type, data })] });
    const view = mount(surface); await flush();
    getNotifications.mockRejectedValueOnce(new Error('Synthetic legacy refresh failure'));
    fireEvent.click(row()); await flush();
    expect(markRead).toHaveBeenCalledWith(NOTICE); activated(view, surface, destination);
    expect(refreshUnreadCounts).toHaveBeenCalledWith({ force: true });
    expect(view.count).toHaveBeenCalledTimes(surface === 'drawer' ? 1 : 0);
  });

  it('preserves global mark-all behavior even for an invalid support payload', async () => {
    getNotifications.mockResolvedValue({ data: [notification({ data: null })] });
    const view = mount(surface); await flush();
    getNotifications.mockResolvedValue({ data: [notification({ data: null, is_read: true })] });
    getUnreadCount.mockResolvedValue({ data: { unread_count: 0 } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' })); await flush();
    expect(markAllRead).toHaveBeenCalledWith(OWNER); expect(markRead).not.toHaveBeenCalled();
    expect(path()).toBe('/notifications'); expect(view.close).not.toHaveBeenCalled();
    expect(refreshUnreadCounts).toHaveBeenCalledWith({ force: true });
    expect(screen.queryByText('1 unread')).not.toBeInTheDocument();
    expect(view.count).toHaveBeenCalledTimes(surface === 'drawer' ? 1 : 0);
  });
});

it('drawer close and reopen invalidates a pending support activation', async () => {
  const write = deferred(); markRead.mockReturnValue(write.promise);
  const view = mount('drawer'); await flush(); fireEvent.click(row());
  view.update(false); await flush(); view.update(true); await flush();
  await resolve(write, { data: {} }); await flush();
  noActivation(view); expect(refreshUnreadCounts).not.toHaveBeenCalled(); expect(row()).not.toBeDisabled();
  expect(screen.getByText('1 unread')).toBeInTheDocument();
});

it('drawer close and reopen invalidates an already-read activation callback', async () => {
  getNotifications.mockResolvedValue({ data: [notification({ is_read: true })] });
  const view = mount('drawer'); await flush();
  act(() => { fireEvent.click(row()); view.update(false); });
  act(() => { view.update(true); }); await flush();
  noActivation(view); expect(markRead).not.toHaveBeenCalled(); expect(refreshUnreadCounts).not.toHaveBeenCalled();
});
