import observerDeviceId from './deviceId';

describe('observer device id (T1 P2)', () => {
  beforeEach(() => window.localStorage.clear());

  test('is a random id the server accepts, stable across calls', () => {
    const id = observerDeviceId();
    expect(id).toMatch(/^[0-9a-fA-F-]{32,36}$/);
    expect(observerDeviceId()).toBe(id);
  });

  test('replaces a malformed stored value', () => {
    window.localStorage.setItem('raw-surf-observer-device', 'not-an-id');
    expect(observerDeviceId()).toMatch(/^[0-9a-fA-F-]{32,36}$/);
  });
});
