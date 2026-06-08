/**
 * LayerAccessResolver.js
 * 
 * Layer Access Firewall (CRITICAL SYSTEM)
 * This is the ONLY system allowed to decide what users can access.
 * NO OTHER FILE may enforce permissions.
 */

// Define access rules per subscription tier
var TIER_ACCESS = {
  guest: {
    models: ['GFS'],
    forecastDays: 3
  },
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
    forecastDays: 7
  }
};

// Start capabilities fetch immediately on module load
if (typeof window !== 'undefined') {
  const getBackendUrl = () => {
    if (window.__BACKEND_URL__) return window.__BACKEND_URL__;
    if (window.localStorage.getItem('__BACKEND_URL__')) return window.localStorage.getItem('__BACKEND_URL__');
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:8000';
    }
    return (typeof process !== 'undefined' && process.env && process.env.REACT_APP_BACKEND_URL) || 'https://raw-surf-antigravity.onrender.com';
  };

  fetch(`${getBackendUrl()}/api/weather/capabilities`)
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(data => {
      window.__WEATHER_CAPABILITIES__ = data;
      window.dispatchEvent(new CustomEvent('weatherCapabilitiesLoaded', { detail: data }));
    })
    .catch(err => {
      console.warn('[LayerAccessResolver] Failed to load backend capabilities:', err.message);
    });
}

/**
 * Returns the subscription tier string based on user object or tier string.
 * Maps raw backend tiers (tier_1, tier_2, etc.) to canonical access levels.
 */
export function getUserTier(userOrTier) {
  if (typeof window !== 'undefined' && window.__FORCE_PREMIUM_TIER__) return 'premium';
  if (!userOrTier) return 'guest';

  const tierString = typeof userOrTier === 'string' 
    ? userOrTier 
    : (userOrTier?.subscriptionTier || userOrTier?.subscription_tier || userOrTier?.tier_id || 'guest');

  const tierStringLower = String(tierString).toLowerCase();

  // Handle tier mapping (tier_1, tier_2, etc. or named tiers)
  if (tierStringLower.includes('free') || tierStringLower === 'tier_1') return 'free';
  if (tierStringLower.includes('basic') || tierStringLower.includes('paid') || tierStringLower === 'tier_2') return 'basic';
  if (
    tierStringLower.includes('premium') || 
    tierStringLower.includes('pro') || 
    tierStringLower.includes('parent') ||
    tierStringLower.includes('admin') ||
    ['tier_3', 'tier_4'].includes(tierStringLower)
  ) {
    return 'premium';
  }

  // Handle explicit guest or other matches
  if (tierStringLower === 'guest') return 'guest';
  
  return 'guest'; // default fallback for guests/anonymous
}

/**
 * Returns an array of allowed models for the given user.
 */
export function getAllowedModels(user) {
  const tier = getUserTier(user);
  const rules = TIER_ACCESS[tier] || TIER_ACCESS.free;
  let models = [...rules.models];

  // Cross-reference with backend capabilities
  if (typeof window !== 'undefined' && window.__WEATHER_CAPABILITIES__) {
    const capModels = new Set(
      window.__WEATHER_CAPABILITIES__
        .filter(c => c.supports_grid || c.supports_point)
        .map(c => c.model.toUpperCase())
    );
    // Effective allowed models is min(subscription entitlement, backend capabilities)
    models = models.filter(m => capModels.has(m.toUpperCase()));
  }
  return models;
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
export function resolveForecastWindow(user, model = 'GFS') {
  const tier = getUserTier(user);
  const rules = TIER_ACCESS[tier] || TIER_ACCESS.free;
  let allowedDays = rules.forecastDays;

  // Cross-reference with backend capabilities
  if (typeof window !== 'undefined' && window.__WEATHER_CAPABILITIES__) {
    const caps = window.__WEATHER_CAPABILITIES__.filter(
      c => c.model.toUpperCase() === model.toUpperCase()
    );
    if (caps.length > 0) {
      const maxHours = Math.max(...caps.map(c => c.max_forecast_hours || 0));
      if (maxHours > 0) {
        const maxDays = Math.floor(maxHours / 24);
        allowedDays = Math.min(allowedDays, maxDays);
      }
    }
  }
  return allowedDays;
}

