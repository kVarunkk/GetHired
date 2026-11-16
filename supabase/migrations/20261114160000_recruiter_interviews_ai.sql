-- Human interviews, phase 5: AI (plan/recruiter-interviews/feature-recruiter-interviews-tasks.md).
-- IVT-081 / IV-REQ-051: the feedback summary. Only `scorecards.view_all`
-- reads or writes it. A summary records the scorecards it read and the
-- latest `updated_at` among them, so it reads as stale when a scorecard is
-- submitted or edited afterwards.

alter table public.interview_feedback_summaries
  add column if not exists scorecards_updated_at timestamptz;

-- What summarizing needs at least (IV-REQ-051). Mirrors FEEDBACK_SUMMARY_MIN in
-- helpers/interviews/config.ts (config.test.ts keeps them in step).
create or replace function public.feedback_summary_min()
returns integer language sql immutable as $$ select 2 $$;

-- The application's submitted scorecards right now: their ids (sorted) and
-- the latest change. Internal: callers check the permission first.
create or replace function public.feedback_summary_current(p_application_id uuid)
returns table (scorecard_ids uuid[], version timestamptz, submitted integer)
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.id order by s.id), '{}'::uuid[]),
         max(s.updated_at),
         count(*)::integer
    from public.interview_scorecards s
   where s.application_id = p_application_id
     and s.status = 'submitted'
$$;
revoke all on function public.feedback_summary_current(uuid) from public, anon, authenticated;

-- The application, if it's the session company's ('not_found' otherwise), and
-- whether the caller has scorecards.view_all for its job.
create or replace function public.feedback_summary_access(p_application_id uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select case
    when jp.id is null then 'not_found'
    when public.has_company_permission(jp.company_id, 'scorecards.view_all', jp.id) then 'ok'
    else 'forbidden'
  end
    from (select 1) one
    left join public.applications a on a.id = p_application_id
    left join public.job_postings jp on jp.id = a.job_post_id and jp.company_id = public.my_company_id()
$$;
revoke all on function public.feedback_summary_access(uuid) from public, anon, authenticated;

-- What the summarizer reads: each submitted scorecard with its interview's
-- name and competencies, the author's display name (never an email), and
-- the version to hand back to save_feedback_summary.
create or replace function public.feedback_summary_source(p_application_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_access text := public.feedback_summary_access(p_application_id);
  v_current record;
begin
  if v_access <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v_access);
  end if;
  select * into v_current from public.feedback_summary_current(p_application_id);
  return jsonb_build_object(
    'ok', true,
    'version', v_current.version,
    'scorecards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'interview_id', i.id,
        'interview_name', i.name,
        'competencies', coalesce(i.plan_snapshot -> 'competencies', '[]'::jsonb),
        'author_name', public.member_display_name(s.author_user_id),
        'overall', s.overall,
        'overall_note', s.overall_note,
        'ratings', s.ratings,
        'submitted_at', s.submitted_at
      ) order by i.starts_at nulls last, i.created_at, s.submitted_at, s.id)
        from public.interview_scorecards s
        join public.scheduled_interviews i on i.id = s.interview_id
       where s.application_id = p_application_id
         and s.status = 'submitted'
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.feedback_summary_source(uuid) from public, anon;
grant execute on function public.feedback_summary_source(uuid) to authenticated;

-- Stores a summary of exactly the scorecards that are submitted now, at the
-- version the caller read ('changed' otherwise, so a summary never claims
-- scorecards it didn't read).
create or replace function public.save_feedback_summary(
  p_application_id uuid,
  p_scorecard_ids uuid[],
  p_version timestamptz,
  p_summary jsonb
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_access text := public.feedback_summary_access(p_application_id);
  v_current record;
  v_ids uuid[];
  v_company uuid;
  v_row public.interview_feedback_summaries%rowtype;
begin
  if v_access <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v_access);
  end if;
  if p_summary is null or jsonb_typeof(p_summary) <> 'object' or octet_length(p_summary::text) > 65536 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;
  select * into v_current from public.feedback_summary_current(p_application_id);
  if v_current.submitted < public.feedback_summary_min() then
    return jsonb_build_object('ok', false, 'reason', 'too_few');
  end if;
  select coalesce(array_agg(distinct x order by x), '{}'::uuid[]) into v_ids from unnest(p_scorecard_ids) x;
  if v_ids is distinct from v_current.scorecard_ids or p_version is distinct from v_current.version then
    return jsonb_build_object('ok', false, 'reason', 'changed');
  end if;

  select jp.company_id into v_company
    from public.applications a join public.job_postings jp on jp.id = a.job_post_id
   where a.id = p_application_id;
  insert into public.interview_feedback_summaries
    (company_id, application_id, scorecard_ids, scorecards_updated_at, summary, created_by)
  values (v_company, p_application_id, v_ids, v_current.version, p_summary, (select auth.uid()))
  returning * into v_row;
  return jsonb_build_object('ok', true, 'id', v_row.id, 'created_at', v_row.created_at);
end;
$$;
revoke all on function public.save_feedback_summary(uuid, uuid[], timestamptz, jsonb) from public, anon;
grant execute on function public.save_feedback_summary(uuid, uuid[], timestamptz, jsonb) to authenticated;

-- The latest summary (or null), whether it's stale, and how many scorecards
-- are submitted now: the one reader of a summary's state.
create or replace function public.get_feedback_summary(p_application_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_access text := public.feedback_summary_access(p_application_id);
  v_current record;
  v_row public.interview_feedback_summaries%rowtype;
begin
  if v_access <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v_access);
  end if;
  select * into v_current from public.feedback_summary_current(p_application_id);
  select * into v_row from public.interview_feedback_summaries
   where application_id = p_application_id
   order by created_at desc, id desc
   limit 1;
  return jsonb_build_object(
    'ok', true,
    'submitted', v_current.submitted,
    'min', public.feedback_summary_min(),
    'summary', case when v_row.id is null then null else v_row.summary end,
    'created_at', v_row.created_at,
    'stale', v_row.id is not null and (
      v_row.scorecard_ids is distinct from v_current.scorecard_ids
      or v_row.scorecards_updated_at is distinct from v_current.version
    )
  );
end;
$$;
revoke all on function public.get_feedback_summary(uuid) from public, anon;
grant execute on function public.get_feedback_summary(uuid) to authenticated;

-- ============================================================ reminding interviewers (IVT-084, IV-REQ-052)
-- "Remind" on the Interviews section and the agent's remindInterviewers email
-- the panel members who haven't submitted a scorecard, at most once per
-- member per interview per 24 hours. The stamp is separate from the
-- automatic emails' (feedback_requested_at / feedback_reminded_at), so a
-- manual reminder never uses up the cron's.

alter table public.scheduled_interview_panel
  add column if not exists reminded_at timestamptz;

-- Mirrors REMIND_GAP_HOURS in helpers/interviews/config.ts (config.test.ts keeps them in step).
create or replace function public.interviewer_reminder_gap() returns interval
language sql immutable as $$ select interval '24 hours' $$;

-- Who a reminder goes to. Each current member of the panel is `submitted`,
-- `recent` (reminded in the last 24 h) or `due`. With p_claim, the due ones
-- are stamped (a guarded update) and come back as `claimed`, with the stamp
-- in `claimed_at` for release_interviewer_reminder. Without it nothing
-- changes, which is what the approval card and MCP's preview read. Needs
-- scheduling.manage for the interview's job. A reminder only makes sense
-- while a scorecard can be written: from the start of a scheduled interview,
-- and for 7 days after a completed one ends.
create or replace function public.interviewer_reminders(p_interview_id uuid, p_claim boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_si record;
  v_members jsonb;
  v_claimed uuid[] := '{}';
begin
  select si.id, si.company_id, si.job_post_id, si.application_id, si.name, si.status, si.starts_at, si.ends_at,
         jp.title as job_title, a.merged_into_application_id,
         coalesce(cc.full_name, ui.full_name) as candidate_name
    into v_si
    from public.scheduled_interviews si
    join public.job_postings jp on jp.id = si.job_post_id
    join public.applications a on a.id = si.application_id
    left join public.user_info ui on ui.user_id = a.applicant_user_id
    left join public.company_candidates cc on cc.id = a.company_candidate_id
   where si.id = p_interview_id
     and si.company_id = public.my_company_id();
  if v_si.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.has_company_permission(v_si.company_id, 'scheduling.manage', v_si.job_post_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_si.merged_into_application_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'merged');
  end if;
  if v_si.status not in ('scheduled', 'completed') then
    return jsonb_build_object('ok', false, 'reason', 'no_feedback');
  end if;
  if v_si.starts_at is null or v_si.starts_at > v_now then
    return jsonb_build_object('ok', false, 'reason', 'not_started');
  end if;
  if v_si.ends_at <= v_now - public.interview_feedback_window() then
    return jsonb_build_object('ok', false, 'reason', 'feedback_closed');
  end if;

  if p_claim then
    with claimed as (
    update public.scheduled_interview_panel p
       set reminded_at = v_now
     where p.interview_id = p_interview_id
       and (p.reminded_at is null or p.reminded_at <= v_now - public.interviewer_reminder_gap())
       and exists (select 1 from public.company_members cm
                    where cm.company_id = v_si.company_id and cm.user_id = p.user_id)
       and not exists (select 1 from public.interview_scorecards sc
                        where sc.interview_id = p.interview_id and sc.author_user_id = p.user_id
                          and sc.status = 'submitted')
    returning p.user_id
    )
    select coalesce(array_agg(user_id), '{}') into v_claimed from claimed;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', p.user_id,
           'name', coalesce(public.member_display_name(p.user_id), 'Interviewer'),
           'state', case
             when exists (select 1 from public.interview_scorecards sc
                           where sc.interview_id = p.interview_id and sc.author_user_id = p.user_id
                             and sc.status = 'submitted') then 'submitted'
             when p.user_id = any (v_claimed) then 'claimed'
             when p.reminded_at > v_now - public.interviewer_reminder_gap() then 'recent'
             else 'due'
           end
         ) order by p.user_id), '[]'::jsonb)
    into v_members
    from public.scheduled_interview_panel p
   where p.interview_id = p_interview_id
     and exists (select 1 from public.company_members cm
                  where cm.company_id = v_si.company_id and cm.user_id = p.user_id);

  return jsonb_build_object(
    'ok', true,
    'application_id', v_si.application_id,
    'interview_name', v_si.name,
    'job_title', v_si.job_title,
    'candidate_name', v_si.candidate_name,
    'members', v_members,
    'claimed_at', case when p_claim then v_now end
  );
end $$;
revoke all on function public.interviewer_reminders(uuid, boolean) from public, anon;
grant execute on function public.interviewer_reminders(uuid, boolean) to authenticated, service_role;

-- Undoes one member's claim when their email failed, so they can be reminded again.
create or replace function public.release_interviewer_reminder(
  p_interview_id uuid,
  p_user_id uuid,
  p_claimed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hit integer;
begin
  update public.scheduled_interview_panel set reminded_at = null
   where interview_id = p_interview_id and user_id = p_user_id and reminded_at = p_claimed_at;
  get diagnostics v_hit = row_count;
  return v_hit = 1;
end $$;
revoke all on function public.release_interviewer_reminder(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.release_interviewer_reminder(uuid, uuid, timestamptz) to service_role;
