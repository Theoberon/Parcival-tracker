-- Run AFTER you created the user's login in the dashboard:
--   Authentication -> Users -> Add user -> Create new user (email + password, tick "Auto Confirm User").
--
-- Set the email and role below, then Run. Use only 'owner' or 'admin' for the role.
-- If the user already has an admins row, this updates its role and reactivates it.

with settings as (
  select lower('PUT-YOUR-EMAIL-HERE@example.com') as email,
         'admin'::public.admin_role as desired_role
),
target_user as (
  select u.id, u.email, s.desired_role
  from auth.users u
  cross join settings s
  where lower(u.email) = s.email
),
upserted as (
  insert into public.admins (id, email, role, active)
  select id, email, desired_role, true
  from target_user
  on conflict (id) do update
    set email = excluded.email,
        role = excluded.role,
        active = true
  returning id, email, role, active
)
select id, email::text as email, role::text as role, active, 'created/updated' as result
from upserted
union all
select null::uuid, s.email, null::text, null::boolean, 'AUTH USER NOT FOUND'
from settings s
where not exists (select 1 from target_user);

-- Expect one row with the selected role and active = true.
-- If result is AUTH USER NOT FOUND, check the email in Authentication -> Users.
