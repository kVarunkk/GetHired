-- One open interview per plan interview per application. Booking, sending a
-- link or recording a future time for a plan interview that already has an
-- interview waiting for the candidate (`awaiting_candidate`) or `scheduled` is
-- refused with `already_scheduled`. A cancelled, completed or no-show one
-- doesn't block a new one, so a redo is still possible. Ad-hoc interviews
-- (no plan item) aren't limited.
--
-- The candidate's own moves (book_by_token, return_interview_to_link) change
-- the same row between `awaiting_candidate` and `scheduled`, so they never
-- meet the index.

create unique index if not exists scheduled_interviews_one_open_per_plan_item
  on public.scheduled_interviews (application_id, plan_item_id)
  where plan_item_id is not null and status in ('awaiting_candidate', 'scheduled');

-- As in 20261114140000_recruiter_interviews_self_scheduling.sql, plus the
-- `already_scheduled` check (and the index as the backstop for a race).
create or replace function public.create_scheduled_interview(
  p_application_id uuid,
  p_panel uuid[],
  p_starts_at timestamptz,
  p_plan_item_id uuid,
  p_name text,
  p_duration_minutes integer,
  p_meeting_url text,
  p_source public.scheduled_interview_source,
  p_time_zone text,
  p_require_future boolean,
  p_require_connection boolean
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_app public.applications%rowtype;
  v_company uuid;
  v_panel uuid[];
  v_snapshot jsonb;
  v_name text;
  v_duration int;
  v_stage uuid;
  v_url text := nullif(btrim(coalesce(p_meeting_url, '')), '');
  v_zone text := nullif(btrim(coalesce(p_time_zone, '')), '');
  v_link boolean := p_source = 'link';
  v_attendee boolean := false;
  v_status public.scheduled_interview_status;
  v_row public.scheduled_interviews%rowtype;
begin
  select * into v_app from public.applications where id = p_application_id;
  select company_id into v_company from public.job_postings where id = v_app.job_post_id;
  if v_app.id is null or v_company is null or not public.is_company_member(v_company) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.has_company_permission(v_company, 'scheduling.manage', v_app.job_post_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_app.merged_into_application_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'merged');
  end if;
  if public.application_stage_closed(v_app.id) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if p_require_connection and not exists (
    select 1 from public.calendar_connections
     where user_id = v_uid and company_id = v_company and provider = 'google' and status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_connected');
  end if;

  if p_plan_item_id is not null then
    v_snapshot := public.plan_item_snapshot(p_plan_item_id);
    if v_snapshot is null or not exists (
      select 1 from public.job_interview_plan_items where id = p_plan_item_id and job_post_id = v_app.job_post_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_plan_item');
    end if;
    v_name := v_snapshot ->> 'name';
    v_duration := (v_snapshot ->> 'duration_minutes')::int;
    v_stage := public.try_uuid(v_snapshot ->> 'stage_id');
  else
    v_name := btrim(coalesce(p_name, ''));
    v_duration := p_duration_minutes;
    if char_length(v_name) not between 1 and 80 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_name');
    end if;
    if v_duration is null or v_duration not between 15 and 240 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_duration');
    end if;
    v_stage := v_app.stage_id;
    v_snapshot := jsonb_build_object(
      'plan_item_id', null, 'name', v_name, 'duration_minutes', v_duration, 'instructions', '',
      'stage_id', v_stage, 'competencies', '[]'::jsonb
    );
  end if;

  v_panel := public.valid_interview_panel(v_company, p_panel);
  if v_panel is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_panel');
  end if;
  if v_link then
    if p_starts_at is not null then
      return jsonb_build_object('ok', false, 'reason', 'invalid_time');
    end if;
  elsif p_starts_at is null or (p_require_future and p_starts_at <= now()) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_time');
  end if;
  if v_zone is not null and not public.is_valid_time_zone(v_zone) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_time_zone');
  end if;
  if v_url is not null and (char_length(v_url) > 2000 or v_url !~* '^https?://') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_url');
  end if;

  v_status := case
    when v_link then 'awaiting_candidate'
    when p_starts_at + make_interval(mins => v_duration) <= now() then 'completed'
    else 'scheduled'
  end::public.scheduled_interview_status;

  -- A past interview recorded as completed doesn't block, and isn't blocked.
  if p_plan_item_id is not null and v_status in ('awaiting_candidate', 'scheduled') and exists (
    select 1 from public.scheduled_interviews
     where application_id = v_app.id and plan_item_id = p_plan_item_id
       and status in ('awaiting_candidate', 'scheduled')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_scheduled');
  end if;

  if p_source in ('booked', 'link') then
    select coalesce(c.attendee, false) into v_attendee from public.interview_candidate_contact(v_app.id) c;
  end if;
  if v_link then
    -- D20: no email, or opted out: no link.
    if not coalesce(v_attendee, false) then
      return jsonb_build_object('ok', false, 'reason', 'no_candidate_email');
    end if;
    -- IV-REQ-012: the link's slots need every panel member's free/busy.
    if exists (
      select 1 from unnest(v_panel) u
       where not exists (
         select 1 from public.calendar_connections c
          where c.user_id = u and c.company_id = v_company and c.provider = 'google' and c.status = 'active'
       )
    ) then
      return jsonb_build_object('ok', false, 'reason', 'panel_not_connected');
    end if;
  end if;

  begin
    insert into public.scheduled_interviews (
      company_id, job_post_id, application_id, plan_item_id, stage_id, name, duration_minutes, plan_snapshot,
      status, source, starts_at, ends_at, time_zone, meeting_url, candidate_is_attendee, organizer_user_id, created_by
    ) values (
      v_company, v_app.job_post_id, v_app.id, p_plan_item_id, v_stage, v_name, v_duration, v_snapshot,
      v_status, p_source, p_starts_at, p_starts_at + make_interval(mins => v_duration), v_zone, v_url,
      coalesce(v_attendee, false),
      -- D15: the booking member's (or the link sender's) calendar holds the
      -- event. A manual interview is on nobody's calendar.
      case when p_source in ('booked', 'link') then v_uid end,
      v_uid
    ) returning * into v_row;
  exception when unique_violation then
    -- Two members scheduling the same plan interview at once.
    return jsonb_build_object('ok', false, 'reason', 'already_scheduled');
  end;

  insert into public.scheduled_interview_panel (interview_id, user_id, company_id)
  select v_row.id, u, v_company from unnest(v_panel) u;

  perform public.log_meeting_event(v_row, 'meeting_scheduled', v_uid, jsonb_build_object(
    'source', v_row.source, 'starts_at', v_row.starts_at, 'status', v_row.status
  ));

  return jsonb_build_object(
    'ok', true, 'id', v_row.id, 'application_id', v_row.application_id, 'status', v_row.status,
    'candidate_is_attendee', v_row.candidate_is_attendee
  );
end $$;
revoke all on function public.create_scheduled_interview(
  uuid, uuid[], timestamptz, uuid, text, integer, text, public.scheduled_interview_source, text, boolean, boolean
) from public, anon, authenticated;
