-- Application tracker, migration A (plan/application-tracker/feature-application-tracker-spec.md
-- §1, tasks ATT-010). Additive only: the deployed code reads and writes none of
-- this, so it can be pushed before the app that uses it.
--
--   1. tracked_application_status   the applicant's own statuses (AT-REQ-002)
--   2. tracked_applications         self-tracked jobs, saved or applied (AT-REQ-001, -003, -005, -008)
--   3. tracked_application_events   each card's timeline, written by a trigger (AT-REQ-006)
--   4. applicant_application_notes  private notes on a GetHired application (AT-REQ-007)
--   5. get_applicant_weekly_metrics counts tracked applications too (ATT-003, difference 1)
--
-- Tests: supabase/tests/application_tracker.sql.

-- ---------------------------------------------------------------------------
-- 1. Statuses. Separate from application_status, never compared with it.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.tracked_application_status as enum (
    'saved', 'applied', 'in_review', 'interviewing', 'offer', 'accepted', 'rejected', 'withdrawn', 'ghosted'
  );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. tracked_applications
-- ---------------------------------------------------------------------------

create table if not exists public.tracked_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  all_jobs_id uuid references public.all_jobs(id) on delete set null,
  job_title text not null check (char_length(btrim(job_title)) between 1 and 200),
  company_name text not null check (char_length(btrim(company_name)) between 1 and 200),
  job_url text check (job_url is null or (job_url ~ '^https://[^\s]+$' and char_length(job_url) <= 2048)),
  job_url_key text check (job_url_key is null or char_length(job_url_key) <= 2048),
  location text check (location is null or char_length(location) <= 200),
  status public.tracked_application_status not null default 'applied',
  status_changed_at timestamptz not null default now(),
  applied_at date,
  next_follow_up_at date,
  resume_id uuid references public.resumes(id) on delete set null,
  salary_amount integer check (salary_amount is null or salary_amount >= 0),
  salary_currency text check (salary_currency is null or salary_currency ~ '^[A-Z]{3}$'),
  contact_name text check (contact_name is null or char_length(contact_name) <= 200),
  notes text check (notes is null or char_length(notes) <= 5000),
  source text not null check (source in ('board_prompt', 'manual', 'url', 'extension', 'agent', 'mcp', 'migrated')),
  position double precision not null default extract(epoch from now()),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A saved job hasn't been applied to; anything else has a date.
  constraint tracked_applications_applied_at_saved
    check (case when status = 'saved' then applied_at is null else applied_at is not null end),
  -- Saving a board job writes user_favorites, never a tracked row (AT-REQ-008).
  constraint tracked_applications_saved_off_board
    check (status <> 'saved' or all_jobs_id is null)
);

comment on table public.tracked_applications is
  'Jobs an applicant tracks themselves (AT-REQ-001). Applicant-private: no company code reads it.';

create unique index if not exists tracked_applications_user_job_key
  on public.tracked_applications (user_id, all_jobs_id) where all_jobs_id is not null;
create unique index if not exists tracked_applications_user_url_key
  on public.tracked_applications (user_id, job_url_key) where job_url_key is not null;
create index if not exists tracked_applications_user_status
  on public.tracked_applications (user_id, status, position);

-- Guards (AT-REQ-002, AT-REQ-005). SECURITY DEFINER so the cap counts every
-- row of the user, whoever writes.
create or replace function public.guard_tracked_application()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if tg_op = 'INSERT' then
    select count(*) into v_count from public.tracked_applications where user_id = new.user_id;
    if v_count >= 2000 then
      raise exception 'AT_MAX_TRACKED' using errcode = 'check_violation',
        hint = 'An applicant can track at most 2000 jobs.';
    end if;
    new.created_at := now();
    new.updated_at := now();
    new.status_changed_at := now();
    if new.status = 'saved' then
      new.applied_at := null;
    elsif new.applied_at is null then
      new.applied_at := current_date;
    end if;
    return new;
  end if;

  if new.user_id is distinct from old.user_id
     or new.source is distinct from old.source
     or new.created_at is distinct from old.created_at then
    raise exception 'A tracked application''s owner, source and creation time can''t change.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'saved' then
      raise exception 'A tracked application can''t move back to saved.'
        using errcode = 'check_violation';
    end if;
    new.status_changed_at := now();
    if old.status = 'saved' and new.applied_at is null then
      new.applied_at := current_date;
    end if;
  else
    new.status_changed_at := old.status_changed_at;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tracked_applications_guard on public.tracked_applications;
create trigger tracked_applications_guard
  before insert or update on public.tracked_applications
  for each row execute function public.guard_tracked_application();

alter table public.tracked_applications enable row level security;

drop policy if exists tracked_applications_select_own on public.tracked_applications;
create policy tracked_applications_select_own on public.tracked_applications
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists tracked_applications_insert_own on public.tracked_applications;
create policy tracked_applications_insert_own on public.tracked_applications
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists tracked_applications_update_own on public.tracked_applications;
create policy tracked_applications_update_own on public.tracked_applications
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists tracked_applications_delete_own on public.tracked_applications;
create policy tracked_applications_delete_own on public.tracked_applications
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.tracked_applications from anon;
grant select, insert, update, delete on public.tracked_applications to authenticated;
grant all on public.tracked_applications to service_role;

-- ---------------------------------------------------------------------------
-- 3. tracked_application_events: the timeline. Only the trigger writes it.
-- ---------------------------------------------------------------------------

create table if not exists public.tracked_application_events (
  id uuid primary key default gen_random_uuid(),
  tracked_application_id uuid not null references public.tracked_applications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('created', 'status')),
  from_status public.tracked_application_status,
  to_status public.tracked_application_status not null,
  created_at timestamptz not null default now()
);

create index if not exists tracked_application_events_card
  on public.tracked_application_events (tracked_application_id, created_at);

create or replace function public.log_tracked_application_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.tracked_application_events (tracked_application_id, user_id, kind, from_status, to_status)
    values (new.id, new.user_id, 'created', null, new.status);
  elsif new.status is distinct from old.status then
    insert into public.tracked_application_events (tracked_application_id, user_id, kind, from_status, to_status)
    values (new.id, new.user_id, 'status', old.status, new.status);
  end if;
  return null;
end;
$$;

drop trigger if exists tracked_applications_log_event on public.tracked_applications;
create trigger tracked_applications_log_event
  after insert or update of status on public.tracked_applications
  for each row execute function public.log_tracked_application_event();

alter table public.tracked_application_events enable row level security;

drop policy if exists tracked_application_events_select_own on public.tracked_application_events;
create policy tracked_application_events_select_own on public.tracked_application_events
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.tracked_application_events from anon, authenticated;
grant select on public.tracked_application_events to authenticated;
grant all on public.tracked_application_events to service_role;

-- ---------------------------------------------------------------------------
-- 4. applicant_application_notes: the applicant's private notes on a GetHired
--    application. Never a status; no company policy, and no company code
--    reads it (test/applicant-notes-private.test.ts).
-- ---------------------------------------------------------------------------

create table if not exists public.applicant_application_notes (
  application_id uuid primary key references public.applications(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  notes text check (notes is null or char_length(notes) <= 5000),
  next_follow_up_at date,
  updated_at timestamptz not null default now()
);

create or replace function public.touch_applicant_application_note()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.user_id is distinct from old.user_id
                           or new.application_id is distinct from old.application_id) then
    raise exception 'A note''s application and owner can''t change.' using errcode = 'insufficient_privilege';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists applicant_application_notes_touch on public.applicant_application_notes;
create trigger applicant_application_notes_touch
  before insert or update on public.applicant_application_notes
  for each row execute function public.touch_applicant_application_note();

alter table public.applicant_application_notes enable row level security;

drop policy if exists applicant_application_notes_select_own on public.applicant_application_notes;
create policy applicant_application_notes_select_own on public.applicant_application_notes
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists applicant_application_notes_insert_own on public.applicant_application_notes;
create policy applicant_application_notes_insert_own on public.applicant_application_notes
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.applications a
       where a.id = application_id and a.applicant_user_id = (select auth.uid())
    )
  );
drop policy if exists applicant_application_notes_update_own on public.applicant_application_notes;
create policy applicant_application_notes_update_own on public.applicant_application_notes
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists applicant_application_notes_delete_own on public.applicant_application_notes;
create policy applicant_application_notes_delete_own on public.applicant_application_notes
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.applicant_application_notes from anon;
grant select, insert, update, delete on public.applicant_application_notes to authenticated;
grant all on public.applicant_application_notes to service_role;

-- ---------------------------------------------------------------------------
-- 5. Weekly metrics (ATT-003): the old function counted every applications
--    row, external ones included. New external applications go to the
--    tracker from the next deploy, so it counts both now; migration B moves
--    the old rows without changing a count. Saved rows aren't applications.
-- ---------------------------------------------------------------------------

create or replace function public.get_applicant_weekly_metrics(p_user_id uuid)
returns table (
  user_id uuid,
  applications_submitted_weekly integer,
  status_updates_weekly integer,
  jobs_favorited_weekly integer,
  resumes_created_weekly integer,
  resume_reviews_created_weekly integer
)
language sql
as $$
select
  p_user_id as user_id,
  (
    (select count(*) from public.applications app
      where app.applicant_user_id = p_user_id
        and app.created_at >= now() - interval '7 days')
    + (select count(*) from public.tracked_applications ta
        where ta.user_id = p_user_id and ta.status <> 'saved'
          and ta.applied_at >= (now() - interval '7 days')::date)
  )::integer as applications_submitted_weekly,
  (
    (select count(distinct app.id) from public.applications app
      where app.applicant_user_id = p_user_id
        and app.updated_at >= now() - interval '7 days'
        and app.updated_at != app.created_at)
    + (select count(*) from public.tracked_applications ta
        where ta.user_id = p_user_id and ta.status not in ('saved', 'applied')
          and ta.status_changed_at >= now() - interval '7 days')
  )::integer as status_updates_weekly,
  (select count(*)::integer from public.user_favorites fav
    where fav.user_id = p_user_id and fav.created_at >= now() - interval '7 days') as jobs_favorited_weekly,
  (select count(*)::integer from public.resumes r
    where r.user_id = p_user_id and r.created_at >= now() - interval '7 days') as resumes_created_weekly,
  (select count(*)::integer from public.resume_reviews rr
    where rr.user_id = p_user_id and rr.created_at >= now() - interval '7 days') as resume_reviews_created_weekly
$$;
