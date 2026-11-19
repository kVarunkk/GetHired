-- Read access to all_jobs.salary_currency (20261118170000_salary_currency_codes).
--
-- anon and authenticated can select only a list of all_jobs columns (job_url
-- and company_url stay hidden), so a new column needs its own grant, like
-- job_name_search (20261022130000_job_name_search_grant). Without it, any
-- request-user read that selects or filters on salary_currency fails with
-- "permission denied for table all_jobs". It holds only an ISO 4217 code.

grant select (salary_currency) on public.all_jobs to anon, authenticated;
