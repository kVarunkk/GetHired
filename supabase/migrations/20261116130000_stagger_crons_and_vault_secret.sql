-- Spread the 5-minute cron workers across the five minutes, and move the old cron jobs'
-- hardcoded secret to Vault.
--
-- Why: the statement timeouts on Nov 4 20:10, Nov 14 09:10/09:15 and Nov 16 05:25 UTC all came
-- right after a 5-minute mark. At each mark about 12 `*/5` jobs fired in the same few
-- milliseconds, so the Cloud Run workers they call (relevance vector searches, job embedding
-- writes, weekly matches, screening...) all hit the database at once. On this small instance
-- that stalls every query for 10-20 seconds, including the public jobs list.
--
-- 1. Stagger. Each `*/5` worker gets a minute offset, the vector-heavy ones in separate minutes:
--      :0  relevance-worker (vector)            knockouts-worker
--      :1  process-job-embedding-queue (HNSW)   pipeline-emails-worker
--      :2  weekly-matches-worker (vector)       screening-invite-emails-worker
--      :3  application-screening-worker         job-digest-worker
--      :4  match-explanations-worker            interview-analysis-worker   applicant-digest-worker
--    onboarding-pipeline-worker moves from */3 to 1-59/3 and screening-interviews from */15 to
--    7-59/15, so neither lands on :00. The Monday 03:30 enqueues are spread to 03:30/03:33/03:36.
--    The every-minute workers stay as they are.
--
-- 2. Vault. Eleven jobs created by hand before the Vault secret existed carry X-Internal-Secret
--    as a literal (readable by anyone who can read cron.job), plus a leftover
--    x-vercel-protection-bypass header. Their commands are rebuilt to read 'internal_secret'
--    from Vault like every newer job. URL, method, timeout and active flag are unchanged.
--    Both secrets are the same value today (every cron call returns 200), so nothing breaks.
--    After this is applied, rotate the secret: Vault 'internal_secret' and INTERNAL_API_SECRET
--    on Cloud Run together.
--
-- Only cron.job rows change; no schema change. A job missing on another project is skipped
-- with a notice.

create or replace function pg_temp.alter_cron(p_name text, p_schedule text)
returns void
language plpgsql
as $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id from cron.job where jobname = p_name;
  if existing_job_id is null then
    raise notice 'cron job % not found, skipped', p_name;
    return;
  end if;
  perform cron.alter_job(job_id := existing_job_id, schedule := p_schedule);
end $$;

-- Rebuilds a job's command to GET p_path with the Vault secret. A null p_schedule keeps the
-- schedule. The active flag is untouched.
create or replace function pg_temp.vault_cron(p_name text, p_path text, p_schedule text)
returns void
language plpgsql
as $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id from cron.job where jobname = p_name;
  if existing_job_id is null then
    raise notice 'cron job % not found, skipped', p_name;
    return;
  end if;

  perform cron.alter_job(
    job_id := existing_job_id,
    schedule := p_schedule,
    command := format(
      $cmd$
        select net.http_get(
          url := %L,
          headers := jsonb_build_object(
            'X-Internal-Secret',
            (select decrypted_secret from vault.decrypted_secrets where name = 'internal_secret')
          ),
          timeout_milliseconds := 60000
        );
      $cmd$,
      'https://gethired.devhub.co.in' || p_path
    )
  );
end $$;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'internal_secret') then
    raise exception 'Internal secret not found in vault.';
  end if;

  -- Hardcoded secret -> Vault (schedule changes only for the two 5-minute workers and onboarding).
  perform pg_temp.vault_cron('relevance-worker', '/api/updates/applicants/relevant-jobs/worker', '0-59/5 * * * *');
  perform pg_temp.vault_cron('job-digest-worker', '/api/updates/applicants/digest/worker', '3-59/5 * * * *');
  perform pg_temp.vault_cron('onboarding-pipeline-worker', '/api/worker/user/onboarding', '1-59/3 * * * *');
  perform pg_temp.vault_cron('weekly-job-digest-test', '/api/updates/applicants/digest/enqueue', null);
  perform pg_temp.vault_cron('relevant-jobs-update', '/api/updates/applicants/relevant-jobs/enqueue', null);
  perform pg_temp.vault_cron('weekly-applications-reminder', '/api/updates/applicants/applications', null);
  perform pg_temp.vault_cron('weekly-favorites-reminder', '/api/updates/applicants/favorites', null);
  perform pg_temp.vault_cron('weekly-bookmark-alert', '/api/updates/applicants/job-alert', null);
  perform pg_temp.vault_cron('weekly-onboarding-reminder', '/api/updates/applicants/onboarding', null); -- inactive
  perform pg_temp.vault_cron('recharge enqueue', '/api/updates/applicants/recharge/enqueue', null);      -- inactive
  perform pg_temp.vault_cron('recharge worker', '/api/updates/applicants/recharge/worker', null);        -- inactive

  -- Stagger the 5-minute workers that already use Vault.
  perform pg_temp.alter_cron('knockouts-worker', '0-59/5 * * * *');
  perform pg_temp.alter_cron('process-job-embedding-queue', '1-59/5 * * * *');
  perform pg_temp.alter_cron('pipeline-emails-worker', '1-59/5 * * * *');
  perform pg_temp.alter_cron('weekly-matches-worker', '2-59/5 * * * *');
  perform pg_temp.alter_cron('screening-invite-emails-worker', '2-59/5 * * * *');
  perform pg_temp.alter_cron('application-screening-worker', '3-59/5 * * * *');
  perform pg_temp.alter_cron('match-explanations-worker', '4-59/5 * * * *');
  perform pg_temp.alter_cron('interview-analysis-worker', '4-59/5 * * * *');
  perform pg_temp.alter_cron('applicant-digest-worker', '4-59/5 * * * *');
  perform pg_temp.alter_cron('screening-interviews', '7-59/15 * * * *');

  -- Monday 03:30 had four enqueues at once.
  perform pg_temp.alter_cron('relevant-profiles-enqueue', '33 3 * * 1');
  perform pg_temp.alter_cron('weekly-matches-enqueue', '36 3 * * 1');
end $$;
