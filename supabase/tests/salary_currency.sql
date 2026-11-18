-- Salary currencies (20261118170000_salary_currency_codes.sql and
-- 20261119120000_salary_currency_strict.sql): iso_currency,
-- salary_text_currency, the trigger that sets all_jobs.salary_currency, and
-- the checks that keep user_info / job_postings to codes. Runs in a transaction that
-- always rolls back, so it's safe against the linked project once the
-- migration is applied:
--   npx supabase db query --linked -f supabase/tests/salary_currency.sql
-- Any failed check raises an exception; success prints 'salary_currency: ok'.

begin;

create function pg_temp.eq(p_actual text, p_expected text, p_label text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception '%: expected %, got %', p_label, coalesce(p_expected, 'null'), coalesce(p_actual, 'null');
  end if;
end $$;

-- iso_currency: the old symbols and any code (mirrors toIsoCurrency).
select pg_temp.eq(public.iso_currency('₹'), 'INR', 'rupee symbol');
select pg_temp.eq(public.iso_currency('$'), 'USD', 'dollar symbol');
select pg_temp.eq(public.iso_currency('C$'), 'CAD', 'canadian dollar');
select pg_temp.eq(public.iso_currency('A$'), 'AUD', 'australian dollar');
select pg_temp.eq(public.iso_currency('€'), 'EUR', 'euro symbol');
select pg_temp.eq(public.iso_currency('£'), 'GBP', 'pound symbol');
select pg_temp.eq(public.iso_currency(' aed '), 'AED', 'lower-case code');
select pg_temp.eq(public.iso_currency('rupees'), null, 'a word');
select pg_temp.eq(public.iso_currency(null), null, 'null');

-- salary_text_currency: free-text salaries from any source.
select pg_temp.eq(public.salary_text_currency('₹10L - ₹15L'), 'INR', 'rupee text');
select pg_temp.eq(public.salary_text_currency('12-18 LPA'), 'INR', 'LPA');
select pg_temp.eq(public.salary_text_currency('1500000 - 2000000 INR'), 'INR', 'GetHired text');
select pg_temp.eq(public.salary_text_currency('$120k – $150k'), 'USD', 'dollars');
select pg_temp.eq(public.salary_text_currency('US$90,000'), 'USD', 'US dollars before S$');
select pg_temp.eq(public.salary_text_currency('CA$100k'), 'CAD', 'canadian dollars');
select pg_temp.eq(public.salary_text_currency('A$120,000'), 'AUD', 'australian dollars');
select pg_temp.eq(public.salary_text_currency('S$8,000 / month'), 'SGD', 'singapore dollars');
select pg_temp.eq(public.salary_text_currency('€50,000'), 'EUR', 'euros');
select pg_temp.eq(public.salary_text_currency('£45k'), 'GBP', 'pounds');
select pg_temp.eq(public.salary_text_currency('AED 25,000 per month'), 'AED', 'dirhams');
select pg_temp.eq(public.salary_text_currency('10 years of experience'), null, 'no currency');
select pg_temp.eq(public.salary_text_currency('Not specified'), null, 'not specified');

-- all_jobs: read from the text, an explicit currency wins, and an unrelated
-- update keeps it.
insert into public.all_jobs (id, job_name, salary_range, salary_min, status) values
  ('5c000000-0000-4000-8000-000000000001', 'Scraped', '₹10L - ₹15L', 1000000, 'inactive'),
  ('5c000000-0000-4000-8000-000000000002', 'Platform', '100 - 200 USD', 100, 'inactive');
update public.all_jobs set salary_currency = 'EUR' where id = '5c000000-0000-4000-8000-000000000002';

select pg_temp.eq((select salary_currency from public.all_jobs where id = '5c000000-0000-4000-8000-000000000001'), 'INR', 'all_jobs from text');
select pg_temp.eq((select salary_currency from public.all_jobs where id = '5c000000-0000-4000-8000-000000000002'), 'EUR', 'all_jobs explicit');

update public.all_jobs set salary_range = '$100k' where id = '5c000000-0000-4000-8000-000000000001';
select pg_temp.eq((select salary_currency from public.all_jobs where id = '5c000000-0000-4000-8000-000000000001'), 'USD', 'all_jobs text changed');

update public.all_jobs set job_name = 'Renamed' where id = '5c000000-0000-4000-8000-000000000002';
select pg_temp.eq((select salary_currency from public.all_jobs where id = '5c000000-0000-4000-8000-000000000002'), 'EUR', 'all_jobs unrelated update');

-- user_info / job_postings (20261119120000_salary_currency_strict): codes
-- only. A symbol is refused, not converted.
create function pg_temp.refused(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when check_violation then
    return;
  end;
  raise exception '%: expected a check violation', p_label;
end $$;

insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data) values
  ('5c000000-0000-4000-8000-0000000000aa', 'a@currency.test', 'authenticated', 'authenticated', now(), '{}');
insert into public.user_info (user_id, email, salary_currency)
values ('5c000000-0000-4000-8000-0000000000aa', 'a@currency.test', 'INR')
on conflict (user_id) do update set salary_currency = excluded.salary_currency;
select pg_temp.eq((select salary_currency from public.user_info where user_id = '5c000000-0000-4000-8000-0000000000aa'), 'INR', 'user_info code');

select pg_temp.refused(
  $q$update public.user_info set salary_currency = '₹' where user_id = '5c000000-0000-4000-8000-0000000000aa'$q$,
  'user_info symbol');
select pg_temp.refused(
  $q$update public.user_info set salary_currency = 'inr' where user_id = '5c000000-0000-4000-8000-0000000000aa'$q$,
  'user_info lower-case');
-- all_jobs: an unknown value with no salary text is stored as no currency.
update public.all_jobs set salary_currency = 'rupees', salary_range = null where id = '5c000000-0000-4000-8000-000000000001';
select pg_temp.eq((select salary_currency from public.all_jobs where id = '5c000000-0000-4000-8000-000000000001'), null, 'all_jobs unknown value');

select 'salary_currency: ok';

rollback;
