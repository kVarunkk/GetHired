-- Recruiter teams, phase 2: invites (TMT-031, TM-SEC-002).
--
-- create_company_invite, revoke_company_invite, accept_company_invite.
-- Tokens are 32 random bytes, base64url. Only sha256(token) (hex) is stored;
-- the token is returned once by create_company_invite and goes into the invite
-- email. Acceptance looks the invite up by the hash of the presented token, so
-- the token is never compared directly and a timing difference reveals nothing
-- about it. All results are jsonb { ok: true, ... } or { ok: false, reason }.

create or replace function public.team_invite_hash(p_token text)
returns text
language sql immutable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
$$;

-- Owners and admins invite an email as admin or member (TM-REQ-002). Pending
-- invites take a seat (TM-REQ-005).
create or replace function public.create_company_invite(p_email text, p_role public.company_role)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid := public.my_company_id();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_token text;
  v_id uuid;
begin
  if v_company is null or not public.is_company_admin(v_company) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_role is null or p_role = 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_role');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 320 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_email');
  end if;

  -- Serialise invites per company, so two at once can't both take the last seat.
  perform pg_advisory_xact_lock(hashtextextended('company_invites:' || v_company::text, 0));

  if exists (
    select 1 from public.company_members m join auth.users u on u.id = m.user_id
     where m.company_id = v_company and lower(u.email) = v_email
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_member');
  end if;

  -- An expired invite still holds the open-invite index; close it.
  update public.company_invites set revoked_at = now()
   where company_id = v_company and lower(email) = v_email
     and accepted_at is null and revoked_at is null and expires_at <= now();

  if exists (
    select 1 from public.company_invites i
     where i.company_id = v_company and lower(i.email) = v_email
       and i.accepted_at is null and i.revoked_at is null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_invited');
  end if;

  if not coalesce((public.check_entitlement(v_company, 'seats', 1) ->> 'allowed')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'seat_limit');
  end if;

  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

  insert into public.company_invites (company_id, email, role, token_hash, invited_by)
  values (v_company, v_email, p_role, public.team_invite_hash(v_token), v_uid)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'token', v_token);
end $$;

create or replace function public.revoke_company_invite(p_invite_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_company uuid := public.my_company_id();
begin
  if v_company is null or not public.is_company_admin(v_company) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  update public.company_invites set revoked_at = now()
   where id = p_invite_id and company_id = v_company
     and accepted_at is null and revoked_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- TM-SEC-002 / TM-REQ-003: expiry, single use, the caller's confirmed email,
-- account type, one company per account and the seat limit, in one
-- transaction. The server action sets app_metadata only after this succeeds
-- (TM-SEC-004).
create or replace function public.accept_company_invite(p_token text, p_display_name text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_invite public.company_invites;
  v_email text;
  v_confirmed timestamptz;
  v_full_name text;
  v_limit int;
  v_name text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;
  if p_token is null or char_length(p_token) not between 20 and 100 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into v_invite from public.company_invites
   where token_hash = public.team_invite_hash(p_token)
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_invite.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  if v_invite.accepted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'used');
  end if;
  if v_invite.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  select u.email, u.email_confirmed_at, u.raw_user_meta_data ->> 'full_name'
    into v_email, v_confirmed, v_full_name
    from auth.users u where u.id = v_uid;
  if v_confirmed is null then
    return jsonb_build_object('ok', false, 'reason', 'unconfirmed');
  end if;
  if lower(coalesce(v_email, '')) <> lower(v_invite.email) then
    return jsonb_build_object('ok', false, 'reason', 'wrong_email');
  end if;
  if exists (select 1 from public.user_info ui where ui.user_id = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'applicant');
  end if;
  if exists (select 1 from public.company_members m where m.user_id = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'already_member');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('company_invites:' || v_invite.company_id::text, 0));

  -- This invite is already counted in the seats used, so accepting it fits
  -- unless the company is over its limit (a downgrade, BL-REQ-014).
  v_limit := (public.check_entitlement(v_invite.company_id, 'seats', 1) ->> 'amount')::int;
  if v_limit is not null and public.billing_limit_used(v_invite.company_id, 'seats') > v_limit then
    return jsonb_build_object('ok', false, 'reason', 'seat_limit');
  end if;

  v_name := left(coalesce(nullif(btrim(p_display_name), ''), nullif(btrim(v_full_name), '')), 80);

  insert into public.company_members (company_id, user_id, role, display_name)
  values (v_invite.company_id, v_uid, v_invite.role, v_name);

  update public.company_invites set accepted_at = now(), accepted_by = v_uid
   where id = v_invite.id;

  return jsonb_build_object('ok', true, 'company_id', v_invite.company_id, 'role', v_invite.role);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'create_company_invite(text, public.company_role)',
    'revoke_company_invite(uuid)',
    'accept_company_invite(text, text)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;

  execute 'revoke all on function public.team_invite_hash(text) from public, anon, authenticated';
  execute 'grant execute on function public.team_invite_hash(text) to service_role';
end $$;
