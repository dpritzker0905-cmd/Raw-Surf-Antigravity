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
    forecastDays: 14
  }
};

// Start capabilities fetch immediately on module load
if (typeof window !== 'undefined') {
  const getBackendUrl = () => {
    if (window.__BACKEND_URL__) return window.__BACKEND_URL__;
    if (window.localStorage.getItem('__BACKEND_URL__')) return window.localStorage.getItem('__BACKEND_URL__');
    // No hardcoded localhost→:8000 branch (removed 2026-07-02): it outranked REACT_APP_BACKEND_URL and
    // pointed capabilities at a dead local backend whenever the localStorage override was absent — the
    // third instance of the dead-:8000 trap (see .env.local note). Local-backend dev opts in via
    // localStorage.setItem('__BACKEND_URL__','http://127.0.0.1:8000'), same as every other API path.
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
export function resolveForecastWindow(user, model = 'GFS', activeLayer = null) {
  const tier = getUserTier(user);
  const rules = TIER_ACCESS[tier] || TIER_ACCESS.free;
  let allowedDays = rules.forecastDays;

  // Cross-reference with backend capabilities
  if (typeof window !== 'undefined' && window.__WEATHER_CAPABILITIES__) {
    let caps = window.__WEATHER_CAPABILITIES__.filter(
      c => c.model.toUpperCase() === model.toUpperCase()
    );
    if (activeLayer) {
      // ⭐ OPT-IN (2026-08-10, R11-11 #6), DEFAULT OFF = byte-identical.
      // The frontend calls this layer `rain`; the backend capability rows call the same data
      // `precipitation`. Matching by NAME therefore finds nothing, the domain fallback finds
      // nothing (domains are only marine|weather|wind), and `caps` silently keeps the WHOLE
      // model's rows -- so the max runs across every layer and ICON's marine 336 h extension
      // becomes the cap for ICON RAIN, whose own row says 168 h. The scrubber offers 14 days of
      // a layer that carries 7.
      // ⚠️ FIXING IT REDUCES WHAT USERS CAN REACH (14 d -> 7 d), which is a product decision, so
      // it stays owner-gated: set `window.__RAW_LAYER_CAP_ALIAS__ = true`.
      // ⚠️ SCOPE, measured: this fixes `rain` ONLY. `temperature` and `water_temp` have NO
      // capability row at all, so there is no per-layer cap to apply to them and the model-wide
      // max is the only available answer -- an alias would be inventing a bound.
      // Composes with the undisclosed STALE FRAME (modelHorizons/staleHour): this lets a user ASK
      // for hours the layer lacks; the tile lane then paints the last frame under the requested
      // hour. Pinned in LayerAccessResolver.layerKeys.test.js.
      const CAP_LAYER_ALIAS = { rain: 'precipitation' };
      const aliasOn = typeof window !== 'undefined'
        && window.__RAW_LAYER_CAP_ALIAS__ === true;
      const rawLayer = activeLayer.toLowerCase();
      const layerLower = (aliasOn && CAP_LAYER_ALIAS[rawLayer]) || rawLayer;
      let layerCaps = caps.filter(c => c.layer.toLowerCase() === layerLower);
      if (layerCaps.length === 0) {
        layerCaps = caps.filter(c => c.domain.toLowerCase() === layerLower);
      }
      if (layerCaps.length > 0) {
        caps = layerCaps;
      }
    }
    if (caps.length > 0) {
      // Use max_forecast_hours so the scrubber exposes the model's FULL advertised window,
      // including ICON marine's estimated extension (native 168h + extension -> 336h/14d).
      // The extension is a real capability; far-hour failures are a fetch-reliability problem
      // (the ICON extended blend's GFS/EURO sub-fetches get aborted during the rapid
      // toggle/scrub storm), handled separately — NOT a reason to hide the 14-day window.
      const maxHours = Math.max(...caps.map(c => c.max_forecast_hours || 0));
      if (maxHours > 0) {
        const maxDays = Math.floor(maxHours / 24);
        allowedDays = Math.min(allowedDays, maxDays);
      }
    }
  }
  return allowedDays;
}

