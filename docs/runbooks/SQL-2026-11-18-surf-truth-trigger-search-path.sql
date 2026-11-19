-- Pin search_path on the two surf-truth append-only trigger functions (Supabase security advisor:
-- "function_search_path_mutable"). Production already has both functions, created before the model pinned it,
-- so the model change alone does not reach them. Apply ONCE, by hand, only after the owner says go.
--
-- Safe: both bodies are `BEGIN RAISE EXCEPTION '...'; END;` and reference no table, type or function, so an empty
-- search_path cannot change what they do. Idempotent: re-running sets the same value. Guarded: a function that
-- does not exist is skipped, never created.

DO $$
BEGIN
  IF to_regprocedure('public.surf_truth_anchor_events_append_only()') IS NOT NULL THEN
    ALTER FUNCTION public.surf_truth_anchor_events_append_only() SET search_path = '';
  END IF;
  IF to_regprocedure('public.surf_truth_admin_actions_append_only()') IS NOT NULL THEN
    ALTER FUNCTION public.surf_truth_admin_actions_append_only() SET search_path = '';
  END IF;
END
$$;

-- Verify: both rows must show search_path="" in proconfig.
SELECT p.proname, p.proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('surf_truth_anchor_events_append_only', 'surf_truth_admin_actions_append_only');

-- And the logs still refuse a rewrite (each must ERROR with "... is append-only"; run inside a transaction you roll
-- back):  BEGIN; DELETE FROM public.surf_truth_anchor_events WHERE false; ROLLBACK;
-- (a DELETE matching no rows fires no ROW trigger; use the post-deploy check in the T1 log for the full proof).
