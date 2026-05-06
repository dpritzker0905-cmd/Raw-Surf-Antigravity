/**
 * lib/roles.js — Re-export shim
 *
 * ⚠️  DEPRECATED: This file now re-exports everything from the canonical
 * source at `../constants/roles.js`. All new code should import directly
 * from `../constants/roles` instead.
 *
 * This shim exists solely to avoid breaking the ~5 files that currently
 * import from '../lib/roles'. Once those are migrated, remove this file.
 */
export {
  ROLES,
  ROLE_SETS,
  SURFER_ROLES,
  PHOTOGRAPHER_ROLES,
  PRO_PHOTOGRAPHER_ROLES,
  BUSINESS_ROLES,
  isProLevel,
  isBusinessRole,
  isPhotographerRole,
  isYouthRole,
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
} from '../constants/roles';
