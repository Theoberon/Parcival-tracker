begin;
savepoint sp;

-- Privilege matrix: checked against the catalog, so a forgotten grant is caught for every object.
do $$
declare r record; allowed_rpcs text[] := array[
  'get_leaderboard','get_admin_leaderboard','get_contest_banner','create_submission_draft','withdraw_submission',
  'my_resubmission_allowance','my_submissions','claim_submission','approve_submission','reject_submission',
  'reverse_submission','correct_rejection','grant_override','set_member_active','upsert_category',
  'set_category_active','update_contest_setup','set_points_unlocked','extend_deadline','end_contest','publish_final',
  'reopen_contest','owner_mark_exported','archive_contest','owner_add_admin','owner_set_admin_active',
  'is_admin','is_owner','is_member','is_platform_admin','current_organization_id',
  'current_contest_id','is_org_admin','is_org_owner','platform_owner_create_organization',
  'create_next_contest','get_contest_history'];
begin
  -- anon: no table privileges, no function privileges (in the whole public schema)
  for r in select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','v','m','S') loop
    perform t.ok(not has_table_privilege('anon', r.oid, 'select,insert,update,delete,truncate,references,trigger'), 'anon has no privileges on ' || r.relname);
  end loop;
  for r in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop   -- ours, not citext's
    perform t.ok(not has_function_privilege('anon', r.oid, 'execute'), 'anon cannot execute ' || r.proname);
    perform t.ok(not has_function_privilege('public', r.oid, 'execute'), 'PUBLIC cannot execute ' || r.proname);
    perform t.eq(has_function_privilege('authenticated', r.oid, 'execute'), r.proname = any (allowed_rpcs),
                 'authenticated execute privilege for ' || r.proname);
  end loop;
  -- authenticated: SELECT on six tables only, never a write
  for r in select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','S') loop
    perform t.ok(not has_table_privilege('authenticated', r.oid, 'insert,update,delete,truncate'), 'authenticated cannot write ' || r.relname);
    perform t.eq(has_table_privilege('authenticated', r.oid, 'select'),
                 r.relname in ('contests','members','admins','categories','submissions','audit_log','organizations'),
                 'authenticated select on ' || r.relname);
  end loop;
  -- every table has RLS on
  for r in select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' loop
    perform t.ok(r.relrowsecurity, 'RLS enabled on ' || r.relname);
  end loop;
  -- service role cannot rewrite the audit log either
  perform t.ok(not has_table_privilege('service_role', 'public.audit_log', 'insert,update,delete,truncate'), 'service_role cannot write audit_log');
  perform t.ok(has_table_privilege('service_role', 'public.submissions', 'select,insert,update,delete'), 'service_role keeps normal access');
  perform t.ok(not has_table_privilege('authenticated', 'public.contest_history', 'select,insert,update,delete'), 'history table is not directly accessible');
  perform t.ok(has_table_privilege('service_role', 'public.contest_history', 'select'), 'cleanup can read expired history');
  perform t.ok(not has_table_privilege('service_role', 'public.contest_history', 'delete'), 'cleanup must use the expiry-checked RPC');
  perform t.ok(has_function_privilege('service_role', 'public.purge_expired_contest_history(uuid[])', 'execute'), 'service role can purge expired history');
  perform t.ok(not has_function_privilege('authenticated', 'public.purge_expired_contest_history(uuid[])', 'execute'), 'users cannot purge history');
end $$;
rollback to sp;
savepoint sp;

-- A function added by any future migration starts closed (nobody but its owner and the service role).
do $$
declare oid_ oid;
begin
  create function public._future_default_probe() returns int language sql as 'select 1';
  oid_ := 'public._future_default_probe()'::regprocedure;
  perform t.ok(not has_function_privilege('public', oid_, 'execute'), 'new functions are not executable by PUBLIC');
  perform t.ok(not has_function_privilege('anon', oid_, 'execute'), 'new functions are not executable by anon');
  perform t.ok(not has_function_privilege('authenticated', oid_, 'execute'), 'new functions are not executable by authenticated');
end $$;
rollback to sp;
savepoint sp;

-- Behaviour per role.
do $$
declare a uuid; b uuid; adm uuid; own uuid; ghost uuid; sa uuid; sb uuid; tbl text; n int;
begin
  perform t.state_open();
  a := t.mk_member('a@x.test', 'Ann'); b := t.mk_member('b@x.test', 'Ben');
  adm := t.mk_admin('adm@x.test'); own := t.mk_admin('own@x.test', 'owner');
  ghost := t.mk_user('ghost@x.test');   -- valid login, but neither member nor admin
  sa := t.submit(a, 'New Account', 'acct_a'); sb := t.submit(b, 'New Account', 'acct_b');
  update categories set active = false where id = t.cat('New Gig');
  insert into storage.objects (bucket_id, name) values
    ('proofs', t.cid() || '/' || a || '/' || sa || '.png'), ('proofs', t.cid() || '/' || b || '/' || sb || '.png');

  -- anon
  perform t.login_anon();
  foreach tbl in array array['contests','members','admins','categories','submissions','audit_log','organizations','key_requests','login_failures'] loop
    perform t.fails('select * from public.' || tbl, 'permission denied');
  end loop;
  perform t.fails($q$select * from get_leaderboard()$q$, 'permission denied');
  perform t.fails($q$select * from my_submissions()$q$, 'permission denied');
  perform t.fails(format($q$select approve_submission(%L)$q$, sa), 'permission denied');
  perform t.fails($q$select is_admin()$q$, 'permission denied');
  perform t.eq((select count(*) from storage.objects)::int, 0, 'anon sees no storage objects');
  perform t.logout();

  -- member A
  perform t.login(a);
  perform t.eq((select count(*) from submissions)::int, 1, 'member sees only own submissions');
  perform t.eq((select id from submissions), sa, 'own submission');
  perform t.eq((select count(*) from members)::int, 1, 'member sees only own row');
  perform t.eq((select count(*) from admins)::int, 0, 'member sees no admins');
  perform t.eq((select count(*) from audit_log)::int, 0, 'member sees no audit log');
  perform t.eq((select count(*) from contests)::int, 1, 'member sees the contest');
  perform t.ok((select bool_and(active) from categories), 'member sees only active categories');
  perform t.eq((select count(*) from categories)::int, 3, '3 active categories');
  perform t.eq((select count(*) from storage.objects)::int, 1, 'member sees only own proof files');
  perform t.fails($q$select * from key_requests$q$, 'permission denied');
  perform t.fails($q$insert into submissions (contest_id, member_id, category_id, reference, proof_path) select contest_id, member_id, category_id, 'x', 'x' from submissions$q$, 'permission denied');
  perform t.fails($q$update members set display_name = 'Hacked'$q$, 'permission denied');
  perform t.fails($q$update submissions set status = 'approved'$q$, 'permission denied');
  perform t.fails($q$delete from submissions$q$, 'permission denied');
  perform t.fails($q$update categories set points = 99$q$, 'permission denied');
  perform t.fails($q$insert into admins (id, email, role) values (gen_random_uuid(), 'x@x', 'owner')$q$, 'permission denied');
  perform t.fails($q$insert into storage.objects (bucket_id, name) values ('proofs', 'x/y/z.png')$q$, 'new row violates row-level security');
  perform t.fails(format($q$select approve_submission(%L)$q$, sb), 'forbidden');
  perform t.fails(format($q$select reject_submission(%L, 'other', 'x')$q$, sb), 'forbidden');
  perform t.fails(format($q$select claim_submission(%L)$q$, sb), 'forbidden');
  perform t.fails(format($q$select grant_override(%L, 'x')$q$, sb), 'forbidden');
  perform t.fails($q$select get_admin_leaderboard()$q$, 'forbidden');
  perform t.fails($q$select upsert_category(null, 'X', 1, 'l', 'h', 1)$q$, 'forbidden');
  perform t.fails(format($q$select set_member_active(%L, false)$q$, b), 'forbidden');
  perform t.fails($q$select set_points_unlocked(true, 'x')$q$, 'forbidden');
  perform t.fails(format($q$select withdraw_submission(%L)$q$, sb), 'not_found');
  perform t.fails($q$select confirm_submission_draft(gen_random_uuid(), gen_random_uuid(), 'h')$q$, 'permission denied');
  perform t.fails($q$select revoke_user_sessions(gen_random_uuid())$q$, 'permission denied');
  perform t.fails($q$select auth_user_id_by_email('b@x.test')$q$, 'permission denied');
  perform t.fails($q$select rate_limit_key_request('a@x.test', '1.1.1.1')$q$, 'permission denied');
  perform t.fails($q$select * from _standings(public.current_contest_id())$q$, 'permission denied');
  perform t.fails($q$select hook_password_verification_attempt('{}'::jsonb)$q$, 'permission denied');
  perform t.fails($q$select * from auth.users$q$, 'permission denied');
  perform t.logout();

  -- authenticated user who is not a member/admin sees nothing and can do nothing
  perform t.login(ghost);
  perform t.eq((select count(*) from contests)::int, 0, 'ghost: no contests');
  perform t.eq((select count(*) from categories)::int, 0, 'ghost: no categories');
  perform t.eq((select count(*) from submissions)::int, 0, 'ghost: no submissions');
  perform t.eq((select count(*) from members)::int, 0, 'ghost: no members');
  perform t.eq((select count(*) from storage.objects)::int, 0, 'ghost: no files');
  perform t.fails($q$select * from get_leaderboard()$q$, 'forbidden');
  perform t.fails($q$select * from get_contest_banner()$q$, 'forbidden');
  perform t.logout();

  -- admin (not owner)
  perform t.login(adm);
  perform t.eq((select count(*) from submissions)::int, 2, 'admin sees all submissions');
  perform t.eq((select count(*) from members)::int, 2, 'admin sees all members');
  perform t.ok((select count(*) from audit_log) > 0, 'admin reads audit log');
  perform t.eq((select count(*) from categories)::int, 4, 'admin sees inactive categories too');
  perform t.eq((select count(*) from storage.objects)::int, 2, 'admin reads all proof files');
  perform t.fails($q$select * from key_requests$q$, 'permission denied');
  perform t.fails($q$update submissions set status = 'approved'$q$, 'permission denied');
  perform t.fails($q$select set_points_unlocked(true, 'x')$q$, 'forbidden');
  perform t.fails($q$select extend_deadline(now() + interval '9 days', 'x')$q$, 'forbidden');
  perform t.fails($q$select end_contest('x')$q$, 'forbidden');
  perform t.fails($q$select update_contest_setup('n', now(), now() + interval '1 day', 5)$q$, 'forbidden');
  perform t.fails($q$select publish_final('x')$q$, 'forbidden');
  perform t.fails($q$select reopen_contest('x')$q$, 'forbidden');
  perform t.fails($q$select archive_contest('x')$q$, 'forbidden');
  perform t.fails($q$select owner_mark_exported()$q$, 'forbidden');
  perform t.fails(format($q$select owner_add_admin(%L, 'new@x.test', 'admin')$q$, gen_random_uuid()), 'forbidden');
  perform t.fails(format($q$select owner_set_admin_active(%L, false)$q$, own), 'forbidden');
  perform t.logout();

  -- citext comparisons (email filters in the admin UI) must work for end-user roles
  perform t.login(adm);
  perform t.eq((select count(*) from members where email = 'A@X.test')::int, 1, 'admin can filter members by email (citext)');
  perform t.logout();
  perform t.login(a);
  perform t.eq((select count(*) from members where email = 'A@X.test')::int, 1, 'member can filter own row by email (citext)');
  perform t.logout();

  -- owner can
  perform t.login(own);
  perform set_points_unlocked(true, 'testing');
  perform t.logout();
  perform t.ok((select points_unlocked from contests), 'owner unlocked points');

  -- revoked access takes effect immediately (RLS checks the active flags, not just the JWT)
  update members set active = false where id = a;
  perform t.login(a);
  perform t.eq((select count(*) from submissions)::int, 0, 'deactivated member: no submissions');
  perform t.eq((select count(*) from storage.objects)::int, 0, 'deactivated member: no files');
  perform t.eq((select count(*) from categories)::int, 0, 'deactivated member: no categories');
  perform t.fails($q$select * from get_leaderboard()$q$, 'forbidden');
  perform t.fails($q$select * from my_submissions()$q$, 'forbidden');
  perform t.fails($q$select create_submission_draft(t.cat('New Account'), 'z', null, 'png')$q$, 'not_member');
  perform t.logout();
  update admins set active = false where id = adm;
  perform t.login(adm);
  perform t.eq((select count(*) from submissions)::int, 0, 'removed admin: no submissions');
  perform t.eq((select count(*) from audit_log)::int, 0, 'removed admin: no audit log');
  perform t.fails(format($q$select approve_submission(%L)$q$, sb), 'forbidden');
  perform t.logout();
end $$;
rollback to sp;
rollback;
