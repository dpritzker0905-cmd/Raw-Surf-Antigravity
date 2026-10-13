import {
  REDIRECT_GUARD_MS,
  clearSessionRejected,
  markSessionRejected,
  sessionRejectedRecently,
  wasSessionRejected,
} from './sessionRejection';

const KEY = 'raw-surf-session-rejected-at';

describe('sessionRejection', () => {
  beforeEach(() => sessionStorage.clear());

  it('is unset in a fresh tab', () => {
    expect(wasSessionRejected()).toBe(false);
    expect(sessionRejectedRecently()).toBe(false);
  });

  it('a mark lives in sessionStorage, so it survives the hard load that follows it', () => {
    markSessionRejected(1_000_000);
    expect(sessionStorage.getItem(KEY)).toBe('1000000');
    expect(wasSessionRejected()).toBe(true);
  });

  it('counts as recent for 30 s, then only as "was rejected"', () => {
    expect(REDIRECT_GUARD_MS).toBe(30000);
    markSessionRejected(1_000_000);
    expect(sessionRejectedRecently(1_000_000 + 29_999)).toBe(true);
    expect(sessionRejectedRecently(1_000_000 + 30_000)).toBe(false);
    expect(wasSessionRejected()).toBe(true);
  });

  it('a mark from the future (the clock moved back) still counts as recent: fail toward not navigating', () => {
    markSessionRejected(2_000_000);
    expect(sessionRejectedRecently(1_000_000)).toBe(true);
  });

  it('clearing removes it', () => {
    markSessionRejected(1_000_000);
    clearSessionRejected();
    expect(wasSessionRejected()).toBe(false);
  });

  it('ignores a value it did not write', () => {
    sessionStorage.setItem(KEY, 'not-a-time');
    expect(wasSessionRejected()).toBe(false);
  });

  it('never throws when storage is unavailable (blocked site data, sandboxed frame)', () => {
    const spies = ['getItem', 'setItem', 'removeItem'].map((method) => jest
      .spyOn(Storage.prototype, method)
      .mockImplementation(() => { throw new Error('SecurityError'); }));
    try {
      expect(() => markSessionRejected()).not.toThrow();
      expect(wasSessionRejected()).toBe(false);
      expect(sessionRejectedRecently()).toBe(false);
      expect(() => clearSessionRejected()).not.toThrow();
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
});
