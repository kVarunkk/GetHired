-- Recruiter outreach, part 4 (OR-TASK-030, ORT-062): shared signals.
-- An applicant attaches one completed mock interview session and/or one
-- completed resume review to an application. An attached session gets a
-- company-perspective analysis through the existing interview_analysis_queue.
-- Companies read only that analysis, never the transcript or the candidate's
-- own analysis (OR-SEC-005).
-- Tests: supabase/tests/recruiter_outreach.sql, block 4.

create table if not exists public.application_attachments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  kind text not null check (kind in ('interview_session', 'resume_review')),
  interview_session_id uuid references public.interview_sessions(id) on delete cascade,
  resume_review_id uuid references public.resume_reviews(id) on delete cascade,
  first_viewed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((kind = 'interview_session') = (interview_session_id is not null)),
  check ((kind = 'resume_review') = (resume_review_id is not null)),
  unique (application_id, kind)
);
create index if not exists application_attachments_session_idx
  on public.application_attachments (interview_session_id) where interview_session_id is not null;
create index if not exists application_attachments_review_idx
  on public.application_attachments (resume_review_id) where resume_review_id is not null;

-- Ownership across tables, which a check constraint can't do: the
-- application, the session or the review must all be the applicant's, and
-- the session or review completed.
create or replace function public.check_application_attachment()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_applicant uuid;
begin
  select a.applicant_user_id into v_applicant from public.applications a where a.id = new.application_id;
  if v_applicant is null then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  if current_role = 'authenticated' and v_applicant is distinct from auth.uid() then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;

  if new.kind = 'interview_session' and not exists (
    select 1 from public.interview_sessions s
    join public.interviews i on i.id = s.interview_id
    where s.id = new.interview_session_id and i.user_id = v_applicant and s.status = 'completed'
  ) then
    raise exception using errcode = 'P0001', message = 'SESSION_NOT_FOUND';
  end if;

  if new.kind = 'resume_review' and not exists (
    select 1 from public.resume_reviews r
    where r.id = new.resume_review_id and r.user_id = v_applicant and r.status = 'completed'
  ) then
    raise exception using errcode = 'P0001', message = 'REVIEW_NOT_FOUND';
  end if;

  new.first_viewed_at := null;
  return new;
end $$;

revoke all on function public.check_application_attachment() from public, anon, authenticated;

drop trigger if exists application_attachments_check on public.application_attachments;
create trigger application_attachments_check
  before insert on public.application_attachments
  for each row execute function public.check_application_attachment();

alter table public.application_attachments enable row level security;
revoke all on public.application_attachments from anon;
revoke update on public.application_attachments from authenticated;
grant select, insert, delete on public.application_attachments to authenticated;

drop policy if exists "application_attachments_applicant_select" on public.application_attachments;
create policy "application_attachments_applicant_select" on public.application_attachments
  for select to authenticated using (
    exists (select 1 from public.applications a
            where a.id = application_id and a.applicant_user_id = (select auth.uid()))
  );

drop policy if exists "application_attachments_applicant_insert" on public.application_attachments;
create policy "application_attachments_applicant_insert" on public.application_attachments
  for insert to authenticated with check (
    exists (select 1 from public.applications a
            where a.id = application_id and a.applicant_user_id = (select auth.uid()))
  );

-- Revocable until the company opens it (OR-REQ-030).
drop policy if exists "application_attachments_applicant_delete" on public.application_attachments;
create policy "application_attachments_applicant_delete" on public.application_attachments
  for delete to authenticated using (
    first_viewed_at is null
    and exists (select 1 from public.applications a
                where a.id = application_id and a.applicant_user_id = (select auth.uid()))
  );

drop policy if exists "application_attachments_company_select" on public.application_attachments;
create policy "application_attachments_company_select" on public.application_attachments
  for select to authenticated using (
    exists (select 1 from public.applications a
            join public.job_postings jp on jp.id = a.job_post_id
            where a.id = application_id and jp.company_id = (select public.my_company_id()))
  );

-- interview_analyses: the candidate reads only their own (candidate) analysis,
-- never the company report about them. Every existing row is 'candidate'.
drop policy if exists "Candidates can read their interview analyses" on public.interview_analyses;
create policy "Candidates can read their interview analyses"
  on public.interview_analyses for select to authenticated
  using (
    perspective = 'candidate'
    and exists (
      select 1 from public.interview_sessions s
      join public.interviews i on i.id = s.interview_id
      where s.id = interview_analyses.interview_session_id and i.user_id = (select auth.uid())
    )
  );

-- Companies: the company analysis of a session attached to one of their applications.
drop policy if exists "Companies can read shared interview analyses" on public.interview_analyses;
create policy "Companies can read shared interview analyses"
  on public.interview_analyses for select to authenticated
  using (
    perspective = 'company'
    and exists (
      select 1 from public.application_attachments aa
      join public.applications a on a.id = aa.application_id
      join public.job_postings jp on jp.id = a.job_post_id
      where aa.interview_session_id = interview_analyses.interview_session_id
        and jp.company_id = (select public.my_company_id())
    )
  );

-- Inserts the company analysis for one of the caller's attached, completed
-- sessions and queues it, once per session (mirrors
-- finalize_interview_analysis_session). Returns { analysis_id, queued }.
create or replace function public.enqueue_company_interview_analysis(p_session uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  if not exists (
    select 1 from public.interview_sessions s
    join public.interviews i on i.id = s.interview_id
    join public.application_attachments aa on aa.interview_session_id = s.id
    join public.applications a on a.id = aa.application_id
    where s.id = p_session and i.user_id = auth.uid() and s.status = 'completed'
      and a.applicant_user_id = auth.uid()
  ) then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;

  insert into public.interview_analyses (interview_session_id, perspective, status)
  values (p_session, 'company', 'queued')
  on conflict (interview_session_id, perspective) do nothing
  returning id into v_id;

  if v_id is not null then
    perform pgmq.send('interview_analysis_queue', jsonb_build_object('analysisId', v_id));
    return jsonb_build_object('analysis_id', v_id, 'queued', true);
  end if;

  select a.id into v_id from public.interview_analyses a
   where a.interview_session_id = p_session and a.perspective = 'company';
  return jsonb_build_object('analysis_id', v_id, 'queued', false);
end $$;

revoke all on function public.enqueue_company_interview_analysis(uuid) from public, anon;
grant execute on function public.enqueue_company_interview_analysis(uuid) to authenticated;
