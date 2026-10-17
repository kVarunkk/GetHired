-- Recruiter roles: the central Hiring teams page (/company/settings/hiring-teams).
--
-- The job page's panel (list_job_hiring_team) shows one job. This returns, in
-- one round trip, every job the caller has jobs.assign on (all of the
-- company's at scope all, their own assigned ones at scope assigned) with who
-- is on it, plus the company's members. A member's assignable / removable
-- flags only depend on their role and the caller's ceiling, not on the job, so
-- they're computed once per member, with the same checks as assign_job /
-- unassign_job. Null when the caller doesn't hold jobs.assign at any scope.

create or replace function public.list_company_hiring_teams()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case
    when public.my_company_id() is null then null
    when public.company_permission_scope(public.my_company_id(), 'jobs.assign') is null then null
  else jsonb_build_object(
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', jp.id,
               'title', jp.title,
               'status', jp.status,
               'created_at', jp.created_at,
               'assigned_user_ids', coalesce((
                 select jsonb_agg(ja.user_id order by ja.created_at)
                   from public.company_job_assignments ja
                  where ja.job_post_id = jp.id and ja.company_id = jp.company_id
               ), '[]'::jsonb)
             ) order by jp.status, jp.created_at desc)
        from public.job_postings jp
       where jp.company_id = public.my_company_id()
         and jp.id = any(public.my_job_ids_with('jobs.assign'))
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', m.user_id,
               'email', u.email,
               'display_name', m.display_name,
               'is_owner', m.is_owner,
               'role', case when r.id is null then null
                            else jsonb_build_object('id', r.id, 'name', r.name, 'color', r.color) end,
               -- assign_job: a non-owner whose role has a job-scopable
               -- permission, within the caller's ceiling (rule 4).
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
       where m.company_id = public.my_company_id()
    ), '[]'::jsonb)
  ) end
$$;

revoke all on function public.list_company_hiring_teams() from public, anon;
grant execute on function public.list_company_hiring_teams() to authenticated, service_role;
