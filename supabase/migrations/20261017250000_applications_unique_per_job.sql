-- One application per applicant per job. Until now only submitApplicationAction
-- checked this (select-then-insert), so a double submit, two tabs, or the
-- browser insert paths (tracked external jobs, the deployed client) could add
-- a second row.

-- Fail with a readable message instead of a bare index error if duplicates exist.
do $$
begin
  if exists (
    select 1 from public.applications
    where applicant_user_id is not null and all_jobs_id is not null
    group by applicant_user_id, all_jobs_id having count(*) > 1
  ) or exists (
    select 1 from public.applications
    where applicant_user_id is not null and job_post_id is not null
    group by applicant_user_id, job_post_id having count(*) > 1
  ) then
    raise exception 'applications has duplicate (applicant, job) rows; resolve them before adding the unique indexes';
  end if;
end $$;

-- Covers platform and tracked external jobs (both set all_jobs_id).
create unique index if not exists applications_applicant_all_jobs_key
  on public.applications (applicant_user_id, all_jobs_id)
  where applicant_user_id is not null and all_jobs_id is not null;

-- Platform jobs, which keep job_post_id even if the all_jobs row goes (SET NULL).
create unique index if not exists applications_applicant_job_post_key
  on public.applications (applicant_user_id, job_post_id)
  where applicant_user_id is not null and job_post_id is not null;

-- The unique index above serves the same lookups.
drop index if exists public.idx_applications_composite;
