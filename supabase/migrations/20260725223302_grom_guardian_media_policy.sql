BEGIN;

CREATE TABLE IF NOT EXISTS public.grom_guardians (
    grom_id varchar(36) NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    guardian_id varchar(36) NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    is_primary boolean NOT NULL DEFAULT false,
    verified_at timestamptz NULL,
    revoked_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (grom_id, guardian_id),
    CONSTRAINT grom_guardians_distinct_people CHECK (grom_id <> guardian_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS grom_guardians_one_active_primary ON public.grom_guardians (grom_id) WHERE is_primary AND revoked_at IS NULL;
ALTER TABLE public.grom_guardians ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS visibility varchar(32) NOT NULL DEFAULT 'public';
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS requested_visibility varchar(32);
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS guardian_approval_status varchar(48);
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS guardian_approved_by varchar(36) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS guardian_approved_at timestamptz;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS visibility_changed_at timestamptz;
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_visibility_valid;
ALTER TABLE public.posts ADD CONSTRAINT posts_visibility_valid CHECK (visibility IN ('public', 'followers', 'guardian_only'));
CREATE INDEX IF NOT EXISTS ix_posts_visibility ON public.posts (visibility);
CREATE INDEX IF NOT EXISTS ix_posts_guardian_approval_status ON public.posts (guardian_approval_status);

INSERT INTO storage.buckets (id, name, public) SELECT 'grom_media', 'grom_media', false WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'grom_media');
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'grom_media' AND public IS TRUE) THEN
        RAISE EXCEPTION 'grom_media bucket must be private';
    END IF;
END $$;

INSERT INTO public.grom_guardians (grom_id, guardian_id, is_primary, verified_at, created_at)
SELECT g.id, g.parent_id, true, now(), now()
FROM public.profiles AS g
JOIN public.profiles AS parent ON parent.id = g.parent_id
WHERE g.role = 'GROM' AND g.parent_id IS NOT NULL AND g.parent_link_approved IS TRUE
  AND parent.parent_age_verified IS TRUE AND (parent.role = 'GROM_PARENT' OR parent.is_grom_parent IS TRUE)
ON CONFLICT (grom_id, guardian_id) DO NOTHING;

UPDATE public.posts AS post
SET visibility = 'guardian_only', requested_visibility = COALESCE(post.requested_visibility, 'public'),
    guardian_approval_status = COALESCE(post.guardian_approval_status, 'pending_parent_approval'),
    visibility_changed_at = COALESCE(post.visibility_changed_at, now())
FROM public.profiles AS author
WHERE post.author_id = author.id AND author.role = 'GROM';

COMMIT;
