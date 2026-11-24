-- READ-ONLY security audit. Changes nothing.
-- Supabase: SQL Editor -> New query -> paste -> Run, then copy the single result cell back to Claude.
-- (schema.sql in this repo is older than the live database, so this shows what is really deployed.)
select jsonb_pretty(jsonb_build_object(
  -- Tables in public and whether Row Level Security is on
  'tables', (select jsonb_agg(jsonb_build_object(
      'table', c.relname, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity) order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','v','m')),
  -- What the website's roles may do on each table
  'table_grants', (select jsonb_agg(jsonb_build_object(
      'table', table_name, 'role', grantee, 'privilege', privilege_type) order by table_name, grantee)
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon','authenticated')),
  -- Every RLS policy (who can read / write which rows)
  'policies', (select jsonb_agg(jsonb_build_object(
      'schema', schemaname, 'table', tablename, 'name', policyname, 'cmd', cmd,
      'roles', roles, 'using', qual, 'check', with_check) order by schemaname, tablename)
    from pg_policies where schemaname in ('public','storage')),
  -- Every function the website can call, with its full source
  'functions', (select jsonb_agg(jsonb_build_object(
      'name', p.proname, 'args', pg_get_function_identity_arguments(p.oid),
      'security_definer', p.prosecdef, 'config', p.proconfig,
      'anon_can_run', has_function_privilege('anon', p.oid, 'execute'),
      'authenticated_can_run', has_function_privilege('authenticated', p.oid, 'execute'),
      'source', pg_get_functiondef(p.oid)) order by p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'),
  -- Triggers that guard columns (role, status, payment fields)
  'triggers', (select jsonb_agg(jsonb_build_object(
      'table', event_object_table, 'name', trigger_name, 'timing', action_timing,
      'event', event_manipulation, 'action', action_statement) order by event_object_table)
    from information_schema.triggers where trigger_schema = 'public'),
  -- Columns, so policies can be checked against what is actually stored
  'columns', (select jsonb_object_agg(t, cols) from (
      select table_name t, jsonb_agg(column_name order by ordinal_position) cols
      from information_schema.columns where table_schema = 'public' group by table_name) x),
  'buckets', (select jsonb_agg(jsonb_build_object('id', id, 'public', public,
      'size_limit', file_size_limit, 'mime_types', allowed_mime_types)) from storage.buckets)
)) as audit;
