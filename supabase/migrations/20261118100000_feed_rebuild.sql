-- Feed storage and rebuild queue (plan/multiposting, MPT-022/023, MP-CON-006).
-- A feed is built by /api/worker/feeds, stored as <platform>.xml in the private
-- `feeds` bucket and served from /feeds/<platform>.xml, never built per request.
-- Only the service role reads or writes the bucket: no storage policies.
-- The cron job is created INACTIVE until the route is deployed:
--   select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'feeds-worker'), active := true);

insert into storage.buckets (id, name, public, allowed_mime_types)
values ('feeds', 'feeds', false, array['application/xml', 'text/xml'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pgmq.list_queues() where queue_name = 'feed_rebuild_queue') then
    perform pgmq.create('feed_rebuild_queue');
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

  select jobid into existing_job_id from cron.job where jobname = 'feeds-worker';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  new_job_id := cron.schedule(
    'feeds-worker',
    '4-59/10 * * * *',
    $cmd$
      select net.http_get(
        url := 'https://gethired.devhub.co.in/api/worker/feeds',
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
