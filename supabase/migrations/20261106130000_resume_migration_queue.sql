-- The resume file migration (plan/resume-editor/feature-resume-editor-spec.md §10).
--
-- 1. resume_reparse_queue: one message per resume_migration_items row.
-- 2. Two inactive cron jobs, turned on by hand in RET-113 and RET-115:
--      select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'resume-reparse-worker'), active := true);
--      select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'resume-delete-files'), active := true);
--
-- Additive only (RE-REQ-090): a new queue and new cron jobs. It changes no
-- column, policy or trigger, so the deployed code can't tell.

do $$
begin
  if not exists (select 1 from pgmq.list_queues() where queue_name = 'resume_reparse_queue') then
    perform pgmq.create('resume_reparse_queue');
  end if;
end $$;

revoke all on pgmq.q_resume_reparse_queue, pgmq.a_resume_reparse_queue from public, anon, authenticated;

-- A file whose resume went away is still swept and its row kept for the
-- deletion run, so nothing about the queue holds a foreign key.
alter table public.resume_migration_items
  add column if not exists queued_at timestamptz;

comment on column public.resume_migration_items.queued_at is
  'When the item was sent to resume_reparse_queue, so a re-run does not send it twice (RE-REQ-091).';

create index if not exists resume_migration_items_file_deletion_idx
  on public.resume_migration_items (status, notified_at)
  where file_deleted_at is null;

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

  perform pg_temp.schedule_inactive('resume-reparse-worker', '* * * * *', '/api/worker/resume-reparse');
  perform pg_temp.schedule_inactive('resume-delete-files', '17 * * * *', '/api/updates/resumes/delete-files');
end $$;
