BEGIN;

-- Guardian program PR 2: a child's profile is public only at the public-profile level for their age band
-- (13-15 and under 13: a verified guardian; 16-17: a linked guardian). New Grom signups already start private.
-- This makes EXISTING public Grom profiles private unless they already meet that level. A guardian or the child can
-- switch it back on once the level is met; nothing else about the account changes. Adults (18+) are not touched.
UPDATE public.profiles AS g
SET is_private = true
WHERE g.role = 'GROM'
  AND g.is_private IS NOT TRUE
  AND (g.birthdate IS NULL OR g.birthdate > (current_date - interval '18 years'))
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.id = g.parent_id
      AND g.parent_link_approved IS TRUE
      AND p.role <> 'GROM'
      AND (
        p.parent_age_verified IS TRUE
        OR (g.birthdate IS NOT NULL
            AND g.birthdate <= (current_date - interval '16 years')
            AND g.birthdate > (current_date - interval '18 years'))
      )
  );

COMMIT;
