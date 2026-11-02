// Synthetic boundaries only: account/theme contexts, notification API/count refresh, Sheet frame.
import React, { createContext, useContext } from 'react';

export const accountA = 'fedcba98-7654-3210-fedc-ba9876543210';
export const accountB = '00000000-0000-0000-0000-000000000002';
export const ticketId = 'abcdef01-2345-6789-abcd-ef0123456789';
const messageId = '12345678-abcd-ef01-2345-6789abcdef01';
const params = new URLSearchParams(window.location.search);
const Auth = createContext({ user: null });
const Theme = createContext({ theme: 'dark' });
export const AuthProvider = Auth.Provider;
export const ThemeProvider = Theme.Provider;
export const useAuth = () => useContext(Auth);
export const useTheme = () => useContext(Theme);

const makeRow = (owner, suffix) => ({
  id: `synthetic-notification-${suffix}`, type: params.get('legacy') === 'true' ? 'mention' : 'support_reply',
  title: `Support reply for fixture ${suffix}`,
  body: 'Synthetic local notification; no support message content.', is_read: params.get('read') === 'true',
  created_at: '2026-10-29T15:00:00Z',
  data: JSON.stringify(params.get('legacy') === 'true' ? { post_id: 'synthetic-post' }
    : { ticket_id: ticketId, message_id: messageId, recipient_id: params.get('invalid') === 'true' ? accountB : owner }),
});

export const fixture = window.__supportFixture = {
  rows: { [accountA]: [makeRow(accountA, 'A')], [accountB]: [makeRow(accountB, 'B')] },
  requests: [], gates: [], failures: {}, badgeRefreshes: 0, closes: 0, countUpdates: 0,
  navigations: [], owner: accountA, open: true, mounted: true, ready: false,
};
fixture.hold = operation => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  fixture.gates.push({ operation, promise, resolve, used: false, released: false });
};
fixture.release = operation => {
  const gate = fixture.gates.find(item => item.operation === operation && item.used && !item.released);
  if (!gate) throw new Error('No used synthetic gate');
  gate.released = true;
  gate.resolve();
};
fixture.failNext = operation => { fixture.failures[operation] = (fixture.failures[operation] || 0) + 1; };
const perform = async (operation, user, result) => {
  const request = { operation, user, settled: false, failed: false };
  fixture.requests.push(request);
  const gate = fixture.gates.find(item => item.operation === operation && !item.used);
  if (gate) gate.used = true;
  try {
    if (gate) await gate.promise;
    if (fixture.failures[operation]) {
      fixture.failures[operation] -= 1;
      throw new Error('Synthetic notification failure');
    }
    return typeof result === 'function' ? result() : result;
  } catch (error) { request.failed = true; throw error; }
  finally { request.settled = true; }
};
export const getNotifications = userId => perform('getNotifications', userId, {
  data: (fixture.rows[userId] || []).map(row => ({ ...row })),
});
export const getUnreadCount = userId => perform('getUnreadCount', userId, {
  data: { unread_count: (fixture.rows[userId] || []).filter(row => !row.is_read).length },
});
export const markRead = id => {
  const owner = fixture.owner;
  return perform('markRead', owner, () => {
    const row = (fixture.rows[owner] || []).find(item => item.id === id);
    if (row) row.is_read = true;
    return { data: {} };
  });
};
export const markAllRead = userId => perform('markAllRead', userId, () => {
  for (const row of fixture.rows[userId] || []) row.is_read = true;
  return { data: {} };
});
export const refreshUnreadCounts = () => { fixture.badgeRefreshes += 1; };

// No portal, focus trap, animation, or Sheet styling is simulated by this frame.
export const Sheet = ({ open, children }) => open ? React.createElement('section', { 'data-sheet-frame': true }, children) : null;
export const SheetContent = ({ children }) => React.createElement('div', null, children);
export const SheetHeader = ({ children }) => React.createElement('header', null, children);
export const SheetTitle = ({ children }) => React.createElement('h2', null, children);
