-- Start a new contest within an organisation while retaining the previous results for seven days
-- after the new contest starts. Returning members keep the same Auth ID and password.

create table if not exists contest_history (
  source_contest_id uuid primary key,
  organization_id uuid not null references organizations (id),
  contest_name text not null,
  available_at timestamptz not null,
  expires_at timestamptz not null,
  categories jsonb not null,
  standings jsonb not null,
  created_at timestamptz not null default now(),
  check (expires_at > available_at)
);

create table if not exists organization_members (
  id            uuid primary key references auth.users (id),
  organization_id uuid not null references organizations (id),
  email         citext not null,
  display_name  text not null check (char_length(btrim(display_name)) between 1 and 60),
  title         text check (title is null or char_length(btrim(title)) between 1 and 80),
  key_version   int not null default 1,
  active        boolean not null default true,
  registered_at timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (organization_id, email),
  unique (id, organization_id)
);
create index if not exists organization_members_org_active_idx on organization_members (organization_id, active);

insert into organization_members (
  id, organization_id, email, display_name, title, key_version, active, registered_at, updated_at
)
select id, organization_id, email, display_name, title, key_version, active, registered_at, updated_at
from members
on conflict (id) do nothing;

drop trigger if exists organization_members_touch on organization_members;
create trigger organization_members_touch before update on organization_members
  for each row execute function trg_touch_updated_at();

alter table organization_members enable row level security;
revoke all on organization_members from public, anon, authenticated;
revoke all on organization_members from service_role;
grant select, update on organization_members to service_role;

create index if not exists contest_history_expiry_idx on contest_history (expires_at);
alter table contest_history enable row level security;
revoke all on contest_history from public, anon, authenticated;
grant select on contest_history to service_role;

create or replace function trg_guard_category() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v_contest uuid := coalesce(new.contest_id, old.contest_id);
  v_status contest_status := contest_effective_status(v_contest);
begin
  if tg_op = 'DELETE'
     and current_user = 'postgres'
     and current_setting('app.contest_retention_purge', true) = 'on' then
    return old;
  end if;
  if v_status in ('final', 'archived') then
    raise exception 'contest_frozen: The contest is final; categories cannot change.';
  end if;
  if tg_op = 'UPDATE' and new.points <> old.points
     and v_status <> 'setup'
     and not (select points_unlocked from contests where id = v_contest) then
    raise exception 'points_locked: Point values are locked once the contest starts.';
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from submissions where category_id = old.id) then
      raise exception 'category_in_use: Category has submissions; deactivate it instead.';
    end if;
    return old;
  end if;
  return new;
end $$;

create or replace function trg_guard_submission() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v_contest uuid := coalesce(new.contest_id, old.contest_id);
begin
  if tg_op = 'DELETE'
     and current_user = 'postgres'
     and current_setting('app.contest_retention_purge', true) = 'on' then
    return old;
  end if;
  if contest_effective_status(v_contest) in ('final', 'archived')
     and not (tg_op = 'DELETE' and old.status = 'draft') then
    raise exception 'contest_frozen: The contest is final; submissions cannot change.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create or replace function trg_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_uid uuid := auth.uid();
  v_actor actor_type;
  v_noun text;
  v_action text;
  v_contest uuid;
begin
  if tg_table_name = 'contests'
     and tg_op = 'DELETE'
     and current_user = 'postgres'
     and current_setting('app.contest_retention_purge', true) = 'on' then
    return null;
  end if;
  if tg_table_name = 'submissions' then
    if coalesce(v_old ->> 'status', 'draft') = 'draft' and coalesce(v_new ->> 'status', 'draft') = 'draft' then
      return null;
    end if;
    if tg_op = 'UPDATE' and (v_old - 'claimed_by' - 'claimed_until') = (v_new - 'claimed_by' - 'claimed_until') then
      return null;
    end if;
  end if;
  if tg_op = 'UPDATE' and v_old = v_new then return null; end if;

  v_actor := case
    when v_uid is null then 'system'
    when exists (select 1 from admins where id = v_uid) then 'admin'
    when exists (select 1 from members where id = v_uid) then 'member'
    else 'system' end;
  v_noun := case tg_table_name
    when 'contests' then 'contest' when 'members' then 'member' when 'admins' then 'admin'
    when 'categories' then 'category' else 'submission' end;
  v_action := coalesce(
    nullif(current_setting('app.action', true), ''),
    case when tg_table_name = 'submissions' and tg_op = 'UPDATE' and v_old ->> 'status' <> v_new ->> 'status'
         then 'submission.' || (v_new ->> 'status') end,
    v_noun || '.' || lower(tg_op));
  v_contest := case tg_table_name
    when 'contests' then (v_row ->> 'id')::uuid
    when 'admins' then current_contest_id()
    else (v_row ->> 'contest_id')::uuid end;

  insert into audit_log (contest_id, actor_type, actor_id, action, entity, entity_id, before, after, reason)
  values (v_contest, v_actor, v_uid, v_action, tg_table_name, (v_row ->> 'id')::uuid,
          v_old, v_new, nullif(current_setting('app.reason', true), ''));
  return null;
end $$;

create or replace function trg_audit_immutable() returns trigger
language plpgsql as $$
begin
  if current_user = 'postgres'
     and current_setting('app.contest_retention_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'audit_immutable: The audit log is append-only.';
end $$;

create or replace function enforce_identity_organization() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_organization_id uuid;
begin
  if tg_table_name = 'members' then
    select a.organization_id into v_organization_id from admins a where a.id = new.id;
    if v_organization_id is null then
      select om.organization_id into v_organization_id from organization_members om where om.id = new.id;
    end if;
  elsif tg_table_name = 'organization_members' then
    select a.organization_id into v_organization_id from admins a where a.id = new.id;
    if v_organization_id is null then
      select m.organization_id into v_organization_id from members m where m.id = new.id;
    end if;
  else
    select m.organization_id into v_organization_id from members m where m.id = new.id;
    if v_organization_id is null then
      select om.organization_id into v_organization_id from organization_members om where om.id = new.id;
    end if;
  end if;

  if v_organization_id is not null and v_organization_id <> new.organization_id then
    raise exception 'identity_organization_conflict: An Auth account can belong to only one organisation.';
  end if;
  return new;
end $$;

drop trigger if exists organization_members_validate_identity_organization on organization_members;
create trigger organization_members_validate_identity_organization
before insert or update of id, organization_id on organization_members
for each row execute function enforce_identity_organization();

revoke all on function enforce_identity_organization() from public, anon, authenticated;

create or replace function set_member_active(p_member uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  perform _require_admin();
  perform _audit_ctx(case when p_active then 'member.reactivated' else 'member.deactivated' end, null);
  update members set active = p_active where id = p_member and contest_id = current_contest_id();
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'not_found: Member not found.'; end if;
  update organization_members set active = p_active
  where id = p_member and organization_id = current_organization_id();
end $$;

create or replace function register_organization_member(
  p_organization_id uuid,
  p_member_id uuid,
  p_email citext,
  p_display_name text,
  p_title text
) returns table (id uuid, email citext, display_name text, title text, key_version int, active boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_contest_id uuid;
  v_status contest_status;
  v_display_name text;
  v_suffix int := 1;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'forbidden: Service role only.' using errcode = '42501';
  end if;
  if p_organization_id is null or not exists (
    select 1 from organizations where organizations.id = p_organization_id
  ) then
    raise exception 'organization_not_found: The selected organisation does not exist.';
  end if;
  if p_email is null or p_display_name is null
     or char_length(btrim(p_display_name)) not between 1 and 60 then
    raise exception 'invalid_member: Email and display name are required.';
  end if;
  if exists (select 1 from admins where admins.email = p_email) then
    raise exception 'admin_email: This email belongs to an admin and cannot register as a member.';
  end if;

  perform 1 from organizations where organizations.id = p_organization_id for update;
  v_display_name := left(btrim(p_display_name), 60);
  while exists (
    select 1 from organization_members om
    where om.organization_id = p_organization_id
      and lower(om.display_name) = lower(v_display_name)
  ) loop
    v_suffix := v_suffix + 1;
    v_display_name := left(btrim(p_display_name), 60 - char_length(' ' || v_suffix)) || ' ' || v_suffix;
  end loop;

  insert into organization_members (id, organization_id, email, display_name, title)
  values (p_member_id, p_organization_id, p_email, v_display_name, nullif(btrim(p_title), ''));

  select c.id
    into v_contest_id
  from contests c
  where c.organization_id = p_organization_id
  order by c.created_at desc
  limit 1
  for update;
  if v_contest_id is not null then
    v_status := contest_effective_status(v_contest_id);
  end if;

  if v_contest_id is not null and v_status in ('setup', 'open') then
    insert into members (id, contest_id, organization_id, email, display_name, title)
    values (p_member_id, v_contest_id, p_organization_id, p_email, v_display_name, nullif(btrim(p_title), ''));
  end if;

  return query select om.id, om.email, om.display_name, om.title, om.key_version, om.active
  from organization_members om where om.id = p_member_id;
end $$;

create or replace function create_next_contest(
  p_name text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_reason text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := current_organization_id();
  v_old_id uuid;
  v_new_id uuid;
  v_old contests;
  v_available_at timestamptz;
  v_reason text;
  v_categories jsonb;
  v_standings jsonb;
  v_roster record;
  v_display_name text;
  v_suffix int;
begin
  perform _require_owner();
  if v_org is null then
    raise exception 'forbidden: Owner only.' using errcode = '42501';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 then
    raise exception 'invalid_name: Contest name must be between 1 and 120 characters.';
  end if;
  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception 'invalid_dates: The end date must be after the start date.';
  end if;
  v_reason := _require_reason(p_reason);

  -- Serialize starts for this organisation so concurrent owner requests cannot create two contests.
  perform 1 from organizations where id = v_org for update;
  v_old_id := current_contest_id();
  if v_old_id is null then
    raise exception 'contest_not_found: No contest exists for this organisation.';
  end if;
  select * into v_old from contests where id = v_old_id and organization_id = v_org for update;
  if not found or contest_effective_status(v_old_id) not in ('final', 'archived') then
    raise exception 'contest_not_final: Publish final results before starting another contest.';
  end if;
  if exists (
    select 1 from contests c
    where c.organization_id = v_org
      and c.id <> v_old_id
      and contest_effective_status(c.id) not in ('final', 'archived')
  ) then
    raise exception 'contest_in_progress: Finish the current contest before starting another.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(cat) order by cat.sort_order, cat.id), '[]'::jsonb)
    into v_categories
  from categories cat where cat.contest_id = v_old_id;
  select coalesce(jsonb_agg(to_jsonb(st) order by st.ord), '[]'::jsonb)
    into v_standings
  from _standings(v_old_id) st;

  v_available_at := greatest(p_start_at, now());
  insert into contest_history (
    source_contest_id, organization_id, contest_name, available_at, expires_at, categories, standings
  ) values (
    v_old_id, v_org, v_old.name, v_available_at, v_available_at + interval '7 days',
    v_categories, v_standings
  );

  insert into contests (organization_id, name, start_at, end_at)
  values (v_org, btrim(p_name), p_start_at, p_end_at)
  returning id into v_new_id;

  insert into categories (contest_id, name, points, reference_label, reference_hint, sort_order)
  values
    (v_new_id, 'New Account', 2, 'Account username', 'jane_designs', 1),
    (v_new_id, 'New Gig', 1, 'Gig title', 'i will build hubspot workflows', 2),
    (v_new_id, 'New Message', 2, 'Buyer username + date', 'buyer123 2026-10-20', 3),
    (v_new_id, 'Converted Message / Order', 5, 'Fiverr order number', 'FO1234567890', 4);

  perform set_config('app.action', 'contest.superseded_cleanup', true);
  perform set_config('app.reason', v_reason, true);
  perform set_config('app.contest_retention_purge', 'on', true);
  delete from submissions where contest_id = v_old_id;
  delete from categories where contest_id = v_old_id;
  update contests set manual_status = 'archived' where id = v_old_id;
  update members set contest_id = v_new_id where contest_id = v_old_id;
  for v_roster in
    select om.* from organization_members om
    where om.organization_id = v_org
      and not exists (select 1 from members m where m.id = om.id)
    order by om.registered_at, om.id
  loop
    v_display_name := v_roster.display_name;
    v_suffix := 1;
    while exists (
      select 1 from members m
      where m.contest_id = v_new_id and lower(m.display_name) = lower(v_display_name)
    ) loop
      v_suffix := v_suffix + 1;
      v_display_name := left(v_roster.display_name, 60 - char_length(' ' || v_suffix)) || ' ' || v_suffix;
    end loop;

    update organization_members set display_name = v_display_name where id = v_roster.id;
    insert into members (
      id, contest_id, organization_id, email, display_name, title, key_version, active, registered_at
    ) values (
      v_roster.id, v_new_id, v_roster.organization_id, v_roster.email, v_display_name, v_roster.title,
      v_roster.key_version, v_roster.active, v_roster.registered_at
    );
  end loop;
  perform set_config('app.contest_retention_purge', 'off', true);

  return v_new_id;
end $$;

create or replace function purge_expired_contest_history(p_source_contest_ids uuid[])
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count int;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'forbidden: Service role only.' using errcode = '42501';
  end if;
  if p_source_contest_ids is null or cardinality(p_source_contest_ids) = 0 then
    return 0;
  end if;
  if exists (
    select 1 from unnest(p_source_contest_ids) as requested(id)
    left join contest_history h on h.source_contest_id = requested.id
    where h.source_contest_id is null or h.expires_at > now()
  ) then
    raise exception 'history_not_expired: Contest history is not ready for deletion.';
  end if;

  perform set_config('app.contest_retention_purge', 'on', true);
  delete from audit_log where contest_id = any(p_source_contest_ids);
  delete from contests where id = any(p_source_contest_ids) and manual_status = 'archived';
  delete from contest_history where source_contest_id = any(p_source_contest_ids);
  get diagnostics v_count = row_count;
  perform set_config('app.contest_retention_purge', 'off', true);
  return v_count;
end $$;

create or replace function get_contest_history()
returns table (
  source_contest_id uuid,
  contest_name text,
  available_at timestamptz,
  expires_at timestamptz,
  categories jsonb,
  standings jsonb
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform _require_owner();
  return query
    select h.source_contest_id, h.contest_name, h.available_at, h.expires_at, h.categories, h.standings
    from contest_history h
    where h.organization_id = current_organization_id()
      and h.available_at <= now()
      and h.expires_at > now()
    order by h.created_at desc;
end $$;

revoke all on function create_next_contest(text, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke all on function get_contest_history() from public, anon, authenticated;
revoke all on function purge_expired_contest_history(uuid[]) from public, anon, authenticated, service_role;
revoke all on function register_organization_member(uuid, uuid, citext, text, text) from public, anon, authenticated, service_role;
grant execute on function create_next_contest(text, timestamptz, timestamptz, text) to authenticated;
grant execute on function get_contest_history() to authenticated;
grant execute on function purge_expired_contest_history(uuid[]) to service_role;
grant execute on function register_organization_member(uuid, uuid, citext, text, text) to service_role;