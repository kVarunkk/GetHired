-- Stage moves and the screening interview, and email templates for moves
-- that go back.
--
-- 1. Two template purposes: on_hold (a move to On hold) and reopen (back from
--    Rejected or Hired, resumed from On hold, or to an earlier stage), with
--    seeded defaults. seed_default_templates now adds any missing default,
--    so existing companies get the new two.
-- 2. application_stage_closed: the application sits in a Rejected or Hired
--    stage.
-- 3. A move to Rejected or Hired cancels the application's open (invited or
--    paused) screening interview and releases its held minutes. An interview
--    in progress finishes as usual.
-- 4. create_screening_invite refuses a closed application ('closed'), so the
--    fit-threshold worker no longer invites knockout-rejected applicants.
-- 5. manage_screening_interview: 'reopen' for a cancelled or expired
--    interview with attempts left; extend, grant_attempt and reopen refuse a
--    closed application.

-- ---------------------------------------------------------------------------
-- 1. Template purposes
-- ---------------------------------------------------------------------------

alter table public.company_email_templates drop constraint if exists company_email_templates_purpose_check;
alter table public.company_email_templates add constraint company_email_templates_purpose_check
  check (purpose in ('rejection','advance','interview_invite','offer','on_hold','reopen','custom'));

-- Adds each purpose's default the company doesn't have. Defaults can't be
-- deleted, so this only fills in purposes added after the company was made.
create or replace function public.seed_default_templates(p_company_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.company_email_templates (company_id, purpose, name, subject, body_md, is_default)
  select p_company_id, d.purpose, d.name, d.subject, d.body_md, true
  from (values
    ('rejection', 'Rejection',
     'Your application for {{job_title}} at {{company_name}}',
     E'Hi {{candidate_first_name}},\n\nThank you for your interest in the {{job_title}} role at {{company_name}}, and for the time you put into your application. After careful consideration, we''ve decided not to move forward with it this time.\n\nWe wish you the best in your search.\n\n{{sender_name}}\n{{company_name}}'),
    ('advance', 'Next steps',
     'Next steps for {{job_title}} at {{company_name}}',
     E'Hi {{candidate_first_name}},\n\nThanks for applying for {{job_title}}. We enjoyed reading your application and would like to move you to the next stage. We''ll be in touch shortly with the details.\n\n{{sender_name}}\n{{company_name}}'),
    ('interview_invite', 'Interview invite',
     'Interview for {{job_title}} at {{company_name}}',
     E'Hi {{candidate_first_name}},\n\nWe''d like to invite you to interview for {{job_title}}. Please pick a time that works for you: {{scheduling_link}}\n\nLooking forward to speaking with you.\n\n{{sender_name}}\n{{company_name}}'),
    ('offer', 'Offer',
     'An offer for {{job_title}} at {{company_name}}',
     E'Hi {{candidate_first_name}},\n\nWe''re delighted to let you know that we''d like to offer you the {{job_title}} role at {{company_name}}. We''ll follow up shortly with the details.\n\n{{sender_name}}\n{{company_name}}'),
    ('on_hold', 'On hold',
     'An update on your application for {{job_title}}',
     E'Hi {{candidate_first_name}},\n\nThank you for your patience. We''re pausing our review of your application for {{job_title}} for now, and it stays open with us. We''ll be in touch when we pick it back up.\n\n{{sender_name}}\n{{company_name}}'),
    ('reopen', 'Back under review',
     'An update on your application for {{job_title}}',
     E'Hi {{candidate_first_name}},\n\nWe''ve taken another look at your application for {{job_title}} at {{company_name}}, and it''s back under review. Please disregard our earlier message. We''ll be in touch soon about next steps.\n\n{{sender_name}}\n{{company_name}}'),
    ('custom', 'Message',
     'A message from {{company_name}}',
     E'Hi {{candidate_first_name}},\n\n\n\n{{sender_name}}\n{{company_name}}')
  ) as d(purpose, name, subject, body_md)
  where not exists (
    select 1 from public.company_email_templates t
    where t.company_id = p_company_id and t.purpose = d.purpose and t.is_default
  );
end $$;

revoke all on function public.seed_default_templates(uuid) from public, anon, authenticated;
grant execute on function public.seed_default_templates(uuid) to service_role;

select public.seed_default_templates(ci.id) from public.company_info ci;

-- ---------------------------------------------------------------------------
-- 2. Closed applications
-- ---------------------------------------------------------------------------

create or replace function public.application_stage_closed(p_application_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.applications a
    join public.pipeline_stages s on s.id = a.stage_id
    where a.id = p_application_id and s.kind in ('rejected', 'hired')
  )
$$;

revoke all on function public.application_stage_closed(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. A move to Rejected or Hired cancels the open interview
-- ---------------------------------------------------------------------------

alter table public.application_events drop constraint if exists application_events_type_check;
alter table public.application_events add constraint application_events_type_check check (type in (
  'applied', 'stage_changed', 'email_sent', 'note_added', 'screened', 'outreach_sent', 'outreach_replied',
  'interview_invited', 'interview_started', 'interview_completed', 'interview_expired',
  'interview_declined', 'interview_cancelled', 'interview_accommodation_requested',
  'interview_extended', 'interview_attempt_granted', 'interview_reopened'
));

create or replace function public.applications_close_screening_interview()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_kind public.pipeline_stage_kind;
  v_row public.application_interviews%rowtype;
begin
  select kind into v_kind from public.pipeline_stages where id = new.stage_id;
  if v_kind is null or v_kind not in ('rejected', 'hired') then return null; end if;

  for v_row in
    update public.application_interviews
       set status = 'cancelled', paused_at = null, updated_at = now()
     where application_id = new.id and status in ('invited', 'paused')
    returning *
  loop
    perform public.release_screening_hold(v_row);
    perform public.log_screening_event(v_row, 'interview_cancelled', (select auth.uid()),
      jsonb_build_object('reason', 'stage', 'stage_kind', v_kind));
  end loop;
  return null;
end $$;

revoke all on function public.applications_close_screening_interview() from public, anon, authenticated;

-- Not "update of stage_id": a status-only update sets the stage in
-- applications_sync_status, outside the statement's column list.
drop trigger if exists applications_close_screening_interview on public.applications;
create trigger applications_close_screening_interview
  after update on public.applications
  for each row
  when (new.stage_id is distinct from old.stage_id)
  execute function public.applications_close_screening_interview();

-- ---------------------------------------------------------------------------
-- 4. Invites refuse closed applications
-- ---------------------------------------------------------------------------
-- As in 20261018120000, plus the 'closed' check.

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
  if public.application_stage_closed(v_app.id) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
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

-- ---------------------------------------------------------------------------
-- 5. Reopen, and no changes to a closed application's interview
-- ---------------------------------------------------------------------------
-- As in 20261018120000, plus 'reopen' and the 'closed' check.

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

  -- A rejected or hired candidate's interview can only be cancelled.
  if p_action in ('extend', 'grant_attempt', 'reopen') and public.application_stage_closed(v_row.application_id) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
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

  elsif p_action = 'reopen' then
    -- A cancelled or expired interview with attempts left, e.g. after the
    -- candidate is moved back out of Rejected. Holds the minutes again and
    -- starts a fresh deadline.
    if v_row.status not in ('cancelled', 'expired') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_status');
    end if;
    if v_row.attempts_used >= v_row.max_attempts then
      return jsonb_build_object('ok', false, 'reason', 'limit_reached');
    end if;
    if not exists (
      select 1 from public.job_postings jp where jp.id = v_row.job_post_id and jp.status = 'active'
    ) then
      return jsonb_build_object('ok', false, 'reason', 'job_inactive');
    end if;
    v_hold := public.hold_entitlement(
      v_row.company_id, 'interview_minutes', v_row.credits_cost::int,
      'application_interview', v_row.id::text, now() + interval '120 days', v_uid
    );
    if not coalesce((v_hold ->> 'ok')::boolean, false) then
      return jsonb_build_object('ok', false,
        'reason', case when v_hold ->> 'reason' = 'member_limit' then 'member_limit' else 'insufficient_credits' end,
        'credits_needed', coalesce((v_hold ->> 'credits_needed')::int, 0));
    end if;
    v_days := coalesce((v_row.config_snapshot ->> 'deadline_days')::int, 5);
    update public.application_interviews
       set status = 'invited', paused_at = null, reminder_sent_at = null,
           deadline_at = now() + make_interval(days => v_days),
           updated_at = now()
     where id = v_row.id returning * into v_row;
    perform public.log_screening_event(v_row, 'interview_reopened', v_uid, jsonb_build_object(
      'deadline_at', v_row.deadline_at
    ));

  else
    raise exception 'unknown action: %', p_action using errcode = 'invalid_parameter_value';
  end if;

  return jsonb_build_object('ok', true, 'status', v_row.status, 'deadline_at', v_row.deadline_at);
end $$;
