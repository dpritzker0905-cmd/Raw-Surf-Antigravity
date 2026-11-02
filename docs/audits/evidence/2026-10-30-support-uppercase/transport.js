const ID = 'abcdef01-2345-4789-abcd-ef0123456789';
const OWNER = '11111111-1111-4111-8111-111111111111';
const row = { id: ID, ticket_number: 'TEST-CASE', subject: 'Synthetic case request', description: 'Synthetic case details', status: 'open' };
const messages = [];
const state = window.uppercaseFixture = { requests: [], currentUser: null, failReply: false };
export default {
  async get(url) {
    state.requests.push({ method: 'get', url });
    if (url.includes('/compliance/')) return { data: {} };
    if (url.includes('?')) return { data: { tickets: state.currentUser === OWNER ? [row] : [], total: state.currentUser === OWNER ? 1 : 0 } };
    if (url !== `/support/tickets/${ID}` || state.currentUser !== OWNER) throw new Error('Synthetic404');
    return { data: { ...row, messages: [...messages] } };
  },
  async post(url, body) {
    state.requests.push({ method: 'post', url, body });
    if (url !== `/support/tickets/${ID}/messages` || state.currentUser !== OWNER) throw new Error('Synthetic404');
    const old = messages.find(message => message.id === body.client_message_id);
    if (old && old.message !== body.message) throw new Error('Synthetic409');
    if (!old) messages.push({ id: body.client_message_id, message: body.message, from_support: false });
    if (state.failReply) { state.failReply = false; throw new Error('Synthetic lost acknowledgement'); }
    return { data: { success: true, duplicate: Boolean(old) } };
  },
};
