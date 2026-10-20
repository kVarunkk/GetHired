-- Recruiter matching, part 3 (MTT-051, MT-TASK-020): applicant screening.
-- §3.2 (the table, with skipped_quota and previous_result) and §3.4 (the
-- queue and the enqueue trigger). §3.3 is superseded by the billing spec.

-- 3.2 Applicant screening
do $$
begin
  if not exists (select 1 from pg_type where typname = 'screening_recommendation') then
    create type public.screening_recommendation as enum ('strong_yes','yes','maybe','no');
  end if;
end $$;

create table if not exists public.application_screenings (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.applications(id) on delete cascade,
  job_post_id uuid not null references public.job_postings(id) on delete cascade,
  company_id uuid not null references public.company_info(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued','processing','completed','failed','stale','skipped_quota')),
  fit_score smallint check (fit_score between 0 and 100),
  recommendation public.screening_recommendation,
  result jsonb,                       -- full MT-REQ-006 object
  previous_result jsonb,              -- the result before the last re-screen (MT-RISK-003)
  job_snapshot_hash text,             -- jobSnapshotHash() at screening time (MT-REQ-008)
  error_code text,                    -- safe code only (MT-SEC-005)
  attempts smallint not null default 0,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists application_screenings_job_fit_idx
  on public.application_screenings (job_post_id, fit_score desc);
create index if not exists application_screenings_company_created_idx
  on public.application_screenings (company_id, created_at desc);

alter table public.application_screenings enable row level security;

-- Company members only. Applicants never see their screening (MT-REQ-009),
-- and there are no insert/update/delete policies: writes go through the
-- service-role worker and routes (MT-SEC-004).
drop policy if exists "screenings_select_company" on public.application_screenings;
create policy "screenings_select_company" on public.application_screenings
  for select to authenticated using (public.is_company_member(company_id));

-- 3.4 Queue + enqueue trigger
do $$
begin
  if not exists (select 1 from pgmq.list_queues() where queue_name = 'application_screening_queue') then
    perform pgmq.create('application_screening_queue');
  end if;
end $$;

-- Applications are inserted from the browser, so the trigger is the only
-- server-side hook. It must never block an application: on any error it
-- warns and returns, and the job page's "Screen unscreened" picks it up.
create or replace function public.enqueue_application_screening()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  if new.job_post_id is null then return new; end if;

  begin
    select company_id into v_company from public.job_postings where id = new.job_post_id;
    if v_company is null then return new; end if;

    insert into public.application_screenings (application_id, job_post_id, company_id)
      values (new.id, new.job_post_id, v_company)
      on conflict (application_id) do nothing;
    if found then
      perform pgmq.send('application_screening_queue', jsonb_build_object('application_id', new.id));
    end if;
  exception when others then
    raise warning 'enqueue_application_screening(%): %', new.id, sqlerrm;
  end;

  return new;
end $$;

revoke all on function public.enqueue_application_screening() from public, anon, authenticated;

drop trigger if exists applications_enqueue_screening on public.applications;
create trigger applications_enqueue_screening
  after insert on public.applications
  for each row execute function public.enqueue_application_screening();

-- The worker schedule (MT-DEP-003: every minute). Created inactive until the
-- worker is deployed; turn it on with
--   select cron.alter_job(jobid, active := true) from cron.job
--    where jobname = 'application-screening-worker';
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
   where jobname = 'application-screening-worker';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  new_job_id := cron.schedule(
    'application-screening-worker',
    '* * * * *',
    $worker$
      select net.http_get(
        url := 'https://gethired.devhub.co.in/api/worker/application-screening',
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
