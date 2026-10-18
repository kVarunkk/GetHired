-- Recruiter roles, phase 5: the job page's Hiring team panel
-- (plan/recruiter-roles/feature-recruiter-roles-spec.md RP-REQ-011, RPT-052).
--
-- The panel needs, for one job, who is assigned and who could be. That depends
-- on each member's role grants and the caller's ceiling, which members with
-- jobs.assign but not roles.view can't read themselves. The flags use the same
-- checks as assign_job / unassign_job, so the panel only offers what the RPCs
-- would accept.

create or replace function public.list_job_hiring_team(p_job_post_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case
    when not exists (
      select 1 from public.job_postings jp
       where jp.id = p_job_post_id and jp.company_id = public.my_company_id()
    ) then null
    when not public.has_company_permission(public.my_company_id(), 'jobs.assign', p_job_post_id) then null
  else coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', m.user_id,
             'email', u.email,
             'display_name', m.display_name,
             'is_owner', m.is_owner,
             'role', case when r.id is null then null
                          else jsonb_build_object('id', r.id, 'name', r.name, 'color', r.color) end,
             'assigned', ja.user_id is not null,
             -- assign_job: a non-owner whose role has a job-scopable permission,
             -- within the caller's ceiling (rule 4).
             'assignable', not m.is_owner and m.role_id is not null
               and exists (
                 select 1 from public.company_role_permissions rp
                   join public.company_permissions p on p.key = rp.permission_key
                  where rp.role_id = m.role_id and p.scopable
               )
               and coalesce(public.role_within_caller_ceiling(m.role_id), false),
             -- unassign_job: rule 4 only.
             'removable', m.is_owner or m.role_id is null
               or coalesce(public.role_within_caller_ceiling(m.role_id), false)
           ) order by m.is_owner desc, m.display_name nulls last, m.created_at)
      from public.company_members m
      join auth.users u on u.id = m.user_id
      left join public.company_roles r on r.id = m.role_id
      left join public.company_job_assignments ja
        on ja.job_post_id = p_job_post_id and ja.user_id = m.user_id and ja.company_id = m.company_id
     where m.company_id = public.my_company_id()
  ), '[]'::jsonb) end
$$;

revoke all on function public.list_job_hiring_team(uuid) from public, anon;
grant execute on function public.list_job_hiring_team(uuid) to authenticated, service_role;
