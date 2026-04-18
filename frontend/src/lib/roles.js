/**
 * roles.js — Canonical role constants and helper functions for Raw Surf frontend.
 *
 * Previously, role strings were hardcoded 156 times across components.
 * All new frontend code should import from here instead.
 *
 * Usage:
 *   import { ROLES, isPhotographer, canStream } from '../lib/roles';
 *   if (user.role === ROLES.APPROVED_PRO) { ... }
 *   if (isPhotographer(user)) { ... }
 */

// ── Role string constants ─────────────────────────────────────────────────────
export const ROLES = {
  // Surfer-side roles
  SURFER:       'Surfer',
  GROM:         'Grom',
  COMP_SURFER:  'Comp Surfer',
  PRO:          'Pro',

  // Photographer-side roles
  PHOTOGRAPHER: 'Photographer',
  APPROVED_PRO: 'Approved Pro',
  HOBBYIST:     'Hobbyist',

  // Parent / guardian
  GROM_PARENT: 'Grom Parent',

  // Business / commercial roles
  SCHOOL:      'School',
  COACH:       'Coach',
  RESORT:      'Resort',
  WAVE_POOL:   'Wave Pool',
  SHOP:        'Shop',
  SHAPER:      'Shaper',
  DESTINATION: 'Destination',
};

// ── Groupings ─────────────────────────────────────────────────────────────────

/** All surfer-type roles (not photographers or businesses) */
export const SURFER_ROLES = [ROLES.SURFER, ROLES.GROM, ROLES.COMP_SURFER, ROLES.PRO];

/** All photographer-type roles (can shoot and sell photos) */
export const PHOTOGRAPHER_ROLES = [ROLES.PHOTOGRAPHER, ROLES.APPROVED_PRO, ROLES.HOBBYIST];

/** Roles that are fully professional photographers (approved on platform) */
export const PRO_PHOTOGRAPHER_ROLES = [ROLES.PHOTOGRAPHER, ROLES.APPROVED_PRO];

/** Business account roles */
export const BUSINESS_ROLES = [
  ROLES.SCHOOL, ROLES.COACH, ROLES.RESORT,
  ROLES.WAVE_POOL, ROLES.SHOP, ROLES.SHAPER, ROLES.DESTINATION,
];

// ── Helper predicates ─────────────────────────────────────────────────────────

/**
 * Returns true if the user is any type of photographer (including Hobbyist).
 * Use this to show photographer-specific UI elements.
 */
export const isPhotographer = (user) =>
  PHOTOGRAPHER_ROLES.includes(user?.role);

/**
 * Returns true if the user is a professional / approved photographer.
 * Use this for features only available to credentialed photographers.
 */
export const isProPhotographer = (user) =>
  PRO_PHOTOGRAPHER_ROLES.includes(user?.role);

/**
 * Returns true if the user is an Approved Pro (highest photographer tier).
 */
export const isApprovedPro = (user) =>
  user?.role === ROLES.APPROVED_PRO || user?.is_approved_pro === true;

/**
 * Returns true if the user is a surfer-type role (not a photographer or business).
 */
export const isSurfer = (user) =>
  SURFER_ROLES.includes(user?.role);

/**
 * Returns true if the user is a business account.
 */
export const isBusiness = (user) =>
  BUSINESS_ROLES.includes(user?.role);

/**
 * Returns true if the user is a Grom (minor account).
 */
export const isGrom = (user) =>
  user?.role === ROLES.GROM;

/**
 * Returns true if the user has admin privileges.
 */
export const isAdmin = (user) =>
  user?.is_admin === true;

/**
 * Returns true if the user can stream (go live with video).
 * Hobbyists can stream but only in non-pro zones.
 */
export const canStream = (user) =>
  PHOTOGRAPHER_ROLES.includes(user?.role);

/**
 * Returns true if the user can access on-demand dispatch/request flow.
 */
export const canRequestPhotographer = (user) =>
  isSurfer(user) || isBusiness(user);

/**
 * Returns a user-friendly display name for a role string.
 */
export const getRoleDisplayName = (role) => {
  const displayNames = {
    [ROLES.SURFER]:       'Surfer',
    [ROLES.GROM]:         'Grom',
    [ROLES.COMP_SURFER]:  'Competitive Surfer',
    [ROLES.PRO]:          'Pro Surfer',
    [ROLES.PHOTOGRAPHER]: 'Photographer',
    [ROLES.APPROVED_PRO]: 'Approved Pro Photographer',
    [ROLES.HOBBYIST]:     'Hobbyist Photographer',
    [ROLES.GROM_PARENT]:  'Grom Parent',
    [ROLES.SCHOOL]:       'Surf School',
    [ROLES.COACH]:        'Coach',
    [ROLES.RESORT]:       'Resort',
    [ROLES.WAVE_POOL]:    'Wave Pool',
    [ROLES.SHOP]:         'Shop',
    [ROLES.SHAPER]:       'Shaper',
    [ROLES.DESTINATION]:  'Destination',
  };
  return displayNames[role] || role || 'Unknown';
};
