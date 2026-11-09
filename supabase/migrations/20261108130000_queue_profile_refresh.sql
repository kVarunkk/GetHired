-- Keeping an onboarded applicant's embedding and relevant jobs in step with
-- their profile (helpers/user/queue-profile-refresh.ts):
--
-- 1. queue_profile_refresh: after the preferences or the primary resume change
--    (updateMyPreferences, setting or editing the primary resume). It reuses
--    onboarding_pipeline, whose worker embeds, rebuilds user_relevant_jobs and
--    retries. A message without resumeId (and shouldParse false) skips
--    parsing, which the deployed worker already handles.
-- 2. set_primary_resume, below.
--
-- The check, the status and the message are one transaction, with the
-- profile row locked, so two calls at once can't both start a run: each run
-- makes paid model and rerank calls. A run still "progress" after
-- p_stale_seconds is treated as dead, as triggerRelevanceUpdate does
-- (STALE_PROGRESS_MS).
--
-- Called only by the server with the service-role client. Additive only: the
-- deployed code doesn't call it.

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
    return jsonb_build_object('ok', false, 'reason', 'in_progress');
  end if;

  update public.user_info
     set relevant_jobs_update_status = 'progress',
         updated_at = now()
   where user_id = p_user_id;

  perform pgmq.send(
    'onboarding_pipeline',
    jsonb_build_object('userId', p_user_id, 'shouldParse', false)
  );

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.queue_profile_refresh(uuid, integer) from public, anon, authenticated;
grant execute on function public.queue_profile_refresh(uuid, integer) to service_role;

-- Making a resume primary in one statement. Before this it was "clear every
-- primary" then "set this one" as two requests, so a failure in between left
-- the user with no primary resume (embeddings and matches read the primary).
-- `changed` is false when it was already the primary, so the caller doesn't
-- start a refresh for nothing. Service-role only; the user id comes from the
-- session in helpers/resumes/set-primary-resume.ts.

create or replace function public.set_primary_resume(
  p_user_id uuid,
  p_resume_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_primary boolean;
begin
  select is_primary into v_was_primary
    from public.resumes
   where id = p_resume_id and user_id = p_user_id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'resume_not_found');
  end if;

  -- Also clears any stray second primary when it already was the primary.
  update public.resumes
     set is_primary = (id = p_resume_id)
   where user_id = p_user_id
     and (is_primary or id = p_resume_id)
     and is_primary is distinct from (id = p_resume_id);

  return jsonb_build_object('ok', true, 'changed', not v_was_primary);
end $$;

revoke all on function public.set_primary_resume(uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_primary_resume(uuid, uuid) to service_role;
