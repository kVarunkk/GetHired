-- Job states (JLT-011 fix): set_job_post_state logged the move with target
-- type 'job_post', which company_audit_log_target_type_check refuses. 'job'
-- is what job.assigned uses. Until this, every move failed.

-- The same function as 20261124120000_job_states.sql, with target type 'job'.
create or replace function public.set_job_post_state(
  p_job_post_id uuid,
  p_to public.job_post_state,
  p_reason public.job_close_reason default null,
  p_note text default null,
  p_actor_kind text default 'user'
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_post public.job_postings%rowtype;
  v_from public.job_post_state;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_approval boolean;
  v_publish boolean;
  v_approve boolean;
  v_submitter uuid;
  v_first_open boolean;
  v_actor uuid := (select auth.uid());
begin
  if p_to is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition');
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    return jsonb_build_object('ok', false, 'reason', 'note_too_long');
  end if;

  select * into v_post from public.job_postings where id = p_job_post_id for update;
  if not found or not public.has_company_permission(v_post.company_id, 'jobs.view', v_post.id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  v_from := v_post.state;
  v_publish := public.has_company_permission(v_post.company_id, 'jobs.publish', v_post.id);
  v_approve := public.has_company_permission(v_post.company_id, 'jobs.approve', v_post.id);

  -- The state the job already has: nothing to do, but the public row is
  -- re-synced so a retry repairs one that drifted.
  if v_from = p_to then
    if not (v_publish or v_approve) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    if v_post.job_id is not null then
      update public.all_jobs set status = v_post.status
       where id = v_post.job_id and status is distinct from v_post.status;
    end if;
    return jsonb_build_object('ok', true, 'job_id', v_post.job_id, 'changed', false,
                              'from', v_from, 'to', p_to, 'first_open', false);
  end if;

  if not public.job_post_move_allowed(v_from, p_to) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition');
  end if;

  select ci.job_approval_required into v_approval from public.company_info ci where ci.id = v_post.company_id;
  v_approval := coalesce(v_approval, false);

  -- Who may make the move (JL-REQ-001, D6).
  if v_from = 'draft' and p_to = 'open' then
    if not v_publish then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
    if v_approval and not v_approve then
      return jsonb_build_object('ok', false, 'reason', 'approval_required');
    end if;
  elsif v_from = 'draft' and p_to = 'pending_approval' then
    if not v_publish then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
    if not v_approval then return jsonb_build_object('ok', false, 'reason', 'invalid_transition'); end if;
  elsif v_from = 'pending_approval' and p_to = 'open' then
    if not v_approve then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  elsif v_from = 'pending_approval' and p_to = 'draft' then
    select e.actor_user_id into v_submitter
      from public.job_post_state_events e
     where e.job_post_id = v_post.id and e.to_state = 'pending_approval'
     order by e.created_at desc limit 1;
    if v_publish and v_actor is not null and v_submitter = v_actor then
      null; -- the submitter withdraws it
    elsif v_approve then
      if v_note is null then return jsonb_build_object('ok', false, 'reason', 'note_required'); end if;
    else
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif not v_publish then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_to = 'closed' and p_reason is null then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;

  if p_to = 'open' then
    if v_post.closes_at is not null and v_post.closes_at < public.company_today(v_post.company_id) then
      return jsonb_build_object('ok', false, 'reason', 'closes_at_past');
    end if;
    if v_post.job_id is null then
      return jsonb_build_object('ok', false, 'reason', 'no_public_row');
    end if;
    -- enforce_active_job_post_limit only fires for `authenticated`, and this
    -- function runs as its owner, so the limit is checked here.
    if not public.billing_can_activate_job_post(v_post.company_id) then
      return jsonb_build_object('ok', false, 'reason', 'active_job_posts');
    end if;
  end if;

  v_first_open := p_to = 'open' and v_post.first_opened_at is null;

  -- derive_job_post_status sets status and the lifecycle timestamps.
  update public.job_postings
     set state = p_to,
         close_reason = case when p_to = 'closed' then p_reason end
   where id = v_post.id
  returning * into v_post;

  if v_post.job_id is not null then
    update public.all_jobs set status = v_post.status
     where id = v_post.job_id and status is distinct from v_post.status;
  end if;

  -- clock_timestamp, so moves inside one transaction still sort in order.
  insert into public.job_post_state_events
    (job_post_id, company_id, from_state, to_state, reason, note, actor_user_id, created_at)
  values
    (v_post.id, v_post.company_id, v_from, p_to, case when p_to = 'closed' then p_reason end, v_note, v_actor,
     clock_timestamp());

  perform public.write_company_audit(
    v_post.company_id, 'job.state_changed', 'job', v_post.id::text, v_post.title,
    jsonb_build_object('state', v_from),
    jsonb_strip_nulls(jsonb_build_object('state', p_to, 'reason', case when p_to = 'closed' then p_reason end)),
    public.audit_actor_kind(p_actor_kind));

  return jsonb_build_object('ok', true, 'job_id', v_post.job_id, 'changed', true,
                            'from', v_from, 'to', p_to, 'first_open', v_first_open,
                            'submitter', v_submitter);
end $$;
