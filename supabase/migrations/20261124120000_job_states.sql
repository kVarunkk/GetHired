-- Job post lifecycle (plan/job-states/feature-job-states-spec.md, phase 1;
-- tasks JLT-011, JLT-012, JLT-013 in feature-job-states-tasks.md).
--
-- job_postings.state is the lifecycle: draft → (pending_approval →) open ⇄
-- paused → closed | filled, with reopening. job_postings.status stays the
-- public flag every existing reader uses, and is derived from state: active
-- exactly when the job is open (D1). The one write path for a person is
-- set_job_post_state (JL-REQ-005). set_job_post_status stays as a wrapper for
-- the deployed company code until JLT-030 drops it (JL-REQ-009).
--
-- This migration also holds what later phases need in the schema: closes_at,
-- closes_reminder_sent_at, visibility, company_info.job_approval_required and
-- the jobs.approve permission (the tasks file's "Migrations" decision).

-- ===========================================================================
-- 1. Types and columns
-- ===========================================================================

do $$ begin
  create type public.job_post_state as enum ('draft', 'pending_approval', 'open', 'paused', 'closed', 'filled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.job_close_reason as enum ('cancelled', 'deadline', 'on_hold_indefinitely', 'other');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.job_post_visibility as enum ('public', 'link_only');
exception when duplicate_object then null; end $$;

alter table public.job_postings
  add column if not exists state public.job_post_state not null default 'draft',
  add column if not exists close_reason public.job_close_reason,
  add column if not exists state_changed_at timestamptz not null default now(),
  add column if not exists first_opened_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists openings integer not null default 1,
  add column if not exists closes_at date,
  add column if not exists closes_reminder_sent_at timestamptz,
  add column if not exists visibility public.job_post_visibility not null default 'public';

alter table public.job_postings drop constraint if exists job_postings_openings_check;
alter table public.job_postings add constraint job_postings_openings_check check (openings between 1 and 500);

alter table public.company_info
  add column if not exists job_approval_required boolean not null default false;

-- ===========================================================================
-- 2. Backfill (D11): active → open, inactive → paused
-- ===========================================================================
-- Before the triggers below exist, so nothing else fires. Every existing row
-- is 'draft' from the column default until this runs.

update public.job_postings
   set state = case when status = 'active' then 'open' else 'paused' end::public.job_post_state,
       first_opened_at = case when status = 'active' then created_at end,
       state_changed_at = coalesce(updated_at, created_at, now())
 where state = 'draft';

-- JL-REQ-002: a closed job has a reason, and only a closed job has one.
alter table public.job_postings drop constraint if exists job_postings_close_reason_check;
alter table public.job_postings add constraint job_postings_close_reason_check
  check ((state = 'closed') = (close_reason is not null));

create index if not exists job_postings_closes_at_idx on public.job_postings (closes_at)
  where state in ('open', 'paused') and closes_at is not null;
create index if not exists job_postings_company_state_idx on public.job_postings (company_id, state);

-- ===========================================================================
-- 3. State events (JL-REQ-004)
-- ===========================================================================

create table if not exists public.job_post_state_events (
  id uuid primary key default gen_random_uuid(),
  job_post_id uuid not null references public.job_postings(id) on delete cascade,
  company_id uuid not null references public.company_info(id) on delete cascade,
  from_state public.job_post_state,
  to_state public.job_post_state not null,
  reason public.job_close_reason,
  note text check (char_length(note) <= 500),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists job_post_state_events_job_idx
  on public.job_post_state_events (job_post_id, created_at desc);

alter table public.job_post_state_events enable row level security;

-- Read with jobs.view on the job; nobody writes from the client.
drop policy if exists "job_post_state_events_select_company" on public.job_post_state_events;
create policy "job_post_state_events_select_company" on public.job_post_state_events
  for select to authenticated
  using (public.has_company_permission(company_id, 'jobs.view', job_post_id));

revoke all on table public.job_post_state_events from anon;
revoke insert, update, delete, truncate on table public.job_post_state_events from authenticated;
grant select on table public.job_post_state_events to authenticated;
grant all on table public.job_post_state_events to service_role;

-- ===========================================================================
-- 4. status follows state (JL-REQ-007)
-- ===========================================================================
-- Named so it fires before enforce_active_job_post_limit and
-- job_postings_guard_update (Postgres fires same-timing triggers by name).
--
-- It also keeps the lifecycle timestamps (JL-REQ-003) and clears close_reason
-- when a job leaves closed, so every writer gets them right.
--
-- A privileged writer (the service role, migrations, SQL test seeds) that
-- still writes only `status` is mapped to a state: an insert as active opens
-- the job, an update to active opens it, an update to inactive pauses an open
-- job. People never write either column directly: a status-only update is
-- refused here, a state update by job_postings_guard_update, and the insert
-- policy allows only drafts. Their status is still derived first, so a state
-- write over the plan's limit is refused by enforce_active_job_post_limit
-- (JL-REQ-007) before the guard runs.

create or replace function public.derive_job_post_status()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and current_role = 'authenticated' then
    if new.status is distinct from old.status and new.state is not distinct from old.state then
      raise exception 'A job post''s state changes only through set_job_post_state.'
        using errcode = 'insufficient_privilege';
    end if;
    new.status := case when new.state = 'open' then 'active' else 'inactive' end::public.job_posting_status;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if current_role <> 'authenticated' and new.state = 'draft' and new.status = 'active' then
      new.state := 'open';
    end if;
  elsif new.state is not distinct from old.state and new.status is distinct from old.status then
    if new.status = 'active' then
      new.state := 'open';
    elsif old.state = 'open' then
      new.state := 'paused';
    end if;
  end if;

  if tg_op = 'INSERT' or new.state is distinct from old.state then
    new.state_changed_at := now();
    if new.state = 'open' then
      new.first_opened_at := coalesce(new.first_opened_at, now());
    end if;
    if new.state in ('closed', 'filled') then
      -- closed ⇄ filled is a correction: the job closed when it first did.
      if tg_op = 'INSERT' or old.state not in ('closed', 'filled') or old.closed_at is null then
        new.closed_at := now();
      end if;
    else
      new.closed_at := null;
    end if;
    if new.state <> 'closed' then
      new.close_reason := null;
    end if;
  end if;

  new.status := case when new.state = 'open' then 'active' else 'inactive' end::public.job_posting_status;
  return new;
end $$;

drop trigger if exists derive_job_post_status on public.job_postings;
create trigger derive_job_post_status
  before insert or update on public.job_postings
  for each row execute function public.derive_job_post_status();

-- A column-list trigger doesn't fire when only `state` is written.
drop trigger if exists enforce_active_job_post_limit on public.job_postings;
create trigger enforce_active_job_post_limit
  before insert or update of status, state on public.job_postings
  for each row execute function public.enforce_active_job_post_limit();

-- ===========================================================================
-- 5. Direct writes (JL-REQ-008, JL-SEC-001)
-- ===========================================================================
-- Extends the recruiter-roles guard: people can't write the lifecycle columns
-- at all (set_job_post_state is the path); everything else needs jobs.edit.
-- The service role and definer RPCs (owner postgres) aren't affected.

create or replace function public.guard_job_posting_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_role <> 'authenticated' then
    return new;
  end if;
  if new.company_id is distinct from old.company_id then
    raise exception 'A job post can''t move to another company.' using errcode = 'insufficient_privilege';
  end if;
  if new.state is distinct from old.state
     or new.status is distinct from old.status
     or new.close_reason is distinct from old.close_reason
     or new.first_opened_at is distinct from old.first_opened_at
     or new.closed_at is distinct from old.closed_at
     or new.state_changed_at is distinct from old.state_changed_at then
    raise exception 'A job post''s state changes only through set_job_post_state.'
      using errcode = 'insufficient_privilege';
  end if;
  if (to_jsonb(new) - array['updated_at']) is distinct from (to_jsonb(old) - array['updated_at'])
     and not public.has_company_permission(old.company_id, 'jobs.edit', old.id) then
    raise exception 'Your role can''t edit job posts.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

revoke all on function public.guard_job_posting_update() from public, anon, authenticated;
grant execute on function public.guard_job_posting_update() to service_role;

-- New posts are drafts (D4).
drop policy if exists "Company can create job postings" on public.job_postings;
create policy "Company can create job postings"
  on public.job_postings for insert to authenticated
  with check (public.has_company_permission(company_id, 'jobs.create') and state = 'draft');

-- ===========================================================================
-- 6. Who can read a job post (JL-REQ-027, JL-SEC-003)
-- ===========================================================================
-- "Job seekers can view job postings" was `using (true)` (it predates
-- supabase/migrations/). A job that never opened is the company's alone; its
-- members keep reading it through "Company can view their own job postings".

drop policy if exists "Job seekers can view job postings" on public.job_postings;
create policy "Job seekers can view job postings"
  on public.job_postings for select to public
  using (state not in ('draft', 'pending_approval'));

-- ===========================================================================
-- 7. jobs.approve (JL-REQ-019)
-- ===========================================================================
-- seed_company_roles gives new Admin roles every key in company_permissions.
-- Member and Hiring manager don't get it.

insert into public.company_permissions (key, scopable, requires) values
  ('jobs.approve', true, '{jobs.view,jobs.publish}')
on conflict (key) do update set scopable = excluded.scopable, requires = excluded.requires;

insert into public.company_role_permissions (role_id, permission_key, scope)
select r.id, 'jobs.approve', 'all'
  from public.company_roles r
 where r.template_key = 'admin'
on conflict do nothing;

-- ===========================================================================
-- 8. set_job_post_state (JL-REQ-001, JL-REQ-005)
-- ===========================================================================

-- Whether `from → to` is in the table of JL-REQ-001, ignoring who asks.
create or replace function public.job_post_move_allowed(
  p_from public.job_post_state, p_to public.job_post_state
)
returns boolean
language sql immutable
set search_path = ''
as $$
  select (p_from::text, p_to::text) in (
    ('draft', 'open'), ('draft', 'pending_approval'),
    ('pending_approval', 'open'), ('pending_approval', 'draft'),
    ('open', 'paused'),
    ('open', 'closed'), ('paused', 'closed'),
    ('open', 'filled'), ('paused', 'filled'),
    ('paused', 'open'), ('closed', 'open'), ('filled', 'open'),
    ('closed', 'filled'), ('filled', 'closed')
  )
$$;

-- "Today" in a company's time zone (UTC when unset). company_info_time_zone_check
-- keeps the column a zone Postgres knows.
create or replace function public.company_today(p_company_id uuid)
returns date
language sql stable security definer
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select ci.time_zone from public.company_info ci where ci.id = p_company_id), 'UTC'))::date
$$;

create or replace function public.set_job_post_state(
  p_job_post_id uuid,
  p_to public.job_post_state,
  p_reason public.job_close_reason default null,
  p_note text default null,
  p_actor_kind text default 'user'
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_post public.job_postings%rowtype;
  v_from public.job_post_state;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_approval boolean;
  v_publish boolean;
  v_approve boolean;
  v_submitter uuid;
  v_first_open boolean;
  v_actor uuid := (select auth.uid());
begin
  if p_to is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition');
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    return jsonb_build_object('ok', false, 'reason', 'note_too_long');
  end if;

  select * into v_post from public.job_postings where id = p_job_post_id for update;
  if not found or not public.has_company_permission(v_post.company_id, 'jobs.view', v_post.id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  v_from := v_post.state;
  v_publish := public.has_company_permission(v_post.company_id, 'jobs.publish', v_post.id);
  v_approve := public.has_company_permission(v_post.company_id, 'jobs.approve', v_post.id);

  -- The state the job already has: nothing to do, but the public row is
  -- re-synced so a retry repairs one that drifted.
  if v_from = p_to then
    if not (v_publish or v_approve) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    if v_post.job_id is not null then
      update public.all_jobs set status = v_post.status
       where id = v_post.job_id and status is distinct from v_post.status;
    end if;
    return jsonb_build_object('ok', true, 'job_id', v_post.job_id, 'changed', false,
                              'from', v_from, 'to', p_to, 'first_open', false);
  end if;

  if not public.job_post_move_allowed(v_from, p_to) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition');
  end if;

  select ci.job_approval_required into v_approval from public.company_info ci where ci.id = v_post.company_id;
  v_approval := coalesce(v_approval, false);

  -- Who may make the move (JL-REQ-001, D6).
  if v_from = 'draft' and p_to = 'open' then
    if not v_publish then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
    if v_approval and not v_approve then
      return jsonb_build_object('ok', false, 'reason', 'approval_required');
    end if;
  elsif v_from = 'draft' and p_to = 'pending_approval' then
    if not v_publish then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
    if not v_approval then return jsonb_build_object('ok', false, 'reason', 'invalid_transition'); end if;
  elsif v_from = 'pending_approval' and p_to = 'open' then
    if not v_approve then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  elsif v_from = 'pending_approval' and p_to = 'draft' then
    select e.actor_user_id into v_submitter
      from public.job_post_state_events e
     where e.job_post_id = v_post.id and e.to_state = 'pending_approval'
     order by e.created_at desc limit 1;
    if v_publish and v_actor is not null and v_submitter = v_actor then
      null; -- the submitter withdraws it
    elsif v_approve then
      if v_note is null then return jsonb_build_object('ok', false, 'reason', 'note_required'); end if;
    else
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif not v_publish then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_to = 'closed' and p_reason is null then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;

  if p_to = 'open' then
    if v_post.closes_at is not null and v_post.closes_at < public.company_today(v_post.company_id) then
      return jsonb_build_object('ok', false, 'reason', 'closes_at_past');
    end if;
    if v_post.job_id is null then
      return jsonb_build_object('ok', false, 'reason', 'no_public_row');
    end if;
    -- enforce_active_job_post_limit only fires for `authenticated`, and this
    -- function runs as its owner, so the limit is checked here.
    if not public.billing_can_activate_job_post(v_post.company_id) then
      return jsonb_build_object('ok', false, 'reason', 'active_job_posts');
    end if;
  end if;

  v_first_open := p_to = 'open' and v_post.first_opened_at is null;

  -- derive_job_post_status sets status and the lifecycle timestamps.
  update public.job_postings
     set state = p_to,
         close_reason = case when p_to = 'closed' then p_reason end
   where id = v_post.id
  returning * into v_post;

  if v_post.job_id is not null then
    update public.all_jobs set status = v_post.status
     where id = v_post.job_id and status is distinct from v_post.status;
  end if;

  -- clock_timestamp, so moves inside one transaction still sort in order.
  insert into public.job_post_state_events
    (job_post_id, company_id, from_state, to_state, reason, note, actor_user_id, created_at)
  values
    (v_post.id, v_post.company_id, v_from, p_to, case when p_to = 'closed' then p_reason end, v_note, v_actor,
     clock_timestamp());

  perform public.write_company_audit(
    v_post.company_id, 'job.state_changed', 'job_post', v_post.id::text, v_post.title,
    jsonb_build_object('state', v_from),
    jsonb_strip_nulls(jsonb_build_object('state', p_to, 'reason', case when p_to = 'closed' then p_reason end)),
    public.audit_actor_kind(p_actor_kind));

  return jsonb_build_object('ok', true, 'job_id', v_post.job_id, 'changed', true,
                            'from', v_from, 'to', p_to, 'first_open', v_first_open,
                            'submitter', v_submitter);
end $$;

revoke all on function public.set_job_post_state(uuid, public.job_post_state, public.job_close_reason, text, text) from public, anon;
grant execute on function public.set_job_post_state(uuid, public.job_post_state, public.job_close_reason, text, text) to authenticated, service_role;

revoke all on function public.job_post_move_allowed(public.job_post_state, public.job_post_state) from public, anon;
grant execute on function public.job_post_move_allowed(public.job_post_state, public.job_post_state) to authenticated, service_role;
revoke all on function public.company_today(uuid) from public, anon, authenticated;
grant execute on function public.company_today(uuid) to service_role;
revoke all on function public.derive_job_post_status() from public, anon, authenticated;
grant execute on function public.derive_job_post_status() to service_role;

-- ===========================================================================
-- 9. The old RPC, as a wrapper (JL-REQ-009)
-- ===========================================================================
-- For the deployed company code until JLT-030 drops it: active → open,
-- inactive → paused. Deactivating a job that isn't open, or activating one
-- that is, is a no-op that re-syncs all_jobs, as before.

create or replace function public.set_job_post_status(
  p_job_post_id uuid,
  p_status public.job_posting_status
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_state public.job_post_state;
  v_res jsonb;
begin
  if p_status is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;
  select state into v_state from public.job_postings where id = p_job_post_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_res := public.set_job_post_state(
    p_job_post_id,
    case
      when p_status = 'active' then 'open'
      when v_state = 'open' then 'paused'
      else v_state
    end::public.job_post_state
  );
  -- The old callers know these reasons only.
  if not coalesce((v_res ->> 'ok')::boolean, false) and v_res ->> 'reason' = 'not_found' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  return v_res;
end $$;

revoke all on function public.set_job_post_status(uuid, public.job_posting_status) from public, anon;
grant execute on function public.set_job_post_status(uuid, public.job_posting_status) to authenticated, service_role;

-- ===========================================================================
-- 10. The recruiter agent's job list (JL-REQ-031)
-- ===========================================================================
-- Adds the lifecycle (state, openings, closes_at, hires) and a state filter.
-- p_status stays for the deployed agent code. Hires are non-merged
-- applications in a hired-kind stage (JL-REQ-012), counted like applicants:
-- only where the caller can see applicants.

drop function if exists public.get_recruiter_job_summaries(uuid, public.job_posting_status, integer);

create or replace function public.get_recruiter_job_summaries(
  p_company_id uuid,
  p_status public.job_posting_status default null,
  p_limit integer default 15,
  p_states public.job_post_state[] default null
)
returns table(
  id uuid, title text, status public.job_posting_status, matching_status public.job_posting_matching_status,
  applicants bigint, new_24h bigint, created_at timestamptz, updated_at timestamptz,
  state public.job_post_state, openings integer, closes_at date, hires bigint
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_jobs uuid[];
  v_app_jobs uuid[];
begin
  if not public.is_company_member(p_company_id) or p_company_id is distinct from public.my_company_id() then
    raise exception 'not a member of this company' using errcode = 'insufficient_privilege';
  end if;
  v_jobs := public.my_job_ids_with('jobs.view');
  v_app_jobs := public.my_job_ids_with('applicants.view');

  return query
    select jp.id, jp.title, jp.status, jp.matching_status,
           count(a.id) filter (where jp.id = any (v_app_jobs)) as applicants,
           count(a.id) filter (where jp.id = any (v_app_jobs)
                                 and a.created_at > now() - interval '24 hours') as new_24h,
           jp.created_at, jp.updated_at,
           jp.state, jp.openings, jp.closes_at,
           count(a.id) filter (where jp.id = any (v_app_jobs)
                                 and a.merged_into_application_id is null
                                 and ps.kind = 'hired') as hires
      from public.job_postings jp
      left join public.applications a on a.job_post_id = jp.id
      left join public.pipeline_stages ps on ps.id = a.stage_id
     where jp.company_id = p_company_id
       and jp.id = any (v_jobs)
       and (p_status is null or jp.status = p_status)
       and (p_states is null or jp.state = any (p_states))
     group by jp.id
     order by (jp.state = 'open') desc, (jp.state in ('draft', 'pending_approval')) desc, jp.updated_at desc
     limit least(greatest(coalesce(p_limit, 15), 1), 50);
end;
$$;

revoke all on function public.get_recruiter_job_summaries(uuid, public.job_posting_status, integer, public.job_post_state[]) from public, anon;
grant execute on function public.get_recruiter_job_summaries(uuid, public.job_posting_status, integer, public.job_post_state[]) to authenticated, service_role;
