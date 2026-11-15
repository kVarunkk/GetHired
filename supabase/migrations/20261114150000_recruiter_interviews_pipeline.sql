-- Human interviews, phase 4: reminders and pipeline
-- (plan/recruiter-interviews/feature-recruiter-interviews-tasks.md, IVT-070–074).

-- ============================================================ feedback emails (IVT-070, IV-REQ-040, D11)
-- Each panel member without a submitted scorecard on a completed interview
-- gets the request, then one reminder 24 h later: at most two emails per
-- member per interview. `/api/updates/interviews/feedback` lists who's due,
-- claims each email (a guarded update, so a repeated run can't send it
-- twice) and releases the claim when the send fails, so the next run retries.
-- Only interviews that ended in the last 7 days (the kit's scorecard window)
-- are chased, so interviews completed before this shipped aren't emailed.

create or replace function public.interview_feedback_window() returns interval
language sql immutable as $$ select interval '7 days' $$;

create or replace function public.interview_feedback_reminder_after() returns interval
language sql immutable as $$ select interval '24 hours' $$;

-- Whether the member still owes feedback on the interview.
create or replace function public.interview_feedback_owed(p_interview_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.scheduled_interviews si
      join public.company_members cm on cm.company_id = si.company_id and cm.user_id = p_user_id
     where si.id = p_interview_id
       and si.status = 'completed'
       and si.ends_at > now() - public.interview_feedback_window()
       and not exists (
         select 1 from public.interview_scorecards sc
          where sc.interview_id = si.id and sc.author_user_id = p_user_id and sc.status = 'submitted'
       )
  )
$$;
revoke all on function public.interview_feedback_owed(uuid, uuid) from public, anon, authenticated;

-- Who's due an email now: `request` when none was sent, `reminder` 24 h after it.
create or replace function public.interview_feedback_due(p_limit integer default 100)
returns table (
  interview_id uuid,
  user_id uuid,
  kind text,
  interview_name text,
  job_title text,
  candidate_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.interview_id,
         p.user_id,
         case when p.feedback_requested_at is null then 'request' else 'reminder' end,
         si.name,
         jp.title,
         coalesce(ui.full_name, cc.full_name)
    from public.scheduled_interview_panel p
    join public.scheduled_interviews si on si.id = p.interview_id
    join public.job_postings jp on jp.id = si.job_post_id
    join public.applications a on a.id = si.application_id
    left join public.user_info ui on ui.user_id = a.applicant_user_id
    left join public.company_candidates cc on cc.id = a.company_candidate_id
   where si.status = 'completed'
     and si.ends_at > now() - public.interview_feedback_window()
     and (
       p.feedback_requested_at is null
       or (p.feedback_reminded_at is null and p.feedback_requested_at <= now() - public.interview_feedback_reminder_after())
     )
     and public.interview_feedback_owed(p.interview_id, p.user_id)
   order by si.ends_at, p.interview_id, p.user_id
   limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;
revoke all on function public.interview_feedback_due(integer) from public, anon, authenticated;
grant execute on function public.interview_feedback_due(integer) to service_role;

-- Claims one email: returns the stamp it wrote, or null when it isn't due
-- (already sent, submitted meanwhile, no longer a member...).
create or replace function public.claim_interview_feedback_email(p_interview_id uuid, p_user_id uuid, p_kind text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_hit integer;
begin
  if not public.interview_feedback_owed(p_interview_id, p_user_id) then
    return null;
  end if;
  if p_kind = 'request' then
    update public.scheduled_interview_panel
       set feedback_requested_at = v_now
     where interview_id = p_interview_id and user_id = p_user_id and feedback_requested_at is null;
  elsif p_kind = 'reminder' then
    update public.scheduled_interview_panel
       set feedback_reminded_at = v_now
     where interview_id = p_interview_id and user_id = p_user_id
       and feedback_reminded_at is null
       and feedback_requested_at <= v_now - public.interview_feedback_reminder_after();
  else
    return null;
  end if;
  get diagnostics v_hit = row_count;
  return case when v_hit = 1 then v_now end;
end $$;
revoke all on function public.claim_interview_feedback_email(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_interview_feedback_email(uuid, uuid, text) to service_role;

-- Undoes a claim whose email failed, so the next run sends it.
create or replace function public.release_interview_feedback_email(
  p_interview_id uuid,
  p_user_id uuid,
  p_kind text,
  p_claimed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hit integer;
begin
  if p_kind = 'request' then
    update public.scheduled_interview_panel set feedback_requested_at = null
     where interview_id = p_interview_id and user_id = p_user_id and feedback_requested_at = p_claimed_at;
  elsif p_kind = 'reminder' then
    update public.scheduled_interview_panel set feedback_reminded_at = null
     where interview_id = p_interview_id and user_id = p_user_id and feedback_reminded_at = p_claimed_at;
  else
    return false;
  end if;
  get diagnostics v_hit = row_count;
  return v_hit = 1;
end $$;
revoke all on function public.release_interview_feedback_email(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.release_interview_feedback_email(uuid, uuid, text, timestamptz) to service_role;

-- ============================================================ closing cancels interviews (IVT-071, IV-REQ-023a, D14, D22)
-- A move into a Rejected or Hired stage cancels the application's upcoming
-- interviews (a link still open, or a booked time that hasn't started) in the
-- same transaction as the move. Every path that closes an application does
-- this by default (D22); the move dialog's "Cancel N upcoming interviews",
-- unchecked, keeps them by sending the request header `x-keep-interviews: 1`
-- with the update, which PostgREST exposes in `request.headers`. Google can't
-- be called from here: each cancelled interview with an event is queued on
-- `interview_calendar_ops`, and the worker deletes the event. The links stop
-- working as soon as the status changes.

create or replace function public.move_keeps_interviews()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-keep-interviews') = '1',
    false
  )
$$;

create or replace function public.applications_close_human_interviews()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_kind public.pipeline_stage_kind;
  v_row public.scheduled_interviews%rowtype;
begin
  select kind into v_kind from public.pipeline_stages where id = new.stage_id;
  if v_kind is null or v_kind not in ('rejected', 'hired') then return null; end if;
  if public.move_keeps_interviews() then return null; end if;

  for v_row in
    update public.scheduled_interviews
       set status = 'cancelled',
           booking_token_expires_at = case when booking_token_hash is null then booking_token_expires_at
                                           else least(booking_token_expires_at, now()) end,
           updated_at = now()
     where application_id = new.id
       and (status = 'awaiting_candidate' or (status = 'scheduled' and starts_at > now()))
    returning *
  loop
    perform public.log_meeting_event(v_row, 'meeting_cancelled', (select auth.uid()),
      jsonb_build_object('reason', 'stage', 'stage_kind', v_kind));
    perform public.queue_interview_calendar_op(v_row.id, 'delete');
  end loop;
  return null;
end $$;
revoke all on function public.applications_close_human_interviews() from public, anon, authenticated;

-- Not "update of stage_id", as for applications_close_screening_interview.
drop trigger if exists applications_close_human_interviews on public.applications;
create trigger applications_close_human_interviews
  after update on public.applications
  for each row
  when (new.stage_id is distinct from old.stage_id)
  execute function public.applications_close_human_interviews();

-- The move dialog's N: upcoming interviews on the applications the caller may move.
create or replace function public.upcoming_interview_count(p_application_ids uuid[])
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.scheduled_interviews si
   where si.application_id = any (coalesce(p_application_ids, '{}'))
     and (si.status = 'awaiting_candidate' or (si.status = 'scheduled' and si.starts_at > now()))
     and public.has_company_permission(si.company_id, 'pipeline.move', si.job_post_id)
$$;
revoke all on function public.upcoming_interview_count(uuid[]) from public, anon;
grant execute on function public.upcoming_interview_count(uuid[]) to authenticated;

-- ============================================================ board badges (IVT-073, IV-REQ-041)
-- One call per board: for each live application on the job, its next
-- interview (scheduled and not started) and the feedback on interviews
-- completed in the feedback window, as submitted / expected scorecards.
-- Expected seats are current members' plus anyone who already submitted.
-- Only times and counts, which the Interviews section shows blind readers
-- too (IV-REQ-032): no rating or recommendation, so there's nothing to mask.
-- An application with neither is left out. Empty without scheduling.view.
create or replace function public.job_interview_badges(p_job_post_id uuid)
returns table (application_id uuid, next_starts_at timestamptz, feedback_submitted integer, feedback_total integer)
language sql
stable
security definer
set search_path = ''
as $$
  select si.application_id,
         min(si.starts_at) filter (where not w.feedback),
         coalesce(sum(f.submitted) filter (where w.feedback), 0)::integer,
         coalesce(sum(f.total) filter (where w.feedback), 0)::integer
    from public.scheduled_interviews si
    join public.applications a on a.id = si.application_id and a.merged_into_application_id is null
    join public.job_postings jp on jp.id = si.job_post_id
   cross join lateral (
     select si.status = 'completed' and si.ends_at > now() - public.interview_feedback_window() as feedback
   ) w
   cross join lateral (
     select count(*) filter (where s.submitted) as submitted,
            count(*) filter (where s.submitted or s.member) as total
       from public.scheduled_interview_panel p
      cross join lateral (
        select exists (select 1 from public.interview_scorecards sc
                        where sc.interview_id = si.id and sc.author_user_id = p.user_id and sc.status = 'submitted') as submitted,
               exists (select 1 from public.company_members cm
                        where cm.company_id = si.company_id and cm.user_id = p.user_id) as member
      ) s
      where p.interview_id = si.id
   ) f
   where si.job_post_id = p_job_post_id
     and jp.company_id = public.my_company_id()
     and public.has_company_permission(jp.company_id, 'scheduling.view', p_job_post_id)
     and ((si.status = 'scheduled' and si.starts_at > now()) or w.feedback)
   group by si.application_id
  having min(si.starts_at) filter (where not w.feedback) is not null
      or coalesce(sum(f.submitted) filter (where w.feedback), 0) < coalesce(sum(f.total) filter (where w.feedback), 0)
$$;
revoke all on function public.job_interview_badges(uuid) from public, anon;
grant execute on function public.job_interview_badges(uuid) to authenticated;

-- ============================================================ dashboard follow-ups (IVT-074, IV-REQ-041)
-- The dashboard's "needs attention" for interviews with people, for the
-- session member:
--   feedback_overdue: completed more than 24 h ago (inside the feedback
--     window) with scorecards still owed by current members. Shown on jobs
--     with scheduling.view, and always when the member owes one (`mine`),
--     since the kit is theirs whatever their role.
--   awaiting_candidate: a self-scheduling link sent more than 3 days ago and
--     not booked, on jobs with scheduling.view.
-- The member's own scorecards first, then overdue feedback, oldest first.
-- Only names and counts: no rating, so blind review has nothing to hide.
create or replace function public.feedback_overdue_after() returns interval
language sql immutable set search_path = '' as $$ select interval '24 hours' $$;
create or replace function public.awaiting_candidate_alert_after() returns interval
language sql immutable set search_path = '' as $$ select interval '3 days' $$;

create or replace function public.interviews_needing_attention(p_limit integer default 20)
returns table (
  kind text,
  interview_id uuid,
  application_id uuid,
  job_post_id uuid,
  job_title text,
  candidate_name text,
  interview_name text,
  since timestamptz,
  owed integer,
  mine boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select x.kind, x.interview_id, x.application_id, x.job_post_id, x.job_title, x.candidate_name,
         x.interview_name, x.since, x.owed, x.mine
    from (
      select 'feedback_overdue'::text as kind, si.id as interview_id, si.application_id, si.job_post_id,
             jp.title as job_title, coalesce(ui.full_name, cc.full_name) as candidate_name,
             si.name as interview_name, si.ends_at as since, o.owed::integer as owed, o.mine
        from public.scheduled_interviews si
        join public.applications a on a.id = si.application_id and a.merged_into_application_id is null
        join public.job_postings jp on jp.id = si.job_post_id
        left join public.user_info ui on ui.user_id = a.applicant_user_id
        left join public.company_candidates cc on cc.id = a.company_candidate_id
       cross join lateral (
         select count(*) as owed, coalesce(bool_or(p.user_id = (select auth.uid())), false) as mine
           from public.scheduled_interview_panel p
           join public.company_members cm on cm.company_id = si.company_id and cm.user_id = p.user_id
          where p.interview_id = si.id
            and not exists (select 1 from public.interview_scorecards sc
                             where sc.interview_id = si.id and sc.author_user_id = p.user_id
                               and sc.status = 'submitted')
       ) o
       where si.company_id = public.my_company_id()
         and si.status = 'completed'
         and si.ends_at <= now() - public.feedback_overdue_after()
         and si.ends_at > now() - public.interview_feedback_window()
         and o.owed > 0
         and (o.mine or public.has_company_permission(si.company_id, 'scheduling.view', si.job_post_id))
      union all
      select 'awaiting_candidate', si.id, si.application_id, si.job_post_id, jp.title,
             coalesce(ui.full_name, cc.full_name), si.name, si.booking_link_sent_at, 0, false
        from public.scheduled_interviews si
        join public.applications a on a.id = si.application_id and a.merged_into_application_id is null
        join public.job_postings jp on jp.id = si.job_post_id
        left join public.user_info ui on ui.user_id = a.applicant_user_id
        left join public.company_candidates cc on cc.id = a.company_candidate_id
       where si.company_id = public.my_company_id()
         and si.status = 'awaiting_candidate'
         and si.booking_link_sent_at <= now() - public.awaiting_candidate_alert_after()
         and public.has_company_permission(si.company_id, 'scheduling.view', si.job_post_id)
    ) x
   order by x.mine desc, x.kind = 'awaiting_candidate', x.since, x.interview_id
   limit greatest(least(coalesce(p_limit, 20), 50), 1)
$$;
revoke all on function public.interviews_needing_attention(integer) from public, anon;
grant execute on function public.interviews_needing_attention(integer) to authenticated;
