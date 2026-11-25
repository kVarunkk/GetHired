-- Dashboard: the job seeker's weekly application goal, stored per account
-- instead of in the browser's localStorage (which was lost across devices
-- and browsers).
--
-- Nullable with no default: null means "no goal set", so the dashboard can
-- invite the user to pick one instead of showing a target they never chose.
-- The 1..100 range matches MAX_GOAL in components/dashboard/PipelineCard.tsx.
--
-- Additive, so it is safe to push BEFORE the app that reads it is deployed.
-- Existing RLS on user_info ("user can update their record") already lets
-- the owner set it; no new policy or grant is needed.

alter table public.user_info
  add column if not exists weekly_application_goal smallint
  check (weekly_application_goal is null or weekly_application_goal between 1 and 100);

comment on column public.user_info.weekly_application_goal is
  'Applications per 7 days the job seeker aims for; null = not set.';
