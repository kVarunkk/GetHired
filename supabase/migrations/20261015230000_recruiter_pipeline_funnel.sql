-- Recruiter pipeline, part 5 (PLT-082, PL-TASK-050): the per-job funnel.
--
-- get_job_funnel(job) returns, for a member of the job's company:
--   stages: every active stage in order with
--     count       - applications in it now,
--     reached     - applications that were ever in it (conversion comes from these),
--     median_days - the median time spent in it, from the applications that
--                   have left it (stage_changed events), or null;
--   sources: applications per source;
--   time_to_hire_days: the median days from applying to entering a Hired stage, or null;
--   total: the job's applications.
-- Anyone else gets null. SECURITY INVOKER: RLS applies to every read.

create or replace function public.get_job_funnel(p_job_post_id uuid)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_company uuid;
  v_applied uuid;
  v_result jsonb;
begin
  select jp.company_id into v_company from public.job_postings jp where jp.id = p_job_post_id;
  if v_company is null or not public.is_company_member(v_company) then
    return null;
  end if;

  -- Everyone starts in the first Applied stage.
  select s.id into v_applied from public.pipeline_stages s
   where s.company_id = v_company and s.kind = 'applied'
   order by s.archived, s.position
   limit 1;

  with apps as (
    select a.id, a.stage_id, a.source, a.created_at
      from public.applications a
     where a.job_post_id = p_job_post_id
  ),
  entries as (
    select apps.id as application_id, v_applied as stage_id, apps.created_at as entered_at
      from apps
    union all
    select e.application_id, (e.payload->>'to_stage_id')::uuid, e.created_at
      from public.application_events e
      join apps on apps.id = e.application_id
     where e.type = 'stage_changed' and e.payload ? 'to_stage_id'
  ),
  stays as (
    select stage_id, entered_at,
           lead(entered_at) over (partition by application_id order by entered_at) as left_at
      from entries
  ),
  medians as (
    select stage_id,
           percentile_cont(0.5) within group (order by extract(epoch from left_at - entered_at) / 86400.0)
             as median_days
      from stays
     where left_at is not null
     group by stage_id
  ),
  reached as (
    select stage_id, count(distinct application_id) as n
      from (
        select application_id, stage_id from entries
        union
        select id, stage_id from apps where stage_id is not null
      ) x
     group by stage_id
  ),
  current_counts as (
    select stage_id, count(*) as n from apps group by stage_id
  ),
  hires as (
    select percentile_cont(0.5) within group (order by extract(epoch from en.entered_at - apps.created_at) / 86400.0)
             as median_days
      from entries en
      join apps on apps.id = en.application_id
      join public.pipeline_stages s on s.id = en.stage_id
     where s.kind = 'hired'
  )
  select jsonb_build_object(
    'stages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'stage_id', s.id,
               'name', s.name,
               'kind', s.kind,
               'count', coalesce(c.n, 0),
               'reached', coalesce(r.n, 0),
               'median_days', round(m.median_days::numeric, 1)
             ) order by s.position)
        from public.pipeline_stages s
        left join current_counts c on c.stage_id = s.id
        left join reached r on r.stage_id = s.id
        left join medians m on m.stage_id = s.id
       where s.company_id = v_company and not s.archived
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_object_agg(source, n) from (select source, count(*) as n from apps group by source) x
    ), '{}'::jsonb),
    'time_to_hire_days', (select round(median_days::numeric, 1) from hires),
    'total', (select count(*) from apps)
  ) into v_result;

  return v_result;
end $$;

revoke all on function public.get_job_funnel(uuid) from public, anon;
grant execute on function public.get_job_funnel(uuid) to authenticated, service_role;
