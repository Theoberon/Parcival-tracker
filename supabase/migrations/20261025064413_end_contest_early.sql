-- Allow an owner to close registration and submissions before the scheduled deadline.
alter table contests add column ended_at timestamptz;

create or replace function contest_effective_status(p_contest uuid) returns contest_status
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when c.manual_status in ('final', 'archived') then c.manual_status
    when c.ended_at is not null then 'closed'::contest_status
    when now() < c.start_at then 'setup'::contest_status
    when now() < c.end_at then 'open'::contest_status
    else 'closed'::contest_status
  end
  from contests c where c.id = p_contest
$$;

create function end_contest(p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := current_contest_id();
  v_reason text;
begin
  perform _require_owner();
  v_reason := _require_reason(p_reason);
  perform 1 from contests where id = v_id for update;
  if not found then
    raise exception 'not_found: Contest not found.';
  end if;
  if contest_effective_status(v_id) not in ('setup', 'open') then
    raise exception 'contest_not_active: The contest is already closed.';
  end if;

  perform _audit_ctx('contest.ended_early', v_reason);
  update contests set ended_at = now() where id = v_id;
end $$;

create or replace function extend_deadline(p_new_end timestamptz, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := current_contest_id();
  v_reason text;
begin
  perform _require_owner();
  v_reason := _require_reason(p_reason);
  if contest_effective_status(v_id) in ('final', 'archived') then
    raise exception 'contest_frozen: Reopen the contest before extending the deadline.';
  end if;
  if p_new_end <= (select end_at from contests where id = v_id) then
    raise exception 'deadline_shorten: The new deadline must be later than the current one.';
  end if;
  perform _audit_ctx('contest.deadline_extended', v_reason);
  update contests set end_at = p_new_end, ended_at = null where id = v_id;
end $$;

create or replace function publish_final(p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := current_contest_id();
  v_c contests;
  v_reason text;
begin
  perform _require_owner();
  v_reason := _require_reason(p_reason);
  select * into v_c from contests where id = v_id for update;
  if contest_effective_status(v_id) <> 'closed' then
    raise exception 'not_closed: The contest must be closed before publishing final results.';
  end if;
  if v_c.ended_at is null
     and now() <= v_c.end_at + make_interval(mins => v_c.grace_minutes) then
    raise exception 'grace_open: Wait until the grace period after the deadline has ended.';
  end if;
  if exists (select 1 from submissions where contest_id = v_id and status = 'pending') then
    raise exception 'pending_remaining: Review all pending submissions first.';
  end if;
  perform _audit_ctx('contest.published', v_reason);
  update contests
     set manual_status = 'final', finalized_at = now(),
         results_updated_at = case when finalized_at is not null then now() end
   where id = v_id;
end $$;

revoke all on function end_contest(text) from public, anon;
grant execute on function end_contest(text) to authenticated, service_role;