/**
 * roles.test.js — Unit tests for frontend role constants and helper predicates.
 *
 * These are pure functions with no React dependencies, so they run completely
 * in Node without any DOM. Fast, zero-flakiness tests.
 */

import {
  ROLES,
  SURFER_ROLES,
  PHOTOGRAPHER_ROLES,
  PRO_PHOTOGRAPHER_ROLES,
  BUSINESS_ROLES,
  isPhotographer,
  isProPhotographer,
  isApprovedPro,
  isSurfer,
  isBusiness,
  isGrom,
  isAdmin,
  canStream,
  canRequestPhotographer,
  getRoleDisplayName,
} from '../lib/roles';


// ─── ROLES constant ───────────────────────────────────────────────────────────

describe('ROLES constant', () => {
  test('contains expected string values', () => {
    expect(ROLES.SURFER).toBe('Surfer');
    expect(ROLES.GROM).toBe('Grom');
    expect(ROLES.PHOTOGRAPHER).toBe('Photographer');
    expect(ROLES.APPROVED_PRO).toBe('Approved Pro');
    expect(ROLES.HOBBYIST).toBe('Hobbyist');
    expect(ROLES.GROM_PARENT).toBe('Grom Parent');
  });
});


// ─── isPhotographer ───────────────────────────────────────────────────────────

describe('isPhotographer()', () => {
  test.each(PHOTOGRAPHER_ROLES)(
    'returns true for role "%s"',
    (role) => {
      expect(isPhotographer({ role })).toBe(true);
    }
  );

  test.each(SURFER_ROLES)(
    'returns false for surfer role "%s"',
    (role) => {
      expect(isPhotographer({ role })).toBe(false);
    }
  );

  test('returns false for undefined user', () => {
    expect(isPhotographer(undefined)).toBe(false);
    expect(isPhotographer(null)).toBe(false);
    expect(isPhotographer({})).toBe(false);
  });
});


// ─── isProPhotographer ────────────────────────────────────────────────────────

describe('isProPhotographer()', () => {
  test.each(PRO_PHOTOGRAPHER_ROLES)(
    'returns true for pro role "%s"',
    (role) => {
      expect(isProPhotographer({ role })).toBe(true);
    }
  );

  test('returns false for Hobbyist', () => {
    expect(isProPhotographer({ role: ROLES.HOBBYIST })).toBe(false);
  });
});


// ─── isApprovedPro ────────────────────────────────────────────────────────────

describe('isApprovedPro()', () => {
  test('returns true when role is Approved Pro', () => {
    expect(isApprovedPro({ role: ROLES.APPROVED_PRO })).toBe(true);
  });

  test('returns true when is_approved_pro flag is true regardless of role', () => {
    expect(isApprovedPro({ role: ROLES.PHOTOGRAPHER, is_approved_pro: true })).toBe(true);
  });

  test('returns false for non-approved photographers', () => {
    expect(isApprovedPro({ role: ROLES.PHOTOGRAPHER })).toBe(false);
    expect(isApprovedPro({ role: ROLES.HOBBYIST })).toBe(false);
  });
});


// ─── isSurfer ─────────────────────────────────────────────────────────────────

describe('isSurfer()', () => {
  test.each(SURFER_ROLES)(
    'returns true for surfer role "%s"',
    (role) => {
      expect(isSurfer({ role })).toBe(true);
    }
  );

  test('returns false for photographers', () => {
    expect(isSurfer({ role: ROLES.PHOTOGRAPHER })).toBe(false);
  });
});


// ─── isBusiness ───────────────────────────────────────────────────────────────

describe('isBusiness()', () => {
  test.each(BUSINESS_ROLES)(
    'returns true for business role "%s"',
    (role) => {
      expect(isBusiness({ role })).toBe(true);
    }
  );

  test('returns false for surfers', () => {
    expect(isBusiness({ role: ROLES.SURFER })).toBe(false);
  });
});


// ─── isGrom ───────────────────────────────────────────────────────────────────

describe('isGrom()', () => {
  test('returns true for Grom role', () => {
    expect(isGrom({ role: ROLES.GROM })).toBe(true);
  });

  test('returns false for other roles', () => {
    expect(isGrom({ role: ROLES.SURFER })).toBe(false);
    expect(isGrom({ role: ROLES.PHOTOGRAPHER })).toBe(false);
  });
});


// ─── isAdmin ──────────────────────────────────────────────────────────────────

describe('isAdmin()', () => {
  test('returns true when is_admin is true', () => {
    expect(isAdmin({ role: ROLES.SURFER, is_admin: true })).toBe(true);
  });

  test('returns false when is_admin is false or missing', () => {
    expect(isAdmin({ role: ROLES.SURFER })).toBe(false);
    expect(isAdmin({ role: ROLES.SURFER, is_admin: false })).toBe(false);
  });
});


// ─── canStream ────────────────────────────────────────────────────────────────

describe('canStream()', () => {
  test('all photographer roles can stream', () => {
    PHOTOGRAPHER_ROLES.forEach(role => {
      expect(canStream({ role })).toBe(true);
    });
  });

  test('surfers cannot stream', () => {
    expect(canStream({ role: ROLES.SURFER })).toBe(false);
  });
});


// ─── canRequestPhotographer ───────────────────────────────────────────────────

describe('canRequestPhotographer()', () => {
  test('surfers can request a photographer', () => {
    expect(canRequestPhotographer({ role: ROLES.SURFER })).toBe(true);
  });

  test('business accounts can request a photographer', () => {
    expect(canRequestPhotographer({ role: ROLES.SCHOOL })).toBe(true);
  });

  test('photographers cannot request themselves', () => {
    expect(canRequestPhotographer({ role: ROLES.PHOTOGRAPHER })).toBe(false);
  });
});


// ─── getRoleDisplayName ───────────────────────────────────────────────────────

describe('getRoleDisplayName()', () => {
  test('returns correct display name for known roles', () => {
    expect(getRoleDisplayName(ROLES.SURFER)).toBe('Surfer');
    expect(getRoleDisplayName(ROLES.APPROVED_PRO)).toBe('Approved Pro Photographer');
    expect(getRoleDisplayName(ROLES.COMP_SURFER)).toBe('Competitive Surfer');
    expect(getRoleDisplayName(ROLES.SCHOOL)).toBe('Surf School');
  });

  test('returns role string for unknown roles', () => {
    expect(getRoleDisplayName('UnknownRole')).toBe('UnknownRole');
  });

  test('returns "Unknown" for null/undefined', () => {
    expect(getRoleDisplayName(null)).toBe('Unknown');
    expect(getRoleDisplayName(undefined)).toBe('Unknown');
  });
});
