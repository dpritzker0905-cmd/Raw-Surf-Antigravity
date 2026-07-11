-- S2 (2026-07-11): run-keyed manifest pointer with compare-and-swap semantics.
--
-- Supabase Storage has no If-Match, so the atomic "current manifest" pointer lives here:
-- the designated ingest writer uploads an immutable run-keyed manifest object
-- (manifests/manifest-g<generation>.json), then CAS-advances this single row
-- (UPDATE ... WHERE generation = expected — PostgREST PATCH with a generation=eq filter).
-- Readers resolve the pointer, then GET the immutable object with a PLAIN request —
-- correct on any CDN edge by construction, unlocking Cache-Control on hot routes (P8).
--
-- Backend lane: services/weather_pipeline/manifest_pointer.py (kill: MANIFEST_POINTER=0).
-- The lane self-disables per process until this migration is applied; the legacy
-- manifest.json path continues unchanged either way (dual-write, fallback read).
--
-- Apply via Supabase SQL editor or MCP apply_migration on the production project.

create table if not exists public.weather_manifest_pointer (
  id smallint primary key default 1 check (id = 1),
  generation bigint not null default 1,
  manifest_key text not null,
  run_id text,
  written_by text,
  updated_at timestamptz not null default now()
);

-- Service-role-only: RLS on with no policies — anon/authenticated get nothing;
-- the ingest runner and serve box use the service key, which bypasses RLS.
alter table public.weather_manifest_pointer enable row level security;

-- ⚠️ REQUIRED (found live 2026-07-11, run 29168283567): RLS bypass is NOT a GRANT — the table
-- was created without API-role privileges, so the service key got 42501 "permission denied" on
-- every pointer read/CAS while the run-keyed manifest objects uploaded fine. Grant the service
-- role its table privileges (still no anon/authenticated access):
grant select, insert, update on table public.weather_manifest_pointer to service_role;
