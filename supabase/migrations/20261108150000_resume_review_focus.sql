-- What the user asked a resume review to aim for, in their words (such as
-- "Tailor for AI engineer roles"), when it isn't a job. The chat's changes
-- card shows it with the job (job_id) or the pasted description (target_jd),
-- so the user can see what the resume was tailored for.
alter table public.resume_reviews add column if not exists focus text;
