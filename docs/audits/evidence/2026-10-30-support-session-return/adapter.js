import apiClient from '@actual-client';
const OWNER = '11111111-1111-4111-8111-111111111111';
const ID = 'abcdef01-2345-4789-abcd-ef0123456789';
const row = { id: ID, subject: 'Synthetic restored support ticket', ticket_number: 'TEST-RETURN',
  description: 'Synthetic restored conversation', messages: [], status: 'open' };
window.returnFixture = {};
export function configureAdapter() {
  apiClient.defaults.adapter = async config => {
    let status = 200, data = {};
    if (config.url === '/auth/login') {
      if (sessionStorage.getItem('return-mfa') === 'true') data = { mfa_required: true, methods: ['totp'], challenge_token: crypto.randomUUID() };
      else { sessionStorage.setItem('return-valid', 'true'); data = { id: OWNER, role: 'Grom' }; }
    } else if (config.url === '/auth/login/mfa') {
      sessionStorage.setItem('return-valid', 'true'); data = { id: OWNER, role: 'Grom' };
    } else if (config.url.startsWith('/support/tickets')) {
      if (sessionStorage.getItem('return-valid') !== 'true') status = 401;
      else {
        const ownsTicket = JSON.parse(localStorage.getItem('raw-surf-user') || 'null')?.id === OWNER;
        if (config.url.includes('?')) data = { total: ownsTicket ? 1 : 0, tickets: ownsTicket ? [row] : [] };
        else if (!ownsTicket) status = 404;
        else data = row;
      }
    }
    const log = JSON.parse(sessionStorage.getItem('return-api-log') || '[]');
    log.push({ url: config.url, method: config.method, status }); sessionStorage.setItem('return-api-log', JSON.stringify(log));
    const response = { status, statusText: 'Synthetic adapter', data, headers: {}, config };
    if (status >= 400) throw Object.assign(new Error('Synthetic session response'), { config, response });
    return response;
  };
}
