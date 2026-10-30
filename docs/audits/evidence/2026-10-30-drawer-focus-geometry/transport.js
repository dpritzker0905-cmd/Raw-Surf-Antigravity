// In-memory synthetic responses: the integration owner separately tests real backend I/O.
export const BACKEND_URL = '';
export const API_BASE = '/api';
const OWNER = '11111111-1111-4111-8111-111111111111';
const TICKET = '44444444-4444-4444-8444-444444444444';
const MESSAGE = '66666666-6666-4666-8666-666666666666';
const notices = [{ id: '77777777-7777-4777-8777-777777777777', type: 'support_reply', title: 'New support reply',
  body: 'Open your support ticket to read the reply.', is_read: false, created_at: '2026-10-29T12:00:00Z',
  data: JSON.stringify({ ticket_id: TICKET, message_id: MESSAGE, recipient_id: OWNER }) }];
const state = window.shellFixture = { requests: [], notices, accepted: false };
async function request(method, url, body) {
  state.requests.push({ method, url, body });
  const path = url.split('?')[0];
  if (path.includes('/compliance/tos-status/')) return { data: { acknowledged: state.accepted } };
  if (path === '/compliance/tos-content/current') return { data: { sections: [] } };
  if (path === '/compliance/acknowledge-tos') { state.accepted = true; return { data: {} }; }
  if (path === '/support/tickets' && method === 'get') return { data: { total: 1, tickets: [ticket()] } };
  if (path === `/support/tickets/${TICKET}`) {
    if (state.currentUser !== OWNER) throw new Error('Synthetic wrong owner 404');
    return { data: { ...ticket(), messages: [{ id: MESSAGE, message: 'Synthetic public reply', from_support: true }] } };
  }
  if (path.startsWith('/notifications/') && path.endsWith('/unread-count')) return { data: { unread_count: notices.filter(n => !n.is_read).length } };
  if (path.startsWith('/notifications/') && path.endsWith('/read') && method === 'post') {
    const notice = notices.find(n => path.includes(n.id)); if (notice) notice.is_read = true; return { data: {} };
  }
  if (path.startsWith('/notifications/') && method === 'get') return { data: notices.map(n => ({ ...n })) };
  if (path.startsWith('/messages/unread-counts/')) return { data: { total: 0 } };
  if (path.startsWith('/profiles/') || path.startsWith('/users/')) return { data: {} };
  return { data: {} }; // unrelated pricing/navigation surfaces, recorded explicitly
}
function ticket() { return { id: TICKET, ticket_number: 'TEST-SHELL', subject: 'Synthetic shell request',
  description: 'Synthetic conversation details', status: 'open', created_at: '2026-10-29T11:00:00Z' }; }
export default { get: (url, config) => request('get', url, config), post: (url, body) => request('post', url, body),
  put: (url, body) => request('put', url, body), delete: url => request('delete', url) };
