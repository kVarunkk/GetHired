-- Human interviews, phase 2: Google Calendar
-- (plan/recruiter-interviews/feature-recruiter-interviews-spec.md §4, tasks
-- IVT-032 onwards in feature-recruiter-interviews-tasks.md).
--
--  1. Connections, tokens and pending revocations (IVT-032, IV-SEC-001)
--  2. Member availability (IV-REQ-011)
--  3. The scheduler's per-member status (IV-REQ-012)
--  4. Leaving the company drops the connection (§4 Removal)
--
-- Tokens are encrypted by the app (helpers/calendar/token-crypto.ts) with a
-- key that never reaches the database. Only the service role reads them.

-- ---------------------------------------------------------------------------
-- 1. Connections and tokens
-- ---------------------------------------------------------------------------

-- What a member sees of their own connection. Holds no secrets.
create table if not exists public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.company_info(id) on delete cascade,
  provider text not null default 'google' check (provider in ('google')),
  account_email text not null check (char_length(account_email) between 3 and 320),
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'error')),
  -- A Google error code (`invalid_grant`), never a response body.
  last_error text check (last_error is null or char_length(last_error) <= 200),
  -- When the member was last emailed to reconnect, so it's sent once per error.
  reconnect_emailed_at timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);
create index if not exists calendar_connections_company_idx on public.calendar_connections (company_id);

-- The encrypted tokens, one row per connection. `v<version>:<iv>:<ct+tag>`,
-- bound to (connection_id, user_id, kind) through the AAD.
create table if not exists public.calendar_tokens (
  connection_id uuid primary key references public.calendar_connections(id) on delete cascade,
  refresh_token_enc text not null,
  access_token_enc text,
  access_token_expires_at timestamptz,
  key_version smallint not null check (key_version >= 1),
  refreshed_at timestamptz not null default now()
);

-- A refresh token whose connection was deleted without revoking it (the
-- member left the company, or their account was deleted). The calendar ops
-- worker revokes it at Google and deletes the row. Same lockdown as
-- calendar_tokens: the AAD needs the old connection and user ids.
create table if not exists public.calendar_pending_revocations (
  connection_id uuid primary key,
  user_id uuid not null,
  provider text not null,
  refresh_token_enc text not null,
  key_version smallint not null,
  attempts smallint not null default 0,
  created_at timestamptz not null default now()
);

alter table public.calendar_connections enable row level security;
alter table public.calendar_tokens enable row level security;
alter table public.calendar_pending_revocations enable row level security;

revoke all on table public.calendar_connections, public.calendar_tokens, public.calendar_pending_revocations
  from public, anon, authenticated;
grant select on table public.calendar_connections to authenticated;
grant all on table public.calendar_connections, public.calendar_tokens, public.calendar_pending_revocations
  to service_role;

drop policy if exists "calendar_connections_select_own" on public.calendar_connections;
create policy "calendar_connections_select_own" on public.calendar_connections
  for select to authenticated using (user_id = (select auth.uid()));
-- calendar_tokens and calendar_pending_revocations: RLS on, no policies.

-- Deleting a connection that still has tokens (anything but a disconnect,
-- which revokes first and deletes the tokens) keeps the refresh token for
-- revocation.
create or replace function public.calendar_connection_deleted()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.calendar_pending_revocations (connection_id, user_id, provider, refresh_token_enc, key_version)
  select old.id, old.user_id, old.provider, t.refresh_token_enc, t.key_version
    from public.calendar_tokens t where t.connection_id = old.id
  on conflict (connection_id) do nothing;
  return old;
end $$;
revoke all on function public.calendar_connection_deleted() from public, anon, authenticated;

drop trigger if exists calendar_connections_keep_revocation on public.calendar_connections;
create trigger calendar_connections_keep_revocation
  before delete on public.calendar_connections
  for each row execute function public.calendar_connection_deleted();

-- ---------------------------------------------------------------------------
-- 2. Member availability (IV-REQ-011)
-- ---------------------------------------------------------------------------

-- { "mon": { "start": "HH:MM", "end": "HH:MM" }, ... }; a missing day is off.
-- Mirrors WorkingHours in helpers/calendar/config.ts.
create or replace function public.is_valid_working_hours(p_hours jsonb)
returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare
  v_day text;
  v_value jsonb;
begin
  if p_hours is null or jsonb_typeof(p_hours) <> 'object' then
    return false;
  end if;
  for v_day, v_value in select key, value from jsonb_each(p_hours) loop
    if v_day not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun') or jsonb_typeof(v_value) <> 'object' then
      return false;
    end if;
    if (select count(*) from jsonb_object_keys(v_value)) <> 2
       or coalesce(v_value ->> 'start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(v_value ->> 'end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$'
       or (v_value ->> 'start') >= (v_value ->> 'end') then
      return false;
    end if;
  end loop;
  return true;
end $$;
grant execute on function public.is_valid_working_hours(jsonb) to authenticated, service_role;

create table if not exists public.member_availability (
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.company_info(id) on delete cascade,
  time_zone text not null check (public.is_valid_time_zone(time_zone)),
  working_hours jsonb not null check (public.is_valid_working_hours(working_hours)),
  updated_at timestamptz not null default now(),
  primary key (user_id, company_id)
);

alter table public.member_availability enable row level security;
revoke all on table public.member_availability from public, anon, authenticated;
grant select, insert, update, delete on table public.member_availability to authenticated;
grant all on table public.member_availability to service_role;

drop policy if exists "member_availability_own" on public.member_availability;
create policy "member_availability_own" on public.member_availability
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_company_member(company_id));

-- ---------------------------------------------------------------------------
-- 3. The scheduler's per-member status (IV-REQ-012)
-- ---------------------------------------------------------------------------

-- `connected | error | unknown` for each of `p_user_ids` who is a member of
-- the job's company. Empty without scheduling.manage for the job.
create or replace function public.panel_calendar_status(p_job_post_id uuid, p_user_ids uuid[])
returns table (user_id uuid, status text)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.job_postings where id = p_job_post_id;
  if v_company is null or not public.has_company_permission(v_company, 'scheduling.manage', p_job_post_id) then
    return;
  end if;
  return query
    select m.user_id,
           case c.status when 'active' then 'connected' when 'error' then 'error' else 'unknown' end
      from public.company_members m
      left join public.calendar_connections c
        on c.user_id = m.user_id and c.company_id = m.company_id and c.provider = 'google'
     where m.company_id = v_company and m.user_id = any (coalesce(p_user_ids, '{}'));
end $$;
revoke all on function public.panel_calendar_status(uuid, uuid[]) from public, anon;
grant execute on function public.panel_calendar_status(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Leaving the company (§4 Removal)
-- ---------------------------------------------------------------------------

-- Removal, leaving and account deletion all delete the membership. The
-- connection goes with it (its refresh token is queued for revocation by the
-- trigger above), and so do the member's working hours.
create or replace function public.calendar_member_left()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.calendar_connections where user_id = old.user_id and company_id = old.company_id;
  delete from public.member_availability where user_id = old.user_id and company_id = old.company_id;
  return old;
end $$;
revoke all on function public.calendar_member_left() from public, anon, authenticated;

drop trigger if exists company_members_drop_calendar on public.company_members;
create trigger company_members_drop_calendar
  after delete on public.company_members
  for each row execute function public.calendar_member_left();

-- ---------------------------------------------------------------------------
-- 5. Booking (IVT-043, IV-REQ-020 "Book", D15, D20)
-- ---------------------------------------------------------------------------

-- Who the candidate is for the calendar event (IV-REQ-026, D20): the
-- application person's address, and whether they may be an attendee. An
-- imported candidate who opted out, or anyone without an address, isn't.
create or replace function public.interview_candidate_contact(p_application_id uuid)
returns table (email text, full_name text, attendee boolean)
language sql stable security definer
set search_path = ''
as $$
  select e.email, e.full_name, e.email is not null
    from public.applications a
    left join public.company_candidates c on c.id = a.company_candidate_id
    left join public.user_info u on u.user_id = a.applicant_user_id
    cross join lateral (
      select case
               when a.company_candidate_id is not null then
                 case when c.email_opted_out_at is null then nullif(btrim(c.email), '') end
               else nullif(btrim(u.email), '')
             end as email,
             coalesce(nullif(btrim(c.full_name), ''), nullif(btrim(u.full_name), ''), 'Candidate') as full_name
    ) e
   where a.id = p_application_id
$$;
revoke all on function public.interview_candidate_contact(uuid) from public, anon, authenticated;

-- The scheduler's D20 notice: whether the candidate would get a calendar
-- invite. Only the answer, never the address; null without scheduling.manage.
create or replace function public.interview_candidate_invitable(p_application_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job uuid;
  v_company uuid;
begin
  select a.job_post_id, j.company_id into v_job, v_company
    from public.applications a
    join public.job_postings j on j.id = a.job_post_id
   where a.id = p_application_id;
  if v_company is null or not public.has_company_permission(v_company, 'scheduling.manage', v_job) then
    return null;
  end if;
  return coalesce((select c.attendee from public.interview_candidate_contact(p_application_id) c), false);
end;
$$;
revoke all on function public.interview_candidate_invitable(uuid) from public, anon;
grant execute on function public.interview_candidate_invitable(uuid) to authenticated;

-- The shared body of record_interview and book_interview: checks the caller,
-- the application, the plan item or ad-hoc fields and the panel, then writes
-- the interview, its panel and the timeline event. Internal.
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
  if p_starts_at is null or (p_require_future and p_starts_at <= now()) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_time');
  end if;
  if v_zone is not null and not public.is_valid_time_zone(v_zone) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_time_zone');
  end if;
  if v_url is not null and (char_length(v_url) > 2000 or v_url !~* '^https?://') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_url');
  end if;

  if p_source = 'booked' then
    select coalesce(c.attendee, false) into v_attendee from public.interview_candidate_contact(v_app.id) c;
  end if;

  insert into public.scheduled_interviews (
    company_id, job_post_id, application_id, plan_item_id, stage_id, name, duration_minutes, plan_snapshot,
    status, source, starts_at, ends_at, time_zone, meeting_url, candidate_is_attendee, organizer_user_id, created_by
  ) values (
    v_company, v_app.job_post_id, v_app.id, p_plan_item_id, v_stage, v_name, v_duration, v_snapshot,
    case when p_starts_at + make_interval(mins => v_duration) <= now() then 'completed' else 'scheduled' end
      ::public.scheduled_interview_status,
    p_source, p_starts_at, p_starts_at + make_interval(mins => v_duration), v_zone, v_url,
    coalesce(v_attendee, false),
    -- D15: the booking member's calendar holds the event. A manual
    -- interview is on nobody's calendar.
    case when p_source = 'booked' then v_uid end,
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

-- As in the core migration, over the shared body.
create or replace function public.record_interview(
  p_application_id uuid,
  p_panel uuid[],
  p_starts_at timestamptz,
  p_plan_item_id uuid default null,
  p_name text default null,
  p_duration_minutes integer default null,
  p_meeting_url text default null
)
returns jsonb
language sql security definer
set search_path = ''
as $$
  select public.create_scheduled_interview(
    p_application_id, p_panel, p_starts_at, p_plan_item_id, p_name, p_duration_minutes, p_meeting_url,
    'manual', null, false, false
  )
$$;
revoke all on function public.record_interview(uuid, uuid[], timestamptz, uuid, text, integer, text) from public, anon;
grant execute on function public.record_interview(uuid, uuid[], timestamptz, uuid, text, integer, text) to authenticated;

-- IV-REQ-020 "Book": a future interview organized on the caller's own
-- connected calendar. The app then creates the Google event and stores its
-- id and Meet link; if Google refuses, the app cancels the row.
create or replace function public.book_interview(
  p_application_id uuid,
  p_panel uuid[],
  p_starts_at timestamptz,
  p_plan_item_id uuid default null,
  p_name text default null,
  p_duration_minutes integer default null,
  p_time_zone text default null
)
returns jsonb
language sql security definer
set search_path = ''
as $$
  select public.create_scheduled_interview(
    p_application_id, p_panel, p_starts_at, p_plan_item_id, p_name, p_duration_minutes, null,
    'booked', p_time_zone, true, true
  )
$$;
revoke all on function public.book_interview(uuid, uuid[], timestamptz, uuid, text, integer, text) from public, anon;
grant execute on function public.book_interview(uuid, uuid[], timestamptz, uuid, text, integer, text) to authenticated;

-- What the server needs to create, move or read a Google event: the panel's
-- addresses, the candidate's (only when they're an attendee), and the
-- organizer's active connection. Service role only: it hands out addresses.
create or replace function public.interview_event_details(p_interview_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id,
    'application_id', i.application_id,
    'job_post_id', i.job_post_id,
    'company_id', i.company_id,
    'name', i.name,
    'status', i.status,
    'source', i.source,
    'starts_at', i.starts_at,
    'ends_at', i.ends_at,
    'time_zone', coalesce(i.time_zone, ci.time_zone, 'UTC'),
    'meeting_url', i.meeting_url,
    'provider_event_id', i.provider_event_id,
    'organizer_user_id', i.organizer_user_id,
    'organizer_connection_id', (
      select c.id from public.calendar_connections c
       where c.user_id = i.organizer_user_id and c.company_id = i.company_id
         and c.provider = 'google' and c.status = 'active'
    ),
    'candidate_is_attendee', i.candidate_is_attendee,
    'candidate_name', cc.full_name,
    'candidate_email', case when i.candidate_is_attendee and cc.attendee then cc.email end,
    'job_title', j.title,
    'company_name', ci.name,
    'panel', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', p.user_id, 'email', lower(u.email), 'name', public.member_display_name(p.user_id),
        'response', p.response
      ) order by p.created_at, p.user_id)
        from public.scheduled_interview_panel p
        join auth.users u on u.id = p.user_id
       where p.interview_id = i.id
    ), '[]'::jsonb)
  )
  from public.scheduled_interviews i
  join public.job_postings j on j.id = i.job_post_id
  join public.company_info ci on ci.id = i.company_id
  left join lateral public.interview_candidate_contact(i.application_id) cc on true
  where i.id = p_interview_id
$$;
revoke all on function public.interview_event_details(uuid) from public, anon, authenticated;
grant execute on function public.interview_event_details(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Sync and the calendar ops queue (IVT-046, IVT-047, IV-REQ-023a/025)
-- ---------------------------------------------------------------------------

-- awaiting_candidate | scheduled → cancelled, by the system: the event was
-- deleted in Google Calendar, Google refused a booking, or a link expired.
-- Logged with `p_reason`. Service role.
create or replace function public.cancel_interview_as_system(p_id uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.scheduled_interviews%rowtype;
begin
  update public.scheduled_interviews
     set status = 'cancelled',
         booking_token_expires_at = case when booking_token_hash is null then booking_token_expires_at
                                         else least(booking_token_expires_at, now()) end,
         updated_at = now()
   where id = p_id and status in ('awaiting_candidate', 'scheduled')
  returning * into v_row;
  if not found then
    return jsonb_build_object('ok', true, 'applied', false);
  end if;
  perform public.log_meeting_event(v_row, 'meeting_cancelled', null, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true, 'applied', true, 'application_id', v_row.application_id,
    'provider_event_id', v_row.provider_event_id, 'organizer_user_id', v_row.organizer_user_id);
end $$;
revoke all on function public.cancel_interview_as_system(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_interview_as_system(uuid, text) to service_role;

-- IV-REQ-025: someone moved the event in Google Calendar. A scheduled
-- interview follows it; the timeline records it as a calendar change.
create or replace function public.move_interview_from_calendar(p_id uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old public.scheduled_interviews%rowtype;
  v_row public.scheduled_interviews%rowtype;
begin
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    return jsonb_build_object('ok', false, 'reason', 'invalid_time');
  end if;
  select * into v_old from public.scheduled_interviews where id = p_id for update;
  if not found or v_old.status <> 'scheduled'
     or (v_old.starts_at = p_starts_at and v_old.ends_at = p_ends_at) then
    return jsonb_build_object('ok', true, 'applied', false);
  end if;
  update public.scheduled_interviews
     set starts_at = p_starts_at, ends_at = p_ends_at, updated_at = now()
   where id = p_id and status = 'scheduled'
  returning * into v_row;
  perform public.log_meeting_event(v_row, 'meeting_rescheduled', null, jsonb_build_object(
    'from', v_old.starts_at, 'starts_at', v_row.starts_at, 'source', 'calendar'
  ));
  return jsonb_build_object('ok', true, 'applied', true, 'application_id', v_row.application_id);
end $$;
revoke all on function public.move_interview_from_calendar(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.move_interview_from_calendar(uuid, timestamptz, timestamptz) to service_role;

-- Self-scheduling links past their expiry (IV-SEC-003): awaiting_candidate →
-- cancelled. Returns the ids it cancelled.
create or replace function public.expire_interview_links(p_limit integer default 200)
returns setof uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in
    select id from public.scheduled_interviews
     where status = 'awaiting_candidate' and booking_token_expires_at <= now()
     order by booking_token_expires_at limit greatest(p_limit, 1)
  loop
    if (public.cancel_interview_as_system(v_id, 'link_expired') ->> 'applied')::boolean then
      return next v_id;
    end if;
  end loop;
end $$;
revoke all on function public.expire_interview_links(integer) from public, anon, authenticated;
grant execute on function public.expire_interview_links(integer) to service_role;

-- Google event changes that can't run where they start (a stage move in a
-- transaction, phase 4; or a Google call that failed and should be retried).
-- /api/worker/interview-calendar-ops runs them. Service role only.
do $$
begin
  if not exists (select 1 from pgmq.list_queues() where queue_name = 'interview_calendar_ops') then
    perform pgmq.create('interview_calendar_ops');
  end if;
end $$;
revoke all on pgmq.q_interview_calendar_ops, pgmq.a_interview_calendar_ops from public, anon, authenticated;

-- Queues `p_op` ('delete' | 'update') for an interview's Google event. The
-- worker resolves the organizer's connection when it runs. Internal.
create or replace function public.queue_interview_calendar_op(p_interview_id uuid, p_op text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.scheduled_interviews%rowtype;
begin
  if p_op not in ('delete', 'update') then
    raise exception 'invalid op: %', p_op using errcode = 'invalid_parameter_value';
  end if;
  select * into v_row from public.scheduled_interviews where id = p_interview_id;
  if not found or v_row.provider_event_id is null then
    return;
  end if;
  perform pgmq.send('interview_calendar_ops', jsonb_build_object(
    'op', p_op,
    'interview_id', v_row.id,
    'company_id', v_row.company_id,
    'organizer_user_id', v_row.organizer_user_id,
    'provider_event_id', v_row.provider_event_id
  ));
end $$;
revoke all on function public.queue_interview_calendar_op(uuid, text) from public, anon, authenticated;
grant execute on function public.queue_interview_calendar_op(uuid, text) to service_role;
