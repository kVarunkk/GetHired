-- Recruiter access control (plan/recruiter-security/feature-recruiter-security-spec.md, RS-TASK-011).
--
-- 1. Access helpers: my_company_id, is_company_member, company_can_view_candidate.
-- 2. Companies read user_info, resumes and resume files only for candidates who
--    are public or applied to one of their postings (RS-SEC-003).
-- 3. company_info: no anonymous/foreign inserts; billing columns can't be
--    changed by the company itself (RS-SEC-006). Replaces the live
--    protect_company_info_columns guard, which never fired: it was SECURITY
--    DEFINER, so current_role inside it was always the owner.
-- 4. deduct_user_credits only deducts (never adds) from the caller's own account unless
--    called with the service role (RS-SEC-007).
-- 5. An index for the "applied to this company" lookup.
--
-- Not included: a company DELETE policy on all_jobs. Postings are deleted
-- server-side by deleteJobPostingAction with the service role.

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------

-- The company the current user acts for. The teams spec later extends this to members.
create or replace function public.my_company_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select ci.id from public.company_info ci where ci.user_id = (select auth.uid()) limit 1
$$;

create or replace function public.is_company_member(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.company_info ci
    where ci.id = p_company_id and ci.user_id = (select auth.uid())
  )
$$;

-- RS-SEC-003: a public candidate, or one who applied to the caller's company's jobs.
create or replace function public.company_can_view_candidate(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.my_company_id() is not null and (
    exists (select 1 from public.user_info u where u.user_id = p_user_id and u.is_public)
    or exists (
      select 1 from public.applications a
      join public.job_postings jp on jp.id = a.job_post_id
      where a.applicant_user_id = p_user_id and jp.company_id = public.my_company_id()
    )
  )
$$;

revoke all on function public.my_company_id() from public, anon;
revoke all on function public.is_company_member(uuid) from public, anon;
revoke all on function public.company_can_view_candidate(uuid) from public, anon;
grant execute on function public.my_company_id() to authenticated, service_role;
grant execute on function public.is_company_member(uuid) to authenticated, service_role;
grant execute on function public.company_can_view_candidate(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Candidate visibility
-- ---------------------------------------------------------------------------

drop policy if exists "Allow companies to view applicant info" on public.user_info;
create policy "Companies can view visible candidates"
  on public.user_info for select to authenticated
  using (public.company_can_view_candidate(user_id));

drop policy if exists "company user select all" on public.resumes;
create policy "Companies can view visible candidates' resumes"
  on public.resumes for select to authenticated
  using (public.company_can_view_candidate(user_id));

-- Paths are resumes/<user_id>/<file>. CASE keeps a malformed folder name from
-- failing the cast (and the whole query).
drop policy if exists "Allow company users to access all resumes" on storage.objects;
create policy "Companies can view visible candidates' resume files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'resumes'
    and case
      when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.company_can_view_candidate(((storage.foldername(name))[2])::uuid)
      else false
    end
  );

-- ---------------------------------------------------------------------------
-- 3. company_info inserts and billing columns
-- ---------------------------------------------------------------------------

drop policy if exists "Insert access to public role" on public.company_info;
create policy "Users can create their own company"
  on public.company_info for insert to authenticated
  with check (user_id = (select auth.uid()));

-- SECURITY INVOKER on purpose: current_role must be the caller's role. Requests
-- from users run as `authenticated`; the service role and SECURITY DEFINER RPCs
-- (owner `postgres`) pass through untouched.
create or replace function public.protect_company_info_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_role = 'authenticated' then
    if tg_op = 'INSERT' then
      -- The column defaults: new companies start on the free tier.
      new.tier_id := (select t.id from public.company_tiers t where t.name = 'free');
      new.ai_credits := 50;
      new.job_posts_created := 0;
      new.ai_search_uses := 0;
    else
      new.tier_id := old.tier_id;
      new.ai_credits := old.ai_credits;
      new.job_posts_created := old.job_posts_created;
      new.ai_search_uses := old.ai_search_uses;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_company_info_column_protection on public.company_info;
create trigger enforce_company_info_column_protection
  before insert or update on public.company_info
  for each row execute function public.protect_company_info_columns();

-- ---------------------------------------------------------------------------
-- 4. deduct_user_credits: only your own credits, unless service role
-- ---------------------------------------------------------------------------

create or replace function public.deduct_user_credits(p_user_id uuid, p_amount integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and p_user_id is distinct from auth.uid() then
    raise exception 'Not allowed to deduct credits for another user';
  end if;

  -- A negative amount would add credits.
  if p_amount is null or p_amount < 0 then
    raise exception 'Invalid credit amount';
  end if;

  update public.user_info
     set ai_credits = ai_credits - p_amount,
         updated_at = now()
   where user_id = p_user_id
     and ai_credits >= p_amount;

  if not found then
    raise exception 'Insufficient credits or user not found';
  end if;
end;
$$;

revoke all on function public.deduct_user_credits(uuid, integer) from public, anon;
grant execute on function public.deduct_user_credits(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Index for company_can_view_candidate's "applied" branch (RS-RISK-002)
-- ---------------------------------------------------------------------------

create index if not exists idx_applications_applicant_job_post
  on public.applications (applicant_user_id, job_post_id);
