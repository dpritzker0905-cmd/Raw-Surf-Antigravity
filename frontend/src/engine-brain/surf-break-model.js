/*
====================================================
 Raw Surf OS Surf Break Model
 SURF-SPECIFIC INTELLIGENCE LAYER
====================================================

This is the competitive moat what makes Raw Surf
NOT Windy / NOT Ventusky.

PURE FUNCTIONAL MODEL ONLY
- NO engine coupling
- NO rendering
- NO DOM
- var/function only (TDZ-immune)
====================================================
*/

/**
 * Compute break quality score from surf conditions.
 * Returns 0-1 where higher = better surf.
 *
 * Factors:
 * - Swell/wind direction alignment (40%)
 * - Wave height sufficiency (30%)
 * - Bathymetry factor (20%)
 * - Wind speed penalty (20%, subtracted)
 *
 * @param {{
 *   waveHeight: number,
 *   swellDirection: number,
 *   windDirection: number,
 *   windSpeed: number,
 *   tide?: number,
 *   bathymetryFactor?: number
 * }} conditions
 * @returns {number} 0-1 quality score
 */
function computeBreakQuality(conditions) {
  var c = conditions;

 // Swell/wind alignment offshore wind = better
  var dirDiff = Math.abs(c.swellDirection - c.windDirection);
  if (dirDiff > 180) dirDiff = 360 - dirDiff;
  var swellScore = Math.max(0, 1 - dirDiff / 180);

 // Height peaks at 1-3m, caps at 1.0
  var heightScore = Math.min(c.waveHeight / 3, 1);

 // Wind penalty stronger wind = worse (onshore degrades)
  var windPenalty = Math.min(c.windSpeed / 30, 1);

 // Bathymetry reef/point breaks score higher
  var bathy = c.bathymetryFactor !== undefined ? c.bathymetryFactor : 0.5;

 // Tide influence (optional modulates height effectiveness)
  var tideMod = 1.0;
  if (c.tide !== undefined) {
    // Mid-tide is generally best for most breaks
    tideMod = 1 - Math.abs(c.tide - 0.5) * 0.3;
  }

  var raw = (swellScore * 0.4 + heightScore * 0.3 * tideMod + bathy * 0.2) - (windPenalty * 0.2);
  return Math.max(0, Math.min(1, raw));
}

/**
 * Classify break quality into human-readable category.
 *
 * @param {number} score - 0-1 quality score
 * @returns {string} 'poor' | 'ok' | 'good' | 'epic'
 */
function classifyBreak(score) {
  if (score > 0.8) return 'epic';
  if (score > 0.6) return 'good';
  if (score > 0.4) return 'ok';
  return 'poor';
}

/**
 * Determine if wind is offshore relative to break orientation.
 * Offshore wind = wind blowing from land to sea = cleaner waves.
 *
 * @param {number} windDir - wind direction (degrees, meteorological)
 * @param {number} breakFacing - direction the break faces (degrees)
 * @returns {string} 'offshore' | 'onshore' | 'cross'
 */
function classifyWindType(windDir, breakFacing) {
  var diff = Math.abs(windDir - breakFacing);
  if (diff > 180) diff = 360 - diff;
  if (diff > 135) return 'offshore';
  if (diff < 45) return 'onshore';
  return 'cross';
}

/**
 * Compute a "surfability window" hours in a forecast where
 * conditions meet minimum thresholds.
 *
 * @param {Array<{ waveHeight: number, windSpeed: number, swellDirection: number, windDirection: number }>} hourlyForecast
 * @param {{ minHeight?: number, maxWind?: number }} [thresholds]
 * @returns {{ start: number, end: number, hours: number }|null}
 */
function findSurfWindow(hourlyForecast, thresholds) {
  var minH = (thresholds && thresholds.minHeight) || 0.5;
  var maxW = (thresholds && thresholds.maxWind) || 20;

  var bestStart = -1;
  var bestLen = 0;
  var curStart = -1;
  var curLen = 0;

  for (var i = 0; i < hourlyForecast.length; i++) {
    var h = hourlyForecast[i];
    var quality = computeBreakQuality({
      waveHeight: h.waveHeight,
      swellDirection: h.swellDirection,
      windDirection: h.windDirection,
      windSpeed: h.windSpeed,
    });

    if (h.waveHeight >= minH && h.windSpeed <= maxW && quality > 0.3) {
      if (curStart === -1) curStart = i;
      curLen++;
    } else {
      if (curLen > bestLen) {
        bestStart = curStart;
        bestLen = curLen;
      }
      curStart = -1;
      curLen = 0;
    }
  }
  // Check final window
  if (curLen > bestLen) {
    bestStart = curStart;
    bestLen = curLen;
  }

  if (bestLen === 0) return null;
  return { start: bestStart, end: bestStart + bestLen - 1, hours: bestLen };
}

export {
  computeBreakQuality,
  classifyBreak,
  classifyWindType,
  findSurfWindow,
};
