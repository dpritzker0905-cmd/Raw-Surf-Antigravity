-- Public media bucket contract.
--
-- Run in the Supabase SQL editor before deploying code that calls
-- routes.uploads.core.upload_to_supabase_storage. These buckets back public CDN
-- URLs and therefore must never receive private chat, crew-chat, or other
-- access-controlled media.
--
-- Existing private buckets intentionally cause an error instead of being made
-- public automatically; investigate their contents and perform an explicit
-- product-approved migration first.

DO $$
DECLARE
    bucket_id text;
BEGIN
    FOREACH bucket_id IN ARRAY ARRAY[
        'avatars', 'conditions', 'gallery', 'general', 'stories', 'user-gallery'
    ]
    LOOP
        IF EXISTS (
            SELECT 1 FROM storage.buckets
            WHERE id = bucket_id AND public = false
        ) THEN
            RAISE EXCEPTION
                'Bucket "%" is private but the public-upload contract requires a public CDN bucket. Review its contents before changing visibility.',
                bucket_id;
        END IF;

        INSERT INTO storage.buckets (id, name, public)
        VALUES (bucket_id, bucket_id, true)
        ON CONFLICT (id) DO NOTHING;
    END LOOP;
END $$;

-- Public buckets only govern download delivery. Upload/delete access still
-- requires the Storage policies applicable to the caller or service role.