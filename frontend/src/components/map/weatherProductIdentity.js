/**
 * weatherProductIdentity.js
 * Centralized utility for parsing and validating weather/marine product IDs.
 * Ensures layer matching is mutually exclusive.
 */

/**
 * Normalizes layer names to canonical forms.
 */
export function normalizeWeatherLayer(layer) {
  if (!layer || typeof layer !== 'string') return null;
  const l = layer.toLowerCase().trim();
  if (l === 'rain') return 'precipitation';
  if (l === 'pressure_msl') return 'pressure';
  if (l === 'wind_speed' || l === 'wind_speed_10m') return 'wind';
  if (l === 'swell' || l === 'primary_swell' || l === 'swell 1') return 'swell_1';
  if (l === 'swell2' || l === 'swell 2' || l === 'secondary_swell') return 'swell_2';
  if (l === 'wind waves' || l === 'wind wave') return 'wind_waves';
  if (l === 'waves_combined' || l === 'combined_waves') return 'waves';
  return l;
}

/**
 * Parses a weather product ID string to confidently determine the model and layer.
 * Returns { model: string | null, layer: string | null }
 */
export function parseWeatherProductId(productId) {
  if (!productId || typeof productId !== 'string') {
    return { model: null, layer: null };
  }
  const lowerPid = productId.toLowerCase();

  // 1. Model Parsing
  let model = null;
  if (lowerPid.includes('gfs') || lowerPid.includes('ncep_gfswave')) {
    model = 'GFS';
  } else if (lowerPid.includes('euro') || lowerPid.includes('copernicus') || lowerPid.includes('ecmwf')) {
    model = 'EURO';
  } else if (lowerPid.includes('icon') || lowerPid.includes('dwd')) {
    model = 'ICON';
  }

  // 2. Layer Parsing (Check more specific layers before generic layers)
  let layer = null;
  if (lowerPid.includes('wind_waves') || lowerPid.includes('wind_wave')) {
    layer = 'wind_waves';
  } else if (lowerPid.includes('swell_2') || lowerPid.includes('secondary_swell')) {
    layer = 'swell_2';
  } else if (lowerPid.includes('swell_1') || lowerPid.includes('swell_wave')) {
    layer = 'swell_1';
  } else if (
    (lowerPid.includes('waves') || lowerPid.includes('wave_height') || lowerPid.includes('wave_direction') || lowerPid.includes('wave_period')) &&
    !lowerPid.includes('wind_waves') &&
    !lowerPid.includes('wind_wave') &&
    !lowerPid.includes('swell_1') &&
    !lowerPid.includes('swell_2') &&
    !lowerPid.includes('swell_wave') &&
    !lowerPid.includes('secondary_swell')
  ) {
    layer = 'waves';
  } else if (
    lowerPid.includes('wind') &&
    !lowerPid.includes('wind_waves') &&
    !lowerPid.includes('wind_wave')
  ) {
    layer = 'wind';
  } else if (lowerPid.includes('pressure') || lowerPid.includes('msl')) {
    layer = 'pressure';
  } else if (lowerPid.includes('precipitation') || lowerPid.includes('precip') || lowerPid.includes('snow')) {
    layer = 'precipitation';
  }

  return { model, layer };
}

/**
 * Checks if a product ID matches the requested model and layer using mutually exclusive rules.
 * If model or layer cannot be confidently parsed, fails closed and returns false.
 */
export function isProductMatching(productId, model, layer) {
  if (!productId || typeof productId !== 'string') return false;
  if (!model || typeof model !== 'string') return false;
  if (!layer || typeof layer !== 'string') return false;

  const parsed = parseWeatherProductId(productId);
  if (!parsed.model || !parsed.layer) {
    return false; // Fail closed
  }

  const normRequestedLayer = normalizeWeatherLayer(layer);
  return parsed.model === model.toUpperCase() && parsed.layer === normRequestedLayer;
}
