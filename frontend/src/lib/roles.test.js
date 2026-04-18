/**
 * roles.test.js — Tests for the centralized role constants.
 *
 * Verifies that role strings match expected values, role sets contain
 * the right roles, and helper functions return correct results.
 */
import {
  ROLES,
  ROLE_SETS,
  isProLevel,
  isBusinessRole,
  isPhotographerRole,
  isYouthRole,
} from '../constants/roles';

describe('ROLES constants', () => {
  test('each role is a non-empty string', () => {
    for (const [key, value] of Object.entries(ROLES)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  test('role values match expected strings', () => {
    expect(ROLES.SURFER).toBe('Surfer');
    expect(ROLES.PHOTOGRAPHER).toBe('Photographer');
    expect(ROLES.APPROVED_PRO).toBe('Approved Pro');
    expect(ROLES.PRO).toBe('Pro');
    expect(ROLES.HOBBYIST).toBe('Hobbyist');
    expect(ROLES.GROM).toBe('Grom');
    expect(ROLES.GROM_PARENT).toBe('Grom Parent');
    expect(ROLES.COMP_SURFER).toBe('Comp Surfer');
    expect(ROLES.SHOP).toBe('Shop');
    expect(ROLES.SURF_SCHOOL).toBe('Surf School');
    expect(ROLES.SHAPER).toBe('Shaper');
    expect(ROLES.RESORT).toBe('Resort');
    expect(ROLES.GOD).toBe('God');
  });

  test('ROLES object is frozen (immutable)', () => {
    expect(Object.isFrozen(ROLES)).toBe(true);
  });
});

describe('ROLE_SETS', () => {
  test('PRO_LEVEL contains Pro and God', () => {
    expect(ROLE_SETS.PRO_LEVEL).toContain(ROLES.PRO);
    expect(ROLE_SETS.PRO_LEVEL).toContain(ROLES.GOD);
    expect(ROLE_SETS.PRO_LEVEL).not.toContain(ROLES.COMP_SURFER);
    expect(ROLE_SETS.PRO_LEVEL).not.toContain(ROLES.SURFER);
  });

  test('BUSINESS contains all commercial roles', () => {
    expect(ROLE_SETS.BUSINESS).toContain(ROLES.PHOTOGRAPHER);
    expect(ROLE_SETS.BUSINESS).toContain(ROLES.APPROVED_PRO);
    expect(ROLE_SETS.BUSINESS).toContain(ROLES.HOBBYIST);
    expect(ROLE_SETS.BUSINESS).toContain(ROLES.SHOP);
    expect(ROLE_SETS.BUSINESS).toContain(ROLES.SURF_SCHOOL);
    expect(ROLE_SETS.BUSINESS).toContain(ROLES.SHAPER);
    expect(ROLE_SETS.BUSINESS).toContain(ROLES.RESORT);
    // Should NOT include non-business roles
    expect(ROLE_SETS.BUSINESS).not.toContain(ROLES.SURFER);
    expect(ROLE_SETS.BUSINESS).not.toContain(ROLES.PRO);
    expect(ROLE_SETS.BUSINESS).not.toContain(ROLES.GROM);
  });

  test('PHOTOGRAPHERS contains Photographer and Approved Pro', () => {
    expect(ROLE_SETS.PHOTOGRAPHERS).toContain(ROLES.PHOTOGRAPHER);
    expect(ROLE_SETS.PHOTOGRAPHERS).toContain(ROLES.APPROVED_PRO);
    expect(ROLE_SETS.PHOTOGRAPHERS).not.toContain(ROLES.SURFER);
  });

  test('YOUTH contains Grom and Grom Parent', () => {
    expect(ROLE_SETS.YOUTH).toContain(ROLES.GROM);
    expect(ROLE_SETS.YOUTH).toContain(ROLES.GROM_PARENT);
    expect(ROLE_SETS.YOUTH).not.toContain(ROLES.SURFER);
  });

  test('ALL_PUBLIC does not contain GOD', () => {
    expect(ROLE_SETS.ALL_PUBLIC).not.toContain(ROLES.GOD);
  });
});

describe('isProLevel()', () => {
  test('returns true for Pro', () => expect(isProLevel(ROLES.PRO)).toBe(true));
  test('returns true for God', () => expect(isProLevel(ROLES.GOD)).toBe(true));
  test('returns false for Comp Surfer', () => expect(isProLevel(ROLES.COMP_SURFER)).toBe(false));
  test('returns false for Surfer', () => expect(isProLevel(ROLES.SURFER)).toBe(false));
  test('returns false for Photographer', () => expect(isProLevel(ROLES.PHOTOGRAPHER)).toBe(false));
  test('returns false for null', () => expect(isProLevel(null)).toBe(false));
});

describe('isBusinessRole()', () => {
  test('returns true for Photographer', () => expect(isBusinessRole(ROLES.PHOTOGRAPHER)).toBe(true));
  test('returns true for Shop', () => expect(isBusinessRole(ROLES.SHOP)).toBe(true));
  test('returns true for Surf School', () => expect(isBusinessRole(ROLES.SURF_SCHOOL)).toBe(true));
  test('returns false for Surfer', () => expect(isBusinessRole(ROLES.SURFER)).toBe(false));
  test('returns false for Pro', () => expect(isBusinessRole(ROLES.PRO)).toBe(false));
  test('returns false for Grom', () => expect(isBusinessRole(ROLES.GROM)).toBe(false));
});

describe('isPhotographerRole()', () => {
  test('returns true for Photographer', () => expect(isPhotographerRole(ROLES.PHOTOGRAPHER)).toBe(true));
  test('returns true for Approved Pro', () => expect(isPhotographerRole(ROLES.APPROVED_PRO)).toBe(true));
  test('returns false for Hobbyist', () => expect(isPhotographerRole(ROLES.HOBBYIST)).toBe(false));
  test('returns false for Surfer', () => expect(isPhotographerRole(ROLES.SURFER)).toBe(false));
});

describe('isYouthRole()', () => {
  test('returns true for Grom', () => expect(isYouthRole(ROLES.GROM)).toBe(true));
  test('returns true for Grom Parent', () => expect(isYouthRole(ROLES.GROM_PARENT)).toBe(true));
  test('returns false for Surfer', () => expect(isYouthRole(ROLES.SURFER)).toBe(false));
  test('returns false for Pro', () => expect(isYouthRole(ROLES.PRO)).toBe(false));
});
