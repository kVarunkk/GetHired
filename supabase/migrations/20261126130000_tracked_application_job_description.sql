-- Application tracker: an optional job description on a card.
--
-- Additive and nullable, so it is safe to push BEFORE the app that writes it
-- is deployed (the deployed code never selects or sets it). Only cards for
-- jobs that are not on GetHired use it; a GetHired job keeps its description
-- in all_jobs. The cap matches TRACKER_LIMITS.description.

alter table public.tracked_applications
  add column if not exists job_description text
  check (job_description is null or char_length(job_description) <= 10000);
