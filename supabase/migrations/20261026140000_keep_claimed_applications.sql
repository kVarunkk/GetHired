-- Bulk candidate import, phase 6: deleting a claimed candidate keeps the
-- person's applications and interviews (plan/bulk-import/feature-bulk-import-tasks.md
-- BIT-100; BI-REQ-007/043).
--
-- applications.company_candidate_id and application_interviews.company_candidate_id
-- are `on delete cascade`, so deleting a claimed candidate deleted the
-- person's own application and interview. The delete now unlinks the rows
-- that have a user first; rows without one (unclaimed or merged imports)
-- still go with the candidate.
--
-- 1. applications_imported_has_candidate: a claimed import may lose its
--    candidate
-- 2. delete_company_candidates: unlinks the claimed rows, then deletes

-- ---------------------------------------------------------------------------
-- 1. applications_imported_has_candidate
-- ---------------------------------------------------------------------------

alter table public.applications drop constraint if exists applications_imported_has_candidate;
alter table public.applications add constraint applications_imported_has_candidate
  check (source <> 'imported' or company_candidate_id is not null or applicant_user_id is not null) not valid;

-- ---------------------------------------------------------------------------
-- 2. delete_company_candidates
-- ---------------------------------------------------------------------------

-- As in 20261025120000_bulk_import.sql, except that rows with a user keep
-- living without the candidate.
create or replace function public.delete_company_candidates(p_candidate_ids uuid[])
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_ids uuid[];
  v_paths jsonb;
  v_deleted int;
begin
  if v_company is null or not public.has_company_permission(v_company, 'applicants.import') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if coalesce(cardinality(p_candidate_ids), 0) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_rows');
  end if;
  if cardinality(p_candidate_ids) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;

  select coalesce(array_agg(c.id), '{}'),
         coalesce(jsonb_agg(c.resume_path) filter (where c.resume_path is not null), '[]'::jsonb)
    into v_ids, v_paths
    from public.company_candidates c
   where c.company_id = v_company and c.id = any (p_candidate_ids);

  -- BI-REQ-043: a claimed person's applications and interviews are theirs.
  update public.application_interviews set company_candidate_id = null, updated_at = now()
   where company_candidate_id = any (v_ids) and applicant_user_id is not null;
  update public.applications set company_candidate_id = null, updated_at = now()
   where company_candidate_id = any (v_ids) and applicant_user_id is not null;

  with gone as (
    delete from public.company_candidates c
     where c.id = any (v_ids)
    returning 1
  )
  select count(*)::int into v_deleted from gone;

  if v_deleted > 0 then
    -- No names or emails (BI-REQ-007).
    perform public.write_company_audit(v_company, 'candidates.deleted', 'candidates', null, null,
      null, jsonb_build_object('count', v_deleted));
  end if;
  return jsonb_build_object('ok', true, 'deleted', v_deleted, 'resume_paths', v_paths);
end $$;

revoke all on function public.delete_company_candidates(uuid[]) from public, anon;
grant execute on function public.delete_company_candidates(uuid[]) to authenticated;
