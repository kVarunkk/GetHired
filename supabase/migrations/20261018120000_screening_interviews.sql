-- Recruiter screening interviews (plan/feature-recruiter-screening-interview-spec.md,
-- tasks in plan/feature-recruiter-screening-interview-tasks.md).
--
-- Tests: supabase/tests/screening_interviews.sql.

-- ---------------------------------------------------------------------------
-- 1. Permissions (SIT-004): interviews.view, interviews.manage
-- ---------------------------------------------------------------------------

insert into public.company_permissions (key, scopable, requires) values
  ('interviews.view', true, '{applicants.view}'),
  ('interviews.manage', true, '{interviews.view}')
on conflict (key) do update set scopable = excluded.scopable, requires = excluded.requires;

-- The Admin template has every permission but company.profile (RP-REQ-004).
insert into public.company_role_permissions (role_id, permission_key, scope)
select r.id, k.key, 'all'
  from public.company_roles r
  cross join (values ('interviews.view'), ('interviews.manage')) as k(key)
 where r.template_key = 'admin'
on conflict do nothing;

-- The Member template can read interview reports, not run interviews.
insert into public.company_role_permissions (role_id, permission_key, scope)
select r.id, 'interviews.view', 'all'
  from public.company_roles r
 where r.template_key = 'member'
on conflict do nothing;

-- New companies get the same Member keys (helpers/companies/role-templates.ts).
create or replace function public.seed_company_roles(p_company_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_admin uuid;
  v_member uuid;
begin
  select id into v_admin from public.company_roles
   where company_id = p_company_id and template_key = 'admin' order by created_at limit 1;
  if v_admin is null then
    insert into public.company_roles (company_id, name, description, color, template_key)
    values (p_company_id, 'Admin', 'Everything except billing management and owner changes.', 'indigo', 'admin')
    on conflict do nothing
    returning id into v_admin;
    if v_admin is not null then
      insert into public.company_role_permissions (role_id, permission_key, scope)
      select v_admin, p.key, 'all' from public.company_permissions p where p.key <> 'company.profile';
    end if;
  end if;

  select id into v_member from public.company_roles
   where company_id = p_company_id and template_key = 'member' order by created_at limit 1;
  if v_member is null then
    insert into public.company_roles (company_id, name, description, color, template_key)
    values (p_company_id, 'Member', 'Works with applicants, talent and outreach across every job.', 'slate', 'member')
    on conflict do nothing
    returning id into v_member;
    if v_member is not null then
      insert into public.company_role_permissions (role_id, permission_key, scope)
      select v_member, k, 'all'
        from unnest(
          -- @member-keys (helpers/companies/role-templates.ts MEMBER_KEYS)
          array['jobs.view', 'applicants.view', 'pipeline.move', 'applicants.screen',
                'interviews.view', 'notes.view', 'notes.write', 'talent.view', 'talent.save',
                'talent_lists.manage', 'matching.run', 'outreach.view', 'outreach.send',
                'agent.use', 'team.view', 'roles.view', 'billing.view']
        ) k;
    end if;
  end if;

  update public.company_info set default_role_id = v_member
   where id = p_company_id and default_role_id is null and v_member is not null;
end $$;

revoke all on function public.seed_company_roles(uuid) from public, anon, authenticated;
grant execute on function public.seed_company_roles(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Tables (spec §2.1, SIT-022)
-- ---------------------------------------------------------------------------

-- A job's interview setup. company_id is always the job's company (set by
-- the trigger in section 3), so a config can't point at another company's job.
create table if not exists public.job_interview_configs (
  job_post_id uuid primary key references public.job_postings(id) on delete cascade,
  company_id uuid not null references public.company_info(id) on delete cascade,
  enabled boolean not null default false,
  invite_rule text not null default 'fit_threshold'
    check (invite_rule in ('fit_threshold', 'manual')),
  fit_threshold smallint default 70 check (fit_threshold between 0 and 100),
  questions jsonb not null default '[]'::jsonb,      -- [{ text }], ≤ 8
  competencies jsonb not null default '[]'::jsonb,   -- [{ name, description }], 1–5 when enabled
  duration_minutes smallint not null default 15 check (duration_minutes in (10, 15, 20)),
  deadline_days smallint not null default 5 check (deadline_days between 3 and 14),
  language text not null default 'en' check (language in ('en')),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (invite_rule <> 'fit_threshold' or fit_threshold is not null),
  check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) <= 8),
  check (jsonb_typeof(competencies) = 'array' and jsonb_array_length(competencies) <= 5),
  check (not enabled or jsonb_array_length(competencies) >= 1)
);
create index if not exists job_interview_configs_company_idx on public.job_interview_configs (company_id);

-- One screening interview per application (SI-REQ-011). Written only by the
-- functions in section 5 and the service role.
create table if not exists public.application_interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.applications(id) on delete cascade,
  job_post_id uuid not null references public.job_postings(id) on delete cascade,
  company_id uuid not null references public.company_info(id) on delete cascade,
  applicant_user_id uuid not null references auth.users(id) on delete cascade,
  interview_id uuid unique references public.interviews(id) on delete set null,
  -- questions, competencies, duration_minutes, deadline_days, language, company_name, job_title
  config_snapshot jsonb not null,
  status text not null default 'invited' check (status in
    ('invited', 'in_progress', 'completed', 'expired', 'declined', 'cancelled', 'withdrawn', 'paused')),
  invited_via text not null check (invited_via in ('fit_threshold', 'manual', 'agent')),
  invited_by uuid references auth.users(id) on delete set null,
  deadline_at timestamptz not null,
  deadline_extensions smallint not null default 0 check (deadline_extensions between 0 and 2),
  max_attempts smallint not null default 2 check (max_attempts between 1 and 3),
  attempts_used smallint not null default 0 check (attempts_used >= 0),
  attempt_granted boolean not null default false,   -- grant_attempt works once
  consented_at timestamptz,
  consent_version text check (char_length(consent_version) <= 40),
  credits_cost smallint not null check (credits_cost > 0),  -- interview_minutes held at invite
  credits_charged boolean not null default false,
  accommodation_request text check (char_length(accommodation_request) <= 500),
  paused_at timestamptz,                             -- the deadline doesn't run while paused
  reminder_sent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (attempts_used <= max_attempts),
  check ((status = 'paused') = (paused_at is not null))
);
create index if not exists application_interviews_company_status_idx
  on public.application_interviews (company_id, status);
create index if not exists application_interviews_job_status_idx
  on public.application_interviews (job_post_id, status);
create index if not exists application_interviews_applicant_status_idx
  on public.application_interviews (applicant_user_id, status);
create index if not exists application_interviews_deadline_idx
  on public.application_interviews (status, deadline_at) where status in ('invited', 'paused');

-- ---------------------------------------------------------------------------
-- 3. Changes to interviews, interview_sessions and application_events (§2.2)
-- ---------------------------------------------------------------------------

alter table public.interviews
  add column if not exists kind text not null default 'practice',
  add column if not exists application_interview_id uuid unique
    references public.application_interviews(id) on delete cascade;
alter table public.interviews drop constraint if exists interviews_kind_check;
alter table public.interviews add constraint interviews_kind_check
  check (kind in ('practice', 'screening'));
alter table public.interviews drop constraint if exists interviews_kind_link_check;
alter table public.interviews add constraint interviews_kind_link_check
  check ((kind = 'screening') = (application_interview_id is not null));

alter table public.interview_sessions
  add column if not exists end_reason text,
  add column if not exists transcript_source text not null default 'client',
  add column if not exists duration_seconds integer;
alter table public.interview_sessions drop constraint if exists interview_sessions_end_reason_check;
alter table public.interview_sessions add constraint interview_sessions_end_reason_check
  check (end_reason in ('completed', 'time_limit', 'inactivity', 'client_disconnect', 'error', 'no_callback'));
alter table public.interview_sessions drop constraint if exists interview_sessions_transcript_source_check;
alter table public.interview_sessions add constraint interview_sessions_transcript_source_check
  check (transcript_source in ('client', 'server'));
alter table public.interview_sessions drop constraint if exists interview_sessions_duration_check;
alter table public.interview_sessions add constraint interview_sessions_duration_check
  check (duration_seconds >= 0);

-- SI-SEC-002 backstop: a client can't create a screening interview, turn a
-- practice one into one, or re-point a screening one. Not security definer,
-- so current_user is the client's role on a direct write and the function
-- owner inside the functions below.
create or replace function public.interviews_guard_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.kind is distinct from 'practice' or new.application_interview_id is not null then
      raise exception using errcode = 'P0001', message = 'INTERVIEW_KIND_READ_ONLY';
    end if;
  elsif new.kind is distinct from old.kind
     or new.application_interview_id is distinct from old.application_interview_id
     or (old.kind = 'screening' and (new.job_id is distinct from old.job_id
                                  or new.resume_id is distinct from old.resume_id
                                  or new.user_id is distinct from old.user_id)) then
    raise exception using errcode = 'P0001', message = 'INTERVIEW_KIND_READ_ONLY';
  end if;
  return new;
end $$;

revoke all on function public.interviews_guard_kind() from public, anon, authenticated;

drop trigger if exists interviews_guard_kind on public.interviews;
create trigger interviews_guard_kind
  before insert or update on public.interviews
  for each row execute function public.interviews_guard_kind();

-- The job's company, the timestamps and the editor, whatever the client sent.
create or replace function public.job_interview_configs_set_company()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  select jp.company_id into new.company_id from public.job_postings jp where jp.id = new.job_post_id;
  if new.company_id is null then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end $$;

revoke all on function public.job_interview_configs_set_company() from public, anon, authenticated;

drop trigger if exists job_interview_configs_set_company on public.job_interview_configs;
create trigger job_interview_configs_set_company
  before insert or update on public.job_interview_configs
  for each row execute function public.job_interview_configs_set_company();

-- SI-REQ-034, plus the logged company actions (SI-REQ-015).
alter table public.application_events drop constraint if exists application_events_type_check;
alter table public.application_events add constraint application_events_type_check check (type in (
  'applied', 'stage_changed', 'email_sent', 'note_added', 'screened', 'outreach_sent', 'outreach_replied',
  'interview_invited', 'interview_started', 'interview_completed', 'interview_expired',
  'interview_declined', 'interview_cancelled', 'interview_accommodation_requested',
  'interview_extended', 'interview_attempt_granted'
));

-- ---------------------------------------------------------------------------
-- 4. RLS (spec §2.3, with the roles spec's permissions)
-- ---------------------------------------------------------------------------

alter table public.job_interview_configs enable row level security;
alter table public.application_interviews enable row level security;

revoke all on public.job_interview_configs from anon, authenticated;
grant select, insert, update, delete on public.job_interview_configs to authenticated;
grant all on public.job_interview_configs to service_role;

-- Applicants read their interviews through my_screening_interviews(), which
-- leaves out the questions and the competency descriptions (SI-REQ-020).
revoke all on public.application_interviews from anon, authenticated;
grant select on public.application_interviews to authenticated;
grant all on public.application_interviews to service_role;

drop policy if exists "job_interview_configs_select_company" on public.job_interview_configs;
create policy "job_interview_configs_select_company" on public.job_interview_configs
  for select to authenticated
  using (job_post_id = any ((select public.my_job_ids_with('interviews.view'))::uuid[]));

drop policy if exists "job_interview_configs_insert_company" on public.job_interview_configs;
create policy "job_interview_configs_insert_company" on public.job_interview_configs
  for insert to authenticated
  with check (public.has_company_permission(company_id, 'interviews.manage', job_post_id)
          and public.has_company_permission(company_id, 'jobs.edit', job_post_id));

drop policy if exists "job_interview_configs_update_company" on public.job_interview_configs;
create policy "job_interview_configs_update_company" on public.job_interview_configs
  for update to authenticated
  using (public.has_company_permission(company_id, 'interviews.manage', job_post_id)
     and public.has_company_permission(company_id, 'jobs.edit', job_post_id))
  with check (public.has_company_permission(company_id, 'interviews.manage', job_post_id)
          and public.has_company_permission(company_id, 'jobs.edit', job_post_id));

drop policy if exists "job_interview_configs_delete_company" on public.job_interview_configs;
create policy "job_interview_configs_delete_company" on public.job_interview_configs
  for delete to authenticated
  using (public.has_company_permission(company_id, 'interviews.manage', job_post_id)
     and public.has_company_permission(company_id, 'jobs.edit', job_post_id));

drop policy if exists "application_interviews_select_company" on public.application_interviews;
create policy "application_interviews_select_company" on public.application_interviews
  for select to authenticated
  using (job_post_id = any ((select public.my_job_ids_with('interviews.view'))::uuid[]));

-- interviews: the live policies, recreated by name so this migration is
-- their record (SIT-000 findings). Candidates keep full control of practice
-- interviews; screening ones are read-only to them.
drop policy if exists "Enable users to view their own data only" on public.interviews;
create policy "Enable users to view their own data only" on public.interviews
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Enable insert for users based on user_id" on public.interviews;
create policy "Enable insert for users based on user_id" on public.interviews
  for insert to authenticated
  with check ((select auth.uid()) = user_id and kind = 'practice' and application_interview_id is null);

drop policy if exists "update own data" on public.interviews;
create policy "update own data" on public.interviews
  for update to authenticated
  using ((select auth.uid()) = user_id and kind = 'practice')
  with check ((select auth.uid()) = user_id and kind = 'practice' and application_interview_id is null);

drop policy if exists "Enable delete for users based on user_id" on public.interviews;
create policy "Enable delete for users based on user_id" on public.interviews
  for delete to authenticated
  using ((select auth.uid()) = user_id and kind = 'practice');

drop policy if exists "interviews_select_company_screening" on public.interviews;
create policy "interviews_select_company_screening" on public.interviews
  for select to authenticated
  using (kind = 'screening' and exists (
    select 1 from public.application_interviews ai
     where ai.id = interviews.application_interview_id
       and ai.job_post_id = any ((select public.my_job_ids_with('interviews.view'))::uuid[])
  ));

-- interview_sessions: candidates insert and update practice sessions only
-- (SI-SEC-001). Screening sessions are inserted by start_screening_attempt
-- and written by finish_screening_session.
drop policy if exists "Candidates can create their interview sessions" on public.interview_sessions;
create policy "Candidates can create their interview sessions"
  on public.interview_sessions for insert to authenticated
  with check (
    transcript_source = 'client'
    and exists (
      select 1 from public.interviews i
       where i.id = interview_sessions.interview_id
         and i.user_id = (select auth.uid()) and i.kind = 'practice'
    )
  );

drop policy if exists "Candidates can update their interview session transcripts" on public.interview_sessions;
create policy "Candidates can update their interview session transcripts"
  on public.interview_sessions for update to authenticated
  using (exists (
    select 1 from public.interviews i
     where i.id = interview_sessions.interview_id
       and i.user_id = (select auth.uid()) and i.kind = 'practice'
  ))
  with check (
    transcript_source = 'client'
    and exists (
      select 1 from public.interviews i
       where i.id = interview_sessions.interview_id
         and i.user_id = (select auth.uid()) and i.kind = 'practice'
    )
  );

drop policy if exists "interview_sessions_select_company_screening" on public.interview_sessions;
create policy "interview_sessions_select_company_screening"
  on public.interview_sessions for select to authenticated
  using (exists (
    select 1 from public.interviews i
      join public.application_interviews ai on ai.id = i.application_interview_id
     where i.id = interview_sessions.interview_id
       and ai.job_post_id = any ((select public.my_job_ids_with('interviews.view'))::uuid[])
  ));

-- interview_analyses: the candidate policy is already perspective =
-- 'candidate' (20261016170000_application_attachments.sql). Companies read the
-- company report of their screening sessions.
drop policy if exists "interview_analyses_select_company_screening" on public.interview_analyses;
create policy "interview_analyses_select_company_screening"
  on public.interview_analyses for select to authenticated
  using (perspective = 'company' and exists (
    select 1 from public.interview_sessions s
      join public.interviews i on i.id = s.interview_id
      join public.application_interviews ai on ai.id = i.application_interview_id
     where s.id = interview_analyses.interview_session_id
       and ai.job_post_id = any ((select public.my_job_ids_with('interviews.view'))::uuid[])
  ));

-- ---------------------------------------------------------------------------
-- 5. Lifecycle functions (spec §2.4)
-- ---------------------------------------------------------------------------
-- They return jsonb { ok: true, ... } or { ok: false, reason }, like the
-- member RPCs, so the actions can map reasons to copy.

-- An application_events row for an interview. Internal.
create or replace function public.log_screening_event(
  p_interview public.application_interviews, p_type text, p_actor uuid, p_payload jsonb default '{}'::jsonb
)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.application_events
    (company_id, application_id, candidate_user_id, actor_user_id, actor_name, type, payload)
  values (
    p_interview.company_id, p_interview.application_id, p_interview.applicant_user_id, p_actor,
    case when p_actor is null then null else public.member_display_name(p_actor) end,
    p_type,
    jsonb_build_object('application_interview_id', p_interview.id) || coalesce(p_payload, '{}'::jsonb)
  )
$$;

-- Candidate answers and interviewer turns, counted the way
-- finalize_interview_analysis_session counts them.
create or replace function public.screening_turn_counts(p_turns jsonb, out answers int, out questions int)
language sql immutable
set search_path = ''
as $$
  select
    (count(*) filter (where nullif(btrim(t ->> 'user'), '') is not null))::int,
    (count(*) filter (where nullif(btrim(t ->> 'assistant'), '') is not null))::int
  from jsonb_array_elements(case when jsonb_typeof(p_turns) = 'array' then p_turns else '[]'::jsonb end) t
$$;

create or replace function public.release_screening_hold(p_interview public.application_interviews)
returns void
language sql security definer
set search_path = ''
as $$
  select public.release_hold(p_interview.company_id, 'application_interview', p_interview.id::text, 'interview_minutes');
$$;

-- SI-REQ-010/012. Service role only: the fit-threshold hook in the MT worker,
-- and the invite action after requireCompanyForAction.
create or replace function public.create_screening_invite(
  p_application_id uuid, p_via text, p_invited_by uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_job public.job_postings%rowtype;
  v_config public.job_interview_configs%rowtype;
  v_row public.application_interviews%rowtype;
  v_company_name text;
  v_id uuid := gen_random_uuid();
  v_interview uuid := gen_random_uuid();
  v_hold jsonb;
begin
  if p_via is null or p_via not in ('fit_threshold', 'manual', 'agent') then
    raise exception 'invalid invite source: %', p_via using errcode = 'invalid_parameter_value';
  end if;

  select * into v_app from public.applications where id = p_application_id;
  if not found or v_app.applicant_user_id is null or v_app.job_post_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_applicant');
  end if;

  select * into v_job from public.job_postings where id = v_app.job_post_id;
  if p_invited_by is not null and not exists (
    select 1 from public.company_members m where m.company_id = v_job.company_id and m.user_id = p_invited_by
  ) then
    raise exception 'the inviter isn''t a member of the job''s company' using errcode = 'insufficient_privilege';
  end if;

  -- Locked so a config edit can't race the snapshot.
  select * into v_config from public.job_interview_configs where job_post_id = v_job.id for update;
  if not found or not v_config.enabled then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;
  if p_via = 'fit_threshold' and v_config.invite_rule <> 'fit_threshold' then
    return jsonb_build_object('ok', false, 'reason', 'manual_only');
  end if;
  if v_job.status is distinct from 'active' then
    return jsonb_build_object('ok', false, 'reason', 'job_inactive');
  end if;
  if exists (select 1 from public.application_interviews where application_id = v_app.id) then
    return jsonb_build_object('ok', false, 'reason', 'exists');
  end if;

  select name into v_company_name from public.company_info where id = v_job.company_id;

  begin
    insert into public.application_interviews (
      id, application_id, job_post_id, company_id, applicant_user_id, config_snapshot, status,
      invited_via, invited_by, deadline_at, credits_cost
    ) values (
      v_id, v_app.id, v_job.id, v_job.company_id, v_app.applicant_user_id,
      jsonb_build_object(
        'questions', v_config.questions,
        'competencies', v_config.competencies,
        'duration_minutes', v_config.duration_minutes,
        'deadline_days', v_config.deadline_days,
        'language', v_config.language,
        'company_name', v_company_name,
        'job_title', v_job.title
      ),
      'invited', p_via, p_invited_by, now() + make_interval(days => v_config.deadline_days),
      v_config.duration_minutes
    );

    -- The hold outlives the deadline, its two extensions and a pause.
    v_hold := public.hold_entitlement(
      v_job.company_id, 'interview_minutes', v_config.duration_minutes::int,
      'application_interview', v_id::text, now() + interval '120 days', p_invited_by
    );
    if not coalesce((v_hold ->> 'ok')::boolean, false) then
      raise exception using errcode = 'P0001', message = 'HOLD_FAILED';
    end if;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'reason', 'exists');
    when sqlstate 'P0001' then
      if sqlerrm <> 'HOLD_FAILED' then raise; end if;
      return jsonb_build_object(
        'ok', false,
        'reason', case when v_hold ->> 'reason' = 'member_limit' then 'member_limit' else 'insufficient_credits' end,
        'credits_needed', coalesce((v_hold ->> 'credits_needed')::int, 0),
        'limit', v_hold -> 'limit',
        'used', v_hold -> 'used'
      );
  end;

  insert into public.interviews (id, user_id, job_id, resume_id, name, kind, application_interview_id)
  values (v_interview, v_app.applicant_user_id, v_job.job_id, v_app.resume_id, v_job.title, 'screening', v_id);
  update public.application_interviews set interview_id = v_interview where id = v_id
  returning * into v_row;

  perform public.log_screening_event(v_row, 'interview_invited', p_invited_by, jsonb_build_object(
    'via', p_via, 'duration_minutes', v_row.credits_cost, 'deadline_at', v_row.deadline_at
  ));

  return jsonb_build_object(
    'ok', true, 'id', v_id, 'interview_id', v_interview,
    'deadline_at', v_row.deadline_at, 'duration_minutes', v_row.credits_cost
  );
end $$;

-- The caller's screening interviews, without the questions and the
-- competency descriptions (SI-REQ-020).
create or replace function public.my_screening_interviews()
returns table (
  id uuid, application_id uuid, job_post_id uuid, interview_id uuid, status text,
  deadline_at timestamptz, max_attempts smallint, attempts_used smallint,
  consented_at timestamptz, consent_version text, completed_at timestamptz, created_at timestamptz,
  company_name text, job_title text, duration_minutes int, competency_names text[]
)
language sql stable security definer
set search_path = ''
as $$
  select ai.id, ai.application_id, ai.job_post_id, ai.interview_id, ai.status,
         ai.deadline_at, ai.max_attempts, ai.attempts_used,
         ai.consented_at, ai.consent_version, ai.completed_at, ai.created_at,
         ai.config_snapshot ->> 'company_name', ai.config_snapshot ->> 'job_title',
         (ai.config_snapshot ->> 'duration_minutes')::int,
         array(select c ->> 'name' from jsonb_array_elements(ai.config_snapshot -> 'competencies') c)
    from public.application_interviews ai
   where ai.applicant_user_id = (select auth.uid())
$$;

-- The caller's own interview, locked. All columns null when it isn't theirs.
create or replace function public.lock_my_screening_interview(p_id uuid)
returns public.application_interviews
language sql security definer
set search_path = ''
as $$
  select * from public.application_interviews
   where id = p_id and applicant_user_id = (select auth.uid())
   for update
$$;

create or replace function public.record_screening_consent(p_id uuid, p_version text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.application_interviews%rowtype;
begin
  if p_version is null or btrim(p_version) = '' or char_length(p_version) > 40 then
    raise exception 'invalid consent version' using errcode = 'invalid_parameter_value';
  end if;
  v_row := public.lock_my_screening_interview(p_id);
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_row.status <> 'invited' then
    return jsonb_build_object('ok', false, 'reason', 'not_invited');
  end if;
  update public.application_interviews
     set consented_at = now(), consent_version = p_version, updated_at = now()
   where id = v_row.id;
  return jsonb_build_object('ok', true);
end $$;

-- Why an attempt can't start now, or null (SI-REQ-021).
create or replace function public.screening_start_refusal(p_row public.application_interviews)
returns text
language sql stable
set search_path = ''
as $$
  select case
    when p_row.id is null or p_row.interview_id is null then 'not_found'
    when p_row.status <> 'invited' then 'not_invited'
    when p_row.deadline_at <= now() then 'expired'
    when p_row.consented_at is null then 'no_consent'
    when p_row.attempts_used >= p_row.max_attempts then 'no_attempts'
  end
$$;

-- SI-REQ-021, step 1: reserve_interview_session's 90-second lock on the
-- linked interview. Doesn't use up an attempt.
create or replace function public.reserve_screening_attempt(p_id uuid, p_reservation_id text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.application_interviews%rowtype;
  v_refusal text;
begin
  if p_reservation_id is null or btrim(p_reservation_id) = '' then
    raise exception 'Reservation ID is required' using errcode = 'invalid_parameter_value';
  end if;
  v_row := public.lock_my_screening_interview(p_id);
  v_refusal := public.screening_start_refusal(v_row);
  if v_refusal is not null then
    return jsonb_build_object('ok', false, 'reason', v_refusal);
  end if;

  update public.interviews
     set active_session_id = p_reservation_id, active_session_updated_at = now()
   where id = v_row.interview_id
     and (active_session_id is null
          or active_session_updated_at is null
          or active_session_updated_at <= now() - interval '90 seconds');
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'active_session');
  end if;

  return jsonb_build_object('ok', true, 'interview_id', v_row.interview_id);
end $$;

-- SI-REQ-021, step 2: swaps the reservation for the voice session, uses up
-- an attempt and inserts the server-recorded session.
create or replace function public.start_screening_attempt(
  p_id uuid, p_reservation_id text, p_voice_session_id text
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.application_interviews%rowtype;
  v_refusal text;
  v_session uuid;
begin
  if p_voice_session_id is null or btrim(p_voice_session_id) = '' then
    raise exception 'Voice session ID is required' using errcode = 'invalid_parameter_value';
  end if;
  v_row := public.lock_my_screening_interview(p_id);
  v_refusal := public.screening_start_refusal(v_row);
  if v_refusal is not null then
    return jsonb_build_object('ok', false, 'reason', v_refusal);
  end if;

  update public.interviews
     set active_session_id = p_voice_session_id, active_session_updated_at = now()
   where id = v_row.interview_id
     and active_session_id = p_reservation_id
     and active_session_updated_at > now() - interval '90 seconds';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'reservation_expired');
  end if;

  insert into public.interview_sessions (interview_id, voice_session_id, transcript_source)
  values (v_row.interview_id, p_voice_session_id, 'server')
  returning id into v_session;

  update public.application_interviews
     set attempts_used = attempts_used + 1, status = 'in_progress', updated_at = now()
   where id = v_row.id
  returning * into v_row;

  perform public.log_screening_event(v_row, 'interview_started', null, jsonb_build_object(
    'attempt', v_row.attempts_used, 'session_id', v_session
  ));

  return jsonb_build_object('ok', true, 'session_id', v_session, 'interview_id', v_row.interview_id);
end $$;

-- SI-REQ-024. Service role only (the transcript callback and the sweeper).
-- Idempotent: a session that's no longer active returns what was stored.
create or replace function public.finish_screening_session(
  p_session_id uuid, p_turns jsonb, p_end_reason text, p_duration_seconds integer default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_session public.interview_sessions%rowtype;
  v_kind text;
  v_row public.application_interviews%rowtype;
  v_turns jsonb := case when jsonb_typeof(p_turns) = 'array' then p_turns else '[]'::jsonb end;
  v_answers int;
  v_questions int;
  v_technical boolean;
  v_retry boolean := false;
  v_analysis uuid;
  v_charge jsonb;
begin
  if p_end_reason is null or p_end_reason not in
     ('completed', 'time_limit', 'inactivity', 'client_disconnect', 'error', 'no_callback') then
    raise exception 'invalid end reason: %', p_end_reason using errcode = 'invalid_parameter_value';
  end if;

  select s.* into v_session from public.interview_sessions s where s.id = p_session_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select i.kind into v_kind from public.interviews i where i.id = v_session.interview_id;
  if v_kind is distinct from 'screening' then
    return jsonb_build_object('ok', true, 'status', 'ignored');
  end if;
  select ai.* into v_row from public.application_interviews ai
    join public.interviews i on i.application_interview_id = ai.id
   where i.id = v_session.interview_id
   for update of ai;

  if v_session.status <> 'active' then
    select a.id into v_analysis from public.interview_analyses a
     where a.interview_session_id = v_session.id and a.perspective = 'company';
    return jsonb_build_object('ok', true, 'status', 'already_recorded',
      'session_status', v_session.status, 'interview_status', v_row.status, 'analysis_id', v_analysis);
  end if;

  select c.answers, c.questions into v_answers, v_questions from public.screening_turn_counts(v_turns) c;
  update public.interview_sessions
     set turns = v_turns,
         end_reason = p_end_reason,
         duration_seconds = case when p_duration_seconds is null then null else greatest(p_duration_seconds, 0) end,
         status = case when v_answers >= 3 and v_questions >= 3 then 'completed' else 'ineligible' end,
         ended_at = now(),
         updated_at = now()
   where id = v_session.id
  returning * into v_session;

  -- The interview lock, if it's still this session's.
  update public.interviews
     set active_session_id = null, active_session_updated_at = null
   where id = v_session.interview_id and active_session_id = v_session.voice_session_id;

  v_technical := p_end_reason in ('client_disconnect', 'error', 'no_callback');
  -- A technical end before the candidate said anything isn't an attempt.
  if v_technical and v_answers = 0 then
    v_row.attempts_used := greatest(v_row.attempts_used - 1, 0);
  end if;

  if v_row.status <> 'in_progress' then
    -- Cancelled while the session ran: keep the transcript, change nothing else.
    update public.application_interviews set attempts_used = v_row.attempts_used, updated_at = now()
     where id = v_row.id returning * into v_row;
  elsif v_technical and v_row.attempts_used < v_row.max_attempts then
    v_retry := true;
    update public.application_interviews
       set status = 'invited', attempts_used = v_row.attempts_used, updated_at = now()
     where id = v_row.id returning * into v_row;
  else
    if v_session.status = 'completed' then
      v_charge := public.consume_entitlement(
        v_row.company_id, 'interview_minutes', v_row.credits_cost::int,
        'application_interview', v_row.id::text, null
      );
      insert into public.interview_analyses (interview_session_id, perspective, status)
      values (v_session.id, 'company', 'queued')
      on conflict (interview_session_id, perspective) do nothing
      returning id into v_analysis;
      if v_analysis is not null then
        perform pgmq.send('interview_analysis_queue', jsonb_build_object('analysisId', v_analysis));
      end if;
    else
      -- Nothing to score ("Interview incomplete"): never charged.
      perform public.release_screening_hold(v_row);
    end if;

    update public.application_interviews
       set status = 'completed', attempts_used = v_row.attempts_used, completed_at = now(),
           credits_charged = credits_charged or coalesce((v_charge ->> 'ok')::boolean, false),
           updated_at = now()
     where id = v_row.id returning * into v_row;

    perform public.log_screening_event(v_row, 'interview_completed', null, jsonb_build_object(
      'session_id', v_session.id, 'end_reason', p_end_reason, 'scored', v_session.status = 'completed'
    ));
  end if;

  return jsonb_build_object('ok', true, 'status', 'recorded',
    'session_status', v_session.status, 'interview_status', v_row.status,
    'retry', v_retry, 'analysis_id', v_analysis);
end $$;

-- SI-REQ-016: the applicant declines without withdrawing the application.
create or replace function public.decline_screening_interview(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.application_interviews%rowtype;
begin
  v_row := public.lock_my_screening_interview(p_id);
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_row.status <> 'invited' then
    return jsonb_build_object('ok', false, 'reason', 'not_invited');
  end if;
  update public.application_interviews set status = 'declined', updated_at = now()
   where id = v_row.id returning * into v_row;
  perform public.release_screening_hold(v_row);
  perform public.log_screening_event(v_row, 'interview_declined', null);
  return jsonb_build_object('ok', true);
end $$;

-- SI-REQ-026: pauses the deadline until the company extends, waives or cancels.
create or replace function public.request_screening_accommodation(p_id uuid, p_text text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.application_interviews%rowtype;
  v_text text := btrim(coalesce(p_text, ''));
begin
  if v_text = '' or char_length(v_text) > 500 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_text');
  end if;
  v_row := public.lock_my_screening_interview(p_id);
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_row.status <> 'invited' then
    return jsonb_build_object('ok', false, 'reason', 'not_invited');
  end if;
  update public.application_interviews
     set status = 'paused', paused_at = now(), accommodation_request = v_text, updated_at = now()
   where id = v_row.id returning * into v_row;
  perform public.log_screening_event(v_row, 'interview_accommodation_requested', null);
  return jsonb_build_object('ok', true);
end $$;

-- SI-REQ-015/026: cancel, extend, grant_attempt and waive. Needs
-- interviews.manage on the job; the company comes from the interview.
create or replace function public.manage_screening_interview(p_id uuid, p_action text, p_days integer default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.application_interviews%rowtype;
  v_hold jsonb;
  v_days int;
begin
  select * into v_row from public.application_interviews where id = p_id for update;
  if not found or not public.is_company_member(v_row.company_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.has_company_permission(v_row.company_id, 'interviews.manage', v_row.job_post_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_action = 'cancel' then
    if v_row.status not in ('invited', 'paused') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_status');
    end if;
    update public.application_interviews
       set status = 'cancelled', paused_at = null, updated_at = now()
     where id = v_row.id returning * into v_row;
    perform public.release_screening_hold(v_row);
    perform public.log_screening_event(v_row, 'interview_cancelled', v_uid);

  elsif p_action = 'waive' then
    -- The company advances the application without an interview.
    if v_row.status <> 'paused' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_status');
    end if;
    update public.application_interviews
       set status = 'cancelled', paused_at = null, updated_at = now()
     where id = v_row.id returning * into v_row;
    perform public.release_screening_hold(v_row);
    perform public.log_screening_event(v_row, 'interview_cancelled', v_uid, jsonb_build_object('waived', true));

  elsif p_action = 'extend' then
    if p_days is null or p_days not between 1 and 14 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_days');
    end if;
    if v_row.status not in ('invited', 'paused') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_status');
    end if;
    if v_row.deadline_extensions >= 2 then
      return jsonb_build_object('ok', false, 'reason', 'limit_reached');
    end if;
    -- Resuming from a pause gives back the paused time.
    update public.application_interviews
       set deadline_at = case when status = 'paused' then deadline_at + (now() - paused_at)
                              else greatest(deadline_at, now()) end
                         + make_interval(days => p_days),
           deadline_extensions = deadline_extensions + 1,
           status = 'invited', paused_at = null, updated_at = now()
     where id = v_row.id returning * into v_row;
    perform public.log_screening_event(v_row, 'interview_extended', v_uid, jsonb_build_object(
      'days', p_days, 'deadline_at', v_row.deadline_at
    ));

  elsif p_action = 'grant_attempt' then
    if v_row.attempt_granted or v_row.max_attempts >= 3 then
      return jsonb_build_object('ok', false, 'reason', 'limit_reached');
    end if;
    -- A scored interview was paid for and isn't redone for free.
    if not (v_row.status = 'invited' or (v_row.status = 'completed' and not v_row.credits_charged)) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_status');
    end if;
    if v_row.status = 'completed' then
      v_hold := public.hold_entitlement(
        v_row.company_id, 'interview_minutes', v_row.credits_cost::int,
        'application_interview', v_row.id::text, now() + interval '120 days', v_uid
      );
      if not coalesce((v_hold ->> 'ok')::boolean, false) then
        return jsonb_build_object('ok', false,
          'reason', case when v_hold ->> 'reason' = 'member_limit' then 'member_limit' else 'insufficient_credits' end,
          'credits_needed', coalesce((v_hold ->> 'credits_needed')::int, 0));
      end if;
    end if;
    v_days := coalesce((v_row.config_snapshot ->> 'deadline_days')::int, 5);
    update public.application_interviews
       set max_attempts = max_attempts + 1, attempt_granted = true, status = 'invited',
           completed_at = null,
           deadline_at = greatest(deadline_at, now() + make_interval(days => v_days)),
           updated_at = now()
     where id = v_row.id returning * into v_row;
    perform public.log_screening_event(v_row, 'interview_attempt_granted', v_uid, jsonb_build_object(
      'max_attempts', v_row.max_attempts, 'deadline_at', v_row.deadline_at
    ));

  else
    raise exception 'unknown action: %', p_action using errcode = 'invalid_parameter_value';
  end if;

  return jsonb_build_object('ok', true, 'status', v_row.status, 'deadline_at', v_row.deadline_at);
end $$;

-- SI-REQ-014. Cron: invited past the deadline becomes expired. Returns the
-- ids for the emails. Paused interviews don't expire.
create or replace function public.expire_screening_interviews()
returns uuid[]
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.application_interviews%rowtype;
  v_ids uuid[] := '{}';
begin
  for v_row in
    update public.application_interviews
       set status = 'expired', updated_at = now()
     where status = 'invited' and deadline_at <= now()
    returning *
  loop
    perform public.release_screening_hold(v_row);
    perform public.log_screening_event(v_row, 'interview_expired', null);
    v_ids := v_ids || v_row.id;
  end loop;
  return v_ids;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Practice functions refuse screening interviews (SIT-000 findings)
-- ---------------------------------------------------------------------------
-- Bodies as in 20261003005500, 20261006210000 and 20261016170000, plus a
-- kind = 'practice' check. Heartbeat and release work for both kinds.

CREATE OR REPLACE FUNCTION public.reserve_interview_session(
  p_interview_id uuid,
  p_reservation_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_active_session_id text;
  v_updated_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_reservation_id IS NULL OR btrim(p_reservation_id) = '' THEN
    RAISE EXCEPTION 'Reservation ID is required';
  END IF;

  SELECT i.active_session_id, i.active_session_updated_at
    INTO v_active_session_id, v_updated_at
    FROM public.interviews AS i
   WHERE i.id = p_interview_id
     AND i.user_id = auth.uid()
     AND i.kind = 'practice'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Interview not found or access denied';
  END IF;

  IF v_active_session_id IS NOT NULL
     AND v_updated_at IS NOT NULL
     AND v_updated_at > NOW() - INTERVAL '90 seconds' THEN
    RETURN 'already_active';
  END IF;

  UPDATE public.interviews
     SET active_session_id = p_reservation_id,
         active_session_updated_at = NOW()
   WHERE id = p_interview_id
     AND user_id = auth.uid();

  RETURN 'reserved';
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_interview_session(
  p_interview_id uuid,
  p_reservation_id text,
  p_session_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_session_id IS NULL OR btrim(p_session_id) = '' THEN
    RAISE EXCEPTION 'Voice session ID is required';
  END IF;

  UPDATE public.interviews
     SET active_session_id = p_session_id,
         active_session_updated_at = NOW()
   WHERE id = p_interview_id
     AND user_id = auth.uid()
     AND kind = 'practice'
     AND active_session_id = p_reservation_id
     AND active_session_updated_at > NOW() - INTERVAL '90 seconds';

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.deduct_interview_session_credits(
  p_interview_id uuid,
  p_session_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_charged_session_ids text[];
  v_active_session_id text;
  v_session_updated_at timestamptz;
  v_interview_credits CONSTANT integer := 10;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_session_id IS NULL OR btrim(p_session_id) = '' THEN
    RAISE EXCEPTION 'Voice session ID is required';
  END IF;

  SELECT
    i.charged_session_ids,
    i.active_session_id,
    i.active_session_updated_at
    INTO v_charged_session_ids, v_active_session_id, v_session_updated_at
    FROM public.interviews AS i
   WHERE i.id = p_interview_id
     AND i.user_id = auth.uid()
     AND i.kind = 'practice'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Interview not found or access denied';
  END IF;

  IF v_active_session_id IS DISTINCT FROM p_session_id
     OR v_session_updated_at IS NULL
     OR v_session_updated_at <= NOW() - INTERVAL '90 seconds' THEN
    RAISE EXCEPTION 'Interview session is not active';
  END IF;

  IF p_session_id = ANY(COALESCE(v_charged_session_ids, ARRAY[]::text[])) THEN
    RETURN 'already_charged';
  END IF;

  UPDATE public.user_info
     SET ai_credits = ai_credits - v_interview_credits,
         updated_at = NOW()
   WHERE user_id = auth.uid()
     AND ai_credits >= v_interview_credits;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient AI credits';
  END IF;

  UPDATE public.interviews
     SET charged_session_ids = array_append(
       COALESCE(v_charged_session_ids, ARRAY[]::text[]),
       p_session_id
     )
   WHERE id = p_interview_id
     AND user_id = auth.uid();

  RETURN 'charged';
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_interview_analysis_session(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.interview_sessions%ROWTYPE;
  v_candidate_responses integer;
  v_interviewer_questions integer;
  v_analysis_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT s.*
    INTO v_session
    FROM public.interview_sessions s
    JOIN public.interviews i ON i.id = s.interview_id
   WHERE s.id = p_session_id
     AND i.user_id = auth.uid()
     AND i.kind = 'practice'
   FOR UPDATE OF s;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Interview session not found or access denied';
  END IF;

  IF v_session.status <> 'active' THEN
    SELECT a.id INTO v_analysis_id
      FROM public.interview_analyses a
     WHERE a.interview_session_id = v_session.id
       AND a.perspective = 'candidate';

    RETURN jsonb_build_object(
      'session_id', v_session.id,
      'status', v_session.status,
      'analysis_id', v_analysis_id
    );
  END IF;

  SELECT
    count(*) FILTER (
      WHERE nullif(btrim(turn->>'user'), '') IS NOT NULL
    ),
    count(*) FILTER (
      WHERE nullif(btrim(turn->>'assistant'), '') IS NOT NULL
    )
    INTO v_candidate_responses, v_interviewer_questions
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(v_session.turns) = 'array' THEN v_session.turns
        ELSE '[]'::jsonb
      END
    ) AS turn;

  UPDATE public.interview_sessions
     SET status = CASE
                    WHEN v_candidate_responses >= 3
                     AND v_interviewer_questions >= 3 THEN 'completed'
                    ELSE 'ineligible'
                  END,
         ended_at = now(),
         updated_at = now()
   WHERE id = v_session.id
   RETURNING * INTO v_session;

  IF v_session.status = 'completed' THEN
    INSERT INTO public.interview_analyses (
      interview_session_id,
      perspective,
      status
    )
    VALUES (v_session.id, 'candidate', 'queued')
    ON CONFLICT (interview_session_id, perspective) DO NOTHING
    RETURNING id INTO v_analysis_id;

    IF v_analysis_id IS NOT NULL THEN
      PERFORM pgmq.send(
        'interview_analysis_queue',
        jsonb_build_object('analysisId', v_analysis_id)
      );
    ELSE
      SELECT a.id INTO v_analysis_id
        FROM public.interview_analyses a
       WHERE a.interview_session_id = v_session.id
         AND a.perspective = 'candidate';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'session_id', v_session.id,
    'status', v_session.status,
    'analysis_id', v_analysis_id
  );
END;
$$;

-- A screening session can't be attached as a shared practice interview.
create or replace function public.check_application_attachment()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_applicant uuid;
begin
  select a.applicant_user_id into v_applicant from public.applications a where a.id = new.application_id;
  if v_applicant is null then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  if current_role = 'authenticated' and v_applicant is distinct from auth.uid() then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;

  if new.kind = 'interview_session' and not exists (
    select 1 from public.interview_sessions s
    join public.interviews i on i.id = s.interview_id
    where s.id = new.interview_session_id and i.user_id = v_applicant and s.status = 'completed'
      and i.kind = 'practice'
  ) then
    raise exception using errcode = 'P0001', message = 'SESSION_NOT_FOUND';
  end if;

  if new.kind = 'resume_review' and not exists (
    select 1 from public.resume_reviews r
    where r.id = new.resume_review_id and r.user_id = v_applicant and r.status = 'completed'
  ) then
    raise exception using errcode = 'P0001', message = 'REVIEW_NOT_FOUND';
  end if;

  new.first_viewed_at := null;
  return new;
end $$;

revoke all on function public.check_application_attachment() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Function grants
-- ---------------------------------------------------------------------------
-- The project's default privileges grant EXECUTE to anon and authenticated,
-- so each function is revoked and granted explicitly.

do $$
declare
  f text;
begin
  -- Internal helpers and the service-role lifecycle functions.
  foreach f in array array[
    'log_screening_event(public.application_interviews, text, uuid, jsonb)',
    'screening_turn_counts(jsonb)',
    'release_screening_hold(public.application_interviews)',
    'lock_my_screening_interview(uuid)',
    'screening_start_refusal(public.application_interviews)',
    'create_screening_invite(uuid, text, uuid)',
    'finish_screening_session(uuid, jsonb, text, integer)',
    'expire_screening_interviews()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;

  -- Called by the applicant, or for manage_screening_interview a company member.
  foreach f in array array[
    'my_screening_interviews()',
    'record_screening_consent(uuid, text)',
    'reserve_screening_attempt(uuid, text)',
    'start_screening_attempt(uuid, text, text)',
    'decline_screening_interview(uuid)',
    'request_screening_accommodation(uuid, text)',
    'manage_screening_interview(uuid, text, integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
