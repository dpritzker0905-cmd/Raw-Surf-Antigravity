import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import NotificationsPage from './NotificationsPage';
import NotificationsDrawer from './NotificationsDrawer';
import { getNotifications, getUnreadCount, markAllRead } from '../services/notificationService';

let mockUser = { id: 'owner' };
const mockNavigate = jest.fn();
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }), { virtual: true });
jest.mock('../services/notificationService', () => ({
  getNotifications: jest.fn(), getUnreadCount: jest.fn(), markRead: jest.fn(), markAllRead: jest.fn(),
}));
jest.mock('../hooks/useUnreadCounts', () => ({ refreshUnreadCounts: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('./ui/sheet', () => ({
  Sheet: ({ children, open }) => open ? <div>{children}</div> : null,
  SheetContent: ({ children }) => <div>{children}</div>,
  SheetHeader: ({ children }) => <div>{children}</div>,
  SheetTitle: ({ children }) => <h1>{children}</h1>,
}));

const notification = (id, read = true) => ({ id, title: id, type: 'mention', is_read: read, created_at: '2026-10-29T16:00:00Z' });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'owner' };
  getNotifications.mockResolvedValue({ data: [notification('latest')] });
  getUnreadCount.mockResolvedValue({ data: { unread_count: 1 } });
  markAllRead.mockResolvedValue({ data: {} });
});

it.each(['page', 'drawer'])('%s uses the account unread count even when its latest page is read', async (surface) => {
  render(surface === 'page' ? <NotificationsPage /> : <NotificationsDrawer isOpen onClose={() => {}} />);
  await flush();
  expect(screen.getByText('1 unread')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mark all read' })).toBeInTheDocument();
});

it('shows a recoverable failure instead of an empty inbox', async () => {
  getNotifications.mockRejectedValueOnce(new Error('offline'));
  render(<NotificationsPage />);
  await flush();
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load notifications');
  expect(screen.queryByText("You're all caught up!")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry notifications' }));
  await flush();
  expect(screen.getByText('latest')).toBeInTheDocument();
});

it('does not let a previous account response replace the current inbox', async () => {
  const old = deferred();
  getNotifications.mockImplementation(id => id === 'owner' ? old.promise : Promise.resolve({ data: [notification('current')] }));
  const view = render(<NotificationsPage />);
  mockUser = { id: 'next' };
  view.rerender(<NotificationsPage />);
  await flush();
  await act(async () => old.resolve({ data: [notification('old account')] }));
  expect(screen.getByText('current')).toBeInTheDocument();
  expect(screen.queryByText('old account')).not.toBeInTheDocument();
});

it('loads older history from the last timestamp/id without replacing current rows', async () => {
  const first = Array.from({ length: 50 }, (_, i) => notification(`n${String(99 - i).padStart(3, '0')}`));
  getNotifications.mockResolvedValueOnce({ data: first }).mockResolvedValueOnce({ data: [notification('older unread', false)] });
  render(<NotificationsPage />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Load older notifications' }));
  await flush();
  expect(getNotifications).toHaveBeenLastCalledWith('owner', { limit: 50, before_created_at: first[49].created_at, before_id: first[49].id });
  expect(screen.getByText('older unread')).toBeInTheDocument();
  expect(screen.getByText(first[0].title)).toBeInTheDocument();
});

it('a completed old-account mark-all cannot replace the new account list', async () => {
  const mutation = deferred();
  markAllRead.mockReturnValue(mutation.promise);
  getNotifications.mockImplementation(id => Promise.resolve({ data: [notification(`${id} item`, false)] }));
  const view = render(<NotificationsPage />);
  await flush();
  // Baseline label is intentionally accepted so this reaches the original race.
  fireEvent.click(screen.getByRole('button', { name: /Mark all read|Check Check/ }));
  mockUser = { id: 'next' };
  view.rerender(<NotificationsPage />);
  await flush();
  await act(async () => mutation.resolve({ data: {} }));
  expect(screen.getByText('next item')).toBeInTheDocument();
  expect(screen.queryByText('owner item')).not.toBeInTheDocument();
});

it('regroups an open inbox after the local date changes', async () => {
  jest.useFakeTimers();
  try {
    const beforeMidnight = new Date(2026, 9, 29, 23, 59, 30);
    jest.setSystemTime(beforeMidnight);
    getNotifications.mockResolvedValue({ data: [{ ...notification('late notice'), created_at: beforeMidnight.toISOString() }] });
    render(<NotificationsPage />);
    await flush();
    expect(screen.getByText('Today')).toBeInTheDocument();
    await act(async () => jest.advanceTimersByTime(60000));
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
    expect(screen.queryByText('Today')).not.toBeInTheDocument();
  } finally { jest.useRealTimers(); }
});
