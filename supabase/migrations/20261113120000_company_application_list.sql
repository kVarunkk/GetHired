-- ATS quick fixes, part C (plan/ats-quick-fixes/feature-ats-quick-fixes-spec.md,
-- QF-REQ-020): one flat row per application for the company Applications
-- list, so the page can filter, sort and page on the server.
--
-- security_invoker: the caller's RLS on applications, user_info,
-- company_candidates, application_screenings and application_knockouts still
-- applies, so the view shows exactly what the page's embeds showed. The
-- explicit applicants.view filter also keeps an applicant's own applications
-- out (they can read those through their own policy).
--
-- Additive: nothing deployed reads it.

create or replace view public.company_application_list
with (security_invoker = true)
as
select
  a.id,
  a.created_at,
  a.status,
  a.stage_id,
  a.source,
  a.job_post_id,
  jp.title as job_title,
  jp.company_id,
  -- The same rule as applicationPerson: a claimed application reads as the user.
  coalesce(u.full_name, cc.full_name) as person_name,
  a.applicant_user_id,
  a.company_candidate_id,
  s.fit_score,
  s.status as screening_status,
  s.recommendation,
  k.failed as knockout_failed
from public.applications a
join public.job_postings jp on jp.id = a.job_post_id
left join public.user_info u on u.user_id = a.applicant_user_id
left join public.company_candidates cc on cc.id = a.company_candidate_id
left join public.application_screenings s on s.application_id = a.id
left join public.application_knockouts k on k.application_id = a.id
where a.merged_into_application_id is null
  and a.job_post_id = any ((select public.my_job_ids_with('applicants.view'))::uuid[]);

revoke all on public.company_application_list from public, anon;
grant select on public.company_application_list to authenticated;
