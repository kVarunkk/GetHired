-- Index channel pings (plan/multiposting, MPT-014): job activate/close/edit
-- queues a message and /api/worker/index-pings tells IndexNow and the Google
-- Indexing API, never in the request.
-- The cron job is created INACTIVE until the route is deployed. Turn it on with
--   select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'index-pings-worker'), active := true);

do $$
begin
  if not exists (select 1 from pgmq.list_queues() where queue_name = 'index_ping_queue') then
    perform pgmq.create('index_ping_queue');
  end if;
end $$;

do $$
declare
  existing_job_id bigint;
  new_job_id bigint;
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'internal_secret') then
    raise exception 'Internal secret not found in vault.';
  end if;

  select jobid into existing_job_id from cron.job where jobname = 'index-pings-worker';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  new_job_id := cron.schedule(
    'index-pings-worker',
    '2-59/5 * * * *',
    $cmd$
      select net.http_get(
        url := 'https://gethired.devhub.co.in/api/worker/index-pings',
        headers := jsonb_build_object(
          'X-Internal-Secret',
          (select decrypted_secret from vault.decrypted_secrets where name = 'internal_secret')
        ),
        timeout_milliseconds := 300000
      );
    $cmd$
  );
  perform cron.alter_job(job_id := new_job_id, active := false);
end $$;
