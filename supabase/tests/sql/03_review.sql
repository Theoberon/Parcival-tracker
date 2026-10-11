begin;
savepoint sp;
-- approve / reject / already-reviewed, with audit actors.
do $$
declare a uuid; adm uuid; adm2 uuid; s uuid; au record; n0 int;
begin
  perform t.state_open();
  a := t.mk_member('a@x.test', 'Ann'); adm := t.mk_admin('adm@x.test'); adm2 := t.mk_admin('adm2@x.test');
  s := t.submit(a, 'Converted Message / Order', 'FO1234567890');

  -- confirm was done by the service role on behalf of the member -> actor "member"
  select * into au from audit_log where entity_id = s and action = 'submission.pending';
  perform t.eq(au.actor_type::text, 'member', 'confirm audited as member');
  perform t.eq(au.actor_id, a, 'confirm actor id');

  perform t.approve(adm, s);
  perform t.eq((select points_awarded from submissions where id = s), 5, 'points copied from category');
  perform t.eq((select reviewed_by from submissions where id = s), adm, 'reviewer recorded');
  select * into au from audit_log where entity_id = s and action = 'submission.approved';
  perform t.eq(au.actor_type::text, 'admin', 'approval audited as admin');
  perform t.eq(au.actor_id, adm, 'approval actor id');
  perform t.eq(au.before ->> 'status', 'pending', 'before state');
  perform t.eq(au.after ->> 'status', 'approved', 'after state');

  perform t.fails(format($q$select t.approve(%L, %L)$q$, adm2, s), 'already_reviewed');
  perform t.fails(format($q$select t.reject(%L, %L)$q$, adm2, s), 'already_reviewed');
  perform t.fails(format($q$select t.approve(%L, gen_random_uuid())$q$, adm2), 'not_found');

  -- points_awarded is a snapshot: a later point change (unlock) does not rewrite history
  update contests set points_unlocked = true;
  update categories set points = 8 where id = t.cat('Converted Message / Order');
  perform t.eq(t.pts(a), 5, 'old approvals keep their points');
  s := t.submit(a, 'Converted Message / Order', 'FO2');
  perform t.approve(adm, s);
  perform t.eq(t.pts(a), 13, 'new approvals use new points');
end $$;
rollback to sp;
savepoint sp;

-- reject reasons
do $$
declare a uuid; adm uuid; s uuid;
begin
  perform t.state_open();
  a := t.mk_member('a@x.test', 'Ann'); adm := t.mk_admin('adm@x.test');
  s := t.submit(a, 'New Account', 'r1');
  perform t.login(adm);
  perform t.fails(format($q$select reject_submission(%L, null, null)$q$, s), 'reason_required');
  perform t.fails(format($q$select reject_submission(%L, 'bogus', null)$q$, s), 'reason_required');
  perform t.fails(format($q$select reject_submission(%L, 'other', '  ')$q$, s), 'reason_required');
  perform reject_submission(s, 'other', 'Looks edited');
  perform t.logout();
  perform t.eq((select reject_reason_text from submissions where id = s), 'Looks edited', 'free text saved');
  perform t.eq((select reason from audit_log where entity_id = s and action = 'submission.rejected'), 'other: Looks edited', 'reason in audit');
end $$;
rollback to sp;
savepoint sp;

-- reversal and correction
do $$
declare a uuid; b uuid; adm uuid; s uuid; s2 uuid;
begin
  perform t.state_open();
  a := t.mk_member('a@x.test', 'Ann'); b := t.mk_member('b@x.test', 'Ben'); adm := t.mk_admin('adm@x.test');
  s := t.submit(a, 'New Account', 'acct'); perform t.approve(adm, s);
  perform t.eq(t.pts(a), 2, '2 points');
  perform t.login(adm);
  perform t.fails(format($q$select reverse_submission(%L, ' ')$q$, s), 'reason_required');
  perform reverse_submission(s, 'Account was staged');
  perform t.logout();
  perform t.eq(t.pts(a), 0, 'reversed points excluded');
  perform t.eq((select points_awarded from submissions where id = s), 2, 'points_awarded kept for the record');
  perform t.eq((select reason from audit_log where entity_id = s and action = 'submission.reversed'), 'Account was staged', 'reversal reason logged');
  -- reversing twice / a pending one fails
  perform t.login(adm);
  perform t.fails(format($q$select reverse_submission(%L, 'again')$q$, s), 'not_approved');
  perform t.logout();

  -- correct a rejection
  s2 := t.submit(b, 'New Gig', 'gig b'); perform t.reject(adm, s2);
  perform t.login(adm);
  perform t.fails(format($q$select correct_rejection(%L, '')$q$, s2), 'reason_required');
  perform correct_rejection(s2, 'Rejected by mistake');
  perform t.logout();
  perform t.eq(t.pts(b), 1, 'corrected rejection counts');
  perform t.eq((select reject_reason_code from submissions where id = s2), null, 'rejection reason cleared');
  perform t.eq((select action from audit_log where entity_id = s2 order by id desc limit 1), 'submission.rejection_corrected', 'correction audited');
  perform t.login(adm);
  perform t.fails(format($q$select correct_rejection(%L, 'x')$q$, s2), 'not_rejected');
  perform t.logout();

  -- cannot correct into a duplicate
  s2 := t.submit(a, 'New Gig', 'gig c'); perform t.reject(adm, s2);
  perform t.submit(b, 'New Gig', 'GIG C');
  perform t.login(adm);
  perform t.fails(format($q$select correct_rejection(%L, 'x')$q$, s2), 'duplicate_reference');
  perform t.logout();
end $$;
rollback to sp;
savepoint sp;

-- override rules
do $$
declare a uuid; adm uuid; s1 uuid; s2 uuid;
begin
  perform t.state_open();
  a := t.mk_member('a@x.test', 'Ann'); adm := t.mk_admin('adm@x.test');
  s1 := t.submit(a, 'New Account', 'acct'); perform t.reject(adm, s1);
  perform t.login(adm);
  perform t.fails(format($q$select grant_override(%L, 'x')$q$, s1), 'override_not_needed');
  perform t.logout();
  s2 := t.submit(a, 'New Account', 'acct2', null, s1);
  perform t.login(adm);
  perform t.fails(format($q$select grant_override(%L, 'x')$q$, s2), 'override_invalid');   -- still pending
  perform t.logout();
  perform t.reject(adm, s2);
  perform t.login(adm);
  perform t.fails(format($q$select grant_override(%L, '')$q$, s2), 'reason_required');
  perform grant_override(s2, 'ok');
  perform t.fails(format($q$select grant_override(%L, 'again')$q$, s2), 'override_invalid');
  perform t.logout();
  perform t.ok((select count(*) from audit_log where entity_id = s2 and action = 'submission.override_granted') = 1, 'override audited');
end $$;
rollback to sp;
savepoint sp;

-- claims: advisory 5-minute hold, no audit noise
do $$
declare a uuid; adm uuid; adm2 uuid; s uuid; r jsonb; n0 int;
begin
  perform t.state_open();
  a := t.mk_member('a@x.test', 'Ann'); adm := t.mk_admin('adm@x.test'); adm2 := t.mk_admin('adm2@x.test');
  s := t.submit(a, 'New Account', 'acct');
  select count(*) into n0 from audit_log;
  perform t.login(adm); r := claim_submission(s); perform t.logout();
  perform t.ok((r ->> 'mine')::boolean, 'admin 1 holds the claim');
  perform t.login(adm2); r := claim_submission(s); perform t.logout();
  perform t.ok(not (r ->> 'mine')::boolean, 'admin 2 sees it held');
  perform t.eq((r ->> 'claimed_by')::uuid, adm, 'held by admin 1');
  perform t.login(adm); r := claim_submission(s); perform t.logout();   -- holder can refresh
  perform t.ok((r ->> 'mine')::boolean, 'holder refreshes');
  perform t.eq((select count(*) from audit_log)::int, n0, 'claims create no audit rows');
  update submissions set claimed_until = now() - interval '1 minute' where id = s;
  perform t.login(adm2); r := claim_submission(s); perform t.logout();
  perform t.ok((r ->> 'mine')::boolean, 'expired claim can be taken');
  perform t.approve(adm, s);
  perform t.eq((select claimed_by from submissions where id = s), null, 'claim cleared on review');
  perform t.login(adm2);
  perform t.fails(format($q$select claim_submission(%L)$q$, s), 'already_reviewed');
  perform t.logout();
end $$;
rollback to sp;
savepoint sp;

-- audit: actors for member / admin / system, and append-only
do $$
declare a uuid; adm uuid; s uuid; au record;
begin
  perform t.state_open();
  a := t.mk_member('a@x.test', 'Ann'); adm := t.mk_admin('adm@x.test');
  s := t.submit(a, 'New Account', 'acct');
  perform t.login(a); perform withdraw_submission(s); perform t.logout();
  select * into au from audit_log where entity_id = s and action = 'submission.withdrawn';
  perform t.eq(au.actor_type::text, 'member', 'withdraw audited as member');
  perform t.eq(au.actor_id, a, 'withdraw actor id');

  perform t.login_service();
  update members set active = false where id = a;
  perform t.logout();
  select * into au from audit_log where entity_id = a and entity = 'members' order by id desc limit 1;
  perform t.eq(au.actor_type::text, 'system', 'service role change audited as system');
  perform t.ok(au.actor_id is null, 'system has no actor id');

  perform t.login(adm); perform set_member_active(a, true); perform t.logout();
  select * into au from audit_log where entity_id = a and entity = 'members' order by id desc limit 1;
  perform t.eq(au.actor_type::text, 'admin', 'admin change audited as admin');
  perform t.eq(au.action, 'member.reactivated', 'action name');

  perform t.login(adm);
  perform upsert_category(null, 'Extra', 4, 'Label', 'hint', 9);
  perform t.logout();
  perform t.ok(exists (select 1 from audit_log where entity = 'categories' and action = 'category.insert' and actor_id = adm), 'category insert audited');

  -- draft rows are scratch space and are not audited
  perform t.draft(a, 'New Gig', 'draft only');
  perform t.ok(not exists (select 1 from audit_log where after ->> 'reference' = 'draft only'), 'drafts not audited');

  -- append-only, even for superuser/service role
  perform t.fails($q$update audit_log set action = 'x'$q$, 'audit_immutable');
  perform t.fails($q$delete from audit_log$q$, 'audit_immutable');
  perform t.fails($q$truncate audit_log$q$, 'audit_immutable');
  perform t.login_service();
  perform t.fails($q$delete from audit_log$q$, 'permission denied');
  perform t.fails($q$insert into audit_log (actor_type, action, entity) values ('system', 'x', 'y')$q$, 'permission denied');
  perform t.logout();
end $$;
rollback to sp;
rollback;
