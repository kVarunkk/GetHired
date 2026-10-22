-- Job title keyword search that ignores spacing and hyphens.
--
-- all_jobs.job_name_search holds the title's words, lowercased and one space
-- apart, then " | " and each adjacent pair of words joined:
--   "Full-Stack Developer (React/Node.js)"
--   -> "full stack developer react node js | fullstack stackdeveloper developerreact reactnode nodejs"
-- so a search for "fullstack", "full stack" or "full-stack" matches all three
-- spellings. The query side (titleKeywordCondition in
-- helpers/jobs/filterQueryBuilder.ts) normalizes keywords the same way; keep
-- the two in sync.
--
-- A plain column filled by a trigger, not a generated column: adding a stored
-- generated column rewrites the whole table, which needs about the table's
-- size in free space. Adding a nullable column rewrites nothing.
--
-- ORDER:
--   1. Push this migration. Nothing deployed reads the column.
--   2. Backfill existing rows with scripts/backfill-job-name-search.sql,
--      run repeatedly until it reports 0 remaining.
--   3. Deploy the code that searches job_name_search. Rows not backfilled
--      yet don't match any keyword.

create or replace function public.job_title_search_text(title text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when cardinality(w) = 0 then ''
    else array_to_string(w, ' ') || ' | ' || coalesce(
      (select string_agg(w[i] || w[i + 1], ' ' order by i)
         from generate_subscripts(w, 1) as i
        where i < cardinality(w)),
      '')
  end
  from (
    select array_remove(
      regexp_split_to_array(lower(coalesce(title, '')), '[^a-z0-9+#]+'),
      '') as w
  ) as words;
$$;

alter table public.all_jobs add column if not exists job_name_search text;

create or replace function public.set_job_name_search()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.job_name_search := public.job_title_search_text(new.job_name);
  return new;
end;
$$;

drop trigger if exists set_job_name_search on public.all_jobs;
create trigger set_job_name_search
before insert or update of job_name on public.all_jobs
for each row execute function public.set_job_name_search();
