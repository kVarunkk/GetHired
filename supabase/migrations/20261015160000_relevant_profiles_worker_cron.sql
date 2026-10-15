-- Schedules the relevant-profiles worker. triggerJobPostingRelevanceUpdate now
-- queues a message on relevance_profiles instead of matching inside the
-- request (the way relevant jobs work), so a recruiter's "find candidates"
-- waits for this worker. Every minute keeps that wait short; the worker's
-- 300-second visibility timeout stops a slow run from being picked up twice.
--
-- Created inactive until the worker change is deployed; turn it on with
--   select cron.alter_job(jobid, active := true) from cron.job
--    where jobname = 'relevant-profiles-worker';
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
   where jobname = 'relevant-profiles-worker';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  new_job_id := cron.schedule(
    'relevant-profiles-worker',
    '* * * * *',
    $worker$
      select net.http_get(
        url := 'https://gethired.devhub.co.in/api/updates/company/relevant-profiles/worker',
        headers := jsonb_build_object(
          'X-Internal-Secret',
          (select decrypted_secret from vault.decrypted_secrets where name = 'internal_secret')
        ),
        timeout_milliseconds := 300000
      );
    $worker$
  );

  perform cron.alter_job(job_id := new_job_id, active := false);
end;
$$;
