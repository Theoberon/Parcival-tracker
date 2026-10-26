begin;
savepoint sp;

-- Owners can end a setup/open contest immediately; pending items remain reviewable and the
-- scheduled grace period does not delay publication after an explicit early end.
do $$
declare own uuid; adm uuid; mem uuid; s uuid;
begin
  own := t.mk_admin('early-owner@x.test', 'owner');
  adm := t.mk_admin('early-admin@x.test');
  mem := t.mk_member('early-member@x.test', 'Early Member');

  perform t.set_times(now() + interval '1 day', now() + interval '2 days');
  perform t.login(own);
  perform end_contest('Stopping before launch');
  perform t.logout();
  perform t.eq(contest_effective_status(t.cid())::text, 'closed', 'setup contest can be ended early');
  perform t.login(own);
  perform extend_deadline(now() + interval '3 days', 'Resume before launch');
  perform t.logout();
  perform t.eq(contest_effective_status(t.cid())::text, 'setup', 'extending resumes a setup contest');

  perform t.state_open();
  s := t.submit(mem, 'New Account', 'early-account');

  perform t.login(own);
  perform t.fails($q$select end_contest('')$q$, 'reason_required');
  perform end_contest('Ending the contest early');
  perform t.logout();
  perform t.eq(contest_effective_status(t.cid())::text, 'closed', 'early end closes immediately');
  perform t.ok((select ended_at is not null from contests), 'early end timestamp is recorded');
  perform t.fails(format($q$select t.draft(%L, 'New Account', 'too-late')$q$, mem), 'submissions_closed');
  perform t.login(own);
  perform t.fails($q$select publish_final('Still pending')$q$, 'pending_remaining');
  perform t.logout();

  perform t.approve(adm, s);
  perform t.login(own);
  perform publish_final('All early-end reviews complete');
  perform t.logout();
  perform t.eq(contest_effective_status(t.cid())::text, 'final', 'early-ended contest can publish before scheduled grace');

  perform t.login(own);
  perform reopen_contest('Correcting a result');
  perform extend_deadline(now() + interval '2 days', 'Resume the contest');
  perform t.logout();
  perform t.ok((select ended_at is null from contests), 'extending the deadline reopens an early-ended contest');
  perform t.ok(contest_effective_status(t.cid()) in ('setup', 'open'), 'reopened contest follows its scheduled dates');
  perform t.ok(exists (select 1 from audit_log where action = 'contest.ended_early'), 'early end is audited');
end $$;
rollback to sp;
savepoint sp;

-- Whole contest lifecycle on short dates: setup -> open -> closed -> final -> reopen -> final -> export -> archive.
do $$
declare own uuid; adm uuid; a uuid; b uuid; s uuid; s2 uuid; r record; ra record;
begin
  own := t.mk_admin('own@x.test', 'owner'); adm := t.mk_admin('adm@x.test');
  a := t.mk_member('a@x.test', 'Ann'); b := t.mk_member('b@x.test', 'Ben');

  -- SETUP: edit name/dates; submissions disabled
  perform t.eq(contest_effective_status(t.cid())::text, 'setup', 'starts in setup');
  perform t.login(own);
  perform update_contest_setup('Fall Contest', now() + interval '1 day', now() + interval '8 days', 15);
  perform t.logout();
  perform t.eq((select grace_minutes from contests), 15, 'setup edited');
  perform t.fails(format($q$select t.draft(%L, 'New Account', 'early')$q$, a), 'submissions_closed');
  perform t.login(a); select * into r from get_contest_banner(); perform t.logout();
  perform t.eq(r.status::text, 'setup', 'banner: setup');
  perform t.eq(r.name, 'Fall Contest', 'banner: name');

  -- OPEN
  perform t.state_open();
  perform t.login(own);
  perform t.fails($q$select update_contest_setup('x', now(), now() + interval '1 day', 5)$q$, 'not_setup');
  perform t.fails($q$select extend_deadline(now() + interval '1 hour', 'oops')$q$, 'deadline_shorten');
  perform t.fails($q$select extend_deadline(now() + interval '3 days', '')$q$, 'reason_required');
  perform extend_deadline(now() + interval '3 days', 'teams need more time');
  perform t.fails($q$select publish_final('too soon')$q$, 'not_closed');
  perform t.logout();
  perform t.ok((select end_at > now() + interval '2 days' from contests), 'deadline extended');
  perform t.eq((select reason from audit_log where action = 'contest.deadline_extended'), 'teams need more time', 'extension audited with reason');
  s := t.submit(a, 'New Account', 'acct_a'); s2 := t.submit(b, 'New Gig', 'gig_b');
  perform t.approve(adm, s);
  perform t.login(a); select * into r from get_contest_banner(); perform t.logout();
  perform t.eq(r.status::text, 'open', 'banner: open'); perform t.eq(r.pending_count, 1, 'banner: one pending');

  -- CLOSED (deadline passed, still inside grace): cannot publish; after grace still blocked by pending
  perform t.set_times(now() - interval '2 days', now() - interval '5 minutes', 10);
  perform t.login(a); select * into r from get_contest_banner(); perform t.logout();
  perform t.eq(r.status::text, 'closed', 'banner: closed');
  perform t.login(own);
  perform t.fails($q$select publish_final('x')$q$, 'grace_open');
  perform t.logout();
  perform t.state_closed();
  perform t.login(own);
  perform t.fails($q$select publish_final('x')$q$, 'pending_remaining');
  perform t.logout();
  perform t.approve(adm, s2);                         -- review continues after close
  perform t.login(own);
  perform t.fails($q$select owner_mark_exported()$q$, 'not_final');
  perform publish_final('All reviewed');
  perform t.logout();

  -- FINAL: frozen, banner says final, board unchanged
  perform t.eq(contest_effective_status(t.cid())::text, 'final', 'final');
  perform t.ok((select finalized_at is not null and results_updated_at is null from contests), 'first publish has no "updated" stamp');
  perform t.login(a); select * into r from get_contest_banner(); perform t.logout();
  perform t.eq(r.status::text, 'final', 'banner: final');
  perform t.fails(format($q$select t.draft(%L, 'New Account', 'late')$q$, a), 'submissions_closed');
  perform t.login(adm);
  perform t.fails(format($q$select reverse_submission(%L, 'x')$q$, s), 'contest_frozen');
  perform t.fails($q$select upsert_category(null, 'New', 1, 'l', 'h', 1)$q$, 'contest_frozen');
  perform t.logout();
  perform t.login(own);
  perform t.fails($q$select extend_deadline(now() + interval '9 days', 'x')$q$, 'contest_frozen');
  perform t.fails($q$select archive_contest('x')$q$, 'too_early');
  perform t.logout();

  -- REOPEN: back to closed, review possible again, republish stamps "results updated"
  perform t.login(own);
  perform t.fails($q$select reopen_contest('')$q$, 'reason_required');
  perform reopen_contest('Found a staged submission');
  perform t.logout();
  perform t.eq(contest_effective_status(t.cid())::text, 'closed', 'reopened -> closed');
  perform t.login(adm); perform reverse_submission(s, 'Account was staged'); perform t.logout();
  perform t.eq(t.pts(a), 0, 'correction applied');
  perform t.login(own);
  perform publish_final('Corrected');
  perform t.logout();
  perform t.ok((select results_updated_at is not null from contests), 'republish sets results_updated_at');
  perform t.login(a); select * into r from get_contest_banner(); perform t.logout();
  perform t.ok(r.results_updated_at is not null, 'banner exposes results_updated_at');

  -- EXPORT + ARCHIVE
  perform t.login(own);
  perform t.fails($q$select archive_contest('x')$q$, 'too_early');
  perform owner_mark_exported();
  perform t.logout();
  -- 30-day rule (clock shifted by fixture); and the export must be newer than the last publish
  perform set_config('session_replication_role', 'replica', true);
  update contests set finalized_at = now() - interval '29 days', exported_at = now() - interval '28 days';
  perform set_config('session_replication_role', 'origin', true);
  perform t.login(own);
  perform t.fails($q$select archive_contest('x')$q$, 'too_early');
  perform t.logout();
  perform set_config('session_replication_role', 'replica', true);
  update contests set finalized_at = now() - interval '31 days', exported_at = now() - interval '32 days';
  perform set_config('session_replication_role', 'origin', true);
  perform t.login(own);
  perform t.fails($q$select archive_contest('x')$q$, 'not_exported');   -- exported before last publish
  perform t.logout();
  perform set_config('session_replication_role', 'replica', true);
  update contests set exported_at = now() - interval '30 days';
  perform set_config('session_replication_role', 'origin', true);
  perform t.login(own);
  perform archive_contest('Season over');
  perform t.logout();
  perform t.eq(contest_effective_status(t.cid())::text, 'archived', 'archived');
  perform t.login(a); select * into r from get_contest_banner(); perform t.logout();
  perform t.eq(r.status::text, 'archived', 'banner: archived');

  -- full trail in the audit log
  perform t.ok((select array_agg(action order by id) @> array['contest.deadline_extended','contest.published','contest.reopened','contest.exported','contest.archived']
                from audit_log where entity = 'contests'), 'lifecycle fully audited');
end $$;
rollback to sp;
savepoint sp;

-- test-environment override of the 30-day wait (never set in production)
do $$
declare own uuid;
begin
  own := t.mk_admin('own@x.test', 'owner');
  perform t.state_closed();
  perform t.login(own); perform publish_final('x'); perform owner_mark_exported(); perform t.logout();
  perform set_config('session_replication_role', 'replica', true);
  update contests set finalized_at = now() - interval '1 minute', exported_at = now();
  perform set_config('session_replication_role', 'origin', true);
  perform set_config('app.archive_min_days', '0', true);
  perform t.login(own); perform archive_contest('test env'); perform t.logout();
  perform t.eq(contest_effective_status(t.cid())::text, 'archived', 'archived with test override');
end $$;
rollback to sp;
rollback;
