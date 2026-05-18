/*
====================================================
 Raw Surf OS Spot Hub Query Contract
 SINGLE AGGREGATION PIPELINE
====================================================

This is the ONLY entry point for Spot Hub data.

FLOW:
 Supabase session-intel-service normalized forecast
 surf-intelligence-fusion Spot Hub UI

NEVER: Supabase Spot Hub directly

NO side effects, NO rendering, NO engine coupling
var/function only (TDZ-immune)
====================================================
*/

import {
  getSpotSessions,
  getSessionEnrichment,
  getSessionSnapshots,
  getSpotForecastHistory,
} from '../data/session-intel-service';

import { composeSpotIntelligence } from '../surf-intelligence-fusion';

// MAIN QUERY 

/**
 * Fetch and compose complete spot intelligence.
 * This replaces scattered Supabase reads in Spot Hub.
 *
 * @param {{ spotId: string, timestep?: string, spotMetadata?: Object }} params
 * @returns {Promise<{
 *   intelligence: Object,
 *   sessions: Array,
 *   forecasts: Array,
 *   engineSnapshots: Array
 * }>}
 */
function getSpotHubData(params) {
  var spotId = params.spotId;
  var model = params.model || null;

  return Promise.all([
    safeQuery(function() { return getSpotSessions(spotId); }),
    safeQuery(function() { return getSpotForecastHistory(spotId, model, 24); }),
    safeQuery(function() { return getEngineSnapshotsForSpot(spotId); }),
  ]).then(function(results) {
    var sessionsResult = results[0];
    var forecastResult = results[1];
    var snapshotsResult = results[2];

    var sessions = (sessionsResult && sessionsResult.data) || [];
    var forecasts = (forecastResult && forecastResult.data) || [];
    var snapshots = (snapshotsResult && snapshotsResult.data) || [];

    // Extract engine outputs from latest snapshots
    var engineOutputs = extractEngineOutputs(snapshots);

    // Compose through the fusion layer
    var intelligence = composeSpotIntelligence({
      sessions: sessions,
      sessionEnrichment: [],  // loaded separately if needed
      spotSessionLinks: sessions,  // sessions are the links
      forecastHistory: forecasts,
      engineOutputs: engineOutputs,
      forecastTiles: [],  // live tiles not stored
      spotMetadata: params.spotMetadata || {},
    });

    return {
      intelligence: intelligence,
      sessions: sessions,
      forecasts: forecasts,
      engineSnapshots: snapshots,
    };
  });
}

/**
 * Lightweight version only the intelligence score (no raw data).
 * For map overlay badges and quick-view cards.
 *
 * @param {{ spotId: string, spotMetadata?: Object }} params
 * @returns {Promise<Object>}
 */
function getSpotQuickIntel(params) {
  return getSpotHubData(params).then(function(result) {
    return result.intelligence;
  });
}

/**
 * Batch fetch intelligence for multiple spots (map overlay).
 *
 * @param {Array<{ spotId: string, spotMetadata?: Object }>} spots
 * @returns {Promise<Map<string, Object>>}
 */
function getMultiSpotIntel(spots) {
  var promises = [];
  for (var i = 0; i < spots.length; i++) {
    promises.push(
      getSpotQuickIntel(spots[i])
        .then(function(intel) { return { spotId: spots[i].spotId, intel: intel }; })
        .catch(function() { return { spotId: spots[i].spotId, intel: null }; })
    );
  }
  return Promise.all(promises).then(function(results) {
    var map = {};
    for (var j = 0; j < results.length; j++) {
      map[results[j].spotId] = results[j].intel;
    }
    return map;
  });
}

// HELPERS 

/**
 * Wrap Supabase query to safely handle errors.
 */
function safeQuery(queryFn) {
  try {
    var result = queryFn();
    if (result && typeof result.then === 'function') {
      return result.catch(function(err) {
        console.warn('[SpotHubQuery] Query failed:', err.message || err);
        return { data: [] };
      });
    }
    return Promise.resolve(result || { data: [] });
  } catch (e) {
    console.warn('[SpotHubQuery] Query error:', e.message || e);
    return Promise.resolve({ data: [] });
  }
}

/**
 * Get engine snapshots for a spot (via session links).
 */
function getEngineSnapshotsForSpot(spotId) {
  // Engine snapshots are per-session, so we query the latest
  return getSpotSessions(spotId, 5).then(function(result) {
    var sessions = (result && result.data) || [];
    if (sessions.length === 0) return { data: [] };

    // Get snapshots from most recent session
    var latestSessionId = sessions[0].session_id;
    if (!latestSessionId) return { data: [] };
    return getSessionSnapshots(latestSessionId);
  }).catch(function() { return { data: [] }; });
}

/**
 * Extract structured engine outputs from raw snapshots.
 */
function extractEngineOutputs(snapshots) {
  var outputs = { swell: null, wind: null, surfBreak: null };

  for (var i = 0; i < snapshots.length; i++) {
    var snap = snapshots[i];
    var data = snap.snapshot || {};

    if (snap.layer_type === 'wave' || snap.layer_type === 'swell') {
      outputs.swell = {
        height: data.waveHeight || data.height || 0,
        period: data.period || 0,
        direction: data.direction || data.swellDirection || 0,
      };
    }
    if (snap.layer_type === 'wind') {
      outputs.wind = {
        speed: data.windSpeed || data.speed || 0,
        direction: data.windDirection || data.direction || 0,
        gusts: data.gusts || 0,
      };
    }
  }

  return outputs;
}

export {
  getSpotHubData,
  getSpotQuickIntel,
  getMultiSpotIntel,
  safeQuery,
  extractEngineOutputs,
};
