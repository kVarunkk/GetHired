-- Spreadsheet rows staged on the server, for the recruiter agent (BI-REQ-060).
--
-- The import page keeps a spreadsheet's rows in the browser until Confirm
-- (BI-DEC-004). The agent can't read the browser, so its spreadsheet widget
-- stages the mapped rows on a draft batch instead, in candidate_import_rows
-- like a resume batch's: the agent reads them, the member's fixes go through
-- update_import_row / remove_import_row, and Confirm sends the validated rows
-- to confirm_candidate_import as before. A staged row has no file. The
-- expiry cron deletes rows of batches past their 7 days, so a staged sheet
-- that's never confirmed is gone with them (BI-REQ-026), and confirming
-- deletes them at once: the people are company candidates by then.
--
--  1. candidate_import_rows: file_path nullable, row_number.
--  2. stage_spreadsheet_import(p_batch_id, p_job_id, p_rows).
--  3. confirm_candidate_import deletes a spreadsheet batch's staged rows once confirmed.

-- ---------------------------------------------------------------------------
-- 1. Rows without a file
-- ---------------------------------------------------------------------------

alter table public.candidate_import_rows alter column file_path drop not null;
alter table public.candidate_import_rows add column if not exists row_number int
  check (row_number is null or row_number between 1 and 5000);

-- ---------------------------------------------------------------------------
-- 2. Staging a sheet's rows
-- ---------------------------------------------------------------------------

-- Stores a draft spreadsheet batch's mapped rows (at most 5,000, the file
-- limit), each as `extracted.fields` with status `parsed`, so the review
-- functions treat them like read resumes. Only the member who started the
-- batch stages it, once. The job, when there is one, is kept on the batch so
-- a member with applicants.import for that job only can fix its rows
-- (import_row_for_update checks the batch's job); without one it needs
-- applicants.import unscoped. Rows are validated by the action and again on
-- confirm; here only their keys are checked.
create or replace function public.stage_spreadsheet_import(p_batch_id uuid, p_job_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_batch public.candidate_import_batches%rowtype;
  v_n int;
begin
  select * into v_batch from public.candidate_import_batches b where b.id = p_batch_id for update;
  if v_batch.id is null or v_batch.company_id is distinct from v_company
     or v_batch.created_by is distinct from (select auth.uid()) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_batch.kind <> 'spreadsheet' or v_batch.status <> 'draft' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if exists (select 1 from public.candidate_import_rows r where r.batch_id = p_batch_id) then
    return jsonb_build_object('ok', false, 'reason', 'already_submitted');
  end if;
  if not public.has_company_permission(v_company, 'applicants.import', p_job_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_job_id is not null and not exists (
    select 1 from public.job_postings jp where jp.id = p_job_id and jp.company_id = v_company
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_rows');
  end if;
  v_n := jsonb_array_length(p_rows);
  if v_n > 5000 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) r
     where jsonb_typeof(r) <> 'object'
        or exists (
          select 1 from jsonb_object_keys(r) k
           where k not in ('full_name', 'email', 'phone', 'location', 'current_title', 'current_company',
                           'experience_years', 'linkedin_url', 'github_url', 'portfolio_url', 'resume_url',
                           'skills', 'tags', 'notes', 'stage')
        )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  insert into public.candidate_import_rows (batch_id, company_id, file_path, file_name, row_number, status, extracted)
  select p_batch_id, v_company, null, 'Row ' || r.n, r.n, 'parsed', jsonb_build_object('fields', r.value)
    from jsonb_array_elements(p_rows) with ordinality as r(value, n);

  update public.candidate_import_batches set job_post_id = p_job_id where id = p_batch_id;
  return jsonb_build_object('ok', true, 'batch_id', p_batch_id, 'rows', v_n);
end $$;

revoke all on function public.stage_spreadsheet_import(uuid, uuid, jsonb) from public, anon;
grant execute on function public.stage_spreadsheet_import(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Confirming clears the staged rows
-- ---------------------------------------------------------------------------

create or replace function public.confirm_candidate_import(p_batch_id uuid, p_rows jsonb, p_options jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if (select b.kind from public.candidate_import_batches b where b.id = p_batch_id) = 'resumes' then
    return public.confirm_resume_import(p_batch_id, p_rows, coalesce(p_options, '{}'::jsonb));
  end if;
  v_result := public.confirm_spreadsheet_import(p_batch_id, p_rows, coalesce(p_options, '{}'::jsonb));
  -- The people are company candidates now; a staged sheet isn't kept (BI-SEC-007).
  if coalesce((v_result ->> 'ok')::boolean, false) then
    delete from public.candidate_import_rows r where r.batch_id = p_batch_id;
  end if;
  return v_result;
end $$;

revoke all on function public.confirm_candidate_import(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.confirm_candidate_import(uuid, jsonb, jsonb) to authenticated;
