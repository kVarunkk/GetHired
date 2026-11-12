-- Named states for lifecycles stored as timestamps (plan/state-machines,
-- SMT-054/055, SM-REQ-010, SM-ISS-014).
--
-- Each function takes the table's row, so PostgREST exposes it as a computed
-- field: code filters with `.eq("company_invite_state", "pending")` instead of
-- repeating the timestamp conditions (most often forgetting expires_at). They
-- read now(), so they can't be generated columns. Invoker rights: the caller's
-- RLS on the table still decides which rows it sees.
--
-- Company side only, plus mcp_confirmations (only /api/mcp uses it), so
-- nothing deployed for applicants changes.

-- ---------------------------------------------------------------------------
-- 1. company_invites: pending | accepted | revoked | expired
-- ---------------------------------------------------------------------------
-- "Usable" (accepting, the join page) is 'pending'. "Open" (resend, revoke,
-- the team list) is 'pending' or 'expired': an expired invite can be resent.
create or replace function public.company_invite_state(i public.company_invites)
returns text
language sql stable
set search_path = ''
as $$
  select case
    when i.accepted_at is not null then 'accepted'
    when i.revoked_at is not null then 'revoked'
    when i.expires_at <= now() then 'expired'
    else 'pending'
  end
$$;

-- ---------------------------------------------------------------------------
-- 2. mcp_confirmations and company_candidate_claims: unused | used | expired
-- ---------------------------------------------------------------------------
-- A used row stays 'used' after it expires: the use is what happened.
create or replace function public.mcp_confirmation_state(c public.mcp_confirmations)
returns text
language sql stable
set search_path = ''
as $$
  select case
    when c.used_at is not null then 'used'
    when c.expires_at <= now() then 'expired'
    else 'unused'
  end
$$;

create or replace function public.company_candidate_claim_state(c public.company_candidate_claims)
returns text
language sql stable
set search_path = ''
as $$
  select case
    when c.used_at is not null then 'used'
    when c.expires_at <= now() then 'expired'
    else 'unused'
  end
$$;

-- ---------------------------------------------------------------------------
-- 3. application_knockouts: none | scheduled | due | sent | cancelled
-- ---------------------------------------------------------------------------
-- The worker used to cancel by nulling reject_email_due_at, which read the
-- same as "never due". A cancel now has its own timestamp. Existing rows with
-- a null due date and no send stay 'none': which of them were cancelled isn't
-- recorded.
alter table public.application_knockouts
  add column if not exists reject_email_cancelled_at timestamptz;

create or replace function public.application_knockout_state(k public.application_knockouts)
returns text
language sql stable
set search_path = ''
as $$
  select case
    when k.reject_email_sent_at is not null then 'sent'
    when k.reject_email_cancelled_at is not null then 'cancelled'
    when k.reject_email_due_at is null then 'none'
    when k.reject_email_due_at <= now() then 'due'
    else 'scheduled'
  end
$$;

-- ---------------------------------------------------------------------------
-- 4. The claim RPCs read the named state.
-- ---------------------------------------------------------------------------
-- claim_mcp_confirmation: unchanged except that a row both used and expired
-- now answers 'used' (it was 'expired'); both refuse.
create or replace function public.claim_mcp_confirmation(p_code text, p_digest text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_row public.mcp_confirmations;
  v_state text;
begin
  select * into found_row
  from public.mcp_confirmations
  where code = p_code and user_id = (select auth.uid())
  for update;

  if not found then
    return 'invalid';
  end if;
  v_state := public.mcp_confirmation_state(found_row);
  if v_state = 'expired' then
    return 'expired';
  end if;
  if found_row.digest is distinct from p_digest then
    return 'mismatch';
  end if;
  if v_state = 'used' then
    return 'used';
  end if;

  update public.mcp_confirmations set used_at = now() where jti = found_row.jti;
  return 'claimed';
end;
$$;

revoke all on function public.claim_mcp_confirmation(text, text) from public, anon;
grant execute on function public.claim_mcp_confirmation(text, text) to authenticated;

-- claim_company_candidate: the body of 20261025140000_bulk_import_claims.sql
-- with its used/expired checks read through company_candidate_claim_state.
create or replace function public.claim_company_candidate(p_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_claim public.company_candidate_claims%rowtype;
  v_candidate public.company_candidates%rowtype;
  v_app public.applications%rowtype;
  v_direct uuid;
  v_landing uuid;
  v_merged_landing uuid;
  v_target uuid;
  v_job public.job_postings%rowtype;
  v_row public.application_interviews%rowtype;
  v_state text;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  if p_token is null or length(p_token) not between 20 and 200 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into v_claim from public.company_candidate_claims
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
   for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;

  -- A second click by the same account lands on the same interview.
  v_state := public.company_candidate_claim_state(v_claim);
  if v_state = 'used' and v_claim.used_by is distinct from v_user then
    return jsonb_build_object('ok', false, 'reason', 'used');
  end if;
  if v_state = 'expired' then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if exists (select 1 from public.company_members where user_id = v_user)
     or exists (select 1 from public.company_info where user_id = v_user) then
    return jsonb_build_object('ok', false, 'reason', 'company_account');
  end if;
  if not exists (select 1 from public.user_info where user_id = v_user) then
    return jsonb_build_object('ok', false, 'reason', 'no_profile');
  end if;

  select * into v_candidate from public.company_candidates where id = v_claim.candidate_id for update;
  if v_candidate.claimed_user_id is not null and v_candidate.claimed_user_id <> v_user then
    return jsonb_build_object('ok', false, 'reason', 'used');
  end if;

  if v_candidate.claimed_user_id is null then
    update public.company_candidates set claimed_user_id = v_user, claimed_at = now(), updated_at = now()
     where id = v_candidate.id;
  end if;

  for v_app in
    select * from public.applications
     where company_candidate_id = v_candidate.id and applicant_user_id is null and merged_into_application_id is null
     for update
  loop
    select id into v_direct from public.applications
     where applicant_user_id = v_user and job_post_id = v_app.job_post_id and id <> v_app.id
     limit 1;

    if v_direct is not null then
      v_merged_landing := public.merge_imported_application(v_app.id, v_direct);
      if v_claim.application_interview_id in (select id from public.application_interviews where application_id = v_app.id) then
        v_landing := v_merged_landing;
      end if;
      continue;
    end if;

    update public.applications set applicant_user_id = v_user, updated_at = now() where id = v_app.id;

    select * into v_job from public.job_postings where id = v_app.job_post_id;
    for v_row in
      update public.application_interviews set applicant_user_id = v_user, updated_at = now()
       where application_id = v_app.id and applicant_user_id is null
      returning *
    loop
      if v_row.interview_id is null then
        v_target := gen_random_uuid();
        insert into public.interviews (id, user_id, job_id, resume_id, name, kind, application_interview_id)
        values (v_target, v_user, v_job.job_id, null, v_job.title, 'screening', v_row.id);
        update public.application_interviews set interview_id = v_target where id = v_row.id;
      end if;
      if v_row.id = v_claim.application_interview_id then v_landing := v_row.id; end if;
    end loop;

    insert into public.application_events (company_id, application_id, candidate_user_id, type, payload)
    values (v_candidate.company_id, v_app.id, v_user, 'claimed', jsonb_build_object('company_candidate_id', v_candidate.id));
  end loop;

  -- Already claimed (a second click): the interview the link was for.
  if v_landing is null and v_claim.application_interview_id is not null then
    select case when a.merged_into_application_id is null then ai.id else (
             select d.id from public.application_interviews d
              where d.application_id = a.merged_into_application_id and d.applicant_user_id = v_user)
           end
      into v_landing
      from public.application_interviews ai
      join public.applications a on a.id = ai.application_id
     where ai.id = v_claim.application_interview_id and (ai.applicant_user_id = v_user or a.merged_into_application_id is not null);
  end if;

  update public.company_candidate_claims set used_at = coalesce(used_at, now()), used_by = v_user
   where token_hash = v_claim.token_hash;

  return jsonb_build_object('ok', true, 'application_interview_id', v_landing);
end $$;

revoke all on function public.claim_company_candidate(text) from public, anon;
grant execute on function public.claim_company_candidate(text) to authenticated;
