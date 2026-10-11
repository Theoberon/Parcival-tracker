-- Test helpers (schema "t"). Fixtures run as superuser; t.login() switches to a Supabase-like role.
create schema t;
grant usage on schema t to public;

create function t.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'ASSERT FAILED: %', msg; end if; end $$;

create function t.eq(a anyelement, b anyelement, msg text) returns void language plpgsql as $$
begin
  if a is distinct from b then raise exception 'ASSERT FAILED: % (got %, expected %)', msg, a, b; end if;
end $$;

-- Statement must fail, with a message starting with `code`.
create function t.fails(stmt text, code text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm like code || '%' then return; end if;
    raise exception 'ASSERT FAILED: [%] expected error "%" but got "%"', stmt, code, sqlerrm;
  end;
  raise exception 'ASSERT FAILED: [%] expected error "%" but it succeeded', stmt, code;
end $$;

create function t.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'reset role';
  execute 'set local role authenticated';
end $$;

create function t.login_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'reset role';
  execute 'set local role anon';
end $$;

create function t.login_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'reset role';
  execute 'set local role service_role';
end $$;

create function t.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function t.cid() returns uuid language sql as $$ select id from public.contests order by created_at desc limit 1 $$;
create function t.cat(p_name text) returns uuid language sql as $$
  select id from public.categories where name = p_name and contest_id = t.cid() $$;

create function t.mk_user(p_email text) returns uuid language plpgsql as $$
declare v uuid;
begin insert into auth.users (email) values (p_email) returning id into v; return v; end $$;

create function t.mk_member(p_email text, p_name text) returns uuid language plpgsql as $$
declare v uuid := t.mk_user(p_email);
begin insert into public.members (id, contest_id, email, display_name) values (v, t.cid(), p_email, p_name); return v; end $$;

create function t.mk_admin(p_email text, p_role public.admin_role default 'admin') returns uuid language plpgsql as $$
declare v uuid := t.mk_user(p_email);
begin insert into public.admins (id, email, role) values (v, p_email, p_role); return v; end $$;

-- Move the contest in time. Bypasses guard triggers on purpose (test-only; needs superuser).
create function t.set_times(p_start timestamptz, p_end timestamptz, p_grace int default 10) returns void language plpgsql as $$
begin
  perform set_config('session_replication_role', 'replica', true);
  update public.contests set start_at = p_start, end_at = p_end, grace_minutes = p_grace where id = t.cid();
  perform set_config('session_replication_role', 'origin', true);
end $$;
create function t.state_open() returns void language sql as $$
  select t.set_times(now() - interval '1 day', now() + interval '1 day') $$;
create function t.state_closed() returns void language sql as $$   -- closed, grace already over
  select t.set_times(now() - interval '3 days', now() - interval '1 day') $$;

-- Directly insert a pending submission (superuser fixture, bypasses the RPC).
create function t.mk_pending(p_member uuid, p_cat text, p_ref text, p_at timestamptz default now())
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into public.submissions (id, contest_id, member_id, category_id, reference, reference_normalized, proof_path, status, submitted_at)
  values (v, t.cid(), p_member, t.cat(p_cat), p_ref, '', 'x/' || v, 'pending', p_at);
  return v;
end $$;

-- Role-switching wrappers (call as superuser; they log in, act, log out).
create function t.draft(p_member uuid, p_cat text, p_ref text, p_ext text default 'png', p_resub uuid default null, p_note text default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  perform t.login(p_member);
  select submission_id into v from public.create_submission_draft(t.cat(p_cat), p_ref, p_note, p_ext, p_resub);
  perform t.logout();
  return v;
end $$;

create function t.confirm(p_member uuid, p_id uuid, p_hash text default null) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform t.login_service();
  r := public.confirm_submission_draft(p_member, p_id, p_hash);
  perform t.logout();
  return r;
end $$;

-- draft + confirm in one go; returns the submission id
create function t.submit(p_member uuid, p_cat text, p_ref text, p_hash text default null, p_resub uuid default null) returns uuid
language plpgsql as $$
declare v uuid := t.draft(p_member, p_cat, p_ref, 'png', p_resub); r jsonb;
begin
  r := t.confirm(p_member, v, p_hash);
  if (r ->> 'ok')::boolean is not true then raise exception 'confirm failed: %', r; end if;
  return v;
end $$;

create function t.approve(p_admin uuid, p_id uuid) returns void language plpgsql as $$
begin perform t.login(p_admin); perform public.approve_submission(p_id); perform t.logout(); end $$;
create function t.reject(p_admin uuid, p_id uuid, p_code text default 'incomplete') returns void language plpgsql as $$
begin perform t.login(p_admin); perform public.reject_submission(p_id, p_code, null); perform t.logout(); end $$;

create function t.pts(p_member uuid) returns int language sql as $$
  select coalesce(sum(points_awarded) filter (where status = 'approved'), 0)::int from public.submissions where member_id = p_member $$;

grant execute on all functions in schema t to public;
