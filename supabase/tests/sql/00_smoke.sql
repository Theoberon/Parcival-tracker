begin;
do $$ begin
  perform t.eq((select count(*) from public.categories)::int, 4, 'seed: 4 categories');
  perform t.eq((select count(*) from public.contests)::int, 1, 'seed: 1 contest');
  perform t.eq(public.contest_effective_status(t.cid())::text, 'setup', 'seed contest is in setup');
end $$;
rollback;
