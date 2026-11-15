-- Recruiter interviews, phase 3: self-scheduling links
-- (plan/recruiter-interviews/feature-recruiter-interviews-spec.md IV-REQ-020
-- "Send a link", IV-REQ-021, IV-REQ-022, IV-REQ-043, IV-SEC-003; tasks
-- IVT-060–065).
--
-- A recruiter sends the candidate a link. Only the sha256 of its token is
-- stored (scheduled_interviews.booking_token_hash). The public page reads
-- through resolve_scheduling_token (anon); booking, rescheduling and
-- cancelling go through the server route, which checks live free/busy and
-- calls Google, so book/reschedule/cancel_by_token are service role only.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

-- The open slots computed for a link's page, kept 2 minutes (spec §5): every
-- page view is unauthenticated and would otherwise call Google. In the DB,
-- not in memory, because Cloud Run has several instances.
alter table public.scheduled_interviews add column if not exists slots_cache jsonb;
alter table public.scheduled_interviews add column if not exists slots_cached_at timestamptz;
-- When the current link was sent; the unbooked link lives 7 days from it.
alter table public.scheduled_interviews add column if not exists booking_link_sent_at timestamptz;

create or replace function public.scheduling_link_ttl() returns interval
  language sql immutable set search_path = '' as $$ select interval '7 days' $$;
-- The candidate can't reschedule or cancel later than this before the start (IV-REQ-022).
create or replace function public.scheduling_link_cutoff() returns interval
  language sql immutable set search_path = '' as $$ select interval '4 hours' $$;
create or replace function public.scheduling_slots_ttl() returns interval
  language sql immutable set search_path = '' as $$ select interval '2 minutes' $$;
-- After the candidate cancels, the link stays open at least this long to rebook.
create or replace function public.scheduling_rebook_grace() returns interval
  language sql immutable set search_path = '' as $$ select interval '2 days' $$;

create or replace function public.scheduling_token_hash(p_token text)
returns text
language sql immutable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
$$;
revoke all on function public.scheduling_token_hash(text) from public, anon, authenticated;

-- A booked link lives until the interview ends (IV-SEC-003), whoever moves
-- it: the candidate, a recruiter or Google. A change of time or panel makes
-- the cached slots stale.
create or replace function public.scheduled_interviews_link_upkeep()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source = 'link' and new.booking_token_hash is not null and new.status = 'scheduled'
     and new.ends_at is not null then
    new.booking_token_expires_at := new.ends_at;
  end if;
  if new.starts_at is distinct from old.starts_at or new.status is distinct from old.status then
    new.slots_cache := null;
    new.slots_cached_at := null;
  end if;
  return new;
end $$;

drop trigger if exists scheduled_interviews_link_upkeep on public.scheduled_interviews;
create trigger scheduled_interviews_link_upkeep
  before update on public.scheduled_interviews
  for each row execute function public.scheduled_interviews_link_upkeep();

-- ---------------------------------------------------------------------------
-- 2. Creating a link (IVT-060, IV-REQ-012, IV-REQ-020, IV-REQ-026)
-- ---------------------------------------------------------------------------

-- The shared body of record_interview, book_interview and
-- create_scheduling_link. As in the calendar migration, plus `link`: no
-- time yet (`awaiting_candidate`), organized by the sender, who must be
-- connected, as must every panel member (IV-REQ-012); refused for a
-- candidate who can't be emailed (D20). Internal.
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

  insert into public.scheduled_interviews (
    company_id, job_post_id, application_id, plan_item_id, stage_id, name, duration_minutes, plan_snapshot,
    status, source, starts_at, ends_at, time_zone, meeting_url, candidate_is_attendee, organizer_user_id, created_by
  ) values (
    v_company, v_app.job_post_id, v_app.id, p_plan_item_id, v_stage, v_name, v_duration, v_snapshot,
    case
      when v_link then 'awaiting_candidate'
      when p_starts_at + make_interval(mins => v_duration) <= now() then 'completed'
      else 'scheduled'
    end::public.scheduled_interview_status,
    p_source, p_starts_at, p_starts_at + make_interval(mins => v_duration), v_zone, v_url,
    coalesce(v_attendee, false),
    -- D15: the booking member's (or the link sender's) calendar holds the
    -- event. A manual interview is on nobody's calendar.
    case when p_source in ('booked', 'link') then v_uid end,
    v_uid
  ) returning * into v_row;

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

-- IV-REQ-020 "Send a link": an interview waiting for the candidate to pick a
-- time. The app makes the token and passes only its sha256
-- (helpers/interviews/scheduling-token.ts), then sends the email.
create or replace function public.create_scheduling_link(
  p_application_id uuid,
  p_panel uuid[],
  p_token_hash text,
  p_plan_item_id uuid default null,
  p_name text default null,
  p_duration_minutes integer default null,
  p_time_zone text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_token');
  end if;
  v := public.create_scheduled_interview(
    p_application_id, p_panel, null, p_plan_item_id, p_name, p_duration_minutes, null,
    'link', p_time_zone, true, true
  );
  if not (v ->> 'ok')::boolean then
    return v;
  end if;
  update public.scheduled_interviews
     set booking_token_hash = p_token_hash,
         booking_link_sent_at = now(),
         booking_token_expires_at = now() + public.scheduling_link_ttl()
   where id = (v ->> 'id')::uuid;
  return v || jsonb_build_object('expires_at', now() + public.scheduling_link_ttl());
end $$;
revoke all on function public.create_scheduling_link(uuid, uuid[], text, uuid, text, integer, text) from public, anon;
grant execute on function public.create_scheduling_link(uuid, uuid[], text, uuid, text, integer, text) to authenticated;

-- A new link for the same interview (resend, or copy a fresh one): the old
-- token stops working. An unbooked link gets 7 more days; a booked one keeps
-- living until the interview ends. Refused once the candidate can't be
-- emailed any more (D20).
create or replace function public.renew_scheduling_link(p_id uuid, p_token_hash text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.scheduled_interviews%rowtype;
begin
  begin
    v_row := public.managed_interview(p_id);
  exception when sqlstate 'P0001' then
    return public.interview_reason(sqlerrm);
  end;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_token');
  end if;
  if v_row.source <> 'link' or v_row.status not in ('awaiting_candidate', 'scheduled') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;
  if public.application_stage_closed(v_row.application_id) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if not coalesce((select c.attendee from public.interview_candidate_contact(v_row.application_id) c), false) then
    return jsonb_build_object('ok', false, 'reason', 'no_candidate_email');
  end if;
  update public.scheduled_interviews
     set booking_token_hash = p_token_hash,
         booking_link_sent_at = now(),
         booking_token_expires_at = case when status = 'scheduled' then ends_at
                                         else now() + public.scheduling_link_ttl() end,
         updated_at = now()
   where id = v_row.id
  returning * into v_row;
  return jsonb_build_object('ok', true, 'id', v_row.id, 'application_id', v_row.application_id,
    'status', v_row.status, 'expires_at', v_row.booking_token_expires_at);
end $$;
revoke all on function public.renew_scheduling_link(uuid, text) from public, anon;
grant execute on function public.renew_scheduling_link(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The link's page (IVT-060, IV-REQ-021, IV-SEC-003)
-- ---------------------------------------------------------------------------

-- The interview a token opens: the hash matches, it hasn't expired, and the
-- interview is waiting for the candidate or booked through the link. Locked
-- when `p_lock`. Internal.
create or replace function public.scheduling_link_row(p_token text, p_lock boolean default false)
returns public.scheduled_interviews
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.scheduled_interviews%rowtype;
begin
  if p_token is null or length(p_token) not between 20 and 200 then
    return null;
  end if;
  if p_lock then
    select * into v_row from public.scheduled_interviews
     where booking_token_hash = public.scheduling_token_hash(p_token) for update;
  else
    select * into v_row from public.scheduled_interviews
     where booking_token_hash = public.scheduling_token_hash(p_token);
  end if;
  if not found or v_row.source <> 'link'
     or v_row.status not in ('awaiting_candidate', 'scheduled')
     or v_row.booking_token_expires_at is null or v_row.booking_token_expires_at <= now()
     or exists (select 1 from public.applications a
                 where a.id = v_row.application_id and a.merged_into_application_id is not null) then
    return null;
  end if;
  return v_row;
end $$;
revoke all on function public.scheduling_link_row(text, boolean) from public, anon, authenticated;

-- What the public page shows (anon). Interviewers by display name only,
-- never an address or a fragment of one; nothing about other candidates,
-- the plan or the panel's ids. `not_found` for an unknown, expired or
-- cancelled link.
create or replace function public.resolve_scheduling_token(p_token text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_row public.scheduled_interviews%rowtype := public.scheduling_link_row(p_token);
begin
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object(
    'ok', true,
    'status', v_row.status,
    'job_title', (select j.title from public.job_postings j where j.id = v_row.job_post_id),
    'company_name', (select ci.name from public.company_info ci where ci.id = v_row.company_id),
    'interview_name', v_row.name,
    'duration_minutes', v_row.duration_minutes,
    'interviewers', coalesce((
      select jsonb_agg(coalesce(nullif(btrim(m.display_name), ''), 'Interviewer') order by p.created_at, p.user_id)
        from public.scheduled_interview_panel p
        left join public.company_members m on m.user_id = p.user_id and m.company_id = v_row.company_id
       where p.interview_id = v_row.id
    ), '[]'::jsonb),
    'starts_at', v_row.starts_at,
    'ends_at', v_row.ends_at,
    'time_zone', v_row.time_zone,
    'meeting_url', case when v_row.status = 'scheduled' then v_row.meeting_url end,
    'can_change', v_row.status = 'scheduled' and v_row.starts_at - public.scheduling_link_cutoff() > now(),
    'expires_at', v_row.booking_token_expires_at
  );
end $$;
revoke all on function public.resolve_scheduling_token(text) from public;
grant execute on function public.resolve_scheduling_token(text) to anon, authenticated;

-- What the server needs to compute the link's slots (service role): the
-- panel, the duration, the company, and the cached slots while they're
-- fresh (2 minutes).
create or replace function public.scheduling_link_context(p_token text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_row public.scheduled_interviews%rowtype := public.scheduling_link_row(p_token);
begin
  if v_row.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'application_id', v_row.application_id,
    'company_id', v_row.company_id,
    'job_post_id', v_row.job_post_id,
    'status', v_row.status,
    'duration_minutes', v_row.duration_minutes,
    'starts_at', v_row.starts_at,
    'organizer_user_id', v_row.organizer_user_id,
    'panel', coalesce((select jsonb_agg(p.user_id order by p.created_at, p.user_id)
                         from public.scheduled_interview_panel p where p.interview_id = v_row.id), '[]'::jsonb),
    'cached_slots', case when v_row.slots_cached_at > now() - public.scheduling_slots_ttl() then v_row.slots_cache end
  );
end $$;
revoke all on function public.scheduling_link_context(text) from public, anon, authenticated;
grant execute on function public.scheduling_link_context(text) to service_role;

create or replace function public.save_scheduling_slots(p_id uuid, p_slots jsonb)
returns void
language sql security definer
set search_path = ''
as $$
  update public.scheduled_interviews
     set slots_cache = p_slots, slots_cached_at = now()
   where id = p_id and status in ('awaiting_candidate', 'scheduled')
$$;
revoke all on function public.save_scheduling_slots(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_scheduling_slots(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. The candidate's changes (IVT-060, IV-REQ-021, IV-REQ-022)
-- ---------------------------------------------------------------------------
-- Service role only: the route checks live free/busy before booking and
-- moves the Google event afterwards. Granting these to anon would let a
-- token holder book a busy time with no event behind it.

-- A time the candidate may pick: past the cutoff, inside the horizon.
create or replace function public.scheduling_time_ok(p_starts_at timestamptz)
returns boolean
language sql stable
set search_path = ''
as $$
  select p_starts_at is not null
     and p_starts_at > now() + public.scheduling_link_cutoff()
     and p_starts_at <= now() + interval '15 days'
$$;
revoke all on function public.scheduling_time_ok(timestamptz) from public, anon, authenticated;

create or replace function public.book_by_token(p_token text, p_starts_at timestamptz, p_time_zone text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.scheduled_interviews%rowtype := public.scheduling_link_row(p_token, true);
  v_zone text := nullif(btrim(coalesce(p_time_zone, '')), '');
begin
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_row.status <> 'awaiting_candidate' then
    return jsonb_build_object('ok', false, 'reason', 'already_booked');
  end if;
  if public.application_stage_closed(v_row.application_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.scheduling_time_ok(p_starts_at) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_time');
  end if;
  if v_zone is not null and not public.is_valid_time_zone(v_zone) then
    v_zone := null;
  end if;

  update public.scheduled_interviews
     set status = 'scheduled',
         starts_at = p_starts_at,
         ends_at = p_starts_at + make_interval(mins => duration_minutes),
         time_zone = coalesce(v_zone, time_zone),
         updated_at = now()
   where id = v_row.id and status = 'awaiting_candidate'
  returning * into v_row;

  perform public.log_meeting_event(v_row, 'meeting_scheduled', null, jsonb_build_object(
    'source', 'link', 'by', 'candidate', 'starts_at', v_row.starts_at, 'status', v_row.status
  ));
  return jsonb_build_object('ok', true, 'id', v_row.id, 'application_id', v_row.application_id,
    'starts_at', v_row.starts_at, 'ends_at', v_row.ends_at);
end $$;
revoke all on function public.book_by_token(text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.book_by_token(text, timestamptz, text) to service_role;

create or replace function public.reschedule_by_token(p_token text, p_starts_at timestamptz)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.scheduled_interviews%rowtype := public.scheduling_link_row(p_token, true);
  v_from timestamptz;
begin
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_row.status <> 'scheduled' then
    return jsonb_build_object('ok', false, 'reason', 'not_booked');
  end if;
  if v_row.starts_at - public.scheduling_link_cutoff() <= now() then
    return jsonb_build_object('ok', false, 'reason', 'too_late');
  end if;
  if not public.scheduling_time_ok(p_starts_at) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_time');
  end if;
  if p_starts_at = v_row.starts_at then
    return jsonb_build_object('ok', false, 'reason', 'same_time');
  end if;
  v_from := v_row.starts_at;

  update public.scheduled_interviews
     set starts_at = p_starts_at,
         ends_at = p_starts_at + make_interval(mins => duration_minutes),
         updated_at = now()
   where id = v_row.id and status = 'scheduled'
  returning * into v_row;

  perform public.log_meeting_event(v_row, 'meeting_rescheduled', null, jsonb_build_object(
    'from', v_from, 'starts_at', v_row.starts_at, 'source', 'link', 'by', 'candidate'
  ));
  return jsonb_build_object('ok', true, 'id', v_row.id, 'application_id', v_row.application_id,
    'starts_at', v_row.starts_at, 'ends_at', v_row.ends_at, 'previous_starts_at', v_from);
end $$;
revoke all on function public.reschedule_by_token(text, timestamptz) from public, anon, authenticated;
grant execute on function public.reschedule_by_token(text, timestamptz) to service_role;

-- scheduled → awaiting_candidate for a link interview, so the link works
-- again: the time, the event and the Meet link are cleared, the panel's
-- responses reset. Returns the event to delete. Internal.
create or replace function public.return_interview_to_link(p_id uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old public.scheduled_interviews%rowtype;
  v_row public.scheduled_interviews%rowtype;
begin
  select * into v_old from public.scheduled_interviews where id = p_id for update;
  if not found or v_old.source <> 'link' or v_old.status <> 'scheduled' then
    return jsonb_build_object('ok', true, 'applied', false);
  end if;
  update public.scheduled_interviews
     set status = 'awaiting_candidate',
         starts_at = null,
         ends_at = null,
         provider_event_id = null,
         meeting_url = null,
         booking_token_expires_at = greatest(
           coalesce(booking_link_sent_at, now()) + public.scheduling_link_ttl(),
           now() + public.scheduling_rebook_grace()
         ),
         updated_at = now()
   where id = p_id and status = 'scheduled'
  returning * into v_row;
  update public.scheduled_interview_panel set response = 'needs_action' where interview_id = p_id;
  perform public.log_meeting_event(v_row, 'meeting_cancelled', null, jsonb_build_object(
    'reason', p_reason, 'from', v_old.starts_at, 'awaiting_candidate', true
  ));
  return jsonb_build_object('ok', true, 'applied', true, 'id', v_row.id, 'application_id', v_row.application_id,
    'provider_event_id', v_old.provider_event_id, 'organizer_user_id', v_old.organizer_user_id);
end $$;
revoke all on function public.return_interview_to_link(uuid, text) from public, anon, authenticated;
-- The route also calls it when Google refuses the candidate's booking.
grant execute on function public.return_interview_to_link(uuid, text) to service_role;

create or replace function public.cancel_by_token(p_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.scheduled_interviews%rowtype := public.scheduling_link_row(p_token, true);
begin
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_row.status <> 'scheduled' then
    return jsonb_build_object('ok', false, 'reason', 'not_booked');
  end if;
  if v_row.starts_at - public.scheduling_link_cutoff() <= now() then
    return jsonb_build_object('ok', false, 'reason', 'too_late');
  end if;
  return public.return_interview_to_link(v_row.id, 'candidate');
end $$;
revoke all on function public.cancel_by_token(text) from public, anon, authenticated;
grant execute on function public.cancel_by_token(text) to service_role;

-- The ops queue also takes an event id the row no longer holds (a candidate
-- cancelled a link booking, so the row went back to awaiting_candidate).
drop function if exists public.queue_interview_calendar_op(uuid, text);
create or replace function public.queue_interview_calendar_op(p_interview_id uuid, p_op text, p_event_id text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.scheduled_interviews%rowtype;
  v_event text;
begin
  if p_op not in ('delete', 'update') then
    raise exception 'invalid op: %', p_op using errcode = 'invalid_parameter_value';
  end if;
  if p_event_id is not null and p_op <> 'delete' then
    raise exception 'an explicit event id is only for deletes' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_row from public.scheduled_interviews where id = p_interview_id;
  v_event := coalesce(p_event_id, v_row.provider_event_id);
  if not found or v_event is null then
    return;
  end if;
  perform pgmq.send('interview_calendar_ops', jsonb_build_object(
    'op', p_op,
    'interview_id', v_row.id,
    'company_id', v_row.company_id,
    'organizer_user_id', v_row.organizer_user_id,
    'provider_event_id', v_event
  ));
end $$;
revoke all on function public.queue_interview_calendar_op(uuid, text, text) from public, anon, authenticated;
grant execute on function public.queue_interview_calendar_op(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Rate limit for the public route (IVT-063)
-- ---------------------------------------------------------------------------

-- One row per request, by key ('token:<hash>' or 'ip:<hash>'); only the
-- service role touches it, and rows older than the window are dropped as
-- the key is used.
create table if not exists public.scheduling_link_hits (
  key text not null check (char_length(key) <= 100),
  at timestamptz not null default now()
);
create index if not exists scheduling_link_hits_key_at_idx on public.scheduling_link_hits (key, at);
alter table public.scheduling_link_hits enable row level security;
revoke all on public.scheduling_link_hits from public, anon, authenticated;

-- Records a hit for `p_key` and says whether it's within `p_limit` per
-- `p_window_seconds`. A refused hit isn't recorded.
create or replace function public.take_scheduling_link_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_since timestamptz := now() - make_interval(secs => greatest(p_window_seconds, 1));
begin
  perform pg_advisory_xact_lock(hashtextextended('scheduling_link_hits:' || p_key, 0));
  delete from public.scheduling_link_hits where key = p_key and at < v_since;
  if (select count(*) from public.scheduling_link_hits where key = p_key) >= greatest(p_limit, 0) then
    return false;
  end if;
  insert into public.scheduling_link_hits (key) values (p_key);
  return true;
end $$;
revoke all on function public.take_scheduling_link_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.take_scheduling_link_hit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 6. The applicant's view (IVT-064, IV-REQ-043)
-- ---------------------------------------------------------------------------

-- A GetHired applicant's upcoming interviews: a link waiting for them, or a
-- booked time that hasn't ended. Never the plan snapshot, the panel or
-- scorecards; applicants never read scheduled_interviews itself. Merged
-- applications are left out. `can_reschedule`: a link interview they can
-- still pick or move a time for (rotate_my_scheduling_link opens it).
create or replace function public.my_scheduled_interviews()
returns table (
  id uuid,
  application_id uuid,
  job_title text,
  company_name text,
  interview_name text,
  duration_minutes integer,
  status public.scheduled_interview_status,
  starts_at timestamptz,
  ends_at timestamptz,
  meeting_url text,
  can_reschedule boolean
)
language sql stable security definer
set search_path = ''
as $$
  select i.id, i.application_id, j.title, ci.name, i.name, i.duration_minutes::int, i.status,
         i.starts_at, i.ends_at,
         case when i.status = 'scheduled' then i.meeting_url end,
         i.source = 'link' and i.booking_token_hash is not null
           and (i.status = 'awaiting_candidate'
                or (i.status = 'scheduled' and i.starts_at - public.scheduling_link_cutoff() > now()))
    from public.scheduled_interviews i
    join public.applications a on a.id = i.application_id
    join public.job_postings j on j.id = i.job_post_id
    join public.company_info ci on ci.id = i.company_id
   where a.applicant_user_id = (select auth.uid())
     and a.merged_into_application_id is null
     and (
       (i.status = 'scheduled' and i.ends_at > now())
       or (i.status = 'awaiting_candidate' and i.booking_token_expires_at > now())
     )
   order by i.starts_at nulls first, i.created_at
$$;
revoke all on function public.my_scheduled_interviews() from public, anon;
grant execute on function public.my_scheduled_interviews() to authenticated;

-- Opens the applicant's own link from GetHired: only hashes are stored, so a
-- new token replaces the emailed one (same person, same interview). The
-- expiry doesn't move. Refused unless my_scheduled_interviews says
-- `can_reschedule`.
create or replace function public.rotate_my_scheduling_link(p_interview_id uuid, p_token_hash text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_token');
  end if;
  if not exists (
    select 1 from public.my_scheduled_interviews() m where m.id = p_interview_id and m.can_reschedule
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  update public.scheduled_interviews
     set booking_token_hash = p_token_hash, updated_at = now()
   where id = p_interview_id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.rotate_my_scheduling_link(uuid, text) from public, anon;
grant execute on function public.rotate_my_scheduling_link(uuid, text) to authenticated;
