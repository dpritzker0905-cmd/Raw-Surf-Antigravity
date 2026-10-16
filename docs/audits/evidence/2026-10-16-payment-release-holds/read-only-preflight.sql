-- Read-only release evidence. This does not apply migrations or create a backup.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';

SELECT clock_timestamp() AS observed_at, current_user, session_user,
       current_setting('transaction_read_only') AS transaction_read_only,
       current_setting('server_version') AS server_version,
       has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public;

SELECT version_num FROM public.alembic_version ORDER BY version_num;
SELECT to_regclass('public.checkout_intents') IS NOT NULL AS checkout_table_present,
       to_regclass('public.payment_reconciliation_cases') IS NOT NULL AS case_table_present,
       to_regclass('ai_budget_private.openai_budget') IS NOT NULL AS budget_table_present;

SELECT initialized, reserved_microdollars FROM ai_budget_private.openai_budget;

SELECT c.table_name, c.data_type, c.character_maximum_length, c.is_nullable
FROM information_schema.columns c
WHERE c.table_schema = 'public' AND c.column_name = 'id'
  AND c.table_name IN ('profiles', 'bookings', 'booking_participants',
                      'payment_transactions', 'credit_transactions',
                      'live_sessions', 'live_session_participants')
ORDER BY c.table_name;

SELECT t.relname, pg_get_constraintdef(k.oid) AS primary_key
FROM pg_constraint k JOIN pg_class t ON t.oid = k.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public' AND k.contype = 'p'
  AND t.relname IN ('profiles', 'bookings', 'booking_participants',
                   'payment_transactions', 'credit_transactions',
                   'live_sessions', 'live_session_participants')
ORDER BY t.relname;

SELECT r, has_schema_privilege(r, 'ai_budget_private', 'USAGE') AS schema_usage,
       has_table_privilege(r, 'ai_budget_private.openai_budget', 'SELECT') AS can_select,
       has_table_privilege(r, 'ai_budget_private.openai_budget', 'INSERT') AS can_insert,
       has_table_privilege(r, 'ai_budget_private.openai_budget', 'UPDATE') AS can_update,
       has_table_privilege(r, 'ai_budget_private.openai_budget', 'DELETE') AS can_delete
FROM (SELECT rolname::text AS r FROM pg_roles
      WHERE rolname IN ('postgres', 'service_role', 'anon', 'authenticated')
         OR rolname = current_user) checked_roles;

SELECT c.relrowsecurity, c.relforcerowsecurity,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'ai_budget_private' AND c.relname = 'openai_budget';

SELECT COALESCE(n.nspname, 'GLOBAL') AS namespace,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
       a.privilege_type, a.is_grantable
FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
CROSS JOIN LATERAL aclexplode(d.defaclacl) a
WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
  AND d.defaclobjtype = 'r' AND (d.defaclnamespace = 0 OR n.nspname = 'public')
ORDER BY 1, 2, 3;
ROLLBACK;
