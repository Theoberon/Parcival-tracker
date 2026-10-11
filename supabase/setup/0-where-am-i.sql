-- Run this any time to see which setup parts are already done on this project. It changes nothing.
-- "true" = that part has been run. Do the first "false" part next, then the following ones in order.

select
  to_regclass('public.contests') is not null                                               as part_1_schema,
  to_regprocedure('public.approve_submission(uuid)') is not null                           as part_2_functions,
  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.submissions')), false) as part_3_security,
  to_regclass('public.login_failures') is not null                                         as part_4_login_delay,
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'members' and column_name = 'title') as part_5_titles,
  case when to_regclass('public.categories') is null then false
       else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.categories', false, true, '')))[1]::text::int > 0
  end                                                                                      as part_6_starting_data;
