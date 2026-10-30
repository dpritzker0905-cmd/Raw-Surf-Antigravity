let tickets = Array.from({ length: 123 }, (_, index) => {
  const id = index < 2 ? ['A', 'B'][index] : `T${index + 1}`;
  return {
    id, ticket_number: `TEST-${id}`, subject: index < 2 ? `${id} request` : `Request ${index + 1}`,
    user_name: `Fictional ${id}`, user_email: 'fixture@example.invalid',
    priority: index % 3 ? 'medium' : 'high', status: index % 2 ? 'closed' : 'open', created_at: '2026-10-29T12:00:00Z',
  };
});
const detail = id => ({
  ...tickets.find(ticket => ticket.id === id),
  description: `Details for ${id}`, category: 'other', user: { id: `fictional-${id}` }, messages: [],
});
const holds = new Set();
const pending = new Map();
const requests = [];
const finish = (method, id, failed = false) => {
  const key = `${method}:${id}`;
  const request = pending.get(key);
  if (!request) throw new Error(`No pending fixture request: ${key}`);
  pending.delete(key);
  if (failed) request.reject(new Error('Fictional transport failure'));
  else request.resolve({ data: request.data });
};
window.supportFixture = {
  requests,
  hold: (method, id) => holds.add(`${method}:${id}`),
  finish,
  holdPage: offset => holds.add(`get:page-${offset}`),
  finishPage: (offset, failed = false) => finish('get', `page-${offset}`, failed),
  truncate: count => { tickets = tickets.slice(0, count); },
};
const request = (method, url, body) => {
  requests.push({ method, url, body });
  if (url.includes('metrics?')) return Promise.resolve({ data: null });
  let id = url.split('/')[4];
  let data = method === 'get' ? detail(id) : { success: true };
  if (url.includes('tickets?')) {
    const query = new URL(url, window.location.origin).searchParams;
    const offset = Number(query.get('offset') || 0), limit = Number(query.get('limit') || 50);
    const filtered = tickets.filter(ticket =>
      (!query.get('status') || ticket.status === query.get('status'))
      && (!query.get('priority') || ticket.priority === query.get('priority'))
      && (!query.get('search') || `${ticket.subject} ${ticket.ticket_number}`.toLowerCase().includes(query.get('search').toLowerCase())));
    data = { tickets: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit };
    id = `page-${offset}`;
  }
  const key = `${method}:${id}`;
  if (holds.delete(key)) return new Promise((resolve, reject) => pending.set(key, { resolve, reject, data }));
  return Promise.resolve({ data });
};
export default {
  get: url => request('get', url),
  post: (url, body) => request('post', url, body),
  put: (url, body) => request('put', url, body),
};
