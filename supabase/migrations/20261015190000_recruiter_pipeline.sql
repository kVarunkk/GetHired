-- Recruiter pipeline, part 1 (PLT-011, PL-TASK-001): stages and moves.
-- plan/feature-recruiter-pipeline-spec.md §3.1–§3.3 and the tasks file's
-- "Differences from the spec" 1–5.
--
-- 1. pipeline_stage_kind, pipeline_stages, the kind <-> status maps.
-- 2. applications.stage_id / stage_entered_at / source.
-- 3. application_events (with actor_name, difference 5).
-- 4. RLS through is_company_member (PL-SEC-001). Candidates get nothing (PL-SEC-004).
-- 5. seed_default_pipeline and its company_info trigger.
-- 6. applications triggers: protect_application_pipeline_columns (difference 1),
--    applications_sync_status (both directions, difference 3 and 4) and the
--    `applied` event (difference 2).
-- 7. reorder_pipeline_stages.
-- 8. The idempotent backfill (PL-RISK-001).

-- ---------------------------------------------------------------------------
-- 1. Stages
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'pipeline_stage_kind') then
    create type public.pipeline_stage_kind as enum
      ('applied','screening','interview','offer','hired','rejected','on_hold');
  end if;
end $$;

create table if not exists public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_info(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  kind public.pipeline_stage_kind not null,
  position smallint not null check (position >= 0),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  constraint pipeline_stages_company_position_key
    unique (company_id, position) deferrable initially deferred
);

-- §3.2. helpers/pipeline/status-map.ts is the only TS copy.
create or replace function public.application_status_for_kind(p_kind public.pipeline_stage_kind)
returns public.application_status
language sql immutable set search_path = ''
as $$
  select case p_kind
    when 'applied' then 'submitted'
    when 'screening' then 'reviewed'
    when 'interview' then 'reviewed'
    when 'offer' then 'reviewed'
    when 'hired' then 'selected'
    when 'rejected' then 'rejected'
    when 'on_hold' then 'stand_by'
  end::public.application_status
$$;

-- The inverse, used by the backfill and the reverse sync (`reviewed` -> Screening).
create or replace function public.pipeline_kind_for_status(p_status public.application_status)
returns public.pipeline_stage_kind
language sql immutable set search_path = ''
as $$
  select case p_status
    when 'submitted' then 'applied'
    when 'reviewed' then 'screening'
    when 'selected' then 'hired'
    when 'rejected' then 'rejected'
    when 'stand_by' then 'on_hold'
  end::public.pipeline_stage_kind
$$;

-- The company's first active stage of a kind, or null.
create or replace function public.first_pipeline_stage(
  p_company_id uuid,
  p_kind public.pipeline_stage_kind
)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select s.id from public.pipeline_stages s
  where s.company_id = p_company_id and s.kind = p_kind and not s.archived
  order by s.position
  limit 1
$$;

revoke all on function public.first_pipeline_stage(uuid, public.pipeline_stage_kind)
  from public, anon, authenticated;

-- Stages are archived, never re-kinded or moved to another company, and the
-- kinds applied, hired and rejected can't be archived (PL-REQ-001).
create or replace function public.guard_pipeline_stage()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.company_id is distinct from old.company_id then
    raise exception 'A stage can''t move to another company.' using errcode = 'check_violation';
  end if;
  if new.kind is distinct from old.kind then
    raise exception 'A stage''s kind can''t change.' using errcode = 'check_violation';
  end if;
  if new.archived and not old.archived and new.kind in ('applied','hired','rejected') then
    raise exception 'The % stage can''t be archived.', new.kind using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists pipeline_stages_guard on public.pipeline_stages;
create trigger pipeline_stages_guard
  before update on public.pipeline_stages
  for each row execute function public.guard_pipeline_stage();

-- ---------------------------------------------------------------------------
-- 2. applications columns
-- ---------------------------------------------------------------------------

alter table public.applications
  add column if not exists stage_id uuid references public.pipeline_stages(id) on delete set null,
  add column if not exists stage_entered_at timestamptz not null default now(),
  add column if not exists source text not null default 'applied';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'applications_source_check'
  ) then
    alter table public.applications add constraint applications_source_check
      check (source in ('applied','outreach','imported','agent'));
  end if;
end $$;

create index if not exists applications_job_post_stage_idx
  on public.applications (job_post_id, stage_id);

-- ---------------------------------------------------------------------------
-- 3. Events
-- ---------------------------------------------------------------------------

create table if not exists public.application_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_info(id) on delete cascade,
  application_id uuid references public.applications(id) on delete cascade,
  candidate_user_id uuid references auth.users(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,   -- null = system
  actor_name text,                                                   -- kept after a member leaves
  type text not null check (type in
    ('applied','stage_changed','email_sent','note_added','screened','outreach_sent','outreach_replied')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists application_events_application_created_idx
  on public.application_events (application_id, created_at);
create index if not exists application_events_company_created_idx
  on public.application_events (company_id, created_at desc);
-- One `applied` event per application, so the trigger and the backfill are idempotent.
create unique index if not exists application_events_one_applied_idx
  on public.application_events (application_id) where type = 'applied';

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------

alter table public.pipeline_stages enable row level security;
alter table public.application_events enable row level security;

-- Stages are archived, not deleted (applications keep pointing at them), so
-- there's no delete policy.
drop policy if exists "pipeline_stages_select_company" on public.pipeline_stages;
create policy "pipeline_stages_select_company" on public.pipeline_stages
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists "pipeline_stages_insert_company" on public.pipeline_stages;
create policy "pipeline_stages_insert_company" on public.pipeline_stages
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists "pipeline_stages_update_company" on public.pipeline_stages;
create policy "pipeline_stages_update_company" on public.pipeline_stages
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

-- Members read their company's events and insert them through server actions.
-- An event may only point at one of the company's own applications. Events
-- are never updated or deleted. System events use the service role.
drop policy if exists "application_events_select_company" on public.application_events;
create policy "application_events_select_company" on public.application_events
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists "application_events_insert_company" on public.application_events;
create policy "application_events_insert_company" on public.application_events
  for insert to authenticated with check (
    public.is_company_member(company_id)
    and (
      application_id is null
      or exists (
        select 1 from public.applications a
        join public.job_postings jp on jp.id = a.job_post_id
        where a.id = application_id and jp.company_id = application_events.company_id
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Default stages (PL-REQ-001)
-- ---------------------------------------------------------------------------

-- Idempotent: a company that already has stages is left alone. (ON CONFLICT
-- can't use the deferrable position constraint as its arbiter.)
create or replace function public.seed_default_pipeline(p_company_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.pipeline_stages where company_id = p_company_id) then
    return;
  end if;

  insert into public.pipeline_stages (company_id, name, kind, position)
  values
    (p_company_id, 'Applied', 'applied', 0),
    (p_company_id, 'Screening', 'screening', 1),
    (p_company_id, 'Interview', 'interview', 2),
    (p_company_id, 'Offer', 'offer', 3),
    (p_company_id, 'Hired', 'hired', 4),
    (p_company_id, 'Rejected', 'rejected', 5),
    (p_company_id, 'On hold', 'on_hold', 6);
end $$;

revoke all on function public.seed_default_pipeline(uuid) from public, anon, authenticated;
grant execute on function public.seed_default_pipeline(uuid) to service_role;

create or replace function public.seed_default_pipeline_for_company()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.seed_default_pipeline(new.id);
  return new;
end $$;

revoke all on function public.seed_default_pipeline_for_company() from public, anon, authenticated;

drop trigger if exists company_info_seed_pipeline on public.company_info;
create trigger company_info_seed_pipeline
  after insert on public.company_info
  for each row execute function public.seed_default_pipeline_for_company();

-- ---------------------------------------------------------------------------
-- 6. applications triggers. Before-triggers fire in name order:
--    applications_protect_pipeline_columns, then applications_sync_status.
-- ---------------------------------------------------------------------------

-- Difference 1. SECURITY INVOKER on purpose: current_role must be the caller's
-- role (see protect_company_info_columns). On platform rows (job_post_id set),
-- only a member of the job's company or the service role may change status,
-- stage_id, stage_entered_at, source or job_post_id. Applicants keep writing
-- `status` on their off-platform tracker rows, which never have a stage.
create or replace function public.protect_application_pipeline_columns()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_company uuid;
begin
  if current_role <> 'authenticated' then return new; end if;

  if new.job_post_id is null then
    if tg_op = 'UPDATE' and old.job_post_id is not null then
      raise exception 'Only the company can change this application.'
        using errcode = 'insufficient_privilege';
    end if;
    new.stage_id := null;
    return new;
  end if;

  select jp.company_id into v_company from public.job_postings jp where jp.id = new.job_post_id;
  if v_company is not null and public.is_company_member(v_company) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- The sync trigger assigns the Applied stage.
    new.status := 'submitted';
    new.stage_id := null;
    new.stage_entered_at := now();
    if new.source not in ('applied','agent') then
      new.source := 'applied';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
     or new.stage_id is distinct from old.stage_id
     or new.stage_entered_at is distinct from old.stage_entered_at
     or new.source is distinct from old.source
     or new.job_post_id is distinct from old.job_post_id then
    raise exception 'Only the company can change this application''s status or stage.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

drop trigger if exists applications_protect_pipeline_columns on public.applications;
create trigger applications_protect_pipeline_columns
  before insert or update on public.applications
  for each row execute function public.protect_application_pipeline_columns();

-- §3.2 plus differences 2–4. Keeps status and stage in step on platform rows:
--  * stage_id changes -> the stage must be the job's company's and active;
--    status follows its kind and stage_entered_at resets;
--  * status changes alone (code that predates stages) -> the first active
--    stage of the inverse kind;
--  * insert without a stage -> the first active stage of the status's kind
--    (Applied for a new application).
create or replace function public.applications_sync_status()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
  v_stage public.pipeline_stages%rowtype;
begin
  if new.job_post_id is null then return new; end if;

  select jp.company_id into v_company from public.job_postings jp where jp.id = new.job_post_id;
  if v_company is null then return new; end if;

  if new.stage_id is not null
     and (tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id) then
    select * into v_stage from public.pipeline_stages where id = new.stage_id;
    if v_stage.id is null or v_stage.company_id <> v_company or v_stage.archived then
      raise exception 'Stage not found.' using errcode = 'check_violation';
    end if;
    new.status := public.application_status_for_kind(v_stage.kind);
    if tg_op = 'UPDATE' and new.stage_entered_at is not distinct from old.stage_entered_at then
      new.stage_entered_at := now();
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.stage_id := public.first_pipeline_stage(v_company, public.pipeline_kind_for_status(new.status));
    return new;
  end if;

  if new.status is distinct from old.status and new.stage_id is not distinct from old.stage_id then
    new.stage_id := public.first_pipeline_stage(v_company, public.pipeline_kind_for_status(new.status));
    if new.stage_entered_at is not distinct from old.stage_entered_at then
      new.stage_entered_at := now();
    end if;
  end if;

  return new;
end $$;

revoke all on function public.applications_sync_status() from public, anon, authenticated;

drop trigger if exists applications_sync_status on public.applications;
create trigger applications_sync_status
  before insert or update on public.applications
  for each row execute function public.applications_sync_status();

-- Difference 2: one `applied` event per new platform application. Like
-- enqueue_application_screening, it never blocks the insert.
create or replace function public.log_application_applied()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
begin
  if new.job_post_id is null then return new; end if;

  begin
    select company_id into v_company from public.job_postings where id = new.job_post_id;
    if v_company is null then return new; end if;

    insert into public.application_events
      (company_id, application_id, candidate_user_id, type, payload, created_at)
    values
      (v_company, new.id, new.applicant_user_id, 'applied',
       jsonb_build_object('stage_id', new.stage_id, 'source', new.source), new.created_at)
    on conflict (application_id) where type = 'applied' do nothing;
  exception when others then
    raise warning 'log_application_applied(%): %', new.id, sqlerrm;
  end;

  return new;
end $$;

revoke all on function public.log_application_applied() from public, anon, authenticated;

drop trigger if exists applications_log_applied on public.applications;
create trigger applications_log_applied
  after insert on public.applications
  for each row execute function public.log_application_applied();

-- ---------------------------------------------------------------------------
-- 7. Reorder
-- ---------------------------------------------------------------------------

-- p_ids must be exactly the company's active stages, in their new order.
-- Archived stages keep their relative order after them. One update against
-- the deferred unique constraint. SECURITY INVOKER: RLS applies too.
create or replace function public.reorder_pipeline_stages(p_ids uuid[])
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_company uuid;
begin
  select s.company_id into v_company from public.pipeline_stages s where s.id = p_ids[1];
  if v_company is null or not public.is_company_member(v_company) then
    raise exception 'Stage not found.' using errcode = 'insufficient_privilege';
  end if;

  if cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
     or (select array_agg(s.id order by s.id) from public.pipeline_stages s
          where s.company_id = v_company and not s.archived)
        is distinct from (select array_agg(x order by x) from unnest(p_ids) x) then
    raise exception 'The list must be exactly the company''s active stages.'
      using errcode = 'check_violation';
  end if;

  update public.pipeline_stages s
     set position = o.new_position
    from (
      select id, (row_number() over (order by ord) - 1)::smallint as new_position
      from (
        select t.id, t.ord from unnest(p_ids) with ordinality t(id, ord)
        union all
        select a.id, cardinality(p_ids) + a.position + 1
          from public.pipeline_stages a
         where a.company_id = v_company and a.archived
      ) all_stages
    ) o
   where s.id = o.id and s.position is distinct from o.new_position;
end $$;

revoke all on function public.reorder_pipeline_stages(uuid[]) from public, anon;
grant execute on function public.reorder_pipeline_stages(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Backfill (§3.3). Idempotent: only rows without a stage, one `applied`
--    event per application. supabase/tests/recruiter_pipeline.sql calls it again.
-- ---------------------------------------------------------------------------

create or replace function public.backfill_recruiter_pipeline()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.seed_default_pipeline(ci.id) from public.company_info ci;

  update public.applications a
     set stage_id = public.first_pipeline_stage(jp.company_id, public.pipeline_kind_for_status(a.status)),
         stage_entered_at = a.updated_at
    from public.job_postings jp
   where a.stage_id is null
     and jp.id = a.job_post_id
     and jp.company_id is not null;

  insert into public.application_events
    (company_id, application_id, candidate_user_id, type, payload, created_at)
  select jp.company_id, a.id, a.applicant_user_id, 'applied',
         jsonb_build_object('backfill', true), a.created_at
    from public.applications a
    join public.job_postings jp on jp.id = a.job_post_id
   where jp.company_id is not null
  on conflict (application_id) where type = 'applied' do nothing;
end $$;

revoke all on function public.backfill_recruiter_pipeline() from public, anon, authenticated;

select public.backfill_recruiter_pipeline();
