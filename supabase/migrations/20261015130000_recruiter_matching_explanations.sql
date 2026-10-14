-- Recruiter matching, part 2 (MTT-042, MT-TASK-012): the background
-- explanation queue and its worker schedule (MT-DEP-003: every 5 minutes).

select pgmq.create('match_explanation_queue');

do $$
declare
  existing_job_id bigint;
begin
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'internal_secret'
  ) then
    raise exception 'Internal secret not found in vault.';
  end if;

  select jobid into existing_job_id
    from cron.job
   where jobname = 'match-explanations-worker';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'match-explanations-worker',
    '*/5 * * * *',
    $worker$
      select net.http_get(
        url := 'https://gethired.devhub.co.in/api/updates/company/match-explanations/worker',
        headers := jsonb_build_object(
          'X-Internal-Secret',
          (select decrypted_secret from vault.decrypted_secrets where name = 'internal_secret')
        ),
        timeout_milliseconds := 300000
      );
    $worker$
  );
end;
$$;
