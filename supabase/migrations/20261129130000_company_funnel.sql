-- Company dashboard (plan/company-dashboard, CD-MIG-2, CD-REQ-026).
--
-- get_company_funnel() is the company's whole funnel in one call, instead of
-- one get_job_funnel call per active job. The company comes from the session.
-- It runs as the caller: only jobs with applicants.view are counted, and merged
-- applications are left out. Null for a non-member.
--
-- Returns:
--   stages:          [{ kind, count }] summed over the active jobs
--   jobs:            [{ job_post_id, title, funnel }] newest first, where
--                    funnel is get_job_funnel's own result
--   needs_attention: up to 20 applications in an applied-kind stage for more
--                    than 3 days with no event since they got there, on any of
--                    the company's jobs, longest waiting first

create or replace function public.get_company_funnel()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_jobs jsonb;
  v_stages jsonb;
  v_waiting jsonb;
begin
  if v_company is null then
    return null;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object('job_post_id', x.id, 'title', x.title, 'funnel', x.funnel)
           order by x.created_at desc), '[]'::jsonb)
    into v_jobs
    from (
      select jp.id, jp.title, jp.created_at, public.get_job_funnel(jp.id) as funnel
        from public.job_postings jp
       where jp.company_id = v_company
         and jp.status = 'active'
         and public.has_company_permission(v_company, 'applicants.view', jp.id)
    ) x
   where x.funnel is not null;

  -- Jobs on other pipelines share no stage ids, so the totals are by kind.
  select coalesce(jsonb_agg(jsonb_build_object('kind', t.kind, 'count', t.n)), '[]'::jsonb)
    into v_stages
    from (
      select s ->> 'kind' as kind, sum((s ->> 'count')::bigint) as n
        from jsonb_array_elements(v_jobs) j
       cross join lateral jsonb_array_elements(j -> 'funnel' -> 'stages') s
       group by s ->> 'kind'
    ) t;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'application_id', w.id,
             'name', w.name,
             'job_post_id', w.job_post_id,
             'job_title', w.title,
             'stage_entered_at', w.stage_entered_at
           ) order by w.stage_entered_at, w.id), '[]'::jsonb)
    into v_waiting
    from (
      select a.id, a.job_post_id, jp.title, a.stage_entered_at,
             -- applicationPerson's rule: the company's own record wins.
             case when a.company_candidate_id is not null
               then coalesce(nullif(btrim(cc.full_name), ''), nullif(btrim(ui.full_name), ''), 'Candidate')
               else coalesce(nullif(btrim(ui.full_name), ''), 'Applicant')
             end as name
        from public.applications a
        join public.job_postings jp on jp.id = a.job_post_id
        join public.pipeline_stages s on s.id = a.stage_id
        left join public.company_candidates cc on cc.id = a.company_candidate_id
        left join public.user_info ui on ui.user_id = a.applicant_user_id
       where jp.company_id = v_company
         and public.has_company_permission(v_company, 'applicants.view', jp.id)
         and a.merged_into_application_id is null
         and s.kind = 'applied'
         and a.stage_entered_at < now() - interval '3 days'
         and not exists (
           select 1 from public.application_events e
            where e.application_id = a.id
              and e.type <> 'applied'
              and e.created_at > a.stage_entered_at
         )
       order by a.stage_entered_at, a.id
       limit 20
    ) w;

  return jsonb_build_object('stages', v_stages, 'jobs', v_jobs, 'needs_attention', v_waiting);
end $$;

revoke all on function public.get_company_funnel() from public, anon;
grant execute on function public.get_company_funnel() to authenticated;
