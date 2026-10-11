-- Run ONCE in the Supabase SQL editor (not a migration: it contains project-specific values).
-- Calls the cleanup-drafts Edge Function every 15 minutes. It deletes drafts older than 60 minutes
-- and their files. Needs the pg_cron and pg_net extensions (Dashboard -> Database -> Extensions).
--
-- 1. Store the service-role key in Vault so it never appears in SQL history:
--      select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
-- 2. Replace <PROJECT_REF> below, then run the rest.

select cron.schedule(
  'cleanup-drafts',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/cleanup-drafts',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Check it later:  select * from cron.job_run_details order by start_time desc limit 5;
-- Remove it:       select cron.unschedule('cleanup-drafts');
