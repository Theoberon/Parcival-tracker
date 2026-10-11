begin;
savepoint sp;
do $$
declare adm uuid; a uuid; b uuid; c uuid; z uuid; al uuid; g uuid; f uuid; s uuid;
        names text[]; ranks int[]; r record; pend int; em text; ttl text; nottl text; leaked boolean;
begin
  perform t.state_open();
  adm := t.mk_admin('adm@x.test');
  a := t.mk_member('a@x.test', 'Ann');     -- 5 pts, reached late
  b := t.mk_member('b@x.test', 'Ben');     -- 5 pts, reached early -> beats Ann
  c := t.mk_member('c@x.test', 'Cy');      -- 7 pts
  z := t.mk_member('z@x.test', 'zed');     -- 0 (one pending)
  al := t.mk_member('al@x.test', 'Alpha'); -- 0
  g := t.mk_member('g@x.test', 'Gamma');   -- reversed + rejected only -> 0
  f := t.mk_member('f@x.test', 'Frozen');  -- inactive, 10 pts

  s := t.mk_pending(a, 'Converted Message / Order', 'a1', now() - interval '1 hour');   update submissions set status='approved', points_awarded=5 where id=s;
  s := t.mk_pending(b, 'Converted Message / Order', 'b1', now() - interval '3 hours');  update submissions set status='approved', points_awarded=5 where id=s;
  s := t.mk_pending(c, 'Converted Message / Order', 'c1', now() - interval '2 hours');  update submissions set status='approved', points_awarded=5 where id=s;
  s := t.mk_pending(c, 'New Message', 'c2', now() - interval '30 minutes');             update submissions set status='approved', points_awarded=2 where id=s;
  s := t.mk_pending(g, 'New Gig', 'g1');  update submissions set status='reversed', points_awarded=1 where id=s;
  s := t.mk_pending(g, 'New Gig', 'g2');  update submissions set status='rejected' where id=s;
  s := t.mk_pending(f, 'Converted Message / Order', 'f1'); update submissions set status='approved', points_awarded=5 where id=s;
  s := t.mk_pending(f, 'Converted Message / Order', 'f2'); update submissions set status='approved', points_awarded=5 where id=s;
  update members set active = false where id = f;
  perform t.mk_pending(z, 'New Gig', 'pending-one');
  update members set title = 'HubSpot Specialist' where id = a;
  update members set title = '  Zapier Builder ' where id = c;

  -- member view
  perform t.login(a);
  select array_agg(display_name order by ord), array_agg(rank order by ord) into names, ranks
    from (select row_number() over () as ord, * from get_leaderboard()) x;
  select * into r from get_leaderboard() where is_me;
  leaked := (select bool_or(to_jsonb(x) ? 'title') from get_leaderboard() x);
  perform t.logout();
  perform t.eq(names, array['Cy','Ben','Ann','Alpha','Gamma','zed'], 'order: points desc, earliest reached, then zero-point alphabetical; inactive excluded');
  perform t.eq(ranks, array[1,2,3,null,null,null]::int[], 'ranks 1..n, zero-point members unranked');
  perform t.eq(r.display_name, 'Ann', 'is_me row');
  perform t.eq(r.points, 5, 'my points');
  perform t.ok(leaked is false, 'the member leaderboard never includes titles');
  perform t.eq(r.tasks_completed, 1, 'tasks completed');

  -- admin view: includes inactive (last), pending counts, emails
  perform t.login(adm);
  select array_agg(display_name order by ord) into names
    from (select row_number() over () as ord, * from get_admin_leaderboard()) x;
  select * into r from get_admin_leaderboard() where member_id = f;
  pend := (select pending_count from get_admin_leaderboard() where member_id = z);
  ttl := (select title from get_admin_leaderboard() where member_id = c);
  nottl := (select title from get_admin_leaderboard() where member_id = b);
  em := (select email::text from get_admin_leaderboard() where member_id = c);
  perform t.logout();
  perform t.eq(names, array['Cy','Ben','Ann','Alpha','Gamma','zed','Frozen'], 'admin order, inactive last');
  perform t.eq(r.points, 10, 'inactive member points still shown');
  perform t.ok(not r.active and r.rank is null, 'inactive flagged and unranked');
  perform t.eq(pend, 1, 'pending count');
  perform t.eq(ttl, 'Zapier Builder', 'admins see titles (trimmed)');
  perform t.ok(nottl is null, 'members without a title have none');
  perform t.eq(em, 'c@x.test', 'email present');
end $$;
rollback to sp;
savepoint sp;

-- setup phase: everybody at zero, alphabetical, nobody ranked
do $$
declare a uuid;
begin
  a := t.mk_member('a@x.test', 'Bob'); perform t.mk_member('b@x.test', 'amy');
  perform t.login(a);
  perform t.eq((select array_agg(display_name order by ord) from (select row_number() over () ord, * from get_leaderboard()) x), array['amy','Bob'], 'zero board alphabetical');
  perform t.ok((select bool_and(rank is null) from get_leaderboard()), 'no ranks at zero');
  perform t.logout();
end $$;
rollback to sp;
savepoint sp;

-- a member's data can't leak through the leaderboard shape
do $$
declare a uuid;
begin
  a := t.mk_member('a@x.test', 'Ann');
  perform t.login(a);
  perform t.fails($q$select get_admin_leaderboard()$q$, 'forbidden');
  perform t.ok((select count(*) from (select * from get_leaderboard()) q) = 1, 'member sees board');
  perform t.logout();
  perform t.login_anon();
  perform t.fails($q$select get_leaderboard()$q$, 'permission denied');
  perform t.logout();
end $$;
rollback to sp;
rollback;
