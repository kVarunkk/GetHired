-- The marketing pages' "Applications submitted" figure (utils/platform-stats.ts).
--
-- External applications moved to tracked_applications (20261126120000), so
-- counting `applications` alone left them out. Count both:
--   * applications, without the candidates companies imported themselves, and
--     without rows merged into another application;
--   * tracked_applications, without saved jobs, which aren't applications yet.
--
-- This function was created outside the migrations; this is now its definition.
-- Only application_count changes. create or replace keeps the existing grants.

create or replace function public.get_platform_stats()
returns table (job_count integer, user_count integer, application_count integer, resume_count integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select
    (select count(*)::integer from public.all_jobs),
    -- Registered profiles
    (select count(*)::integer from public.user_info),
    -- Job applications
    (
      (select count(*) from public.applications a
        where a.source is distinct from 'imported'
          and a.merged_into_application_id is null)
      +
      (select count(*) from public.tracked_applications t
        where t.status <> 'saved')
    )::integer,
    -- Successfully parsed resumes
    (select count(*)::integer from public.resumes r
      where r.content is not null and r.parsing_failed = false);
end;
$$;
