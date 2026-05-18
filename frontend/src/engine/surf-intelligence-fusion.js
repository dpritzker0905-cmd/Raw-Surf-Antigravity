/*
====================================================
 Raw Surf OS Spot Intelligence Fusion Layer
 DETERMINISTIC COMPOSITION CONTRACT
====================================================

This is the SINGLE SOURCE OF TRUTH for spot intelligence.
It COMPOSES outputs from existing systems never duplicates.

INPUTS (all passed in, never fetched internally):
 SOURCE A REALITY: sessions, enrichment, spot links
 SOURCE B FORECAST: forecast history, tiles
 SOURCE C SIMULATION: engine-brain outputs

OUTPUT:
  spotIntelligence = { waveScore, crowdScore, consistencyScore,
    forecastAccuracyScore, spotQualityIndex, confidence }

CONSUMERS:
  Spot Hub UI, map overlays, surf intelligence cards

RULES:
- PURE FUNCTIONS ONLY
- NO DB writes, NO side effects
- NO React, NO MapLibre, NO Supabase
- NO import-time initialization
- var/function only (TDZ-immune)
====================================================
*/

// MAIN COMPOSITION 

/**
 * Compose all intelligence sources into a single spot report.
 * This is the ONLY function Spot Hub should consume.
 *
 * @param {{
 *   sessions: Array,
 *   sessionEnrichment: Array,
 *   spotSessionLinks: Array,
 *   forecastHistory: Array,
 *   engineOutputs: { swell?: Object, wind?: Object, surfBreak?: Object },
 *   forecastTiles: Array,
 *   spotMetadata: { bathymetry?: number, idealDirection?: number, historicalFrequency?: number }
 * }} sources
 * @returns {{
 *   waveScore: number, crowdScore: number, consistencyScore: number,
 *   forecastAccuracyScore: number, spotQualityIndex: number,
 *   confidence: number, breakdown: Object
 * }}
 */
function composeSpotIntelligence(sources) {
  var sessions = sources.sessions || [];
  var enrichment = sources.sessionEnrichment || [];
  var links = sources.spotSessionLinks || [];
  var forecastHistory = sources.forecastHistory || [];
  var engine = sources.engineOutputs || {};
  var tiles = sources.forecastTiles || [];
  var meta = sources.spotMetadata || {};

  var ws = computeWaveScore(engine, meta);
  var cs = computeCrowdScore(links, forecastHistory, meta);
  var cons = calculateForecastConsistency(tiles, forecastHistory);
  var acc = calculateForecastAccuracy(sessions, enrichment, forecastHistory);
  var qi = weightedSpotIndex(ws, cs, cons, acc);
  var conf = calculateConfidence(sessions, tiles, forecastHistory);

  return {
    waveScore: ws,
    crowdScore: cs,
    consistencyScore: cons,
    forecastAccuracyScore: acc,
    spotQualityIndex: qi,
    confidence: conf,
    breakdown: {
      sessionCount: sessions.length,
      enrichmentCount: enrichment.length,
      forecastSnapshots: forecastHistory.length,
      tileFrames: tiles.length,
      hasEngineData: !!(engine.swell || engine.wind),
    },
  };
}

// WAVE SCORE 

/**
 * Derive wave quality from engine simulation + spot metadata.
 * Uses swell propagation, wind vectors, surf break model, bathymetry.
 *
 * @param {Object} engine - { swell, wind, surfBreak }
 * @param {Object} meta - { bathymetry, idealDirection }
 * @returns {number} 0-100
 */
function computeWaveScore(engine, meta) {
  var score = 50; // neutral baseline

  // Swell energy contribution (0-40 points)
  if (engine.swell) {
    var swellHeight = engine.swell.height || 0;
    var swellPeriod = engine.swell.period || 0;
    // Peak quality: 1-2m height, 10-14s period
    var hFactor = Math.min(1, swellHeight / 1.5) * (1 - Math.max(0, (swellHeight - 3) / 5));
    var pFactor = Math.min(1, swellPeriod / 14);
    score += Math.max(0, hFactor * 20 + pFactor * 20);
  }

  // Wind contribution (-20 to +20 points)
  if (engine.wind && engine.surfBreak) {
    var windType = engine.surfBreak.windType || 'cross';
    if (windType === 'offshore') score += 20;
    else if (windType === 'cross') score += 0;
    else if (windType === 'onshore') score -= 20;
  }

  // Bathymetry bonus (0-10 points)
  if (meta.bathymetry) {
    score += Math.min(10, meta.bathymetry * 10);
  }

  // Direction alignment (0-10 points)
  if (engine.swell && meta.idealDirection !== undefined) {
    var dirDiff = Math.abs((engine.swell.direction || 0) - meta.idealDirection);
    if (dirDiff > 180) dirDiff = 360 - dirDiff;
    score += Math.max(0, 10 - dirDiff / 9);
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

// CROWD SCORE 

/**
 * Compute crowd pressure from session density + forecast quality + time weighting.
 *
 * @param {Array} links - spot_session_links
 * @param {Array} forecastHistory
 * @param {Object} meta - { historicalFrequency }
 * @returns {number} 0-100 (higher = more crowded)
 */
function computeCrowdScore(links, forecastHistory, meta) {
  // Session density (recent 2 hours)
  var now = Date.now();
  var cutoff = now - 2 * 60 * 60 * 1000;
  var recentCount = 0;
  for (var i = 0; i < links.length; i++) {
    var ts = links[i].created_at ? new Date(links[i].created_at).getTime() : 0;
    if (ts > cutoff) recentCount++;
  }
  var densityScore = Math.min(50, recentCount * 10);

  // Forecast quality attracts crowds
  var qualityAttraction = 0;
  if (forecastHistory.length > 0) {
    var latestWave = forecastHistory[0].wave;
    if (latestWave && latestWave.height) {
      // Good waves attract more people
      qualityAttraction = Math.min(30, latestWave.height * 10);
    }
  }

  // Historical frequency baseline
  var histBaseline = Math.min(20, (meta.historicalFrequency || 0) * 2);

  return Math.max(0, Math.min(100, Math.round(densityScore + qualityAttraction + histBaseline)));
}

// FORECAST CONSISTENCY 

/**
 * Measure how consistent forecast models are with each other.
 * High consistency = high confidence. Low = uncertain conditions.
 *
 * @param {Array} tiles - forecast tile frames
 * @param {Array} forecastHistory - historical forecasts
 * @returns {number} 0-100
 */
function calculateForecastConsistency(tiles, forecastHistory) {
  if (forecastHistory.length < 2) return 50; // not enough data

  // Compare consecutive forecast snapshots for same time window
  var diffs = [];
  for (var i = 1; i < forecastHistory.length && i < 12; i++) {
    var prev = forecastHistory[i];
    var curr = forecastHistory[i - 1];

    if (prev.wave && curr.wave) {
      var heightDiff = Math.abs((curr.wave.height || 0) - (prev.wave.height || 0));
      var dirDiff = Math.abs((curr.wave.direction || 0) - (prev.wave.direction || 0));
      if (dirDiff > 180) dirDiff = 360 - dirDiff;
      diffs.push(heightDiff + dirDiff / 36); // normalize direction to ~0-10 scale
    }
  }

  if (diffs.length === 0) return 50;

  var avgDiff = 0;
  for (var j = 0; j < diffs.length; j++) avgDiff += diffs[j];
  avgDiff /= diffs.length;

  // Lower diff = higher consistency
  return Math.max(0, Math.min(100, Math.round(100 - avgDiff * 20)));
}

// FORECAST ACCURACY 

/**
 * Compare forecasted conditions vs actual session observations.
 * THIS IS THE CORE MOAT not just weather, but verified accuracy.
 *
 * @param {Array} sessions
 * @param {Array} enrichment
 * @param {Array} forecastHistory
 * @returns {number} 0-100
 */
function calculateForecastAccuracy(sessions, enrichment, forecastHistory) {
  if (sessions.length === 0 || forecastHistory.length === 0) return 50;

  var matchCount = 0;
  var totalCompared = 0;

  for (var i = 0; i < sessions.length && i < 20; i++) {
    var session = sessions[i];
    // Find closest forecast to this session
    var closest = findClosestForecast(session.timestamp, forecastHistory);
    if (!closest) continue;

    totalCompared++;

    // Compare wave height
    if (session.waveHeight && closest.wave && closest.wave.height) {
      var heightError = Math.abs(session.waveHeight - closest.wave.height);
      if (heightError < 0.5) matchCount += 1;
      else if (heightError < 1.0) matchCount += 0.5;
    }
  }

  if (totalCompared === 0) return 50;
  return Math.max(0, Math.min(100, Math.round((matchCount / totalCompared) * 100)));
}

/**
 * Find the forecast snapshot closest in time to a given timestamp.
 */
function findClosestForecast(timestamp, forecasts) {
  var best = null;
  var bestDiff = Infinity;
  for (var i = 0; i < forecasts.length; i++) {
    var ft = forecasts[i].forecast_time
      ? new Date(forecasts[i].forecast_time).getTime()
      : 0;
    var diff = Math.abs(timestamp - ft);
    if (diff < bestDiff) { bestDiff = diff; best = forecasts[i]; }
  }
  // Only match within 3-hour window
  return bestDiff < 3 * 60 * 60 * 1000 ? best : null;
}

// WEIGHTED SPOT INDEX 

/**
 * Compute overall spot quality index from all sub-scores.
 * @returns {number} 0-100
 */
function weightedSpotIndex(waveScore, crowdScore, consistencyScore, accuracyScore) {
  // Wave quality is most important, crowd is inverse (low crowd = better)
  var inverseCrowd = 100 - crowdScore;
  return Math.round(
    waveScore * 0.40 +
    inverseCrowd * 0.25 +
    consistencyScore * 0.15 +
    accuracyScore * 0.20
  );
}

// CONFIDENCE 

/**
 * Calculate confidence level based on data availability.
 * @returns {number} 0-100
 */
function calculateConfidence(sessions, tiles, forecasts) {
  var score = 0;

  // Session data (0-30)
  if (sessions.length > 10) score += 30;
  else if (sessions.length > 5) score += 20;
  else if (sessions.length > 0) score += 10;

  // Forecast data (0-40)
  if (forecasts.length > 12) score += 40;
  else if (forecasts.length > 6) score += 25;
  else if (forecasts.length > 0) score += 10;

  // Tile data (0-30)
  if (tiles.length > 6) score += 30;
  else if (tiles.length > 0) score += 15;

  return Math.min(100, score);
}

export {
  composeSpotIntelligence,
  computeWaveScore,
  computeCrowdScore,
  calculateForecastConsistency,
  calculateForecastAccuracy,
  findClosestForecast,
  weightedSpotIndex,
  calculateConfidence,
};
