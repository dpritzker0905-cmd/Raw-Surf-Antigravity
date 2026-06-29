-- 2026-06-29 (FOLLOW-UP — the actual root cause)
--
-- The earlier migration (2026-06-29_grant_service_role_read_surf_tables.sql) granted table SELECT to
-- service_role, but the CI precompute/calibration STILL 403'd after it. Forensics (diag-postgrest.yml,
-- run 28408419767) decoded the CI key — it IS the real service_role key for project jnfbxcvcbtndtsvscppt
-- — yet PostgREST returned:
--     403  {"code":"42501","message":"permission denied for schema public"}
--
-- That is a SCHEMA-level denial, not a table-level one. Reading a table requires BOTH:
--   (1) USAGE on the schema, AND
--   (2) SELECT on the table.
-- service_role had (2) (granted last migration) but was missing (1) — USAGE on schema public itself —
-- so every granted table was still unreachable. (Storage kept working because it lives in the `storage`
-- schema + bucket policies, independent of `public`.) This restores the normal Supabase default.
--
-- Apply in the Supabase SQL Editor (project jnfbxcvcbtndtsvscppt). Expected output: "Success. No rows returned".

grant usage on schema public to service_role;

-- Re-affirm the table reads (idempotent — already applied last migration) so the fix is self-contained.
grant select on table public.surf_spots      to service_role;
grant select on table public.surf_log_entries to service_role;
