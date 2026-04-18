/**
 * roles.js — Centralized role and persona constants
 *
 * Single source of truth for the role string literals used throughout
 * the app. Previously these were magic strings scattered across 400+ occurrences.
 *
 * Usage:
 *   import { ROLES, ROLE_SETS, isProLevel, isBusinessRole } from '../constants/roles';
 *   if (user.role === ROLES.PHOTOGRAPHER) { ... }
 *   if (ROLE_SETS.PRO_LEVEL.includes(user.role)) { ... }
 */

// ─── Individual Role Constants ────────────────────────────────────────────────

export const ROLES = Object.freeze({
  /** Default role for all new users */
  SURFER: 'Surfer',

  /** Water sports hobbyist — content consumer + occasional participant */
  HOBBYIST: 'Hobbyist',

  /** Professional surf photographer */
  PHOTOGRAPHER: 'Photographer',

  /** Approved / verified professional surfer */
  APPROVED_PRO: 'Approved Pro',

  /** Top-tier verified pro surfer (Pro Lounge access) */
  PRO: 'Pro',

  /** Competitive surfer (events, heats) */
  COMP_SURFER: 'Comp Surfer',

  /** Youth surfer */
  GROM: 'Grom',

  /** Parent / guardian of a Grom */
  GROM_PARENT: 'Grom Parent',

  /** Surf shop operator */
  SHOP: 'Shop',

  /** Surf school operator */
  SURF_SCHOOL: 'Surf School',

  /** Surfboard shaper / craftsperson */
  SHAPER: 'Shaper',

  /** Resort / accommodation business */
  RESORT: 'Resort',

  /** Admin / God Mode — internal use only */
  GOD: 'God',
});

// ─── Role Set Groupings ───────────────────────────────────────────────────────

export const ROLE_SETS = Object.freeze({
  /**
   * Roles with access to the Pro Lounge.
   * Note: Comp Surfer intentionally excluded.
   */
  PRO_LEVEL: [ROLES.PRO, ROLES.GOD],

  /**
   * Business / commercial roles — access to The Channel.
   */
  BUSINESS: [
    ROLES.PHOTOGRAPHER,
    ROLES.APPROVED_PRO,
    ROLES.HOBBYIST,
    ROLES.SHOP,
    ROLES.SURF_SCHOOL,
    ROLES.SHAPER,
    ROLES.RESORT,
  ],

  /**
   * Roles that can shoot/publish photos in the marketplace.
   */
  PHOTOGRAPHERS: [ROLES.PHOTOGRAPHER, ROLES.APPROVED_PRO],

  /**
   * Youth-level roles — restricted access, parental controls apply.
   */
  YOUTH: [ROLES.GROM, ROLES.GROM_PARENT],

  /**
   * All public-facing roles (everything except internal GOD).
   */
  ALL_PUBLIC: [
    ROLES.SURFER,
    ROLES.HOBBYIST,
    ROLES.PHOTOGRAPHER,
    ROLES.APPROVED_PRO,
    ROLES.PRO,
    ROLES.COMP_SURFER,
    ROLES.GROM,
    ROLES.GROM_PARENT,
    ROLES.SHOP,
    ROLES.SURF_SCHOOL,
    ROLES.SHAPER,
    ROLES.RESORT,
  ],
});

// ─── Role Check Helpers ───────────────────────────────────────────────────────

/**
 * Returns true if the role has access to the Pro Lounge.
 * @param {string} role
 * @returns {boolean}
 */
export const isProLevel = (role) => ROLE_SETS.PRO_LEVEL.includes(role);

/**
 * Returns true if the role is a commercial/business role.
 * @param {string} role
 * @returns {boolean}
 */
export const isBusinessRole = (role) => ROLE_SETS.BUSINESS.includes(role);

/**
 * Returns true if the role is a photographer-class role.
 * @param {string} role
 * @returns {boolean}
 */
export const isPhotographerRole = (role) => ROLE_SETS.PHOTOGRAPHERS.includes(role);

/**
 * Returns true if the role is youth-gated (Grom or Grom Parent).
 * @param {string} role
 * @returns {boolean}
 */
export const isYouthRole = (role) => ROLE_SETS.YOUTH.includes(role);
