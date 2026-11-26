-- Company dashboard (plan/company-dashboard, CD-MIG-1).
--
-- company_dashboard_summary() replaces get_company_metrics(company_id), which
-- stays until the new dashboard is live: the deployed one still calls it. See
-- supabase/after_deploy/20261129140000_drop_get_company_metrics.sql. The
-- company comes from the session, never from input. It runs as the caller, so
-- RLS applies, and it counts only the jobs where the member has
-- applicants.view. Merged applications are left out. Null for a non-member.

create or replace function public.company_dashboard_summary()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_zone text;
  v_today timestamptz;
  v_result jsonb;
begin
  if v_company is null then
    return null;
  end if;

  -- CD §13: "today" is the company's day, or UTC's when it hasn't set a zone.
  select coalesce(ci.time_zone, 'UTC') into v_zone
    from public.company_info ci where ci.id = v_company;
  v_zone := coalesce(v_zone, 'UTC');
  v_today := date_trunc('day', now() at time zone v_zone) at time zone v_zone;

  with jobs as materialized (
    select jp.id, jp.state, jp.archived_at
      from public.job_postings jp
     where jp.company_id = v_company
       and public.has_company_permission(v_company, 'applicants.view', jp.id)
  ),
  apps as (
    select a.id, a.created_at, a.stage_id, a.stage_entered_at
      from public.applications a
      join jobs on jobs.id = a.job_post_id
     where a.merged_into_application_id is null
  )
  select jsonb_build_object(
    'open_jobs', (select count(*) from jobs where state in ('open', 'paused') and archived_at is null),
    'new_today', (select count(*) from apps where created_at >= v_today),
    'new_7d', (select count(*) from apps where created_at >= now() - interval '7 days'),
    -- The funnel's needs-attention rule (NEEDS_ATTENTION_DAYS = 3).
    'waiting', (
      select count(*)
        from apps
        join public.pipeline_stages s on s.id = apps.stage_id
       where s.kind = 'applied'
         and apps.stage_entered_at < now() - interval '3 days'
         and not exists (
           select 1 from public.application_events e
            where e.application_id = apps.id
              and e.type <> 'applied'
              and e.created_at > apps.stage_entered_at
         )
    )
  ) into v_result;

  return v_result;
end $$;

revoke all on function public.company_dashboard_summary() from public, anon;
grant execute on function public.company_dashboard_summary() to authenticated;
