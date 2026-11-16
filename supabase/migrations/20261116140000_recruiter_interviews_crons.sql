-- Recruiter interviews (IVT-091): the three scheduled jobs, created INACTIVE until the
-- interview routes are deployed. Turn them on with
--   select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'interviews-sync'), active := true);
--   select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'interviews-feedback'), active := true);
--   select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'interview-calendar-ops-worker'), active := true);
--
-- interviews-sync: completes interviews 15 min after they end, follows Google Calendar
--   changes, expires self-scheduling links.
-- interviews-feedback: sends the scorecard feedback emails.
-- interview-calendar-ops-worker: runs the queued Google event changes (create/update/cancel)
--   and revokes the grants of members who left.
-- The 15-minute jobs sit off the :00/:05 marks (see the stagger migration).

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
          timeout_milliseconds := 60000
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

  perform pg_temp.schedule_inactive('interviews-sync', '8-59/15 * * * *', '/api/updates/interviews/sync');
  perform pg_temp.schedule_inactive('interviews-feedback', '11-59/15 * * * *', '/api/updates/interviews/feedback');
  perform pg_temp.schedule_inactive('interview-calendar-ops-worker', '* * * * *', '/api/worker/interview-calendar-ops');
end $$;
