begin;
savepoint sp;
-- Draft -> confirm happy path, path format, duplicate handling, reused proof flag.
do $$
declare a uuid; b uuid; d uuid; r jsonb; s record;
begin
  perform t.state_open();
  a := t.mk_member('a@x.test', 'Ann'); b := t.mk_member('b@x.test', 'Ben');

  d := t.draft(a, 'New Account', '  @Jane_Designs ', 'jpeg', null, '  hello ');
  select * into s from submissions where id = d;
  perform t.eq(s.status::text, 'draft', 'starts as draft');
  perform t.eq(s.reference_normalized, 'jane_designs', 'reference normalized');
  perform t.eq(s.note, 'hello', 'note trimmed');
  perform t.eq(s.proof_path, t.cid() || '/' || a || '/' || d || '.jpg', 'proof path format');
  perform t.eq(s.attempt, 1, 'attempt 1');

  r := t.confirm(a, d, 'hash-1');
  perform t.ok((r ->> 'ok')::boolean, 'confirm ok');
  select * into s from submissions where id = d;
  perform t.eq(s.status::text, 'pending', 'pending after confirm');
  perform t.ok(s.submitted_at is not null, 'submitted_at set');
  perform t.eq(s.flags, '{}'::text[], 'no flags');

  -- friendly early duplicate (any member, normalized)
  perform t.fails(format($q$select t.draft(%L, 'New Account', 'JANE_designs')$q$, b), 'duplicate_reference');

  -- race: draft created first, someone else's identical submission lands before confirm
  d := t.draft(b, 'New Gig', 'my gig title');
  perform t.mk_pending(a, 'New Gig', 'My  Gig Title');
  r := t.confirm(b, d, 'hash-2');
  perform t.eq(r ->> 'error', 'duplicate_reference', 'confirm-time duplicate detected');
  perform t.ok(not exists (select 1 from submissions where id = d), 'duplicate draft deleted');

  -- same screenshot reused -> flagged, not blocked
  d := t.submit(b, 'New Message', 'buyer9 2026-10-01', 'hash-1');
  perform t.eq((select flags from submissions where id = d), array['reused_proof'], 'reused_proof flag');
  -- a withdrawn submission's hash does not count
  update submissions set status = 'withdrawn' where id = d;
  d := t.submit(b, 'New Message', 'buyer9 2026-10-02', 'hash-1');
  perform t.ok((select flags from submissions where id = d) <> '{}' , 'still flagged (original is pending)');
end $$;
rollback to sp;
savepoint sp;

-- Input validation + state checks in the draft RPC.
do $$
declare a uuid; i uuid;
begin
  perform t.state_open();
  a := t.mk_member('a@x.test', 'Ann');
  perform t.fails(format($q$select t.draft(%L, 'New Account', '   ')$q$, a), 'reference_required');
  perform t.fails(format($q$select t.draft(%L, 'New Account', '@')$q$, a), 'reference_required');
  perform t.fails(format($q$select t.draft(%L, 'New Account', 'ok', 'gif')$q$, a), 'bad_file_type');
  perform t.fails(format($q$select t.draft(%L, 'New Account', 'ok', 'png', null, %L)$q$, a, repeat('x', 281)), 'note_too_long');
  perform t.draft(a, 'New Account', 'ok', 'png', null, repeat('x', 280));
  update categories set active = false where id = t.cat('New Gig');
  perform t.fails(format($q$select t.draft(%L, 'New Gig', 'g')$q$, a), 'bad_category');
  -- inactive member
  update members set active = false where id = a;
  perform t.fails(format($q$select t.draft(%L, 'New Account', 'zzz')$q$, a), 'not_member');
  update members set active = true where id = a;
  -- contest not open
  perform t.set_times(now() + interval '1 day', now() + interval '2 days');
  perform t.fails(format($q$select t.draft(%L, 'New Account', 'later')$q$, a), 'submissions_closed');
  perform t.state_closed();
  perform t.fails(format($q$select t.draft(%L, 'New Account', 'later')$q$, a), 'submissions_closed');
  -- a user who is not a member at all
  i := t.mk_user('stranger@x.test');
  perform t.state_open();
  perform t.fails(format($q$select t.draft(%L, 'New Account', 'x')$q$, i), 'not_member');
end $$;
rollback to sp;
savepoint sp;

-- Rate limit: 20 drafts per member per hour.
do $$
declare a uuid; i int;
begin
  perform t.state_open();
  a := t.mk_member('a@x.test', 'Ann');
  for i in 1..20 loop perform t.draft(a, 'New Account', 'ref ' || i); end loop;
  perform t.fails(format($q$select t.draft(%L, 'New Account', 'ref 21')$q$, a), 'rate_limited');
end $$;
rollback to sp;
savepoint sp;

-- Grace window: confirm allowed after the deadline only for drafts created before it.
do $$
declare a uuid; d uuid; d2 uuid; r jsonb;
begin
  perform t.state_open();
  a := t.mk_member('a@x.test', 'Ann');
  d := t.draft(a, 'New Account', 'before deadline');
  d2 := t.draft(a, 'New Account', 'also before deadline');
  update submissions set created_at = now() - interval '2 hours' where id in (d, d2);
  perform t.set_times(now() - interval '1 day', now() - interval '5 minutes', 10);   -- closed, 5 min ago, grace 10
  perform t.eq(contest_effective_status(t.cid())::text, 'closed', 'closed');
  r := t.confirm(a, d, 'h');
  perform t.ok((r ->> 'ok')::boolean, 'confirm inside grace works for early draft');
  -- grace over
  perform t.set_times(now() - interval '1 day', now() - interval '30 minutes', 10);
  perform t.fails(format($q$select t.confirm(%L, %L, 'h')$q$, a, d2), 'submissions_closed');
  -- draft created after the deadline can never be confirmed, even inside grace
  perform t.set_times(now() - interval '1 day', now() - interval '5 minutes', 10);
  update submissions set created_at = now() where id = d2;
  perform t.fails(format($q$select t.confirm(%L, %L, 'h')$q$, a, d2), 'submissions_closed');
  -- someone else's draft cannot be confirmed
  perform t.fails(format($q$select t.confirm(%L, %L, 'h')$q$, gen_random_uuid(), d2), 'draft_not_found');
end $$;
rollback to sp;
savepoint sp;

-- Resubmission cap: one resubmission after a rejection; 2nd rejection is final unless overridden.
do $$
declare a uuid; b uuid; adm uuid; s1 uuid; s2 uuid; s3 uuid; allowance record;
begin
  perform t.state_open();
  a := t.mk_member('a@x.test', 'Ann'); b := t.mk_member('b@x.test', 'Ben'); adm := t.mk_admin('adm@x.test');
  s1 := t.submit(a, 'New Account', 'acct_one');
  perform t.fails(format($q$select t.draft(%L, 'New Account', 'acct_one', 'png', %L)$q$, a, s1), 'not_resubmittable');  -- still pending
  perform t.reject(adm, s1);

  -- cannot dodge the cap by re-entering it as "new"
  perform t.fails(format($q$select t.draft(%L, 'New Account', 'ACCT_one')$q$, a), 'already_reviewed_reference');
  -- other member's rejected submission cannot be resubmitted
  perform t.fails(format($q$select t.draft(%L, 'New Account', 'acct_one', 'png', %L)$q$, b, s1), 'bad_resubmission');
  -- category must match
  perform t.fails(format($q$select t.draft(%L, 'New Gig', 'acct_one', 'png', %L)$q$, a, s1), 'category_mismatch');

  perform t.login(a);
  select * into allowance from my_resubmission_allowance(s1);
  perform t.logout();
  perform t.ok(allowance.allowed, 'resubmission allowed after 1st rejection');

  s2 := t.submit(a, 'New Account', 'acct_one fixed', null, s1);
  perform t.eq((select attempt from submissions where id = s2), 2, 'attempt 2');
  perform t.eq((select resubmission_of from submissions where id = s2), s1, 'linked to parent');
  -- only one live resubmission per rejected submission
  perform t.fails(format($q$select t.draft(%L, 'New Account', 'another', 'png', %L)$q$, a, s1), 'resubmission_exists');

  perform t.reject(adm, s2, 'unclear_screenshot');
  perform t.fails(format($q$select t.draft(%L, 'New Account', 'third', 'png', %L)$q$, a, s2), 'resubmission_limit');
  perform t.login(a);
  select * into allowance from my_resubmission_allowance(s2);
  perform t.logout();
  perform t.ok(not allowance.allowed and allowance.reason = 'resubmission_limit', '2nd rejection is final');

  -- admin override allows exactly one more
  perform t.login(adm); perform grant_override(s2, 'admin made a mistake'); perform t.logout();
  s3 := t.submit(a, 'New Account', 'third', null, s2);
  perform t.eq((select attempt from submissions where id = s3), 3, 'attempt 3 via override');
  perform t.reject(adm, s3);
  perform t.fails(format($q$select t.draft(%L, 'New Account', 'fourth', 'png', %L)$q$, a, s3), 'resubmission_limit');
end $$;
rollback to sp;
savepoint sp;

-- Withdrawn resubmission frees the slot; withdrawals don't count against the cap.
do $$
declare a uuid; adm uuid; s1 uuid; s2 uuid; s2b uuid;
begin
  perform t.state_open();
  a := t.mk_member('a@x.test', 'Ann'); adm := t.mk_admin('adm@x.test');
  s1 := t.submit(a, 'New Account', 'acct_one'); perform t.reject(adm, s1);
  s2 := t.submit(a, 'New Account', 'acct_two', null, s1);
  perform t.login(a); perform withdraw_submission(s2); perform t.logout();
  perform t.eq((select status::text from submissions where id = s2), 'withdrawn', 'withdrawn');
  s2b := t.submit(a, 'New Account', 'acct_two v2', null, s1);
  perform t.eq((select attempt from submissions where id = s2b), 2, 'slot freed: new attempt 2');
  -- a withdrawn original frees its reference for anyone
  s1 := t.submit(a, 'New Gig', 'gig a');
  perform t.login(a); perform withdraw_submission(s1); perform t.logout();
  perform t.submit(t.mk_member('b@x.test', 'Ben'), 'New Gig', 'gig a');
end $$;
rollback to sp;
savepoint sp;

-- Withdraw rules.
do $$
declare a uuid; b uuid; adm uuid; s uuid;
begin
  perform t.state_open();
  a := t.mk_member('a@x.test', 'Ann'); b := t.mk_member('b@x.test', 'Ben'); adm := t.mk_admin('adm@x.test');
  s := t.submit(a, 'New Account', 'acct');
  perform t.login(b);
  perform t.fails(format($q$select withdraw_submission(%L)$q$, s), 'not_found');
  perform t.logout();
  perform t.approve(adm, s);
  perform t.login(a);
  perform t.fails(format($q$select withdraw_submission(%L)$q$, s), 'not_pending');
  perform t.logout();
  -- after the grace period withdrawals are closed too
  s := t.mk_pending(a, 'New Gig', 'gigx');
  perform t.state_closed();
  perform t.login(a);
  perform t.fails(format($q$select withdraw_submission(%L)$q$, s), 'submissions_closed');
  perform t.logout();
  perform t.set_times(now() - interval '1 day', now() - interval '5 minutes', 10);
  perform t.login(a); perform withdraw_submission(s); perform t.logout();   -- inside grace
end $$;
rollback to sp;
savepoint sp;

-- my_submissions: shape, ordering, resubmit flags.
do $$
declare a uuid; adm uuid; s1 uuid; n int; r record;
begin
  perform t.state_open();
  a := t.mk_member('a@x.test', 'Ann'); adm := t.mk_admin('adm@x.test');
  s1 := t.submit(a, 'New Account', 'acct'); perform t.reject(adm, s1, 'wrong_category');
  perform t.draft(a, 'New Gig', 'just a draft');
  perform t.login(a);
  select count(*) into n from my_submissions();
  select * into r from my_submissions() where id = s1;
  perform t.logout();
  perform t.eq(n, 1, 'drafts are not listed');
  perform t.ok(r.can_resubmit, 'can resubmit flag');
  perform t.eq(r.reject_reason_code, 'wrong_category', 'reason exposed');
  perform t.eq(r.category_name, 'New Account', 'category name');
end $$;
rollback;
