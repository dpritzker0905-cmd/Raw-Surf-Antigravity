/*
====================================================
 Raw Surf OS — Wave Scoring Engine
 SESSION QUALITY SCORING FROM ENGINE-BRAIN OUTPUT
====================================================

PURE MATH — derives scores from:
- surf session logs
- wave height data
- swell direction alignment
- wind quality (offshore/onshore)

NO engine, NO DOM, NO rendering
var/function only (TDZ-immune)
====================================================
*/

import { computeBreakQuality, classifyWindType } from './surf-break-model';

/**
 * Score a single surf session based on conditions during the session.
 *
 * @param {{
 *   waveHeight: number,
 *   swellDirection: number,
 *   windDirection: number,
 *   windSpeed: number,
 *   breakFacing: number,
 *   sessionDurationMin: number,
 *   rideCount?: number,
 *   tide?: number,
 *   bathymetryFactor?: number
 * }} session
 * @returns {{
 *   waveQuality: number,
 *   rideQualityIndex: number,
 *   conditionsCorrelation: number,
 *   windType: string,
 *   overallScore: number,
 *   grade: string
 * }}
 */
function scoreSession(session) {
  // Break quality from surf-break-model
  var breakQ = computeBreakQuality({
    waveHeight: session.waveHeight,
    swellDirection: session.swellDirection,
    windDirection: session.windDirection,
    windSpeed: session.windSpeed,
    tide: session.tide,
    bathymetryFactor: session.bathymetryFactor,
  });

  // Wind classification
  var windType = classifyWindType(session.windDirection, session.breakFacing);

  // Wave quality score (0-100)
  var waveQuality = Math.round(breakQ * 100);

  // Ride quality index: based on ride count relative to session length
  var rides = session.rideCount || 0;
  var durationHrs = Math.max(session.sessionDurationMin / 60, 0.25);
  var ridesPerHour = rides / durationHrs;
  var rideQualityIndex = Math.min(100, Math.round(ridesPerHour * 10));

  // Conditions correlation: how well the forecast matched surfable conditions
  var windBonus = windType === 'offshore' ? 1.2 : windType === 'cross' ? 1.0 : 0.7;
  var heightFactor = Math.min(1, session.waveHeight / 1.5);
  var conditionsCorrelation = Math.round(Math.min(100, breakQ * windBonus * heightFactor * 100));

  // Overall score: weighted composite
  var overall = Math.round(
    waveQuality * 0.5 + rideQualityIndex * 0.3 + conditionsCorrelation * 0.2
  );

  return {
    waveQuality: waveQuality,
    rideQualityIndex: rideQualityIndex,
    conditionsCorrelation: conditionsCorrelation,
    windType: windType,
    overallScore: overall,
    grade: scoreToGrade(overall),
  };
}

/**
 * Convert numeric score to letter grade.
 * @param {number} score - 0-100
 * @returns {string}
 */
function scoreToGrade(score) {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

/**
 * Score multiple sessions and compute aggregates.
 * @param {Array} sessions
 * @returns {{ scores: Array, avgOverall: number, bestSession: Object|null }}
 */
function scoreMultipleSessions(sessions) {
  if (!sessions.length) return { scores: [], avgOverall: 0, bestSession: null };
  var scores = [];
  var totalOverall = 0;
  var bestIdx = 0;
  for (var i = 0; i < sessions.length; i++) {
    var s = scoreSession(sessions[i]);
    scores.push(s);
    totalOverall += s.overallScore;
    if (s.overallScore > scores[bestIdx].overallScore) bestIdx = i;
  }
  return {
    scores: scores,
    avgOverall: Math.round(totalOverall / sessions.length),
    bestSession: scores[bestIdx],
  };
}

export { scoreSession, scoreToGrade, scoreMultipleSessions };
