-- P1 private-media migration: direct messages and booking crew chat only.
--
-- Prerequisites:
--   1. Deploy the application code that stores supabase:// references and signs
--      them only from a member-authorized message-history response.
--   2. Run the four SELECT statements below and investigate any media URLs that
--      are neither Supabase public URLs nor intentional local-development data.
--   3. Execute this script once in the production Supabase SQL editor.
--
-- Do not apply this to gallery, stories, avatars, feed, or conditions. Their
-- product visibility contracts have not been migrated.

SELECT count(*) AS direct_message_urls_to_backfill
FROM public.messages
WHERE media_url LIKE '%/storage/v1/object/public/chat_media/%';

SELECT count(*) AS crew_message_urls_to_backfill
FROM public.crew_chat_messages
WHERE media_url LIKE '%/storage/v1/object/public/crew_chat/%';

SELECT count(*) AS direct_message_thumbnail_urls_to_backfill
FROM public.messages
WHERE media_thumbnail_url LIKE '%/storage/v1/object/public/chat_media/%';

SELECT count(*) AS crew_message_thumbnail_urls_to_backfill
FROM public.crew_chat_messages
WHERE media_thumbnail_url LIKE '%/storage/v1/object/public/crew_chat/%';

BEGIN;

UPDATE public.messages
SET media_url = regexp_replace(
    media_url,
    '^https?://[^/]+/storage/v1/object/public/chat_media/',
    'supabase://chat_media/'
)
WHERE media_url LIKE '%/storage/v1/object/public/chat_media/%';

UPDATE public.crew_chat_messages
SET media_url = regexp_replace(
    media_url,
    '^https?://[^/]+/storage/v1/object/public/crew_chat/',
    'supabase://crew_chat/'
)
WHERE media_url LIKE '%/storage/v1/object/public/crew_chat/%';

UPDATE public.messages
SET media_thumbnail_url = regexp_replace(
    media_thumbnail_url,
    '^https?://[^/]+/storage/v1/object/public/chat_media/',
    'supabase://chat_media/'
)
WHERE media_thumbnail_url LIKE '%/storage/v1/object/public/chat_media/%';

UPDATE public.crew_chat_messages
SET media_thumbnail_url = regexp_replace(
    media_thumbnail_url,
    '^https?://[^/]+/storage/v1/object/public/crew_chat/',
    'supabase://crew_chat/'
)
WHERE media_thumbnail_url LIKE '%/storage/v1/object/public/crew_chat/%';

-- Service-role uploads and signing bypass Storage RLS. No anonymous SELECT
-- policy is added: a signed URL can only be minted after application-level
-- conversation or booking-membership authorization.
UPDATE storage.buckets
SET public = false
WHERE id IN ('chat_media', 'crew_chat');

COMMIT;
