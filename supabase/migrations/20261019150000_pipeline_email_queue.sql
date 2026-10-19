-- Stage-move emails go through a queue: the move writes the stage and
-- enqueues one message per recipient, and /api/worker/pipeline-emails sends
-- them, so a 50-application move doesn't wait on the email provider.
--
-- 1. pipeline_email_queue.
-- 2. pipeline_emails_pending(company): messages still in the queue, so the
--    daily cap (PL-SEC-005) counts emails queued but not yet sent.
-- 3. The worker's cron job, every minute, created INACTIVE until the route is
--    deployed. Turn it on with
--      select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'pipeline-emails-worker'), active := true);

-- ---------------------------------------------------------------------------
-- 1. Queue
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pgmq.list_queues() where queue_name = 'pipeline_email_queue') then
    perform pgmq.create('pipeline_email_queue');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Pending count, for the caller's own company only
-- ---------------------------------------------------------------------------

create or replace function public.pipeline_emails_pending(p_company_id uuid)
returns integer
language sql stable security definer
set search_path = ''
as $$
  select case
    when not public.is_company_member(p_company_id) then 0
    else (
      select count(*)::integer from pgmq.q_pipeline_email_queue q
       where q.message->>'companyId' = p_company_id::text
    )
  end
$$;

revoke all on function public.pipeline_emails_pending(uuid) from public, anon;
grant execute on function public.pipeline_emails_pending(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Cron job, inactive
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

  perform pg_temp.schedule_inactive('pipeline-emails-worker', '* * * * *', '/api/worker/pipeline-emails');
end $$;
