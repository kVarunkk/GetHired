-- Archive instead of delete for job posts that have applications.
--
-- Deleting a job post used to cascade to its applications (and their notes,
-- screening and scheduled interviews), so a company cleaning up its account
-- silently erased candidates' application history. Now "delete" on a job
-- post with applications archives it: the job closes, leaves the company's
-- lists and stays restorable, and candidates keep their record of it (shown
-- as a closed posting). A job post with no applications is still deleted.
--
-- Built on the job post states (20261124120000_job_states.sql): archiving
-- closes the job the way set_job_post_state does, with its event and audit
-- entry, and archived_at only hides it from the company's lists.

alter table public.job_postings add column if not exists archived_at timestamptz;

comment on column public.job_postings.archived_at is
  'Set when the company removed a job post that has applications: it is closed and hidden from the company''s lists until restored or reopened.';

-- The decision and the change in one transaction. The row lock conflicts with
-- the key-share lock an application insert takes on its job post, so an
-- application submitted at the same moment either commits first (and is seen
-- here, so the job is archived) or waits and then fails its foreign key. No
-- application is ever lost to a delete.
--
-- An open or paused job is closed (reason `cancelled`). One that's already
-- closed or filled keeps its state. A draft or pending job has no
-- applications in practice; if one does, it's hidden and keeps its state.
-- This is jobs.delete, not jobs.publish, so it writes the state itself rather
-- than through set_job_post_state; derive_job_post_status sets status and
-- closed_at.
create or replace function public.remove_job_post(p_job_post_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_post public.job_postings%rowtype;
  v_from public.job_post_state;
  v_applications bigint;
begin
  select * into v_post from public.job_postings where id = p_job_post_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.has_company_permission(v_post.company_id, 'jobs.delete', v_post.id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  v_from := v_post.state;

  select count(*) into v_applications
    from public.applications a
   where a.job_post_id = v_post.id
      or (v_post.job_id is not null and a.all_jobs_id = v_post.job_id);

  if v_applications > 0 then
    update public.job_postings
       set state = case when v_from in ('open', 'paused') then 'closed'::public.job_post_state else v_from end,
           close_reason = case when v_from in ('open', 'paused') then 'cancelled'::public.job_close_reason else close_reason end,
           archived_at = coalesce(archived_at, now()),
           updated_at = now()
     where id = v_post.id
    returning * into v_post;

    if v_post.job_id is not null then
      update public.all_jobs set status = v_post.status
       where id = v_post.job_id and status is distinct from v_post.status;
    end if;

    if v_post.state is distinct from v_from then
      insert into public.job_post_state_events
        (job_post_id, company_id, from_state, to_state, reason, note, actor_user_id, created_at)
      values
        (v_post.id, v_post.company_id, v_from, v_post.state, v_post.close_reason,
         'Archived: deleted while it had applications', (select auth.uid()), clock_timestamp());

      perform public.write_company_audit(
        v_post.company_id, 'job.state_changed', 'job_post', v_post.id::text, v_post.title,
        jsonb_build_object('state', v_from),
        jsonb_build_object('state', v_post.state, 'reason', v_post.close_reason),
        public.audit_actor_kind('user'));
    end if;

    return jsonb_build_object(
      'ok', true, 'outcome', 'archived', 'job_id', v_post.job_id, 'title', v_post.title,
      'applications', v_applications, 'was_active', v_from = 'open'
    );
  end if;

  -- The public listing first: job_postings.job_id is ON DELETE SET NULL.
  if v_post.job_id is not null then
    delete from public.all_jobs where id = v_post.job_id;
  end if;
  delete from public.job_postings where id = v_post.id;
  return jsonb_build_object(
    'ok', true, 'outcome', 'deleted', 'job_id', v_post.job_id, 'title', v_post.title,
    'applications', 0, 'was_active', v_from = 'open'
  );
end $$;

revoke all on function public.remove_job_post(uuid) from public, anon;
grant execute on function public.remove_job_post(uuid) to authenticated, service_role;

-- Undo an archive. The job comes back to the company's lists in the state it
-- was archived in (usually closed); reopening it is set_job_post_state, with
-- the plan's limit.
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

-- Reopening an archived job post (from its page or through the agent) also
-- restores it, so a live job is never hidden from the company's own lists.
-- State only changes through definer RPCs, so this runs as their owner.
create or replace function public.unarchive_opened_job_post()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state = 'open' and old.state is distinct from 'open' then
    new.archived_at := null;
  end if;
  return new;
end $$;

revoke all on function public.unarchive_opened_job_post() from public, anon, authenticated;
grant execute on function public.unarchive_opened_job_post() to service_role;

drop trigger if exists unarchive_opened_job_post on public.job_postings;
create trigger unarchive_opened_job_post
  before update of state on public.job_postings
  for each row execute function public.unarchive_opened_job_post();

-- The agent's job list leaves archived posts out, like the company's lists.
-- Otherwise as in 20261124120000_job_states.sql.
create or replace function public.get_recruiter_job_summaries(
  p_company_id uuid,
  p_status public.job_posting_status default null,
  p_limit integer default 15,
  p_states public.job_post_state[] default null
)
returns table(
  id uuid, title text, status public.job_posting_status, matching_status public.job_posting_matching_status,
  applicants bigint, new_24h bigint, created_at timestamptz, updated_at timestamptz,
  state public.job_post_state, openings integer, closes_at date, hires bigint
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
           jp.created_at, jp.updated_at,
           jp.state, jp.openings, jp.closes_at,
           count(a.id) filter (where jp.id = any (v_app_jobs)
                                 and a.merged_into_application_id is null
                                 and ps.kind = 'hired') as hires
      from public.job_postings jp
      left join public.applications a on a.job_post_id = jp.id
      left join public.pipeline_stages ps on ps.id = a.stage_id
     where jp.company_id = p_company_id
       and jp.id = any (v_jobs)
       and jp.archived_at is null
       and (p_status is null or jp.status = p_status)
       and (p_states is null or jp.state = any (p_states))
     group by jp.id
     order by (jp.state = 'open') desc, (jp.state in ('draft', 'pending_approval')) desc, jp.updated_at desc
     limit least(greatest(coalesce(p_limit, 15), 1), 50);
end;
$$;

revoke all on function public.get_recruiter_job_summaries(uuid, public.job_posting_status, integer, public.job_post_state[]) from public, anon;
grant execute on function public.get_recruiter_job_summaries(uuid, public.job_posting_status, integer, public.job_post_state[]) to authenticated, service_role;
