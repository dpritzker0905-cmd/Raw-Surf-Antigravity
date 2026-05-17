/*
====================================================
 Raw Surf OS — Surf Intelligence Engine (v2)
 SESSION + CROWD + WAVE SCORING + FORECAST CONNECTOR
====================================================

INTEGRATION LAYER that connects:
- Existing session log system (backend)
- wave-scoring-engine.js (engine-brain)
- crowd-prediction-model.js (engine-brain)
- surf-break-model.js (engine-brain)
- forecast-provider.js (engine/data)

UPGRADE v2:
- predictBestSurfWindow() — forecast-connected window finder
- onshore wind penalty in scoring
- real-time crowd computation from 2-hour window
- enhanced session insights with wind/crowd factors

NO engine init, NO rendering, NO DOM, NO RAF
var/function only (TDZ-immune)
====================================================
*/

import { scoreSession, scoreMultipleSessions } from '../../engine-brain/wave-scoring-engine';
import { computeCrowdPressure, predictDailyCongestion } from '../../engine-brain/crowd-prediction-model';
import { findSurfWindow, classifyBreak, computeBreakQuality, classifyWindType } from '../../engine-brain/surf-break-model';

// ─── SESSION STORE (in-memory snapshot cache) ────────────────────────────────

var _sessions = [];
var _spotCache = {};

/**
 * Ingest sessions from backend API response.
 * This is the ONLY entry point for session data.
 *
 * @param {Array<{
 *   id: string, userId: string, spotId: string, timestamp: number,
 *   waveHeight: number, swellDirection: number, windDirection: number,
 *   windSpeed: number, breakFacing: number, sessionDurationMin: number,
 *   rideCount?: number, tide?: number, bathymetryFactor?: number,
 *   crowdObserved?: number
 * }>} sessions
 */
function ingestSessions(sessions) {
  _sessions = sessions.slice(); // immutable snapshot
  _spotCache = {}; // invalidate per-spot cache
}

/** @returns {Array} */
function getAllSessions() { return _sessions; }

/**
 * @param {string} spotId
 * @returns {Array}
 */
function getSessionsBySpot(spotId) {
  if (_spotCache[spotId]) return _spotCache[spotId];
  var filtered = [];
  for (var i = 0; i < _sessions.length; i++) {
    if (_sessions[i].spotId === spotId) filtered.push(_sessions[i]);
  }
  _spotCache[spotId] = filtered;
  return filtered;
}

// ─── ENHANCED WAVE SCORING (v2) ──────────────────────────────────────────────

/**
 * Compute wave score with onshore wind penalty.
 * Uses existing engine-brain scoring + adds wind type awareness.
 *
 * @param {Object} session
 * @returns {{ overallScore: number, grade: string, windType: string, windPenalty: number }}
 */
function computeEnhancedWaveScore(session) {
  var result = scoreSession(session);

  // v2: Add onshore wind penalty
  var windType = classifyWindType(session.windDirection || 0, session.breakFacing || 0);
  var windPenalty = 0;
  if (windType === 'onshore') windPenalty = 20;
  else if (windType === 'cross') windPenalty = 8;

  var adjusted = Math.max(0, Math.min(100, result.overallScore - windPenalty));

  return {
    overallScore: adjusted,
    grade: scoreToGradeLocal(adjusted),
    windType: windType,
    windPenalty: windPenalty,
    rawScore: result.overallScore,
  };
}

function scoreToGradeLocal(score) {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// ─── CROWD INTELLIGENCE (v2) ─────────────────────────────────────────────────

/**
 * Compute real-time crowd index from recent sessions (2-hour window).
 * More aggressive than the engine-brain model — for live UI display.
 *
 * @param {Array} sessions
 * @returns {number} 0-100
 */
function computeRealtimeCrowdIndex(sessions) {
  if (!sessions.length) return 0;
  var cutoff = Date.now() - 2 * 60 * 60 * 1000; // 2 hours
  var count = 0;
  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].timestamp > cutoff) count++;
  }
  return Math.min(100, count * 15);
}

// ─── BEST SURF WINDOW PREDICTION (v2 NEW) ───────────────────────────────────

/**
 * Predict the best surf window by combining forecast quality with crowd prediction.
 * This is the COMPETITIVE MOAT — not just weather, but actionable timing.
 *
 * @param {{
 *   forecast: Array<{ hour: number, waveHeight: number, swellDirection: number,
 *     windDirection: number, windSpeed: number }>,
 *   breakFacing: number,
 *   spotId: string,
 *   dayOfWeek: number
 * }} params
 * @returns {{
 *   bestTime: { hour: number, score: number }|null,
 *   crowdIndex: number,
 *   windows: Array<{ start: number, end: number, avgScore: number, crowdPressure: number }>,
 *   recommendation: string
 * }}
 */
function predictBestSurfWindow(params) {
  var forecast = params.forecast || [];
  var breakFacing = params.breakFacing || 0;
  var spotSessions = getSessionsBySpot(params.spotId || '');

  // Score each forecast hour
  var hourlyScores = [];
  for (var h = 0; h < forecast.length; h++) {
    var fc = forecast[h];
    var quality = computeBreakQuality({
      waveHeight: fc.waveHeight || 0,
      swellDirection: fc.swellDirection || 0,
      windDirection: fc.windDirection || 0,
      windSpeed: fc.windSpeed || 0,
    });

    var windType = classifyWindType(fc.windDirection || 0, breakFacing);
    var windPenalty = windType === 'onshore' ? 0.2 : windType === 'cross' ? 0.08 : 0;

    var crowd = computeCrowdPressure({
      spotId: params.spotId || '',
      hourOfDay: fc.hour || h,
      dayOfWeek: params.dayOfWeek || 0,
      waveQualityScore: Math.round(quality * 100),
      historicalAvgSessions: spotSessions.length,
    });

    var crowdPenalty = crowd.pressureIndex / 200; // 0-0.5 penalty

    var finalScore = Math.max(0, quality - windPenalty - crowdPenalty);

    hourlyScores.push({
      hour: fc.hour || h,
      score: Math.round(finalScore * 100),
      crowdPressure: crowd.pressureIndex,
      windType: windType,
    });
  }

  // Find best hour
  var bestTime = null;
  var bestScore = -1;
  for (var i = 0; i < hourlyScores.length; i++) {
    if (hourlyScores[i].score > bestScore) {
      bestScore = hourlyScores[i].score;
      bestTime = hourlyScores[i];
    }
  }

  // Find continuous windows (consecutive hours with score > 40)
  var windows = findContinuousWindows(hourlyScores, 40);

  // Current crowd
  var crowdIndex = computeRealtimeCrowdIndex(spotSessions);

  // Recommendation
  var rec = '';
  if (bestTime && bestTime.score >= 70) {
    rec = 'Excellent conditions at ' + bestTime.hour + ':00 — go surf!';
  } else if (bestTime && bestTime.score >= 50) {
    rec = 'Decent window at ' + bestTime.hour + ':00 — conditions are OK';
  } else {
    rec = 'No great windows today — consider a rest day';
  }

  return {
    bestTime: bestTime,
    crowdIndex: crowdIndex,
    windows: windows,
    recommendation: rec,
  };
}

/**
 * Find continuous scoring windows above threshold.
 * @param {Array<{ hour: number, score: number, crowdPressure: number }>} scores
 * @param {number} threshold
 * @returns {Array<{ start: number, end: number, avgScore: number, crowdPressure: number }>}
 */
function findContinuousWindows(scores, threshold) {
  var windows = [];
  var inWindow = false;
  var start = 0;
  var sum = 0;
  var crowdSum = 0;
  var count = 0;

  for (var i = 0; i < scores.length; i++) {
    if (scores[i].score >= threshold) {
      if (!inWindow) { start = scores[i].hour; sum = 0; crowdSum = 0; count = 0; inWindow = true; }
      sum += scores[i].score;
      crowdSum += scores[i].crowdPressure;
      count++;
    } else if (inWindow) {
      windows.push({
        start: start,
        end: scores[i - 1].hour,
        avgScore: Math.round(sum / count),
        crowdPressure: Math.round(crowdSum / count),
      });
      inWindow = false;
    }
  }
  if (inWindow && count > 0) {
    windows.push({
      start: start,
      end: scores[scores.length - 1].hour,
      avgScore: Math.round(sum / count),
      crowdPressure: Math.round(crowdSum / count),
    });
  }
  return windows;
}

// ─── INTEGRATED INTELLIGENCE ─────────────────────────────────────────────────

/**
 * Generate complete intelligence report for a surf spot.
 * @param {Object} params - see JSDoc in v1
 * @returns {Object}
 */
function generateSpotIntelligence(params) {
  var c = params.currentConditions;

  var breakScore = computeBreakQuality({
    waveHeight: c.waveHeight, swellDirection: c.swellDirection,
    windDirection: c.windDirection, windSpeed: c.windSpeed,
    tide: c.tide, bathymetryFactor: c.bathymetryFactor,
  });

  var spotSessions = getSessionsBySpot(params.spotId);
  var crowd = computeCrowdPressure({
    spotId: params.spotId, hourOfDay: params.currentHour,
    dayOfWeek: params.dayOfWeek,
    waveQualityScore: Math.round(breakScore * 100),
    historicalAvgSessions: spotSessions.length,
    recentSessionCount: countRecentSessions(spotSessions, 3),
  });

  var surfWindow = null;
  if (params.hourlyForecast && params.hourlyForecast.length > 0) {
    surfWindow = findSurfWindow(params.hourlyForecast);
  }

  var history = { avgOverall: 0, totalSessions: 0, bestSession: null };
  if (spotSessions.length > 0) {
    var scored = scoreMultipleSessions(spotSessions);
    history = { avgOverall: scored.avgOverall, totalSessions: spotSessions.length, bestSession: scored.bestSession };
  }

  var dailyCongestion = predictDailyCongestion({
    waveQualityScore: Math.round(breakScore * 100),
    dayOfWeek: params.dayOfWeek,
    historicalAvgSessions: spotSessions.length,
  });

  return {
    breakQuality: { score: Math.round(breakScore * 100), label: classifyBreak(breakScore) },
    crowd: crowd,
    surfWindow: surfWindow,
    sessionHistory: history,
    dailyCongestion: dailyCongestion,
  };
}

function countRecentSessions(sessions, hours) {
  var cutoff = Date.now() - hours * 60 * 60 * 1000;
  var count = 0;
  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].timestamp > cutoff) count++;
  }
  return count;
}

/** Quick score for real-time UI. */
function quickScore(session) {
  var result = scoreSession(session);
  return { overallScore: result.overallScore, grade: result.grade, windType: result.windType };
}

export {
  ingestSessions, getAllSessions, getSessionsBySpot,
  generateSpotIntelligence, quickScore, countRecentSessions,
  computeEnhancedWaveScore, computeRealtimeCrowdIndex,
  predictBestSurfWindow, findContinuousWindows,
};
