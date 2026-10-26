begin;
savepoint sp;

do $$
declare
  org_a uuid;
  org_b uuid;
  contest_a uuid;
  contest_b uuid;
  category_a uuid;
  category_b uuid;
  member_a uuid;
  member_b uuid;
  owner_a uuid;
  owner_b uuid;
  platform_user uuid;
  ghost uuid;
  created_org uuid;
  created_contest uuid;
  submission_a uuid := gen_random_uuid();
  submission_b uuid := gen_random_uuid();
begin
  select id into org_a from organizations where slug = 'default';
  select id into contest_a from contests where organization_id = org_a order by created_at desc limit 1;

  insert into organizations (name, slug) values ('Second organisation', 'second-org')
  returning id into org_b;
  insert into contests (organization_id, name, start_at, end_at)
  values (org_b, 'Second contest', now() - interval '1 day', now() + interval '1 day')
  returning id into contest_b;

  insert into categories (contest_id, name, points, reference_label, reference_hint, sort_order)
  values (contest_b, 'Second category', 1, 'Reference', '', 1)
  returning id into category_b;
  select id into category_a from categories where contest_id = contest_a order by sort_order limit 1;

  member_a := t.mk_user('member-a@org.test');
  member_b := t.mk_user('member-b@org.test');
  insert into members (id, contest_id, email, display_name)
  values (member_a, contest_a, 'member-a@org.test', 'Member A'),
         (member_b, contest_b, 'member-b@org.test', 'Member B');
  perform t.eq((select organization_id from members where id = member_a), org_a,
               'member organisation is derived from its contest');
  perform t.eq((select organization_id from members where id = member_b), org_b,
               'second member organisation is derived from its contest');

  owner_a := t.mk_admin('owner-a@org.test', 'owner');
  owner_b := t.mk_user('owner-b@org.test');
  insert into admins (id, email, role, organization_id)
  values (owner_b, 'owner-b@org.test', 'owner', org_b);
  platform_user := t.mk_user('platform@org.test');
  insert into platform_admins (id, email) values (platform_user, 'platform@org.test');
  ghost := t.mk_user('unassigned@org.test');

  insert into submissions (id, contest_id, member_id, category_id, reference,
                           reference_normalized, proof_path, status, submitted_at)
  values
    (submission_a, contest_a, member_a, category_a, 'a', 'a', contest_a || '/' || member_a || '/a.png', 'pending', now()),
    (submission_b, contest_b, member_b, category_b, 'b', 'b', contest_b || '/' || member_b || '/b.png', 'pending', now());
  insert into storage.objects (bucket_id, name)
  values ('proofs', contest_a || '/' || member_a || '/a.png'),
         ('proofs', contest_b || '/' || member_b || '/b.png');

  perform set_config('session_replication_role', 'replica', true);
  update contests
  set start_at = now() - interval '1 day', end_at = now() + interval '1 day'
  where id in (contest_a, contest_b);
  perform set_config('session_replication_role', 'origin', true);

  perform t.login(member_a);
  perform t.eq(current_organization_id(), org_a, 'member maps to their organisation');
  perform t.eq(current_contest_id(), contest_a, 'member maps to their contest');
  perform t.eq(current_contest_id(org_b), null::uuid, 'member cannot resolve another organisation contest');
  perform t.eq((select count(*) from organizations)::int, 1, 'member sees only their organisation');
  perform t.eq((select count(*) from contests)::int, 1, 'member sees only their organisation contest');
  perform t.eq((select count(*) from members)::int, 1, 'member sees no other organisation members');
  perform t.eq((select count(*) from submissions)::int, 1, 'member sees only their submissions');
  perform t.eq((select id from submissions), submission_a, 'member submission is own');
  perform t.eq((select count(*) from storage.objects)::int, 1, 'member sees only own organisation proof');
  perform t.ok(not is_admin(), 'member is not an organisation admin');
  perform set_config('request.headers', jsonb_build_object('x-organization-id', org_b)::text, true);
  perform t.eq(current_organization_id(), org_a, 'ordinary member cannot switch organisations with a request header');
  perform set_config('request.headers', '{}'::text, true);
  perform t.logout();

  perform t.login(owner_a);
  perform t.eq(current_organization_id(), org_a, 'admin maps to their organisation');
  perform t.eq((select count(*) from organizations)::int, 1, 'admin sees only their organisation');
  perform t.eq((select count(*) from members)::int, 1, 'admin sees no other organisation members');
  perform t.eq((select count(*) from admins)::int, 1, 'admin sees no other organisation admins');
  perform t.eq((select count(*) from submissions)::int, 1, 'admin sees no other organisation submissions');
  perform t.eq((select count(*) from storage.objects)::int, 1, 'admin sees no other organisation proofs');
  perform t.ok(is_admin(), 'organisation admin is recognised in own organisation');
  perform t.eq((select count(distinct organization_id)::int from get_running_organization_leaderboards()), 2,
               'admin can compare all running organisation leaderboards');
  perform t.eq((select organization_id from get_running_organization_leaderboards()
                order by is_current_organization desc, organization_name limit 1), org_a,
               'admin own organisation leaderboard is first');
  perform t.eq((select count(*)::int from get_running_organization_leaderboards()
                where organization_id = org_b and display_name = 'Member B'), 1,
               'admin sees leaderboard entries from another running organisation');
  perform t.fails(format($q$select owner_set_admin_active(%L, false)$q$, owner_b), 'not_found');
  perform t.logout();

  perform t.login(member_a);
  perform t.fails($q$select * from get_running_organization_leaderboards()$q$, 'forbidden');
  perform t.logout();

  perform t.login(owner_b);
  perform t.eq(current_organization_id(), org_b, 'second admin maps to the second organisation');
  perform t.eq((select count(*) from members)::int, 1, 'second admin sees only their own organisation');
  perform t.eq((select id from members), member_b, 'second organisation member is visible');
  perform t.logout();

  perform t.login(platform_user);
  perform t.eq(current_organization_id(), null::uuid, 'platform admin has no implicit tenant');
  perform t.ok(not is_admin(), 'platform admin is not implicitly a contest admin');
  perform t.eq((select count(*) from organizations)::int, 2, 'platform admin can list organisation metadata');
  perform t.eq((select count(*) from contests)::int, 0, 'platform admin receives no tenant contest access');
  perform set_config('request.headers', jsonb_build_object('x-organization-id', org_b)::text, true);
  perform t.eq(current_organization_id(), org_b, 'platform admin can select an organisation through its request context');
  perform t.ok(is_admin() and is_owner(), 'platform admin has owner permissions in the selected organisation');
  perform t.eq((select organization_id from get_running_organization_leaderboards()
                order by is_current_organization desc, organization_name limit 1), org_b,
               'platform owner selected organisation leaderboard is first');
  perform t.eq((select count(*) from members)::int, 1, 'selected organisation context remains tenant-scoped');
  perform set_config('request.headers', '{}'::text, true);
  select organization_id, contest_id into created_org, created_contest
  from platform_owner_create_organization(
    'Created through dashboard', 'created-through-dashboard', 'First contest',
    now() + interval '7 days', now() + interval '37 days'
  );
  perform t.logout();
  perform t.eq((select count(*) from contests where id = created_contest and organization_id = created_org), 1::bigint,
               'platform owner creates the organisation and its initial contest');
  perform t.eq((select count(*) from categories where contest_id = created_contest), 4::bigint,
               'new organisation receives the default task categories');

  perform t.login(platform_user);
  perform t.fails(
    $q$select * from platform_owner_create_organization(
      'Duplicate', 'created-through-dashboard', 'Contest', now() + interval '7 days', now() + interval '37 days'
    )$q$,
    'organization_slug_taken'
  );
  perform t.fails(
    $q$select * from platform_owner_create_organization(
      'Bad dates', 'bad-dates', 'Contest', now() + interval '37 days', now() + interval '7 days'
    )$q$,
    'invalid_dates'
  );
  perform t.logout();

  perform t.login(ghost);
  perform t.eq(current_organization_id(), null::uuid, 'unassigned identity has no fallback organisation');
  perform t.eq(current_contest_id(), null::uuid, 'unassigned identity has no fallback contest');
  perform t.eq((select count(*) from organizations)::int, 0, 'unassigned identity sees no organisation');
  perform t.eq((select count(*) from contests)::int, 0, 'unassigned identity sees no contest');
  perform t.fails(
    $q$select * from platform_owner_create_organization(
      'Not allowed', 'not-allowed', 'Contest', now() + interval '7 days', now() + interval '37 days'
    )$q$,
    'forbidden'
  );
  perform t.logout();

  perform t.fails(
    format($q$insert into submissions (contest_id, member_id, category_id, reference, reference_normalized, proof_path)
      values (%L, %L, %L, 'cross-org', 'cross-org', 'x')$q$, contest_a, member_b, category_a),
    'insert or update on table'
  );
  perform t.fails(
    format($q$insert into members (id, contest_id, email, display_name, organization_id)
      values (gen_random_uuid(), %L, 'bad-org@org.test', 'Bad', %L)$q$, contest_a, org_b),
    'organization_mismatch'
  );
  perform t.fails(
    format($q$insert into admins (id, email, role, organization_id)
      values (%L, 'member-a@org.test', 'admin', %L)$q$, member_a, org_b),
    'identity_organization_conflict'
  );
  insert into admins (id, email, role, organization_id)
  values (member_a, 'member-a@org.test', 'admin', org_a);
end $$;

rollback to sp;
savepoint sp;

do $$
declare
  org_id uuid;
  old_id uuid;
  new_id uuid;
  owner_id uuid;
  other_org_id uuid;
  other_owner_id uuid;
  member_id uuid;
  roster_only_id uuid;
  category_id uuid;
  v_password_hash text := 'preserved-auth-hash';
  history_row record;
begin
  select id into org_id from organizations where slug = 'default';
  select id into old_id from contests where organization_id = org_id order by created_at desc limit 1;
  owner_id := t.mk_admin('next-owner@org.test', 'owner');
  perform t.login(owner_id);
  perform t.fails(
    $q$select create_next_contest('Too soon', now(), now() + interval '30 days', 'test')$q$,
    'contest_not_final'
  );
  perform t.logout();
  member_id := t.mk_user('returning-member@next.test');
  update auth.users u set encrypted_password = v_password_hash where u.id = member_id;
  select id into category_id from categories where contest_id = old_id order by sort_order limit 1;
  insert into members (id, contest_id, email, display_name)
  values (member_id, old_id, 'returning-member@next.test', 'Returning Member');
  insert into submissions (
    contest_id, member_id, category_id, reference, reference_normalized, proof_path,
    status, points_awarded, submitted_at
  ) values (
    old_id, member_id, category_id, 'account-1', 'account-1',
    old_id || '/' || member_id || '/proof.png', 'approved', 2, now()
  );
  perform set_config('session_replication_role', 'replica', true);
  update contests set manual_status = 'final', finalized_at = now() where id = old_id;
  perform set_config('session_replication_role', 'origin', true);
  roster_only_id := t.mk_user('roster-only@next.test');
  perform t.login_service();
  perform t.eq(
    (select id from register_organization_member(
      org_id, roster_only_id, 'roster-only@next.test', 'Returning Member', null
    )),
    roster_only_id,
    'service onboarding accepts a member while the contest is final'
  );
  perform t.eq((select count(*)::int from members where id = roster_only_id), 0,
               'closed-contest onboarding waits in the organisation roster');
  perform t.logout();

  perform t.login(member_id);
  perform t.fails(
    $q$select create_next_contest('Next', now(), now() + interval '30 days', 'test')$q$,
    'forbidden'
  );
  perform t.logout();
  perform t.login(owner_id);
  new_id := create_next_contest('Next contest', now() - interval '1 minute', now() + interval '30 days', 'Starting the next season');
  perform t.eq(current_contest_id(), new_id, 'new contest becomes current in the selected organisation');
  perform t.eq((select contest_id from members where id = member_id), new_id, 'existing member account is moved forward');
  perform t.eq((select contest_id from members where id = roster_only_id), new_id,
               'roster-only member is automatically enrolled in the next contest');
  perform t.eq((select display_name from members where id = roster_only_id), 'Returning Member 2',
               'duplicate roster names are made unique in the new contest');
  perform t.eq((select display_name from organization_members where id = roster_only_id), 'Returning Member 2',
               'unique display name remains on the organisation roster');
  perform t.eq((select encrypted_password from auth.users where id = member_id), v_password_hash, 'existing login key hash is unchanged');
  perform t.eq((select count(*) from submissions where contest_id = old_id)::int, 0, 'old submissions leave live tables');
  perform t.eq((select count(*) from categories where contest_id = old_id)::int, 0, 'old categories leave live tables');
  perform t.eq((select count(*) from categories where contest_id = new_id)::int, 4, 'new contest receives standard categories');
  select * into history_row from get_contest_history() where source_contest_id = old_id;
  perform t.eq(history_row.expires_at, history_row.available_at + interval '7 days', 'retention lasts seven days from the new contest start');
  perform t.eq((history_row.standings -> 0 ->> 'display_name'), 'Returning Member', 'previous results are snapshotted');
  perform t.eq((select count(*)::int from get_contest_history()), 1, 'owner can view history after the new contest starts');
  perform t.logout();

  insert into organizations (name, slug) values ('History isolation', 'history-isolation')
  returning id into other_org_id;
  insert into contests (organization_id, name, start_at, end_at)
  values (other_org_id, 'Other organisation contest', now(), now() + interval '30 days');
  other_owner_id := t.mk_user('other-owner@history.test');
  insert into admins (id, email, role, organization_id)
  values (other_owner_id, 'other-owner@history.test', 'owner', other_org_id);
  perform t.login(other_owner_id);
  perform t.eq((select count(*)::int from get_contest_history()), 0, 'history is not visible to another organisation owner');
  perform t.logout();

  perform set_config('session_replication_role', 'replica', true);
  update contest_history set expires_at = now() - interval '1 second' where source_contest_id = old_id;
  perform set_config('session_replication_role', 'origin', true);
  perform t.login_service();
  perform t.eq(purge_expired_contest_history(array[old_id]), 1, 'service cleanup purges expired history');
  perform t.logout();
  perform t.ok(not exists (select 1 from contest_history where source_contest_id = old_id), 'expired snapshot is deleted');
  perform t.ok(not exists (select 1 from contests where id = old_id), 'expired contest record is deleted');
  perform t.ok(not exists (select 1 from audit_log where contest_id = old_id), 'expired contest audit data is deleted');
end $$;

rollback to sp;
rollback;
