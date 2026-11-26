-- Job states, phase 2: auto-close (plan/job-states/feature-job-states-tasks.md,
-- JLT-041 and JLT-045; spec JL-REQ-015, JL-REQ-017, D8).
--
--  1. close_due_job_posts(): closes every open or paused job whose closing
--     date is before today in its company's time zone (company_today), with
--     close_reason 'deadline', a null actor and an event row. Service role only;
--     /api/updates/jobs/auto-close calls it and runs the side effects.
--  2. claim_closing_soon_job_posts(p_days): the jobs whose closing date is
--     within p_days, marked reminded in the same statement so each is
--     returned once.
--  3. A moved closing date gets its own reminder: a trigger clears
--     closes_reminder_sent_at whenever closes_at changes.

-- ===========================================================================
-- 1. close_due_job_posts (JL-REQ-015)
-- ===========================================================================
-- Runs as its owner, so derive_job_post_status sets status, closed_at and
-- state_changed_at as for any move, and the guard lets it through. Rows locked
-- by a move in flight are skipped and closed on the next run. System moves
-- aren't written to company_audit_log (JL-REQ-004: manual moves only).

create or replace function public.close_due_job_posts()
returns table (job_post_id uuid, job_id uuid, company_id uuid, title text, closes_at date)
language plpgsql security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select jp.id, jp.state as from_state
      from public.job_postings jp
     where jp.state in ('open', 'paused')
       and jp.closes_at is not null
       and jp.closes_at < public.company_today(jp.company_id)
     for update of jp skip locked
  ),
  closed as (
    update public.job_postings jp
       set state = 'closed', close_reason = 'deadline'
      from due
     where jp.id = due.id
    returning jp.id, jp.job_id, jp.company_id, jp.title, jp.closes_at, jp.status, due.from_state
  ),
  synced as (
    update public.all_jobs aj
       set status = c.status
      from closed c
     where aj.id = c.job_id and aj.status is distinct from c.status
    returning aj.id
  ),
  events as (
    insert into public.job_post_state_events
      (job_post_id, company_id, from_state, to_state, reason, note, actor_user_id, created_at)
    select c.id, c.company_id, c.from_state, 'closed', 'deadline', null, null, clock_timestamp()
      from closed c
    returning id
  )
  select c.id, c.job_id, c.company_id, c.title, c.closes_at from closed c;
end $$;

revoke all on function public.close_due_job_posts() from public, anon, authenticated;
grant execute on function public.close_due_job_posts() to service_role;

-- ===========================================================================
-- 2. claim_closing_soon_job_posts (JL-REQ-017)
-- ===========================================================================
-- Open or paused jobs closing between today and today + p_days (in the
-- company's time zone) that haven't been reminded. A paused job past its date
-- is never returned: close_due_job_posts closes it instead.

create or replace function public.claim_closing_soon_job_posts(p_days integer default 3)
returns table (job_post_id uuid, company_id uuid, title text, closes_at date)
language plpgsql security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select jp.id
      from public.job_postings jp
     where jp.state in ('open', 'paused')
       and jp.closes_at is not null
       and jp.closes_reminder_sent_at is null
       and jp.closes_at >= public.company_today(jp.company_id)
       and jp.closes_at <= public.company_today(jp.company_id) + greatest(coalesce(p_days, 3), 0)
     for update of jp skip locked
  )
  update public.job_postings jp
     set closes_reminder_sent_at = now()
    from due
   where jp.id = due.id
  returning jp.id, jp.company_id, jp.title, jp.closes_at;
end $$;

revoke all on function public.claim_closing_soon_job_posts(integer) from public, anon, authenticated;
grant execute on function public.claim_closing_soon_job_posts(integer) to service_role;

-- ===========================================================================
-- 3. A moved date gets a new reminder (JL-REQ-017)
-- ===========================================================================

create or replace function public.reset_job_closing_reminder()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.closes_at is distinct from old.closes_at then
    new.closes_reminder_sent_at := null;
  end if;
  return new;
end $$;

revoke all on function public.reset_job_closing_reminder() from public, anon, authenticated;

drop trigger if exists reset_job_closing_reminder on public.job_postings;
create trigger reset_job_closing_reminder
  before update of closes_at on public.job_postings
  for each row execute function public.reset_job_closing_reminder();

-- ===========================================================================
-- 4. The hourly cron (spec §6, JLT-044)
-- ===========================================================================
-- Created inactive, like the other new crons: run the route once by hand,
-- then `select cron.alter_job(job_id := <id>, active := true)`.
-- At :05 every hour, so a job closes within the first hour of the next day
-- in its company's time zone (zones with :30 and :45 offsets included).

do $$
declare
  existing_job_id bigint;
  new_job_id bigint;
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'internal_secret') then
    raise exception 'Internal secret not found in vault.';
  end if;

  select jobid into existing_job_id from cron.job where jobname = 'jobs-auto-close';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  new_job_id := cron.schedule(
    'jobs-auto-close',
    '5 * * * *',
    $cmd$
      select net.http_get(
        url := 'https://gethired.devhub.co.in/api/updates/jobs/auto-close',
        headers := jsonb_build_object(
          'X-Internal-Secret',
          (select decrypted_secret from vault.decrypted_secrets where name = 'internal_secret')
        ),
        timeout_milliseconds := 120000
      );
    $cmd$
  );
  perform cron.alter_job(job_id := new_job_id, active := false);
end $$;
