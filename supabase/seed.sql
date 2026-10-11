-- Seed: one contest in "setup" with the four starting categories.
-- Idempotent. Included as supabase/setup/6-starting-data.sql; used directly by the local test suite.
-- Set the real dates afterwards on /admin/contest.

insert into contests (name, start_at, end_at)
select 'Contest 1', now() + interval '7 days', now() + interval '37 days'
where not exists (select 1 from contests);

insert into categories (contest_id, name, points, reference_label, reference_hint, sort_order)
select c.id, v.name, v.points, v.label, v.hint, v.sort_order
from (select id from contests order by created_at desc limit 1) c
cross join (values
  ('New Account',              2, 'Account username',     'jane_designs',                  1),
  ('New Gig',                  1, 'Gig title',            'i will build hubspot workflows', 2),
  ('New Message',              2, 'Buyer username + date', 'buyer123 2026-10-20',          3),
  ('Converted Message / Order', 5, 'Fiverr order number', 'FO1234567890',                   4)
) as v(name, points, label, hint, sort_order)
where not exists (select 1 from categories);

-- Owner admin placeholder. admins.id must be an auth user, so create that user first
-- (Supabase dashboard -> Authentication -> Add user, with a password), then put its email here
-- and re-run this statement. Does nothing until that user exists.
insert into admins (id, email, role)
select u.id, u.email, 'owner'
from auth.users u
where lower(u.email) = lower('owner@example.com')   -- <- CHANGE to the owner's real email
on conflict (id) do nothing;
