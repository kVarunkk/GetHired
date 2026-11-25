-- Applicants can take a screening interview off their dashboard, and the
-- dashboard says when an alternative format was requested.
--
-- applicant_dismissed_at is compared with updated_at, which every status
-- change sets: an interview the applicant dismissed comes back when the
-- company acts on it (extends, waives, resumes or cancels it). Dismissing
-- leaves updated_at alone.

alter table public.application_interviews
  add column if not exists applicant_dismissed_at timestamptz;

-- The return type changes, so the function is dropped first.
drop function if exists public.my_screening_interviews();

create function public.my_screening_interviews()
returns table (
  id uuid, application_id uuid, job_post_id uuid, interview_id uuid, status text,
  deadline_at timestamptz, max_attempts smallint, attempts_used smallint,
  consented_at timestamptz, consent_version text, completed_at timestamptz, created_at timestamptz,
  company_name text, job_title text, duration_minutes int, competency_names text[],
  paused_at timestamptz, dismissed boolean
)
language sql stable security definer
set search_path = ''
as $$
  select ai.id, ai.application_id, ai.job_post_id, ai.interview_id, ai.status,
         ai.deadline_at, ai.max_attempts, ai.attempts_used,
         ai.consented_at, ai.consent_version, ai.completed_at, ai.created_at,
         ai.config_snapshot ->> 'company_name', ai.config_snapshot ->> 'job_title',
         (ai.config_snapshot ->> 'duration_minutes')::int,
         array(select c ->> 'name' from jsonb_array_elements(ai.config_snapshot -> 'competencies') c),
         ai.paused_at,
         coalesce(ai.applicant_dismissed_at >= ai.updated_at, false)
    from public.application_interviews ai
   where ai.applicant_user_id = (select auth.uid())
$$;

-- Only interviews waiting on the company or already submitted can be
-- dismissed: one the applicant still has to take stays on the dashboard.
create or replace function public.dismiss_my_screening_interview(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.application_interviews%rowtype;
begin
  v_row := public.lock_my_screening_interview(p_id);
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_row.status not in ('paused', 'completed') then
    return jsonb_build_object('ok', false, 'reason', 'not_dismissable');
  end if;
  update public.application_interviews set applicant_dismissed_at = now() where id = v_row.id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.my_screening_interviews() from public, anon;
grant execute on function public.my_screening_interviews() to authenticated, service_role;
revoke all on function public.dismiss_my_screening_interview(uuid) from public, anon;
grant execute on function public.dismiss_my_screening_interview(uuid) to authenticated, service_role;
