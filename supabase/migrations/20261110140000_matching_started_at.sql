-- SM-REQ-004 / SM-REQ-005 (plan/state-machines/feature-state-machines-spec.md,
-- SMT-032): matching runs start atomically, and "in progress" is measured from
-- when the run started, not from updated_at (which any profile or job edit
-- moves, so a dead run could look alive for as long as someone kept editing).
--
-- - job_postings.matching_started_at and user_info.relevance_started_at hold
--   the start. Both are nullable and additive: deployed code doesn't read them.
-- - A trigger stamps the start whenever the status moves into `progress`, so
--   every writer that already sets `progress` (the deployed app, the cron
--   enqueue, the onboarding RPCs) keeps the column right without changing.
--   A restart of a dead run (`progress` to `progress`) sets it explicitly.
-- - run_in_progress() is the one reading of "a live run" here. TypeScript has
--   the same rule in isMatchingInProgress / isRelevanceInProgress; the timeout
--   is passed in from there, so there is one source for it.
-- - start_matching / start_relevance set `progress` only when no live run
--   holds the row, in one statement under a row lock, and answer
--   { ok: false, reason: 'in_progress' } otherwise.
-- - queue_profile_refresh and complete_applicant_onboarding read the start
--   time instead of updated_at. Their signatures don't change.

alter table public.job_postings add column if not exists matching_started_at timestamptz;
alter table public.user_info add column if not exists relevance_started_at timestamptz;

comment on column public.job_postings.matching_started_at is
  'When the current (or last) matching run started: set on every move into progress. Read through isMatchingInProgress / run_in_progress.';
comment on column public.user_info.relevance_started_at is
  'When the current (or last) relevant-jobs run started: set on every move into progress. Read through isRelevanceInProgress / run_in_progress.';

-- ------------------------------------------------------------- the stamps

create or replace function public.stamp_matching_started_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.matching_status = 'progress'
     and (tg_op = 'INSERT' or old.matching_status is distinct from 'progress') then
    new.matching_started_at := now();
  end if;
  return new;
end $$;

drop trigger if exists job_postings_stamp_matching_started_at on public.job_postings;
create trigger job_postings_stamp_matching_started_at
  before insert or update of matching_status on public.job_postings
  for each row execute function public.stamp_matching_started_at();

create or replace function public.stamp_relevance_started_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.relevant_jobs_update_status = 'progress'
     and (tg_op = 'INSERT' or old.relevant_jobs_update_status is distinct from 'progress') then
    new.relevance_started_at := now();
  end if;
  return new;
end $$;

drop trigger if exists user_info_stamp_relevance_started_at on public.user_info;
create trigger user_info_stamp_relevance_started_at
  before insert or update of relevant_jobs_update_status on public.user_info
  for each row execute function public.stamp_relevance_started_at();

-- ------------------------------------------------------- the one reading

-- A live run: `progress` that started less than p_timeout_seconds ago. Rows
-- from before the start columns fall back to updated_at; a `progress` row
-- with neither is dead.
create or replace function public.run_in_progress(
  p_status public.job_posting_matching_status,
  p_started_at timestamptz,
  p_updated_at timestamptz,
  p_timeout_seconds integer
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_status = 'progress'
     and coalesce(p_started_at, p_updated_at) is not null
     and coalesce(p_started_at, p_updated_at) > now() - make_interval(secs => p_timeout_seconds)
$$;

-- ---------------------------------------------------------------- starts

create or replace function public.start_matching(
  p_job_id uuid,
  p_timeout_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.job_postings%rowtype;
begin
  select * into v_post from public.job_postings where id = p_job_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  -- A session caller needs matching.run for the job; the service role (the
  -- weekly enqueue) starts any.
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_company_permission(v_post.company_id, 'matching.run', v_post.id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if public.run_in_progress(v_post.matching_status, v_post.matching_started_at, v_post.updated_at, p_timeout_seconds) then
    return jsonb_build_object('ok', false, 'reason', 'in_progress');
  end if;

  update public.job_postings
     set matching_status = 'progress',
         matching_error = null,
         matching_started_at = now(),
         updated_at = now()
   where id = v_post.id;

  return jsonb_build_object('ok', true, 'company_id', v_post.company_id, 'started_at', now());
end $$;

revoke all on function public.start_matching(uuid, integer) from public, anon;
grant execute on function public.start_matching(uuid, integer) to authenticated, service_role;

create or replace function public.start_relevance(
  p_user_id uuid,
  p_timeout_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.user_info%rowtype;
begin
  -- A session caller starts only their own run.
  if coalesce(auth.role(), '') <> 'service_role' and p_user_id is distinct from auth.uid() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into v_profile from public.user_info where user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'profile_not_found');
  end if;
  if public.run_in_progress(v_profile.relevant_jobs_update_status, v_profile.relevance_started_at, v_profile.updated_at, p_timeout_seconds) then
    return jsonb_build_object('ok', false, 'reason', 'in_progress');
  end if;

  update public.user_info
     set relevant_jobs_update_status = 'progress',
         relevance_started_at = now(),
         updated_at = now()
   where user_id = p_user_id;

  return jsonb_build_object('ok', true, 'started_at', now());
end $$;

revoke all on function public.start_relevance(uuid, integer) from public, anon;
grant execute on function public.start_relevance(uuid, integer) to authenticated, service_role;

-- ------------------------------------- the onboarding starters read the start

-- As in 20261108140000_onboarding_resubmit_guard.sql, with the live-run check
-- through run_in_progress and the start set on a restart.
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
    and public.run_in_progress(v_profile.relevant_jobs_update_status, v_profile.relevance_started_at,
                               v_profile.updated_at, p_stale_seconds);

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
         relevance_started_at = case when v_running then u.relevance_started_at else now() end,
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
  v_profile public.user_info%rowtype;
begin
  select * into v_profile
    from public.user_info
   where user_id = p_user_id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'profile_not_found');
  end if;
  if not v_profile.filled then
    return jsonb_build_object('ok', false, 'reason', 'not_onboarded');
  end if;
  if public.run_in_progress(v_profile.relevant_jobs_update_status, v_profile.relevance_started_at,
                            v_profile.updated_at, p_stale_seconds) then
    update public.user_info
       set profile_refresh_requested_at = now()
     where user_id = p_user_id;
    return jsonb_build_object('ok', true, 'queued', false, 'deferred', true);
  end if;

  update public.user_info
     set relevant_jobs_update_status = 'progress',
         relevance_started_at = now(),
         updated_at = now()
   where user_id = p_user_id;

  perform pgmq.send(
    'onboarding_pipeline',
    jsonb_build_object('userId', p_user_id, 'shouldParse', false)
  );

  return jsonb_build_object('ok', true, 'queued', true);
end $$;
