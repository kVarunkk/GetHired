-- Faster user_info read policies, same rules (RS-RISK-002).
--
-- 20261014120000_recruiter_access called company_can_view_candidate(user_id)
-- once per row, so the /company/profiles listing ran the company lookup and a
-- second user_info query for every row (~494 ms over ~7.2k rows). Same rule
-- (RS-SEC-003), written so Postgres can evaluate it cheaply:
--   * public profiles: a column check plus one company lookup per query;
--   * private profiles: only when they applied to one of the company's jobs.
--
-- Keep these in sync with public.company_can_view_candidate, which the resumes
-- and storage policies and the profile page still use.
-- supabase/tests/recruiter_access.sql checks both.

drop policy if exists "Companies can view visible candidates" on public.user_info;

create policy "Companies can view public candidates"
  on public.user_info for select to authenticated
  using (is_public and (select public.my_company_id()) is not null);

create policy "Companies can view their applicants"
  on public.user_info for select to authenticated
  using (
    exists (
      select 1
      from public.applications a
      join public.job_postings jp on jp.id = a.job_post_id
      where a.applicant_user_id = user_info.user_id
        and jp.company_id = (select public.my_company_id())
    )
  );

-- The applicants' own-row policy called auth.uid() once per row (it re-parses the
-- JWT claims each time), which was most of the remaining cost. Same rule,
-- evaluated once per query.
drop policy if exists "Users can read their own user_info" on public.user_info;
create policy "Users can read their own user_info"
  on public.user_info for select to authenticated
  using ((select auth.uid()) = user_id);
