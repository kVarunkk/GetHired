-- Applicant onboarding's writes in one transaction: the profile, the primary
-- resume and the onboarding_pipeline message. Before this they were separate
-- requests, so a failure between clearing the old primary and setting the new
-- one left the user filled, with no primary resume and nothing queued.
--
-- Called only by the server (helpers/user/complete-onboarding.ts) with the
-- service-role client, after the profile has been validated with
-- onboardingProfileSchema. The user id comes from the session there. Only
-- service_role can execute it, so no client can queue the pipeline itself.
--
-- `p_profile` uses user_info column names. A key that isn't sent keeps the
-- stored value; a key sent as null clears it. Only the columns listed in the
-- update are written, whatever else the object holds (SEC-009).
--
-- Additive only: the deployed code doesn't call it.

create or replace function public.complete_applicant_onboarding(
  p_user_id uuid,
  p_resume_id uuid,
  p_profile jsonb,
  p_email text,
  p_should_parse boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.user_info;
begin
  -- SEC-010: only the user's own resume can become primary and be processed.
  perform 1 from public.resumes where id = p_resume_id and user_id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'resume_not_found');
  end if;

  -- Sign-up creates the row, so this is an update: never an insert.
  select * into v_profile from public.user_info where user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'profile_not_found');
  end if;

  v_profile := jsonb_populate_record(v_profile, coalesce(p_profile, '{}'::jsonb));

  update public.user_info u
     set full_name = v_profile.full_name,
         desired_roles = v_profile.desired_roles,
         job_type = v_profile.job_type,
         salary_currency = v_profile.salary_currency,
         min_salary = v_profile.min_salary,
         max_salary = v_profile.max_salary,
         preferred_locations = v_profile.preferred_locations,
         experience_years = v_profile.experience_years,
         top_skills = v_profile.top_skills,
         work_style_preferences = v_profile.work_style_preferences,
         company_size_preference = v_profile.company_size_preference,
         linkedin_url = v_profile.linkedin_url,
         github_url = v_profile.github_url,
         industry_preferences = v_profile.industry_preferences,
         career_goals_short_term = v_profile.career_goals_short_term,
         career_goals_long_term = v_profile.career_goals_long_term,
         visa_sponsorship_required = v_profile.visa_sponsorship_required,
         email = coalesce(nullif(p_email, ''), u.email),
         filled = true,
         -- Queued, not run yet: show matches as being generated (and stop the
         -- jobs page offering a second, parallel generation).
         relevant_jobs_update_status = 'progress',
         updated_at = now()
   where u.user_id = p_user_id;

  -- One statement, so the user never has two primaries or none.
  update public.resumes
     set is_primary = (id = p_resume_id)
   where user_id = p_user_id
     and (is_primary or id = p_resume_id);

  -- pgmq is table-backed, so the message commits or rolls back with the rest.
  perform pgmq.send(
    'onboarding_pipeline',
    jsonb_build_object('userId', p_user_id, 'resumeId', p_resume_id, 'shouldParse', p_should_parse)
  );

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.complete_applicant_onboarding(uuid, uuid, jsonb, text, boolean)
  from public, anon, authenticated;
grant execute on function public.complete_applicant_onboarding(uuid, uuid, jsonb, text, boolean)
  to service_role;
