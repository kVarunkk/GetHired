-- Recruiter outreach (ORT-043): the talent search moves to candidate_directory,
-- so the view gains the substring-filter columns the search uses. Appended at
-- the end, so `create or replace` keeps the existing columns and grants.

create or replace view public.candidate_directory
with (security_barrier = true)
as
select
  u.user_id,
  u.full_name,
  u.desired_roles,
  u.preferred_locations,
  u.job_type,
  u.min_salary,
  u.max_salary,
  u.salary_currency,
  u.experience_years,
  u.industry_preferences,
  u.visa_sponsorship_required,
  u.top_skills,
  u.work_style_preferences,
  u.career_goals_short_term,
  u.career_goals_long_term,
  u.company_size_preference,
  u.filled,
  u.is_public,
  u.accepts_outreach,
  u.created_at,
  u.updated_at,
  coalesce((
    select ps.sections
    from public.resumes r
    join public.resume_public_sections ps on ps.resume_id = r.id
    where r.user_id = u.user_id and r.is_primary
    order by r.created_at desc
    limit 1
  ), '[]'::jsonb) as resume_sections,
  -- The talent search's substring filters (20261015180000_profile_text_filters).
  -- Those are computed fields on user_info, which PostgREST can't use on a view.
  lower(array_to_string(u.desired_roles, E'\n')) as desired_roles_search,
  lower(array_to_string(u.top_skills, E'\n')) as top_skills_search,
  lower(array_to_string(u.work_style_preferences, E'\n')) as work_style_preferences_search,
  lower(array_to_string(u.industry_preferences, E'\n')) as industry_preferences_search
from public.user_info u
where u.is_public
  and (select public.my_company_id()) is not null
  and not exists (
    select 1 from public.candidate_company_blocks b
    where b.candidate_user_id = u.user_id and b.company_id = (select public.my_company_id())
  );

alter view public.candidate_directory owner to postgres;
revoke all on public.candidate_directory from public, anon, authenticated;
grant select on public.candidate_directory to authenticated, service_role;
