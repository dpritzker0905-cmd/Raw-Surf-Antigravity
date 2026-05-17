-- ====================================================
-- Raw Surf OS — Supabase Extension Schema
-- SIDECAR INTELLIGENCE LAYERS
-- ====================================================
--
-- RULES:
-- These are EXTENSION tables that attach to EXISTING entities.
-- They do NOT replace or duplicate:
--   - surf_sessions (existing)
--   - photos/galleries (existing)
--   - spots (existing)
--   - user profiles (existing)
--
-- ENTITY GRAPH:
--   USER → SURF SESSION (existing core)
--     ├── session_enrichment (AI scoring)
--     ├── session_media_links (photography attaches here)
--     ├── session_engine_snapshots (map/weather state)
--     └── spot_session_links (ties into spots)
--   SPOT (existing)
--     └── spot_forecast_history (time-evolving intelligence)
-- ====================================================


-- ─── SESSION ENRICHMENT ──────────────────────────────────────────────────────
-- AI scoring layer that wraps existing session data.
-- Does NOT duplicate session fields — only adds computed intelligence.

CREATE TABLE IF NOT EXISTS session_enrichment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES surf_sessions(id) ON DELETE CASCADE,

  -- Engine-brain computed scores (from wave-scoring-engine.js)
  wave_score NUMERIC,        -- 0-100, from computeBreakQuality()
  crowd_score NUMERIC,       -- 0-100, from computeCrowdPressure()
  quality_score NUMERIC,     -- 0-100, composite overallScore
  wind_type TEXT,            -- 'offshore' | 'onshore' | 'cross'
  grade TEXT,                -- 'A+' to 'F'

  -- Model provenance
  model_version TEXT,        -- e.g. 'v3.10.4'

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_enrichment_session
  ON session_enrichment(session_id);


-- ─── SPOT ↔ SESSION LINK ────────────────────────────────────────────────────
-- Ties sessions to spots with per-session conditions snapshot.
-- This powers the spot intelligence hub.

CREATE TABLE IF NOT EXISTS spot_session_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spot_id UUID,              -- references existing spot hub table
  session_id UUID REFERENCES surf_sessions(id) ON DELETE CASCADE,

  -- Snapshot of conditions at session time
  wave_quality NUMERIC,      -- break quality score at that moment
  crowd_density NUMERIC,     -- crowd pressure at that moment

  -- Full conditions snapshot for historical analysis
  conditions_snapshot JSONB,
  -- Example: { waveHeight: 1.5, swellDirection: 210, windSpeed: 12, ... }

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spot_session_links_spot
  ON spot_session_links(spot_id);
CREATE INDEX IF NOT EXISTS idx_spot_session_links_session
  ON spot_session_links(session_id);


-- ─── SESSION MEDIA LINKS ────────────────────────────────────────────────────
-- Links existing photography/media to sessions.
-- Does NOT create a new media system — attaches to existing photos/galleries.

CREATE TABLE IF NOT EXISTS session_media_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES surf_sessions(id) ON DELETE CASCADE,

  media_id TEXT,             -- existing photo/gallery ID or storage key
  media_type TEXT DEFAULT 'photo',  -- 'photo' | 'video' | 'gallery'

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_media_links_session
  ON session_media_links(session_id);
CREATE INDEX IF NOT EXISTS idx_session_media_links_media
  ON session_media_links(media_id);


-- ─── SESSION ENGINE SNAPSHOTS ───────────────────────────────────────────────
-- Captures map/forecast/visual state at session time.
-- Powers "replay my session conditions" feature.

CREATE TABLE IF NOT EXISTS session_engine_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES surf_sessions(id) ON DELETE CASCADE,

  layer_type TEXT,           -- 'wind' | 'rain' | 'radar' | 'satellite' | 'pressure' | 'fog'
  provider TEXT,             -- 'gfs' | 'icon' | 'euro' | 'noaa' | 'rainviewer'

  -- Full snapshot of layer state at session time
  snapshot JSONB,
  -- Example: { windSpeed: 12, windDir: 225, waveHeight: 1.8, ... }

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_snapshots_session
  ON session_engine_snapshots(session_id);
CREATE INDEX IF NOT EXISTS idx_session_snapshots_layer
  ON session_engine_snapshots(layer_type);


-- ─── SPOT FORECAST HISTORY ──────────────────────────────────────────────────
-- Time-series forecast data per spot.
-- Powers "forecast accuracy over time" and spot intelligence trends.

CREATE TABLE IF NOT EXISTS spot_forecast_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spot_id UUID,              -- references existing spot hub table

  forecast_time TIMESTAMPTZ, -- the time this forecast covers
  model TEXT,                -- 'gfs' | 'icon' | 'euro'

  -- Structured forecast data
  wind JSONB,                -- { speed, direction, gusts }
  wave JSONB,                -- { height, period, direction }
  swell JSONB,               -- { height, period, direction, secondary_height, secondary_direction }
  pressure JSONB,            -- { surface_pressure }

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spot_forecast_spot
  ON spot_forecast_history(spot_id);
CREATE INDEX IF NOT EXISTS idx_spot_forecast_time
  ON spot_forecast_history(forecast_time);
CREATE INDEX IF NOT EXISTS idx_spot_forecast_model
  ON spot_forecast_history(model);


-- ─── ROW LEVEL SECURITY ─────────────────────────────────────────────────────
-- Enable RLS on all new tables. Policies should be added per your auth model.

ALTER TABLE session_enrichment ENABLE ROW LEVEL SECURITY;
ALTER TABLE spot_session_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_media_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_engine_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE spot_forecast_history ENABLE ROW LEVEL SECURITY;
