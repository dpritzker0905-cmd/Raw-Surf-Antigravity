-- Private storage contract for paid gallery originals and quality variants.
-- Run before deploying the private-gallery upload paths. Service-role API calls
-- upload and sign these objects; no public-read Storage policy belongs here.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND cmd = 'SELECT'
          AND (
              'public' = ANY (roles)
              OR 'anon' = ANY (roles)
              OR 'authenticated' = ANY (roles)
          )
          AND (
              qual IS NULL
              OR lower(qual) = 'true'
              OR qual ILIKE '%gallery_originals%'
          )
    ) THEN
        RAISE EXCEPTION
            'A storage.objects read policy could expose gallery_originals; scope or remove it before provisioning.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM storage.buckets
        WHERE id = 'gallery_originals' AND public = true
    ) THEN
        RAISE EXCEPTION
            'Bucket "gallery_originals" is public. Make it private and review every existing object before deployment.';
    END IF;

    INSERT INTO storage.buckets (id, name, public)
    VALUES ('gallery_originals', 'gallery_originals', false)
    ON CONFLICT (id) DO UPDATE SET public = false;
END $$;
