-- Recruiter outreach (OR-TASK-005, ORT-035): the daily expire job, created
-- INACTIVE until /api/updates/outreach/expire is deployed. Turn it on with
--   select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'outreach-expire'), active := true);

create or replace function pg_temp.schedule_inactive(p_name text, p_schedule text, p_path text)
returns void language plpgsql as $$
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

  -- Daily at 02:30 IST (21:00 UTC).
  perform pg_temp.schedule_inactive('outreach-expire', '0 21 * * *', '/api/updates/outreach/expire');
end $$;
