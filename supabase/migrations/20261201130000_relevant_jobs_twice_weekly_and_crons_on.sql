-- Relevant jobs run twice a week, and four crons whose routes are deployed are turned on.
--
--   relevant-jobs-update            Monday and Thursday 09:00 UTC (was 0 8 2,16 * *),
--                                   an hour after the job digest's 08:00 on the 1st and 15th.
--                                   The enqueue only takes users with enough AI credits.
--   billing-daily                   /api/updates/billing
--   interviews-sync                 /api/updates/interviews/sync
--   interviews-feedback             /api/updates/interviews/feedback
--   interview-calendar-ops-worker   /api/worker/interview-calendar-ops
--
-- A job missing on another project is skipped with a notice, not created.

do $$
declare
  spec record;
  existing_job_id bigint;
begin
  for spec in
    select * from (values
      ('relevant-jobs-update', '0 9 * * 1,4'),
      ('billing-daily', null),
      ('interviews-sync', null),
      ('interviews-feedback', null),
      ('interview-calendar-ops-worker', null)
    ) as v(jobname, schedule)
  loop
    select jobid into existing_job_id from cron.job where jobname = spec.jobname;
    if existing_job_id is null then
      raise notice 'cron job % not found, skipped', spec.jobname;
      continue;
    end if;

    perform cron.alter_job(job_id := existing_job_id, schedule := spec.schedule, active := true);
  end loop;
end $$;
