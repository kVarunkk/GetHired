-- Read access to all_jobs.listed (20261125140000_job_link_only).
--
-- anon and authenticated can select only a list of all_jobs columns (job_url
-- and company_url stay hidden), so a new column needs its own grant, like
-- salary_currency (20261119130000_salary_currency_grant). Without it, every
-- applicant listing that filters on listed fails with "permission denied for
-- table all_jobs". It is false only for a link-only job.

grant select (listed) on public.all_jobs to anon, authenticated;
