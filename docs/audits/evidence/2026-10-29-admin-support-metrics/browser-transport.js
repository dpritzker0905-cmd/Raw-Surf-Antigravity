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
let metricData = { open_tickets: 7, resolved_tickets: 4, avg_first_response_hours: 1.5, avg_resolution_hours: 8.25, sla_breached_count: 2 };
let heldMetrics = 0;
const pendingMetrics = [];
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
  setMetrics: patch => { metricData = { ...metricData, ...patch }; },
  holdMetrics: () => { heldMetrics += 1; },
  finishMetrics(index = 0, patch = {}, failed = false) {
    const request = pendingMetrics.splice(index, 1)[0];
    if (!request) throw new Error('No held metrics request');
    if (failed) request.reject(new Error('Fictional metrics failure'));
    else request.resolve({ data: { ...request.data, ...patch } });
  },
};
const request = (method, url, body) => {
  requests.push({ method, url, body });
  if (url.includes('metrics?')) {
    const data = { ...metricData };
    if (heldMetrics > 0) {
      heldMetrics -= 1;
      return new Promise((resolve, reject) => pendingMetrics.push({ resolve, reject, data }));
    }
    return Promise.resolve({ data });
  }
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
