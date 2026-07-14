-- Storage RLS: anonymous read scoped to EXACTLY ONE object (2026-07-14, CDN ratings lane).
-- APPLIED to prod (jnfbxcvcbtndtsvscppt) and dev (weewaulkwfwlbhqemxma) on 2026-07-14 as
-- migration `anon_read_spot_ratings_latest_only` — this file is the in-repo record.
--
-- WHY THIS SHAPE (user-approved 2026-07-14, instead of a public bucket): the weather-products
-- bucket stays PRIVATE and default-deny; this single policy exposes only the precomputed
-- spot-ratings JSON (curated spot list + scores — public-shaped, already served unauthenticated
-- by /api/weather/spot-ratings). The frontend (spotRatingsCdn.js) fetches it off the Supabase CDN
-- with the anon key via /storage/v1/object/authenticated/..., taking the 1-CPU serve box off the
-- precomputed-ratings path entirely. Every sibling object (grid products, manifest.json,
-- calibration blobs) remains service-role-only — live-verified: anon GET 200 on this key, 400 on
-- manifest.json / siblings / keyless.
--
-- REVOKE with: DROP POLICY "anon read spot_ratings latest only" ON storage.objects;
-- RENAMING spot_ratings/latest.json (SPOT_RATINGS_L2_KEY in spot_ratings.py) breaks this policy
-- and the frontend lane together — see test_upload_writes_the_single_rls_exposed_key.

CREATE POLICY "anon read spot_ratings latest only"
ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id = 'weather-products' AND name = 'spot_ratings/latest.json');
