-- Bulk candidate import, phase 4: screening invites for imported applicants,
-- claiming and merging (plan/bulk-import/feature-bulk-import-spec.md
-- BI-REQ-040 to BI-REQ-044; tasks BIT-062).
--
--  1. application_interviews: an imported applicant's interview has no user
--     until they claim it
--  2. create_screening_invite: imported applications (no_email, unsubscribed)
--  3. company_candidate_claims: the claim links' hashed tokens
--  4. merge_imported_application: BI-REQ-042's merge, shared by 5 and 6
--  5. claim_company_candidate (BI-REQ-041/042)
--  6. applications_merge_imported: merge on apply (BI-REQ-044)

-- ---------------------------------------------------------------------------
-- 1. application_interviews
-- ---------------------------------------------------------------------------

alter table public.application_interviews
  alter column applicant_user_id drop not null,
  add column if not exists company_candidate_id uuid references public.company_candidates(id) on delete cascade;

alter table public.application_interviews drop constraint if exists application_interviews_person;
alter table public.application_interviews add constraint application_interviews_person
  check (applicant_user_id is not null or company_candidate_id is not null);

create index if not exists application_interviews_company_candidate_idx
  on public.application_interviews (company_candidate_id) where company_candidate_id is not null;

-- ---------------------------------------------------------------------------
-- 2. create_screening_invite (BI-REQ-040)
-- ---------------------------------------------------------------------------

-- As in 20261018120000_screening_interviews.sql, except that an imported
-- application is invited too: the candidate needs an email and mustn't have
-- unsubscribed, and the interview has no user (and no `interviews` row)
-- until they claim it. A merged application is never invited.
create or replace function public.create_screening_invite(p_application_id uuid, p_via text, p_invited_by uuid default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_job public.job_postings%rowtype;
  v_config public.job_interview_configs%rowtype;
  v_candidate public.company_candidates%rowtype;
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
  if not found or v_app.job_post_id is null or v_app.merged_into_application_id is not null
     or (v_app.applicant_user_id is null and v_app.company_candidate_id is null) then
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
  if public.application_stage_closed(v_app.id) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if v_app.applicant_user_id is null then
    select * into v_candidate from public.company_candidates where id = v_app.company_candidate_id;
    if nullif(btrim(coalesce(v_candidate.email, '')), '') is null then
      return jsonb_build_object('ok', false, 'reason', 'no_email');
    end if;
    if v_candidate.email_opted_out_at is not null then
      return jsonb_build_object('ok', false, 'reason', 'unsubscribed');
    end if;
  end if;

  select name into v_company_name from public.company_info where id = v_job.company_id;

  begin
    insert into public.application_interviews (
      id, application_id, job_post_id, company_id, applicant_user_id, company_candidate_id, config_snapshot,
      status, invited_via, invited_by, deadline_at, credits_cost
    ) values (
      v_id, v_app.id, v_job.id, v_job.company_id, v_app.applicant_user_id, v_app.company_candidate_id,
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

  -- An imported applicant's `interviews` row is created when they claim it.
  if v_app.applicant_user_id is not null then
    insert into public.interviews (id, user_id, job_id, resume_id, name, kind, application_interview_id)
    values (v_interview, v_app.applicant_user_id, v_job.job_id, v_app.resume_id, v_job.title, 'screening', v_id);
    update public.application_interviews set interview_id = v_interview where id = v_id;
  else
    v_interview := null;
  end if;
  select * into v_row from public.application_interviews where id = v_id;

  perform public.log_screening_event(v_row, 'interview_invited', p_invited_by, jsonb_build_object(
    'via', p_via, 'duration_minutes', v_row.credits_cost, 'deadline_at', v_row.deadline_at
  ));

  -- Sent by /api/worker/screening-invite-emails once this commits.
  perform pgmq.send('screening_invite_email_queue', jsonb_build_object('application_interview_id', v_id));

  return jsonb_build_object(
    'ok', true, 'id', v_id, 'interview_id', v_interview,
    'deadline_at', v_row.deadline_at, 'duration_minutes', v_row.credits_cost
  );
end $$;

revoke all on function public.create_screening_invite(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.create_screening_invite(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. company_candidate_claims (BI-REQ-041)
-- ---------------------------------------------------------------------------

-- One row per claim link sent. Only the sha256 of the token is stored; the
-- link expires with the interview's deadline and works once. Written by the
-- invite email worker (service role) only.
create table if not exists public.company_candidate_claims (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  company_id uuid not null references public.company_info(id) on delete cascade,
  candidate_id uuid not null references public.company_candidates(id) on delete cascade,
  application_interview_id uuid references public.application_interviews(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists company_candidate_claims_candidate_idx on public.company_candidate_claims (candidate_id);

alter table public.company_candidate_claims enable row level security;
revoke all on table public.company_candidate_claims from anon, authenticated;
grant all on table public.company_candidate_claims to service_role;

-- ---------------------------------------------------------------------------
-- 4. merge_imported_application (BI-REQ-042)
-- ---------------------------------------------------------------------------

-- Merges an imported application into the same person's direct application
-- to the same job: the imported one leaves every list and count, its open
-- interview is cancelled and its minutes released, and when it had one and
-- the direct application has no interview, the direct one is invited with
-- the job's config. Returns the direct application's open interview id, or
-- null. Internal: called by claim_company_candidate and the apply trigger.
create or replace function public.merge_imported_application(p_imported uuid, p_direct uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_imported public.applications%rowtype;
  v_direct public.applications%rowtype;
  v_row public.application_interviews%rowtype;
  v_had_open boolean := false;
  v_res jsonb;
begin
  select * into v_imported from public.applications where id = p_imported for update;
  select * into v_direct from public.applications where id = p_direct;
  if v_imported.id is null or v_direct.id is null or v_imported.job_post_id is distinct from v_direct.job_post_id
     or v_imported.company_candidate_id is null or v_imported.applicant_user_id is not null then
    raise exception 'not an imported application of the same job' using errcode = 'invalid_parameter_value';
  end if;

  if v_imported.merged_into_application_id is null then
    update public.applications set merged_into_application_id = p_direct, updated_at = now() where id = p_imported;

    for v_row in
      update public.application_interviews
         set status = 'cancelled', paused_at = null, updated_at = now()
       where application_id = p_imported and status in ('invited', 'paused')
      returning *
    loop
      v_had_open := true;
      perform public.release_screening_hold(v_row);
      perform public.log_screening_event(v_row, 'interview_cancelled', null, jsonb_build_object('reason', 'merged'));
      -- The same inviter and source; a config that's off or a full allowance
      -- leaves the direct application without one.
      begin
        v_res := public.create_screening_invite(p_direct, v_row.invited_via, v_row.invited_by);
      exception when others then
        raise warning 'merge_imported_application(%): %', p_direct, sqlerrm;
      end;
    end loop;

    insert into public.application_events (company_id, application_id, candidate_user_id, type, payload)
    select j.company_id, a.id, a.applicant_user_id, 'merged', a.payload
      from public.job_postings j,
           (values (p_imported, null::uuid, jsonb_build_object('merged_into_application_id', p_direct)),
                   (p_direct, v_direct.applicant_user_id, jsonb_build_object('merged_from_application_id', p_imported)))
             as a(id, applicant_user_id, payload)
     where j.id = v_direct.job_post_id;
  end if;

  return (select id from public.application_interviews
           where application_id = p_direct and status in ('invited', 'paused', 'in_progress'));
end $$;

revoke all on function public.merge_imported_application(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. claim_company_candidate (BI-REQ-041/042/043)
-- ---------------------------------------------------------------------------

-- The person who got a claim link links the session account to the company
-- candidate: their applications to that company get the account (or merge
-- into the account's own application to the same job), their interviews get
-- it too, with the `interviews` rows the interview page needs. Never changes
-- the account's email or user_info. Returns the interview to land on.
create or replace function public.claim_company_candidate(p_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_claim public.company_candidate_claims%rowtype;
  v_candidate public.company_candidates%rowtype;
  v_app public.applications%rowtype;
  v_direct uuid;
  v_landing uuid;
  v_merged_landing uuid;
  v_target uuid;
  v_job public.job_postings%rowtype;
  v_row public.application_interviews%rowtype;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  if p_token is null or length(p_token) not between 20 and 200 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into v_claim from public.company_candidate_claims
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
   for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;

  -- A second click by the same account lands on the same interview.
  if v_claim.used_at is not null and v_claim.used_by is distinct from v_user then
    return jsonb_build_object('ok', false, 'reason', 'used');
  end if;
  if v_claim.used_at is null and v_claim.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if exists (select 1 from public.company_members where user_id = v_user)
     or exists (select 1 from public.company_info where user_id = v_user) then
    return jsonb_build_object('ok', false, 'reason', 'company_account');
  end if;
  if not exists (select 1 from public.user_info where user_id = v_user) then
    return jsonb_build_object('ok', false, 'reason', 'no_profile');
  end if;

  select * into v_candidate from public.company_candidates where id = v_claim.candidate_id for update;
  if v_candidate.claimed_user_id is not null and v_candidate.claimed_user_id <> v_user then
    return jsonb_build_object('ok', false, 'reason', 'used');
  end if;

  if v_candidate.claimed_user_id is null then
    update public.company_candidates set claimed_user_id = v_user, claimed_at = now(), updated_at = now()
     where id = v_candidate.id;
  end if;

  for v_app in
    select * from public.applications
     where company_candidate_id = v_candidate.id and applicant_user_id is null and merged_into_application_id is null
     for update
  loop
    select id into v_direct from public.applications
     where applicant_user_id = v_user and job_post_id = v_app.job_post_id and id <> v_app.id
     limit 1;

    if v_direct is not null then
      v_merged_landing := public.merge_imported_application(v_app.id, v_direct);
      if v_claim.application_interview_id in (select id from public.application_interviews where application_id = v_app.id) then
        v_landing := v_merged_landing;
      end if;
      continue;
    end if;

    update public.applications set applicant_user_id = v_user, updated_at = now() where id = v_app.id;

    select * into v_job from public.job_postings where id = v_app.job_post_id;
    for v_row in
      update public.application_interviews set applicant_user_id = v_user, updated_at = now()
       where application_id = v_app.id and applicant_user_id is null
      returning *
    loop
      if v_row.interview_id is null then
        v_target := gen_random_uuid();
        insert into public.interviews (id, user_id, job_id, resume_id, name, kind, application_interview_id)
        values (v_target, v_user, v_job.job_id, null, v_job.title, 'screening', v_row.id);
        update public.application_interviews set interview_id = v_target where id = v_row.id;
      end if;
      if v_row.id = v_claim.application_interview_id then v_landing := v_row.id; end if;
    end loop;

    insert into public.application_events (company_id, application_id, candidate_user_id, type, payload)
    values (v_candidate.company_id, v_app.id, v_user, 'claimed', jsonb_build_object('company_candidate_id', v_candidate.id));
  end loop;

  -- Already claimed (a second click): the interview the link was for.
  if v_landing is null and v_claim.application_interview_id is not null then
    select case when a.merged_into_application_id is null then ai.id else (
             select d.id from public.application_interviews d
              where d.application_id = a.merged_into_application_id and d.applicant_user_id = v_user)
           end
      into v_landing
      from public.application_interviews ai
      join public.applications a on a.id = ai.application_id
     where ai.id = v_claim.application_interview_id and (ai.applicant_user_id = v_user or a.merged_into_application_id is not null);
  end if;

  update public.company_candidate_claims set used_at = coalesce(used_at, now()), used_by = v_user
   where token_hash = v_claim.token_hash;

  return jsonb_build_object('ok', true, 'application_interview_id', v_landing);
end $$;

revoke all on function public.claim_company_candidate(text) from public, anon;
grant execute on function public.claim_company_candidate(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. applications_merge_imported (BI-REQ-044)
-- ---------------------------------------------------------------------------

-- A GetHired user who applies to a job the company imported them into, with
-- the same email, gets the imported application merged into theirs. Only
-- that job's: the candidate isn't claimed and their other applications wait
-- for a claim. A failure never blocks the apply.
create or replace function public.applications_merge_imported()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_email text;
  v_imported uuid;
begin
  if new.applicant_user_id is null or new.job_post_id is null then return null; end if;
  select lower(email) into v_email from auth.users where id = new.applicant_user_id;
  if v_email is null then return null; end if;

  for v_imported in
    select a.id from public.applications a
      join public.company_candidates c on c.id = a.company_candidate_id
     where a.job_post_id = new.job_post_id and a.id <> new.id
       and a.applicant_user_id is null and a.merged_into_application_id is null
       and lower(c.email) = v_email
  loop
    begin
      perform public.merge_imported_application(v_imported, new.id);
    exception when others then
      raise warning 'applications_merge_imported(%): %', new.id, sqlerrm;
    end;
  end loop;
  return null;
end $$;

revoke all on function public.applications_merge_imported() from public, anon, authenticated;

drop trigger if exists applications_merge_imported on public.applications;
create trigger applications_merge_imported
  after insert on public.applications
  for each row execute function public.applications_merge_imported();
