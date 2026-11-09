-- One follow-up run instead of none, when a profile changes while its
-- refresh run is still going.
--
-- A run embeds the profile as it is when the worker starts, then spends a
-- while ranking jobs for that embedding. A change after that point isn't in
-- the run. Starting a second run at once would overlap the first (paid twice,
-- and the older one can finish last and overwrite the newer matches), so:
--
-- - While a run is going, a change only sets
--   user_info.profile_refresh_requested_at (queue_profile_refresh, and
--   complete_applicant_onboarding for an onboarded user resubmitting).
-- - When a run finishes, finish_profile_refresh queues one more run if a
--   change was requested after that run started. Any number of changes
--   during a run make one follow-up, and it reads the whole current profile,
--   so every change is in it.
--
-- complete_applicant_onboarding gains p_stale_seconds, so the old
-- five-argument function is dropped first: two overloads would make the RPC
-- ambiguous. Nothing deployed calls the functions changed here.

alter table public.user_info
  add column if not exists profile_refresh_requested_at timestamptz;

comment on column public.user_info.profile_refresh_requested_at is
  'Set when the profile changed while a refresh run was going; the run queues one more when it finishes (finish_profile_refresh).';

drop function if exists public.complete_applicant_onboarding(uuid, uuid, jsonb, text, boolean);

create or replace function public.complete_applicant_onboarding(
  p_user_id uuid,
  p_resume_id uuid,
  p_profile jsonb,
  p_email text,
  p_should_parse boolean,
  p_stale_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.user_info;
  v_running boolean;
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

  -- An already-onboarded user resubmitting while a run is still going gets no
  -- second run now: the running one queues a follow-up when it finishes.
  v_running := v_profile.filled
    and v_profile.relevant_jobs_update_status = 'progress'
    and v_profile.updated_at is not null
    and v_profile.updated_at > now() - make_interval(secs => p_stale_seconds);

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
         profile_refresh_requested_at = case
           when v_running then now() else u.profile_refresh_requested_at end,
         updated_at = now()
   where u.user_id = p_user_id;

  -- One statement, so the user never has two primaries or none.
  update public.resumes
     set is_primary = (id = p_resume_id)
   where user_id = p_user_id
     and (is_primary or id = p_resume_id);

  if v_running then
    return jsonb_build_object('ok', true, 'queued', false, 'deferred', true);
  end if;

  -- pgmq is table-backed, so the message commits or rolls back with the rest.
  perform pgmq.send(
    'onboarding_pipeline',
    jsonb_build_object('userId', p_user_id, 'resumeId', p_resume_id, 'shouldParse', p_should_parse)
  );

  return jsonb_build_object('ok', true, 'queued', true);
end $$;

revoke all on function public.complete_applicant_onboarding(uuid, uuid, jsonb, text, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.complete_applicant_onboarding(uuid, uuid, jsonb, text, boolean, integer)
  to service_role;

-- queue_profile_refresh: while a run is going, it records the change for a
-- follow-up and answers `deferred`, instead of refusing.

create or replace function public.queue_profile_refresh(
  p_user_id uuid,
  p_stale_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filled boolean;
  v_status public.job_posting_matching_status;
  v_updated_at timestamptz;
begin
  select filled, relevant_jobs_update_status, updated_at
    into v_filled, v_status, v_updated_at
    from public.user_info
   where user_id = p_user_id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'profile_not_found');
  end if;
  if not v_filled then
    return jsonb_build_object('ok', false, 'reason', 'not_onboarded');
  end if;
  if v_status = 'progress'
     and v_updated_at is not null
     and v_updated_at > now() - make_interval(secs => p_stale_seconds) then
    update public.user_info
       set profile_refresh_requested_at = now()
     where user_id = p_user_id;
    return jsonb_build_object('ok', true, 'queued', false, 'deferred', true);
  end if;

  update public.user_info
     set relevant_jobs_update_status = 'progress',
         updated_at = now()
   where user_id = p_user_id;

  perform pgmq.send(
    'onboarding_pipeline',
    jsonb_build_object('userId', p_user_id, 'shouldParse', false)
  );

  return jsonb_build_object('ok', true, 'queued', true);
end $$;

-- finish_profile_refresh: called by a worker after a run that started at
-- p_started_at succeeded. A change requested after that start wasn't in the
-- run, so it queues one more; either way the request is cleared.

create or replace function public.finish_profile_refresh(
  p_user_id uuid,
  p_started_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested_at timestamptz;
begin
  select profile_refresh_requested_at into v_requested_at
    from public.user_info
   where user_id = p_user_id
     for update;
  if not found or v_requested_at is null then
    return jsonb_build_object('ok', true, 'requeued', false);
  end if;

  if v_requested_at <= p_started_at then
    -- Made before this run started: the run already read it.
    update public.user_info
       set profile_refresh_requested_at = null
     where user_id = p_user_id;
    return jsonb_build_object('ok', true, 'requeued', false);
  end if;

  update public.user_info
     set profile_refresh_requested_at = null,
         relevant_jobs_update_status = 'progress',
         updated_at = now()
   where user_id = p_user_id;

  perform pgmq.send(
    'onboarding_pipeline',
    jsonb_build_object('userId', p_user_id, 'shouldParse', false)
  );

  return jsonb_build_object('ok', true, 'requeued', true);
end $$;

revoke all on function public.finish_profile_refresh(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.finish_profile_refresh(uuid, timestamptz) to service_role;
