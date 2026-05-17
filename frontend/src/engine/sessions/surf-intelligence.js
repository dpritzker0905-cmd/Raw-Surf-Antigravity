/*
====================================================
 Raw Surf OS — Surf Intelligence Engine
 SESSION + CROWD + WAVE SCORING CONNECTOR
====================================================

This is the INTEGRATION LAYER that connects:
- Existing session log system (backend)
- wave-scoring-engine.js (engine-brain)
- crowd-prediction-model.js (engine-brain)
- surf-break-model.js (engine-brain)

It does NOT duplicate scoring logic — it DELEGATES.

NO engine init, NO rendering, NO DOM, NO RAF
var/function only (TDZ-immune)
====================================================
*/

import { scoreSession, scoreMultipleSessions } from '../../engine-brain/wave-scoring-engine';
import { computeCrowdPressure, predictDailyCongestion } from '../../engine-brain/crowd-prediction-model';
import { findSurfWindow, classifyBreak, computeBreakQuality } from '../../engine-brain/surf-break-model';

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

/**
 * Get all ingested sessions.
 * @returns {Array}
 */
function getAllSessions() {
  return _sessions;
}

/**
 * Get sessions for a specific spot.
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

// ─── INTEGRATED INTELLIGENCE ─────────────────────────────────────────────────

/**
 * Generate complete intelligence report for a surf spot.
 * Combines wave scoring, crowd prediction, and break quality.
 *
 * @param {{
 *   spotId: string,
 *   currentHour: number,
 *   dayOfWeek: number,
 *   currentConditions: {
 *     waveHeight: number, swellDirection: number,
 *     windDirection: number, windSpeed: number,
 *     breakFacing: number, tide?: number,
 *     bathymetryFactor?: number
 *   },
 *   hourlyForecast?: Array
 * }} params
 * @returns {{
 *   breakQuality: { score: number, label: string },
 *   crowd: { pressureIndex: number, category: string, recommendation: string },
 *   surfWindow: Object|null,
 *   sessionHistory: { avgOverall: number, totalSessions: number, bestSession: Object|null },
 *   dailyCongestion: number[]
 * }}
 */
function generateSpotIntelligence(params) {
  var c = params.currentConditions;

  // 1. Break quality (from surf-break-model)
  var breakScore = computeBreakQuality({
    waveHeight: c.waveHeight,
    swellDirection: c.swellDirection,
    windDirection: c.windDirection,
    windSpeed: c.windSpeed,
    tide: c.tide,
    bathymetryFactor: c.bathymetryFactor,
  });

  // 2. Crowd prediction (from crowd-prediction-model)
  var spotSessions = getSessionsBySpot(params.spotId);
  var crowd = computeCrowdPressure({
    spotId: params.spotId,
    hourOfDay: params.currentHour,
    dayOfWeek: params.dayOfWeek,
    waveQualityScore: Math.round(breakScore * 100),
    historicalAvgSessions: spotSessions.length,
    recentSessionCount: countRecentSessions(spotSessions, 3),
  });

  // 3. Surf window (from surf-break-model)
  var surfWindow = null;
  if (params.hourlyForecast && params.hourlyForecast.length > 0) {
    surfWindow = findSurfWindow(params.hourlyForecast);
  }

  // 4. Session history scoring (from wave-scoring-engine)
  var history = { avgOverall: 0, totalSessions: 0, bestSession: null };
  if (spotSessions.length > 0) {
    var scored = scoreMultipleSessions(spotSessions);
    history = {
      avgOverall: scored.avgOverall,
      totalSessions: spotSessions.length,
      bestSession: scored.bestSession,
    };
  }

  // 5. 24-hour congestion forecast
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

/**
 * Count sessions within the last N hours.
 * @param {Array} sessions
 * @param {number} hours
 * @returns {number}
 */
function countRecentSessions(sessions, hours) {
  var cutoff = Date.now() - hours * 60 * 60 * 1000;
  var count = 0;
  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].timestamp > cutoff) count++;
  }
  return count;
}

/**
 * Quick score for a single session (for real-time UI display).
 * @param {Object} session
 * @returns {{ overallScore: number, grade: string, windType: string }}
 */
function quickScore(session) {
  var result = scoreSession(session);
  return {
    overallScore: result.overallScore,
    grade: result.grade,
    windType: result.windType,
  };
}

export {
  ingestSessions,
  getAllSessions,
  getSessionsBySpot,
  generateSpotIntelligence,
  quickScore,
  countRecentSessions,
};
