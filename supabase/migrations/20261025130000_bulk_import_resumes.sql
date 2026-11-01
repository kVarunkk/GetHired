-- Bulk candidate import, phase 3: resumes (plan/bulk-import/feature-bulk-import-spec.md,
-- tasks BIT-040, BIT-043 to BIT-047 and BIT-049 in
-- plan/bulk-import/feature-bulk-import-tasks.md).
--
-- Tests: supabase/tests/bulk_import.sql (blocks 3 and 4).
--
--  1. Private bucket company-candidate-files (BI-SEC-003)
--  2. Queue candidate_import_queue, service role only (BI-REQ-022)
--  3. start_resume_import: the draft batch and one row per file (BI-REQ-020)
--  4. submit_resume_batch: queues the uploaded files (BI-REQ-021/022)
--  5. The review grid's row changes: update, remove, retry (BI-REQ-023/024)
--  6. confirm_candidate_import confirms resume batches too (BI-REQ-025)
--  7. set_company_candidate_resume: a candidate's own resume (BI-REQ-008)
--  8. The worker's and the expiry cron's jobs, inactive until deployed. Turn
--     them on with
--       select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'candidate-import-worker'), active := true);
--       select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'candidate-imports-expire'), active := true);
--
-- Holds: one resume_imports hold per file, ref ('candidate_import_row', row
-- id), so the worker can consume or release each file on its own (a hold is
-- converted or released whole, per ref).

-- ---------------------------------------------------------------------------
-- 1. Bucket (BI-SEC-003)
-- ---------------------------------------------------------------------------

-- No storage.objects policy names this bucket: browsers upload only through
-- signed upload URLs and read only through short-lived signed URLs, both
-- created by the service role after the action's permission check.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-candidate-files', 'company-candidate-files', false, 10485760, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Queue: one message per file, { "row_id": "<uuid>" }
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pgmq.list_queues() where queue_name = 'candidate_import_queue') then
    perform pgmq.create('candidate_import_queue');
  end if;
end $$;

revoke all on pgmq.q_candidate_import_queue, pgmq.a_candidate_import_queue from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. start_resume_import (BI-REQ-020, BI-SEC-008)
-- ---------------------------------------------------------------------------

-- A draft resumes batch for a job and one queued row per file, at
-- <company>/<batch>/<row id>.<pdf|docx>. The action then issues one signed
-- upload URL per path. p_files: [{ "name": "ada.pdf" }, ...], at most 100.
-- Counts toward the 5-an-hour, 20-a-day file import limits.
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
  if v_company is null or not exists (
    select 1 from public.job_postings jp where jp.id = p_job_id and jp.company_id = v_company
  ) then
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

  insert into public.candidate_import_batches (company_id, kind, job_post_id, file_name, created_by)
  values (v_company, 'resumes', p_job_id,
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
-- 4. submit_resume_batch (BI-REQ-021/022, BI-SEC-008)
-- ---------------------------------------------------------------------------

-- The batch's resume rows, locked, after the caller's checks: the batch is
-- the caller's company's and they have applicants.import for its job.
create or replace function public.resume_batch_for_update(p_batch_id uuid)
returns public.candidate_import_batches
language plpgsql security definer
set search_path = ''
as $$
declare
  v_batch public.candidate_import_batches%rowtype;
begin
  select * into v_batch from public.candidate_import_batches b
   where b.id = p_batch_id and b.kind = 'resumes' and b.company_id = public.my_company_id()
   for update;
  return v_batch;
end $$;

revoke all on function public.resume_batch_for_update(uuid) from public, anon, authenticated;

-- Queues the files the action found in Storage (p_row_ids) after it held one
-- resume_imports unit for each. Rows not in p_row_ids weren't uploaded: they
-- fail as `unreadable`. At most 2 batches parsing per company.
-- p_options: auto_invite (BI-REQ-015b), stage_id.
create or replace function public.submit_resume_batch(p_batch_id uuid, p_row_ids uuid[], p_options jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_batch public.candidate_import_batches%rowtype := public.resume_batch_for_update(p_batch_id);
  v_stage uuid;
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
  if (select count(*) from public.candidate_import_batches b
       where b.company_id = v_batch.company_id and b.kind = 'resumes' and b.status = 'parsing') >= 2 then
    return jsonb_build_object('ok', false, 'reason', 'parsing_limit');
  end if;
  if coalesce(cardinality(p_row_ids), 0) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_rows');
  end if;
  if p_options ? 'stage_id' and nullif(p_options ->> 'stage_id', '') is not null then
    v_stage := public.import_stage(v_batch.company_id, public.try_uuid(p_options ->> 'stage_id'));
    if v_stage is null then
      return jsonb_build_object('ok', false, 'reason', 'invalid_stage');
    end if;
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
    stage_id = v_stage,
    auto_invite = coalesce((p_options ->> 'auto_invite')::boolean, false)
   where id = p_batch_id;

  return jsonb_build_object('ok', true, 'queued', v_queued);
end $$;

revoke all on function public.submit_resume_batch(uuid, uuid[], jsonb) from public, anon;
grant execute on function public.submit_resume_batch(uuid, uuid[], jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The review grid's row changes (BI-REQ-023/024)
-- ---------------------------------------------------------------------------

-- The row, locked, with its batch, when the caller has applicants.import for
-- the batch's job and the batch can still change.
create or replace function public.import_row_for_update(p_row_id uuid)
returns table (row_id uuid, batch_id uuid, status text, file_path text, reason text)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.candidate_import_rows%rowtype;
  v_batch public.candidate_import_batches%rowtype;
begin
  select * into v_row from public.candidate_import_rows r
   where r.id = p_row_id and r.company_id = public.my_company_id() for update;
  if v_row.id is null then
    return query select null::uuid, null::uuid, null::text, null::text, 'not_found'::text;
    return;
  end if;
  select * into v_batch from public.candidate_import_batches b where b.id = v_row.batch_id;
  if not public.has_company_permission(v_batch.company_id, 'applicants.import', v_batch.job_post_id) then
    return query select null::uuid, null::uuid, null::text, null::text, 'forbidden'::text;
    return;
  end if;
  if v_batch.status in ('confirmed', 'expired') then
    return query select null::uuid, null::uuid, null::text, null::text, 'already_confirmed'::text;
    return;
  end if;
  return query select v_row.id, v_row.batch_id, v_row.status, v_row.file_path, null::text;
end $$;

revoke all on function public.import_row_for_update(uuid) from public, anon, authenticated;

-- The member's grid edits (validated by the action with the candidate
-- schema) and the row's duplicate action. p_edited replaces earlier edits.
create or replace function public.update_import_row(p_row_id uuid, p_edited jsonb, p_duplicate_action text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v record;
begin
  select * into v from public.import_row_for_update(p_row_id);
  if v.reason is not null then
    return jsonb_build_object('ok', false, 'reason', v.reason);
  end if;
  if v.status <> 'parsed' then
    return jsonb_build_object('ok', false, 'reason', 'not_parsed');
  end if;
  if p_edited is not null and (jsonb_typeof(p_edited) <> 'object' or exists (
    select 1 from jsonb_object_keys(p_edited) k
     where k not in ('full_name', 'email', 'phone', 'location', 'current_title', 'current_company',
                     'experience_years', 'linkedin_url', 'github_url', 'portfolio_url', 'resume_url',
                     'skills', 'tags', 'notes')
  )) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if p_duplicate_action is not null and p_duplicate_action not in ('skip', 'fill', 'overwrite') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  update public.candidate_import_rows set
    edited = coalesce(p_edited, edited),
    duplicate_action = coalesce(p_duplicate_action, duplicate_action),
    updated_at = now()
   where id = p_row_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.update_import_row(uuid, jsonb, text) from public, anon;
grant execute on function public.update_import_row(uuid, jsonb, text) to authenticated;

-- Removes a row from the batch. Returns the file path for the action to
-- delete; the action also releases the row's hold, if one is left.
create or replace function public.remove_import_row(p_row_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v record;
begin
  select * into v from public.import_row_for_update(p_row_id);
  if v.reason is not null then
    return jsonb_build_object('ok', false, 'reason', v.reason);
  end if;
  update public.candidate_import_rows set status = 'removed', updated_at = now() where id = p_row_id;
  perform public.resume_batch_settle(v.batch_id);
  return jsonb_build_object('ok', true, 'file_path', v.file_path);
end $$;

-- A failed row back in the queue. The action has taken a new hold first.
create or replace function public.retry_import_row(p_row_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v record;
begin
  select * into v from public.import_row_for_update(p_row_id);
  if v.reason is not null then
    return jsonb_build_object('ok', false, 'reason', v.reason);
  end if;
  if v.status <> 'failed' then
    return jsonb_build_object('ok', false, 'reason', 'not_failed');
  end if;
  update public.candidate_import_rows set status = 'queued', error_code = null, attempts = 0, updated_at = now()
   where id = p_row_id;
  update public.candidate_import_batches set status = 'parsing' where id = v.batch_id and status = 'ready';
  perform pgmq.send('candidate_import_queue', jsonb_build_object('row_id', p_row_id));
  return jsonb_build_object('ok', true);
end $$;

-- A parsing batch is ready once no row is queued or parsing. The worker
-- calls it too, through the service role.
create or replace function public.resume_batch_settle(p_batch_id uuid)
returns text
language sql security definer
set search_path = ''
as $$
  update public.candidate_import_batches b set status = 'ready'
   where b.id = p_batch_id and b.status = 'parsing'
     and not exists (select 1 from public.candidate_import_rows r
                      where r.batch_id = p_batch_id and r.status in ('queued', 'parsing'))
  returning b.status
$$;

revoke all on function public.remove_import_row(uuid), public.retry_import_row(uuid) from public, anon;
grant execute on function public.remove_import_row(uuid), public.retry_import_row(uuid) to authenticated;
revoke all on function public.resume_batch_settle(uuid) from public, anon, authenticated;
grant execute on function public.resume_batch_settle(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Confirming a resume batch (BI-REQ-019/024/025)
-- ---------------------------------------------------------------------------

-- A duplicate row's "fill" (blank fields only, tags merged) or "overwrite"
-- (every field the row carries) on an existing candidate (BI-REQ-014).
create or replace function public.import_update_candidate(p_id uuid, p_row jsonb, p_action text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_action = 'fill' then
    update public.company_candidates c set
      phone = coalesce(c.phone, public.import_text(p_row, 'phone')),
      location = coalesce(c.location, public.import_text(p_row, 'location')),
      current_title = coalesce(c.current_title, public.import_text(p_row, 'current_title')),
      current_company = coalesce(c.current_company, public.import_text(p_row, 'current_company')),
      experience_years = coalesce(c.experience_years, (public.import_text(p_row, 'experience_years'))::numeric),
      links = public.import_links(p_row) || c.links,
      skills = case when cardinality(c.skills) = 0 then public.import_list(p_row, 'skills') else c.skills end,
      tags = (select coalesce(array_agg(t order by o), '{}') from (
                select distinct on (lower(t)) t, o
                  from unnest(c.tags || public.import_list(p_row, 'tags')) with ordinality as x(t, o)
                 order by lower(t), o
              ) d)[1:20],
      notes = coalesce(c.notes, public.import_text(p_row, 'notes')),
      updated_at = now()
     where c.id = p_id;
  elsif p_action = 'overwrite' then
    update public.company_candidates c set
      full_name = coalesce(public.import_text(p_row, 'full_name'), c.full_name),
      phone = case when p_row ? 'phone' then public.import_text(p_row, 'phone') else c.phone end,
      location = case when p_row ? 'location' then public.import_text(p_row, 'location') else c.location end,
      current_title = case when p_row ? 'current_title' then public.import_text(p_row, 'current_title') else c.current_title end,
      current_company = case when p_row ? 'current_company' then public.import_text(p_row, 'current_company') else c.current_company end,
      experience_years = case when p_row ? 'experience_years'
                              then (public.import_text(p_row, 'experience_years'))::numeric else c.experience_years end,
      links = c.links || public.import_links(p_row),
      skills = case when p_row ? 'skills' then public.import_list(p_row, 'skills') else c.skills end,
      tags = case when p_row ? 'tags' then public.import_list(p_row, 'tags') else c.tags end,
      notes = case when p_row ? 'notes' then public.import_text(p_row, 'notes') else c.notes end,
      updated_at = now()
     where c.id = p_id;
  end if;
end $$;

revoke all on function public.import_update_candidate(uuid, jsonb, text) from public, anon, authenticated;

-- BI-REQ-025: confirms a resume batch's parsed rows into its job. p_rows:
-- optional per-row duplicate actions, [{ "row_id", "duplicate_action" }].
-- p_options: stage_id, duplicate_action, auto_invite, attested,
-- lawful_basis_note. Every parsed row needs an email, or nothing is
-- confirmed (`missing_email` with the row ids). Returns `delete_paths`: the
-- files no candidate kept (known users, skipped duplicates, replaced resumes),
-- for the action to delete from Storage.
create or replace function public.confirm_resume_import(p_batch_id uuid, p_rows jsonb, p_options jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_batch public.candidate_import_batches%rowtype;
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
  v_result text;
  v_delete jsonb := '[]'::jsonb;
  v_created int := 0; v_updated int := 0; v_skipped int := 0; v_known_n int := 0;
  v_added int := 0; v_in_job int := 0; v_outreach int := 0;
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
  if coalesce((p_options ->> 'attested')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'reason', 'not_attested');
  end if;
  if v_action not in ('skip', 'fill', 'overwrite') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if p_rows is not null and jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  v_stage := public.import_stage(v_company,
    coalesce(public.try_uuid(p_options ->> 'stage_id'), v_batch.stage_id));
  if v_stage is null then
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
  select jsonb_agg(id) into v_missing from pg_temp.resume_confirm_rows
   where public.import_text(fields, 'email') is null;
  if v_missing is not null then
    return jsonb_build_object('ok', false, 'reason', 'missing_email', 'row_ids', v_missing);
  end if;

  -- BI-REQ-019, from the session: GetHired users the caller can already see.
  select coalesce(jsonb_object_agg(m.email, m.user_id), '{}'::jsonb) into v_known
    from public.match_known_applicants(array(
      select lower(public.import_text(fields, 'email')) from pg_temp.resume_confirm_rows
    )) m;

  for v_row in select * from pg_temp.resume_confirm_rows order by created_at, id loop
    v_email := lower(public.import_text(v_row.fields, 'email'));
    v_row_action := coalesce(v_actions ->> v_row.id::text, v_row.duplicate_action, v_action);

    if v_known ? v_email then
      v_known_n := v_known_n + 1;
      if exists (select 1 from public.applications a
                  where a.job_post_id = v_batch.job_post_id and a.applicant_user_id = (v_known ->> v_email)::uuid) then
        v_in_job := v_in_job + 1;
      else
        v_outreach := v_outreach + 1;
      end if;
      v_delete := v_delete || to_jsonb(v_row.file_path);
      update public.candidate_import_rows set status = 'removed', updated_at = now() where id = v_row.id;
      continue;
    end if;

    select * into v_candidate from public.company_candidates c
     where c.company_id = v_company and lower(c.email) = v_email for update;

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

    -- As for spreadsheets, a skipped duplicate still joins the job (difference 6).
    v_result := public.create_imported_application(v_id, v_batch.job_post_id, v_stage, p_batch_id);
    case v_result
      when 'added' then v_added := v_added + 1;
      when 'already_in_job' then v_in_job := v_in_job + 1;
      else null;
    end case;
  end loop;

  v_counts := jsonb_build_object(
    'created', v_created, 'updated', v_updated, 'skipped', v_skipped, 'known', v_known_n,
    'added_to_job', v_added, 'already_in_job', v_in_job, 'needs_outreach', v_outreach,
    'no_email', 0, 'added_to_list', 0
  );

  update public.candidate_import_batches set
    status = 'confirmed',
    confirmed_at = now(),
    stage_id = v_stage,
    duplicate_action = v_action,
    auto_invite = coalesce((p_options ->> 'auto_invite')::boolean, v_batch.auto_invite),
    lawful_basis_attested_by = (select auth.uid()),
    lawful_basis_attested_at = now(),
    lawful_basis_note = left(nullif(btrim(p_options ->> 'lawful_basis_note'), ''), 200),
    counts = v_counts
   where id = p_batch_id;

  -- Counts only: never names or emails.
  perform public.write_company_audit(v_company, 'candidates.imported', 'import_batch', p_batch_id::text,
    v_batch.file_name, null, v_counts || jsonb_build_object('job_post_id', v_batch.job_post_id));

  return jsonb_build_object('ok', true, 'batch_id', p_batch_id, 'counts', v_counts, 'delete_paths', v_delete);
end $$;

revoke all on function public.confirm_resume_import(uuid, jsonb, jsonb) from public, anon, authenticated;

-- confirm_candidate_import keeps its signature and handles both kinds: the
-- phase 1 body becomes confirm_spreadsheet_import.
alter function public.confirm_candidate_import(uuid, jsonb, jsonb) rename to confirm_spreadsheet_import;
revoke all on function public.confirm_spreadsheet_import(uuid, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.confirm_candidate_import(p_batch_id uuid, p_rows jsonb, p_options jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select b.kind from public.candidate_import_batches b where b.id = p_batch_id) = 'resumes' then
    return public.confirm_resume_import(p_batch_id, p_rows, coalesce(p_options, '{}'::jsonb));
  end if;
  return public.confirm_spreadsheet_import(p_batch_id, p_rows, coalesce(p_options, '{}'::jsonb));
end $$;

revoke all on function public.confirm_candidate_import(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.confirm_candidate_import(uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. A candidate's own resume (BI-REQ-008)
-- ---------------------------------------------------------------------------

-- Sets the uploaded file and its parsed content, and fills only the empty
-- fields from p_fields. Needs applicants.import unscoped or for one of the
-- candidate's jobs (as update_company_candidate). The path must be in the
-- company's folder. Returns the replaced file's path, and the open
-- applications (not in a Rejected or Hired stage) to screen again.
create or replace function public.set_company_candidate_resume(
  p_candidate_id uuid, p_path text, p_content jsonb, p_fields jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_candidate public.company_candidates%rowtype;
begin
  select * into v_candidate from public.company_candidates c
   where c.id = p_candidate_id and c.company_id = v_company for update;
  if v_candidate.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not (
    public.has_company_permission(v_company, 'applicants.import')
    or exists (select 1 from public.applications a
                where a.company_candidate_id = p_candidate_id
                  and public.has_company_permission(v_company, 'applicants.import', a.job_post_id))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_path is null or split_part(p_path, '/', 1) <> v_company::text or p_path !~ '\.(pdf|docx)$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if p_content is not null and jsonb_typeof(p_content -> 'sections') is distinct from 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  perform public.import_update_candidate(p_candidate_id, coalesce(p_fields, '{}'::jsonb) - 'email' - 'full_name', 'fill');
  update public.company_candidates set resume_path = p_path, resume_content = p_content, updated_at = now()
   where id = p_candidate_id;

  return jsonb_build_object(
    'ok', true,
    'replaced_path', case when v_candidate.resume_path is distinct from p_path then v_candidate.resume_path end,
    'application_ids', (
      select coalesce(jsonb_agg(a.id), '[]'::jsonb)
        from public.applications a
        left join public.pipeline_stages s on s.id = a.stage_id
       where a.company_candidate_id = p_candidate_id
         and a.merged_into_application_id is null
         and coalesce(s.kind, 'applied') not in ('rejected', 'hired')
    )
  );
end $$;

revoke all on function public.set_company_candidate_resume(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.set_company_candidate_resume(uuid, text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Cron jobs, inactive
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

  perform pg_temp.schedule_inactive('candidate-import-worker', '* * * * *', '/api/worker/candidate-import');
  perform pg_temp.schedule_inactive('candidate-imports-expire', '30 3 * * *', '/api/updates/candidate-imports/expire');
end $$;
