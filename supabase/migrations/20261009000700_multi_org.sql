-- Multi-tenant organization support: each organisation has its own admins, contests, and members.
-- This keeps a single-site install working by assigning all legacy rows to a default org.

create table organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 120),
  slug       citext not null unique check (char_length(btrim(slug)) between 2 and 60),
  created_at timestamptz not null default now()
);
create unique index organizations_slug_lower_uq on organizations (lower(slug));

create table platform_admins (
  id         uuid primary key references auth.users (id),
  email      citext not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table contests add column if not exists organization_id uuid;
alter table members add column if not exists organization_id uuid;
alter table admins add column if not exists organization_id uuid;
alter table categories add column if not exists organization_id uuid;
alter table submissions add column if not exists organization_id uuid;
alter table audit_log add column if not exists organization_id uuid;
alter table key_requests add column if not exists organization_id uuid;

-- Backfilling tenant IDs is a schema transition, not a user change. Avoid synthetic audit
-- events and let historical records migrate even when their contest is already frozen.
alter table contests disable trigger contests_audit;
alter table members disable trigger members_touch;
alter table members disable trigger members_audit;
alter table admins disable trigger admins_audit;
alter table categories disable trigger categories_guard;
alter table categories disable trigger categories_audit;
alter table submissions disable trigger submissions_guard;
alter table submissions disable trigger submissions_audit;
alter table audit_log disable trigger audit_log_no_change;

with default_org as (
  insert into organizations (name, slug)
  select 'Default organization', 'default'
  where not exists (select 1 from organizations)
  returning id
)
update contests c
set organization_id = coalesce(c.organization_id, d.id)
from default_org d
where c.organization_id is null;

update members m
set organization_id = coalesce(m.organization_id, c.organization_id)
from contests c
where m.contest_id = c.id and m.organization_id is null;

update admins a
set organization_id = coalesce(a.organization_id, m.organization_id)
from members m
where a.id = m.id and a.organization_id is null;

update admins a
set organization_id = coalesce(a.organization_id, o.id)
from organizations o
where a.organization_id is null
and not exists (
  select 1 from members m where m.id = a.id
);

update categories cat
set organization_id = coalesce(cat.organization_id, c.organization_id)
from contests c
where cat.contest_id = c.id and cat.organization_id is null;

update submissions s
set organization_id = coalesce(s.organization_id, c.organization_id)
from contests c
where s.contest_id = c.id and s.organization_id is null;

update audit_log al
set organization_id = coalesce(
  al.organization_id,
  (select c.organization_id from contests c where c.id = al.contest_id),
  (select a.organization_id from admins a where a.id = al.actor_id),
  (select m.organization_id from members m where m.id = al.actor_id)
)
where al.organization_id is null;

update key_requests kr
set organization_id = (
  select c.organization_id
  from members m
  join contests c on c.id = m.contest_id
  where lower(m.email) = lower(kr.email)
  order by c.created_at desc
  limit 1
)
where kr.organization_id is null;

alter table contests enable trigger contests_audit;
alter table members enable trigger members_touch;
alter table members enable trigger members_audit;
alter table admins enable trigger admins_audit;
alter table categories enable trigger categories_guard;
alter table categories enable trigger categories_audit;
alter table submissions enable trigger submissions_guard;
alter table submissions enable trigger submissions_audit;
alter table audit_log enable trigger audit_log_no_change;

alter table contests alter column organization_id set not null;
alter table members alter column organization_id set not null;
alter table admins alter column organization_id set not null;
alter table categories alter column organization_id set not null;
alter table submissions alter column organization_id set not null;

alter table contests
  add constraint contests_organization_fkey foreign key (organization_id) references organizations (id) on delete cascade;

alter table members
  add constraint members_organization_fkey foreign key (organization_id) references organizations (id) on delete cascade;

alter table admins
  drop constraint if exists admins_email_key,
  add constraint admins_organization_fkey foreign key (organization_id) references organizations (id) on delete cascade,
  add constraint admins_org_email_uq unique (organization_id, email);

alter table categories
  add constraint categories_organization_fkey foreign key (organization_id) references organizations (id) on delete cascade;

alter table submissions
  add constraint submissions_organization_fkey foreign key (organization_id) references organizations (id) on delete cascade;

alter table audit_log
  add constraint audit_log_organization_fkey foreign key (organization_id) references organizations (id) on delete set null;

alter table key_requests
  add constraint key_requests_organization_fkey foreign key (organization_id) references organizations (id) on delete set null;

create index contests_organization_idx on contests (organization_id, created_at desc);
create index members_organization_idx on members (organization_id, contest_id, active);
create index admins_organization_idx on admins (organization_id, active, role);
create index categories_organization_idx on categories (organization_id, contest_id, active, sort_order);
create index submissions_organization_idx on submissions (organization_id, contest_id, status, submitted_at desc);
create index audit_log_organization_idx on audit_log (organization_id, contest_id, created_at desc);

create function current_organization_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select organization_id from admins where id = auth.uid() and active limit 1),
    (select organization_id from members where id = auth.uid() and active limit 1)
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

create function current_contest_id(p_org_id uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id
  from contests c
  where p_org_id = current_organization_id()
    and c.organization_id = p_org_id
  order by c.created_at desc
  limit 1
$$;

create function is_org_admin(p_org_id uuid default current_organization_id()) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from admins a
    where a.id = auth.uid()
      and a.active
      and p_org_id = current_organization_id()
      and a.organization_id = p_org_id
  )
$$;

create function is_org_owner(p_org_id uuid default current_organization_id()) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from admins a
    where a.id = auth.uid()
      and a.active
      and a.role = 'owner'
      and p_org_id = current_organization_id()
      and a.organization_id = p_org_id
  )
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from admins a
    where a.id = auth.uid()
      and a.active
      and a.organization_id = current_organization_id()
  )
$$;

create or replace function is_owner() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from admins a
    where a.id = auth.uid()
      and a.active
      and a.role = 'owner'
      and a.organization_id = current_organization_id()
  )
$$;

create or replace function is_member() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from members m
    where m.id = auth.uid()
      and m.active
      and m.organization_id = current_organization_id()
      and m.contest_id = current_contest_id()
  )
$$;

revoke all on function current_organization_id() from public, anon, authenticated;
grant execute on function current_organization_id() to service_role, authenticated;
revoke all on function current_contest_id(uuid) from public, anon, authenticated;
grant execute on function current_contest_id(uuid) to service_role, authenticated;
revoke all on function is_org_admin(uuid) from public, anon, authenticated;
grant execute on function is_org_admin(uuid) to service_role, authenticated;
revoke all on function is_org_owner(uuid) from public, anon, authenticated;
grant execute on function is_org_owner(uuid) to service_role, authenticated;
revoke all on function is_admin() from public, anon, authenticated;
grant execute on function is_admin() to service_role, authenticated;
revoke all on function is_owner() from public, anon, authenticated;
grant execute on function is_owner() to service_role, authenticated;
revoke all on function is_member() from public, anon, authenticated;
grant execute on function is_member() to service_role, authenticated;
