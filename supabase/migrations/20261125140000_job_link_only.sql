-- Job states, phase 4: link-only postings (plan/job-states/feature-job-states-tasks.md,
-- JLT-060; spec JL-REQ-023..025). job_postings.visibility came with phase 1.
--
--  1. all_jobs.listed: false for a link-only job. Applicant listings filter it.
--  2. A trigger mirrors visibility to listed on every write that touches the
--     posting or links it to its public row, so no writer can forget.
--  3. get_careers_jobs and the filter option lists leave link-only jobs out.

alter table public.all_jobs add column if not exists listed boolean not null default true;

create or replace function public.sync_all_jobs_listed()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.job_id is not null then
    update public.all_jobs set listed = (new.visibility = 'public')
     where id = new.job_id and listed is distinct from (new.visibility = 'public');
  end if;
  return new;
end;
$$;
revoke all on function public.sync_all_jobs_listed() from public, anon, authenticated;

drop trigger if exists job_postings_sync_listed on public.job_postings;
create trigger job_postings_sync_listed
  after insert or update of visibility, job_id on public.job_postings
  for each row execute function public.sync_all_jobs_listed();

-- Backfill: nothing is link-only yet, but keep the two in step.
update public.all_jobs aj set listed = false
  from public.job_postings jp
 where jp.job_id = aj.id and jp.visibility = 'link_only' and aj.listed;

create index if not exists all_jobs_listed_idx on public.all_jobs (listed) where listed = false;

-- The careers list (the single-job careers page reads the job directly).
create or replace function public.get_careers_jobs(p_slug text, p_preview boolean default false)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', jp.id,
           'all_jobs_id', jp.job_id,
           'title', jp.title,
           'description', left(coalesce(jp.description, ''), 20000),
           'location', jp.location,
           'job_type', jp.job_type,
           'department', jp.department,
           'workplace_type', jp.workplace_type,
           'salary_currency', jp.salary_currency,
           'salary_range', jp.salary_range,
           'min_salary', jp.min_salary,
           'max_salary', jp.max_salary,
           'min_experience', jp.min_experience,
           'max_experience', jp.max_experience,
           'experience', jp.experience,
           'visa_sponsorship', jp.visa_sponsorship,
           'created_at', jp.created_at
         ) order by jp.created_at desc), '[]'::jsonb)
    from public.job_postings jp
    join public.company_info c on c.id = jp.company_id
   where jp.status = 'active'
     and jp.visibility = 'public'
     and jp.job_id is not null
     and (
       (not p_preview and c.careers_slug = lower(p_slug) and c.careers_published)
       or (p_preview and c.id = public.my_company_id())
     )
$$;

-- Filter option lists: no company or location that only link-only jobs have.
create or replace function public.get_unique_companies()
returns table(company_name text)
language plpgsql
as $$
begin
  return query
    select distinct aj.company_name
    from public.all_jobs as aj
    where aj.company_name is not null and aj.company_name <> '' and aj.listed
    order by aj.company_name;
end;
$$;

create or replace function public.get_unique_locations()
returns table(location text)
language plpgsql
as $$
begin
  return query
    select distinct unnest(aj.locations) as location
    from public.all_jobs as aj
    where aj.locations is not null and array_length(aj.locations, 1) > 0 and aj.listed
    order by location;
end;
$$;

-- The semantic search takes its top N before the threshold, so a link-only
-- job must not use up a slot: it is filtered inside the index scan. Otherwise
-- this is the live HNSW version (fix/match-all-jobs-hnsw), unchanged.
create or replace function public.match_all_jobs_test(
  embedding public.vector, match_threshold double precision, match_count integer, min_created_at timestamp without time zone
) returns table(id uuid, distance_score double precision)
language plpgsql stable
set "hnsw.ef_search" to '200'
set "hnsw.iterative_scan" to 'relaxed_order'
as $function$
begin
  -- Dynamic SQL, as before, so each call is planned with its real values.
  -- $1 = embedding, $2 = match_threshold, $3 = match_count, $4 = min_created_at
  return query execute $q$
    with nearest as materialized (
      select
        all_jobs.id,
        (all_jobs.embedding_new <=> $1)::double precision as distance_score
      from all_jobs
      where all_jobs.status = 'active'
        and all_jobs.created_at >= $4
        and all_jobs.listed
      order by all_jobs.embedding_new <=> $1
      limit $3
    )
    select nearest.id, nearest.distance_score
    from nearest
    where nearest.distance_score < $2
    order by nearest.distance_score, nearest.id
  $q$
  using embedding, match_threshold, match_count, min_created_at;
end;
$function$;
