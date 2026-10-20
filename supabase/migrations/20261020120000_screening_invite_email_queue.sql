-- Screening invite emails go through a queue, and a bulk invite is one RPC.
--
-- 1. screening_invite_email_queue.
-- 2. create_screening_invite queues the invite email in the same transaction
--    as the invite, so every path (manual, agent, fit-threshold) gets exactly
--    one email per invite, and a refused invite gets none.
-- 3. create_screening_invites(job, ids, via, invited_by): up to 50
--    applications of one job in one call. The job's config row is locked
--    once, up front, so every invite in the batch snapshots the same config.
-- 4. manage_screening_interview: 'reopen' queues the invite email again.
-- 5. The worker's cron job, every minute, created INACTIVE until the route is
--    deployed. Turn it on with
--      select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'screening-invite-emails-worker'), active := true);

-- ---------------------------------------------------------------------------
-- 1. Queue
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pgmq.list_queues() where queue_name = 'screening_invite_email_queue') then
    perform pgmq.create('screening_invite_email_queue');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Invites queue their email
-- ---------------------------------------------------------------------------
-- As in 20261019130000, plus the pgmq.send.

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

  -- Sent by /api/worker/screening-invite-emails once this commits.
  perform pgmq.send('screening_invite_email_queue', jsonb_build_object('application_interview_id', v_id));

  return jsonb_build_object(
    'ok', true, 'id', v_id, 'interview_id', v_interview,
    'deadline_at', v_row.deadline_at, 'duration_minutes', v_row.credits_cost
  );
end $$;

-- ---------------------------------------------------------------------------
-- 3. Bulk invites
-- ---------------------------------------------------------------------------
-- Returns one { application_id, ok, id | reason } per id, in order. An
-- application on another job is 'not_found'. Each invite runs in its own
-- subtransaction, so an unexpected error fails that row ('failed') and keeps
-- the others; a bad source or an inviter outside the company fails the call.
-- Lock order: the config row, then (in hold_entitlement) the company's
-- subscription row, the same as a single invite.

create or replace function public.create_screening_invites(
  p_job_post_id uuid, p_application_ids uuid[], p_via text, p_invited_by uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_app_id uuid;
  v_job_of uuid;
  v_res jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  if p_via is null or p_via not in ('fit_threshold', 'manual', 'agent') then
    raise exception 'invalid invite source: %', p_via using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(cardinality(p_application_ids), 0) > 50 then
    raise exception 'at most 50 invites at a time' using errcode = 'invalid_parameter_value';
  end if;

  perform 1 from public.job_interview_configs where job_post_id = p_job_post_id for update;

  foreach v_app_id in array coalesce(p_application_ids, '{}') loop
    select job_post_id into v_job_of from public.applications where id = v_app_id;
    if v_job_of is distinct from p_job_post_id then
      v_res := jsonb_build_object('ok', false, 'reason', 'not_found');
    else
      begin
        v_res := public.create_screening_invite(v_app_id, p_via, p_invited_by);
      exception
        when insufficient_privilege or invalid_parameter_value then raise;
        when others then
          raise warning 'create_screening_invites(%): %', v_app_id, sqlerrm;
          v_res := jsonb_build_object('ok', false, 'reason', 'failed');
      end;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object('application_id', v_app_id) || v_res);
  end loop;

  return v_results;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Reopen queues the invite email again
-- ---------------------------------------------------------------------------
-- As in 20261019130000, plus the pgmq.send in 'reopen'.

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
    -- candidate is moved back out of Rejected. Holds the minutes again,
    -- starts a fresh deadline and emails the invite again.
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
    perform pgmq.send('screening_invite_email_queue', jsonb_build_object('application_interview_id', v_row.id));

  else
    raise exception 'unknown action: %', p_action using errcode = 'invalid_parameter_value';
  end if;

  return jsonb_build_object('ok', true, 'status', v_row.status, 'deadline_at', v_row.deadline_at);
end $$;

-- create or replace keeps the existing grants on the two replaced functions.
-- The project's default privileges grant EXECUTE to anon and authenticated,
-- so the new one is revoked and granted explicitly.
revoke all on function public.create_screening_invites(uuid, uuid[], text, uuid) from public, anon, authenticated;
grant execute on function public.create_screening_invites(uuid, uuid[], text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Cron job, inactive
-- ---------------------------------------------------------------------------

create or replace function pg_temp.schedule_inactive(p_name text, p_schedule text, p_path text)
returns void language plpgsql as $$
declare
  existing_job_id bigint;
  new_job_id bigint;
begin
  select jobid into existing_job_id from cron.job where jobname = p_name;
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  new_job_id := cron.schedule(
    p_name,
    p_schedule,
    format(
      $cmd$
        select net.http_get(
          url := %L,
          headers := jsonb_build_object(
            'X-Internal-Secret',
            (select decrypted_secret from vault.decrypted_secrets where name = 'internal_secret')
          ),
          timeout_milliseconds := 300000
        );
      $cmd$,
      'https://gethired.devhub.co.in' || p_path
    )
  );

  perform cron.alter_job(job_id := new_job_id, active := false);
end $$;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'internal_secret') then
    raise exception 'Internal secret not found in vault.';
  end if;

  perform pg_temp.schedule_inactive('screening-invite-emails-worker', '* * * * *', '/api/worker/screening-invite-emails');
end $$;
