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
 * Helper to check if a target keyword is matched strictly as a whole token/word.
 * Segments are delimited by start/end of string or non-alphanumeric characters.
 */
function matchStrict(str, target) {
  if (!str || !target) return false;
  const escaped = target.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const regex = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
  return regex.test(str);
}

/**
 * Parses a weather product ID string to confidently determine the model and layer.
 * Returns { model: string | null, layer: string | null }
 */
export function parseWeatherProductId(productId) {
  if (!productId || typeof productId !== 'string') {
    return { model: null, layer: null };
  }

  // Extract base filename to prevent directory paths or URL parameters from polluting token matches
  let filename = productId;
  const queryIndex = filename.indexOf('?');
  if (queryIndex !== -1) {
    filename = filename.substring(0, queryIndex);
  }
  const hashIndex = filename.indexOf('#');
  if (hashIndex !== -1) {
    filename = filename.substring(0, hashIndex);
  }
  const lastSlash = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
  if (lastSlash !== -1) {
    filename = filename.substring(lastSlash + 1);
  }

  const lowerPid = filename.toLowerCase();
  const conformedPid = lowerPid.replace(/[-\s]/g, '_');

  // 1. Model Parsing (Strict matching, mutually exclusive validation)
  let model = null;
  const isGfs = matchStrict(conformedPid, 'gfs') || matchStrict(conformedPid, 'ncep_gfswave');
  const isEuro = matchStrict(conformedPid, 'euro') || matchStrict(conformedPid, 'copernicus') || matchStrict(conformedPid, 'ecmwf');
  const isIcon = matchStrict(conformedPid, 'icon') || matchStrict(conformedPid, 'dwd');

  // Fail closed if multiple models match, or none matches
  const matchedModelCount = (isGfs ? 1 : 0) + (isEuro ? 1 : 0) + (isIcon ? 1 : 0);
  if (matchedModelCount === 1) {
    if (isGfs) model = 'GFS';
    else if (isEuro) model = 'EURO';
    else if (isIcon) model = 'ICON';
  }

  // 2. Layer Parsing (Strict matching, mutually exclusive validation)
  let layer = null;
  const hasWindWaves = matchStrict(conformedPid, 'wind_waves') || matchStrict(conformedPid, 'wind_wave');
  const hasSwell2 = matchStrict(conformedPid, 'swell_2') || matchStrict(conformedPid, 'secondary_swell');
  const hasSwell1 = matchStrict(conformedPid, 'swell_1') || matchStrict(conformedPid, 'swell_wave') || matchStrict(conformedPid, 'swell');
  const hasWaves = matchStrict(conformedPid, 'waves') || matchStrict(conformedPid, 'wave_height') || matchStrict(conformedPid, 'wave_direction') || matchStrict(conformedPid, 'wave_period');
  const hasWind = matchStrict(conformedPid, 'wind');
  const hasPressure = matchStrict(conformedPid, 'pressure') || matchStrict(conformedPid, 'msl');
  const hasPrecip = matchStrict(conformedPid, 'precipitation') || matchStrict(conformedPid, 'precip') || matchStrict(conformedPid, 'snow');

  const matchesWindWaves = hasWindWaves;
  const matchesSwell2 = hasSwell2;
  const matchesSwell1 = hasSwell1 && !hasSwell2;
  const matchesWaves = hasWaves && !hasWindWaves && !hasSwell1 && !hasSwell2;
  const matchesWind = hasWind && !hasWindWaves;
  const matchesPressure = hasPressure;
  const matchesPrecip = hasPrecip;

  // Fail closed if multiple layers match, or none matches
  const matchedLayerCount =
    (matchesWindWaves ? 1 : 0) +
    (matchesSwell2 ? 1 : 0) +
    (matchesSwell1 ? 1 : 0) +
    (matchesWaves ? 1 : 0) +
    (matchesWind ? 1 : 0) +
    (matchesPressure ? 1 : 0) +
    (matchesPrecip ? 1 : 0);

  if (matchedLayerCount === 1) {
    if (matchesWindWaves) layer = 'wind_waves';
    else if (matchesSwell2) layer = 'swell_2';
    else if (matchesSwell1) layer = 'swell_1';
    else if (matchesWaves) layer = 'waves';
    else if (matchesWind) layer = 'wind';
    else if (matchesPressure) layer = 'pressure';
    else if (matchesPrecip) layer = 'precipitation';
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
