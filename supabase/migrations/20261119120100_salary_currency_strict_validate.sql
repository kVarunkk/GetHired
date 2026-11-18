-- Checks existing rows against the constraints 20261119120000 added NOT VALID.
-- On its own so this scan takes only SHARE UPDATE EXCLUSIVE: inserts and
-- updates keep running while it reads all_jobs.
-- Push together with (right after) 20261119120000, after the deploy.

alter table public.user_info validate constraint user_info_salary_currency_iso;
alter table public.job_postings validate constraint job_postings_salary_currency_iso;
alter table public.all_jobs validate constraint all_jobs_salary_currency_iso;
