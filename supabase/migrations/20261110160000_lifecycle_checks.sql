-- Lifecycle check constraints (plan/state-machines, SMT-050, SM-REQ-008).
--
-- Live constraints read on 2026-11-10:
--   application_screenings_status_check  queued, processing, completed, failed,
--                                        stale, skipped_quota, insufficient_info
--   interview_analyses_status_check      queued, processing, completed, failed
--                                        (live, but no migration in the repo adds it)
--   resume_reviews.status                no constraint, nullable text
--
-- So this migration adds the resume_reviews check, and adds the
-- interview_analyses one only where it's missing (a fresh local database),
-- so the repo describes the live schema.

-- resume_reviews: improveResume only writes 'completed' now. The deployed
-- applicant code's old review flow still writes 'draft', 'processing' and
-- 'failed', so all four stay in the list until that code is gone. The column
-- stays nullable (old fixtures insert without a status); reviewStatus() reads
-- a null as 'completed', and the backfill below makes the stored rows agree.
update public.resume_reviews
   set status = case when analysis_failed then 'failed' else 'completed' end
 where status is null;

alter table public.resume_reviews
  drop constraint if exists resume_reviews_status_check;
alter table public.resume_reviews
  add constraint resume_reviews_status_check
  check (status in ('draft', 'processing', 'completed', 'failed'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.interview_analyses'::regclass
       and conname = 'interview_analyses_status_check'
  ) then
    alter table public.interview_analyses
      add constraint interview_analyses_status_check
      check (status in ('queued', 'processing', 'completed', 'failed'));
  end if;
end $$;
