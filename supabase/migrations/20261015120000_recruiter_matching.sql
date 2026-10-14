-- Recruiter matching and screening (plan/feature-recruiter-matching-spec.md).
-- Part 1 (§3.1, MTT-014): match scores and explanations on job_relevant_profiles.

-- unique_job_user_pair (job_posting_id, user_id) already exists live with no
-- duplicates (MTT-000); recreate it only if this database lacks it.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.job_relevant_profiles'::regclass
       and conname = 'unique_job_user_pair'
  ) then
    delete from public.job_relevant_profiles a
     using public.job_relevant_profiles b
     where a.job_posting_id = b.job_posting_id
       and a.user_id = b.user_id
       and (a.created_at, a.id) < (b.created_at, b.id);
    alter table public.job_relevant_profiles
      add constraint unique_job_user_pair unique (job_posting_id, user_id);
  end if;
end $$;

alter table public.job_relevant_profiles
  add column if not exists match_score smallint
    check (match_score between 0 and 100),
  add column if not exists skills_score numeric(3,2)
    check (skills_score between 0 and 4),          -- jev 0..4
  add column if not exists experience_score numeric(3,2)
    check (experience_score between 0 and 4),      -- jev 0..4
  add column if not exists preference_conflict numeric(3,2)
    check (preference_conflict between 0 and 1),   -- probability 0..1
  add column if not exists explanation jsonb,      -- MT-REQ-002 shape
  add column if not exists explanation_status text not null default 'none'
    check (explanation_status in ('none','queued','completed','failed','stale','skipped_quota')),
  add column if not exists explanation_error text, -- safe error code (MT-SEC-005)
  add column if not exists explained_at timestamptz;

-- The digest now writes these rows with the service role (MTT-016), so
-- company users no longer insert or delete them. Leaving INSERT open would let
-- a company add a row for any candidate, which the explain route treats as
-- permission to read that candidate. There is no UPDATE policy, so scores and
-- explanations are service-role only. SELECT stays as it is.
drop policy if exists "company users can insert records of their job postings"
  on public.job_relevant_profiles;
drop policy if exists "company users can delete their own job posting relevant matches"
  on public.job_relevant_profiles;
