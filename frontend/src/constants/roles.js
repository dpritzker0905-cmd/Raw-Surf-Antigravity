/**
 * roles.js G Centralized role and persona constants
 *
 * G SINGLE SOURCE OF TRUTH for all role string literals.
 * Values MUST match the backend RoleEnum values exactly.
 *
 * Usage:
 *   import { ROLES, ROLE_SETS, isProLevel, isBusinessRole } from '../constants/roles';
 *   if (user.role === ROLES.PHOTOGRAPHER) { ... }
 *   if (ROLE_SETS.PRO_LEVEL.includes(user.role)) { ... }
 */

// GGG Individual Role Constants GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG
// These values MUST match backend/models.py RoleEnum exactly

export const ROLES = Object.freeze({
  // Surfer-side roles
  SURFER: 'Surfer',
  GROM: 'Grom',
  COMP_SURFER: 'Comp Surfer',
  PRO: 'Pro',

  // Photographer-side roles
  PHOTOGRAPHER: 'Photographer',
  APPROVED_PRO: 'Approved Pro',
  HOBBYIST: 'Hobbyist',

  // Parent / guardian
  GROM_PARENT: 'Grom Parent',

  // Business / commercial roles (match backend RoleEnum values)
  SCHOOL: 'School',
  COACH: 'Coach',
  RESORT: 'Resort',
  WAVE_POOL: 'Wave Pool',
  SHOP: 'Shop',
  SHAPER: 'Shaper',
  DESTINATION: 'Destination',

 // Admin / God Mode G internal use only
  GOD: 'God',
});

// GGG Role Set Groupings GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG

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

export const ROLE_SETS = Object.freeze({
  /**
   * Roles with access to the Pro Lounge.
   * Note: Comp Surfer intentionally excluded.
   */
  PRO_LEVEL: [ROLES.PRO, ROLES.GOD],

  /**
 * Business / commercial roles G access to The Channel.
   */
  BUSINESS: [
    ROLES.PHOTOGRAPHER,
    ROLES.APPROVED_PRO,
    ROLES.HOBBYIST,
    ROLES.SHOP,
    ROLES.SCHOOL,
    ROLES.SHAPER,
    ROLES.RESORT,
    ROLES.COACH,
    ROLES.WAVE_POOL,
    ROLES.DESTINATION,
  ],

  /**
   * Roles that can shoot/publish photos in the marketplace.
   */
  PHOTOGRAPHERS: [ROLES.PHOTOGRAPHER, ROLES.APPROVED_PRO],

  /**
 * Youth-level roles G restricted access, parental controls apply.
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
    ROLES.SCHOOL,
    ROLES.SHAPER,
    ROLES.RESORT,
    ROLES.COACH,
    ROLES.WAVE_POOL,
    ROLES.DESTINATION,
  ],
});

// GGG Role Check Helpers GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG

/** Returns true if the role has access to the Pro Lounge. */
export const isProLevel = (role) => ROLE_SETS.PRO_LEVEL.includes(role);

/** Returns true if the role is a commercial/business role. */
export const isBusinessRole = (role) => ROLE_SETS.BUSINESS.includes(role);

/** Returns true if the role is a photographer-class role. */
export const isPhotographerRole = (role) => ROLE_SETS.PHOTOGRAPHERS.includes(role);

/** Returns true if the role is youth-gated (Grom or Grom Parent). */
export const isYouthRole = (role) => ROLE_SETS.YOUTH.includes(role);

// GGG User-object helpers (used by lib/roles.js consumers) GGGGGGGGGGGGGGGGGGGGG

/** Returns true if the user is any type of photographer (including Hobbyist). */
export const isPhotographer = (user) => PHOTOGRAPHER_ROLES.includes(user?.role);

/** Returns true if the user is a professional / approved photographer. */
export const isProPhotographer = (user) => PRO_PHOTOGRAPHER_ROLES.includes(user?.role);

/** Returns true if the user is an Approved Pro (highest photographer tier). */
export const isApprovedPro = (user) =>
  user?.role === ROLES.APPROVED_PRO || user?.is_approved_pro === true;

/** Returns true if the user is a surfer-type role. */
export const isSurfer = (user) => SURFER_ROLES.includes(user?.role);

/** Returns true if the user is a business account. */
export const isBusiness = (user) => BUSINESS_ROLES.includes(user?.role);

/** Returns true if the user is a Grom (minor account). */
export const isGrom = (user) => user?.role === ROLES.GROM;

/** Returns true if the user has admin privileges. */
export const isAdmin = (user) => user?.is_admin === true;

/** Returns true if the user can stream (go live with video). */
export const canStream = (user) => PHOTOGRAPHER_ROLES.includes(user?.role);

/** Returns true if the user can access on-demand dispatch/request flow. */
export const canRequestPhotographer = (user) => isSurfer(user) || isBusiness(user);

/** Returns a user-friendly display name for a role string. */
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
