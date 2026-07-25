BEGIN;

UPDATE storage.buckets
SET
    public = false,
    file_size_limit = 104857600,
    allowed_mime_types = ARRAY[
        'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
        'video/mp4', 'video/quicktime', 'video/webm', 'video/mpeg', 'video/3gpp'
    ]::text[]
WHERE id = 'grom_media';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'grom_media' AND public IS FALSE) THEN
        RAISE EXCEPTION 'grom_media must exist and remain private';
    END IF;
END $$;

COMMIT;