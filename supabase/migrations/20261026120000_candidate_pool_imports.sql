-- Candidate pool, phase 1: consistent imports (plan/candidate-pool/feature-candidate-pool-spec.md,
-- tasks CPT-010 and CPT-011 in plan/candidate-pool/feature-candidate-pool-tasks.md).
--
-- Tests: supabase/tests/candidate_pool.sql (block 1).
--
--  1. candidate_import_batches.opened_from: where a resume import was started,
--     so each place resumes its own open batch (CP-REQ-011)
--  2. start_resume_import: p_job_id may be null, a pool batch (CP-REQ-002/004)
--  3. submit_resume_batch: p_options carries the destination (CP-REQ-001/003/011)
--  4. confirm_resume_import: no job (email optional, no applications) and a
--     talent list (CP-REQ-002/003/005)
--
-- The signatures don't change: the destination travels in p_options, like
-- the stage and the auto-invite switch already do (tasks, difference 3).
-- confirm_candidate_import (the form's and the spreadsheet's one-row or
-- many-row batch) already takes talent_list_id.

-- ---------------------------------------------------------------------------
-- 1. Where a resume import was opened (CP-REQ-011)
-- ---------------------------------------------------------------------------

-- 'job': a job's Import candidates section, which keeps the batch's job.
-- 'candidates': the Candidates page, which may pick or change the job until
-- the batch is confirmed.
alter table public.candidate_import_batches
  add column if not exists opened_from text not null default 'job'
    check (opened_from in ('job', 'candidates'));

update public.candidate_import_batches set opened_from = 'candidates'
 where job_post_id is null and opened_from = 'job';

-- ---------------------------------------------------------------------------
-- 2. start_resume_import (CP-REQ-002/004)
-- ---------------------------------------------------------------------------

-- A draft resumes batch and one queued row per file, at
-- <company>/<batch>/<row id>.<pdf|docx>. With p_job_id: applicants.import for
-- that job (BI-REQ-020). Without: the pool, which needs applicants.import
-- unscoped. p_files: [{ "name": "ada.pdf" }, ...], at most 100. Counts
-- toward the 5-an-hour, 20-a-day file import limits.
create or replace function public.start_resume_import(p_job_id uuid, p_files jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_batch uuid;
  v_n int;
  v_rows jsonb;
begin
  if v_company is null or (p_job_id is not null and not exists (
    select 1 from public.job_postings jp where jp.id = p_job_id and jp.company_id = v_company
  )) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.has_company_permission(v_company, 'applicants.import', p_job_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_rows');
  end if;
  v_n := jsonb_array_length(p_files);
  if v_n > 100 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_files) f
     where jsonb_typeof(f) <> 'object'
        or nullif(btrim(f ->> 'name'), '') is null
        or char_length(btrim(f ->> 'name')) > 255
        or lower(btrim(f ->> 'name')) !~ '\.(pdf|docx)$'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  if (select count(*) from public.candidate_import_batches b
       where b.company_id = v_company and b.file_name is not null and b.created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'import_limit_hour');
  end if;
  if (select count(*) from public.candidate_import_batches b
       where b.company_id = v_company and b.file_name is not null and b.created_at > now() - interval '1 day') >= 20 then
    return jsonb_build_object('ok', false, 'reason', 'import_limit_day');
  end if;

  insert into public.candidate_import_batches (company_id, kind, job_post_id, opened_from, file_name, created_by)
  values (v_company, 'resumes', p_job_id, case when p_job_id is null then 'candidates' else 'job' end,
          case when v_n = 1 then btrim(p_files -> 0 ->> 'name') else v_n || ' resumes' end,
          (select auth.uid()))
  returning id into v_batch;

  with files as (
    select gen_random_uuid() as id, btrim(f ->> 'name') as name,
           lower(substring(btrim(f ->> 'name') from '\.([A-Za-z]+)$')) as ext, o
      from jsonb_array_elements(p_files) with ordinality as x(f, o)
  ),
  inserted as (
    insert into public.candidate_import_rows (id, batch_id, company_id, file_path, file_name)
    select id, v_batch, v_company, v_company || '/' || v_batch || '/' || id || '.' || ext, name from files
    returning id, file_path, file_name
  )
  select jsonb_agg(jsonb_build_object('id', i.id, 'file_name', i.file_name, 'file_path', i.file_path) order by f.o)
    into v_rows
    from inserted i join files f on f.id = i.id;

  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'rows', v_rows);
end $$;

revoke all on function public.start_resume_import(uuid, jsonb) from public, anon;
grant execute on function public.start_resume_import(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. A resume batch's destination (CP-REQ-001/003/004/011)
-- ---------------------------------------------------------------------------

-- The job and list a resume batch goes to, after the checks: p_options'
-- job_post_id and talent_list_id when present (null clears them), else the
-- batch's. A batch opened from a job keeps that job. A job needs
-- applicants.import for it, no job needs it unscoped, a list needs
-- talent_lists.manage. Returns the reason when refused.
create or replace function public.resume_batch_destination(
  p_batch public.candidate_import_batches, p_options jsonb
)
returns table (job_id uuid, list_id uuid, reason text)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job uuid := p_batch.job_post_id;
  v_list uuid := p_batch.talent_list_id;
begin
  if p_options ? 'job_post_id' then
    v_job := public.try_uuid(p_options ->> 'job_post_id');
    if nullif(p_options ->> 'job_post_id', '') is not null and v_job is null then
      return query select null::uuid, null::uuid, 'invalid'::text;
      return;
    end if;
  end if;
  if p_options ? 'talent_list_id' then
    v_list := public.try_uuid(p_options ->> 'talent_list_id');
    if nullif(p_options ->> 'talent_list_id', '') is not null and v_list is null then
      return query select null::uuid, null::uuid, 'invalid'::text;
      return;
    end if;
  end if;

  if p_batch.opened_from = 'job' and v_job is distinct from p_batch.job_post_id then
    return query select null::uuid, null::uuid, 'invalid'::text;
    return;
  end if;
  if v_job is not null and not exists (
    select 1 from public.job_postings jp where jp.id = v_job and jp.company_id = p_batch.company_id
  ) then
    return query select null::uuid, null::uuid, 'not_found'::text;
    return;
  end if;
  if not public.has_company_permission(p_batch.company_id, 'applicants.import', v_job) then
    return query select null::uuid, null::uuid, 'forbidden'::text;
    return;
  end if;
  if v_list is not null and (
    not public.has_company_permission(p_batch.company_id, 'talent_lists.manage')
    or not exists (select 1 from public.talent_lists l where l.id = v_list and l.company_id = p_batch.company_id)
  ) then
    return query select null::uuid, null::uuid, 'forbidden'::text;
    return;
  end if;
  return query select v_job, v_list, null::text;
end $$;

revoke all on function public.resume_batch_destination(public.candidate_import_batches, jsonb)
  from public, anon, authenticated;

-- Queues the files the action found in Storage (p_row_ids) after it held one
-- resume_imports unit for each. Rows not in p_row_ids weren't uploaded: they
-- fail as `unreadable`. At most 2 batches parsing per company.
-- p_options: job_post_id, talent_list_id (the destination, CP-REQ-001),
-- stage_id and auto_invite (BI-REQ-015b), both only with a job.
create or replace function public.submit_resume_batch(p_batch_id uuid, p_row_ids uuid[], p_options jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer
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
    v_stage := public.import_stage(v_batch.company_id, public.try_uuid(v_options ->> 'stage_id'));
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

revoke all on function public.submit_resume_batch(uuid, uuid[], jsonb) from public, anon;
grant execute on function public.submit_resume_batch(uuid, uuid[], jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Confirming a resume batch (CP-REQ-002/003/005, BI-REQ-019/024/025)
-- ---------------------------------------------------------------------------

-- Confirms a resume batch's parsed rows. p_rows: optional per-row duplicate
-- actions, [{ "row_id", "duplicate_action" }]. p_options: job_post_id and
-- talent_list_id (the destination; the batch's when absent), stage_id,
-- duplicate_action, auto_invite, attested, lawful_basis_note.
--   With a job: every parsed row needs an email, or nothing is confirmed
--   (`missing_email` with the row ids); each person gets an application.
--   Without one: the pool only. A row without an email is created as a new
--   candidate (nothing to check it against); no application, no screening.
--   With a list: everyone created, updated or matched joins it once.
-- Returns `delete_paths`: the files no candidate kept (known users, skipped
-- duplicates, replaced resumes), for the action to delete from Storage.
create or replace function public.confirm_resume_import(p_batch_id uuid, p_rows jsonb, p_options jsonb)
returns jsonb
language plpgsql security definer
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
    v_stage := public.import_stage(v_company,
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

revoke all on function public.confirm_resume_import(uuid, jsonb, jsonb) from public, anon, authenticated;
