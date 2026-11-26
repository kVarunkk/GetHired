-- "Mark reviewed" for a finished AI interview, so it leaves the company
-- dashboard's Needs attention without the application having to move.
--
-- Additive only (two nullable columns and one new function), so it's safe
-- while the code that uses it isn't deployed.
--
-- A review counts only while company_reviewed_at >= completed_at: after
-- another attempt the new report needs review again. updated_at is left
-- alone, because applicant_dismissed_at is compared with it: touching it would
-- put a dismissed interview back on the applicant's dashboard.

alter table public.application_interviews
  add column if not exists company_reviewed_at timestamptz,
  add column if not exists company_reviewed_by uuid references auth.users(id) on delete set null;

-- Clients can only select this table, so the write goes through here. It's for
-- the whole team and needs interviews.manage on the job. Marking it again
-- keeps the first reviewer.
create or replace function public.mark_screening_interview_reviewed(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.application_interviews%rowtype;
begin
  select * into v_row from public.application_interviews where id = p_id for update;
  if not found or not public.is_company_member(v_row.company_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.has_company_permission(v_row.company_id, 'interviews.manage', v_row.job_post_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_row.status <> 'completed' or v_row.completed_at is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;
  if v_row.company_reviewed_at is null or v_row.company_reviewed_at < v_row.completed_at then
    update public.application_interviews
       set company_reviewed_at = now(), company_reviewed_by = (select auth.uid())
     where id = v_row.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.mark_screening_interview_reviewed(uuid) from public, anon;
grant execute on function public.mark_screening_interview_reviewed(uuid) to authenticated, service_role;
