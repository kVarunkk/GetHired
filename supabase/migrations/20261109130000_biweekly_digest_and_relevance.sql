-- Turn on the applicant job digest and relevant-jobs crons, with both enqueues every two weeks.
--
-- The four jobs already exist on the live project (created outside the migrations) and were
-- inactive. This sets their schedules and turns them on. pg_cron has no "every 14 days", so the
-- enqueues run on the 1st and 15th of each month, a day apart so they don't overlap:
--   weekly-job-digest-test   /api/updates/applicants/digest/enqueue          0 8 1,15 * *  (was 0 0 */3 * *)
--   relevant-jobs-update     /api/updates/applicants/relevant-jobs/enqueue   0 8 2,16 * *  (was 0 0 */7 * *)
--   job-digest-worker        /api/updates/applicants/digest/worker           */5 (unchanged)
--   relevance-worker         /api/updates/applicants/relevant-jobs/worker    */5 (unchanged)
--
-- The digest's job window (helpers/jobs/digest-utils.tsx) moves from 3 to 14 days to match.
-- A job missing on another project is skipped with a notice, not created.

do $$
declare
  spec record;
  existing_job_id bigint;
begin
  for spec in
    select * from (values
      ('weekly-job-digest-test', '0 8 1,15 * *'),
      ('relevant-jobs-update', '0 8 2,16 * *'),
      ('job-digest-worker', null),
      ('relevance-worker', null)
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
