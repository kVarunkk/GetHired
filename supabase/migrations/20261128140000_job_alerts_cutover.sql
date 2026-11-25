-- Job alerts, migration B (plan/job-alerts, JA-REQ-063 step 3, JA-DEC-008).
--
-- PUSH ONLY AFTER the job-alerts deploy is live (`supabase migration list` first). Until then the
-- old UI still creates alert-off bookmarks, and the old route is still the one the cron calls.
--
-- 1. Saved searches that never had an alert are gone from the product: delete them. The
--    backfill (scripts/backfill-job-alerts.ts) then fills `filters` for what is left.
-- 2. The cron: `weekly-bookmark-alert` (Mondays 00:00) becomes `job-alerts`, daily at 03:30 UTC.
--    The route sends weekly alerts only on Mondays. Same URL, same Vault secret, same 60 s
--    timeout as the other jobs (see 20261116130000).

delete from public.bookmarks where is_alert_on = false;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'internal_secret') then
    raise exception 'Internal secret not found in vault.';
  end if;

  perform cron.unschedule(jobid) from cron.job where jobname = 'weekly-bookmark-alert';

  if exists (select 1 from cron.job where jobname = 'job-alerts') then
    perform cron.unschedule('job-alerts');
  end if;

  perform cron.schedule(
    'job-alerts',
    '30 3 * * *',
    $cmd$
      select net.http_get(
        url := 'https://gethired.devhub.co.in/api/updates/applicants/job-alert',
        headers := jsonb_build_object(
          'X-Internal-Secret',
          (select decrypted_secret from vault.decrypted_secrets where name = 'internal_secret')
        ),
        timeout_milliseconds := 60000
      );
    $cmd$
  );
end $$;
