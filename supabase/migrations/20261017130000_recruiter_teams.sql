-- Recruiter teams, phase 1 (plan/recruiter-teams/feature-recruiter-teams-spec.md, TMT-013/014).
--
-- 1. company_role enum, company_members, company_invites (+ RLS: members read,
--    nobody writes directly; TM-SEC-006).
-- 2. Owner backfill (backfill_company_owners) and the seed_owner_membership
--    trigger on company_info.
-- 3. Helper bodies: my_company_id(), is_company_member() now read membership;
--    new company_role() and is_company_admin().
-- 4. Member RPCs: touch_company_membership, set_my_display_name,
--    set_company_member_role, remove_company_member, transfer_company_ownership,
--    list_company_team, update_company_settings (tasks difference 3, 6).
-- 5. Seats: billing_limit_used(…, 'seats') counts members plus open invites
--    (difference 11).
-- 6. candidate_outreach.sender_name, filled at insert (difference 8).
-- 7. feedbacks.company_user_id points at auth.users (TMT-000).
-- 8. Policy rewrite (difference 2 + job_relevant_profiles from TMT-000).
--
-- company_info.user_id keeps meaning "the owner" (TM-CON-001):
-- transfer_company_ownership keeps it in sync, and "Company can update their
-- own profile" (auth.uid() = user_id) is therefore owner-only as it stands.
--
-- Member RPCs return jsonb { ok: true, ... } or { ok: false, reason }, so the
-- server actions can map reasons to copy (TMT-031).

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'company_role' and typnamespace = 'public'::regnamespace) then
    create type public.company_role as enum ('owner', 'admin', 'member');
  end if;
end $$;

create table if not exists public.company_members (
  company_id uuid not null references public.company_info(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.company_role not null default 'member',
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now(),
  last_active_at timestamptz,
  primary key (company_id, user_id),
  -- One company per account in v1 (ALT-002).
  constraint company_members_user_id_key unique (user_id)
);
-- TM-SEC-003: exactly one owner.
create unique index if not exists company_members_one_owner
  on public.company_members (company_id) where role = 'owner';

create table if not exists public.company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_info(id) on delete cascade,
  email text not null check (char_length(email) between 3 and 320),
  role public.company_role not null check (role <> 'owner'),
  -- TM-SEC-002: sha256(token), hex. The token itself is never stored.
  token_hash text not null unique,
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists company_invites_open
  on public.company_invites (company_id, lower(email))
  where accepted_at is null and revoked_at is null;
create index if not exists company_invites_company on public.company_invites (company_id);

alter table public.company_members enable row level security;
alter table public.company_invites enable row level security;

drop policy if exists "company_members_select_company" on public.company_members;
create policy "company_members_select_company" on public.company_members
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists "company_invites_select_company" on public.company_invites;
create policy "company_invites_select_company" on public.company_invites
  for select to authenticated using (public.is_company_member(company_id));

-- No write policies: every write goes through the RPCs below. token_hash isn't
-- readable by users at all (acceptance compares it inside the RPC).
revoke all on public.company_members from anon, authenticated;
revoke all on public.company_invites from anon, authenticated;
grant select on public.company_members to authenticated;
grant select (id, company_id, email, role, invited_by, expires_at, accepted_at, revoked_at, created_at)
  on public.company_invites to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Owners: backfill and seed trigger
-- ---------------------------------------------------------------------------

-- Idempotent: every company with a user_id gets exactly one owner row.
create or replace function public.backfill_company_owners()
returns int
language plpgsql security definer
set search_path = ''
as $$
declare n int;
begin
  insert into public.company_members (company_id, user_id, role)
  select ci.id, ci.user_id, 'owner' from public.company_info ci
   where ci.user_id is not null
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

select public.backfill_company_owners();

create or replace function public.seed_owner_membership()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.user_id is not null then
    insert into public.company_members (company_id, user_id, role)
    values (new.id, new.user_id, 'owner')
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists company_info_seed_owner on public.company_info;
create trigger company_info_seed_owner
  after insert on public.company_info
  for each row execute function public.seed_owner_membership();

-- ---------------------------------------------------------------------------
-- 3. Helpers (signatures from the security spec; bodies read membership)
-- ---------------------------------------------------------------------------

create or replace function public.my_company_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select m.company_id from public.company_members m where m.user_id = (select auth.uid())
$$;

create or replace function public.is_company_member(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.company_members m
     where m.company_id = p_company_id and m.user_id = (select auth.uid())
  )
$$;

create or replace function public.company_role(p_company_id uuid)
returns public.company_role
language sql stable security definer
set search_path = ''
as $$
  select m.role from public.company_members m
   where m.company_id = p_company_id and m.user_id = (select auth.uid())
$$;

-- TM-REQ-004: jobs, stages, templates and team management.
create or replace function public.is_company_admin(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(public.company_role(p_company_id) in ('owner', 'admin'), false)
$$;

-- The name shown on what a member did: their display name, else the local
-- part of their email. Internal (used by the outreach trigger and the team list).
create or replace function public.member_display_name(p_user_id uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select nullif(btrim(m.display_name), '') from public.company_members m where m.user_id = p_user_id),
    (select split_part(u.email, '@', 1) from auth.users u where u.id = p_user_id)
  )
$$;

-- ---------------------------------------------------------------------------
-- 4. Member RPCs
-- ---------------------------------------------------------------------------

-- Difference 6: last_active_at, at most every 10 minutes, caller's row only.
create or replace function public.touch_company_membership()
returns void
language sql security definer
set search_path = ''
as $$
  update public.company_members
     set last_active_at = now()
   where user_id = (select auth.uid())
     and (last_active_at is null or last_active_at < now() - interval '10 minutes')
$$;

create or replace function public.set_my_display_name(p_name text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_name text := btrim(coalesce(p_name, ''));
begin
  if char_length(v_name) not between 1 and 80 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;
  update public.company_members set display_name = v_name where user_id = (select auth.uid());
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_member');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- An admin manages admins and members; nobody changes the owner here or makes
-- anyone owner (that's transfer_company_ownership).
create or replace function public.set_company_member_role(p_user_id uuid, p_role public.company_role)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_target public.company_role;
begin
  if v_company is null or not public.is_company_admin(v_company) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_role is null or p_role = 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_role');
  end if;

  select m.role into v_target from public.company_members m
   where m.company_id = v_company and m.user_id = p_user_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_target = 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'owner');
  end if;

  update public.company_members set role = p_role
   where company_id = v_company and user_id = p_user_id;
  return jsonb_build_object('ok', true);
end $$;

-- Owners and admins remove admins and members; admins and members may remove
-- themselves ("leave"). The owner is never removed.
create or replace function public.remove_company_member(p_user_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid := public.my_company_id();
  v_target public.company_role;
begin
  if v_company is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_user_id is distinct from v_uid and not public.is_company_admin(v_company) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select m.role into v_target from public.company_members m
   where m.company_id = v_company and m.user_id = p_user_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_target = 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'owner');
  end if;

  delete from public.company_members where company_id = v_company and user_id = p_user_id;
  return jsonb_build_object('ok', true);
end $$;

-- Owner only. The old owner becomes an admin; company_info.user_id follows
-- (TM-CON-001). Demote first, so the one-owner index never sees two owners.
create or replace function public.transfer_company_ownership(p_new_owner uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid := public.my_company_id();
begin
  if v_company is null or public.company_role(v_company) is distinct from 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_new_owner is null or p_new_owner = v_uid then
    return jsonb_build_object('ok', false, 'reason', 'invalid_target');
  end if;
  perform 1 from public.company_members m
   where m.company_id = v_company and m.user_id = p_new_owner
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  update public.company_members set role = 'admin' where company_id = v_company and user_id = v_uid;
  update public.company_members set role = 'owner' where company_id = v_company and user_id = p_new_owner;
  update public.company_info set user_id = p_new_owner, updated_at = now() where id = v_company;
  return jsonb_build_object('ok', true);
end $$;

-- TM-REQ-006: members (with emails from auth.users, which members can't read)
-- and open invites of the caller's company only.
create or replace function public.list_company_team()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case when public.my_company_id() is null then null else jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', m.user_id,
               'email', u.email,
               'display_name', m.display_name,
               'role', m.role,
               'joined_at', m.created_at,
               'last_active_at', m.last_active_at
             ) order by (m.role = 'owner') desc, (m.role = 'admin') desc, m.created_at)
        from public.company_members m
        join auth.users u on u.id = m.user_id
       where m.company_id = public.my_company_id()
    ), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id,
               'email', i.email,
               'role', i.role,
               'invited_by', public.member_display_name(i.invited_by),
               'created_at', i.created_at,
               'expires_at', i.expires_at
             ) order by i.created_at desc)
        from public.company_invites i
       where i.company_id = public.my_company_id()
         and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    ), '[]'::jsonb)
  ) end
$$;

-- Difference 3: company_info is owner-only, but owners and admins manage these
-- settings. Only the keys present in p_settings are changed, and only these.
create or replace function public.update_company_settings(p_settings jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_company uuid := public.my_company_id();
begin
  if v_company is null or not public.is_company_admin(v_company) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object'
     or exists (
       select 1 from jsonb_object_keys(p_settings) k
        where k not in ('scheduling_url', 'notify_new_applicants', 'notify_weekly_matches')
     ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;

  update public.company_info set
    scheduling_url = case when p_settings ? 'scheduling_url'
                          then nullif(p_settings ->> 'scheduling_url', '') else scheduling_url end,
    notify_new_applicants = case when p_settings ? 'notify_new_applicants'
                                 then p_settings ->> 'notify_new_applicants' else notify_new_applicants end,
    notify_weekly_matches = case when p_settings ? 'notify_weekly_matches'
                                 then (p_settings ->> 'notify_weekly_matches')::boolean else notify_weekly_matches end,
    updated_at = now()
  where id = v_company;
  return jsonb_build_object('ok', true);
exception
  -- The column checks (https link, notify values) and a non-boolean flag.
  when check_violation or invalid_text_representation then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Seats (difference 11)
-- ---------------------------------------------------------------------------

create or replace function public.billing_limit_used(p_company_id uuid, p_key text)
returns int
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case p_key
    when 'active_job_posts' then
      (select count(*)::int from public.job_postings jp
        where jp.company_id = p_company_id and jp.status = 'active')
    -- Members plus open invites. An expired or revoked invite frees its seat.
    when 'seats' then
      (select count(*)::int from public.company_members m where m.company_id = p_company_id)
      + (select count(*)::int from public.company_invites i
          where i.company_id = p_company_id
            and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())
    else 0
  end
$$;

-- ---------------------------------------------------------------------------
-- 6. candidate_outreach.sender_name (difference 8)
-- ---------------------------------------------------------------------------

alter table public.candidate_outreach add column if not exists sender_name text;

create or replace function public.fill_outreach_sender_name()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.sender_name is null and new.sender_user_id is not null then
    new.sender_name := public.member_display_name(new.sender_user_id);
  end if;
  return new;
end $$;

drop trigger if exists candidate_outreach_sender_name on public.candidate_outreach;
create trigger candidate_outreach_sender_name
  before insert on public.candidate_outreach
  for each row execute function public.fill_outreach_sender_name();

update public.candidate_outreach o
   set sender_name = public.member_display_name(o.sender_user_id)
 where o.sender_name is null and o.sender_user_id is not null;

-- ---------------------------------------------------------------------------
-- 7. feedbacks.company_user_id: per-person feedback (TMT-000)
-- ---------------------------------------------------------------------------

-- It referenced company_info(user_id), so a non-owner member's feedback would
-- fail the FK, and a transfer would rewrite the old owner's rows.
alter table public.feedbacks drop constraint if exists feedbacks_company_user_id_fkey;
alter table public.feedbacks
  add constraint feedbacks_company_user_id_fkey
  foreign key (company_user_id) references auth.users(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 8. Policy rewrite
-- ---------------------------------------------------------------------------

-- applications: every member reads, moves and adds.
drop policy if exists "Company can view applications for their jobs" on public.applications;
create policy "Company can view applications for their jobs"
  on public.applications for select to authenticated
  using (exists (
    select 1 from public.job_postings jp
     where jp.id = applications.job_post_id and public.is_company_member(jp.company_id)
  ));

drop policy if exists "Company can update applications for their jobs" on public.applications;
create policy "Company can update applications for their jobs"
  on public.applications for update to authenticated
  using (exists (
    select 1 from public.job_postings jp
     where jp.id = applications.job_post_id and public.is_company_member(jp.company_id)
  ))
  with check (exists (
    select 1 from public.job_postings jp
     where jp.id = applications.job_post_id and public.is_company_member(jp.company_id)
  ));

-- Keeps OR-SEC-001's company_has_candidate_access clause.
drop policy if exists "Company user can create Application" on public.applications;
create policy "Company user can create Application"
  on public.applications for insert to authenticated
  with check (
    exists (
      select 1 from public.job_postings jp
       where jp.id = applications.job_post_id and public.is_company_member(jp.company_id)
    )
    and public.company_has_candidate_access(applications.applicant_user_id)
  );

-- job_postings: members read; owners and admins write.
drop policy if exists "Company can view their own job postings" on public.job_postings;
create policy "Company can view their own job postings"
  on public.job_postings for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "Company can create job postings" on public.job_postings;
create policy "Company can create job postings"
  on public.job_postings for insert to authenticated
  with check (public.is_company_admin(company_id));

drop policy if exists "Company can update their own job postings" on public.job_postings;
create policy "Company can update their own job postings"
  on public.job_postings for update to authenticated
  using (public.is_company_admin(company_id))
  with check (public.is_company_admin(company_id));

drop policy if exists "Company can delete their own job postings" on public.job_postings;
create policy "Company can delete their own job postings"
  on public.job_postings for delete to authenticated
  using (public.is_company_admin(company_id));

-- all_jobs: the public listing of a company's posting, owners and admins.
drop policy if exists "Company can update their own job records" on public.all_jobs;
create policy "Company can update their own job records"
  on public.all_jobs for update to authenticated
  using (exists (
    select 1 from public.job_postings jp
     where jp.job_id = all_jobs.id and public.is_company_admin(jp.company_id)
  ))
  with check (exists (
    select 1 from public.job_postings jp
     where jp.job_id = all_jobs.id and public.is_company_admin(jp.company_id)
  ));

-- company_favorites: every member.
drop policy if exists "Company can add profiles to favorites" on public.company_favorites;
create policy "Company can add profiles to favorites"
  on public.company_favorites for insert to authenticated
  with check (public.is_company_member(company_id));

drop policy if exists "Company can remove profiles from favorites" on public.company_favorites;
create policy "Company can remove profiles from favorites"
  on public.company_favorites for delete to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "Company can view their own favorites" on public.company_favorites;
create policy "Company can view their own favorites"
  on public.company_favorites for select to authenticated
  using (public.is_company_member(company_id));

-- job_relevant_profiles: every member (TMT-000).
drop policy if exists "Company users can view their own job posting matches" on public.job_relevant_profiles;
create policy "Company users can view their own job posting matches"
  on public.job_relevant_profiles for select to authenticated
  using (job_posting_id in (
    select jp.id from public.job_postings jp where jp.company_id = public.my_company_id()
  ));

-- pipeline_stages and company_email_templates: members read (unchanged);
-- owners and admins write (TM-REQ-004).
drop policy if exists "pipeline_stages_insert_company" on public.pipeline_stages;
create policy "pipeline_stages_insert_company" on public.pipeline_stages
  for insert to authenticated with check (public.is_company_admin(company_id));
drop policy if exists "pipeline_stages_update_company" on public.pipeline_stages;
create policy "pipeline_stages_update_company" on public.pipeline_stages
  for update to authenticated
  using (public.is_company_admin(company_id))
  with check (public.is_company_admin(company_id));

drop policy if exists "company_email_templates_insert_company" on public.company_email_templates;
create policy "company_email_templates_insert_company" on public.company_email_templates
  for insert to authenticated with check (public.is_company_admin(company_id));
drop policy if exists "company_email_templates_update_company" on public.company_email_templates;
create policy "company_email_templates_update_company" on public.company_email_templates
  for update to authenticated
  using (public.is_company_admin(company_id))
  with check (public.is_company_admin(company_id));
drop policy if exists "company_email_templates_delete_company" on public.company_email_templates;
create policy "company_email_templates_delete_company" on public.company_email_templates
  for delete to authenticated using (public.is_company_admin(company_id));

-- storage, applications bucket: <job>/<company id>/… for every member.
drop policy if exists "Allow company to view applicant resumes" on storage.objects;
create policy "Allow company to view applicant resumes"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'applications'
    and (storage.foldername(name))[2] = (public.my_company_id())::text
  );

drop policy if exists "Allow company user to upload user resume fhzllv_0" on storage.objects;
create policy "Allow company user to upload user resume fhzllv_0"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'applications'
    and (storage.foldername(name))[2] = (public.my_company_id())::text
  );

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

do $$
declare f text;
begin
  -- Called by users (each checks the caller itself).
  foreach f in array array[
    'company_role(uuid)', 'is_company_admin(uuid)',
    'touch_company_membership()', 'set_my_display_name(text)',
    'set_company_member_role(uuid, public.company_role)', 'remove_company_member(uuid)',
    'transfer_company_ownership(uuid)', 'list_company_team()',
    'update_company_settings(jsonb)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;

  -- Internal only.
  foreach f in array array[
    'backfill_company_owners()', 'seed_owner_membership()',
    'member_display_name(uuid)', 'fill_outreach_sender_name()'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
