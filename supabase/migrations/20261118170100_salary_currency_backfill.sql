-- Fills all_jobs.salary_currency for existing jobs (the column and its trigger
-- are in 20261118170000_salary_currency_codes.sql).
--
-- On its own so 20261118170000's ALTER TABLE commits at once: here the
-- updates take only row locks, so new jobs keep coming in while it runs. At
-- ~15k jobs it's a few seconds.
--
-- The index is a plain CREATE INDEX (migrations run in a transaction), so it
-- blocks writes to all_jobs while it builds, about a second at this size. To
-- avoid even that, run this first outside a transaction, and it's a no-op:
--   create index concurrently if not exists idx_all_jobs_salary_currency_min
--     on public.all_jobs (salary_currency, salary_min) where status = 'active';

-- GetHired jobs: the posting's currency.
update public.all_jobs aj
   set salary_currency = public.iso_currency(jp.salary_currency)
  from public.job_postings jp
 where jp.job_id = aj.id
   and public.iso_currency(jp.salary_currency) is not null
   and aj.salary_currency is distinct from public.iso_currency(jp.salary_currency);

-- Other sources: read from the text.
update public.all_jobs
   set salary_currency = public.salary_text_currency(salary_range)
 where salary_currency is null
   and salary_range is not null
   and public.salary_text_currency(salary_range) is not null;

create index if not exists idx_all_jobs_salary_currency_min
  on public.all_jobs (salary_currency, salary_min)
  where status = 'active';
