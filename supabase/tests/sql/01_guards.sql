begin;
-- Points lock: editable in setup, locked once the contest starts, unless the owner unlocks.
savepoint sp;
do $$ begin
  update categories set points = 3 where id = t.cat('New Gig');
  perform t.eq((select points from categories where id = t.cat('New Gig')), 3, 'points editable in setup');
  update categories set points = 1 where id = t.cat('New Gig');

  perform t.state_open();
  perform t.fails($q$update categories set points = 9 where id = t.cat('New Gig')$q$, 'points_locked');
  update categories set reference_hint = 'changed' where id = t.cat('New Gig');   -- other fields still editable
  update contests set points_unlocked = true;
  update categories set points = 9 where id = t.cat('New Gig');
  perform t.eq((select points from categories where id = t.cat('New Gig')), 9, 'points editable when unlocked');
  update categories set points = 1 where id = t.cat('New Gig');
  update contests set points_unlocked = false;
  -- adding a category mid-contest is allowed
  insert into categories (contest_id, name, points, reference_label) values (t.cid(), 'Bonus', 3, 'Ref');
end $$;
rollback to sp;

-- Deadline: while open, end_at can only grow.
savepoint sp;
do $$ begin
  perform t.state_open();
  perform t.fails($q$update contests set end_at = end_at - interval '1 hour'$q$, 'deadline_shorten');
  update contests set end_at = end_at + interval '1 hour';
  perform t.ok((select end_at > now() + interval '24 hours' from contests), 'deadline extended');
  -- in setup, dates are free to move
  perform t.set_times(now() + interval '1 day', now() + interval '5 days');
  update contests set end_at = end_at - interval '1 hour';
end $$;
rollback to sp;

-- Freeze: nothing changes in final state (except stale draft cleanup).
savepoint sp;
do $$
declare m uuid; s uuid; d uuid;
begin
  perform t.state_open();
  m := t.mk_member('m1@x.test', 'M1');
  s := t.mk_pending(m, 'New Account', 'frozen_ref');
  d := gen_random_uuid();
  insert into submissions (id, contest_id, member_id, category_id, reference, reference_normalized, proof_path, status)
    values (d, t.cid(), m, t.cat('New Gig'), 'draftref', '', 'x/d', 'draft');
  update contests set manual_status = 'final', finalized_at = now();
  perform t.fails(format($q$update submissions set note = 'x' where id = %L$q$, s), 'contest_frozen');
  perform t.fails(format($q$delete from submissions where id = %L$q$, s), 'contest_frozen');
  perform t.fails($q$insert into submissions (contest_id, member_id, category_id, reference, reference_normalized, proof_path, status)
        select t.cid(), id, t.cat('New Gig'), 'r', '', 'x/y', 'pending' from members limit 1$q$, 'contest_frozen');
  perform t.fails($q$update categories set name = 'zzz' where id = t.cat('New Gig')$q$, 'contest_frozen');
  perform t.fails($q$insert into categories (contest_id, name, points, reference_label) values (t.cid(), 'N', 1, 'r')$q$, 'contest_frozen');
  delete from submissions where id = d;   -- stale draft cleanup still works
  update contests set manual_status = 'archived';
  perform t.fails(format($q$update submissions set note = 'x' where id = %L$q$, s), 'contest_frozen');
end $$;
rollback to sp;

-- Category deletion: blocked once it has submissions.
savepoint sp;
do $$
declare m uuid; c uuid;
begin
  m := t.mk_member('m2@x.test', 'M2');
  perform t.mk_pending(m, 'New Account', 'ref_del');
  perform t.fails($q$delete from categories where id = t.cat('New Account')$q$, 'category_in_use');
  insert into categories (contest_id, name, points, reference_label) values (t.cid(), 'Temp', 1, 'r') returning id into c;
  delete from categories where id = c;
end $$;
rollback to sp;

-- Admin emails cannot be members (and vice versa).
savepoint sp;
do $$
declare a uuid; u uuid;
begin
  a := t.mk_admin('boss@x.test');
  u := t.mk_user('boss@x.test2');
  perform t.fails(format($q$insert into members (id, contest_id, email, display_name) values (%L, t.cid(), 'BOSS@x.test', 'Boss')$q$, u), 'admin_email');
  perform t.mk_member('mem@x.test', 'Mem');
  u := t.mk_user('mem@x.test2');
  perform t.fails(format($q$insert into admins (id, email, role) values (%L, 'Mem@x.test', 'admin')$q$, u), 'member_email');
end $$;
rollback to sp;

-- Display names and emails are unique per contest, case-insensitively.
savepoint sp;
do $$
declare u uuid;
begin
  perform t.mk_member('a1@x.test', 'Alice');
  u := t.mk_user('a2@x.test');
  perform t.fails(format($q$insert into members (id, contest_id, email, display_name) values (%L, t.cid(), 'a2@x.test', 'ALICE')$q$, u), 'duplicate key');
  perform t.fails(format($q$insert into members (id, contest_id, email, display_name) values (%L, t.cid(), 'A1@X.test', 'Other')$q$, u), 'duplicate key');
end $$;
rollback to sp;

-- Reference uniqueness: pending/approved only, across members, using normalized references.
savepoint sp;
do $$
declare a uuid; b uuid; s1 uuid;
begin
  a := t.mk_member('u1@x.test', 'U1'); b := t.mk_member('u2@x.test', 'U2');
  s1 := t.mk_pending(a, 'New Account', 'Jane_Designs');
  perform t.fails(format($q$select t.mk_pending(%L, 'New Account', '  @jane_designs ')$q$, b), 'duplicate key');
  -- same reference in another category is a different item
  perform t.mk_pending(b, 'New Gig', 'jane_designs');
  -- once the first one is rejected, the reference is free again
  update submissions set status = 'rejected' where id = s1;
  perform t.mk_pending(b, 'New Account', 'jane_designs');
end $$;
rollback to sp;
savepoint sp;
-- Titles: optional, trimmed, blank means none, at most 80 characters, changes are audited.
do $$
declare m uuid;
begin
  m := t.mk_member('ttl@x.test', 'Titled');
  perform t.ok((select title is null from members where id = m), 'title is optional');
  update members set title = '  HubSpot Specialist  ' where id = m;
  perform t.eq((select title from members where id = m), 'HubSpot Specialist', 'trimmed');
  update members set title = '   ' where id = m;
  perform t.ok((select title is null from members where id = m), 'blank title means none');
  update members set title = repeat('x', 80) where id = m;
  perform t.fails(format($q$update members set title = %L where id = %L$q$, repeat('x', 81), m), 'new row for relation "members" violates check constraint');
  perform t.ok(exists (select 1 from audit_log where entity = 'members' and entity_id = m and after ->> 'title' = repeat('x', 80)), 'title change is in the audit log');
end $$;
rollback to sp;
rollback;
