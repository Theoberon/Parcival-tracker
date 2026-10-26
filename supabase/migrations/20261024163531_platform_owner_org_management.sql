-- Platform owners are not bound to one tenant. Their selected organisation is supplied as an
-- ordinary request header, but only an active platform_admins row can make that header effective.
create or replace function current_organization_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when exists (
      select 1 from platform_admins pa where pa.id = auth.uid() and pa.active
    ) then (
      select o.id
      from organizations o
      where o.id::text = (
        coalesce(current_setting('request.headers', true), '{}')::jsonb
          ->> 'x-organization-id'
      )
      limit 1
    )
    else coalesce(
      (select a.organization_id from admins a where a.id = auth.uid() and a.active),
      (select m.organization_id from members m where m.id = auth.uid() and m.active)
    )
  end
$$;

create or replace function is_org_admin(p_org_id uuid default current_organization_id()) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_org_id = current_organization_id()
    and p_org_id is not null
    and (
      exists (select 1 from platform_admins pa where pa.id = auth.uid() and pa.active)
      or exists (
        select 1 from admins a
        where a.id = auth.uid() and a.active and a.organization_id = p_org_id
      )
    )
$$;

create or replace function is_org_owner(p_org_id uuid default current_organization_id()) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_org_id = current_organization_id()
    and p_org_id is not null
    and (
      exists (select 1 from platform_admins pa where pa.id = auth.uid() and pa.active)
      or exists (
        select 1 from admins a
        where a.id = auth.uid() and a.active and a.role = 'owner'
          and a.organization_id = p_org_id
      )
    )
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select current_organization_id() is not null and (
    exists (select 1 from platform_admins pa where pa.id = auth.uid() and pa.active)
    or exists (
      select 1 from admins a
      where a.id = auth.uid() and a.active
        and a.organization_id = current_organization_id()
    )
  )
$$;

create or replace function is_owner() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select current_organization_id() is not null and (
    exists (select 1 from platform_admins pa where pa.id = auth.uid() and pa.active)
    or exists (
      select 1 from admins a
      where a.id = auth.uid() and a.active and a.role = 'owner'
        and a.organization_id = current_organization_id()
    )
  )
$$;

create function platform_owner_create_organization(
  p_name text,
  p_slug text,
  p_contest_name text,
  p_start_at timestamptz,
  p_end_at timestamptz
)
returns table (organization_id uuid, contest_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_contest_name text := btrim(coalesce(p_contest_name, ''));
  v_org_id uuid;
  v_contest_id uuid;
begin
  if not exists (select 1 from platform_admins pa where pa.id = auth.uid() and pa.active) then
    raise exception 'forbidden: Only a platform owner can create organisations.' using errcode = '42501';
  end if;
  perform _audit_ctx(null, null);
  if char_length(v_name) not between 1 and 120 then
    raise exception 'invalid_organization: Organisation name must be 1 to 120 characters.';
  end if;
  if char_length(v_slug) not between 2 and 60 or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'invalid_slug: Use 2 to 60 lowercase letters, numbers, and single hyphens.';
  end if;
  if char_length(v_contest_name) not between 1 and 120 then
    raise exception 'invalid_contest: Contest name must be 1 to 120 characters.';
  end if;
  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception 'invalid_dates: The contest end must be later than its start.';
  end if;

  begin
    insert into organizations (name, slug)
    values (v_name, v_slug)
    returning id into v_org_id;
  exception
    when unique_violation then
      raise exception 'organization_slug_taken: An organisation with this slug already exists.';
  end;

  insert into contests (organization_id, name, start_at, end_at)
  values (v_org_id, v_contest_name, p_start_at, p_end_at)
  returning id into v_contest_id;

  insert into categories (contest_id, name, points, reference_label, reference_hint, sort_order)
  values
    (v_contest_id, 'New Account', 2, 'Account username', 'jane_designs', 1),
    (v_contest_id, 'New Gig', 1, 'Gig title', 'i will build hubspot workflows', 2),
    (v_contest_id, 'New Message', 2, 'Buyer username + date', 'buyer123 2026-10-20', 3),
    (v_contest_id, 'Converted Message / Order', 5, 'Fiverr order number', 'FO1234567890', 4);

  insert into audit_log (contest_id, actor_type, actor_id, action, entity, entity_id, after)
  values (
    v_contest_id, 'admin', auth.uid(), 'organization.created', 'organization', v_org_id,
    jsonb_build_object('name', v_name, 'slug', v_slug)
  );

  return query select v_org_id, v_contest_id;
end $$;

revoke all on function platform_owner_create_organization(text, text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function platform_owner_create_organization(text, text, text, timestamptz, timestamptz)
  to authenticated;