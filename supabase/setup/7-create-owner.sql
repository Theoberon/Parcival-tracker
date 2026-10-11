-- Run AFTER you created your own login in the dashboard:
--   Authentication -> Users -> Add user -> Create new user (email + password, tick "Auto Confirm User").
--
-- Edit ONLY the email between the quotes below, then Run. Keep the single quotes.
--   right:  lower('jane@example.com')
--   wrong:  lower(jane@example.com)

insert into admins (id, email, role)
select id, email, 'owner'
from auth.users
where lower(email) = lower('PUT-YOUR-EMAIL-HERE@example.com');

-- The result below should show exactly one row with role "owner".
-- If it shows no rows, the email does not match a user: check Authentication -> Users.
select id, email, role from admins;
