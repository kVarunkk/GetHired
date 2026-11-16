-- Job pipelines (plan/job-pipelines/feature-job-pipelines-spec.md, phase 1:
-- JPT-010 to JPT-016). A company keeps several named pipelines, each with its
-- own stages, and every company job picks one.
--
-- Compatible with the deployed code (JP-CON-001): after the backfill each
-- company has exactly one pipeline ("Default"), stage inserts without a
-- pipeline_id land in the default one, and first_pipeline_stage /
-- import_stage(company, …) keep working until the cleanup migration.

-- ------------------------------------------------------------------ schema

create table if not exists public.company_pipelines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_info(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  is_default boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not (is_default and archived))
);
create unique index if not exists company_pipelines_one_default
  on public.company_pipelines (company_id) where is_default;
create unique index if not exists company_pipelines_active_name
  on public.company_pipelines (company_id, lower(btrim(name))) where not archived;

alter table public.company_pipelines enable row level security;

-- JP-SEC-001: members read. Every write goes through the RPCs below, so the
-- copy-from rule (JP-REQ-005) and the default/in-use checks can't be skipped.
drop policy if exists company_pipelines_select_company on public.company_pipelines;
create policy company_pipelines_select_company on public.company_pipelines
  for select to authenticated using (public.is_company_member(company_id));

revoke all on table public.company_pipelines from anon;
revoke insert, update, delete, truncate on table public.company_pipelines from authenticated;
grant select on table public.company_pipelines to authenticated;

alter table public.pipeline_stages
  add column if not exists pipeline_id uuid references public.company_pipelines(id) on delete cascade;

alter table public.job_postings
  add column if not exists pipeline_id uuid references public.company_pipelines(id);
create index if not exists job_postings_pipeline_id_idx on public.job_postings (pipeline_id);

-- ------------------------------------------------------------- the switch flag

-- Set (transaction-local) only by set_job_pipeline: lets job_postings.pipeline_id
-- change and keeps the interview-closing triggers quiet, because a switch never
-- changes a candidate's status (JP-REQ-006).
create or replace function public.pipeline_switch_in_progress()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('gethired.pipeline_switch', true), '') = '1'
$$;

-- ------------------------------------------------------------- stage seeding

-- The seven PL-REQ-001 stages, into one pipeline.
create or replace function public.seed_pipeline_stages(p_pipeline_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.company_pipelines where id = p_pipeline_id;
  if v_company is null or exists (select 1 from public.pipeline_stages where pipeline_id = p_pipeline_id) then
    return;
  end if;
  insert into public.pipeline_stages (company_id, pipeline_id, name, kind, position)
  values
    (v_company, p_pipeline_id, 'Applied', 'applied', 0),
    (v_company, p_pipeline_id, 'Screening', 'screening', 1),
    (v_company, p_pipeline_id, 'Interview', 'interview', 2),
    (v_company, p_pipeline_id, 'Offer', 'offer', 3),
    (v_company, p_pipeline_id, 'Hired', 'hired', 4),
    (v_company, p_pipeline_id, 'Rejected', 'rejected', 5),
    (v_company, p_pipeline_id, 'On hold', 'on_hold', 6);
end $$;
revoke all on function public.seed_pipeline_stages(uuid) from public, anon, authenticated;

-- A new company: the Default pipeline, then its stages. Idempotent.
create or replace function public.seed_default_pipeline(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pipeline uuid;
begin
  if exists (select 1 from public.company_pipelines where company_id = p_company_id) then
    return;
  end if;
  insert into public.company_pipelines (company_id, name, is_default)
  values (p_company_id, 'Default', true)
  returning id into v_pipeline;

  -- Stages written before pipelines existed (the backfill adopts them).
  if exists (select 1 from public.pipeline_stages where company_id = p_company_id) then
    update public.pipeline_stages set pipeline_id = v_pipeline
     where company_id = p_company_id and pipeline_id is null;
    return;
  end if;
  perform public.seed_pipeline_stages(v_pipeline);
end $$;

-- ------------------------------------------------------------------ backfill

-- §2.2. Rerunnable: supabase/tests/job_pipelines.sql runs it again.
create or replace function public.backfill_job_pipelines()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_default_pipeline(ci.id)
     from public.company_info ci
    where not exists (select 1 from public.company_pipelines p where p.company_id = ci.id);

  update public.pipeline_stages s
     set pipeline_id = p.id
    from public.company_pipelines p
   where s.pipeline_id is null and p.company_id = s.company_id and p.is_default;

  perform set_config('gethired.pipeline_switch', '1', true);
  update public.job_postings jp
     set pipeline_id = p.id
    from public.company_pipelines p
   where jp.pipeline_id is null and jp.company_id is not null
     and p.company_id = jp.company_id and p.is_default;
  perform set_config('gethired.pipeline_switch', '', true);
end $$;
revoke all on function public.backfill_job_pipelines() from public, anon, authenticated;

select public.backfill_job_pipelines();

alter table public.pipeline_stages alter column pipeline_id set not null;
alter table public.pipeline_stages drop constraint if exists pipeline_stages_company_position_key;
alter table public.pipeline_stages drop constraint if exists pipeline_stages_pipeline_position_key;
alter table public.pipeline_stages
  add constraint pipeline_stages_pipeline_position_key
  unique (pipeline_id, position) deferrable initially deferred;
create index if not exists pipeline_stages_pipeline_active_idx
  on public.pipeline_stages (pipeline_id, archived, position);

-- --------------------------------------------------------- stage lookups

-- The first active stage of `kind` in the job's pipeline.
create or replace function public.first_job_stage(p_job_post_id uuid, p_kind public.pipeline_stage_kind)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
    from public.job_postings jp
    join public.pipeline_stages s on s.pipeline_id = jp.pipeline_id
   where jp.id = p_job_post_id and s.kind = p_kind and not s.archived
   order by s.position
   limit 1
$$;
revoke all on function public.first_job_stage(uuid, public.pipeline_stage_kind) from public, anon, authenticated;

-- Kept for the deployed code until the cleanup migration: the default pipeline.
create or replace function public.first_pipeline_stage(p_company_id uuid, p_kind public.pipeline_stage_kind)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
    from public.pipeline_stages s
    join public.company_pipelines p on p.id = s.pipeline_id and p.is_default
   where s.company_id = p_company_id and s.kind = p_kind and not s.archived
   order by s.position
   limit 1
$$;

-- The job-scoped import stage. (Named apart from import_stage(company, stage),
-- which has the same argument types and stays until the cleanup migration.)
create or replace function public.import_job_stage(p_job_post_id uuid, p_stage_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_stage_id is null then public.first_job_stage(p_job_post_id, 'applied')
    else (select s.id from public.pipeline_stages s
            join public.job_postings jp on jp.pipeline_id = s.pipeline_id
           where s.id = p_stage_id and jp.id = p_job_post_id and not s.archived)
  end
$$;
revoke all on function public.import_job_stage(uuid, uuid) from public, anon, authenticated;

-- Kept for the deployed code: the default pipeline's stages.
create or replace function public.import_stage(p_company uuid, p_stage_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_stage_id is null then public.first_pipeline_stage(p_company, 'applied')
    else (select s.id from public.pipeline_stages s
            join public.company_pipelines p on p.id = s.pipeline_id and p.is_default
           where s.id = p_stage_id and s.company_id = p_company and not s.archived)
  end
$$;

-- ------------------------------------------------------- stage rules

-- Before insert: a stage without a pipeline goes to the company's default
-- (the deployed createStage doesn't send one); its company is its pipeline's.
-- Insert and unarchive: at most 12 active stages per pipeline (PL-REQ-001,
-- JP-REQ-002). One function, so the fill always runs before the count.
create or replace function public.pipeline_stages_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  if tg_op = 'INSERT' then
    if new.pipeline_id is null then
      select p.id into new.pipeline_id from public.company_pipelines p
       where p.company_id = new.company_id and p.is_default;
      if new.pipeline_id is null then
        raise exception 'Pipeline not found.' using errcode = 'check_violation';
      end if;
    end if;
    select company_id into v_company from public.company_pipelines where id = new.pipeline_id;
    if v_company is distinct from new.company_id then
      raise exception 'A stage belongs to its pipeline''s company.' using errcode = 'check_violation';
    end if;
  end if;

  if not new.archived and (tg_op = 'INSERT' or old.archived) and (
    select count(*) from public.pipeline_stages s
     where s.pipeline_id = new.pipeline_id and not s.archived and s.id <> new.id
  ) >= 12 then
    raise exception 'A pipeline can have at most 12 stages.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.pipeline_stages_before_write() from public, anon, authenticated;

drop trigger if exists pipeline_stages_before_write on public.pipeline_stages;
create trigger pipeline_stages_before_write
  before insert or update of archived on public.pipeline_stages
  for each row execute function public.pipeline_stages_before_write();

create or replace function public.guard_pipeline_stage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.company_id is distinct from old.company_id then
    raise exception 'A stage can''t move to another company.' using errcode = 'check_violation';
  end if;
  -- (A stage from before pipelines, still null, is adopted by the backfill.)
  if old.pipeline_id is not null and new.pipeline_id is distinct from old.pipeline_id then
    raise exception 'A stage can''t move to another pipeline.' using errcode = 'check_violation';
  end if;
  if new.kind is distinct from old.kind then
    raise exception 'A stage''s kind can''t change.' using errcode = 'check_violation';
  end if;
  -- Each pipeline keeps an active applied, hired and rejected stage.
  if new.archived and not old.archived and new.kind in ('applied', 'hired', 'rejected')
     and not exists (
       select 1 from public.pipeline_stages s
        where s.pipeline_id = new.pipeline_id and s.kind = new.kind and not s.archived and s.id <> new.id
     ) then
    raise exception 'The % stage can''t be archived.', new.kind using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- `p_ids` must be exactly one pipeline's active stages.
create or replace function public.reorder_pipeline_stages(p_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_company uuid;
  v_pipeline uuid;
begin
  select s.company_id, s.pipeline_id into v_company, v_pipeline
    from public.pipeline_stages s where s.id = p_ids[1];
  if v_company is null or not public.has_company_permission(v_company, 'settings.stages') then
    raise exception 'Stage not found.' using errcode = 'insufficient_privilege';
  end if;

  if cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
     or (select array_agg(s.id order by s.id) from public.pipeline_stages s
          where s.pipeline_id = v_pipeline and not s.archived)
        is distinct from (select array_agg(x order by x) from unnest(p_ids) x) then
    raise exception 'The list must be exactly the pipeline''s active stages.'
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
         where a.pipeline_id = v_pipeline and a.archived
      ) all_stages
    ) o
   where s.id = o.id and s.position is distinct from o.new_position;
end $$;

-- ------------------------------------------------------- jobs

-- A company job gets the default pipeline; pipeline_id changes only through
-- set_job_pipeline; the pipeline is the job's company's and not archived.
create or replace function public.job_postings_set_pipeline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pipeline public.company_pipelines%rowtype;
begin
  if tg_op = 'UPDATE' and new.pipeline_id is not distinct from old.pipeline_id then
    return new;
  end if;
  if tg_op = 'UPDATE' and not public.pipeline_switch_in_progress() then
    raise exception 'Change a job''s pipeline with set_job_pipeline.' using errcode = 'insufficient_privilege';
  end if;

  if new.company_id is null then
    if new.pipeline_id is not null then
      raise exception 'Pipeline not found.' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.pipeline_id is null then
    select p.id into new.pipeline_id from public.company_pipelines p
     where p.company_id = new.company_id and p.is_default;
    return new;
  end if;

  select * into v_pipeline from public.company_pipelines where id = new.pipeline_id;
  if v_pipeline.id is null or v_pipeline.company_id <> new.company_id or v_pipeline.archived then
    raise exception 'Pipeline not found.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.job_postings_set_pipeline() from public, anon, authenticated;

drop trigger if exists job_postings_set_pipeline on public.job_postings;
create trigger job_postings_set_pipeline
  before insert or update of pipeline_id on public.job_postings
  for each row execute function public.job_postings_set_pipeline();

-- ------------------------------------------------------- applications

-- JP-REQ-004: an application's stage is a stage of its job's pipeline.
create or replace function public.applications_sync_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_pipeline uuid;
  v_stage public.pipeline_stages%rowtype;
begin
  if new.job_post_id is null then return new; end if;

  select jp.company_id, jp.pipeline_id into v_company, v_pipeline
    from public.job_postings jp where jp.id = new.job_post_id;
  if v_company is null then return new; end if;

  if new.stage_id is not null
     and (tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id) then
    select * into v_stage from public.pipeline_stages where id = new.stage_id;
    if v_stage.id is null or v_stage.archived or v_stage.company_id <> v_company
       or v_stage.pipeline_id is distinct from v_pipeline then
      raise exception 'Stage not found.' using errcode = 'check_violation';
    end if;
    new.status := public.application_status_for_kind(v_stage.kind);
    if tg_op = 'UPDATE' and new.stage_entered_at is not distinct from old.stage_entered_at then
      new.stage_entered_at := now();
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.stage_id := public.first_job_stage(new.job_post_id, public.pipeline_kind_for_status(new.status));
    return new;
  end if;

  if new.status is distinct from old.status and new.stage_id is not distinct from old.stage_id then
    new.stage_id := public.first_job_stage(new.job_post_id, public.pipeline_kind_for_status(new.status));
    if new.stage_entered_at is not distinct from old.stage_entered_at then
      new.stage_entered_at := now();
    end if;
  end if;

  return new;
end $$;

-- A pipeline switch keeps the candidate's status, so it closes nothing.
create or replace function public.applications_close_screening_interview()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.pipeline_stage_kind;
  v_row public.application_interviews%rowtype;
begin
  if public.pipeline_switch_in_progress() then return null; end if;
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

create or replace function public.applications_close_human_interviews()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.pipeline_stage_kind;
  v_row public.scheduled_interviews%rowtype;
begin
  if public.pipeline_switch_in_progress() then return null; end if;
  select kind into v_kind from public.pipeline_stages where id = new.stage_id;
  if v_kind is null or v_kind not in ('rejected', 'hired') then return null; end if;
  if public.move_keeps_interviews() then return null; end if;

  for v_row in
    update public.scheduled_interviews
       set status = 'cancelled',
           booking_token_expires_at = case when booking_token_hash is null then booking_token_expires_at
                                           else least(booking_token_expires_at, now()) end,
           updated_at = now()
     where application_id = new.id
       and (status = 'awaiting_candidate' or (status = 'scheduled' and starts_at > now()))
    returning *
  loop
    perform public.log_meeting_event(v_row, 'meeting_cancelled', (select auth.uid()),
      jsonb_build_object('reason', 'stage', 'stage_kind', v_kind));
    perform public.queue_interview_calendar_op(v_row.id, 'delete');
  end loop;
  return null;
end $$;
revoke all on function public.applications_close_human_interviews() from public, anon, authenticated;

-- ------------------------------------------------------- imports

create or replace function public.add_candidates_to_job(p_job_id uuid, p_candidate_ids uuid[], p_stage_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_stage uuid;
  v_id uuid;
  v_result text;
  v_added int := 0; v_in_job int := 0; v_no_email int := 0; v_missing int := 0;
begin
  if v_company is null or not exists (
    select 1 from public.job_postings jp where jp.id = p_job_id and jp.company_id = v_company
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.has_company_permission(v_company, 'applicants.import', p_job_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if coalesce(cardinality(p_candidate_ids), 0) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_rows');
  end if;
  if cardinality(p_candidate_ids) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  v_stage := public.import_job_stage(p_job_id, p_stage_id);
  if v_stage is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_stage');
  end if;

  foreach v_id in array (select array_agg(distinct x) from unnest(p_candidate_ids) x) loop
    if not exists (select 1 from public.company_candidates c where c.id = v_id and c.company_id = v_company) then
      v_missing := v_missing + 1;
      continue;
    end if;
    v_result := public.create_imported_application(v_id, p_job_id, v_stage, null);
    case v_result
      when 'added' then v_added := v_added + 1;
      when 'already_in_job' then v_in_job := v_in_job + 1;
      when 'no_email' then v_no_email := v_no_email + 1;
    end case;
  end loop;

  return jsonb_build_object('ok', true, 'counts', jsonb_build_object(
    'added_to_job', v_added, 'already_in_job', v_in_job, 'no_email', v_no_email, 'not_found', v_missing));
end $$;

create or replace function public.submit_resume_batch(p_batch_id uuid, p_row_ids uuid[], p_options jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.candidate_import_batches%rowtype := public.resume_batch_for_update(p_batch_id);
  v_options jsonb := coalesce(p_options, '{}'::jsonb);
  v_dest record;
  v_stage uuid;
  v_invite boolean := coalesce((v_options ->> 'auto_invite')::boolean, false);
  v_queued int;
begin
  if v_batch.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.has_company_permission(v_batch.company_id, 'applicants.import', v_batch.job_post_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_batch.status <> 'draft' then
    return jsonb_build_object('ok', false, 'reason', 'already_submitted');
  end if;
  select * into v_dest from public.resume_batch_destination(v_batch, v_options);
  if v_dest.reason is not null then
    return jsonb_build_object('ok', false, 'reason', v_dest.reason);
  end if;
  if (select count(*) from public.candidate_import_batches b
       where b.company_id = v_batch.company_id and b.kind = 'resumes' and b.status = 'parsing') >= 2 then
    return jsonb_build_object('ok', false, 'reason', 'parsing_limit');
  end if;
  if coalesce(cardinality(p_row_ids), 0) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_rows');
  end if;
  if nullif(v_options ->> 'stage_id', '') is not null then
    if v_dest.job_id is null then
      return jsonb_build_object('ok', false, 'reason', 'invalid_stage');
    end if;
    v_stage := public.import_job_stage(v_dest.job_id, public.try_uuid(v_options ->> 'stage_id'));
    if v_stage is null then
      return jsonb_build_object('ok', false, 'reason', 'invalid_stage');
    end if;
  end if;
  if v_invite and v_dest.job_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invite_needs_job');
  end if;

  update public.candidate_import_rows r set status = 'failed', error_code = 'unreadable', updated_at = now()
   where r.batch_id = p_batch_id and r.status = 'queued' and not (r.id = any (p_row_ids));

  select count(*) into v_queued from public.candidate_import_rows r
   where r.batch_id = p_batch_id and r.status = 'queued';
  perform pgmq.send('candidate_import_queue', jsonb_build_object('row_id', r.id))
     from public.candidate_import_rows r
    where r.batch_id = p_batch_id and r.status = 'queued';

  update public.candidate_import_batches set
    status = case when v_queued > 0 then 'parsing' else 'ready' end,
    job_post_id = v_dest.job_id,
    talent_list_id = v_dest.list_id,
    stage_id = v_stage,
    auto_invite = v_invite
   where id = p_batch_id;

  return jsonb_build_object('ok', true, 'queued', v_queued);
end $$;

create or replace function public.confirm_resume_import(p_batch_id uuid, p_rows jsonb, p_options jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_batch public.candidate_import_batches%rowtype;
  v_dest record;
  v_job uuid;
  v_list uuid;
  v_stage uuid;
  v_action text := coalesce(p_options ->> 'duplicate_action', 'skip');
  v_actions jsonb := '{}'::jsonb;
  v_known jsonb;
  v_missing jsonb;
  v_row record;
  v_email text;
  v_row_action text;
  v_candidate public.company_candidates%rowtype;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_result text;
  v_delete jsonb := '[]'::jsonb;
  v_created int := 0; v_updated int := 0; v_skipped int := 0; v_known_n int := 0;
  v_added int := 0; v_in_job int := 0; v_outreach int := 0; v_listed int := 0;
  v_counts jsonb;
begin
  select * into v_batch from public.candidate_import_batches where id = p_batch_id for update;
  if v_batch.id is null or v_batch.company_id is distinct from v_company then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_batch.status = 'confirmed' then
    return jsonb_build_object('ok', false, 'reason', 'already_confirmed');
  end if;
  if v_batch.status not in ('parsing', 'ready') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if not public.has_company_permission(v_company, 'applicants.import', v_batch.job_post_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_dest from public.resume_batch_destination(v_batch, p_options);
  if v_dest.reason is not null then
    return jsonb_build_object('ok', false, 'reason', v_dest.reason);
  end if;
  v_job := v_dest.job_id;
  v_list := v_dest.list_id;
  if coalesce((p_options ->> 'attested')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'reason', 'not_attested');
  end if;
  if v_action not in ('skip', 'fill', 'overwrite') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if p_rows is not null and jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_job is not null then
    v_stage := public.import_job_stage(v_job,
      coalesce(public.try_uuid(p_options ->> 'stage_id'), v_batch.stage_id));
    if v_stage is null then
      return jsonb_build_object('ok', false, 'reason', 'invalid_stage');
    end if;
  elsif nullif(p_options ->> 'stage_id', '') is not null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_stage');
  end if;

  select coalesce(jsonb_object_agg(r ->> 'row_id', r ->> 'duplicate_action'), '{}'::jsonb) into v_actions
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where r ->> 'duplicate_action' in ('skip', 'fill', 'overwrite');

  create temporary table if not exists pg_temp.resume_confirm_rows (
    id uuid, file_path text, fields jsonb, resume jsonb, duplicate_action text, created_at timestamptz
  ) on commit drop;
  truncate pg_temp.resume_confirm_rows;
  insert into pg_temp.resume_confirm_rows
  select r.id, r.file_path,
         coalesce(r.extracted -> 'fields', '{}'::jsonb) || coalesce(r.edited, '{}'::jsonb),
         r.extracted -> 'resume', r.duplicate_action, r.created_at
    from public.candidate_import_rows r
   where r.batch_id = p_batch_id and r.status = 'parsed';

  if not exists (select 1 from pg_temp.resume_confirm_rows) then
    return jsonb_build_object('ok', false, 'reason', 'no_rows');
  end if;
  -- BI-DEC-010: only a job needs everyone's email.
  if v_job is not null then
    select jsonb_agg(id) into v_missing from pg_temp.resume_confirm_rows
     where public.import_text(fields, 'email') is null;
    if v_missing is not null then
      return jsonb_build_object('ok', false, 'reason', 'missing_email', 'row_ids', v_missing);
    end if;
  end if;

  -- BI-REQ-019, from the session: GetHired users the caller can already see.
  select coalesce(jsonb_object_agg(m.email, m.user_id), '{}'::jsonb) into v_known
    from public.match_known_applicants(array(
      select lower(public.import_text(fields, 'email')) from pg_temp.resume_confirm_rows
       where public.import_text(fields, 'email') is not null
    )) m;

  for v_row in select * from pg_temp.resume_confirm_rows order by created_at, id loop
    v_email := lower(public.import_text(v_row.fields, 'email'));
    v_row_action := coalesce(v_actions ->> v_row.id::text, v_row.duplicate_action, v_action);

    if v_email is not null and v_known ? v_email then
      v_known_n := v_known_n + 1;
      if v_list is not null then
        insert into public.talent_list_members (list_id, candidate_user_id)
        values (v_list, (v_known ->> v_email)::uuid)
        on conflict do nothing;
        if found then v_listed := v_listed + 1; end if;
      end if;
      if v_job is not null then
        if exists (select 1 from public.applications a
                    where a.job_post_id = v_job and a.applicant_user_id = (v_known ->> v_email)::uuid) then
          v_in_job := v_in_job + 1;
        else
          v_outreach := v_outreach + 1;
        end if;
      end if;
      v_delete := v_delete || to_jsonb(v_row.file_path);
      update public.candidate_import_rows set status = 'removed', updated_at = now() where id = v_row.id;
      continue;
    end if;

    v_candidate := null;
    if v_email is not null then
      select * into v_candidate from public.company_candidates c
       where c.company_id = v_company and lower(c.email) = v_email for update;
    end if;

    if v_candidate.id is null then
      insert into public.company_candidates
        (company_id, full_name, email, phone, location, current_title, current_company, experience_years,
         links, skills, tags, notes, resume_path, resume_content, source_batch_id, created_by)
      values
        (v_company, public.import_text(v_row.fields, 'full_name'), v_email, public.import_text(v_row.fields, 'phone'),
         public.import_text(v_row.fields, 'location'), public.import_text(v_row.fields, 'current_title'),
         public.import_text(v_row.fields, 'current_company'),
         (public.import_text(v_row.fields, 'experience_years'))::numeric,
         public.import_links(v_row.fields), public.import_list(v_row.fields, 'skills'),
         public.import_list(v_row.fields, 'tags'), public.import_text(v_row.fields, 'notes'),
         v_row.file_path, v_row.resume, p_batch_id, (select auth.uid()))
      returning id into v_id;
      v_created := v_created + 1;
      update public.candidate_import_rows set status = 'confirmed', updated_at = now() where id = v_row.id;
    elsif v_row_action = 'skip' then
      v_id := v_candidate.id;
      v_skipped := v_skipped + 1;
      v_delete := v_delete || to_jsonb(v_row.file_path);
      update public.candidate_import_rows set status = 'removed', duplicate_of = v_id, updated_at = now()
       where id = v_row.id;
    else
      -- BI-REQ-024: "fill" and "overwrite" also replace the stored resume.
      v_id := v_candidate.id;
      perform public.import_update_candidate(v_id, v_row.fields, v_row_action);
      update public.company_candidates set resume_path = v_row.file_path, resume_content = v_row.resume
       where id = v_id;
      if v_candidate.resume_path is not null and v_candidate.resume_path <> v_row.file_path then
        v_delete := v_delete || to_jsonb(v_candidate.resume_path);
      end if;
      v_updated := v_updated + 1;
      update public.candidate_import_rows set status = 'confirmed', duplicate_of = v_id, updated_at = now()
       where id = v_row.id;
    end if;
    v_ids := v_ids || v_id;

    if v_list is not null then
      insert into public.talent_list_members (list_id, company_candidate_id)
      values (v_list, v_id)
      on conflict do nothing;
      if found then v_listed := v_listed + 1; end if;
    end if;

    if v_job is not null then
      -- As for spreadsheets, a skipped duplicate still joins the job (difference 6).
      v_result := public.create_imported_application(v_id, v_job, v_stage, p_batch_id);
      case v_result
        when 'added' then v_added := v_added + 1;
        when 'already_in_job' then v_in_job := v_in_job + 1;
        else null;
      end case;
    end if;
  end loop;

  v_counts := jsonb_build_object(
    'created', v_created, 'updated', v_updated, 'skipped', v_skipped, 'known', v_known_n,
    'added_to_job', v_added, 'already_in_job', v_in_job, 'needs_outreach', v_outreach,
    'no_email', 0, 'added_to_list', v_listed
  );

  update public.candidate_import_batches set
    status = 'confirmed',
    confirmed_at = now(),
    job_post_id = v_job,
    talent_list_id = v_list,
    stage_id = v_stage,
    duplicate_action = v_action,
    auto_invite = v_job is not null and coalesce((p_options ->> 'auto_invite')::boolean, v_batch.auto_invite),
    lawful_basis_attested_by = (select auth.uid()),
    lawful_basis_attested_at = now(),
    lawful_basis_note = left(nullif(btrim(p_options ->> 'lawful_basis_note'), ''), 200),
    counts = v_counts
   where id = p_batch_id;

  -- Counts only: never names or emails.
  perform public.write_company_audit(v_company, 'candidates.imported', 'import_batch', p_batch_id::text,
    v_batch.file_name, null, v_counts || jsonb_build_object('job_post_id', v_job, 'talent_list_id', v_list));

  return jsonb_build_object('ok', true, 'batch_id', p_batch_id, 'counts', v_counts, 'delete_paths', v_delete,
    'candidate_ids', to_jsonb(v_ids));
end $$;

create or replace function public.confirm_spreadsheet_import(p_batch_id uuid, p_rows jsonb, p_options jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_batch public.candidate_import_batches%rowtype;
  v_job uuid := public.try_uuid(p_options ->> 'job_post_id');
  v_list uuid := public.try_uuid(p_options ->> 'talent_list_id');
  v_stage uuid;
  v_stage_map jsonb := case when jsonb_typeof(p_options -> 'stage_map') = 'object' then p_options -> 'stage_map' end;
  v_action text := coalesce(p_options ->> 'duplicate_action', 'skip');
  v_known jsonb := '{}'::jsonb;
  v_row jsonb;
  v_email text;
  v_row_action text;
  v_row_stage uuid;
  v_candidate public.company_candidates%rowtype;
  v_id uuid;
  v_result text;
  v_created int := 0; v_updated int := 0; v_skipped int := 0; v_known_n int := 0;
  v_added int := 0; v_in_job int := 0; v_outreach int := 0; v_no_email int := 0; v_listed int := 0;
  v_counts jsonb;
  k text;
begin
  select * into v_batch from public.candidate_import_batches where id = p_batch_id for update;
  if v_batch.id is null or v_batch.company_id is distinct from v_company then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_batch.status = 'confirmed' then
    return jsonb_build_object('ok', false, 'reason', 'already_confirmed');
  end if;
  if v_batch.kind <> 'spreadsheet' or v_batch.status <> 'draft' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- BI-PERM-001: for the job, or unscoped without one; lists also need talent_lists.manage.
  if not public.has_company_permission(v_company, 'applicants.import', v_job) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_job is not null and not exists (
    select 1 from public.job_postings jp where jp.id = v_job and jp.company_id = v_company
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_list is not null and (
    not public.has_company_permission(v_company, 'talent_lists.manage')
    or not exists (select 1 from public.talent_lists l where l.id = v_list and l.company_id = v_company)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if coalesce((p_options ->> 'attested')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'reason', 'not_attested');
  end if;
  if v_action not in ('skip', 'fill', 'overwrite') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_rows');
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;

  if v_job is not null then
    v_stage := public.import_job_stage(v_job, public.try_uuid(p_options ->> 'stage_id'));
    if v_stage is null then
      return jsonb_build_object('ok', false, 'reason', 'invalid_stage');
    end if;
    -- BI-REQ-015a: every mapped value is one of the job pipeline's active stages.
    if v_stage_map is not null then
      for k in select jsonb_object_keys(v_stage_map) loop
        if public.import_job_stage(v_job, public.try_uuid(v_stage_map ->> k)) is null
           or v_stage_map ->> k is null then
          return jsonb_build_object('ok', false, 'reason', 'invalid_stage');
        end if;
      end loop;
    end if;
  end if;

  -- BI-REQ-019, repeated here: GetHired users the caller can already see.
  select coalesce(jsonb_object_agg(m.email, m.user_id), '{}'::jsonb) into v_known
    from public.match_known_applicants(array(
      select lower(btrim(r ->> 'email')) from jsonb_array_elements(p_rows) r
       where nullif(btrim(r ->> 'email'), '') is not null
    )) m;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then
      raise exception 'Each row must be an object.' using errcode = 'invalid_parameter_value';
    end if;
    v_email := lower(public.import_text(v_row, 'email'));
    v_row_action := coalesce(v_row ->> 'duplicate_action', v_action);
    if v_row_action not in ('skip', 'fill', 'overwrite') then v_row_action := v_action; end if;

    -- A known GetHired user never becomes a company candidate.
    if v_email is not null and v_known ? v_email then
      v_known_n := v_known_n + 1;
      if v_list is not null then
        insert into public.talent_list_members (list_id, candidate_user_id)
        values (v_list, (v_known ->> v_email)::uuid)
        on conflict do nothing;
        if found then v_listed := v_listed + 1; end if;
      end if;
      if v_job is not null then
        if exists (select 1 from public.applications a
                    where a.job_post_id = v_job and a.applicant_user_id = (v_known ->> v_email)::uuid) then
          v_in_job := v_in_job + 1;
        else
          v_outreach := v_outreach + 1;
        end if;
      end if;
      continue;
    end if;

    v_candidate := null;
    if v_email is not null then
      select * into v_candidate from public.company_candidates c
       where c.company_id = v_company and lower(c.email) = v_email for update;
    end if;

    if v_candidate.id is null then
      insert into public.company_candidates
        (company_id, full_name, email, phone, location, current_title, current_company, experience_years,
         links, skills, tags, notes, source_batch_id, created_by)
      values
        (v_company, public.import_text(v_row, 'full_name'), v_email, public.import_text(v_row, 'phone'),
         public.import_text(v_row, 'location'), public.import_text(v_row, 'current_title'),
         public.import_text(v_row, 'current_company'), (public.import_text(v_row, 'experience_years'))::numeric,
         public.import_links(v_row), public.import_list(v_row, 'skills'), public.import_list(v_row, 'tags'),
         public.import_text(v_row, 'notes'), p_batch_id, (select auth.uid()))
      returning id into v_id;
      v_created := v_created + 1;
    else
      v_id := v_candidate.id;
      if v_row_action = 'skip' then
        v_skipped := v_skipped + 1;
      elsif v_row_action = 'fill' then
        -- BI-REQ-014: only blank fields; tags are merged.
        update public.company_candidates c set
          phone = coalesce(c.phone, public.import_text(v_row, 'phone')),
          location = coalesce(c.location, public.import_text(v_row, 'location')),
          current_title = coalesce(c.current_title, public.import_text(v_row, 'current_title')),
          current_company = coalesce(c.current_company, public.import_text(v_row, 'current_company')),
          experience_years = coalesce(c.experience_years, (public.import_text(v_row, 'experience_years'))::numeric),
          links = public.import_links(v_row) || c.links,
          skills = case when cardinality(c.skills) = 0 then public.import_list(v_row, 'skills') else c.skills end,
          tags = (select coalesce(array_agg(t order by o), '{}') from (
                    select distinct on (lower(t)) t, o
                      from unnest(c.tags || public.import_list(v_row, 'tags')) with ordinality as x(t, o)
                     order by lower(t), o
                  ) d)[1:20],
          notes = coalesce(c.notes, public.import_text(v_row, 'notes')),
          updated_at = now()
         where c.id = v_id;
        v_updated := v_updated + 1;
      else
        -- overwrite: every field the row carries replaces the stored one.
        update public.company_candidates c set
          full_name = coalesce(public.import_text(v_row, 'full_name'), c.full_name),
          phone = case when v_row ? 'phone' then public.import_text(v_row, 'phone') else c.phone end,
          location = case when v_row ? 'location' then public.import_text(v_row, 'location') else c.location end,
          current_title = case when v_row ? 'current_title' then public.import_text(v_row, 'current_title') else c.current_title end,
          current_company = case when v_row ? 'current_company' then public.import_text(v_row, 'current_company') else c.current_company end,
          experience_years = case when v_row ? 'experience_years'
                                  then (public.import_text(v_row, 'experience_years'))::numeric else c.experience_years end,
          links = c.links || public.import_links(v_row),
          skills = case when v_row ? 'skills' then public.import_list(v_row, 'skills') else c.skills end,
          tags = case when v_row ? 'tags' then public.import_list(v_row, 'tags') else c.tags end,
          notes = case when v_row ? 'notes' then public.import_text(v_row, 'notes') else c.notes end,
          updated_at = now()
         where c.id = v_id;
        v_updated := v_updated + 1;
      end if;
    end if;

    if v_list is not null then
      insert into public.talent_list_members (list_id, company_candidate_id)
      values (v_list, v_id)
      on conflict do nothing;
      if found then v_listed := v_listed + 1; end if;
    end if;

    if v_job is not null then
      v_row_stage := v_stage;
      if v_stage_map is not null and public.import_text(v_row, 'stage') is not null then
        v_row_stage := coalesce(
          public.try_uuid(v_stage_map ->> public.import_text(v_row, 'stage')),
          (select public.try_uuid(e.value) from jsonb_each_text(v_stage_map) e
            where lower(btrim(e.key)) = lower(public.import_text(v_row, 'stage')) limit 1),
          v_stage
        );
      end if;
      v_result := public.create_imported_application(v_id, v_job, v_row_stage, p_batch_id);
      case v_result
        when 'added' then v_added := v_added + 1;
        when 'already_in_job' then v_in_job := v_in_job + 1;
        when 'no_email' then v_no_email := v_no_email + 1;
      end case;
    end if;
  end loop;

  v_counts := jsonb_build_object(
    'created', v_created, 'updated', v_updated, 'skipped', v_skipped, 'known', v_known_n,
    'added_to_job', v_added, 'already_in_job', v_in_job, 'needs_outreach', v_outreach,
    'no_email', v_no_email, 'added_to_list', v_listed
  );

  update public.candidate_import_batches set
    status = 'confirmed',
    confirmed_at = now(),
    job_post_id = v_job,
    stage_id = v_stage,
    talent_list_id = v_list,
    stage_map = v_stage_map,
    duplicate_action = v_action,
    auto_invite = v_job is not null and coalesce((p_options ->> 'auto_invite')::boolean, false),
    lawful_basis_attested_by = (select auth.uid()),
    lawful_basis_attested_at = now(),
    lawful_basis_note = left(nullif(btrim(p_options ->> 'lawful_basis_note'), ''), 200),
    counts = v_counts
   where id = p_batch_id;

  -- Counts only: never names or emails.
  perform public.write_company_audit(v_company, 'candidates.imported', 'import_batch', p_batch_id::text,
    v_batch.file_name, null, v_counts || jsonb_build_object('job_post_id', v_job, 'talent_list_id', v_list));

  return jsonb_build_object('ok', true, 'batch_id', p_batch_id, 'counts', v_counts,
    'candidate_ids', (select coalesce(jsonb_agg(c.id), '[]'::jsonb)
                        from public.company_candidates c where c.source_batch_id = p_batch_id));
end $$;

-- ------------------------------------------------------- funnel

-- JP-REQ-010: the job's own pipeline.
create or replace function public.get_job_funnel(p_job_post_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_company uuid;
  v_pipeline uuid;
  v_applied uuid;
  v_result jsonb;
begin
  select jp.company_id, jp.pipeline_id into v_company, v_pipeline
    from public.job_postings jp where jp.id = p_job_post_id;
  if v_company is null or not public.has_company_permission(v_company, 'applicants.view', p_job_post_id) then
    return null;
  end if;

  -- Everyone starts in the first Applied stage of the job's pipeline.
  select s.id into v_applied from public.pipeline_stages s
   where s.pipeline_id = v_pipeline and s.kind = 'applied'
   order by s.archived, s.position
   limit 1;

  with apps as (
    select a.id, a.stage_id, a.source, a.created_at
      from public.applications a
     where a.job_post_id = p_job_post_id
       and a.merged_into_application_id is null
  ),
  entries as (
    select apps.id as application_id, v_applied as stage_id, apps.created_at as entered_at
      from apps
    union all
    select e.application_id, (e.payload->>'to_stage_id')::uuid, e.created_at
      from public.application_events e
      join apps on apps.id = e.application_id
     where e.type = 'stage_changed' and e.payload ? 'to_stage_id'
  ),
  stays as (
    select stage_id, entered_at,
           lead(entered_at) over (partition by application_id order by entered_at) as left_at
      from entries
  ),
  medians as (
    select stage_id,
           percentile_cont(0.5) within group (order by extract(epoch from left_at - entered_at) / 86400.0)
             as median_days
      from stays
     where left_at is not null
     group by stage_id
  ),
  reached as (
    select stage_id, count(distinct application_id) as n
      from (
        select application_id, stage_id from entries
        union
        select id, stage_id from apps where stage_id is not null
      ) x
     group by stage_id
  ),
  current_counts as (
    select stage_id, count(*) as n from apps group by stage_id
  ),
  hires as (
    select percentile_cont(0.5) within group (order by extract(epoch from en.entered_at - apps.created_at) / 86400.0)
             as median_days
      from entries en
      join apps on apps.id = en.application_id
      join public.pipeline_stages s on s.id = en.stage_id
     where s.kind = 'hired'
  )
  select jsonb_build_object(
    'stages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'stage_id', s.id,
               'name', s.name,
               'kind', s.kind,
               'count', coalesce(c.n, 0),
               'reached', coalesce(r.n, 0),
               'median_days', round(m.median_days::numeric, 1)
             ) order by s.position)
        from public.pipeline_stages s
        left join current_counts c on c.stage_id = s.id
        left join reached r on r.stage_id = s.id
        left join medians m on m.stage_id = s.id
       where s.pipeline_id = v_pipeline and not s.archived
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_object_agg(source, n) from (select source, count(*) as n from apps group by source) x
    ), '{}'::jsonb),
    'time_to_hire_days', (select round(median_days::numeric, 1) from hires),
    'total', (select count(*) from apps)
  ) into v_result;

  return v_result;
end $$;

-- ------------------------------------------------------- interview plans

-- The stage must be in the job's pipeline.
create or replace function public.save_interview_plan(p_job_post_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_pipeline uuid;
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
  select company_id, pipeline_id into v_company, v_pipeline from public.job_postings where id = p_job_post_id;
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
    if not found or v_stage.company_id <> v_company or v_stage.pipeline_id is distinct from v_pipeline then
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

-- JP-REQ-009: across pipelines, each item goes to the target stage with the
-- same name and kind, then the first of the same kind; the rest are skipped.
create or replace function public.copy_interview_plan(p_from_job uuid, p_to_job uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_from_company uuid;
  v_to_pipeline uuid;
  v_item record;
  v_stage uuid;
  v_new uuid;
  v_ids uuid[];
  v_dropped uuid[] := '{}';
  v_skipped jsonb := '[]'::jsonb;
  v_count int := 0;
begin
  select company_id, pipeline_id into v_company, v_to_pipeline from public.job_postings where id = p_to_job;
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
    select i.*, s.name as stage_name, s.kind as stage_kind, s.pipeline_id as stage_pipeline
      from public.job_interview_plan_items i
      join public.pipeline_stages s on s.id = i.stage_id
     where i.job_post_id = p_from_job and not s.archived and s.kind not in ('rejected', 'hired')
     order by i.position
  loop
    if v_item.stage_pipeline = v_to_pipeline then
      v_stage := v_item.stage_id;
    else
      select t.id into v_stage from public.pipeline_stages t
       where t.pipeline_id = v_to_pipeline and not t.archived and t.kind = v_item.stage_kind
       order by (lower(btrim(t.name)) = lower(btrim(v_item.stage_name))) desc, t.position
       limit 1;
    end if;
    if v_stage is null then
      v_skipped := v_skipped || jsonb_build_object('id', v_item.id, 'name', v_item.name);
      continue;
    end if;

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
    values (v_company, p_to_job, v_stage, v_count, v_item.name, v_item.duration_minutes,
            v_item.instructions, v_ids)
    returning id into v_new;

    insert into public.job_interview_competencies (plan_item_id, position, name, description, questions)
    select v_new, c.position, c.name, c.description, c.questions
      from public.job_interview_competencies c where c.plan_item_id = v_item.id;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'items', v_count, 'dropped_interviewer_ids', to_jsonb(v_dropped),
    'skipped_items', v_skipped);
end $$;

-- ------------------------------------------------------- pipeline admin RPCs

-- JP-REQ-005: a new pipeline is a copy of an existing one (default: the
-- default pipeline), so it always has the protected kinds.
create or replace function public.create_pipeline(p_name text, p_from_pipeline uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_name text := btrim(coalesce(p_name, ''));
  v_source public.company_pipelines%rowtype;
  v_id uuid;
begin
  if v_company is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.has_company_permission(v_company, 'settings.stages') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if char_length(v_name) not between 1 and 40 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  -- One create at a time per company, so the limit holds.
  perform 1 from public.company_info where id = v_company for update;
  if (select count(*) from public.company_pipelines where company_id = v_company and not archived) >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'limit_reached');
  end if;

  select * into v_source from public.company_pipelines
   where company_id = v_company and not archived
     and (case when p_from_pipeline is null then is_default else id = p_from_pipeline end);
  if v_source.id is null then
    return jsonb_build_object('ok', false, 'reason', 'pipeline_not_found');
  end if;
  if exists (select 1 from public.company_pipelines
              where company_id = v_company and not archived and lower(btrim(name)) = lower(v_name)) then
    return jsonb_build_object('ok', false, 'reason', 'name_taken');
  end if;

  insert into public.company_pipelines (company_id, name) values (v_company, v_name) returning id into v_id;
  insert into public.pipeline_stages (company_id, pipeline_id, name, kind, position)
  select v_company, v_id, s.name, s.kind, s.position
    from public.pipeline_stages s
   where s.pipeline_id = v_source.id and not s.archived;

  return jsonb_build_object('ok', true, 'pipeline_id', v_id);
end $$;
revoke all on function public.create_pipeline(text, uuid) from public, anon;
grant execute on function public.create_pipeline(text, uuid) to authenticated;

create or replace function public.rename_pipeline(p_pipeline_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_company is null or not exists (
    select 1 from public.company_pipelines where id = p_pipeline_id and company_id = v_company and not archived
  ) then
    return jsonb_build_object('ok', false, 'reason', 'pipeline_not_found');
  end if;
  if not public.has_company_permission(v_company, 'settings.stages') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if char_length(v_name) not between 1 and 40 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;
  if exists (select 1 from public.company_pipelines
              where company_id = v_company and not archived and id <> p_pipeline_id
                and lower(btrim(name)) = lower(v_name)) then
    return jsonb_build_object('ok', false, 'reason', 'name_taken');
  end if;
  update public.company_pipelines set name = v_name, updated_at = now() where id = p_pipeline_id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.rename_pipeline(uuid, text) from public, anon;
grant execute on function public.rename_pipeline(uuid, text) to authenticated;

create or replace function public.set_default_pipeline(p_pipeline_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
begin
  if v_company is null or not exists (
    select 1 from public.company_pipelines where id = p_pipeline_id and company_id = v_company and not archived
  ) then
    return jsonb_build_object('ok', false, 'reason', 'pipeline_not_found');
  end if;
  if not public.has_company_permission(v_company, 'settings.stages') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  -- The old default stops being default first, for the unique index.
  update public.company_pipelines set is_default = false, updated_at = now()
   where company_id = v_company and is_default and id <> p_pipeline_id;
  update public.company_pipelines set is_default = true, updated_at = now()
   where id = p_pipeline_id and not is_default;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.set_default_pipeline(uuid) from public, anon;
grant execute on function public.set_default_pipeline(uuid) to authenticated;

-- JP-REQ-008: never the default, never one a job (open or closed) uses.
create or replace function public.archive_pipeline(p_pipeline_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_pipeline public.company_pipelines%rowtype;
  v_jobs int;
begin
  select * into v_pipeline from public.company_pipelines where id = p_pipeline_id for update;
  if v_company is null or v_pipeline.id is null or v_pipeline.company_id <> v_company then
    return jsonb_build_object('ok', false, 'reason', 'pipeline_not_found');
  end if;
  if not public.has_company_permission(v_company, 'settings.stages') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_pipeline.archived then
    return jsonb_build_object('ok', true);
  end if;
  if v_pipeline.is_default then
    return jsonb_build_object('ok', false, 'reason', 'is_default');
  end if;
  select count(*) into v_jobs from public.job_postings where pipeline_id = p_pipeline_id;
  if v_jobs > 0 then
    return jsonb_build_object('ok', false, 'reason', 'in_use', 'jobs', v_jobs);
  end if;
  update public.company_pipelines set archived = true, updated_at = now() where id = p_pipeline_id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.archive_pipeline(uuid) from public, anon;
grant execute on function public.archive_pipeline(uuid) to authenticated;

-- The same rules for direct writes (service role, future code).
create or replace function public.guard_company_pipeline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.company_id is distinct from old.company_id then
    raise exception 'A pipeline can''t move to another company.' using errcode = 'check_violation';
  end if;
  if new.archived and not old.archived
     and exists (select 1 from public.job_postings where pipeline_id = new.id) then
    raise exception 'A pipeline that jobs use can''t be archived.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.guard_company_pipeline() from public, anon, authenticated;

drop trigger if exists company_pipelines_guard on public.company_pipelines;
create trigger company_pipelines_guard
  before update on public.company_pipelines
  for each row execute function public.guard_company_pipeline();

-- ------------------------------------------------------- set_job_pipeline

-- JP-REQ-006 / JP-REQ-009, without the permission check (the public RPCs check).
-- `p_mapping` is { "<old stage id>": "<new stage id>" }; a missing key takes the
-- first active stage of the same kind, then of the same candidate status.
create or replace function public.apply_job_pipeline(p_job_post_id uuid, p_pipeline_id uuid, p_mapping jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.job_postings%rowtype;
  v_pipeline public.company_pipelines%rowtype;
  v_mapping jsonb := coalesce(p_mapping, '{}'::jsonb);
  v_old public.pipeline_stages%rowtype;
  v_target public.pipeline_stages%rowtype;
  v_target_id uuid;
  v_map jsonb := '{}'::jsonb;
  v_actor uuid := (select auth.uid());
  v_moved int;
  v_items int;
begin
  select * into v_job from public.job_postings where id = p_job_post_id for update;
  select * into v_pipeline from public.company_pipelines where id = p_pipeline_id;
  if v_pipeline.id is null or v_pipeline.company_id is distinct from v_job.company_id or v_pipeline.archived then
    return jsonb_build_object('ok', false, 'reason', 'pipeline_not_found');
  end if;
  if jsonb_typeof(v_mapping) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_mapping');
  end if;
  if v_job.pipeline_id = p_pipeline_id then
    return jsonb_build_object('ok', true, 'changed', false, 'moved', 0, 'plan_items', 0, 'mapping', '{}'::jsonb);
  end if;

  -- No move or plan save can interleave.
  perform 1 from public.applications where job_post_id = p_job_post_id for update;
  perform 1 from public.job_interview_plan_items where job_post_id = p_job_post_id for update;

  for v_old in
    select s.* from public.pipeline_stages s
     where s.id in (
       select a.stage_id from public.applications a where a.job_post_id = p_job_post_id and a.stage_id is not null
       union
       select i.stage_id from public.job_interview_plan_items i where i.job_post_id = p_job_post_id
     )
     order by s.position
  loop
    v_target := null;
    if v_mapping ? v_old.id::text then
      v_target_id := public.try_uuid(v_mapping ->> v_old.id::text);
      select * into v_target from public.pipeline_stages
       where id = v_target_id and pipeline_id = p_pipeline_id and not archived;
      if v_target.id is null then
        return jsonb_build_object('ok', false, 'reason', 'invalid_mapping',
          'stage', jsonb_build_object('id', v_old.id, 'name', v_old.name, 'kind', v_old.kind));
      end if;
      if public.application_status_for_kind(v_target.kind) <> public.application_status_for_kind(v_old.kind) then
        return jsonb_build_object('ok', false, 'reason', 'status_mismatch',
          'stage', jsonb_build_object('id', v_old.id, 'name', v_old.name, 'kind', v_old.kind));
      end if;
    else
      select * into v_target from public.pipeline_stages t
       where t.pipeline_id = p_pipeline_id and not t.archived
         and public.application_status_for_kind(t.kind) = public.application_status_for_kind(v_old.kind)
       order by (t.kind = v_old.kind) desc, t.position
       limit 1;
      if v_target.id is null then
        return jsonb_build_object('ok', false, 'reason', 'missing_status',
          'status', public.application_status_for_kind(v_old.kind),
          'stage', jsonb_build_object('id', v_old.id, 'name', v_old.name, 'kind', v_old.kind));
      end if;
    end if;
    v_map := v_map || jsonb_build_object(v_old.id::text, v_target.id);
  end loop;

  -- One event per moved application, written before the move so it can read
  -- the old stage. Merged applications move too, without an event.
  insert into public.application_events
    (company_id, application_id, candidate_user_id, actor_user_id, actor_name, type, payload)
  select v_job.company_id, a.id, a.applicant_user_id, v_actor, public.member_display_name(v_actor), 'stage_changed',
         jsonb_build_object(
           'from_stage_id', a.stage_id, 'to_stage_id', (v_map ->> a.stage_id::text)::uuid,
           'from_kind', o.kind, 'to_kind', n.kind, 'reason', 'pipeline_changed',
           'from_pipeline_id', v_job.pipeline_id, 'to_pipeline_id', p_pipeline_id)
    from public.applications a
    join public.pipeline_stages o on o.id = a.stage_id
    join public.pipeline_stages n on n.id = (v_map ->> a.stage_id::text)::uuid
   where a.job_post_id = p_job_post_id and a.merged_into_application_id is null;

  perform set_config('gethired.pipeline_switch', '1', true);
  update public.job_postings set pipeline_id = p_pipeline_id, updated_at = now() where id = p_job_post_id;
  update public.applications a
     set stage_id = (v_map ->> a.stage_id::text)::uuid
   where a.job_post_id = p_job_post_id and a.stage_id is not null;
  get diagnostics v_moved = row_count;
  update public.job_interview_plan_items i
     set stage_id = (v_map ->> i.stage_id::text)::uuid, updated_at = now()
   where i.job_post_id = p_job_post_id;
  get diagnostics v_items = row_count;
  perform set_config('gethired.pipeline_switch', '', true);

  return jsonb_build_object('ok', true, 'changed', true, 'moved', v_moved, 'plan_items', v_items,
    'mapping', v_map);
end $$;
revoke all on function public.apply_job_pipeline(uuid, uuid, jsonb) from public, anon, authenticated;

-- JP-SEC-004: jobs.edit on the job (job-scoped grants work). Closed jobs too.
create or replace function public.set_job_pipeline(p_job_post_id uuid, p_pipeline_id uuid, p_mapping jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.job_postings where id = p_job_post_id;
  if v_company is null or not public.is_company_member(v_company) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.has_company_permission(v_company, 'jobs.edit', p_job_post_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  return public.apply_job_pipeline(p_job_post_id, p_pipeline_id, p_mapping);
end $$;
revoke all on function public.set_job_pipeline(uuid, uuid, jsonb) from public, anon;
grant execute on function public.set_job_pipeline(uuid, uuid, jsonb) to authenticated;

-- JP-REQ-007: copy the job's pipeline as "<job title>" and switch the job to
-- it stage for stage.
create or replace function public.fork_job_pipeline(p_job_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.job_postings%rowtype;
  v_base text;
  v_name text;
  v_n int := 1;
  v_created jsonb;
  v_new uuid;
  v_mapping jsonb;
  v_result jsonb;
begin
  select * into v_job from public.job_postings where id = p_job_post_id;
  if v_job.company_id is null or not public.is_company_member(v_job.company_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.has_company_permission(v_job.company_id, 'settings.stages') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_job.pipeline_id is null then
    return jsonb_build_object('ok', false, 'reason', 'pipeline_not_found');
  end if;

  v_base := btrim(left(coalesce(nullif(btrim(v_job.title), ''), 'Job'), 40));
  v_name := v_base;
  while exists (select 1 from public.company_pipelines
                 where company_id = v_job.company_id and not archived and lower(btrim(name)) = lower(btrim(v_name))) loop
    v_n := v_n + 1;
    v_name := btrim(left(v_base, 40 - char_length(format(' (%s)', v_n)))) || format(' (%s)', v_n);
  end loop;

  v_created := public.create_pipeline(v_name, v_job.pipeline_id);
  if not coalesce((v_created ->> 'ok')::boolean, false) then
    return v_created;
  end if;
  v_new := (v_created ->> 'pipeline_id')::uuid;

  select coalesce(jsonb_object_agg(o.id::text, n.id), '{}'::jsonb) into v_mapping
    from public.pipeline_stages o
    join public.pipeline_stages n on n.pipeline_id = v_new and n.position = o.position
   where o.pipeline_id = v_job.pipeline_id and not o.archived;

  v_result := public.apply_job_pipeline(p_job_post_id, v_new, v_mapping);
  if not coalesce((v_result ->> 'ok')::boolean, false) then
    raise exception 'fork_job_pipeline: %', v_result;
  end if;
  return v_result || jsonb_build_object('pipeline_id', v_new, 'name', v_name);
end $$;
revoke all on function public.fork_job_pipeline(uuid) from public, anon;
grant execute on function public.fork_job_pipeline(uuid) to authenticated;
