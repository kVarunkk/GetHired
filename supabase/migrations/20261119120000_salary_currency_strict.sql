-- Salary currencies: codes only, enforced.
--
-- !! PUSH ONLY AFTER the code from 20261118170000_salary_currency_codes.sql
-- !! (branch feat/salary-currency) is deployed. Until then the deployed app
-- !! still writes symbols (₹, $) to user_info and job_postings, and these
-- !! constraints would refuse those writes (onboarding, job posts, the agent).
--
-- 20261118170000 converted symbols to ISO 4217 codes with triggers, so the
-- old deployed code kept working while the new code shipped. Once the new
-- code is live nothing writes a symbol, so:
--   * the converting triggers on user_info / job_postings are dropped: a bad
--     value is refused with an error instead of being converted silently;
--   * CHECK constraints keep the columns to codes.
-- all_jobs keeps all_jobs_set_salary_currency: it reads the currency from
-- salary_range for writers that don't send one (scrapers), so its column is
-- always a code or null already.
--
-- If a row still holds something that isn't a code, the push fails on the
-- check below and names the count; fix those rows, then push again.

-- Anything the triggers let through (they kept unknown values as written).
update public.user_info
   set salary_currency = public.iso_currency(salary_currency)
 where public.iso_currency(salary_currency) is not null
   and salary_currency is distinct from public.iso_currency(salary_currency);

update public.job_postings
   set salary_currency = public.iso_currency(salary_currency)
 where public.iso_currency(salary_currency) is not null
   and salary_currency is distinct from public.iso_currency(salary_currency);

-- A job with no salary has no currency.
update public.job_postings set salary_currency = null where btrim(salary_currency) = '';

do $$
declare
  v_users int;
  v_jobs int;
begin
  select count(*) into v_users from public.user_info where salary_currency !~ '^[A-Z]{3}$';
  select count(*) into v_jobs from public.job_postings
   where salary_currency is not null and salary_currency !~ '^[A-Z]{3}$';
  if v_users > 0 or v_jobs > 0 then
    raise exception 'salary_currency: % user_info and % job_postings rows hold a value that isn''t an ISO 4217 code; fix them first', v_users, v_jobs;
  end if;
end $$;

drop trigger if exists user_info_normalize_salary_currency on public.user_info;
drop trigger if exists job_postings_normalize_salary_currency on public.job_postings;
drop function if exists public.normalize_salary_currency();

-- Added NOT VALID: new writes are checked from here, and existing rows are
-- checked by 20261119120100_salary_currency_strict_validate.sql, in its own
-- transaction, so the scan doesn't hold this file's lock on all_jobs (large,
-- written to constantly).
alter table public.user_info
  add constraint user_info_salary_currency_iso check (salary_currency ~ '^[A-Z]{3}$') not valid;
alter table public.job_postings
  add constraint job_postings_salary_currency_iso
  check (salary_currency is null or salary_currency ~ '^[A-Z]{3}$') not valid;
alter table public.all_jobs
  add constraint all_jobs_salary_currency_iso
  check (salary_currency is null or salary_currency ~ '^[A-Z]{3}$') not valid;
