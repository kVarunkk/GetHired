-- Cron jobs for the two worker routes nothing called (plan/unscheduled-routes-todo.md).
-- Neither was ever in a migration, and there is no external scheduler.
--
-- 1. knockouts-worker: /api/updates/knockouts/worker, every 5 minutes. Sends the
--    24-hour-delayed rejection email for knockout rejects (AF-DEC-002).
-- 2. billing-daily: /api/updates/billing, daily at 03:00 UTC (billing spec §4.1).
--    The route exports GET = POST, so it uses net.http_get like every other job.
--
-- Both are created inactive. Turn them on by hand, knockouts first, and check a run in
-- cron.job_run_details / net._http_response before turning on billing:
--   select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'knockouts-worker'), active := true);
--   select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'billing-daily'), active := true);
--
-- Additive only: two cron jobs, no schema change.

create or replace function pg_temp.schedule_inactive(p_name text, p_schedule text, p_path text)
returns void
language plpgsql
as $$
declare
  existing_job_id bigint;
  new_job_id bigint;
begin
  select jobid into existing_job_id from cron.job where jobname = p_name;
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  new_job_id := cron.schedule(
    p_name,
    p_schedule,
    format(
      $cmd$
        select net.http_get(
          url := %L,
          headers := jsonb_build_object(
            'X-Internal-Secret',
            (select decrypted_secret from vault.decrypted_secrets where name = 'internal_secret')
          ),
          timeout_milliseconds := 300000
        );
      $cmd$,
      'https://gethired.devhub.co.in' || p_path
    )
  );

  perform cron.alter_job(job_id := new_job_id, active := false);
end $$;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'internal_secret') then
    raise exception 'Internal secret not found in vault.';
  end if;

  perform pg_temp.schedule_inactive('knockouts-worker', '*/5 * * * *', '/api/updates/knockouts/worker');
  perform pg_temp.schedule_inactive('billing-daily', '0 3 * * *', '/api/updates/billing');
end $$;
