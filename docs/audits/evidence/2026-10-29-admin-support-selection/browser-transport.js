const tickets = ['A', 'B'].map(id => ({
  id, ticket_number: `TEST-${id}`, subject: `${id} request`,
  user_name: `Fictional ${id}`, user_email: `${id.toLowerCase()}@example.invalid`,
  priority: 'medium', status: 'open', created_at: '2026-10-29T12:00:00Z',
}));
const detail = id => ({
  ...tickets.find(ticket => ticket.id === id),
  description: `Details for ${id}`, category: 'other', user: { id: `fictional-${id}` }, messages: [],
});
const holds = new Set();
const pending = new Map();
const requests = [];
window.supportFixture = {
  requests,
  hold: (method, id) => holds.add(`${method}:${id}`),
  finish(method, id, failed = false) {
    const key = `${method}:${id}`;
    const request = pending.get(key);
    if (!request) throw new Error(`No pending fixture request: ${key}`);
    pending.delete(key);
    if (failed) request.reject(new Error('Fictional transport failure'));
    else request.resolve({ data: method === 'get' ? detail(id) : { success: true } });
  },
};
const request = (method, url, body) => {
  requests.push({ method, url, body });
  if (url.includes('tickets?')) return Promise.resolve({ data: { tickets, total: tickets.length } });
  if (url.includes('metrics?')) return Promise.resolve({ data: null });
  const id = url.split('/')[4];
  const key = `${method}:${id}`;
  if (holds.delete(key)) return new Promise((resolve, reject) => pending.set(key, { resolve, reject }));
  return Promise.resolve({ data: method === 'get' ? detail(id) : { success: true } });
};
export default {
  get: url => request('get', url),
  post: (url, body) => request('post', url, body),
  put: (url, body) => request('put', url, body),
};
