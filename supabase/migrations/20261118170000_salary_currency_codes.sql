-- Salary currencies as ISO 4217 codes, and a currency on every listed job.
--
-- Salaries used to carry a symbol (₹, $, €, £, C$, A$) on user_info and
-- job_postings, and all_jobs had no currency at all (scraped jobs only have it
-- inside salary_range). A salary filter compared amounts across currencies, so
-- "at least 1500000" matched ₹15 lakh and $1.5M alike. From here:
--   * user_info / job_postings store a code. A trigger converts what the
--     deployed code still writes (symbols), so it keeps working.
--   * all_jobs.salary_currency is set from the posting (GetHired jobs) or read
--     from salary_range (other sources), by a trigger, so any writer gets it.
--   * Salary filters compare amounts within one currency (the app's side).
-- helpers/currency/currencies.ts (toIsoCurrency) mirrors iso_currency().

-- A stored currency value as a code: the old symbols, or any 3-letter code.
create or replace function public.iso_currency(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case lower(btrim(p_value))
    when '₹' then 'INR'
    when 'rs' then 'INR'
    when 'rs.' then 'INR'
    when '$' then 'USD'
    when 'us$' then 'USD'
    when '€' then 'EUR'
    when '£' then 'GBP'
    when 'c$' then 'CAD'
    when 'ca$' then 'CAD'
    when 'a$' then 'AUD'
    when 'au$' then 'AUD'
    when 's$' then 'SGD'
    when '¥' then 'JPY'
    else case when btrim(p_value) ~* '^[a-z]{3}$' then upper(btrim(p_value)) end
  end
$$;

-- The currency a free-text salary is in ("₹10L - 15L", "$120k", "EUR 50,000",
-- "1500000 - 2000000 INR"), or null when it doesn't say. Specific dollars
-- (US$, C$, A$, S$) are checked before a bare $.
create or replace function public.salary_text_currency(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_text is null or btrim(p_text) = '' then null
    when p_text ~ '₹' or p_text ~* '\m(inr|rs\.?|lpa|lakhs?|crores?)\M' then 'INR'
    when p_text ~* '(us\$|\musd\M)' then 'USD'
    when p_text ~* '(ca?\$|\mcad\M)' then 'CAD'
    when p_text ~* '(au?\$|\maud\M)' then 'AUD'
    when p_text ~* '(s\$|\msgd\M)' then 'SGD'
    when p_text ~ '€' or p_text ~* '\meur\M' then 'EUR'
    when p_text ~ '£' or p_text ~* '\mgbp\M' then 'GBP'
    when upper(p_text) ~ '\m(AED|BRL|CHF|CNY|CZK|DKK|EGP|HKD|IDR|ILS|JPY|KES|KRW|MXN|MYR|NGN|NOK|NPR|NZD|PHP|PKR|PLN|QAR|SAR|SEK|THB|TRY|TWD|VND|ZAR|BDT|LKR)\M'
      then substring(upper(p_text) from '\m(AED|BRL|CHF|CNY|CZK|DKK|EGP|HKD|IDR|ILS|JPY|KES|KRW|MXN|MYR|NGN|NOK|NPR|NZD|PHP|PKR|PLN|QAR|SAR|SEK|THB|TRY|TWD|VND|ZAR|BDT|LKR)\M')
    when p_text ~ '\$' then 'USD'
  end
$$;

grant execute on function public.iso_currency(text) to anon, authenticated, service_role;
grant execute on function public.salary_text_currency(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- user_info / job_postings: store codes.

create or replace function public.normalize_salary_currency()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- An unknown value is kept as written, so nothing a client sends is lost.
  new.salary_currency := coalesce(public.iso_currency(new.salary_currency), new.salary_currency);
  return new;
end;
$$;

drop trigger if exists user_info_normalize_salary_currency on public.user_info;
create trigger user_info_normalize_salary_currency
  before insert or update of salary_currency on public.user_info
  for each row execute function public.normalize_salary_currency();

drop trigger if exists job_postings_normalize_salary_currency on public.job_postings;
create trigger job_postings_normalize_salary_currency
  before insert or update of salary_currency on public.job_postings
  for each row execute function public.normalize_salary_currency();

alter table public.job_postings alter column salary_currency set default 'USD';

update public.user_info
   set salary_currency = public.iso_currency(salary_currency)
 where public.iso_currency(salary_currency) is not null
   and salary_currency is distinct from public.iso_currency(salary_currency);

update public.job_postings
   set salary_currency = public.iso_currency(salary_currency)
 where public.iso_currency(salary_currency) is not null
   and salary_currency is distinct from public.iso_currency(salary_currency);

-- ---------------------------------------------------------------------------
-- all_jobs: a currency for every job with a salary.

alter table public.all_jobs add column if not exists salary_currency text;

comment on column public.all_jobs.salary_currency is
  'ISO 4217 code of salary_min / salary_max. Set by all_jobs_set_salary_currency: the posting''s currency for GetHired jobs, else read from salary_range. Null when unknown.';

create or replace function public.all_jobs_set_salary_currency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_explicit text;
begin
  if tg_op = 'UPDATE'
     and new.salary_currency is not distinct from old.salary_currency
     and new.salary_range is not distinct from old.salary_range then
    return new;
  end if;
  -- A currency the writer sets wins; otherwise the salary text says.
  if tg_op = 'INSERT' or new.salary_currency is distinct from old.salary_currency then
    v_explicit := public.iso_currency(new.salary_currency);
  end if;
  new.salary_currency := coalesce(v_explicit, public.salary_text_currency(new.salary_range));
  return new;
end;
$$;

drop trigger if exists all_jobs_set_salary_currency on public.all_jobs;
create trigger all_jobs_set_salary_currency
  before insert or update of salary_currency, salary_range on public.all_jobs
  for each row execute function public.all_jobs_set_salary_currency();

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
