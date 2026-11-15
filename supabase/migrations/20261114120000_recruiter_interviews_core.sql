-- Human interviews, phase 1: plans and scorecards without a calendar
-- (plan/recruiter-interviews/feature-recruiter-interviews-spec.md, tasks in
-- feature-recruiter-interviews-tasks.md). The AI voice interview
-- (`job_interview_configs`, `application_interviews`, `interviews.*`) doesn't
-- change.
--
--  1. Permissions (IVT-010/011): four keys, Admin and Member backfill, seed
--  2. company_info.time_zone (D21)
--  3. Enums and tables (§3)
--  4. RLS: reads only; every write goes through the RPCs below
--  5. Blind review: is_scorecard_blind and the note-rating lockdown (IVT-014)
--  6. Interview plans: save_interview_plan, copy_interview_plan (IVT-012)
--  7. Recording and the lifecycle (IVT-016)
--  8. Scorecards (IVT-017)
--  9. The interview kit and "My interviews" (IVT-019, IVT-021)
-- 10. Merges move interviews to the surviving application (IVT-023)
--
-- The windows below are mirrored in helpers/interviews/config.ts
-- (config.test.ts compares them).

-- ---------------------------------------------------------------------------
-- 1. Permissions
-- ---------------------------------------------------------------------------

insert into public.company_permissions (key, scopable, requires) values
  ('scheduling.view', true, '{applicants.view}'),
  ('scheduling.manage', true, '{scheduling.view}'),
  ('interview_plans.manage', true, '{jobs.view}'),
  ('scorecards.view_all', true, '{scheduling.view}')
on conflict (key) do update set scopable = excluded.scopable, requires = excluded.requires;

-- Admin: every permission but company.profile (RP-REQ-004).
insert into public.company_role_permissions (role_id, permission_key, scope)
select r.id, k, 'all'
  from public.company_roles r
 cross join unnest(array['scheduling.view', 'scheduling.manage', 'interview_plans.manage', 'scorecards.view_all']) k
 where r.template_key = 'admin'
on conflict do nothing;

-- Member: scheduling, not plans or everyone's feedback.
insert into public.company_role_permissions (role_id, permission_key, scope)
select r.id, k, 'all'
  from public.company_roles r
 cross join unnest(array['scheduling.view', 'scheduling.manage']) k
 where r.template_key = 'member'
on conflict do nothing;

-- New companies get the same keys (helpers/companies/role-templates.ts).
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
                'interviews.view', 'scheduling.view', 'scheduling.manage', 'notes.view', 'notes.write',
                'talent.view', 'talent.save', 'talent_lists.manage', 'matching.run', 'outreach.view',
                'outreach.send', 'agent.use', 'team.view', 'roles.view', 'billing.view']
        ) k;
      insert into public.company_role_permissions (role_id, permission_key, scope)
      select v_member, k, 'assigned'
        from unnest(
          -- @member-assigned-keys (helpers/companies/role-templates.ts MEMBER_ASSIGNED_KEYS)
          array['applicants.import']
        ) k;
    end if;
  end if;

  update public.company_info set default_role_id = v_member
   where id = p_company_id and default_role_id is null and v_member is not null;
end $$;

revoke all on function public.seed_company_roles(uuid) from public, anon, authenticated;
grant execute on function public.seed_company_roles(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. company_info.time_zone (D21)
-- ---------------------------------------------------------------------------

-- An IANA zone Postgres knows. Stable, not immutable: the zone list comes
-- with the server, so it's only checked on write.
create or replace function public.is_valid_time_zone(p_zone text)
returns boolean
language sql stable
set search_path = ''
as $$
  select p_zone is not null
     and char_length(p_zone) between 1 and 64
     and exists (select 1 from pg_catalog.pg_timezone_names where name = p_zone)
$$;
grant execute on function public.is_valid_time_zone(text) to authenticated, service_role;

alter table public.company_info add column if not exists time_zone text;
alter table public.company_info drop constraint if exists company_info_time_zone_check;
alter table public.company_info add constraint company_info_time_zone_check
  check (time_zone is null or public.is_valid_time_zone(time_zone));

-- Settings → Scheduling sets the zone (settings.scheduling), and company
-- onboarding sets it from the creator's browser. As in 20261017160000, plus
-- `time_zone`; an unknown zone fails the column check (invalid_input).
create or replace function public.update_company_settings(p_settings jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_company uuid := public.my_company_id();
begin
  if v_company is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object'
     or exists (
       select 1 from jsonb_object_keys(p_settings) k
        where k not in ('scheduling_url', 'notify_new_applicants', 'notify_weekly_matches', 'time_zone')
     ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;
  if ((p_settings ? 'scheduling_url' or p_settings ? 'time_zone')
       and not public.has_company_permission(v_company, 'settings.scheduling'))
     or ((p_settings ? 'notify_new_applicants' or p_settings ? 'notify_weekly_matches')
         and not public.has_company_permission(v_company, 'settings.notifications')) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  update public.company_info set
    scheduling_url = case when p_settings ? 'scheduling_url'
                          then nullif(p_settings ->> 'scheduling_url', '') else scheduling_url end,
    notify_new_applicants = case when p_settings ? 'notify_new_applicants'
                                 then p_settings ->> 'notify_new_applicants' else notify_new_applicants end,
    notify_weekly_matches = case when p_settings ? 'notify_weekly_matches'
                                 then (p_settings ->> 'notify_weekly_matches')::boolean else notify_weekly_matches end,
    time_zone = case when p_settings ? 'time_zone'
                     then nullif(p_settings ->> 'time_zone', '') else time_zone end,
    updated_at = now()
  where id = v_company;
  return jsonb_build_object('ok', true);
exception
  when check_violation or invalid_text_representation then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Enums and tables
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.scheduled_interview_status as enum
    ('awaiting_candidate', 'scheduled', 'completed', 'cancelled', 'no_show');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.scheduled_interview_source as enum ('booked', 'link', 'manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.interview_panel_response as enum ('needs_action', 'accepted', 'declined', 'tentative');
exception when duplicate_object then null; end $$;

-- The windows (IV-REQ-024/032/034). helpers/interviews/config.ts mirrors them.
create or replace function public.scorecard_blind_window() returns interval
language sql immutable set search_path = '' as $$ select interval '7 days' $$;
create or replace function public.interview_kit_grace() returns interval
language sql immutable set search_path = '' as $$ select interval '7 days' $$;
create or replace function public.interview_no_show_window() returns interval
language sql immutable set search_path = '' as $$ select interval '7 days' $$;
create or replace function public.scorecard_note_edit_window() returns interval
language sql immutable set search_path = '' as $$ select interval '24 hours' $$;

-- IV-REQ-001: a job's plan, one row per plan interview.
create table if not exists public.job_interview_plan_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_info(id) on delete cascade,
  job_post_id uuid not null references public.job_postings(id) on delete cascade,
  stage_id uuid not null references public.pipeline_stages(id) on delete cascade,
  position smallint not null check (position >= 0),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  duration_minutes smallint not null default 45 check (duration_minutes between 15 and 240),
  instructions text not null default '' check (char_length(instructions) <= 2000),
  default_interviewer_ids uuid[] not null default '{}'
    check (cardinality(default_interviewer_ids) <= 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists job_interview_plan_items_job_idx on public.job_interview_plan_items (job_post_id, position);

create table if not exists public.job_interview_competencies (
  id uuid primary key default gen_random_uuid(),
  plan_item_id uuid not null references public.job_interview_plan_items(id) on delete cascade,
  position smallint not null check (position >= 0),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  questions text[] not null default '{}' check (cardinality(questions) <= 10),
  created_at timestamptz not null default now()
);
create index if not exists job_interview_competencies_item_idx on public.job_interview_competencies (plan_item_id, position);

-- §3: an interview with people. `plan_snapshot` is the plan interview as it
-- was when this was created (IV-REQ-003): { name, duration_minutes,
-- instructions, stage_id, competencies: [{ id, name, description, questions }] }.
-- `stage_id` is the stage it was planned under (the application's stage for
-- an ad-hoc one), so the Interviews section can group by stage.
create table if not exists public.scheduled_interviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_info(id) on delete cascade,
  job_post_id uuid not null references public.job_postings(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  plan_item_id uuid references public.job_interview_plan_items(id) on delete set null,
  stage_id uuid references public.pipeline_stages(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  duration_minutes smallint not null check (duration_minutes between 15 and 240),
  plan_snapshot jsonb not null default '{}'::jsonb,
  status public.scheduled_interview_status not null,
  source public.scheduled_interview_source not null,
  starts_at timestamptz,
  ends_at timestamptz,
  time_zone text check (time_zone is null or public.is_valid_time_zone(time_zone)),
  meeting_url text check (meeting_url is null or (char_length(meeting_url) <= 2000 and meeting_url ~* '^https?://')),
  candidate_is_attendee boolean not null default false,
  organizer_user_id uuid references auth.users(id) on delete set null,
  provider_event_id text,
  booking_token_hash text unique check (booking_token_hash is null or booking_token_hash ~ '^[0-9a-f]{64}$'),
  booking_token_expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_interviews_times check (
    (starts_at is null and ends_at is null) or (starts_at is not null and ends_at > starts_at)
  ),
  -- Only a link waiting for the candidate (or one cancelled before booking) has no time.
  constraint scheduled_interviews_time_required check (
    starts_at is not null or status in ('awaiting_candidate', 'cancelled')
  )
);
create index if not exists scheduled_interviews_application_idx on public.scheduled_interviews (application_id);
create index if not exists scheduled_interviews_job_status_idx on public.scheduled_interviews (job_post_id, status);
create index if not exists scheduled_interviews_status_ends_idx on public.scheduled_interviews (status, ends_at);

create table if not exists public.scheduled_interview_panel (
  interview_id uuid not null references public.scheduled_interviews(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.company_info(id) on delete cascade,
  response public.interview_panel_response not null default 'needs_action',
  feedback_requested_at timestamptz,
  feedback_reminded_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (interview_id, user_id)
);
create index if not exists scheduled_interview_panel_user_idx on public.scheduled_interview_panel (user_id);

-- IV-REQ-030: one per interviewer. `ratings` is keyed by the snapshot's
-- competency ids: { "<id>": { "rating": candidate_rating | null, "note": text } }.
create table if not exists public.interview_scorecards (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.scheduled_interviews(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  company_id uuid not null references public.company_info(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  overall public.candidate_rating,
  overall_note text not null default '' check (char_length(overall_note) <= 5000),
  ratings jsonb not null default '{}'::jsonb check (jsonb_typeof(ratings) = 'object'),
  submitted_at timestamptz,
  -- When the notes stop being editable (D19): submitted_at + 24 h.
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (interview_id, author_user_id),
  constraint interview_scorecards_submitted check (
    (status = 'draft' and submitted_at is null and locked_at is null)
    or (status = 'submitted' and submitted_at is not null and locked_at is not null and overall is not null)
  )
);
create index if not exists interview_scorecards_application_idx on public.interview_scorecards (application_id);

-- D19: each note edit after submitting.
create table if not exists public.interview_scorecard_edits (
  id uuid primary key default gen_random_uuid(),
  scorecard_id uuid not null references public.interview_scorecards(id) on delete cascade,
  field text not null check (char_length(field) between 1 and 80),
  old_text text not null,
  new_text text not null,
  edited_at timestamptz not null default now()
);
create index if not exists interview_scorecard_edits_scorecard_idx on public.interview_scorecard_edits (scorecard_id);

-- IV-REQ-051: written in phase 5.
create table if not exists public.interview_feedback_summaries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_info(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  scorecard_ids uuid[] not null default '{}',
  summary jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists interview_feedback_summaries_application_idx
  on public.interview_feedback_summaries (application_id, created_at desc);

-- The timeline's new kinds (IV-REQ-042). The AI interview's own kinds stay.
alter table public.application_events drop constraint if exists application_events_type_check;
alter table public.application_events add constraint application_events_type_check check (type in (
  'applied', 'stage_changed', 'email_sent', 'note_added', 'screened', 'outreach_sent', 'outreach_replied',
  'interview_invited', 'interview_started', 'interview_completed', 'interview_expired',
  'interview_declined', 'interview_cancelled', 'interview_accommodation_requested',
  'interview_extended', 'interview_attempt_granted', 'interview_reopened',
  'imported', 'claimed', 'merged',
  'meeting_scheduled', 'meeting_rescheduled', 'meeting_panel_changed', 'meeting_cancelled',
  'meeting_completed', 'meeting_no_show', 'scorecard_submitted'
));

-- ---------------------------------------------------------------------------
-- 4. RLS: reads only
-- ---------------------------------------------------------------------------

alter table public.job_interview_plan_items enable row level security;
alter table public.job_interview_competencies enable row level security;
alter table public.scheduled_interviews enable row level security;
alter table public.scheduled_interview_panel enable row level security;
alter table public.interview_scorecards enable row level security;
alter table public.interview_scorecard_edits enable row level security;
alter table public.interview_feedback_summaries enable row level security;

revoke all on table public.job_interview_plan_items, public.job_interview_competencies,
  public.scheduled_interviews, public.scheduled_interview_panel, public.interview_scorecards,
  public.interview_scorecard_edits, public.interview_feedback_summaries from anon, authenticated;
grant select on table public.job_interview_plan_items, public.job_interview_competencies,
  public.scheduled_interviews, public.scheduled_interview_panel, public.interview_scorecards,
  public.interview_scorecard_edits, public.interview_feedback_summaries to authenticated;
grant all on table public.job_interview_plan_items, public.job_interview_competencies,
  public.scheduled_interviews, public.scheduled_interview_panel, public.interview_scorecards,
  public.interview_scorecard_edits, public.interview_feedback_summaries to service_role;

drop policy if exists "plan_items_select" on public.job_interview_plan_items;
create policy "plan_items_select" on public.job_interview_plan_items
  for select to authenticated using (
    job_post_id = any ((select public.my_job_ids_with('scheduling.view'))::uuid[])
    or job_post_id = any ((select public.my_job_ids_with('interview_plans.manage'))::uuid[])
  );

drop policy if exists "plan_competencies_select" on public.job_interview_competencies;
create policy "plan_competencies_select" on public.job_interview_competencies
  for select to authenticated using (
    plan_item_id in (select id from public.job_interview_plan_items)
  );

-- Panel-only members read their interviews through get_interview_kit and
-- list_my_interviews, never the table.
drop policy if exists "scheduled_interviews_select" on public.scheduled_interviews;
create policy "scheduled_interviews_select" on public.scheduled_interviews
  for select to authenticated using (
    job_post_id = any ((select public.my_job_ids_with('scheduling.view'))::uuid[])
  );

drop policy if exists "scheduled_interview_panel_select" on public.scheduled_interview_panel;
create policy "scheduled_interview_panel_select" on public.scheduled_interview_panel
  for select to authenticated using (
    user_id = (select auth.uid())
    or interview_id in (select id from public.scheduled_interviews)
  );

drop policy if exists "interview_feedback_summaries_select" on public.interview_feedback_summaries;
create policy "interview_feedback_summaries_select" on public.interview_feedback_summaries
  for select to authenticated using (
    public.has_company_permission(company_id, 'scorecards.view_all', public.application_job_id(application_id))
  );

-- ---------------------------------------------------------------------------
-- 5. Blind review (IV-REQ-032, IV-REQ-032a)
-- ---------------------------------------------------------------------------

-- A member is blind on an application while they're on the panel of one of
-- its interviews that is `scheduled`, or `completed` less than 7 days ago,
-- and haven't submitted their scorecard for it. A missing row is unsubmitted.
create or replace function public.is_scorecard_blind(p_application_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_application_id is not null and p_user_id is not null and exists (
    select 1
      from public.scheduled_interviews i
      join public.scheduled_interview_panel p on p.interview_id = i.id and p.user_id = p_user_id
     where i.application_id = p_application_id
       and (i.status = 'scheduled'
            or (i.status = 'completed' and i.ends_at > now() - public.scorecard_blind_window()))
       and not exists (
         select 1 from public.interview_scorecards s
          where s.interview_id = i.id and s.author_user_id = p_user_id and s.status = 'submitted'
       )
  )
$$;
revoke all on function public.is_scorecard_blind(uuid, uuid) from public, anon;
grant execute on function public.is_scorecard_blind(uuid, uuid) to authenticated, service_role;

-- Whether the session user may read another member's submitted scorecard on
-- this application: everyone's feedback, or scheduling.view while not blind.
create or replace function public.can_read_scorecards(p_company_id uuid, p_application_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.has_company_permission(p_company_id, 'scorecards.view_all', public.application_job_id(p_application_id))
      or (public.has_company_permission(p_company_id, 'scheduling.view', public.application_job_id(p_application_id))
          and not public.is_scorecard_blind(p_application_id, (select auth.uid())))
$$;
revoke all on function public.can_read_scorecards(uuid, uuid) from public, anon;
grant execute on function public.can_read_scorecards(uuid, uuid) to authenticated;

drop policy if exists "interview_scorecards_select" on public.interview_scorecards;
create policy "interview_scorecards_select" on public.interview_scorecards
  for select to authenticated using (
    author_user_id = (select auth.uid())
    or (status = 'submitted' and public.can_read_scorecards(company_id, application_id))
  );

drop policy if exists "interview_scorecard_edits_select" on public.interview_scorecard_edits;
create policy "interview_scorecard_edits_select" on public.interview_scorecard_edits
  for select to authenticated using (
    scorecard_id in (select id from public.interview_scorecards)
  );

-- IV-REQ-032a: nobody reads `candidate_notes.rating` directly. The two RPCs
-- below return it, masked while the reader is blind.
revoke select on table public.candidate_notes from authenticated;
grant select (id, company_id, candidate_user_id, application_id, author_user_id, author_name, body,
              created_at, updated_at)
  on table public.candidate_notes to authenticated;

-- The candidate_notes select policy, for the definer RPCs below.
create or replace function public.can_read_note(p_note public.candidate_notes)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_note.company_id = public.my_company_id() and (
    (p_note.application_id is null and public.has_company_permission(p_note.company_id, 'notes.view'))
    or (p_note.application_id is not null
        and public.application_job_id(p_note.application_id) = any ((select public.my_job_ids_with('notes.view'))::uuid[]))
  )
$$;
revoke all on function public.can_read_note(public.candidate_notes) from public, anon, authenticated;

-- The company's notes on an application, on a candidate (every note with
-- that candidate user, as listNotes does), or one note by id; newest first.
-- `rating` is null and `rating_hidden` true for someone else's rated note
-- while the reader is blind on its application. The author always sees
-- their own.
create or replace function public.list_candidate_notes(
  p_application_id uuid default null, p_candidate_user_id uuid default null, p_note_id uuid default null
)
returns table (
  id uuid, company_id uuid, candidate_user_id uuid, application_id uuid, author_user_id uuid,
  author_name text, body text, rating public.candidate_rating, rating_hidden boolean,
  created_at timestamptz, updated_at timestamptz
)
language sql stable security definer
set search_path = ''
as $$
  select n.id, n.company_id, n.candidate_user_id, n.application_id, n.author_user_id, n.author_name, n.body,
         case when x.hidden then null else n.rating end,
         x.hidden,
         n.created_at, n.updated_at
    from public.candidate_notes n
   cross join lateral (
     select n.rating is not null
        and n.author_user_id <> (select auth.uid())
        and public.is_scorecard_blind(n.application_id, (select auth.uid())) as hidden
   ) x
   where (p_application_id is not null or p_candidate_user_id is not null or p_note_id is not null)
     and (p_application_id is null or n.application_id = p_application_id)
     and (p_candidate_user_id is null or n.candidate_user_id = p_candidate_user_id)
     and (p_note_id is null or n.id = p_note_id)
     and public.can_read_note(n)
   order by n.created_at desc
$$;
revoke all on function public.list_candidate_notes(uuid, uuid, uuid) from public, anon;
grant execute on function public.list_candidate_notes(uuid, uuid, uuid) to authenticated;

-- IV-REQ-032a's name for the application case.
create or replace function public.list_application_notes(p_application_id uuid)
returns table (
  id uuid, company_id uuid, candidate_user_id uuid, application_id uuid, author_user_id uuid,
  author_name text, body text, rating public.candidate_rating, rating_hidden boolean,
  created_at timestamptz, updated_at timestamptz
)
language sql stable security definer
set search_path = ''
as $$
  select * from public.list_candidate_notes(p_application_id, null, null)
$$;
revoke all on function public.list_application_notes(uuid) from public, anon;
grant execute on function public.list_application_notes(uuid) to authenticated;

-- The board's note counts and ratings for one job, one row per note on a
-- live application, masked like list_candidate_notes. Empty without
-- notes.view for the job.
create or replace function public.list_job_note_ratings(p_job_post_id uuid)
returns table (application_id uuid, rating public.candidate_rating, rating_hidden boolean)
language sql stable security definer
set search_path = ''
as $$
  select n.application_id,
         case when x.hidden then null else n.rating end,
         x.hidden
    from public.candidate_notes n
    join public.applications a on a.id = n.application_id
    join public.job_postings jp on jp.id = a.job_post_id
   cross join lateral (
     select n.rating is not null
        and n.author_user_id <> (select auth.uid())
        and public.is_scorecard_blind(n.application_id, (select auth.uid())) as hidden
   ) x
   where a.job_post_id = p_job_post_id
     and jp.company_id = public.my_company_id()
     and n.company_id = jp.company_id
     and public.has_company_permission(jp.company_id, 'notes.view', p_job_post_id)
$$;
revoke all on function public.list_job_note_ratings(uuid) from public, anon;
grant execute on function public.list_job_note_ratings(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Interview plans (IV-REQ-001–005)
-- ---------------------------------------------------------------------------

-- Replaces a job's plan in one transaction. `p_items` is an ordered array of
-- { id?, stage_id, name, duration_minutes, instructions, default_interviewer_ids,
--   competencies: [{ id?, name, description, questions }] }.
-- Ids that are sent (and belong to this job) are kept, so scheduled
-- interviews' snapshots and scorecards keep matching (IV-REQ-003); the rest
-- are new. Text is screened for fairness before the call (helpers/interviews/plan.ts).
create or replace function public.save_interview_plan(p_job_post_id uuid, p_items jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_item jsonb;
  v_comp jsonb;
  v_item_pos int := 0;
  v_comp_pos int;
  v_item_id uuid;
  v_comp_id uuid;
  v_stage public.pipeline_stages%rowtype;
  v_ids uuid[];
  v_keep_items uuid[] := '{}';
  v_keep_comps uuid[] := '{}';
  v_questions text[];
  v_name text;
  v_duration int;
begin
  select company_id into v_company from public.job_postings where id = p_job_post_id;
  if v_company is null or not public.is_company_member(v_company) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.has_company_permission(v_company, 'interview_plans.manage', p_job_post_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 20 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_plan');
  end if;

  -- One save at a time per job.
  perform 1 from public.job_postings where id = p_job_post_id for update;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_name := btrim(coalesce(v_item ->> 'name', ''));
    v_duration := coalesce((v_item ->> 'duration_minutes')::int, 45);
    if char_length(v_name) not between 1 and 80
       or v_duration not between 15 and 240
       or char_length(coalesce(v_item ->> 'instructions', '')) > 2000
       or jsonb_typeof(coalesce(v_item -> 'competencies', 'null')) <> 'array'
       or jsonb_array_length(v_item -> 'competencies') not between 1 and 10 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_plan');
    end if;

    select * into v_stage from public.pipeline_stages where id = public.try_uuid(v_item ->> 'stage_id');
    if not found or v_stage.company_id <> v_company then
      return jsonb_build_object('ok', false, 'reason', 'invalid_stage');
    end if;
    if v_stage.archived or v_stage.kind in ('rejected', 'hired') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_stage');
    end if;

    select coalesce(array_agg(distinct public.try_uuid(x)), '{}') into v_ids
      from jsonb_array_elements_text(coalesce(v_item -> 'default_interviewer_ids', '[]'::jsonb)) x;
    if array_position(v_ids, null) is not null or cardinality(v_ids) > 6
       or exists (
         select 1 from unnest(v_ids) u
          where not exists (select 1 from public.company_members m where m.company_id = v_company and m.user_id = u)
       ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_interviewers');
    end if;

    v_item_id := public.try_uuid(v_item ->> 'id');
    if v_item_id is not null and not exists (
      select 1 from public.job_interview_plan_items where id = v_item_id and job_post_id = p_job_post_id
    ) then
      v_item_id := null;
    end if;

    if v_item_id is null then
      insert into public.job_interview_plan_items
        (company_id, job_post_id, stage_id, position, name, duration_minutes, instructions, default_interviewer_ids)
      values (v_company, p_job_post_id, v_stage.id, v_item_pos, v_name, v_duration,
              coalesce(v_item ->> 'instructions', ''), v_ids)
      returning id into v_item_id;
    else
      update public.job_interview_plan_items
         set stage_id = v_stage.id, position = v_item_pos, name = v_name, duration_minutes = v_duration,
             instructions = coalesce(v_item ->> 'instructions', ''), default_interviewer_ids = v_ids,
             updated_at = now()
       where id = v_item_id;
    end if;
    v_keep_items := v_keep_items || v_item_id;

    v_comp_pos := 0;
    for v_comp in select value from jsonb_array_elements(v_item -> 'competencies') loop
      select coalesce(array_agg(btrim(q)), '{}') into v_questions
        from jsonb_array_elements_text(coalesce(v_comp -> 'questions', '[]'::jsonb)) q
       where btrim(q) <> '';
      if char_length(btrim(coalesce(v_comp ->> 'name', ''))) not between 1 and 80
         or char_length(coalesce(v_comp ->> 'description', '')) > 500
         or cardinality(v_questions) > 10
         or exists (select 1 from unnest(v_questions) q where char_length(q) > 300) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_plan');
      end if;

      v_comp_id := public.try_uuid(v_comp ->> 'id');
      if v_comp_id is not null and not exists (
        select 1 from public.job_interview_competencies c
          join public.job_interview_plan_items i on i.id = c.plan_item_id
         where c.id = v_comp_id and i.job_post_id = p_job_post_id
      ) then
        v_comp_id := null;
      end if;

      if v_comp_id is null then
        insert into public.job_interview_competencies (plan_item_id, position, name, description, questions)
        values (v_item_id, v_comp_pos, btrim(v_comp ->> 'name'), coalesce(v_comp ->> 'description', ''), v_questions)
        returning id into v_comp_id;
      else
        update public.job_interview_competencies
           set plan_item_id = v_item_id, position = v_comp_pos, name = btrim(v_comp ->> 'name'),
               description = coalesce(v_comp ->> 'description', ''), questions = v_questions
         where id = v_comp_id;
      end if;
      v_keep_comps := v_keep_comps || v_comp_id;
      v_comp_pos := v_comp_pos + 1;
    end loop;

    v_item_pos := v_item_pos + 1;
  end loop;

  delete from public.job_interview_competencies c
   using public.job_interview_plan_items i
   where i.id = c.plan_item_id and i.job_post_id = p_job_post_id and c.id <> all (v_keep_comps);
  delete from public.job_interview_plan_items
   where job_post_id = p_job_post_id and id <> all (v_keep_items);

  return jsonb_build_object('ok', true, 'items', cardinality(v_keep_items));
end $$;
revoke all on function public.save_interview_plan(uuid, jsonb) from public, anon;
grant execute on function public.save_interview_plan(uuid, jsonb) to authenticated;

-- IV-REQ-004: replaces `p_to_job`'s plan with a copy of `p_from_job`'s.
-- Stages are the company's, so they carry over as they are. Default
-- interviewers who can't view the target job are dropped and returned.
create or replace function public.copy_interview_plan(p_from_job uuid, p_to_job uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_from_company uuid;
  v_item public.job_interview_plan_items%rowtype;
  v_new uuid;
  v_ids uuid[];
  v_dropped uuid[] := '{}';
  v_count int := 0;
begin
  select company_id into v_company from public.job_postings where id = p_to_job;
  select company_id into v_from_company from public.job_postings where id = p_from_job;
  if v_company is null or v_from_company is distinct from v_company or not public.is_company_member(v_company)
     or p_from_job = p_to_job then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.has_company_permission(v_company, 'interview_plans.manage', p_to_job)
     or not (public.has_company_permission(v_company, 'scheduling.view', p_from_job)
             or public.has_company_permission(v_company, 'interview_plans.manage', p_from_job)) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  perform 1 from public.job_postings where id = p_to_job for update;
  delete from public.job_interview_plan_items where job_post_id = p_to_job;

  for v_item in
    select i.* from public.job_interview_plan_items i
      join public.pipeline_stages s on s.id = i.stage_id
     where i.job_post_id = p_from_job and not s.archived and s.kind not in ('rejected', 'hired')
     order by i.position
  loop
    -- Someone who could see the source job may not see the target one.
    select coalesce(array_agg(u), '{}') into v_ids
      from unnest(v_item.default_interviewer_ids) u
     where exists (
       select 1 from public.company_members m
        where m.company_id = v_company and m.user_id = u
          and (m.is_owner or exists (
            select 1 from public.company_role_permissions rp
             where rp.role_id = m.role_id and rp.permission_key = 'jobs.view'
               and (rp.scope = 'all' or exists (
                 select 1 from public.company_job_assignments ja
                  where ja.job_post_id = p_to_job and ja.user_id = u
               ))
          ))
     );
    v_dropped := v_dropped || array(
      select u from unnest(v_item.default_interviewer_ids) u where u <> all (v_ids) and u <> all (v_dropped)
    );

    insert into public.job_interview_plan_items
      (company_id, job_post_id, stage_id, position, name, duration_minutes, instructions, default_interviewer_ids)
    values (v_company, p_to_job, v_item.stage_id, v_count, v_item.name, v_item.duration_minutes,
            v_item.instructions, v_ids)
    returning id into v_new;

    insert into public.job_interview_competencies (plan_item_id, position, name, description, questions)
    select v_new, c.position, c.name, c.description, c.questions
      from public.job_interview_competencies c where c.plan_item_id = v_item.id;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'items', v_count, 'dropped_interviewer_ids', to_jsonb(v_dropped));
end $$;
revoke all on function public.copy_interview_plan(uuid, uuid) from public, anon;
grant execute on function public.copy_interview_plan(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Recording and the lifecycle (IV-REQ-020 manual, IV-REQ-024, IV-REQ-042)
-- ---------------------------------------------------------------------------

create or replace function public.log_meeting_event(
  p_interview public.scheduled_interviews, p_type text, p_actor uuid, p_payload jsonb default '{}'::jsonb
)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.application_events
    (company_id, application_id, candidate_user_id, actor_user_id, actor_name, type, payload)
  select p_interview.company_id, p_interview.application_id, a.applicant_user_id, p_actor,
         case when p_actor is null then null else public.member_display_name(p_actor) end,
         p_type,
         jsonb_build_object('scheduled_interview_id', p_interview.id, 'name', p_interview.name)
           || coalesce(p_payload, '{}'::jsonb)
    from public.applications a where a.id = p_interview.application_id
$$;
revoke all on function public.log_meeting_event(public.scheduled_interviews, text, uuid, jsonb)
  from public, anon, authenticated;

-- A distinct, 1–6 member panel of `p_company`, or null.
create or replace function public.valid_interview_panel(p_company uuid, p_panel uuid[])
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select case
    when p_panel is null or array_position(p_panel, null) is not null then null
    when (select count(distinct u) from unnest(p_panel) u) not between 1 and 6 then null
    when exists (
      select 1 from unnest(p_panel) u
       where not exists (select 1 from public.company_members m where m.company_id = p_company and m.user_id = u)
    ) then null
    else (select array_agg(distinct u) from unnest(p_panel) u)
  end
$$;
revoke all on function public.valid_interview_panel(uuid, uuid[]) from public, anon, authenticated;

-- A plan interview's snapshot (IV-REQ-003).
create or replace function public.plan_item_snapshot(p_plan_item_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'plan_item_id', i.id,
    'name', i.name,
    'duration_minutes', i.duration_minutes,
    'instructions', i.instructions,
    'stage_id', i.stage_id,
    'competencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'description', c.description, 'questions', to_jsonb(c.questions)
      ) order by c.position)
        from public.job_interview_competencies c where c.plan_item_id = i.id
    ), '[]'::jsonb)
  )
  from public.job_interview_plan_items i where i.id = p_plan_item_id
$$;
revoke all on function public.plan_item_snapshot(uuid) from public, anon, authenticated;

-- Records an interview arranged outside GetHired (IV-REQ-020 "Record
-- manually"): a plan interview or an ad-hoc one (a name and duration, no
-- competencies), a panel and a start time. Nobody is emailed. Past
-- interviews are recorded as completed.
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
  if p_starts_at is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_time');
  end if;
  if v_url is not null and (char_length(v_url) > 2000 or v_url !~* '^https?://') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_url');
  end if;

  insert into public.scheduled_interviews (
    company_id, job_post_id, application_id, plan_item_id, stage_id, name, duration_minutes, plan_snapshot,
    status, source, starts_at, ends_at, meeting_url, organizer_user_id, created_by
  ) values (
    v_company, v_app.job_post_id, v_app.id, p_plan_item_id, v_stage, v_name, v_duration, v_snapshot,
    case when p_starts_at + make_interval(mins => v_duration) <= now() then 'completed' else 'scheduled' end
      ::public.scheduled_interview_status,
    -- No organizer: nothing is on anyone's calendar (D15 is for booked events).
    'manual', p_starts_at, p_starts_at + make_interval(mins => v_duration), v_url, null, v_uid
  ) returning * into v_row;

  insert into public.scheduled_interview_panel (interview_id, user_id, company_id)
  select v_row.id, u, v_company from unnest(v_panel) u;

  perform public.log_meeting_event(v_row, 'meeting_scheduled', v_uid, jsonb_build_object(
    'source', v_row.source, 'starts_at', v_row.starts_at, 'status', v_row.status
  ));

  return jsonb_build_object('ok', true, 'id', v_row.id, 'application_id', v_row.application_id, 'status', v_row.status);
end $$;
revoke all on function public.record_interview(uuid, uuid[], timestamptz, uuid, text, integer, text) from public, anon;
grant execute on function public.record_interview(uuid, uuid[], timestamptz, uuid, text, integer, text) to authenticated;

-- The interview for a recruiter action, locked: { row } or { reason }.
create or replace function public.managed_interview(p_id uuid)
returns public.scheduled_interviews
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.scheduled_interviews%rowtype;
begin
  select * into v_row from public.scheduled_interviews where id = p_id for update;
  if not found or not public.is_company_member(v_row.company_id) then
    raise exception using errcode = 'P0001', message = 'IV_NOT_FOUND';
  end if;
  if not public.has_company_permission(v_row.company_id, 'scheduling.manage', v_row.job_post_id) then
    raise exception using errcode = 'P0001', message = 'IV_FORBIDDEN';
  end if;
  return v_row;
end $$;
revoke all on function public.managed_interview(uuid) from public, anon, authenticated;

create or replace function public.interview_reason(p_message text)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object('ok', false, 'reason',
    case p_message when 'IV_NOT_FOUND' then 'not_found' when 'IV_FORBIDDEN' then 'forbidden' else 'error' end)
$$;
revoke all on function public.interview_reason(text) from public, anon, authenticated;

-- Moves a scheduled interview, changes its panel or its meeting link
-- (IV-REQ-023). A panel member who's removed loses their draft scorecard;
-- a submitted one stays. Returns what the calendar provider needs to follow.
create or replace function public.update_interview(
  p_id uuid,
  p_starts_at timestamptz default null,
  p_panel uuid[] default null,
  p_meeting_url text default null,
  p_clear_meeting_url boolean default false
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.scheduled_interviews%rowtype;
  v_old public.scheduled_interviews%rowtype;
  v_panel uuid[];
  v_old_panel uuid[];
  v_url text := nullif(btrim(coalesce(p_meeting_url, '')), '');
begin
  begin
    v_row := public.managed_interview(p_id);
  exception when sqlstate 'P0001' then
    return public.interview_reason(sqlerrm);
  end;
  v_old := v_row;

  if v_row.status not in ('awaiting_candidate', 'scheduled') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;
  if public.application_stage_closed(v_row.application_id) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if p_starts_at is not null and v_row.status <> 'scheduled' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;
  if v_url is not null and (char_length(v_url) > 2000 or v_url !~* '^https?://') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_url');
  end if;

  select coalesce(array_agg(user_id order by user_id), '{}') into v_old_panel
    from public.scheduled_interview_panel where interview_id = v_row.id;

  if p_panel is not null then
    v_panel := public.valid_interview_panel(v_row.company_id, p_panel);
    if v_panel is null then
      return jsonb_build_object('ok', false, 'reason', 'invalid_panel');
    end if;
    delete from public.interview_scorecards
     where interview_id = v_row.id and status = 'draft' and author_user_id <> all (v_panel);
    delete from public.scheduled_interview_panel
     where interview_id = v_row.id and user_id <> all (v_panel);
    insert into public.scheduled_interview_panel (interview_id, user_id, company_id)
    select v_row.id, u, v_row.company_id from unnest(v_panel) u
    on conflict do nothing;
    select array_agg(u order by u) into v_panel from unnest(v_panel) u;
  end if;

  update public.scheduled_interviews
     set starts_at = coalesce(p_starts_at, starts_at),
         ends_at = case when p_starts_at is null then ends_at
                        else p_starts_at + make_interval(mins => duration_minutes) end,
         meeting_url = case when p_clear_meeting_url then null else coalesce(v_url, meeting_url) end,
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  if v_row.starts_at is distinct from v_old.starts_at then
    perform public.log_meeting_event(v_row, 'meeting_rescheduled', v_uid, jsonb_build_object(
      'from', v_old.starts_at, 'starts_at', v_row.starts_at
    ));
  end if;
  if v_panel is not null and v_panel is distinct from v_old_panel then
    perform public.log_meeting_event(v_row, 'meeting_panel_changed', v_uid, jsonb_build_object(
      'added', (select count(*) from unnest(v_panel) u where u <> all (v_old_panel)),
      'removed', (select count(*) from unnest(v_old_panel) u where u <> all (v_panel))
    ));
  end if;

  return jsonb_build_object(
    'ok', true, 'application_id', v_row.application_id,
    'status', v_row.status, 'starts_at', v_row.starts_at, 'ends_at', v_row.ends_at,
    'provider_event_id', v_row.provider_event_id, 'organizer_user_id', v_row.organizer_user_id,
    'previous_starts_at', v_old.starts_at
  );
end $$;
revoke all on function public.update_interview(uuid, timestamptz, uuid[], text, boolean) from public, anon;
grant execute on function public.update_interview(uuid, timestamptz, uuid[], text, boolean) to authenticated;

-- awaiting_candidate | scheduled → cancelled. The self-scheduling link stops
-- working with the status. Returns the event to delete, if any.
create or replace function public.cancel_interview(p_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.scheduled_interviews%rowtype;
begin
  begin
    v_row := public.managed_interview(p_id);
  exception when sqlstate 'P0001' then
    return public.interview_reason(sqlerrm);
  end;
  if v_row.status not in ('awaiting_candidate', 'scheduled') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;

  update public.scheduled_interviews
     set status = 'cancelled',
         booking_token_expires_at = case when booking_token_hash is null then booking_token_expires_at
                                         else least(booking_token_expires_at, now()) end,
         updated_at = now()
   where id = v_row.id and status in ('awaiting_candidate', 'scheduled')
  returning * into v_row;

  perform public.log_meeting_event(v_row, 'meeting_cancelled', v_uid, jsonb_build_object(
    'reason', coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'recruiter')
  ));

  return jsonb_build_object(
    'ok', true, 'application_id', v_row.application_id, 'status', v_row.status,
    'provider_event_id', v_row.provider_event_id, 'organizer_user_id', v_row.organizer_user_id
  );
end $$;
revoke all on function public.cancel_interview(uuid, text) from public, anon;
grant execute on function public.cancel_interview(uuid, text) to authenticated;

-- IV-REQ-024: `completed` from `scheduled` once it has started; `no_show`
-- from `scheduled` after the start, or from `completed` up to 7 days after
-- the end.
create or replace function public.mark_interview(p_id uuid, p_status text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.scheduled_interviews%rowtype;
begin
  if p_status is null or p_status not in ('completed', 'no_show') then
    raise exception 'invalid status: %', p_status using errcode = 'invalid_parameter_value';
  end if;
  begin
    v_row := public.managed_interview(p_id);
  exception when sqlstate 'P0001' then
    return public.interview_reason(sqlerrm);
  end;

  if p_status = 'completed' then
    if v_row.status <> 'scheduled' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_status');
    end if;
    if v_row.starts_at > now() then
      return jsonb_build_object('ok', false, 'reason', 'not_started');
    end if;
    update public.scheduled_interviews set status = 'completed', updated_at = now()
     where id = v_row.id and status = 'scheduled' returning * into v_row;
    perform public.log_meeting_event(v_row, 'meeting_completed', v_uid);
  else
    if v_row.status = 'scheduled' then
      if v_row.starts_at > now() then
        return jsonb_build_object('ok', false, 'reason', 'not_started');
      end if;
    elsif v_row.status = 'completed' then
      if v_row.ends_at < now() - public.interview_no_show_window() then
        return jsonb_build_object('ok', false, 'reason', 'too_late');
      end if;
    else
      return jsonb_build_object('ok', false, 'reason', 'invalid_status');
    end if;
    update public.scheduled_interviews set status = 'no_show', updated_at = now()
     where id = v_row.id and status in ('scheduled', 'completed') returning * into v_row;
    perform public.log_meeting_event(v_row, 'meeting_no_show', v_uid);
  end if;

  return jsonb_build_object('ok', true, 'application_id', v_row.application_id, 'status', v_row.status);
end $$;
revoke all on function public.mark_interview(uuid, text) from public, anon;
grant execute on function public.mark_interview(uuid, text) to authenticated;

-- IV-REQ-024: `scheduled` → `completed` 15 minutes after the end. Called by
-- /api/updates/interviews/sync (service role). Returns the ids it completed.
create or replace function public.complete_due_interviews(p_limit integer default 200)
returns setof uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.scheduled_interviews%rowtype;
begin
  for v_row in
    with due as (
      select id from public.scheduled_interviews
       where status = 'scheduled' and ends_at <= now() - interval '15 minutes'
       order by ends_at limit greatest(p_limit, 1)
       for update skip locked
    )
    update public.scheduled_interviews i
       set status = 'completed', updated_at = now()
      from due
     where i.id = due.id and i.status = 'scheduled'
    returning i.*
  loop
    perform public.log_meeting_event(v_row, 'meeting_completed', null, jsonb_build_object('automatic', true));
    return next v_row.id;
  end loop;
end $$;
revoke all on function public.complete_due_interviews(integer) from public, anon, authenticated;
grant execute on function public.complete_due_interviews(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Scorecards (IV-REQ-030, IV-REQ-031, D19)
-- ---------------------------------------------------------------------------

-- The caller's panel row's interview, locked, or a reason.
create or replace function public.panel_interview(p_interview_id uuid)
returns public.scheduled_interviews
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.scheduled_interviews%rowtype;
begin
  select i.* into v_row
    from public.scheduled_interviews i
    join public.scheduled_interview_panel p on p.interview_id = i.id and p.user_id = (select auth.uid())
   where i.id = p_interview_id
     for update of i;
  if not found or not public.is_company_member(v_row.company_id) then
    raise exception using errcode = 'P0001', message = 'IV_NOT_FOUND';
  end if;
  return v_row;
end $$;
revoke all on function public.panel_interview(uuid) from public, anon, authenticated;

-- Validates `p_ratings` against the snapshot: an object of
-- { "<competency id>": { "rating": candidate_rating | null, "note": text } }.
-- Returns the normalized object, or null when it's invalid.
create or replace function public.normalize_scorecard_ratings(p_snapshot jsonb, p_ratings jsonb)
returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  v_key text;
  v_value jsonb;
  v_out jsonb := '{}'::jsonb;
  v_rating text;
  v_note text;
begin
  if p_ratings is null then return '{}'::jsonb; end if;
  if jsonb_typeof(p_ratings) <> 'object' then return null; end if;
  for v_key, v_value in select key, value from jsonb_each(p_ratings) loop
    if not exists (
      select 1 from jsonb_array_elements(coalesce(p_snapshot -> 'competencies', '[]'::jsonb)) c
       where c ->> 'id' = v_key
    ) then
      return null;
    end if;
    if jsonb_typeof(v_value) <> 'object' then return null; end if;
    v_rating := nullif(v_value ->> 'rating', '');
    v_note := coalesce(v_value ->> 'note', '');
    if v_rating is not null and v_rating not in ('strong_no', 'no', 'yes', 'strong_yes') then return null; end if;
    if char_length(v_note) > 2000 then return null; end if;
    if v_rating is null and v_note = '' then continue; end if;
    v_out := v_out || jsonb_build_object(v_key, jsonb_build_object('rating', v_rating, 'note', v_note));
  end loop;
  return v_out;
end $$;
revoke all on function public.normalize_scorecard_ratings(jsonb, jsonb) from public, anon, authenticated;

-- Autosaves the caller's own scorecard. A draft changes freely. Once
-- submitted, ratings and the overall are locked for good, and the notes can
-- change until locked_at, each change recorded (D19).
create or replace function public.save_scorecard_draft(
  p_interview_id uuid,
  p_ratings jsonb,
  p_overall public.candidate_rating default null,
  p_overall_note text default ''
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.scheduled_interviews%rowtype;
  v_card public.interview_scorecards%rowtype;
  v_ratings jsonb;
  v_note text := coalesce(p_overall_note, '');
  v_key text;
  v_old_note text;
  v_new_note text;
begin
  begin
    v_row := public.panel_interview(p_interview_id);
  exception when sqlstate 'P0001' then
    return public.interview_reason(sqlerrm);
  end;
  if v_row.status not in ('scheduled', 'completed') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;

  v_ratings := public.normalize_scorecard_ratings(v_row.plan_snapshot, p_ratings);
  if v_ratings is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_ratings');
  end if;
  if char_length(v_note) > 5000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_note');
  end if;

  select * into v_card from public.interview_scorecards
   where interview_id = v_row.id and author_user_id = v_uid for update;

  if not found then
    insert into public.interview_scorecards
      (interview_id, application_id, company_id, author_user_id, overall, overall_note, ratings)
    values (v_row.id, v_row.application_id, v_row.company_id, v_uid, p_overall, v_note, v_ratings)
    returning * into v_card;
    return jsonb_build_object('ok', true, 'id', v_card.id, 'application_id', v_card.application_id,
      'status', v_card.status, 'updated_at', v_card.updated_at, 'locked_at', v_card.locked_at);
  end if;

  if v_card.status = 'draft' then
    update public.interview_scorecards
       set overall = p_overall, overall_note = v_note, ratings = v_ratings, updated_at = now()
     where id = v_card.id returning * into v_card;
    return jsonb_build_object('ok', true, 'id', v_card.id, 'application_id', v_card.application_id,
      'status', v_card.status, 'updated_at', v_card.updated_at, 'locked_at', v_card.locked_at);
  end if;

  -- Submitted: the ratings and the overall can't change.
  if p_overall is distinct from v_card.overall
     or exists (
       select 1 from (
         select key from jsonb_object_keys(v_ratings) key
         union select key from jsonb_object_keys(v_card.ratings) key
       ) k
        where (v_ratings -> k.key ->> 'rating') is distinct from (v_card.ratings -> k.key ->> 'rating')
     ) then
    return jsonb_build_object('ok', false, 'reason', 'ratings_locked');
  end if;
  if now() >= v_card.locked_at then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  if v_note is distinct from v_card.overall_note then
    insert into public.interview_scorecard_edits (scorecard_id, field, old_text, new_text)
    values (v_card.id, 'overall_note', v_card.overall_note, v_note);
  end if;
  for v_key in
    select key from jsonb_object_keys(v_ratings) key
    union select key from jsonb_object_keys(v_card.ratings) key
  loop
    v_old_note := coalesce(v_card.ratings -> v_key ->> 'note', '');
    v_new_note := coalesce(v_ratings -> v_key ->> 'note', '');
    if v_old_note is distinct from v_new_note then
      insert into public.interview_scorecard_edits (scorecard_id, field, old_text, new_text)
      values (v_card.id, 'competency:' || v_key, v_old_note, v_new_note);
    end if;
  end loop;

  update public.interview_scorecards
     set overall_note = v_note, ratings = v_ratings, updated_at = now()
   where id = v_card.id returning * into v_card;
  return jsonb_build_object('ok', true, 'id', v_card.id, 'application_id', v_card.application_id,
      'status', v_card.status, 'updated_at', v_card.updated_at, 'locked_at', v_card.locked_at);
end $$;
revoke all on function public.save_scorecard_draft(uuid, jsonb, public.candidate_rating, text) from public, anon;
grant execute on function public.save_scorecard_draft(uuid, jsonb, public.candidate_rating, text) to authenticated;

-- IV-REQ-031: from the start time, on a scheduled or completed interview,
-- with an overall recommendation. Locks the ratings for good and the notes
-- after 24 h. The event carries no recommendation: the timeline reads it
-- through list_interview_scorecards, which applies blind review.
create or replace function public.submit_scorecard(p_interview_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.scheduled_interviews%rowtype;
  v_card public.interview_scorecards%rowtype;
begin
  begin
    v_row := public.panel_interview(p_interview_id);
  exception when sqlstate 'P0001' then
    return public.interview_reason(sqlerrm);
  end;
  if v_row.status not in ('scheduled', 'completed') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;
  if v_row.starts_at is null or v_row.starts_at > now() then
    return jsonb_build_object('ok', false, 'reason', 'not_started');
  end if;

  select * into v_card from public.interview_scorecards
   where interview_id = v_row.id and author_user_id = v_uid for update;
  if not found or v_card.overall is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_overall');
  end if;
  if v_card.status = 'submitted' then
    return jsonb_build_object('ok', false, 'reason', 'already_submitted');
  end if;

  update public.interview_scorecards
     set status = 'submitted', submitted_at = now(), locked_at = now() + public.scorecard_note_edit_window(),
         updated_at = now()
   where id = v_card.id returning * into v_card;

  perform public.log_meeting_event(v_row, 'scorecard_submitted', v_uid, jsonb_build_object('scorecard_id', v_card.id));

  return jsonb_build_object('ok', true, 'id', v_card.id, 'application_id', v_card.application_id,
    'submitted_at', v_card.submitted_at, 'locked_at', v_card.locked_at);
end $$;
revoke all on function public.submit_scorecard(uuid) from public, anon;
grant execute on function public.submit_scorecard(uuid) to authenticated;

-- Every panel seat on an application's interviews, with its scorecard as
-- far as the caller may see it (IV-REQ-032/033): status and submitted_at
-- always; overall, notes and ratings only for the caller's own card, or a
-- submitted one when they read everyone's feedback or aren't blind.
-- Callers need scheduling.view for the job.
create or replace function public.list_interview_scorecards(p_application_id uuid)
returns table (
  interview_id uuid, author_user_id uuid, author_name text, response public.interview_panel_response,
  scorecard_id uuid, status text, submitted_at timestamptz, locked_at timestamptz,
  content_visible boolean, overall public.candidate_rating, overall_note text, ratings jsonb
)
language sql stable security definer
set search_path = ''
as $$
  with ctx as (
    select a.id as application_id, jp.company_id, a.job_post_id,
           public.can_read_scorecards(jp.company_id, a.id) as can_read
      from public.applications a
      join public.job_postings jp on jp.id = a.job_post_id
     where a.id = p_application_id
       and jp.company_id = public.my_company_id()
       and public.has_company_permission(jp.company_id, 'scheduling.view', a.job_post_id)
  )
  select i.id, p.user_id, public.member_display_name(p.user_id), p.response,
         s.id, coalesce(s.status, 'none'), s.submitted_at, s.locked_at,
         v.visible,
         case when v.visible then s.overall end,
         case when v.visible then s.overall_note end,
         case when v.visible then s.ratings end
    from ctx
    join public.scheduled_interviews i on i.application_id = ctx.application_id
    join public.scheduled_interview_panel p on p.interview_id = i.id
    left join public.interview_scorecards s on s.interview_id = i.id and s.author_user_id = p.user_id
   cross join lateral (
     select s.id is not null and (
       s.author_user_id = (select auth.uid()) or (s.status = 'submitted' and ctx.can_read)
     ) as visible
   ) v
   order by i.starts_at nulls last, i.created_at, p.created_at
$$;
revoke all on function public.list_interview_scorecards(uuid) from public, anon;
grant execute on function public.list_interview_scorecards(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. The interview kit and "My interviews" (IV-REQ-034, §2 Permissions)
-- ---------------------------------------------------------------------------

-- Whether the session user may open the kit: on the panel and still a
-- member, while the interview is awaiting_candidate or scheduled, or up to
-- 7 days after its end. Anyone with applicants.view for the job keeps it
-- while they're on the panel.
create or replace function public.can_open_interview_kit(p_interview_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.scheduled_interviews i
      join public.scheduled_interview_panel p on p.interview_id = i.id and p.user_id = (select auth.uid())
     where i.id = p_interview_id
       and public.is_company_member(i.company_id)
       and (
         i.status in ('awaiting_candidate', 'scheduled')
         or (i.status in ('completed', 'no_show') and i.ends_at > now() - public.interview_kit_grace())
         or (i.status <> 'cancelled'
             and public.has_company_permission(i.company_id, 'applicants.view', i.job_post_id))
       )
  )
$$;
revoke all on function public.can_open_interview_kit(uuid) from public, anon;
grant execute on function public.can_open_interview_kit(uuid) to authenticated;

-- The kit (IV-REQ-034): the job, the candidate's name and application
-- answers, the instructions, the competencies with questions, and the
-- caller's own scorecard. No contact details or storage paths: the resume
-- comes from /api/interviews/[id]/resume. After access ends, only the
-- caller's own submitted scorecard is returned (`access = 'scorecard_only'`).
create or replace function public.get_interview_kit(p_interview_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.scheduled_interviews%rowtype;
  v_app public.applications%rowtype;
  v_card public.interview_scorecards%rowtype;
  v_job record;
  v_name text;
  v_has_resume boolean;
  v_card_json jsonb;
begin
  select * into v_row from public.scheduled_interviews where id = p_interview_id;
  if not found or not exists (
    select 1 from public.scheduled_interview_panel where interview_id = p_interview_id and user_id = v_uid
  ) and not exists (
    select 1 from public.interview_scorecards where interview_id = p_interview_id and author_user_id = v_uid
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select * into v_card from public.interview_scorecards where interview_id = v_row.id and author_user_id = v_uid;
  v_card_json := case when v_card.id is null then null else jsonb_build_object(
    'id', v_card.id, 'status', v_card.status, 'overall', v_card.overall, 'overall_note', v_card.overall_note,
    'ratings', v_card.ratings, 'submitted_at', v_card.submitted_at, 'locked_at', v_card.locked_at,
    'updated_at', v_card.updated_at
  ) end;

  if not public.can_open_interview_kit(v_row.id) then
    if v_card.status = 'submitted' then
      return jsonb_build_object(
        'ok', true, 'access', 'scorecard_only',
        'interview', jsonb_build_object('id', v_row.id, 'name', v_row.name, 'status', v_row.status,
          'starts_at', v_row.starts_at, 'ends_at', v_row.ends_at,
          'competencies', coalesce(v_row.plan_snapshot -> 'competencies', '[]'::jsonb)),
        'scorecard', v_card_json
      );
    end if;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  select * into v_app from public.applications where id = v_row.application_id;
  select jp.id, jp.title, jp.questions into v_job from public.job_postings jp where jp.id = v_row.job_post_id;
  select coalesce(
           nullif(btrim(cc.full_name), ''),
           nullif(btrim(ui.full_name), ''),
           case when v_app.company_candidate_id is not null then 'Candidate' else 'Applicant' end
         ),
         case when v_app.company_candidate_id is not null
              then cc.resume_path is not null
              else v_app.resume_id is not null or v_app.resume_path is not null or v_app.resume_url is not null end
    into v_name, v_has_resume
    from (select 1) one
    left join public.company_candidates cc on cc.id = v_app.company_candidate_id
    left join public.user_info ui on ui.user_id = v_app.applicant_user_id;

  return jsonb_build_object(
    'ok', true, 'access', 'kit',
    'interview', jsonb_build_object(
      'id', v_row.id, 'application_id', v_row.application_id, 'name', v_row.name, 'status', v_row.status,
      'source', v_row.source, 'starts_at', v_row.starts_at, 'ends_at', v_row.ends_at,
      'duration_minutes', v_row.duration_minutes, 'meeting_url', v_row.meeting_url,
      'instructions', coalesce(v_row.plan_snapshot ->> 'instructions', ''),
      'competencies', coalesce(v_row.plan_snapshot -> 'competencies', '[]'::jsonb),
      'panel', coalesce((
        select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', public.member_display_name(p.user_id))
                         order by p.created_at)
          from public.scheduled_interview_panel p where p.interview_id = v_row.id
      ), '[]'::jsonb)
    ),
    'job', jsonb_build_object('id', v_job.id, 'title', v_job.title, 'questions', to_jsonb(v_job.questions)),
    'candidate', jsonb_build_object('name', v_name, 'has_resume', v_has_resume),
    'application', jsonb_build_object(
      'answers', to_jsonb(v_app.answers), 'answers_v2', v_app.answers_v2, 'form_snapshot', v_app.form_snapshot
    ),
    'scorecard', v_card_json
  );
end $$;
revoke all on function public.get_interview_kit(uuid) from public, anon;
grant execute on function public.get_interview_kit(uuid) to authenticated;

-- The resume behind the kit, for /api/interviews/[id]/resume (service role
-- after the caller passed can_open_interview_kit): the applicant's resume
-- or the company candidate's file. Never returned to a browser.
create or replace function public.interview_resume_source(p_interview_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  -- No contact snapshot: the kit shows no contact details.
  select jsonb_build_object(
    'resume_id', a.resume_id,
    'resume_path', a.resume_path,
    'resume_url', a.resume_url,
    'resume_snapshot', a.resume_snapshot,
    'linked_resume_path', r.resume_path,
    'linked_resume_content', r.content,
    'linked_resume_template', r.template,
    'candidate_resume_path', cc.resume_path,
    'company_candidate_id', a.company_candidate_id,
    'applicant_user_id', a.applicant_user_id
  )
    from public.scheduled_interviews i
    join public.applications a on a.id = i.application_id
    left join public.resumes r on r.id = a.resume_id
    left join public.company_candidates cc on cc.id = a.company_candidate_id
   where i.id = p_interview_id
$$;
revoke all on function public.interview_resume_source(uuid) from public, anon, authenticated;
grant execute on function public.interview_resume_source(uuid) to service_role;

-- "My interviews" (IVT-021): the session member's panel seats on live
-- applications, with their own scorecard status. Any member.
create or replace function public.list_my_interviews()
returns table (
  interview_id uuid, application_id uuid, job_post_id uuid, job_title text, candidate_name text,
  name text, status public.scheduled_interview_status, starts_at timestamptz, ends_at timestamptz,
  meeting_url text, scorecard_status text, kit_open boolean
)
language sql stable security definer
set search_path = ''
as $$
  select i.id, i.application_id, i.job_post_id, jp.title,
         coalesce(nullif(btrim(cc.full_name), ''), nullif(btrim(ui.full_name), ''), 'Candidate'),
         i.name, i.status, i.starts_at, i.ends_at, i.meeting_url,
         coalesce(s.status, 'none'),
         public.can_open_interview_kit(i.id)
    from public.scheduled_interview_panel p
    join public.scheduled_interviews i on i.id = p.interview_id
    join public.applications a on a.id = i.application_id
    join public.job_postings jp on jp.id = i.job_post_id
    left join public.company_candidates cc on cc.id = a.company_candidate_id
    left join public.user_info ui on ui.user_id = a.applicant_user_id
    left join public.interview_scorecards s on s.interview_id = i.id and s.author_user_id = p.user_id
   where p.user_id = (select auth.uid())
     and i.company_id = public.my_company_id()
     and a.merged_into_application_id is null
   order by i.starts_at desc nulls first
   limit 500
$$;
revoke all on function public.list_my_interviews() from public, anon;
grant execute on function public.list_my_interviews() to authenticated;

-- Who can go on a panel or be a plan's default interviewer: every member of
-- the session's company, by display name (IVT-013, IVT-020). Only for callers
-- who plan or schedule interviews on some job; empty otherwise. No emails.
create or replace function public.list_interviewer_options()
returns table (user_id uuid, name text)
language sql stable security definer
set search_path = ''
as $$
  select m.user_id, public.member_display_name(m.user_id)
    from public.company_members m
   where m.company_id = public.my_company_id()
     and (public.company_permission_scope(public.my_company_id(), 'scheduling.view') is not null
          or public.company_permission_scope(public.my_company_id(), 'interview_plans.manage') is not null)
   order by m.is_owner desc, m.created_at
$$;
revoke all on function public.list_interviewer_options() from public, anon;
grant execute on function public.list_interviewer_options() to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Merges (IV-REQ-027, D23)
-- ---------------------------------------------------------------------------
-- As in 20261025140000, plus moving the human interviews, their scorecards
-- and feedback summaries to the surviving application.

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

    -- IV-REQ-027: the human interviews follow the person. Google events keep
    -- their attendees.
    update public.scheduled_interviews set application_id = p_direct, updated_at = now()
     where application_id = p_imported;
    update public.interview_scorecards set application_id = p_direct where application_id = p_imported;
    update public.interview_feedback_summaries set application_id = p_direct where application_id = p_imported;

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
