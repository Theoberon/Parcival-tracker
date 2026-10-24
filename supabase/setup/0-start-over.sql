-- ONLY IF you need to start the database setup again on a project that has NO real data yet
-- (for example a part failed halfway and you want a clean slate).
-- It deletes every table, function and type this app created. It does not touch your Auth users,
-- the `proofs` storage bucket (empty it or delete it in Storage if you want it gone) or other projects.
-- After it runs, do parts 1 to 6 again in order.

drop table if exists audit_log, key_requests, login_failures, submissions, categories, members, admins, contests, platform_admins, organizations cascade;
drop type if exists contest_status, submission_status, admin_role, actor_type cascade;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')   -- keep extension functions (citext)
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $$;

drop policy if exists proofs_select on storage.objects;
