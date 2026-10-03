-- Additive Strava state migration. Apply before enabling the repaired OAuth routes.
-- The model bootstrap installs the same access protections on first table creation.
BEGIN;
CREATE TABLE IF NOT EXISTS public.strava_oauth_states (
    state_hash varchar(64) PRIMARY KEY,
    user_id varchar(36) NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_strava_oauth_states_user_id ON public.strava_oauth_states(user_id);
CREATE INDEX IF NOT EXISTS ix_strava_oauth_states_expires_at ON public.strava_oauth_states(expires_at);
ALTER TABLE public.strava_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.strava_oauth_states FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.strava_oauth_states TO service_role;
COMMIT;
