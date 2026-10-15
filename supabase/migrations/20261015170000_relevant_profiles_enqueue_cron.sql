-- Schedules the weekly candidate-match refresh: the enqueue route queues a
-- relevant-profiles run for every active job matched before the newest
-- candidate change, and relevant-profiles-worker (20261015160000) runs them.
-- Mondays 03:30 UTC (09:00 IST). Each queued job makes paid rerank calls and
-- emails its company the refreshed matches.
--
-- Created inactive; turn it on after the worker is on and the route is deployed:
--   select cron.alter_job(jobid, active := true) from cron.job
--    where jobname = 'relevant-profiles-enqueue';
do $$
declare
  existing_job_id bigint;
  new_job_id bigint;
begin
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'internal_secret'
  ) then
    raise exception 'Internal secret not found in vault.';
  end if;

  select jobid into existing_job_id
    from cron.job
   where jobname = 'relevant-profiles-enqueue';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  new_job_id := cron.schedule(
    'relevant-profiles-enqueue',
    '30 3 * * 1',
    $enqueue$
      select net.http_get(
        url := 'https://gethired.devhub.co.in/api/updates/company/relevant-profiles/enqueue',
        headers := jsonb_build_object(
          'X-Internal-Secret',
          (select decrypted_secret from vault.decrypted_secrets where name = 'internal_secret')
        ),
        timeout_milliseconds := 60000
      );
    $enqueue$
  );

  perform cron.alter_job(job_id := new_job_id, active := false);
end;
$$;
