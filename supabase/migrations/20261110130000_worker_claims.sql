-- SM-REQ-003 (plan/state-machines/feature-state-machines-spec.md, SMT-012):
-- a worker claims its row when it moves it into `processing`, by setting
-- claimed_at to the time it read the message, and its final write filters on
-- `processing` and that same claimed_at (helpers/db/transition.ts). A row
-- re-queued and claimed again while the first run was going then refuses the
-- first run's result. A `processing` row whose claim is older than the
-- worker's visibility timeout is a dead run, and the next delivery may claim
-- it again.
--
-- job_relevant_profiles had no running state: a row stayed `queued` while the
-- explanations worker ran (SM-ISS-003). It gets `processing`, which every
-- reader already treats as "not ready", since they show an explanation only
-- when it's `completed`. claimed_at on that table is the explanation's claim.
--
-- The live constraints were read on 2026-11-10 before writing this, and
-- matched the migrations (tasks file, Differences).

alter table public.interview_analyses add column if not exists claimed_at timestamptz;
alter table public.application_screenings add column if not exists claimed_at timestamptz;
alter table public.job_relevant_profiles add column if not exists claimed_at timestamptz;

comment on column public.interview_analyses.claimed_at is
  'The running worker''s claim (SM-REQ-003): set with processing, checked by the final write.';
comment on column public.application_screenings.claimed_at is
  'The running worker''s claim (SM-REQ-003): set with processing, checked by the final write.';
comment on column public.job_relevant_profiles.claimed_at is
  'The explanations worker''s claim (SM-REQ-003): set with explanation_status = processing, checked by the final write.';

alter table public.job_relevant_profiles drop constraint if exists job_relevant_profiles_explanation_status_check;
alter table public.job_relevant_profiles add constraint job_relevant_profiles_explanation_status_check
  check (explanation_status in ('none', 'queued', 'processing', 'completed', 'failed', 'stale', 'skipped_quota'));
