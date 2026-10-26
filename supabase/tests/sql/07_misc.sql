begin;
savepoint sp;
-- resend-key rate limit: 3 per email per hour, 20 per ip per hour
do $$
declare i int; ok boolean;
begin
  perform t.login_service();
  for i in 1..3 loop
    perform t.ok(rate_limit_key_request('x@x.test', '9.9.9.9'), 'email request ' || i || ' allowed');
  end loop;
  perform t.ok(not rate_limit_key_request('X@x.test', '9.9.9.9'), '4th request for the same email is limited (case-insensitive)');
  perform t.ok(rate_limit_key_request('y@x.test', '9.9.9.9'), 'other email still ok');
  for i in 1..20 loop perform rate_limit_key_request(('ip' || i || '@x.test')::citext, '7.7.7.7'); end loop;
  perform t.ok(not rate_limit_key_request('fresh@x.test', '7.7.7.7'), 'ip limit after 20');
  perform t.ok(rate_limit_key_request('fresh@x.test', null), 'no ip -> email limit only');
  perform t.logout();
end $$;
rollback to sp;
savepoint sp;

-- login throttle: 1 free failure, the 2nd starts a 180 s cooldown, then +1 minute each (max 30); success clears; per email
do $$
declare i int; r jsonb; s int;
begin
  perform t.login_service();
  perform t.eq(_login_lock_seconds(0), 0, '0 failures: no wait');
  perform t.eq(_login_lock_seconds(1), 0, '1st failure: free');
  perform t.eq(_login_lock_seconds(2), 180, '2nd failure: 180 seconds');
  perform t.eq(_login_lock_seconds(3), 240, '3rd failure: 4 minutes');
  perform t.eq(_login_lock_seconds(7), 480, '7th failure: 8 minutes');
  perform t.eq(_login_lock_seconds(500), 1800, 'capped at 30 minutes');

  perform t.ok(not (login_check('Lock@x.test') ->> 'locked')::boolean, 'fresh email is open');
  r := login_record('lock@x.test', false); perform t.ok(not (r ->> 'locked')::boolean, 'failure 1 is free');
  r := login_record('LOCK@x.test', false);   -- case-insensitive: the same person
  perform t.ok((r ->> 'locked')::boolean, 'failure 2 locks');
  perform t.ok((r ->> 'retry_after_seconds')::int between 178 and 180, 'about 180 seconds: ' || (r ->> 'retry_after_seconds'));
  perform t.ok((login_check('lock@x.test') ->> 'locked')::boolean, 'still locked on check');
  perform t.ok(not (login_check('other@x.test') ->> 'locked')::boolean, 'other emails unaffected');

  -- wait out the 3 minutes: the next failure costs 4 minutes, then 5
  update login_failures set failed_at = failed_at - interval '181 seconds';
  perform t.ok(not (login_check('lock@x.test') ->> 'locked')::boolean, 'open again after the wait');
  r := login_record('lock@x.test', false);
  perform t.ok((r ->> 'retry_after_seconds')::int between 238 and 240, '3rd failure: about 4 minutes: ' || (r ->> 'retry_after_seconds'));
  update login_failures set failed_at = failed_at - interval '241 seconds';
  r := login_record('lock@x.test', false);
  perform t.ok((r ->> 'retry_after_seconds')::int between 298 and 300, '4th failure: about 5 minutes');

  -- a correct login clears everything
  r := login_record('lock@x.test', true);
  perform t.ok(not (r ->> 'locked')::boolean, 'success unlocks');
  perform t.eq((select count(*) from login_failures where email = 'lock@x.test')::int, 0, 'failures cleared');

  -- failures older than 24 hours are forgotten
  for i in 1..6 loop perform login_record('old@x.test', false); end loop;   -- (6 failures would mean a 7-minute wait)
  update login_failures set failed_at = now() - interval '25 hours' where email = 'old@x.test';
  perform t.ok(not (login_check('old@x.test') ->> 'locked')::boolean, 'old failures expire');
  perform t.logout();
end $$;
rollback to sp;
savepoint sp;

-- the same policy through the Auth password-verification hook (keyed by the user's email)
do $$
declare u uuid := t.mk_user('hooked@x.test'); r jsonb; i int;
begin
  r := hook_password_verification_attempt(jsonb_build_object('user_id', u, 'valid', false));
  perform t.eq(r ->> 'decision', 'continue', 'the free failure continues');
  r := hook_password_verification_attempt(jsonb_build_object('user_id', u, 'valid', false));
  perform t.eq(r ->> 'decision', 'continue', 'the failure that triggers the delay is still reported normally');
  r := hook_password_verification_attempt(jsonb_build_object('user_id', u, 'valid', true));
  perform t.eq(r ->> 'decision', 'reject', 'locked: even the right key is rejected');
  perform t.eq(r ->> 'message', 'Email or key is incorrect.', 'generic message');
  update login_failures set failed_at = failed_at - interval '181 seconds';
  r := hook_password_verification_attempt(jsonb_build_object('user_id', u, 'valid', true));
  perform t.eq(r ->> 'decision', 'continue', 'right key works after the wait');
  perform t.eq((select count(*) from login_failures)::int, 0, 'and clears the counter');
  r := hook_password_verification_attempt(jsonb_build_object('user_id', gen_random_uuid(), 'valid', false));
  perform t.eq(r ->> 'decision', 'continue', 'unknown user id is ignored');
end $$;
rollback to sp;
savepoint sp;

-- session revocation + lookup helpers (service role only)
do $$
declare u uuid := t.mk_user('s@x.test'); n int;
begin
  insert into auth.sessions (user_id) values (u), (u);
  perform t.login_service();
  perform t.eq(auth_user_id_by_email(' S@x.test '), u, 'lookup by email is case/space-insensitive');
  perform t.ok(auth_user_id_by_email('nobody@x.test') is null, 'unknown email -> null');
  perform revoke_user_sessions(u);
  perform t.logout();
  perform t.eq((select count(*) from auth.sessions where user_id = u)::int, 0, 'sessions revoked');
end $$;
rollback to sp;
savepoint sp;

-- owner admin management
do $$
declare own uuid; own2 uuid; adm uuid; new_u uuid;
begin
  own := t.mk_admin('own@x.test', 'owner'); own2 := t.mk_admin('own2@x.test', 'owner'); adm := t.mk_admin('adm@x.test');
  new_u := t.mk_user('new@x.test');
  perform t.login(own);
  perform owner_add_admin(new_u, 'new@x.test', 'admin');
  perform t.fails(format($q$select owner_set_admin_active(%L, false)$q$, own), 'self_remove');
  perform t.fails($q$select owner_set_admin_active(gen_random_uuid(), false)$q$, 'not_found');
  perform owner_set_admin_active(adm, false);
  perform owner_set_admin_active(adm, true);
  perform owner_set_admin_active(own2, false);
  perform t.logout();
  perform t.ok((select active from admins where id = new_u), 'invited admin exists');
  perform t.ok(not (select active from admins where id = own2), 'another owner can be removed');
  perform t.ok((select active from admins where id = own), 'the acting owner stays active');
  perform t.ok(exists (select 1 from audit_log where action = 'admin.added' and actor_id = own and actor_type = 'admin'), 'admin.added audited with owner as actor');
  perform t.eq((select organization_id from audit_log where action = 'admin.added' and actor_id = own limit 1),
               (select id from organizations where slug = 'default'), 'admin audit is tenant-scoped');
  perform t.ok(exists (select 1 from audit_log where action = 'admin.removed' and entity_id = adm), 'admin.removed audited');
  -- an admin who is also a member email is rejected
  perform t.mk_member('mem@x.test', 'Mem');
  new_u := t.mk_user('mem2@x.test');
  perform t.login(own);
  perform t.fails(format($q$select owner_add_admin(%L, 'MEM@x.test', 'admin')$q$, new_u), 'member_email');
  perform t.logout();
end $$;
rollback to sp;
rollback;
