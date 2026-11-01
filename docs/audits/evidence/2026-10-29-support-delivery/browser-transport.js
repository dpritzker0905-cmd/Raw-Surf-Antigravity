const A = '44444444-4444-4444-8444-444444444444';
const B = '55555555-5555-4555-8555-555555555555';
const OWNER = '11111111-1111-4111-8111-111111111111';
let tickets = [A, B].map((id, index) => ({ id, ticket_number: `TKT-0123456789ABCDE${index}`,
  subject: `Fictional request ${index ? 'B' : 'A'}`, description: `Fictional details ${index ? 'B' : 'A'}`,
  status: 'open', messages: [{ id: 'public', from_support: true, message: 'Public support response' }] }));
const requests = [];
const created = new Map();
const held = new Map();
window.supportFixture = { requests, failReply: false, failCreate: false, currentUser: null,
  holdDetail: id => held.set(id, []),
  releaseDetail: id => { const callbacks = held.get(id); held.delete(id); callbacks.forEach(resolve => resolve({ data: { ...tickets.find(row => row.id === id) } })); },
};
export default {
  get(url) {
    requests.push({ method: 'get', url });
    if (url.startsWith('/support/tickets?')) return Promise.resolve({ data: { tickets: window.supportFixture.currentUser === OWNER ? tickets : [], total: window.supportFixture.currentUser === OWNER ? tickets.length : 0 } });
    const id = url.split('/').pop();
    if (window.supportFixture.currentUser !== OWNER || !tickets.some(row => row.id === id)) return Promise.reject(new Error('Fictional404'));
    if (held.has(id)) return new Promise(resolve => held.get(id).push(resolve));
    return Promise.resolve({ data: { ...tickets.find(row => row.id === id) } });
  },
  post(url, body) {
    requests.push({ method: 'post', url, body });
    if (url.endsWith('/messages')) {
      const id = url.split('/')[3]; const ticket = tickets.find(row => row.id === id);
      if (!ticket.messages.some(row => row.id === body.client_message_id)) ticket.messages.push({ id: body.client_message_id, message: body.message, from_support: false });
      if (window.supportFixture.failReply) { window.supportFixture.failReply = false; return Promise.reject(new Error('Fictional lost acknowledgement')); }
      return Promise.resolve({ data: { success: true, message_id: body.client_message_id } });
    }
    if (!created.has(body.client_request_id)) {
      const row = { id: '66666666-6666-4666-8666-666666666666', ticket_number: 'TKT-ABCDEF0123456789', subject: body.subject,
        description: body.description, status: 'open', messages: [] };
      created.set(body.client_request_id, row.id); tickets = [row, ...tickets];
    }
    if (window.supportFixture.failCreate) { window.supportFixture.failCreate = false; return Promise.reject(new Error('Fictional lost acknowledgement')); }
    return Promise.resolve({ data: { success: true, ticket_id: created.get(body.client_request_id) } });
  },
};
