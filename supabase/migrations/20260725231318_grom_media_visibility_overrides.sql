BEGIN;

ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS guardian_visibility_cap varchar(32);
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS guardian_override_by varchar(36) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS guardian_override_at timestamptz;
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_guardian_visibility_cap_valid;
ALTER TABLE public.posts ADD CONSTRAINT posts_guardian_visibility_cap_valid CHECK (guardian_visibility_cap IS NULL OR guardian_visibility_cap IN ('public', 'followers', 'guardian_only'));

ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS visibility varchar(32) NOT NULL DEFAULT 'public';
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS requested_visibility varchar(32);
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS guardian_approval_status varchar(48);
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS guardian_approved_by varchar(36) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS guardian_approved_at timestamptz;
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS guardian_visibility_cap varchar(32);
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS guardian_override_by varchar(36) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS guardian_override_at timestamptz;
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS visibility_changed_at timestamptz;
ALTER TABLE public.stories DROP CONSTRAINT IF EXISTS stories_visibility_valid;
ALTER TABLE public.stories ADD CONSTRAINT stories_visibility_valid CHECK (visibility IN ('public', 'followers', 'guardian_only'));
ALTER TABLE public.stories DROP CONSTRAINT IF EXISTS stories_guardian_visibility_cap_valid;
ALTER TABLE public.stories ADD CONSTRAINT stories_guardian_visibility_cap_valid CHECK (guardian_visibility_cap IS NULL OR guardian_visibility_cap IN ('public', 'followers', 'guardian_only'));
CREATE INDEX IF NOT EXISTS ix_stories_visibility ON public.stories (visibility);
CREATE INDEX IF NOT EXISTS ix_stories_guardian_approval_status ON public.stories (guardian_approval_status);

UPDATE public.stories AS story
SET visibility = 'guardian_only', requested_visibility = COALESCE(story.requested_visibility, 'public'),
    guardian_approval_status = COALESCE(story.guardian_approval_status, 'pending_parent_approval'),
    visibility_changed_at = COALESCE(story.visibility_changed_at, now())
FROM public.profiles AS author
WHERE story.author_id = author.id AND author.role = 'GROM';

COMMIT;
