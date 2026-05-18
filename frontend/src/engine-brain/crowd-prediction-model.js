/*
====================================================
 Raw Surf OS Crowd Prediction Model
 AGGREGATED SIGNAL-BASED CROWD DENSITY ESTIMATION
====================================================

NOT real-time surveillance.
Uses AGGREGATED SIGNALS ONLY:
- session logs (density over time)
- time-of-day patterns
- historical surf spot usage
- wave quality triggers

NO engine, NO DOM, NO rendering
var/function only (TDZ-immune)
====================================================
*/

/**
 * Compute crowd pressure index for a spot at a given time.
 * Uses historical session density + current conditions quality.
 *
 * @param {{
 *   spotId: string,
 *   hourOfDay: number,
 *   dayOfWeek: number,
 *   waveQualityScore: number,
 *   historicalAvgSessions?: number,
 *   recentSessionCount?: number
 * }} params
 * @returns {{
 *   pressureIndex: number,
 *   category: string,
 *   recommendation: string
 * }}
 */
function computeCrowdPressure(params) {
  var hour = params.hourOfDay;
  var dow = params.dayOfWeek;
  var quality = params.waveQualityScore || 50;
  var historical = params.historicalAvgSessions || 5;
  var recent = params.recentSessionCount || 0;

  // Time-of-day factor: peaks at dawn patrol (6-8am) and after work (4-6pm)
  var timeFactor = getTimeFactor(hour);

  // Weekend multiplier
  var weekendMul = (dow === 0 || dow === 6) ? 1.4 : 1.0;

  // Quality attraction: better waves = more people
  var qualityFactor = quality / 100;

  // Historical baseline
  var baseLine = historical / 10; // normalize to 0-1 range

  // Recent activity signal
  var recentFactor = Math.min(1, recent / 10);

  // Composite pressure index (0-100)
  var raw = (timeFactor * 0.3 + qualityFactor * 0.3 +
    baseLine * 0.2 + recentFactor * 0.2) * weekendMul * 100;
  var pressureIndex = Math.round(Math.min(100, Math.max(0, raw)));

  return {
    pressureIndex: pressureIndex,
    category: classifyCrowd(pressureIndex),
    recommendation: getRecommendation(pressureIndex, hour),
  };
}

/**
 * Time-of-day factor models typical surf crowd patterns.
 * @param {number} hour - 0-23
 * @returns {number} 0-1
 */
function getTimeFactor(hour) {
  // Dawn patrol peak
  if (hour >= 5 && hour <= 8) return 0.8 + (hour - 5) * 0.05;
  // Midday lull
  if (hour >= 9 && hour <= 14) return 0.5;
  // After-work peak
  if (hour >= 15 && hour <= 18) return 0.7 + (hour - 15) * 0.05;
 // Evening/night low
  return 0.2;
}

/**
 * Classify crowd density.
 * @param {number} index - 0-100
 * @returns {string}
 */
function classifyCrowd(index) {
  if (index >= 80) return 'packed';
  if (index >= 60) return 'crowded';
  if (index >= 40) return 'moderate';
  if (index >= 20) return 'light';
  return 'empty';
}

/**
 * Generate surf timing recommendation.
 * @param {number} pressureIndex
 * @param {number} currentHour
 * @returns {string}
 */
function getRecommendation(pressureIndex, currentHour) {
 if (pressureIndex < 30) return 'Great time to surf low crowd expected';
  if (pressureIndex < 60) {
 if (currentHour < 7) return 'Moderate crowd you beat the rush';
 return 'Moderate crowd consider dawn patrol tomorrow';
  }
 if (currentHour >= 15) return 'High crowd try early morning for fewer people';
 return 'High crowd consider alternative spots or off-peak hours';
}

/**
 * Predict congestion heatmap for a 24-hour window.
 * Returns an array of 24 pressure indices.
 *
 * @param {{ waveQualityScore: number, dayOfWeek: number, historicalAvgSessions?: number }} params
 * @returns {number[]} 24-element array of pressure indices
 */
function predictDailyCongestion(params) {
  var result = [];
  for (var h = 0; h < 24; h++) {
    var p = computeCrowdPressure({
      spotId: '',
      hourOfDay: h,
      dayOfWeek: params.dayOfWeek,
      waveQualityScore: params.waveQualityScore,
      historicalAvgSessions: params.historicalAvgSessions,
    });
    result.push(p.pressureIndex);
  }
  return result;
}

export {
  computeCrowdPressure,
  getTimeFactor,
  classifyCrowd,
  getRecommendation,
  predictDailyCongestion,
};
