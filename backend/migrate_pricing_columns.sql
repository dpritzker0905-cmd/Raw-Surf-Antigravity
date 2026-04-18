-- ============================================================
-- Migration: Independent Per-Session-Type Resolution Pricing
-- Run once on the production PostgreSQL database after deploy.
-- All columns use IF NOT EXISTS so it's safe to run multiple times.
-- ============================================================

-- ON-DEMAND independent resolution pricing (independent from Gallery)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS on_demand_price_web     FLOAT DEFAULT 5.0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS on_demand_price_standard FLOAT DEFAULT 10.0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS on_demand_price_high    FLOAT DEFAULT 18.0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS on_demand_video_720p    FLOAT DEFAULT 12.0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS on_demand_video_1080p   FLOAT DEFAULT 20.0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS on_demand_video_4k      FLOAT DEFAULT 40.0;

-- LIVE SESSION independent resolution pricing (independent from Gallery/On-Demand)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS live_price_web          FLOAT DEFAULT 3.0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS live_price_standard     FLOAT DEFAULT 6.0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS live_price_high         FLOAT DEFAULT 12.0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS live_video_720p         FLOAT DEFAULT 8.0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS live_video_1080p        FLOAT DEFAULT 15.0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS live_video_4k           FLOAT DEFAULT 30.0;

-- BOOKING video pricing (photo tiers already existed: booking_price_web/standard/high)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS booking_video_720p      FLOAT DEFAULT 8.0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS booking_video_1080p     FLOAT DEFAULT 15.0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS booking_video_4k        FLOAT DEFAULT 30.0;
