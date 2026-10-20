-- Browser write guards (plan/browser-writes/feature-browser-writes-spec.md).
--
-- The app no longer writes from the browser, but a user can still call the
-- REST API with their session token, as the same `authenticated` role the
-- server actions use. These guards make such calls harmless.
--
-- 1. user_info (BW-F01): `authenticated` can't change email (except to the
--    session's own), invitations_count, referral_code or the match vector.
-- 2. applications (BW-F02, BW-F05, BW-F08): applicants insert and delete only
--    external rows (job_post_id null); platform applications are inserted by
--    submitApplicationAction with the service role. After submitting, the
--    applicant can't rewrite answers, the form snapshot or the resume.
-- 3. invitations (BW-F04): read and mark-as-shown only.
-- 4. interviews (BW-F06): charged_session_ids belongs to the charge RPC.
-- 5. bookmarks (BW-F07): at most 5 active job alerts per user.
--
-- ORDER: push only after the code from this change is deployed. Until then
-- the deployed submitApplicationAction and sendInviteEmail write as the user
-- and would fail on 2 and 3.

-- ---------------------------------------------------------------------------
-- 1. user_info
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER on purpose: current_role must be the caller's. The service
-- role and SECURITY DEFINER functions (owner postgres) pass through.
create or replace function public.protect_user_info_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session_email text := lower(auth.jwt() ->> 'email');
begin
  if current_role <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.invitations_count := 0;
    new.referral_code := gen_random_uuid()::text;
    new.embedding_new := null;
    new.embedding_updated_at := null;
    new.matched_at := null;
    if v_session_email is not null then
      new.email := v_session_email;
    end if;
    return new;
  end if;

  -- The account's own (verified) email, or nothing new.
  if new.email is distinct from old.email
     and (v_session_email is null or lower(new.email) <> v_session_email) then
    new.email := old.email;
  end if;
  new.invitations_count := old.invitations_count;
  new.referral_code := old.referral_code;
  new.embedding_new := old.embedding_new;
  new.embedding_updated_at := old.embedding_updated_at;
  new.matched_at := old.matched_at;
  return new;
end;
$$;

drop trigger if exists user_info_protect_columns on public.user_info;
create trigger user_info_protect_columns
  before insert or update on public.user_info
  for each row execute function public.protect_user_info_columns();

-- ---------------------------------------------------------------------------
-- 2. applications
-- ---------------------------------------------------------------------------

drop policy if exists "Job seeker can create their own application" on public.applications;
create policy "Job seeker can create their own application"
  on public.applications for insert to authenticated
  with check ((select auth.uid()) = applicant_user_id and job_post_id is null);

drop policy if exists "Job seeker can delete their external application" on public.applications;
create policy "Job seeker can delete their external application"
  on public.applications for delete to authenticated
  using ((select auth.uid()) = applicant_user_id and job_post_id is null);

-- Runs beside applications_protect_pipeline_columns, which already locks the
-- status, stage, source and job.
create or replace function public.protect_application_submission_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_company uuid;
begin
  if current_role <> 'authenticated' or old.job_post_id is null then
    return new;
  end if;

  select jp.company_id into v_company from public.job_postings jp where jp.id = old.job_post_id;
  if v_company is not null and public.is_company_member(v_company) then
    return new;
  end if;

  if new.answers is distinct from old.answers
     or new.answers_v2 is distinct from old.answers_v2
     or new.form_snapshot is distinct from old.form_snapshot
     or new.resume_id is distinct from old.resume_id
     or new.resume_path is distinct from old.resume_path
     or new.resume_url is distinct from old.resume_url
     or new.all_jobs_id is distinct from old.all_jobs_id
     or new.applicant_user_id is distinct from old.applicant_user_id
     or new.source_detail is distinct from old.source_detail
     or new.created_at is distinct from old.created_at then
    raise exception 'A submitted application can''t be changed.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists applications_protect_submission_columns on public.applications;
create trigger applications_protect_submission_columns
  before update on public.applications
  for each row execute function public.protect_application_submission_columns();

-- ---------------------------------------------------------------------------
-- 3. invitations
-- ---------------------------------------------------------------------------

-- Was FOR ALL: users could insert, edit and delete their invitations. The
-- invite action and the referral grant use the service role.
drop policy if exists "Enable users to interact with their own data only" on public.invitations;

drop policy if exists "invitations_select_own" on public.invitations;
create policy "invitations_select_own"
  on public.invitations for select to authenticated
  using ((select auth.uid()) = referrer_user_id);

drop policy if exists "invitations_update_own" on public.invitations;
create policy "invitations_update_own"
  on public.invitations for update to authenticated
  using ((select auth.uid()) = referrer_user_id)
  with check ((select auth.uid()) = referrer_user_id);

-- The one thing a user changes: that they saw the "invite accepted" dialog.
create or replace function public.protect_invitation_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_role = 'authenticated' then
    new := jsonb_populate_record(old, jsonb_build_object('isDialogShown', new."isDialogShown"));
  end if;
  return new;
end;
$$;

drop trigger if exists invitations_protect_columns on public.invitations;
create trigger invitations_protect_columns
  before update on public.invitations
  for each row execute function public.protect_invitation_columns();

-- ---------------------------------------------------------------------------
-- 4. interviews
-- ---------------------------------------------------------------------------

create or replace function public.protect_interview_charge_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_role = 'authenticated' then
    if tg_op = 'INSERT' then
      new.charged_session_ids := '{}';
    else
      new.charged_session_ids := old.charged_session_ids;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists interviews_protect_charge_columns on public.interviews;
create trigger interviews_protect_charge_columns
  before insert or update on public.interviews
  for each row execute function public.protect_interview_charge_columns();

-- ---------------------------------------------------------------------------
-- 5. bookmarks
-- ---------------------------------------------------------------------------

-- MAX_BOOKMARK_ALERTS in helpers/bookmarks/limits.ts.
create or replace function public.bookmarks_alert_cap()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.is_alert_on
     and (tg_op = 'INSERT' or not old.is_alert_on)
     and (select count(*) from public.bookmarks b
           where b.user_id = new.user_id and b.is_alert_on and b.id <> new.id) >= 5 then
    raise exception 'You can only create a maximum of 5 Alerts.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists bookmarks_alert_cap on public.bookmarks;
create trigger bookmarks_alert_cap
  before insert or update of is_alert_on on public.bookmarks
  for each row execute function public.bookmarks_alert_cap();
