-- Read access to all_jobs.job_name_search (20261022120000_job_title_search).
--
-- anon and authenticated can select only a list of all_jobs columns (job_url
-- and company_url stay hidden), so the new column needs its own grant: the job
-- search filters on it as the request's user. It holds nothing beyond the
-- public job_name.

grant select (job_name_search) on public.all_jobs to anon, authenticated;
