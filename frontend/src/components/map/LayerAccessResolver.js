/**
 * LayerAccessResolver.js
 * 
 * Layer Access Firewall (CRITICAL SYSTEM)
 * This is the ONLY system allowed to decide what users can access.
 * NO OTHER FILE may enforce permissions.
 */

// Define access rules per subscription tier
var TIER_ACCESS = {
  free: {
    models: ['GFS'],
    forecastDays: 3
  },
  basic: {
    models: ['GFS', 'EURO', 'ICON'],
    forecastDays: 7
  },
  premium: {
    models: ['GFS', 'EURO', 'ICON'],
    forecastDays: 14
  }
};

/**
 * Returns the subscription tier string based on user object or tier string.
 * Maps raw backend tiers (tier_1, tier_2, etc.) to canonical access levels.
 */
export function getUserTier(userOrTier) {
  const tierString = typeof userOrTier === 'string' 
    ? userOrTier 
    : (userOrTier?.subscriptionTier || userOrTier?.subscription_tier || userOrTier?.tier_id || 'tier_1');

  // Handle tier_id format (tier_1, tier_2, tier_3)
  if (tierString === 'tier_1') return 'free';
  if (tierString === 'tier_2') return 'basic';
  if (['tier_3', 'tier_4', 'admin'].includes(tierString)) return 'premium';

  // Handle subscription_tier name format (free, basic, premium)
  if (['free', 'basic', 'premium'].includes(tierString)) return tierString;
  
  return 'free'; // default fallback
}

/**
 * Returns an array of allowed models for the given user.
 */
export function getAllowedModels(user) {
  const tier = getUserTier(user);
  const rules = TIER_ACCESS[tier] || TIER_ACCESS.free;
  return rules.models;
}

/**
 * Validates if the user has access to a specific model.
 * If not, FAILS FAST and throws an error.
 */
export function validateModelAccess(model, user) {
  const allowed = getAllowedModels(user);
  if (!allowed.includes(model)) {
    throw new Error(`LAYER_ACCESS_DENIED: Model ${model} not permitted for tier ${getUserTier(user)}`);
  }
  return true;
}

/**
 * Returns the number of allowed forecast days for the given user.
 */
export function resolveForecastWindow(user) {
  const tier = getUserTier(user);
  const rules = TIER_ACCESS[tier] || TIER_ACCESS.free;
  return rules.forecastDays;
}
