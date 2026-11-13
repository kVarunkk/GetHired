-- ATS quick fixes, part C (QF-REQ-020), follow-up to
-- 20261113120000_company_application_list.sql:
-- * person_name follows applicationPerson (BI-REQ-043): a company candidate's
--   record wins, claimed or not, falling back to the user's name; a GetHired
--   applicant reads as the user. 'Candidate' / 'Applicant' when blank.
-- * knockout_reasons and candidate_has_resume, appended, so the list shows the
--   same badges as before (the knockout tooltip and "No resume").
-- Additive: nothing deployed reads the view yet.

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
  case
    when a.company_candidate_id is not null
      then coalesce(nullif(btrim(cc.full_name), ''), nullif(btrim(u.full_name), ''), 'Candidate')
    else coalesce(nullif(btrim(u.full_name), ''), 'Applicant')
  end as person_name,
  a.applicant_user_id,
  a.company_candidate_id,
  s.fit_score,
  s.status as screening_status,
  s.recommendation,
  k.failed as knockout_failed,
  k.reasons as knockout_reasons,
  (cc.resume_path is not null or cc.resume_content is not null) as candidate_has_resume
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
