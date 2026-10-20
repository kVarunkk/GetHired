-- Recruiter pipeline, part 4 (PLT-072, PL-TASK-040/041): notifications.
--
-- 1. Queues: company_notification_queue (instant new-applicant emails),
--    applicant_digest_queue (the daily digest) and weekly_matches_queue.
-- 2. job_postings.last_applicant_notified_at, the instant emails' 15-minute
--    per-job throttle (written by the worker).
-- 3. applications_notify_company: its own trigger, so
--    enqueue_application_screening and its tests stay unchanged (difference 7).
-- 4. The cron jobs, created inactive until the routes are deployed
--    (difference 9). Turn one on with
--      select cron.alter_job(jobid, active := true) from cron.job where jobname = '<name>';

-- ---------------------------------------------------------------------------
-- 1. Queues
-- ---------------------------------------------------------------------------

do $$
declare
  q text;
begin
  foreach q in array array['company_notification_queue', 'applicant_digest_queue', 'weekly_matches_queue'] loop
    if not exists (select 1 from pgmq.list_queues() where queue_name = q) then
      perform pgmq.create(q);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Throttle
-- ---------------------------------------------------------------------------

alter table public.job_postings
  add column if not exists last_applicant_notified_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3. Instant notifications (PL-REQ-009). Never blocks an application.
-- ---------------------------------------------------------------------------

create or replace function public.notify_company_of_application()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
  v_setting text;
begin
  if new.job_post_id is null then return new; end if;

  begin
    select jp.company_id, ci.notify_new_applicants into v_company, v_setting
      from public.job_postings jp
      join public.company_info ci on ci.id = jp.company_id
     where jp.id = new.job_post_id;

    if v_setting = 'instant' then
      perform pgmq.send('company_notification_queue', jsonb_build_object(
        'type', 'new_applicant',
        'applicationId', new.id,
        'jobPostId', new.job_post_id
      ));
    end if;
  exception when others then
    raise warning 'notify_company_of_application(%): %', new.id, sqlerrm;
  end;

  return new;
end $$;

revoke all on function public.notify_company_of_application() from public, anon, authenticated;

drop trigger if exists applications_notify_company on public.applications;
create trigger applications_notify_company
  after insert on public.applications
  for each row execute function public.notify_company_of_application();

-- ---------------------------------------------------------------------------
-- 4. Cron jobs, all inactive
-- ---------------------------------------------------------------------------

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

  -- Instant emails: every minute.
  perform pg_temp.schedule_inactive('company-notifications-worker', '* * * * *',
    '/api/worker/company-notifications');
  -- The daily digest at 09:00 IST (03:30 UTC), sent by the worker every 5 minutes.
  perform pg_temp.schedule_inactive('applicant-digest-enqueue', '30 3 * * *',
    '/api/updates/company/applicant-digest/enqueue');
  perform pg_temp.schedule_inactive('applicant-digest-worker', '*/5 * * * *',
    '/api/updates/company/applicant-digest/worker');
  -- Weekly matches on Monday at 09:00 IST.
  perform pg_temp.schedule_inactive('weekly-matches-enqueue', '30 3 * * 1',
    '/api/updates/company/weekly-matches/enqueue');
  perform pg_temp.schedule_inactive('weekly-matches-worker', '*/5 * * * *',
    '/api/updates/company/weekly-matches/worker');
end $$;
