-- Backfills all_jobs.job_name_search (supabase/migrations/20261022120000_job_title_search.sql)
-- one batch of 5000 rows per run:
--   npx supabase db query --linked -f scripts/backfill-job-name-search.sql
-- Run it again until `remaining` is 0. Between runs, check the database size
-- in the Supabase dashboard; autovacuum reuses the space the old row versions
-- leave behind. The long description and embedding values aren't copied by
-- the update, so each batch adds little.

with batch as (
  select id
    from public.all_jobs
   where job_name_search is null
   limit 5000
), updated as (
  update public.all_jobs as j
     set job_name_search = public.job_title_search_text(j.job_name)
    from batch
   where j.id = batch.id
  returning 1
)
select (select count(*) from updated) as updated,
       (select count(*) from public.all_jobs where job_name_search is null)
         - (select count(*) from updated) as remaining;
