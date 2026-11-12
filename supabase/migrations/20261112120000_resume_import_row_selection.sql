-- Resume import: confirm only the rows the member ticked.
--
-- The review grid now has a box per read row instead of a delete button.
-- `confirm_candidate_import` takes an optional `p_options.row_ids` for a
-- resume batch: the parsed rows to import. The batch's other parsed rows are
-- marked removed in the same transaction, before `confirm_resume_import`
-- runs, and their files are added to `delete_paths` for the action to delete.
-- If the confirm refuses (not_found, forbidden, missing_email, ...), the
-- removals are rolled back with it, so the member can fix the import and try
-- again. Their resume imports were already charged when they were read, so
-- there is no hold to release.
--
-- Without `row_ids` every parsed row is imported, as before (the recruiter
-- agent's confirmImport). Spreadsheet batches are unchanged.

create or replace function public.confirm_candidate_import(p_batch_id uuid, p_rows jsonb, p_options jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_options jsonb := coalesce(p_options, '{}'::jsonb);
  v_batch public.candidate_import_batches%rowtype;
  v_result jsonb;
  v_keep uuid[];
  v_dropped jsonb := '[]'::jsonb;
begin
  select * into v_batch from public.candidate_import_batches b where b.id = p_batch_id;

  if v_batch.kind = 'resumes' then
    if not (v_options ? 'row_ids') then
      return public.confirm_resume_import(p_batch_id, p_rows, v_options);
    end if;
    if v_batch.company_id is distinct from public.my_company_id() then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
    if jsonb_typeof(v_options -> 'row_ids') <> 'array' then
      return jsonb_build_object('ok', false, 'reason', 'invalid');
    end if;
    select coalesce(array_agg(public.try_uuid(x)), '{}') into v_keep
      from jsonb_array_elements_text(v_options -> 'row_ids') x;
    if cardinality(v_keep) = 0 or array_position(v_keep, null) is not null then
      return jsonb_build_object('ok', false, 'reason', 'invalid');
    end if;

    begin
      with dropped as (
        update public.candidate_import_rows r
           set status = 'removed', updated_at = now()
         where r.batch_id = p_batch_id
           and r.status = 'parsed'
           and not (r.id = any (v_keep))
        returning r.file_path
      )
      select coalesce(jsonb_agg(d.file_path) filter (where d.file_path is not null), '[]'::jsonb)
        into v_dropped
        from dropped d;

      v_result := public.confirm_resume_import(p_batch_id, p_rows, v_options - 'row_ids');
      if not coalesce((v_result ->> 'ok')::boolean, false) then
        -- Undo the removals; v_result keeps the refusal.
        raise exception using errcode = 'GHR01';
      end if;
    exception when sqlstate 'GHR01' then
      return v_result;
    end;

    return v_result || jsonb_build_object(
      'delete_paths', coalesce(v_result -> 'delete_paths', '[]'::jsonb) || v_dropped
    );
  end if;

  v_result := public.confirm_spreadsheet_import(p_batch_id, p_rows, v_options);
  -- The people are company candidates now; a staged sheet isn't kept (BI-SEC-007).
  if coalesce((v_result ->> 'ok')::boolean, false) then
    delete from public.candidate_import_rows r where r.batch_id = p_batch_id;
  end if;
  return v_result;
end $$;

revoke all on function public.confirm_candidate_import(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.confirm_candidate_import(uuid, jsonb, jsonb) to authenticated;

-- Discarding a resume import the member doesn't want, so the page can start a
-- new one: every row still in it is removed and the batch expires. The action
-- releases the rows' holds (a row removed before it was read costs nothing)
-- and deletes their files. The worker skips rows removed under it.
create or replace function public.discard_resume_import(p_batch_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_batch public.candidate_import_batches%rowtype;
  v_rows jsonb;
begin
  select * into v_batch from public.candidate_import_batches b
   where b.id = p_batch_id and b.company_id = public.my_company_id() for update;
  if v_batch.id is null or v_batch.kind <> 'resumes' then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.has_company_permission(v_batch.company_id, 'applicants.import', v_batch.job_post_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_batch.status in ('confirmed', 'expired') then
    return jsonb_build_object('ok', false, 'reason', 'already_confirmed');
  end if;

  with removed as (
    update public.candidate_import_rows r
       set status = 'removed', updated_at = now()
     where r.batch_id = p_batch_id
       and r.status in ('queued', 'parsing', 'parsed', 'failed')
    returning r.id, r.file_path
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'file_path', d.file_path)), '[]'::jsonb)
    into v_rows
    from removed d;

  update public.candidate_import_batches set status = 'expired' where id = p_batch_id;
  return jsonb_build_object('ok', true, 'rows', v_rows);
end $$;

revoke all on function public.discard_resume_import(uuid) from public, anon;
grant execute on function public.discard_resume_import(uuid) to authenticated;
