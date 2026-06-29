-- 2026-06-29 — Grant PostgREST (service_role) read access to the surf tables the
-- decoupled forecast-ingest cron reads.
--
-- WHY: public.surf_spots and public.surf_log_entries were created with SELECT
-- granted ONLY to the `postgres` role. The Render web box reads them fine because
-- it connects via DATABASE_URL *as* postgres (direct asyncpg). But the GitHub
-- Actions forecast-ingest job has no DATABASE_URL — it reads spots over PostgREST
-- (/rest/v1/surf_spots) with the SUPABASE_SERVICE_ROLE_KEY, which PostgREST runs
-- as the `service_role` Postgres role. With no table-level GRANT, that SELECT
-- raises "permission denied for table" (SQLSTATE 42501) → HTTP 403, which silently
-- skipped THREE cron features on 2026-06-29:
--     • Spot-ratings precompute  (the instant-glyphs-worldwide path)
--     • Buoy calibration
--     • Report (forward-rating) calibration
-- Storage uploads with the same key kept working because Storage auth is
-- bucket-policy based (storage.objects), independent of these table grants —
-- that Storage-OK / PostgREST-403 split is what pinned the diagnosis.
--
-- service_role already has BYPASSRLS, so with SELECT granted (and zero RLS
-- policies on these tables) it reads all rows. We do NOT grant anon/authenticated
-- — the frontend reads spots through the FastAPI backend, never PostgREST, so the
-- table stays locked to postgres + service_role only.
--
-- Apply once in the Supabase SQL Editor (Dashboard → SQL). Idempotent.

grant select on table public.surf_spots      to service_role;
grant select on table public.surf_log_entries to service_role;

-- Verify (expects each row to include "service_role:SELECT"):
--   select table_name,
--          string_agg(distinct grantee||':'||privilege_type, ', ' order by grantee||':'||privilege_type)
--   from information_schema.role_table_grants
--   where table_schema='public' and table_name in ('surf_spots','surf_log_entries')
--     and privilege_type='SELECT'
--   group by table_name;
