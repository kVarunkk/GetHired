-- Recruiter agent (plan/recruiter-agent/feature-recruiter-agent-spec.md §3, RAT-011).
--
-- 1. agent_sessions.role: which toolset a session belongs to. The chat route
--    loads a session only under the caller's role, so a user whose role
--    changed can't continue a chat with the other role's tools.
-- 2. get_recruiter_job_summaries: the company's jobs with applicant counts, for
--    the recruiter prompt and the listMyJobs tool, in one query per turn.

alter table public.agent_sessions
  add column if not exists role text not null default 'applicant';

alter table public.agent_sessions
  drop constraint if exists agent_sessions_role_check;
alter table public.agent_sessions
  add constraint agent_sessions_role_check check (role in ('applicant', 'company'));

create index if not exists agent_sessions_user_role_updated_idx
  on public.agent_sessions (user_id, role, updated_at desc);

-- Active jobs first, then the most recently updated. Raises for a company the
-- caller isn't a member of.
create or replace function public.get_recruiter_job_summaries(
  p_company_id uuid,
  p_status public.job_posting_status default null,
  p_limit integer default 15
)
returns table (
  id uuid,
  title text,
  status public.job_posting_status,
  matching_status public.job_posting_matching_status,
  applicants bigint,
  new_24h bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_company_member(p_company_id) then
    raise exception 'not a member of this company' using errcode = 'insufficient_privilege';
  end if;

  return query
    select jp.id, jp.title, jp.status, jp.matching_status,
           count(a.id) as applicants,
           count(a.id) filter (where a.created_at > now() - interval '24 hours') as new_24h,
           jp.created_at, jp.updated_at
      from public.job_postings jp
      left join public.applications a on a.job_post_id = jp.id
     where jp.company_id = p_company_id
       and (p_status is null or jp.status = p_status)
     group by jp.id
     order by (jp.status = 'active') desc, jp.updated_at desc
     limit least(greatest(coalesce(p_limit, 15), 1), 50);
end;
$$;

revoke execute on function public.get_recruiter_job_summaries(uuid, public.job_posting_status, integer)
  from public, anon;
grant execute on function public.get_recruiter_job_summaries(uuid, public.job_posting_status, integer)
  to authenticated, service_role;
