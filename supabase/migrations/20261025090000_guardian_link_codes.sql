BEGIN;

-- Two-sided guardian link proofs (child-generated codes and parent-initiated invites). No secret is stored:
-- code_hash is a keyed hash. See docs/runbooks/GUARDIAN-LEVELS.md.
CREATE TABLE IF NOT EXISTS public.guardian_link_codes (
    id varchar(36) PRIMARY KEY,
    grom_id varchar(36) NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    kind varchar(16) NOT NULL CHECK (kind IN ('child_code', 'parent_invite')),
    guardian_id varchar(36) NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    code_hash varchar(64) NULL UNIQUE,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz NULL,
    consumed_by varchar(36) NULL,
    revoked_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS ix_guardian_link_codes_grom_id ON public.guardian_link_codes (grom_id);
CREATE INDEX IF NOT EXISTS ix_guardian_link_codes_guardian_id ON public.guardian_link_codes (guardian_id);
CREATE INDEX IF NOT EXISTS ix_guardian_link_codes_open ON public.guardian_link_codes (grom_id, kind, consumed_at, revoked_at);
ALTER TABLE public.guardian_link_codes ENABLE ROW LEVEL SECURITY;

-- The permanent per-child code is retired (codes are now generated on request and expire in 48 hours).
-- Existing values are cleared so an old code cannot be used or read back.
UPDATE public.profiles SET guardian_code = NULL WHERE guardian_code IS NOT NULL;

-- is_grom_parent is now a server-maintained cache of "has at least one confirmed guardian link" (it was a flag any
-- adult could set on their own profile). Recompute it once: a dedicated GROM_PARENT account stays a parent account.
UPDATE public.profiles AS p
SET is_grom_parent = EXISTS (
    SELECT 1 FROM public.profiles AS c
    WHERE c.parent_id = p.id AND c.role = 'GROM' AND c.parent_link_approved IS TRUE
)
WHERE p.role NOT IN ('GROM', 'GROM_PARENT')
  AND p.is_grom_parent IS DISTINCT FROM EXISTS (
    SELECT 1 FROM public.profiles AS c
    WHERE c.parent_id = p.id AND c.role = 'GROM' AND c.parent_link_approved IS TRUE
);

COMMIT;
