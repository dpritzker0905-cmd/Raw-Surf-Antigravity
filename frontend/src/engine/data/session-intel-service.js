/*
====================================================
 Raw Surf OS — Session Intelligence Service
 SUPABASE SIDECAR DATA ACCESS LAYER
====================================================

Connects surf-intelligence.js (engine/sessions) to
Supabase extension tables:
  - session_enrichment
  - spot_session_links
  - session_media_links
  - session_engine_snapshots
  - spot_forecast_history

NO engine init, NO rendering, NO DOM
var/function only (TDZ-immune)
====================================================
*/

// ─── SUPABASE CLIENT (injected at runtime, never at import) ──────────────────

var _supabase = null;

/**
 * Set the Supabase client. Called ONCE after app init.
 * @param {Object} client - initialized Supabase client
 */
function setSupabaseClient(client) {
  _supabase = client;
}

function getClient() {
  if (!_supabase) throw new Error('[SessionIntelService] Supabase not initialized');
  return _supabase;
}

// ─── SESSION ENRICHMENT ──────────────────────────────────────────────────────

/**
 * Save AI scoring results for a session.
 * @param {{ sessionId: string, waveScore: number, crowdScore: number,
 *   qualityScore: number, windType: string, grade: string }} enrichment
 */
function saveSessionEnrichment(enrichment) {
  return getClient()
    .from('session_enrichment')
    .insert({
      session_id: enrichment.sessionId,
      wave_score: enrichment.waveScore,
      crowd_score: enrichment.crowdScore,
      quality_score: enrichment.qualityScore,
      wind_type: enrichment.windType,
      grade: enrichment.grade,
      model_version: 'v3.10.5',
    });
}

/**
 * Get enrichment data for a session.
 * @param {string} sessionId
 */
function getSessionEnrichment(sessionId) {
  return getClient()
    .from('session_enrichment')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
}

// ─── SPOT ↔ SESSION LINKS ────────────────────────────────────────────────────

/**
 * Link a session to a spot with conditions snapshot.
 * @param {{ spotId: string, sessionId: string, waveQuality: number,
 *   crowdDensity: number, conditionsSnapshot: Object }} link
 */
function saveSpotSessionLink(link) {
  return getClient()
    .from('spot_session_links')
    .insert({
      spot_id: link.spotId,
      session_id: link.sessionId,
      wave_quality: link.waveQuality,
      crowd_density: link.crowdDensity,
      conditions_snapshot: link.conditionsSnapshot,
    });
}

/**
 * Get all sessions for a spot with conditions.
 * @param {string} spotId
 * @param {number} [limit=50]
 */
function getSpotSessions(spotId, limit) {
  if (limit === undefined) limit = 50;
  return getClient()
    .from('spot_session_links')
    .select('*')
    .eq('spot_id', spotId)
    .order('created_at', { ascending: false })
    .limit(limit);
}

// ─── SESSION MEDIA LINKS ─────────────────────────────────────────────────────

/**
 * Link existing media (photo/video) to a session.
 * @param {{ sessionId: string, mediaId: string, mediaType?: string }} link
 */
function linkMediaToSession(link) {
  return getClient()
    .from('session_media_links')
    .insert({
      session_id: link.sessionId,
      media_id: link.mediaId,
      media_type: link.mediaType || 'photo',
    });
}

/**
 * Get all media linked to a session.
 * @param {string} sessionId
 */
function getSessionMedia(sessionId) {
  return getClient()
    .from('session_media_links')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false });
}

// ─── ENGINE SNAPSHOTS ────────────────────────────────────────────────────────

/**
 * Save engine/weather state at session time.
 * @param {{ sessionId: string, layerType: string, provider: string, snapshot: Object }} snap
 */
function saveEngineSnapshot(snap) {
  return getClient()
    .from('session_engine_snapshots')
    .insert({
      session_id: snap.sessionId,
      layer_type: snap.layerType,
      provider: snap.provider,
      snapshot: snap.snapshot,
    });
}

/**
 * Get all engine snapshots for a session.
 * @param {string} sessionId
 */
function getSessionSnapshots(sessionId) {
  return getClient()
    .from('session_engine_snapshots')
    .select('*')
    .eq('session_id', sessionId);
}

// ─── SPOT FORECAST HISTORY ──────────────────────────────────────────────────

/**
 * Save a forecast snapshot for a spot.
 * @param {{ spotId: string, forecastTime: string, model: string,
 *   wind: Object, wave: Object, swell: Object, pressure: Object }} forecast
 */
function saveSpotForecast(forecast) {
  return getClient()
    .from('spot_forecast_history')
    .insert({
      spot_id: forecast.spotId,
      forecast_time: forecast.forecastTime,
      model: forecast.model,
      wind: forecast.wind,
      wave: forecast.wave,
      swell: forecast.swell,
      pressure: forecast.pressure,
    });
}

/**
 * Get forecast history for a spot.
 * @param {string} spotId
 * @param {string} [model] - filter by model
 * @param {number} [limit=24]
 */
function getSpotForecastHistory(spotId, model, limit) {
  if (limit === undefined) limit = 24;
  var query = getClient()
    .from('spot_forecast_history')
    .select('*')
    .eq('spot_id', spotId)
    .order('forecast_time', { ascending: false })
    .limit(limit);
  if (model) query = query.eq('model', model);
  return query;
}

export {
  setSupabaseClient,
  saveSessionEnrichment, getSessionEnrichment,
  saveSpotSessionLink, getSpotSessions,
  linkMediaToSession, getSessionMedia,
  saveEngineSnapshot, getSessionSnapshots,
  saveSpotForecast, getSpotForecastHistory,
};
