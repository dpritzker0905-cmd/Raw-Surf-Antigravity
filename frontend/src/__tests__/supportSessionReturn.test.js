// Real Axios interceptors/session guards, in-memory refusal adapter and synthetic location only.
const mockToast = jest.fn();
jest.mock('sonner', () => ({ toast: { error: (...args) => mockToast(...args) } }));
const realLocation = window.location;
const ID = 'abcdef01-2345-4789-abcd-ef0123456789';
let navigations;

function locationAt(path) {
  const url = new URL(path, 'https://fixture.invalid');
  delete window.location;
  window.location = { origin: url.origin, pathname: url.pathname, search: url.search, hash: url.hash,
    get href() { return url.href; }, set href(value) { navigations.push(value); } };
}

function load() {
  let client, mark;
  jest.isolateModules(() => {
    client = require('../lib/apiClient').default;
    mark = require('../lib/sessionRejection').markSessionRejected;
  });
  client.defaults.adapter = config => {
    const error = new Error('Synthetic refused session');
    error.config = config; error.response = { status: 401, data: {}, config, headers: {} };
    return Promise.reject(error);
  };
  return { client, mark };
}

const refuse = client => client.get('/support/tickets?limit=50').catch(() => {});
const destination = path => `/auth?tab=login&redirect=${encodeURIComponent(path)}`;

beforeEach(() => {
  jest.useFakeTimers(); localStorage.clear(); sessionStorage.clear(); navigations = []; mockToast.mockClear();
  localStorage.setItem('raw-surf-user', JSON.stringify({ id: 'synthetic-owner', role: 'Surfer' }));
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
afterAll(() => { window.location = realLocation; });

test.each(['/support', `/support/tickets/${ID}`, `/support/tickets/${ID.toUpperCase()}?discard=fixture#discard`])(
  'first refusal preserves only safe canonical support path: %s', async path => {
    locationAt(path); const { client } = load(); await refuse(client);
    jest.advanceTimersByTime(2000);
    expect(navigations).toEqual([destination(new URL(path, 'https://fixture.invalid').pathname.toLowerCase())]);
    expect(localStorage.getItem('raw-surf-user')).toBeNull();
    expect(sessionStorage.getItem('raw-surf-session-rejected-at')).not.toBeNull();
  },
);

test('capture the safe support destination before the redirect delay', async () => {
  locationAt(`/support/tickets/${ID}`); const { client } = load(); await refuse(client);
  locationAt('/feed'); jest.advanceTimersByTime(2000);
  expect(navigations).toEqual([destination(`/support/tickets/${ID}`)]);
});

test.each(['/support', `/support/tickets/${ID.toUpperCase()}?discard=fixture#discard`])(
  'repeat-refusal manual sign-in preserves support path: %s', async path => {
    locationAt(path); const { client, mark } = load(); mark();
    await Promise.all([refuse(client), refuse(client)]); jest.advanceTimersByTime(5000);
    expect(navigations).toEqual([]); expect(localStorage.getItem('raw-surf-user')).toBeNull();
    const prompts = mockToast.mock.calls.filter(([, options]) => options?.action);
    expect(prompts).toHaveLength(1);
    const expected = new URL(path, 'https://fixture.invalid').pathname.toLowerCase();
    locationAt('/feed'); prompts[0][1].action.onClick();
    expect(navigations).toEqual([destination(expected)]);
  },
);

test('parallel refusals schedule one hard redirect, even after a later success', async () => {
  locationAt(`/support/tickets/${ID}`); const { client } = load();
  await Promise.all(Array.from({ length: 4 }, () => refuse(client)));
  jest.advanceTimersByTime(2000); expect(navigations).toEqual([destination(`/support/tickets/${ID}`)]);
  const bad = client.defaults.adapter;
  client.defaults.adapter = config => Promise.resolve({ status: 200, data: {}, headers: {}, config });
  await client.get('/support/tickets'); client.defaults.adapter = bad; await refuse(client);
  jest.advanceTimersByTime(5000); expect(navigations).toHaveLength(1);
});

test.each(['/feed', '/messages', '/support/', '/support/tickets/not-a-uuid', `/support/tickets/${ID}/extra`,
  '/support/tickets/abcdef0123454789abcdef0123456789', '/support/%2F%2E%2E/auth'])('unsupported return retains generic sign-in: %s', async path => {
  locationAt(path); const { client } = load(); await refuse(client); jest.advanceTimersByTime(2000);
  expect(navigations).toEqual(['/auth?tab=login']);
});

test.each(['/auth?tab=login', '/admin/support'])('current auth/admin page suppression retained: %s', async path => {
  locationAt(path); const { client } = load(); await refuse(client); jest.advanceTimersByTime(5000);
  expect(navigations).toEqual([]); expect(localStorage.getItem('raw-surf-user')).not.toBeNull();
});

test.each(['/auth/login', '/auth/signup', '/admin/support/tickets'])('auth/admin API exclusion retained: %s', async request => {
  locationAt('/support'); const { client } = load(); await client.post(request, {}).catch(() => {});
  jest.advanceTimersByTime(5000); expect(navigations).toEqual([]);
});

test.each([403, 429, 503])('non-401 errors never use return navigation: %s', async status => {
  locationAt('/support'); const { client } = load();
  client.defaults.adapter = config => Promise.reject(Object.assign(new Error('Synthetic status'), { config, response: { status } }));
  await refuse(client); jest.advanceTimersByTime(5000); expect(navigations).toEqual([]);
});
