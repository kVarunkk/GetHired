-- Archive instead of delete for job posts that have applications.
--
-- Deleting a job post used to cascade to its applications (and their notes,
-- screening and scheduled interviews), so a company cleaning up its account
-- silently erased candidates' application history. Now "delete" on a job
-- post with applications archives it: the job closes, leaves the company's
-- lists and stays restorable, and candidates keep their record of it (shown
-- as a closed posting). A job post with no applications is still deleted.

alter table public.job_postings add column if not exists archived_at timestamptz;

comment on column public.job_postings.archived_at is
  'Set when the company removed a job post that has applications: it is closed (inactive) and hidden from the company''s lists until restored.';

-- The decision and the change in one transaction. The row lock conflicts with
-- the key-share lock an application insert takes on its job post, so an
-- application submitted at the same moment either commits first (and is seen
-- here, so the job is archived) or waits and then fails its foreign key. No
-- application is ever lost to a delete.
create or replace function public.remove_job_post(p_job_post_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_post public.job_postings%rowtype;
  v_applications bigint;
begin
  select * into v_post from public.job_postings where id = p_job_post_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.has_company_permission(v_post.company_id, 'jobs.delete', v_post.id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select count(*) into v_applications
    from public.applications a
   where a.job_post_id = v_post.id
      or (v_post.job_id is not null and a.all_jobs_id = v_post.job_id);

  if v_applications > 0 then
    update public.job_postings
       set status = 'inactive', archived_at = coalesce(archived_at, now()), updated_at = now()
     where id = v_post.id;
    if v_post.job_id is not null then
      update public.all_jobs set status = 'inactive' where id = v_post.job_id and status is distinct from 'inactive';
    end if;
    return jsonb_build_object(
      'ok', true, 'outcome', 'archived', 'job_id', v_post.job_id, 'title', v_post.title,
      'applications', v_applications, 'was_active', v_post.status = 'active'
    );
  end if;

  -- The public listing first: job_postings.job_id is ON DELETE SET NULL.
  if v_post.job_id is not null then
    delete from public.all_jobs where id = v_post.job_id;
  end if;
  delete from public.job_postings where id = v_post.id;
  return jsonb_build_object(
    'ok', true, 'outcome', 'deleted', 'job_id', v_post.job_id, 'title', v_post.title,
    'applications', 0, 'was_active', v_post.status = 'active'
  );
end $$;

revoke all on function public.remove_job_post(uuid) from public, anon;
grant execute on function public.remove_job_post(uuid) to authenticated, service_role;

-- Undo an archive. The job comes back closed; publishing it again is the
-- usual set_job_post_status, with the plan's limit.
create or replace function public.restore_job_post(p_job_post_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_post public.job_postings%rowtype;
begin
  select * into v_post from public.job_postings where id = p_job_post_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.has_company_permission(v_post.company_id, 'jobs.delete', v_post.id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_post.archived_at is not null then
    update public.job_postings set archived_at = null, updated_at = now() where id = v_post.id;
  end if;
  return jsonb_build_object('ok', true, 'job_id', v_post.job_id, 'title', v_post.title);
end $$;

revoke all on function public.restore_job_post(uuid) from public, anon;
grant execute on function public.restore_job_post(uuid) to authenticated, service_role;

-- Publishing an archived job post (e.g. through the agent) also restores it,
-- so a live job is never hidden from the company's own lists. Otherwise as in
-- 20261110120000_set_job_post_status.sql.
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

  if v_post.status is distinct from p_status or (p_status = 'active' and v_post.archived_at is not null) then
    update public.job_postings
       set status = p_status,
           archived_at = case when p_status = 'active' then null else archived_at end,
           updated_at = now()
     where id = v_post.id;
  end if;
  if v_post.job_id is not null then
    update public.all_jobs set status = p_status where id = v_post.job_id and status is distinct from p_status;
  end if;

  return jsonb_build_object('ok', true, 'job_id', v_post.job_id, 'changed', v_post.status is distinct from p_status);
end $$;

-- The agent's job list leaves archived posts out, like the company's lists.
-- Otherwise as in 20261017160000_recruiter_roles.sql.
create or replace function public.get_recruiter_job_summaries(
  p_company_id uuid,
  p_status public.job_posting_status default null,
  p_limit integer default 15
)
returns table(
  id uuid, title text, status public.job_posting_status, matching_status public.job_posting_matching_status,
  applicants bigint, new_24h bigint, created_at timestamptz, updated_at timestamptz
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
           jp.created_at, jp.updated_at
      from public.job_postings jp
      left join public.applications a on a.job_post_id = jp.id
     where jp.company_id = p_company_id
       and jp.id = any (v_jobs)
       and jp.archived_at is null
       and (p_status is null or jp.status = p_status)
     group by jp.id
     order by (jp.status = 'active') desc, jp.updated_at desc
     limit least(greatest(coalesce(p_limit, 15), 1), 50);
end;
$$;
