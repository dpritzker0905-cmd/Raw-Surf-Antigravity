-- O6 (2026-11-11): the PRIVATE bucket for ALL static weather frames (accounts only, owner 2026-11-12). NOT APPLIED by this PR.
-- Apply only when FRAME_ENTITLEMENT is about to be turned on (docs/architecture/O6-static-frame-entitlement.md, rollout).
--
-- Model: no user ever reads this bucket directly. The publisher (GitHub runner) and the signer
-- (/api/weather/frame-urls on the backend) use the service role, which bypasses RLS. Users receive short-lived
-- signed URLs minted by the signer for the classes their JWT tier allows. So the bucket is private and carries
-- NO storage.objects policy for anon or authenticated: RLS on storage.objects then denies every direct read.

insert into storage.buckets (id, name, public)
values ('weather-frames-private', 'weather-frames-private', false)
on conflict (id) do update set public = false;

-- Guard: fail loudly if any existing policy on storage.objects names this bucket (one would grant direct reads).
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') ilike '%weather-frames-private%' or coalesce(with_check, '') ilike '%weather-frames-private%')
  ) then
    raise exception 'a storage.objects policy references weather-frames-private; the private frames bucket must have none';
  end if;
end $$;
