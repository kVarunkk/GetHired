-- Recruiter outreach (OR-SEC-001): a company can't unlock a candidate's
-- contact details by creating an application for them.
--
-- "Company user can create Application" let a company insert an application
-- for any user to one of its jobs (SelectProfile on the profile page). An
-- application is what company_has_candidate_access counts as "applied", so
-- that would open user_info, resumes and the resume file of any talent-pool
-- candidate. A company may now add a candidate to one of its jobs only when it
-- already has access (they applied to another of its jobs, or answered
-- Interested to its outreach).

drop policy if exists "Company user can create Application" on public.applications;
create policy "Company user can create Application"
  on public.applications for insert to authenticated
  with check (
    exists (
      select 1
      from public.job_postings
      join public.company_info on job_postings.company_id = company_info.id
      where job_postings.id = applications.job_post_id
        and company_info.user_id = (select auth.uid())
    )
    and public.company_has_candidate_access(applications.applicant_user_id)
  );
