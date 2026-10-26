-- Enforce tenant identity from the authenticated member/admin row, never from a global fallback.
-- The zero-argument helper is the only contest context exposed to application RPCs.
do $$
begin
  if exists (
    select 1
    from admins a
    join members m on m.id = a.id
    where a.organization_id is distinct from m.organization_id
  ) then
    raise exception 'Resolve Auth accounts assigned to multiple organisations before applying organisation isolation.';
  end if;
end $$;

create or replace function current_organization_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select a.organization_id from admins a where a.id = auth.uid() and a.active),
    (select m.organization_id from members m where m.id = auth.uid() and m.active)
  )
$$;

create or replace function current_contest_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id
  from contests c
  where c.organization_id = current_organization_id()
  order by c.created_at desc
  limit 1
$$;

create or replace function current_contest_id(p_org_id uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id
  from contests c
  where p_org_id = current_organization_id()
    and c.organization_id = p_org_id
  order by c.created_at desc
  limit 1
$$;

create or replace function is_org_admin(p_org_id uuid default current_organization_id()) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_org_id = current_organization_id() and exists (
    select 1 from admins a
    where a.id = auth.uid() and a.active and a.organization_id = p_org_id
  )
$$;

create or replace function is_org_owner(p_org_id uuid default current_organization_id()) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_org_id = current_organization_id() and exists (
    select 1 from admins a
    where a.id = auth.uid() and a.active and a.role = 'owner'
      and a.organization_id = p_org_id
  )
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from admins a
    where a.id = auth.uid() and a.active
      and a.organization_id = current_organization_id()
  )
$$;

create or replace function is_owner() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from admins a
    where a.id = auth.uid() and a.active and a.role = 'owner'
      and a.organization_id = current_organization_id()
  )
$$;

create or replace function is_member() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from members m
    where m.id = auth.uid() and m.active
      and m.organization_id = current_organization_id()
      and m.contest_id = current_contest_id()
  )
$$;

-- Keep member registrations compatible with the Apps Script payload: the contest is the
-- authoritative source of the organisation, rather than a client-supplied tenant ID.
create function set_row_organization_from_contest() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_organization_id uuid;
begin
  select c.organization_id into v_organization_id
  from contests c
  where c.id = new.contest_id;

  if v_organization_id is null then
    raise exception 'contest_not_found: The selected contest does not exist.';
  end if;
  if new.organization_id is not null and new.organization_id <> v_organization_id then
    raise exception 'organization_mismatch: The row organisation must match its contest.';
  end if;

  new.organization_id := v_organization_id;
  return new;
end $$;

revoke all on function set_row_organization_from_contest() from public, anon, authenticated;

create trigger members_set_organization
before insert or update of contest_id, organization_id on members
for each row execute function set_row_organization_from_contest();

create trigger categories_set_organization
before insert or update of contest_id, organization_id on categories
for each row execute function set_row_organization_from_contest();

create trigger submissions_set_organization
before insert or update of contest_id, organization_id on submissions
for each row execute function set_row_organization_from_contest();

create function enforce_identity_organization() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_organization_id uuid;
begin
  if tg_table_name = 'members' then
    select a.organization_id into v_organization_id
    from admins a where a.id = new.id;
  else
    select m.organization_id into v_organization_id
    from members m where m.id = new.id;
  end if;

  if v_organization_id is not null and v_organization_id <> new.organization_id then
    raise exception 'identity_organization_conflict: An Auth account can belong to only one organisation.';
  end if;
  return new;
end $$;

revoke all on function enforce_identity_organization() from public, anon, authenticated;

create trigger members_validate_identity_organization
before insert or update of id, organization_id on members
for each row execute function enforce_identity_organization();

create trigger admins_validate_identity_organization
before insert or update of id, organization_id on admins
for each row execute function enforce_identity_organization();

create function set_audit_organization_from_contest() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_organization_id uuid;
begin
  if new.contest_id is null then
    select coalesce(
      (select a.organization_id from admins a where a.id = new.actor_id),
      (select m.organization_id from members m where m.id = new.actor_id),
      new.organization_id
    )
    into v_organization_id;

    if new.organization_id is not null
       and v_organization_id is not null
       and new.organization_id <> v_organization_id then
      raise exception 'organization_mismatch: The audit organisation must match its actor.';
    end if;

    new.organization_id := v_organization_id;
    return new;
  end if;

  select c.organization_id into v_organization_id
  from contests c
  where c.id = new.contest_id;

  if v_organization_id is null then
    raise exception 'contest_not_found: The audit contest does not exist.';
  end if;
  if new.organization_id is not null and new.organization_id <> v_organization_id then
    raise exception 'organization_mismatch: The audit organisation must match its contest.';
  end if;

  new.organization_id := v_organization_id;
  return new;
end $$;

revoke all on function set_audit_organization_from_contest() from public, anon, authenticated;

create trigger audit_log_set_organization
before insert or update of contest_id, organization_id on audit_log
for each row execute function set_audit_organization_from_contest();

-- Composite keys make cross-organisation/contest references impossible even for privileged
-- writers that bypass RLS, including submissions pointing at another tenant's member/category.
alter table contests add constraint contests_id_organization_uq unique (id, organization_id);
alter table members add constraint members_id_contest_organization_uq
  unique (id, contest_id, organization_id);
alter table categories add constraint categories_id_contest_organization_uq
  unique (id, contest_id, organization_id);
alter table submissions add constraint submissions_id_contest_organization_uq
  unique (id, contest_id, organization_id);

create index members_contest_organization_idx on members (contest_id, organization_id);
create index categories_contest_organization_idx on categories (contest_id, organization_id);
create index submissions_member_tenant_idx on submissions (member_id, contest_id, organization_id);
create index submissions_category_tenant_idx on submissions (category_id, contest_id, organization_id);
create index submissions_resubmission_tenant_idx on submissions (resubmission_of, contest_id, organization_id)
  where resubmission_of is not null;

alter table members add constraint members_contest_organization_fkey
  foreign key (contest_id, organization_id)
  references contests (id, organization_id) not valid;
alter table categories add constraint categories_contest_organization_fkey
  foreign key (contest_id, organization_id)
  references contests (id, organization_id) not valid;
alter table submissions add constraint submissions_contest_organization_fkey
  foreign key (contest_id, organization_id)
  references contests (id, organization_id) not valid;
alter table submissions add constraint submissions_member_tenant_fkey
  foreign key (member_id, contest_id, organization_id)
  references members (id, contest_id, organization_id) not valid;
alter table submissions add constraint submissions_category_tenant_fkey
  foreign key (category_id, contest_id, organization_id)
  references categories (id, contest_id, organization_id) not valid;
alter table submissions add constraint submissions_resubmission_tenant_fkey
  foreign key (resubmission_of, contest_id, organization_id)
  references submissions (id, contest_id, organization_id) not valid;

alter table members validate constraint members_contest_organization_fkey;
alter table categories validate constraint categories_contest_organization_fkey;
alter table submissions validate constraint submissions_contest_organization_fkey;
alter table submissions validate constraint submissions_member_tenant_fkey;
alter table submissions validate constraint submissions_category_tenant_fkey;
alter table submissions validate constraint submissions_resubmission_tenant_fkey;

-- Organisation-admin RPCs must only manage admins in the caller's own organisation.
create or replace function owner_add_admin(p_user uuid, p_email citext, p_role admin_role) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_organization_id uuid := current_organization_id();
begin
  perform _require_owner();
  if v_organization_id is null then
    raise exception 'forbidden: An organisation owner is required.';
  end if;
  perform _audit_ctx('admin.added', null);
  insert into admins (id, email, role, organization_id)
  values (p_user, p_email, p_role, v_organization_id);
end $$;

create or replace function owner_set_admin_active(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_organization_id uuid := current_organization_id();
begin
  perform _require_owner();
  if not exists (
    select 1 from admins where id = p_id and organization_id = v_organization_id
  ) then
    raise exception 'not_found: Admin not found.';
  end if;
  if not p_active and p_id = auth.uid() then
    raise exception 'self_remove: You cannot remove yourself.';
  end if;
  perform _audit_ctx(case when p_active then 'admin.reactivated' else 'admin.removed' end, null);
  update admins
  set active = p_active
  where id = p_id and organization_id = v_organization_id;
end $$;

-- RLS helpers must not make platform admins implicit members/admins of every contest.
create function is_platform_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from platform_admins pa where pa.id = auth.uid() and pa.active
  )
$$;

revoke all on function is_platform_admin() from public, anon, authenticated;
grant execute on function is_platform_admin() to authenticated, service_role;
grant execute on function current_organization_id(), current_contest_id(),
  current_contest_id(uuid), is_admin(), is_owner(), is_member(),
  is_org_admin(uuid), is_org_owner(uuid)
to authenticated, service_role;

-- Organisation metadata is visible only to its own signed-in users, except platform admins.
alter table organizations enable row level security;
alter table platform_admins enable row level security;
grant select on organizations to authenticated;
revoke all on platform_admins from public, anon, authenticated;

drop policy if exists contests_select on contests;
drop policy if exists members_select on members;
drop policy if exists admins_select on admins;
drop policy if exists categories_select on categories;
drop policy if exists submissions_select on submissions;
drop policy if exists audit_log_select on audit_log;
drop policy if exists organizations_select on organizations;

create policy organizations_select on organizations for select to authenticated
  using (id = current_organization_id() or is_platform_admin());

create policy contests_select on contests for select to authenticated
  using (
    organization_id = current_organization_id()
    and (is_member() or is_admin())
  );

create policy members_select on members for select to authenticated
  using (
    organization_id = current_organization_id()
    and (id = auth.uid() or is_admin())
  );

create policy admins_select on admins for select to authenticated
  using (organization_id = current_organization_id() and is_admin());

create policy categories_select on categories for select to authenticated
  using (
    organization_id = current_organization_id()
    and contest_id = current_contest_id()
    and ((active and is_member()) or is_admin())
  );

create policy submissions_select on submissions for select to authenticated
  using (
    organization_id = current_organization_id()
    and ((member_id = auth.uid() and is_member()) or is_admin())
  );

create policy audit_log_select on audit_log for select to authenticated
  using (organization_id = current_organization_id() and is_admin());

-- Proof paths begin with contest_id/member_id. Keep the same tenant boundary in Storage RLS.
drop policy if exists proofs_select on storage.objects;
create policy proofs_select on storage.objects for select to authenticated
  using (
    bucket_id = 'proofs'
    and exists (
      select 1
      from contests c
      where c.id::text = (storage.foldername(name))[1]
        and c.organization_id = current_organization_id()
        and (
          (c.id = current_contest_id()
            and (storage.foldername(name))[2] = auth.uid()::text
            and is_member())
          or is_admin()
        )
    )
  );