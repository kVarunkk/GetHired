-- SM-REQ-007 (plan/state-machines/feature-state-machines-spec.md, SMT-006):
-- a job post's status and its public all_jobs row change in one transaction,
-- so the company's view and the public listing can't drift apart. Setting
-- the status the post already has still writes all_jobs, so a retry repairs
-- a row that drifted before this function existed.
--
-- The permission is jobs.publish, the key the app's action and the recruiter
-- agent check (helpers/jobs/set-job-post-status.ts).

create or replace function public.set_job_post_status(
  p_job_post_id uuid,
  p_status public.job_posting_status
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_post public.job_postings%rowtype;
begin
  if p_status is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;

  select * into v_post from public.job_postings where id = p_job_post_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.has_company_permission(v_post.company_id, 'jobs.publish', v_post.id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- enforce_active_job_post_limit only fires for the authenticated role, and
  -- this function runs as its owner, so the limit is checked here.
  if p_status = 'active' and v_post.status is distinct from 'active'
     and not public.billing_can_activate_job_post(v_post.company_id) then
    return jsonb_build_object('ok', false, 'reason', 'active_job_posts');
  end if;

  if v_post.status is distinct from p_status then
    update public.job_postings set status = p_status, updated_at = now() where id = v_post.id;
  end if;
  if v_post.job_id is not null then
    update public.all_jobs set status = p_status where id = v_post.job_id and status is distinct from p_status;
  end if;

  return jsonb_build_object('ok', true, 'job_id', v_post.job_id, 'changed', v_post.status is distinct from p_status);
end $$;

revoke all on function public.set_job_post_status(uuid, public.job_posting_status) from public, anon;
grant execute on function public.set_job_post_status(uuid, public.job_posting_status) to authenticated, service_role;
