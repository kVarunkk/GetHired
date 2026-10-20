-- Companies no longer create applications for candidates. The profile page's
-- "Add to job" (SelectProfile) is gone: invite-to-apply outreach replaces it,
-- and the candidate applies themselves. Applications are inserted only by the
-- applicant ("User can create Application"), so company members lose insert.

drop policy if exists "Company user can create Application" on public.applications;
