import React, { Suspense, startTransition, useEffect, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import MessagesPage from './MessagesPage';
import apiClient from '../lib/apiClient';
import useConversationList from '../hooks/useConversationList';
let mockUser = { id: 'owner-a', role: 'Surfer' };
let mockPersona = 'Surfer';
const mockNavigate = jest.fn();
const mockParams = new URLSearchParams();
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate, useSearchParams: () => [mockParams, jest.fn()],
  useParams: () => ({}), useLocation: () => ({ state: null }),
}), { virtual: true });
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../contexts/PersonaContext', () => ({
  usePersona: () => ({ getEffectiveRole: () => mockPersona, activePersona: mockPersona, isMasked: false, isGodMode: false }),
  getExpandedRoleInfo: () => ({}), isProLevelRole: () => false, isBusinessRole: () => false,
}));
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../lib/supabase', () => ({ supabase: {
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
  removeChannel: jest.fn(),
} }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn(), debug: jest.fn() } }));
jest.mock('../hooks/usePresence', () => ({ __esModule: true, default: () => ({ isOnline: () => false }) }));
jest.mock('./messages/ComposeModal', () => () => null);
jest.mock('./messages/CreateNoteModal', () => () => null);
jest.mock('./messages/ViewNoteModal', () => () => null);
jest.mock('./messages/ChatViewPanel', () => () => null);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const conversation = name => ({ id: name, other_user_id: name, other_user_name: name, folder: 'primary' });
const failure = status => ({ response: { status }, message: 'test failure' });
let mockList;
const flush = async () => { await act(async () => {}); };
const mount = async () => { const view = render(<MessagesPage />); await flush(); return view; };
const poll = async () => { await act(async () => { jest.advanceTimersByTime(10000); }); };
const settle = async (request, data, reject = false) => {
  await act(async () => { if (reject) request.reject(data); else request.resolve({ data }); });
};
const retry = () => fireEvent.click(screen.getAllByRole('button', { name: 'Retry conversations' })[0]);
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); mockUser = { id: 'owner-a', role: 'Surfer' }; mockPersona = 'Surfer';
  mockList = jest.fn().mockResolvedValue({ data: [] });
  apiClient.get.mockImplementation((url, config) => {
    if (/\/messages\/conversations\/[^/]+(?:\?|$)/.test(url)) return mockList(url, config);
    if (url.startsWith('/notes/feed')) return Promise.resolve({ data: { own_note: null, feed: [] } });
    if (url.startsWith('/messages/unread-counts')) return Promise.resolve({ data: {} });
    return Promise.resolve({ data: [] });
  });
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
test('initial 503 is a persistent error, not a normal empty inbox; Retry recovers through real composition', async () => {
  mockList.mockRejectedValueOnce(failure(503)).mockResolvedValueOnce({ data: [conversation('Recovered crew')] });
  await mount();
  expect(screen.queryAllByText('No conversations in primary')).toHaveLength(0);
  expect(screen.getAllByRole('alert')[0]).toHaveTextContent('Could not load conversations');
  retry(); await flush();
  expect(screen.getAllByText('Recovered crew')).toHaveLength(2);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test.each(['light', 'dark', 'beach'])('valid empty and failure/retry controls use the shared theme tokens in %s', async theme => {
  document.documentElement.dataset.theme = theme;
  mockList.mockResolvedValueOnce({ data: [] }).mockRejectedValueOnce(failure(503));
  await mount();
  expect(screen.getAllByText('No conversations in primary')).toHaveLength(2);
  await poll();
  expect(screen.queryAllByText('No conversations in primary')).toHaveLength(0);
  const alert = screen.getAllByRole('alert')[0];
  expect(alert).toHaveClass('bg-muted', 'text-foreground', 'border-border');
  const button = screen.getAllByRole('button', { name: 'Retry conversations' })[0];
  button.focus(); expect(button).toHaveFocus();
  document.documentElement.removeAttribute('data-theme');
});

test.each([null, {}, { conversations: [] }, [null]])('malformed list %p cannot become a successful empty inbox', async payload => {
  mockList.mockResolvedValue({ data: payload });
  await mount();
  expect(screen.getAllByRole('alert')[0]).toHaveTextContent('Could not load conversations');
  expect(screen.queryAllByText('No conversations in primary')).toHaveLength(0);
});

test('same-scope transient refresh retains known conversations and enables Retry after failure', async () => {
  const pending = deferred();
  mockList.mockResolvedValueOnce({ data: [conversation('Known crew')] }).mockReturnValueOnce(pending.promise);
  await mount(); await poll();
  expect(screen.getAllByText('Known crew')).toHaveLength(2);
  expect(screen.getAllByRole('status')[0]).toHaveTextContent('Loading conversations');
  await settle(pending, failure(503), true);
  expect(screen.getAllByText('Known crew')).toHaveLength(2);
  expect(screen.getAllByRole('button', { name: 'Retry conversations' })[0]).toBeEnabled();
});

test.each([401, 403, 404])('HTTP %s clears retained conversations and counts instead of showing normal empty', async status => {
  mockList.mockResolvedValueOnce({ data: [conversation('Private crew')] }).mockRejectedValueOnce(failure(status));
  await mount(); await poll();
  expect(screen.queryByText('Private crew')).not.toBeInTheDocument();
  expect(screen.queryAllByText('No conversations in primary')).toHaveLength(0);
  expect(screen.getAllByRole('alert')[0]).toBeInTheDocument();
  expect(mockNavigate).not.toHaveBeenCalled(); // No new auth/navigation policy in the list layer.
});

test('a changed owner hides old content before settling and ignores its late success', async () => {
  const old = deferred(), next = deferred();
  mockList.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const view = await mount();
  mockUser = { id: 'owner-b', role: 'Surfer' };
  view.rerender(<MessagesPage />);
  expect(screen.queryAllByText('No conversations in primary')).toHaveLength(0);
  await settle(old, [conversation('Old identity')]);
  expect(screen.queryByText('Old identity')).not.toBeInTheDocument();
  expect(screen.getAllByRole('status')[0]).toHaveTextContent('Loading conversations');
  await settle(next, [conversation('Current identity')]);
  expect(screen.getAllByText('Current identity')).toHaveLength(2);
});

test('logout clears already-loaded rows immediately and no new list request is made', async () => {
  mockList.mockResolvedValue({ data: [conversation('Signed-in crew')] });
  const view = await mount(); const count = mockList.mock.calls.length;
  mockUser = null; view.rerender(<MessagesPage />); await flush();
  expect(screen.queryByText('Signed-in crew')).not.toBeInTheDocument();
  expect(mockList).toHaveBeenCalledTimes(count);
});

test('persona changes clear loaded rows, refetch, and keep polling the current scope', async () => {
  const next = deferred();
  mockList.mockResolvedValueOnce({ data: [conversation('Old persona')] }).mockReturnValueOnce(next.promise);
  const view = await mount();
  mockPersona = 'Photographer'; view.rerender(<MessagesPage />);
  expect(screen.queryByText('Old persona')).not.toBeInTheDocument();
  await settle(next, [conversation('New persona')]);
  mockList.mockResolvedValueOnce({ data: [conversation('Polled persona')] });
  await poll();
  expect(screen.getAllByText('Polled persona')).toHaveLength(2);
});

test('old folder failure cannot stop loading, replace content, or show an error in a new folder', async () => {
  const old = deferred(), next = deferred();
  mockList.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  await mount();
  fireEvent.click(screen.getAllByTestId('folder-requests')[0]);
  await settle(old, failure(503), true);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryAllByText('No conversations in requests')).toHaveLength(0);
  expect(screen.getAllByRole('status')[0]).toBeInTheDocument();
  await settle(next, [{ ...conversation('New request'), folder: 'requests' }]);
  expect(screen.getAllByText('New request')).toHaveLength(2);
});

test('latest request wins even when an aborted same-folder transport resolves last', async () => {
  const first = deferred(), second = deferred();
  mockList.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await mount(); const signal = mockList.mock.calls[0][1].signal;
  await poll(); expect(signal.aborted).toBe(true);
  await settle(second, [conversation('Newest result')]);
  await settle(first, [conversation('Stale result')]);
  expect(screen.getAllByText('Newest result')).toHaveLength(2);
  expect(screen.queryByText('Stale result')).not.toBeInTheDocument();
});

test('old request finally cannot stop a newer same-folder loading state', async () => {
  const first = deferred(), second = deferred();
  mockList.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await mount(); await poll(); await settle(first, failure(503), true);
  expect(screen.getAllByRole('status')[0]).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await settle(second, []);
  expect(screen.getAllByText('No conversations in primary')).toHaveLength(2);
});

test('retry remains disabled while its request is in flight and a successful [] clears the error', async () => {
  const pending = deferred();
  mockList.mockRejectedValueOnce(failure(503)).mockReturnValueOnce(pending.promise);
  await mount(); retry();
  expect(screen.getAllByRole('button', { name: 'Retry conversations' })[0]).toBeDisabled();
  await settle(pending, []);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getAllByText('No conversations in primary')).toHaveLength(2);
});

test('unmount aborts list requests and late rejections produce no list error or state write', async () => {
  const pending = deferred(); mockList.mockReturnValueOnce(pending.promise);
  const view = await mount(); const signal = mockList.mock.calls[0][1].signal;
  view.unmount(); expect(signal.aborted).toBe(true);
  await settle(pending, failure(503), true);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('family folder uses the parent endpoint and keeps failures distinct from an empty family inbox', async () => {
  mockUser = { id: 'parent-a', role: 'Grom Parent' }; mockPersona = 'Grom Parent';
  const view = await mount();
  apiClient.get.mockImplementation(url => url === '/messages/conversations/parent-a/family'
    ? Promise.reject(failure(503)) : Promise.resolve({ data: {} }));
  fireEvent.click(screen.getAllByTestId('folder-family')[0]); await flush();
  expect(apiClient.get).toHaveBeenCalledWith('/messages/conversations/parent-a/family', expect.objectContaining({ signal: expect.anything() }));
  expect(screen.queryAllByText('No conversations in family')).toHaveLength(0);
  expect(screen.getAllByRole('alert')[0]).toBeInTheDocument();
  view.unmount();
});

test('an owner change after success clears rows even if the next owner fails', async () => {
  mockList.mockResolvedValueOnce({ data: [conversation('Old owner rows')] }).mockRejectedValueOnce(failure(503));
  const view = await mount();
  mockUser = { id: 'owner-b', role: 'Surfer' }; view.rerender(<MessagesPage />); await flush();
  expect(screen.queryByText('Old owner rows')).not.toBeInTheDocument();
  expect(screen.getAllByRole('alert')[0]).toBeInTheDocument();
});

test('returning to the same folder after switching cannot resurrect the first request', async () => {
  const old = deferred(), intermediate = deferred(), latest = deferred();
  mockList.mockReturnValueOnce(old.promise).mockReturnValueOnce(intermediate.promise).mockReturnValueOnce(latest.promise);
  await mount();
  fireEvent.click(screen.getAllByTestId('folder-requests')[0]);
  fireEvent.click(screen.getAllByTestId('folder-primary')[0]);
  await settle(old, [conversation('First primary')]);
  await settle(intermediate, failure(503), true);
  expect(screen.queryByText('First primary')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await settle(latest, [conversation('Current primary')]);
  expect(screen.getAllByText('Current primary')).toHaveLength(2);
});

test('externally cancelled current transport does not manufacture a normal empty inbox', async () => {
  mockList.mockRejectedValueOnce({ name: 'CanceledError', code: 'ERR_CANCELED' });
  await mount();
  expect(screen.queryAllByText('No conversations in primary')).toHaveLength(0);
  expect(screen.getAllByRole('alert')[0]).toBeInTheDocument();
});

test('list recovery keeps search and compose controls and never performs a write by itself', async () => {
  mockList.mockRejectedValueOnce(failure(503)).mockResolvedValueOnce({ data: [conversation('North crew'), conversation('South crew')] });
  await mount(); retry(); await flush();
  const search = screen.getAllByRole('textbox', { name: 'Search conversations' })[0];
  fireEvent.change(search, { target: { value: 'North' } });
  expect(screen.getAllByText('North crew')).toHaveLength(2);
  expect(screen.queryByText('South crew')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Edit3' })).toHaveLength(2);
  expect(apiClient.post).not.toHaveBeenCalled();
});

test('retained rows still navigate to their existing conversation after a transient error', async () => {
  mockList.mockResolvedValueOnce({ data: [conversation('Crew thread')] }).mockRejectedValueOnce(failure(503));
  await mount(); await poll();
  fireEvent.click(screen.getAllByText('Crew thread')[0]);
  expect(mockNavigate).toHaveBeenCalledWith('/messages/Crew thread');
  expect(apiClient.post).not.toHaveBeenCalled();
});

test('StrictMode effect cleanup/remount still produces the current list and stops all older requests', async () => {
  mockList.mockResolvedValue({ data: [conversation('Strict crew')] });
  render(<React.StrictMode><MessagesPage /></React.StrictMode>); await flush();
  expect(screen.getAllByText('Strict crew')).toHaveLength(2);
  expect(mockList.mock.calls[0][1].signal.aborted).toBe(true);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('changed parent privileges invalidate same-user retained content', async () => {
  mockList.mockResolvedValueOnce({ data: [conversation('Before privilege change')] }).mockRejectedValueOnce(failure(503));
  const view = await mount();
  mockUser = { ...mockUser, is_grom_parent: true }; view.rerender(<MessagesPage />); await flush();
  expect(screen.queryByText('Before privilege change')).not.toBeInTheDocument();
  expect(screen.getAllByRole('alert')[0]).toBeInTheDocument();
});

test('an uncommitted suspended scope cannot disable refresh for the still-committed inbox', async () => {
  const suspended = deferred(), refreshed = deferred();
  let attemptedB = false;
  function Inbox({ scope }) {
    const list = useConversationList({ userId: 'owner-a', activeFolder: 'primary', ownerKey: scope });
    useEffect(() => { list.fetchConversations(); }, [list.fetchConversations]);
    if (scope === 'B') { attemptedB = true; throw suspended.promise; }
    return <section aria-label="Committed inbox">
      <button onClick={list.fetchConversations}>Refresh committed inbox</button>
      {list.conversations.map(c => <p key={c.id}>{c.other_user_name}</p>)}
      {list.error && <p role="alert">{list.error}</p>}
    </section>;
  }
  function Host() {
    const [scope, setScope] = useState('A');
    return <>
      <button onClick={() => startTransition(() => setScope('B'))}>Attempt suspended persona</button>
      <button onClick={() => setScope('A')}>Keep current persona</button>
      <Suspense fallback={<p>Suspended fallback</p>}><Inbox scope={scope} /></Suspense>
    </>;
  }
  mockList.mockResolvedValueOnce({ data: [conversation('Committed crew')] }).mockReturnValueOnce(refreshed.promise);
  render(<Host />); await flush();
  expect(screen.getByText('Committed crew')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Attempt suspended persona' })); await flush();
  expect(attemptedB).toBe(true);
  expect(screen.queryByText('Suspended fallback')).not.toBeInTheDocument();
  expect(screen.getByText('Committed crew')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh committed inbox' })); await flush();
  expect(mockList).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Keep current persona' })); await flush();
  expect(screen.getByText('Committed crew')).toBeInTheDocument();
  await settle(refreshed, failure(503), true);
  expect(screen.getByText('Committed crew')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load conversations');
});
