-- TM-SEC-007 (recruiter teams, phase 0): only the service role creates
-- companies.
--
-- "Users can create their own company" (20261014120000_recruiter_access) let
-- any signed-in user, applicants included, insert a company_info row for
-- themselves. my_company_id() would then return it, and
-- company_can_view_candidate would give that user company-level read access to
-- every public candidate. Company sign-up (app/actions/sign-up-email.tsx)
-- inserts the row with the service role, and CompanyOnboardingForm now updates
-- it instead of upserting, so no user-facing insert policy is needed.

drop policy if exists "Users can create their own company" on public.company_info;
