-- The jobs page's company filter searches on the server.
--
-- It loaded every company through get_unique_companies, and the API returns at
-- most 1,000 rows from one request (db.max_rows), without an error: companies
-- after the 1,000th couldn't be picked.
--
--  1. all_jobs.company_name is trimmed on every write, and the stored names are
--     cleaned. The job filter trims the picked name and matches it exactly, so
--     a name stored with spaces around it couldn't be found.
--  2. search_job_companies returns up to 50 names matching what was typed.
--  3. A small index so that search doesn't read the whole table.
--
-- Safe before the code ships: get_unique_companies stays for the deployed app.
--
-- Plain CREATE INDEX (migrations run in a transaction), so it blocks writes to
-- all_jobs while it builds; at about 15k jobs that's a few seconds. To avoid
-- even that, run this first outside a transaction, and this is a no-op:
--   create index concurrently if not exists all_jobs_listed_company_name_idx
--     on public.all_jobs (company_name) where status = 'active' and listed;

-- A trigger, because most jobs are written by importers outside this repo.
-- [[:space:]] alone misses the non-breaking space and the byte order mark.
create or replace function public.trim_all_jobs_company_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.company_name := regexp_replace(
    new.company_name,
    '^[[:space:] ﻿]+|[[:space:] ﻿]+$',
    '',
    'g'
  );
  return new;
end;
$$;
revoke all on function public.trim_all_jobs_company_name() from public, anon, authenticated;

drop trigger if exists all_jobs_trim_company_name on public.all_jobs;
create trigger all_jobs_trim_company_name
  before insert or update of company_name on public.all_jobs
  for each row execute function public.trim_all_jobs_company_name();

-- The trigger does the trimming; only rows that need it are written.
update public.all_jobs
   set company_name = company_name
 where company_name ~ '^[[:space:] ﻿]|[[:space:] ﻿]$';

create index if not exists all_jobs_listed_company_name_idx
  on public.all_jobs (company_name) where status = 'active' and listed;

-- Companies with a job the jobs page can show: active, and not link-only.
-- Names that start with the text come first, then those with the most jobs, so
-- an empty search gives the biggest employers. The text is matched literally.
create or replace function public.search_job_companies(p_query text default '', p_limit integer default 50)
returns table(company_name text)
language sql stable security invoker
set search_path = ''
as $$
  with search as (
    select replace(replace(replace(
             left(btrim(coalesce(p_query, '')), 100),
             '\', '\\'), '%', '\%'), '_', '\_') as term
  )
  select aj.company_name
    from public.all_jobs as aj
   cross join search as s
   where aj.status = 'active'
     and aj.listed
     and aj.company_name <> ''
     and aj.company_name ilike '%' || s.term || '%'
   group by aj.company_name, s.term
   order by (aj.company_name ilike s.term || '%') desc, count(*) desc, aj.company_name
   limit least(greatest(coalesce(p_limit, 50), 1), 50)
$$;

revoke all on function public.search_job_companies(text, integer) from public;
grant execute on function public.search_job_companies(text, integer) to anon, authenticated, service_role;
