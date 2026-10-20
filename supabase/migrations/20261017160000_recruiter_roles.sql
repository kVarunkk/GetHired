-- Recruiter roles and permissions (plan/recruiter-roles/feature-recruiter-roles-spec.md).
--
-- Replaces the fixed owner/admin/member enum with custom roles built from a
-- permission catalog, job-scoped access, several owners (one primary) and an
-- audit log. One function, has_company_permission(), is the only permission
-- check (RP-SEC-001). Writes to the new tables go through the RPCs below
-- (RP-SEC-002). Phase 6's per-member caps are in 20261017170000.
--
--  1. Catalog, roles, grants, limits, assignments, audit log (spec §2)
--  2. Seeding (new companies) and the backfill (existing ones, RP-REQ-004)
--  3. Integrity triggers
--  4. has_company_permission and friends
--  5. Policy rewrite (spec §2.2)
--  6. Existing RPCs moved to permissions
--  7. Role, member, owner, invite and assignment RPCs (RP-REQ-012, audit)
--  8. Reads: my_company_access, list_company_team, list_company_roles, list_company_audit
--  9. Drop the enum era: company_role(), is_company_admin(), the role columns
-- 10. Privileges

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

-- Test-checked against helpers/companies/permissions.ts (RP-TEST-002).
create table if not exists public.company_permissions (
  key text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  scopable boolean not null,
  requires text[] not null default '{}'
);

insert into public.company_permissions (key, scopable, requires) values
  ('jobs.view', true, '{}'),
  ('jobs.create', false, '{jobs.view}'),
  ('jobs.edit', true, '{jobs.view}'),
  ('jobs.publish', true, '{jobs.view}'),
  ('jobs.delete', true, '{jobs.view}'),
  ('jobs.assign', true, '{jobs.view,team.view}'),
  ('applicants.view', true, '{jobs.view}'),
  ('pipeline.move', true, '{applicants.view}'),
  ('applicants.screen', true, '{applicants.view}'),
  ('notes.view', true, '{}'),
  ('notes.write', true, '{notes.view}'),
  ('notes.manage', true, '{notes.write}'),
  ('talent.view', false, '{}'),
  ('talent.save', false, '{talent.view}'),
  ('talent_lists.manage', false, '{talent.view}'),
  ('matching.run', true, '{jobs.view,talent.view}'),
  ('outreach.view', true, '{talent.view}'),
  ('outreach.send', true, '{outreach.view}'),
  ('outreach.withdraw', true, '{outreach.view}'),
  ('agent.use', false, '{}'),
  ('settings.stages', false, '{}'),
  ('settings.templates', false, '{}'),
  ('settings.scheduling', false, '{}'),
  ('settings.notifications', false, '{}'),
  ('company.profile', false, '{}'),
  ('team.view', false, '{}'),
  ('team.invite', false, '{team.view}'),
  ('team.remove', false, '{team.view}'),
  ('team.assign_roles', false, '{team.view,roles.view}'),
  ('roles.view', false, '{}'),
  ('roles.manage', false, '{roles.view}'),
  ('audit.view', false, '{team.view}'),
  ('billing.view', false, '{}')
on conflict (key) do update set scopable = excluded.scopable, requires = excluded.requires;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'permission_scope' and typnamespace = 'public'::regnamespace) then
    create type public.permission_scope as enum ('all', 'assigned');
  end if;
end $$;

create table if not exists public.company_roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_info(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  description text check (char_length(description) <= 200),
  color text not null default 'slate'
    check (color in ('slate', 'indigo', 'emerald', 'amber', 'rose', 'sky', 'violet', 'teal')),
  template_key text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists company_roles_name on public.company_roles (company_id, lower(btrim(name)));
create index if not exists company_roles_company on public.company_roles (company_id);

create table if not exists public.company_role_permissions (
  role_id uuid not null references public.company_roles(id) on delete cascade,
  permission_key text not null references public.company_permissions(key),
  scope public.permission_scope not null default 'all',
  primary key (role_id, permission_key)
);

-- RP-REQ-040: monthly per-member caps on allowance keys.
create table if not exists public.company_role_limits (
  role_id uuid not null references public.company_roles(id) on delete cascade,
  key text not null
    check (key in ('screenings', 'outreach', 'agent_messages', 'match_explanations', 'interview_minutes')),
  monthly_amount int not null check (monthly_amount >= 0),
  primary key (role_id, key)
);

alter table public.company_members
  add column if not exists is_owner boolean not null default false,
  add column if not exists role_id uuid references public.company_roles(id) on delete restrict;
create index if not exists company_members_role on public.company_members (role_id);

alter table public.company_invites
  add column if not exists role_id uuid references public.company_roles(id) on delete set null;

alter table public.company_info
  add column if not exists default_role_id uuid references public.company_roles(id) on delete restrict;

create table if not exists public.company_job_assignments (
  company_id uuid not null references public.company_info(id) on delete cascade,
  job_post_id uuid not null references public.job_postings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (job_post_id, user_id)
);
create index if not exists company_job_assignments_user on public.company_job_assignments (user_id, job_post_id);

create table if not exists public.company_audit_log (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.company_info(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name text,
  actor_kind text not null default 'user' check (actor_kind in ('user', 'agent', 'system')),
  action text not null check (action in (
    'role.created', 'role.updated', 'role.deleted', 'role.default_changed',
    'member.role_changed', 'member.removed', 'member.left',
    'owner.added', 'owner.removed', 'owner.primary_changed',
    'invite.created', 'invite.revoked', 'invite.accepted',
    'job.assigned', 'job.unassigned'
  )),
  target_type text not null check (target_type in ('role', 'member', 'invite', 'job', 'company')),
  target_id text,
  target_label text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index if not exists company_audit_log_company_created
  on public.company_audit_log (company_id, created_at desc);
create index if not exists company_audit_log_company_id on public.company_audit_log (company_id, id desc);

-- RP-REQ-043: who started the work a hold pays for.
alter table public.company_entitlement_holds
  add column if not exists actor_user_id uuid references auth.users(id) on delete set null;
create index if not exists company_usage_events_actor_period
  on public.company_usage_events (company_id, actor_user_id, key, created_at);

alter table public.company_permissions enable row level security;
alter table public.company_roles enable row level security;
alter table public.company_role_permissions enable row level security;
alter table public.company_role_limits enable row level security;
alter table public.company_job_assignments enable row level security;
alter table public.company_audit_log enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Seeding and backfill
-- ---------------------------------------------------------------------------

-- RP-REQ-004: Admin (everything but company.profile) and Member (what members
-- could do before roles), each at scope all, and Member as the default invite
-- role. Idempotent (keyed on template_key).
create or replace function public.seed_company_roles(p_company_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_admin uuid;
  v_member uuid;
begin
  select id into v_admin from public.company_roles
   where company_id = p_company_id and template_key = 'admin' order by created_at limit 1;
  if v_admin is null then
    insert into public.company_roles (company_id, name, description, color, template_key)
    values (p_company_id, 'Admin', 'Everything except billing management and owner changes.', 'indigo', 'admin')
    on conflict do nothing
    returning id into v_admin;
    if v_admin is not null then
      insert into public.company_role_permissions (role_id, permission_key, scope)
      select v_admin, p.key, 'all' from public.company_permissions p where p.key <> 'company.profile';
    end if;
  end if;

  select id into v_member from public.company_roles
   where company_id = p_company_id and template_key = 'member' order by created_at limit 1;
  if v_member is null then
    insert into public.company_roles (company_id, name, description, color, template_key)
    values (p_company_id, 'Member', 'Works with applicants, talent and outreach across every job.', 'slate', 'member')
    on conflict do nothing
    returning id into v_member;
    if v_member is not null then
      insert into public.company_role_permissions (role_id, permission_key, scope)
      select v_member, k, 'all'
        from unnest(
          -- @member-keys (helpers/companies/role-templates.ts MEMBER_KEYS)
          array['jobs.view', 'applicants.view', 'pipeline.move', 'applicants.screen',
                'notes.view', 'notes.write', 'talent.view', 'talent.save', 'talent_lists.manage',
                'matching.run', 'outreach.view', 'outreach.send', 'agent.use',
                'team.view', 'roles.view', 'billing.view']
        ) k;
    end if;
  end if;

  update public.company_info set default_role_id = v_member
   where id = p_company_id and default_role_id is null and v_member is not null;
end $$;

-- Every company gets its roles; members without a role and not owners get the
-- default role. Rerunnable: a second run changes nothing (RPT-010).
create or replace function public.backfill_company_roles()
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  c record;
  n int := 0;
begin
  for c in select id from public.company_info loop
    perform public.seed_company_roles(c.id);
  end loop;
  update public.company_members m
     set role_id = ci.default_role_id
    from public.company_info ci
   where ci.id = m.company_id and not m.is_owner and m.role_id is null;
  get diagnostics n = row_count;
  return n;
end $$;

do $$
begin
  perform public.backfill_company_roles();

  -- The enum era: owner → is_owner, admin/member → the company's seeded role.
  update public.company_members m set is_owner = true where m.role = 'owner' and not m.is_owner;
  update public.company_members m
     set role_id = r.id
    from public.company_roles r
   where r.company_id = m.company_id and m.role in ('admin', 'member')
     and r.template_key = m.role::text
     and m.role_id is distinct from r.id;
  update public.company_invites i
     set role_id = r.id
    from public.company_roles r
   where r.company_id = i.company_id and r.template_key = i.role::text and i.role_id is null;
  -- The primary owner is always an owner (TM-CON-001).
  update public.company_members m
     set is_owner = true, role_id = null
    from public.company_info ci
   where ci.id = m.company_id and ci.user_id = m.user_id and not m.is_owner;
  update public.company_members set role_id = null where is_owner and role_id is not null;
end $$;

alter table public.company_members drop constraint if exists company_members_role_or_owner;
alter table public.company_members
  add constraint company_members_role_or_owner check (is_owner or role_id is not null);

create or replace function public.seed_owner_membership()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.user_id is not null then
    insert into public.company_members (company_id, user_id, is_owner)
    values (new.id, new.user_id, true)
    on conflict do nothing;
  end if;
  return new;
end $$;

create or replace function public.seed_company_roles_trigger()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.seed_company_roles(new.id);
  return new;
end $$;

drop trigger if exists company_info_seed_roles on public.company_info;
create trigger company_info_seed_roles
  after insert on public.company_info
  for each row execute function public.seed_company_roles_trigger();

-- ---------------------------------------------------------------------------
-- 3. Integrity triggers
-- ---------------------------------------------------------------------------

-- No assigned scope on a key that can't be scoped.
create or replace function public.guard_role_permission()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.scope = 'assigned' and not coalesce(
    (select p.scopable from public.company_permissions p where p.key = new.permission_key), false
  ) then
    raise exception '% can''t be limited to assigned jobs', new.permission_key using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists company_role_permissions_guard on public.company_role_permissions;
create trigger company_role_permissions_guard
  before insert or update on public.company_role_permissions
  for each row execute function public.guard_role_permission();

-- RP-REQ-009 at commit: every dependency of every grant is there, at the
-- dependent's scope or wider (a non-scopable dependency is always all; a
-- non-scopable key's scopable dependency may be assigned).
create or replace function public.check_role_dependencies()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role uuid := coalesce(new.role_id, old.role_id);
  v_missing text;
begin
  if not exists (select 1 from public.company_roles r where r.id = v_role) then
    return null;
  end if;
  select g.permission_key || ' needs ' || d.dep into v_missing
    from public.company_role_permissions g
    join public.company_permissions p on p.key = g.permission_key
    cross join lateral unnest(p.requires) d(dep)
   where g.role_id = v_role
     and not exists (
       select 1 from public.company_role_permissions h
        where h.role_id = v_role and h.permission_key = d.dep
          and (h.scope = 'all' or g.scope = 'assigned' or not p.scopable)
     )
   limit 1;
  if v_missing is not null then
    raise exception 'Role grants are missing a dependency: %', v_missing using errcode = 'check_violation';
  end if;
  return null;
end $$;

drop trigger if exists company_role_permissions_deps on public.company_role_permissions;
create constraint trigger company_role_permissions_deps
  after insert or update or delete on public.company_role_permissions
  deferrable initially deferred
  for each row execute function public.check_role_dependencies();

-- A member's or invite's role belongs to the same company.
create or replace function public.guard_member_role_company()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role_id is not null and not exists (
    select 1 from public.company_roles r where r.id = new.role_id and r.company_id = new.company_id
  ) then
    raise exception 'That role belongs to another company' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists company_members_role_company on public.company_members;
create trigger company_members_role_company
  before insert or update of role_id, company_id on public.company_members
  for each row execute function public.guard_member_role_company();

drop trigger if exists company_invites_role_company on public.company_invites;
create trigger company_invites_role_company
  before insert or update of role_id, company_id on public.company_invites
  for each row execute function public.guard_member_role_company();

-- RP-REQ-006: at commit, the company has an owner and company_info.user_id
-- (the primary owner) is one. Deferred, so make_primary_owner can swap.
create or replace function public.check_company_owners()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_company uuid;
  v_primary uuid;
begin
  if tg_table_name = 'company_info' then
    v_company := new.id;
  else
    v_company := coalesce(new.company_id, old.company_id);
  end if;
  select ci.user_id into v_primary from public.company_info ci where ci.id = v_company;
  if not found then
    return null;  -- the company itself was deleted
  end if;
  if exists (select 1 from public.company_members m where m.company_id = v_company)
     and not exists (select 1 from public.company_members m where m.company_id = v_company and m.is_owner) then
    raise exception 'A company needs at least one owner' using errcode = 'check_violation';
  end if;
  if v_primary is not null and exists (select 1 from public.company_members m where m.company_id = v_company)
     and not exists (
       select 1 from public.company_members m
        where m.company_id = v_company and m.user_id = v_primary and m.is_owner
     ) then
    raise exception 'The primary owner must be an owner' using errcode = 'check_violation';
  end if;
  return null;
end $$;

drop trigger if exists company_members_owners on public.company_members;
create constraint trigger company_members_owners
  after insert or update or delete on public.company_members
  deferrable initially deferred
  for each row execute function public.check_company_owners();

drop trigger if exists company_info_primary_owner on public.company_info;
create constraint trigger company_info_primary_owner
  after update of user_id on public.company_info
  deferrable initially deferred
  for each row execute function public.check_company_owners();

-- ---------------------------------------------------------------------------
-- 4. The permission check (RP-SEC-001, RP-SEC-003)
-- ---------------------------------------------------------------------------

-- The caller's scope for a key in a company: 'all', 'assigned' or null.
-- Owners → 'all' for every catalog key. Unknown key or no role → null.
create or replace function public.company_permission_scope(p_company_id uuid, p_key text)
returns text
language sql stable security definer
set search_path = ''
as $$
  select case
    when not exists (select 1 from public.company_permissions p where p.key = p_key) then null
    when m.is_owner then 'all'
    else (
      select rp.scope::text from public.company_role_permissions rp
       where rp.role_id = m.role_id and rp.permission_key = p_key
    )
  end
  from public.company_members m
  where m.company_id = p_company_id and m.user_id = (select auth.uid())
$$;

create or replace function public.has_company_permission(
  p_company_id uuid, p_key text, p_job_post_id uuid default null
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    case public.company_permission_scope(p_company_id, p_key)
      when 'all' then true
      when 'assigned' then p_job_post_id is not null and exists (
        select 1 from public.company_job_assignments ja
         where ja.job_post_id = p_job_post_id and ja.company_id = p_company_id
           and ja.user_id = (select auth.uid())
      )
      else false
    end,
    false
  )
$$;

-- RP-CON-003: the caller's company jobs where the key applies (all of them at
-- scope all, the assigned ones at scope assigned). Policies compare against it
-- once per statement instead of calling a function per row.
create or replace function public.my_job_ids_with(p_key text)
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    case public.company_permission_scope(public.my_company_id(), p_key)
      when 'all' then (
        select array_agg(jp.id) from public.job_postings jp where jp.company_id = public.my_company_id()
      )
      when 'assigned' then (
        select array_agg(ja.job_post_id) from public.company_job_assignments ja
         where ja.user_id = (select auth.uid()) and ja.company_id = public.my_company_id()
      )
    end,
    '{}'::uuid[]
  )
$$;

-- The job an application belongs to, without the applications RLS (so a
-- notes-only role can still read notes on its jobs). Only for the caller's
-- own company's applications.
create or replace function public.application_job_id(p_application_id uuid)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select a.job_post_id from public.applications a
    join public.job_postings jp on jp.id = a.job_post_id
   where a.id = p_application_id and jp.company_id = public.my_company_id()
$$;

create or replace function public.try_uuid(p_value text)
returns uuid
language sql immutable
set search_path = ''
as $$
  select case when p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then p_value::uuid end
$$;

-- Whether the caller is one of the company's owners.
create or replace function public.caller_is_owner(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select m.is_owner from public.company_members m
     where m.company_id = p_company_id and m.user_id = (select auth.uid())
  ), false)
$$;

-- ---------------------------------------------------------------------------
-- 5. Policy rewrite (spec §2.2)
-- ---------------------------------------------------------------------------

-- Catalog: readable by every signed-in user (it's the same as the code).
drop policy if exists "company_permissions_select" on public.company_permissions;
create policy "company_permissions_select" on public.company_permissions
  for select to authenticated using (true);

drop policy if exists "company_roles_select" on public.company_roles;
create policy "company_roles_select" on public.company_roles
  for select to authenticated using (public.has_company_permission(company_id, 'roles.view'));

drop policy if exists "company_role_permissions_select" on public.company_role_permissions;
create policy "company_role_permissions_select" on public.company_role_permissions
  for select to authenticated using (exists (
    select 1 from public.company_roles r
     where r.id = company_role_permissions.role_id and public.has_company_permission(r.company_id, 'roles.view')
  ));

drop policy if exists "company_role_limits_select" on public.company_role_limits;
create policy "company_role_limits_select" on public.company_role_limits
  for select to authenticated using (exists (
    select 1 from public.company_roles r
     where r.id = company_role_limits.role_id and public.has_company_permission(r.company_id, 'roles.view')
  ));

drop policy if exists "company_job_assignments_select" on public.company_job_assignments;
create policy "company_job_assignments_select" on public.company_job_assignments
  for select to authenticated using (
    user_id = (select auth.uid()) or public.has_company_permission(company_id, 'team.view')
  );

drop policy if exists "company_audit_log_select" on public.company_audit_log;
create policy "company_audit_log_select" on public.company_audit_log
  for select to authenticated using (public.has_company_permission(company_id, 'audit.view'));

-- Team: team.view, and everyone sees their own membership.
drop policy if exists "company_members_select_company" on public.company_members;
create policy "company_members_select_company" on public.company_members
  for select to authenticated using (
    user_id = (select auth.uid()) or public.has_company_permission(company_id, 'team.view')
  );

drop policy if exists "company_invites_select_company" on public.company_invites;
create policy "company_invites_select_company" on public.company_invites
  for select to authenticated using (public.has_company_permission(company_id, 'team.view'));

-- job_postings
drop policy if exists "Company can view their own job postings" on public.job_postings;
create policy "Company can view their own job postings"
  on public.job_postings for select to authenticated
  using (company_id = (select public.my_company_id()) and id = any ((select public.my_job_ids_with('jobs.view'))::uuid[]));

drop policy if exists "Company can create job postings" on public.job_postings;
create policy "Company can create job postings"
  on public.job_postings for insert to authenticated
  with check (public.has_company_permission(company_id, 'jobs.create'));

drop policy if exists "Company can update their own job postings" on public.job_postings;
create policy "Company can update their own job postings"
  on public.job_postings for update to authenticated
  using (
    public.has_company_permission(company_id, 'jobs.edit', id)
    or public.has_company_permission(company_id, 'jobs.publish', id)
  )
  with check (
    public.has_company_permission(company_id, 'jobs.edit', id)
    or public.has_company_permission(company_id, 'jobs.publish', id)
  );

drop policy if exists "Company can delete their own job postings" on public.job_postings;
create policy "Company can delete their own job postings"
  on public.job_postings for delete to authenticated
  using (public.has_company_permission(company_id, 'jobs.delete', id));

-- Status needs jobs.publish; everything else needs jobs.edit. The service role
-- (the app's own writes, after its TS check) and definer RPCs aren't affected.
create or replace function public.guard_job_posting_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_role <> 'authenticated' then
    return new;
  end if;
  if new.company_id is distinct from old.company_id then
    raise exception 'A job post can''t move to another company.' using errcode = 'insufficient_privilege';
  end if;
  if new.status is distinct from old.status
     and not public.has_company_permission(old.company_id, 'jobs.publish', old.id) then
    raise exception 'Your role can''t open, pause or close job posts.' using errcode = 'insufficient_privilege';
  end if;
  if (to_jsonb(new) - array['status', 'updated_at']) is distinct from (to_jsonb(old) - array['status', 'updated_at'])
     and not public.has_company_permission(old.company_id, 'jobs.edit', old.id) then
    raise exception 'Your role can''t edit job posts.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists job_postings_guard_update on public.job_postings;
create trigger job_postings_guard_update
  before update on public.job_postings
  for each row execute function public.guard_job_posting_update();

-- all_jobs: the public listing of a company's posting.
drop policy if exists "Company can update their own job records" on public.all_jobs;
create policy "Company can update their own job records"
  on public.all_jobs for update to authenticated
  using (exists (
    select 1 from public.job_postings jp
     where jp.job_id = all_jobs.id and public.has_company_permission(jp.company_id, 'jobs.edit', jp.id)
  ))
  with check (exists (
    select 1 from public.job_postings jp
     where jp.job_id = all_jobs.id and public.has_company_permission(jp.company_id, 'jobs.edit', jp.id)
  ));

-- applications (and, through their RLS, user_info, attachments and shared
-- interview analyses, whose policies join applications).
drop policy if exists "Company user can create Application" on public.applications;

drop policy if exists "Company can view applications for their jobs" on public.applications;
create policy "Company can view applications for their jobs"
  on public.applications for select to authenticated
  using (job_post_id = any ((select public.my_job_ids_with('applicants.view'))::uuid[]));

drop policy if exists "Company can update applications for their jobs" on public.applications;
create policy "Company can update applications for their jobs"
  on public.applications for update to authenticated
  using (job_post_id = any ((select public.my_job_ids_with('pipeline.move'))::uuid[]))
  with check (job_post_id = any ((select public.my_job_ids_with('pipeline.move'))::uuid[]));

-- application_events: the application's job; events without one need scope all.
drop policy if exists "application_events_select_company" on public.application_events;
create policy "application_events_select_company" on public.application_events
  for select to authenticated using (
    (application_id is null and public.has_company_permission(company_id, 'applicants.view'))
    or (application_id is not null
        and public.application_job_id(application_id) = any ((select public.my_job_ids_with('applicants.view'))::uuid[]))
  );

drop policy if exists "application_events_insert_company" on public.application_events;
create policy "application_events_insert_company" on public.application_events
  for insert to authenticated with check (
    (application_id is null and public.has_company_permission(company_id, 'applicants.view'))
    or (
      application_id is not null
      and public.has_company_permission(company_id, 'applicants.view', public.application_job_id(application_id))
      and exists (
        select 1 from public.applications a
        join public.job_postings jp on jp.id = a.job_post_id
        where a.id = application_events.application_id and jp.company_id = application_events.company_id
      )
    )
  );

drop policy if exists "screenings_select_company" on public.application_screenings;
create policy "screenings_select_company" on public.application_screenings
  for select to authenticated
  using (job_post_id = any ((select public.my_job_ids_with('applicants.view'))::uuid[]));

-- candidate_notes: the application's job; notes without one need scope all.
drop policy if exists "candidate_notes_select_company" on public.candidate_notes;
create policy "candidate_notes_select_company" on public.candidate_notes
  for select to authenticated using (
    (application_id is null and public.has_company_permission(company_id, 'notes.view'))
    or (application_id is not null
        and public.application_job_id(application_id) = any ((select public.my_job_ids_with('notes.view'))::uuid[]))
  );

drop policy if exists "candidate_notes_insert_author" on public.candidate_notes;
create policy "candidate_notes_insert_author" on public.candidate_notes
  for insert to authenticated with check (
    author_user_id = (select auth.uid())
    and (
      (application_id is null
        and public.has_company_permission(company_id, 'notes.write')
        and public.company_can_view_candidate(candidate_user_id))
      or (application_id is not null
        and public.has_company_permission(company_id, 'notes.write', public.application_job_id(application_id))
        and exists (
          select 1 from public.applications a
          join public.job_postings jp on jp.id = a.job_post_id
          where a.id = candidate_notes.application_id
            and a.applicant_user_id = candidate_notes.candidate_user_id
            and jp.company_id = candidate_notes.company_id
        ))
    )
  );

drop policy if exists "candidate_notes_update_author" on public.candidate_notes;
create policy "candidate_notes_update_author" on public.candidate_notes
  for update to authenticated
  using (
    (author_user_id = (select auth.uid())
      and public.has_company_permission(company_id, 'notes.write', public.application_job_id(application_id)))
    or public.has_company_permission(company_id, 'notes.manage', public.application_job_id(application_id))
  )
  with check (
    (author_user_id = (select auth.uid())
      and public.has_company_permission(company_id, 'notes.write', public.application_job_id(application_id)))
    or public.has_company_permission(company_id, 'notes.manage', public.application_job_id(application_id))
  );

drop policy if exists "candidate_notes_delete_author" on public.candidate_notes;
create policy "candidate_notes_delete_author" on public.candidate_notes
  for delete to authenticated using (
    (author_user_id = (select auth.uid())
      and public.has_company_permission(company_id, 'notes.write', public.application_job_id(application_id)))
    or public.has_company_permission(company_id, 'notes.manage', public.application_job_id(application_id))
  );

-- company_favorites
drop policy if exists "Company can view their own favorites" on public.company_favorites;
create policy "Company can view their own favorites"
  on public.company_favorites for select to authenticated
  using (public.has_company_permission(company_id, 'talent.view'));

drop policy if exists "Company can add profiles to favorites" on public.company_favorites;
create policy "Company can add profiles to favorites"
  on public.company_favorites for insert to authenticated
  with check (public.has_company_permission(company_id, 'talent.save'));

drop policy if exists "Company can remove profiles from favorites" on public.company_favorites;
create policy "Company can remove profiles from favorites"
  on public.company_favorites for delete to authenticated
  using (public.has_company_permission(company_id, 'talent.save'));

-- talent_lists and talent_list_members
drop policy if exists "talent_lists_select_company" on public.talent_lists;
create policy "talent_lists_select_company" on public.talent_lists
  for select to authenticated using (public.has_company_permission(company_id, 'talent.view'));
drop policy if exists "talent_lists_insert_company" on public.talent_lists;
create policy "talent_lists_insert_company" on public.talent_lists
  for insert to authenticated with check (public.has_company_permission(company_id, 'talent_lists.manage'));
drop policy if exists "talent_lists_update_company" on public.talent_lists;
create policy "talent_lists_update_company" on public.talent_lists
  for update to authenticated
  using (public.has_company_permission(company_id, 'talent_lists.manage'))
  with check (public.has_company_permission(company_id, 'talent_lists.manage'));
drop policy if exists "talent_lists_delete_company" on public.talent_lists;
create policy "talent_lists_delete_company" on public.talent_lists
  for delete to authenticated using (public.has_company_permission(company_id, 'talent_lists.manage'));

drop policy if exists "talent_list_members_select_company" on public.talent_list_members;
create policy "talent_list_members_select_company" on public.talent_list_members
  for select to authenticated
  using (public.has_company_permission(public.talent_list_company(list_id), 'talent.view'));
drop policy if exists "talent_list_members_insert_company" on public.talent_list_members;
create policy "talent_list_members_insert_company" on public.talent_list_members
  for insert to authenticated with check (
    public.has_company_permission(public.talent_list_company(list_id), 'talent_lists.manage')
    and public.company_can_view_candidate(candidate_user_id)
  );
drop policy if exists "talent_list_members_delete_company" on public.talent_list_members;
create policy "talent_list_members_delete_company" on public.talent_list_members
  for delete to authenticated
  using (public.has_company_permission(public.talent_list_company(list_id), 'talent_lists.manage'));

-- job_relevant_profiles: matches need matching.run on the job.
drop policy if exists "Company users can view their own job posting matches" on public.job_relevant_profiles;
create policy "Company users can view their own job posting matches"
  on public.job_relevant_profiles for select to authenticated
  using (job_posting_id = any ((select public.my_job_ids_with('matching.run'))::uuid[]));

-- candidate_outreach: outreach.view on the job (null job → scope all); a
-- sender always sees and can withdraw their own.
drop policy if exists "candidate_outreach_select_company" on public.candidate_outreach;
create policy "candidate_outreach_select_company" on public.candidate_outreach
  for select to authenticated using (
    (sender_user_id = (select auth.uid()) and public.is_company_member(company_id))
    or (job_post_id is null and public.has_company_permission(company_id, 'outreach.view'))
    or (job_post_id is not null and job_post_id = any ((select public.my_job_ids_with('outreach.view'))::uuid[]))
  );

drop policy if exists "candidate_outreach_withdraw_company" on public.candidate_outreach;
create policy "candidate_outreach_withdraw_company" on public.candidate_outreach
  for update to authenticated
  using (
    status = 'sent' and (
      (sender_user_id = (select auth.uid()) and public.is_company_member(company_id))
      or public.has_company_permission(company_id, 'outreach.withdraw', job_post_id)
    )
  )
  with check (
    status = 'withdrawn' and (
      (sender_user_id = (select auth.uid()) and public.is_company_member(company_id))
      or public.has_company_permission(company_id, 'outreach.withdraw', job_post_id)
    )
  );

-- pipeline_stages and company_email_templates: members read (the board needs
-- them); writes need the settings permission.
drop policy if exists "pipeline_stages_insert_company" on public.pipeline_stages;
create policy "pipeline_stages_insert_company" on public.pipeline_stages
  for insert to authenticated with check (public.has_company_permission(company_id, 'settings.stages'));
drop policy if exists "pipeline_stages_update_company" on public.pipeline_stages;
create policy "pipeline_stages_update_company" on public.pipeline_stages
  for update to authenticated
  using (public.has_company_permission(company_id, 'settings.stages'))
  with check (public.has_company_permission(company_id, 'settings.stages'));

drop policy if exists "company_email_templates_insert_company" on public.company_email_templates;
create policy "company_email_templates_insert_company" on public.company_email_templates
  for insert to authenticated with check (public.has_company_permission(company_id, 'settings.templates'));
drop policy if exists "company_email_templates_update_company" on public.company_email_templates;
create policy "company_email_templates_update_company" on public.company_email_templates
  for update to authenticated
  using (public.has_company_permission(company_id, 'settings.templates'))
  with check (public.has_company_permission(company_id, 'settings.templates'));
drop policy if exists "company_email_templates_delete_company" on public.company_email_templates;
create policy "company_email_templates_delete_company" on public.company_email_templates
  for delete to authenticated using (public.has_company_permission(company_id, 'settings.templates'));

-- company_info: owners, or company.profile limited to the profile columns
-- (the column-protection trigger below).
drop policy if exists "Company can update their own profile" on public.company_info;
create policy "Company can update their own profile"
  on public.company_info for update to authenticated
  using (public.has_company_permission(id, 'company.profile'))
  with check (public.has_company_permission(id, 'company.profile'));

create or replace function public.protect_company_info_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_profile jsonb;
begin
  if current_role = 'authenticated' then
    if tg_op = 'INSERT' then
      -- The column defaults: new companies start on the free tier.
      new.tier_id := (select t.id from public.company_tiers t where t.slug = 'free');
      new.ai_credits := 50;
      new.job_posts_created := 0;
    else
      new.tier_id := old.tier_id;
      new.ai_credits := old.ai_credits;
      new.job_posts_created := old.job_posts_created;
      -- The primary owner and default role change only through their RPCs.
      new.user_id := old.user_id;
      new.default_role_id := old.default_role_id;
      if not public.caller_is_owner(old.id) then
        -- company.profile: only the profile columns (spec §2.2).
        select jsonb_object_agg(k, v) into v_profile
          from jsonb_each(to_jsonb(new)) e(k, v)
         where k in ('name', 'description', 'website', 'industry', 'headquarters', 'company_size',
                     'tag_line', 'logo_url', 'filled', 'updated_at');
        new := jsonb_populate_record(old, coalesce(v_profile, '{}'::jsonb));
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- Billing reads: billing.view (the app's own spend checks are definer RPCs).
do $$
declare t text;
begin
  foreach t in array array['company_subscriptions', 'company_usage', 'company_usage_events',
                           'company_credit_ledger', 'company_entitlement_holds']
  loop
    execute format('drop policy if exists %I on public.%I', 'Members can read their company''s rows', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.has_company_permission(company_id, %L))',
      'Members can read their company''s rows', t, 'billing.view'
    );
  end loop;
end $$;

-- storage, applications bucket: <job>/<company id>/…, applicants.view on the job.
drop policy if exists "Allow company to view applicant resumes" on storage.objects;
create policy "Allow company to view applicant resumes"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'applications'
    and (storage.foldername(name))[2] = (public.my_company_id())::text
    and public.try_uuid((storage.foldername(name))[1]) = any ((select public.my_job_ids_with('applicants.view'))::uuid[])
  );

drop policy if exists "Allow company user to upload user resume fhzllv_0" on storage.objects;
create policy "Allow company user to upload user resume fhzllv_0"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'applications'
    and (storage.foldername(name))[2] = (public.my_company_id())::text
    and public.try_uuid((storage.foldername(name))[1]) = any ((select public.my_job_ids_with('pipeline.move'))::uuid[])
  );

-- ---------------------------------------------------------------------------
-- 6. Existing RPCs moved to permissions
-- ---------------------------------------------------------------------------

-- Public candidates need talent.view; applicants need applicants.view on the
-- job they applied to (RP-REQ-010).
create or replace function public.company_can_view_candidate(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.my_company_id() is not null and (
    (
      public.has_company_permission(public.my_company_id(), 'talent.view')
      and exists (select 1 from public.user_info u where u.user_id = p_user_id and u.is_public)
      and not exists (
        select 1 from public.candidate_company_blocks b
        where b.candidate_user_id = p_user_id and b.company_id = public.my_company_id()
      )
    )
    or exists (
      select 1 from public.applications a
      join public.job_postings jp on jp.id = a.job_post_id
      where a.applicant_user_id = p_user_id and jp.company_id = public.my_company_id()
        and public.has_company_permission(jp.company_id, 'applicants.view', jp.id)
    )
  )
$$;

create or replace function public.company_has_candidate_access(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.my_company_id() is not null and (
    exists (
      select 1 from public.applications a
      join public.job_postings jp on jp.id = a.job_post_id
      where a.applicant_user_id = p_user_id and jp.company_id = public.my_company_id()
        and public.has_company_permission(jp.company_id, 'applicants.view', jp.id)
    )
    or exists (
      select 1 from public.candidate_outreach o
      where o.candidate_user_id = p_user_id and o.company_id = public.my_company_id()
        and o.status = 'interested'
        and (o.sender_user_id = (select auth.uid())
             or public.has_company_permission(o.company_id, 'outreach.view', o.job_post_id))
    )
  )
$$;

create or replace function public.get_job_funnel(p_job_post_id uuid)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_company uuid;
  v_applied uuid;
  v_result jsonb;
begin
  select jp.company_id into v_company from public.job_postings jp where jp.id = p_job_post_id;
  if v_company is null or not public.has_company_permission(v_company, 'applicants.view', p_job_post_id) then
    return null;
  end if;

  -- Everyone starts in the first Applied stage.
  select s.id into v_applied from public.pipeline_stages s
   where s.company_id = v_company and s.kind = 'applied'
   order by s.archived, s.position
   limit 1;

  with apps as (
    select a.id, a.stage_id, a.source, a.created_at
      from public.applications a
     where a.job_post_id = p_job_post_id
  ),
  entries as (
    select apps.id as application_id, v_applied as stage_id, apps.created_at as entered_at
      from apps
    union all
    select e.application_id, (e.payload->>'to_stage_id')::uuid, e.created_at
      from public.application_events e
      join apps on apps.id = e.application_id
     where e.type = 'stage_changed' and e.payload ? 'to_stage_id'
  ),
  stays as (
    select stage_id, entered_at,
           lead(entered_at) over (partition by application_id order by entered_at) as left_at
      from entries
  ),
  medians as (
    select stage_id,
           percentile_cont(0.5) within group (order by extract(epoch from left_at - entered_at) / 86400.0)
             as median_days
      from stays
     where left_at is not null
     group by stage_id
  ),
  reached as (
    select stage_id, count(distinct application_id) as n
      from (
        select application_id, stage_id from entries
        union
        select id, stage_id from apps where stage_id is not null
      ) x
     group by stage_id
  ),
  current_counts as (
    select stage_id, count(*) as n from apps group by stage_id
  ),
  hires as (
    select percentile_cont(0.5) within group (order by extract(epoch from en.entered_at - apps.created_at) / 86400.0)
             as median_days
      from entries en
      join apps on apps.id = en.application_id
      join public.pipeline_stages s on s.id = en.stage_id
     where s.kind = 'hired'
  )
  select jsonb_build_object(
    'stages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'stage_id', s.id,
               'name', s.name,
               'kind', s.kind,
               'count', coalesce(c.n, 0),
               'reached', coalesce(r.n, 0),
               'median_days', round(m.median_days::numeric, 1)
             ) order by s.position)
        from public.pipeline_stages s
        left join current_counts c on c.stage_id = s.id
        left join reached r on r.stage_id = s.id
        left join medians m on m.stage_id = s.id
       where s.company_id = v_company and not s.archived
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_object_agg(source, n) from (select source, count(*) as n from apps group by source) x
    ), '{}'::jsonb),
    'time_to_hire_days', (select round(median_days::numeric, 1) from hires),
    'total', (select count(*) from apps)
  ) into v_result;

  return v_result;
end $$;

-- Only the jobs the caller can see; applicant counts only where they can see
-- applicants (RP-REQ-010: counts can't leak the rest).
create or replace function public.get_recruiter_job_summaries(
  p_company_id uuid,
  p_status public.job_posting_status default null,
  p_limit integer default 15
)
returns table(
  id uuid, title text, status public.job_posting_status, matching_status public.job_posting_matching_status,
  applicants bigint, new_24h bigint, created_at timestamptz, updated_at timestamptz
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_jobs uuid[];
  v_app_jobs uuid[];
begin
  if not public.is_company_member(p_company_id) or p_company_id is distinct from public.my_company_id() then
    raise exception 'not a member of this company' using errcode = 'insufficient_privilege';
  end if;
  v_jobs := public.my_job_ids_with('jobs.view');
  v_app_jobs := public.my_job_ids_with('applicants.view');

  return query
    select jp.id, jp.title, jp.status, jp.matching_status,
           count(a.id) filter (where jp.id = any (v_app_jobs)) as applicants,
           count(a.id) filter (where jp.id = any (v_app_jobs)
                                 and a.created_at > now() - interval '24 hours') as new_24h,
           jp.created_at, jp.updated_at
      from public.job_postings jp
      left join public.applications a on a.job_post_id = jp.id
     where jp.company_id = p_company_id
       and jp.id = any (v_jobs)
       and (p_status is null or jp.status = p_status)
     group by jp.id
     order by (jp.status = 'active') desc, jp.updated_at desc
     limit least(greatest(coalesce(p_limit, 15), 1), 50);
end;
$$;

create or replace function public.reorder_pipeline_stages(p_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select s.company_id into v_company from public.pipeline_stages s where s.id = p_ids[1];
  if v_company is null or not public.has_company_permission(v_company, 'settings.stages') then
    raise exception 'Stage not found.' using errcode = 'insufficient_privilege';
  end if;

  if cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
     or (select array_agg(s.id order by s.id) from public.pipeline_stages s
          where s.company_id = v_company and not s.archived)
        is distinct from (select array_agg(x order by x) from unnest(p_ids) x) then
    raise exception 'The list must be exactly the company''s active stages.'
      using errcode = 'check_violation';
  end if;

  update public.pipeline_stages s
     set position = o.new_position
    from (
      select id, (row_number() over (order by ord) - 1)::smallint as new_position
      from (
        select t.id, t.ord from unnest(p_ids) with ordinality t(id, ord)
        union all
        select a.id, cardinality(p_ids) + a.position + 1
          from public.pipeline_stages a
         where a.company_id = v_company and a.archived
      ) all_stages
    ) o
   where s.id = o.id and s.position is distinct from o.new_position;
end $$;

-- Each key needs its own permission: the scheduling link needs
-- settings.scheduling, the two notification keys settings.notifications.
create or replace function public.update_company_settings(p_settings jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_company uuid := public.my_company_id();
begin
  if v_company is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object'
     or exists (
       select 1 from jsonb_object_keys(p_settings) k
        where k not in ('scheduling_url', 'notify_new_applicants', 'notify_weekly_matches')
     ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;
  if (p_settings ? 'scheduling_url' and not public.has_company_permission(v_company, 'settings.scheduling'))
     or ((p_settings ? 'notify_new_applicants' or p_settings ? 'notify_weekly_matches')
         and not public.has_company_permission(v_company, 'settings.notifications')) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
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
  when check_violation or invalid_text_representation then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
end $$;

-- outreach.send on the job (no job → scope all), RP-REQ-002.
create or replace function public.send_candidate_outreach(
  p_id uuid, p_candidate uuid, p_job_post uuid, p_subject text, p_message text, p_source text default 'manual'
)
returns public.candidate_outreach
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid := public.my_company_id();
  v_accepts boolean;
  v_recent int;
  v_row public.candidate_outreach;
begin
  if v_uid is null or v_company is null then
    raise exception using errcode = 'P0001', message = 'NOT_MEMBER';
  end if;
  if p_candidate is null or p_source not in ('manual','agent')
     or char_length(coalesce(p_subject, '')) not between 1 and 120
     or char_length(coalesce(p_message, '')) not between 1 and 2000 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  if p_job_post is not null and not exists (
    select 1 from public.job_postings jp where jp.id = p_job_post and jp.company_id = v_company
  ) then
    raise exception using errcode = 'P0001', message = 'JOB_NOT_FOUND';
  end if;

  if not public.has_company_permission(v_company, 'outreach.send', p_job_post) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  if not public.company_can_view_candidate(p_candidate)
     or exists (
       select 1 from public.candidate_company_blocks b
       where b.candidate_user_id = p_candidate and b.company_id = v_company
     ) then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;

  select u.accepts_outreach into v_accepts from public.user_info u where u.user_id = p_candidate;
  if not coalesce(v_accepts, false) then
    raise exception using errcode = 'P0001', message = 'NOT_ACCEPTING';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_company::text || p_candidate::text, 0));

  if exists (
    select 1 from public.candidate_outreach o
    where o.company_id = v_company and o.candidate_user_id = p_candidate and o.status = 'sent'
      and o.job_post_id is not distinct from p_job_post
  ) then
    raise exception using errcode = 'P0001', message = 'ALREADY_OPEN';
  end if;

  select count(*) into v_recent from public.candidate_outreach o
   where o.company_id = v_company and o.candidate_user_id = p_candidate
     and o.sent_at > now() - interval '90 days';
  if v_recent >= 3 then
    raise exception using errcode = 'P0001', message = 'CANDIDATE_LIMIT';
  end if;

  begin
    insert into public.candidate_outreach
      (id, company_id, candidate_user_id, job_post_id, sender_user_id, subject, message, source)
    values
      (coalesce(p_id, gen_random_uuid()), v_company, p_candidate, p_job_post, v_uid,
       p_subject, p_message, p_source)
    returning * into v_row;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'ALREADY_OPEN';
  end;

  insert into public.application_events
    (company_id, application_id, candidate_user_id, actor_user_id, type, payload)
  values
    (v_company, null, p_candidate, v_uid, 'outreach_sent',
     jsonb_build_object('outreach_id', v_row.id, 'job_post_id', v_row.job_post_id));

  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Role, member, owner, invite and assignment RPCs
-- ---------------------------------------------------------------------------
-- Each resolves the caller's company itself, checks the permission and the
-- RP-REQ-012 rules, writes one audit entry and returns { ok, ... } or
-- { ok: false, reason } with reason in: forbidden, above_ceiling, own_role,
-- owner, name_taken, has_members, is_default, invalid_grant, invalid_limit,
-- invalid_name, invalid_role, not_found, primary_owner, last_owner,
-- not_owner, invalid_target, plus the invite reasons.

create or replace function public.audit_actor_kind(p_kind text)
returns text
language sql immutable
set search_path = ''
as $$
  select case when p_kind = 'agent' then 'agent' else 'user' end
$$;

create or replace function public.write_company_audit(
  p_company_id uuid, p_action text, p_target_type text, p_target_id text, p_target_label text,
  p_before jsonb, p_after jsonb, p_actor_kind text default 'user', p_actor uuid default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_actor uuid := coalesce(p_actor, (select auth.uid()));
begin
  insert into public.company_audit_log
    (company_id, actor_user_id, actor_name, actor_kind, action, target_type, target_id, target_label, before, after)
  values
    (p_company_id, v_actor, public.member_display_name(v_actor),
     case when p_actor_kind in ('user', 'agent', 'system') then p_actor_kind else 'user' end,
     p_action, p_target_type, p_target_id, p_target_label, p_before, p_after);
end $$;

-- A role's grants and limits, as the audit log and the lists show them.
create or replace function public.role_snapshot(p_role_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', r.name,
    'description', r.description,
    'color', r.color,
    'grants', coalesce((
      select jsonb_object_agg(rp.permission_key, rp.scope)
        from public.company_role_permissions rp where rp.role_id = r.id
    ), '{}'::jsonb),
    'limits', coalesce((
      select jsonb_object_agg(rl.key, rl.monthly_amount)
        from public.company_role_limits rl where rl.role_id = r.id
    ), '{}'::jsonb)
  )
  from public.company_roles r where r.id = p_role_id
$$;

-- RP-REQ-009: validates [{ key, scope }] and adds every dependency, at the
-- dependent's scope or wider (non-scopable → all). Raises invalid_grant on an
-- unknown key, a bad scope or assigned on a non-scopable key.
create or replace function public.expand_role_grants(p_grants jsonb)
returns table(key text, scope public.permission_scope)
language plpgsql stable
set search_path = ''
as $$
declare
  g jsonb;
  v_scopable boolean;
begin
  if p_grants is null or jsonb_typeof(p_grants) <> 'array' then
    raise exception 'invalid_grant' using errcode = 'P0001';
  end if;
  for g in select * from jsonb_array_elements(p_grants) loop
    select p.scopable into v_scopable from public.company_permissions p where p.key = g ->> 'key';
    if not found or jsonb_typeof(g) <> 'object'
       or coalesce(g ->> 'scope', 'all') not in ('all', 'assigned')
       or (coalesce(g ->> 'scope', 'all') = 'assigned' and not v_scopable) then
      raise exception 'invalid_grant' using errcode = 'P0001';
    end if;
  end loop;

  return query
    with recursive closure(k, s) as (
      select x ->> 'key', coalesce(x ->> 'scope', 'all') from jsonb_array_elements(p_grants) x
      union
      -- A non-scopable dependency is always all. A scopable dependency of a
      -- non-scopable key (jobs.create → jobs.view) only needs assigned: the
      -- creator is assigned to what they create (RP-REQ-011).
      select d.dep, case when not p2.scopable then 'all' when not p.scopable then 'assigned' else c.s end
        from closure c
        join public.company_permissions p on p.key = c.k
        cross join lateral unnest(p.requires) d(dep)
        join public.company_permissions p2 on p2.key = d.dep
    )
    select c.k, (case when bool_or(c.s = 'all') then 'all' else 'assigned' end)::public.permission_scope
      from closure c
     group by c.k;
end $$;

-- RP-REQ-012 rule 1: every grant is held by the caller at that scope or wider,
-- and every limit is at most the caller's own limit for the key.
create or replace function public.within_caller_ceiling(p_company_id uuid, p_grants jsonb, p_limits jsonb)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_role uuid;
  v_owner boolean;
begin
  select m.is_owner, m.role_id into v_owner, v_role from public.company_members m
   where m.company_id = p_company_id and m.user_id = (select auth.uid());
  if not found then return false; end if;
  if v_owner then return true; end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_grants, '[]'::jsonb)) g
     where not exists (
       select 1 from public.company_role_permissions rp
        where rp.role_id = v_role and rp.permission_key = g ->> 'key'
          and (rp.scope = 'all' or coalesce(g ->> 'scope', 'all') = 'assigned')
     )
  ) then
    return false;
  end if;

  if exists (
    select 1 from jsonb_each_text(coalesce(p_limits, '{}'::jsonb)) l(k, v)
      join public.company_role_limits own on own.role_id = v_role and own.key = l.k
     where l.v::int > own.monthly_amount
  ) then
    return false;
  end if;
  return true;
end $$;

create or replace function public.role_grants_json(p_role_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', rp.permission_key, 'scope', rp.scope)), '[]'::jsonb)
    from public.company_role_permissions rp where rp.role_id = p_role_id
$$;

create or replace function public.role_limits_json(p_role_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(rl.key, rl.monthly_amount), '{}'::jsonb)
    from public.company_role_limits rl where rl.role_id = p_role_id
$$;

-- Rules 2–4: a role the caller may edit, assign or act on holders of.
create or replace function public.role_within_caller_ceiling(p_role_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select r.id is not null and public.within_caller_ceiling(
    r.company_id, public.role_grants_json(r.id), public.role_limits_json(r.id)
  )
  from public.company_roles r where r.id = p_role_id
$$;

-- Validates a limits object: allowance keys, whole numbers ≥ 0.
create or replace function public.valid_role_limits(p_limits jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_limits is null or (
    jsonb_typeof(p_limits) = 'object'
    and not exists (
      select 1 from jsonb_each(p_limits) l(k, v)
       where l.k not in ('screenings', 'outreach', 'agent_messages', 'match_explanations', 'interview_minutes')
          or jsonb_typeof(l.v) <> 'number'
          or (l.v #>> '{}') !~ '^\d{1,9}$'
    )
  )
$$;

create or replace function public.write_role_grants(p_role_id uuid, p_grants jsonb, p_limits jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_grants is not null then
    delete from public.company_role_permissions where role_id = p_role_id;
    insert into public.company_role_permissions (role_id, permission_key, scope)
    select p_role_id, e.key, e.scope from public.expand_role_grants(p_grants) e;
  end if;
  if p_limits is not null then
    delete from public.company_role_limits where role_id = p_role_id;
    insert into public.company_role_limits (role_id, key, monthly_amount)
    select p_role_id, l.k, l.v::int from jsonb_each_text(p_limits) l(k, v);
  end if;
end $$;

-- The expanded grant list for a ceiling check, as jsonb.
create or replace function public.expanded_grants_json(p_grants jsonb)
returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', e.key, 'scope', e.scope)), '[]'::jsonb)
    from public.expand_role_grants(p_grants) e
$$;

create or replace function public.create_company_role(
  p_name text, p_description text default null, p_color text default 'slate',
  p_grants jsonb default '[]'::jsonb, p_limits jsonb default '{}'::jsonb,
  p_template_key text default null, p_actor_kind text default 'user'
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_name text := btrim(coalesce(p_name, ''));
  v_grants jsonb;
  v_id uuid;
begin
  if v_company is null or not public.has_company_permission(v_company, 'roles.manage') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if char_length(v_name) not between 1 and 40 or char_length(coalesce(p_description, '')) > 200
     or coalesce(p_color, 'slate') not in ('slate', 'indigo', 'emerald', 'amber', 'rose', 'sky', 'violet', 'teal') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;
  if not public.valid_role_limits(coalesce(p_limits, '{}'::jsonb)) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_limit');
  end if;
  begin
    v_grants := public.expanded_grants_json(coalesce(p_grants, '[]'::jsonb));
  exception when sqlstate 'P0001' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_grant');
  end;
  if not public.within_caller_ceiling(v_company, v_grants, p_limits) then
    return jsonb_build_object('ok', false, 'reason', 'above_ceiling');
  end if;
  if exists (select 1 from public.company_roles r where r.company_id = v_company and lower(btrim(r.name)) = lower(v_name)) then
    return jsonb_build_object('ok', false, 'reason', 'name_taken');
  end if;

  insert into public.company_roles (company_id, name, description, color, template_key, created_by)
  values (v_company, v_name, nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_color, 'slate'),
          p_template_key, (select auth.uid()))
  returning id into v_id;
  perform public.write_role_grants(v_id, v_grants, coalesce(p_limits, '{}'::jsonb));

  perform public.write_company_audit(v_company, 'role.created', 'role', v_id::text, v_name,
    null, public.role_snapshot(v_id), public.audit_actor_kind(p_actor_kind));
  return jsonb_build_object('ok', true, 'id', v_id);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'reason', 'name_taken');
end $$;

-- Null p_name, p_description, p_color, p_grants or p_limits means unchanged
-- ('' clears the description). Rule 5: the caller's own role can be renamed
-- but its grants and limits can't change.
create or replace function public.update_company_role(
  p_role_id uuid, p_name text default null, p_description text default null, p_color text default null,
  p_grants jsonb default null, p_limits jsonb default null, p_actor_kind text default 'user'
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_role public.company_roles;
  v_before jsonb;
  v_after jsonb;
  v_grants jsonb;
  v_name text;
  v_own uuid;
begin
  if v_company is null or not public.has_company_permission(v_company, 'roles.manage') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_role from public.company_roles r where r.id = p_role_id and r.company_id = v_company for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.role_within_caller_ceiling(p_role_id) then
    return jsonb_build_object('ok', false, 'reason', 'above_ceiling');
  end if;

  v_name := case when p_name is null then v_role.name else btrim(p_name) end;
  if char_length(v_name) not between 1 and 40 or char_length(coalesce(p_description, '')) > 200
     or (p_color is not null and p_color not in ('slate', 'indigo', 'emerald', 'amber', 'rose', 'sky', 'violet', 'teal')) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;
  if not public.valid_role_limits(p_limits) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_limit');
  end if;
  if p_grants is not null then
    begin
      v_grants := public.expanded_grants_json(p_grants);
    exception when sqlstate 'P0001' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_grant');
    end;
  end if;

  v_before := public.role_snapshot(p_role_id);

  select m.role_id into v_own from public.company_members m
   where m.company_id = v_company and m.user_id = (select auth.uid()) and not m.is_owner;
  if v_own = p_role_id and (
       (v_grants is not null and (
          select coalesce(jsonb_object_agg(x ->> 'key', x ->> 'scope'), '{}'::jsonb)
            from jsonb_array_elements(v_grants) x
        ) is distinct from v_before -> 'grants')
       or (p_limits is not null and p_limits is distinct from v_before -> 'limits')
     ) then
    return jsonb_build_object('ok', false, 'reason', 'own_role');
  end if;
  if not public.within_caller_ceiling(v_company, coalesce(v_grants, '[]'::jsonb), p_limits) then
    return jsonb_build_object('ok', false, 'reason', 'above_ceiling');
  end if;
  if exists (
    select 1 from public.company_roles r
     where r.company_id = v_company and r.id <> p_role_id and lower(btrim(r.name)) = lower(v_name)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'name_taken');
  end if;

  update public.company_roles set
    name = v_name,
    description = case when p_description is null then description else nullif(btrim(p_description), '') end,
    color = coalesce(p_color, color),
    updated_at = now()
  where id = p_role_id;
  perform public.write_role_grants(p_role_id, v_grants, p_limits);

  v_after := public.role_snapshot(p_role_id);
  if v_after is distinct from v_before then
    perform public.write_company_audit(v_company, 'role.updated', 'role', p_role_id::text, v_name,
      v_before, v_after, public.audit_actor_kind(p_actor_kind));
  end if;
  return jsonb_build_object('ok', true, 'id', p_role_id);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'reason', 'name_taken');
end $$;

-- RP-REQ-008: members and open invites move to the replacement in the same
-- transaction; the default role can't be deleted.
create or replace function public.delete_company_role(
  p_role_id uuid, p_replacement_role_id uuid default null, p_actor_kind text default 'user'
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_role public.company_roles;
  v_replacement public.company_roles;
  v_before jsonb;
  v_holders int;
begin
  if v_company is null or not public.has_company_permission(v_company, 'roles.manage') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_role from public.company_roles r where r.id = p_role_id and r.company_id = v_company for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.role_within_caller_ceiling(p_role_id) then
    return jsonb_build_object('ok', false, 'reason', 'above_ceiling');
  end if;
  if exists (select 1 from public.company_info ci where ci.id = v_company and ci.default_role_id = p_role_id) then
    return jsonb_build_object('ok', false, 'reason', 'is_default');
  end if;
  if exists (
    select 1 from public.company_members m
     where m.company_id = v_company and m.user_id = (select auth.uid()) and m.role_id = p_role_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'own_role');
  end if;

  select count(*) into v_holders from (
    select 1 from public.company_members m where m.role_id = p_role_id
    union all
    select 1 from public.company_invites i
     where i.role_id = p_role_id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  ) x;

  if v_holders > 0 then
    if p_replacement_role_id is null then
      return jsonb_build_object('ok', false, 'reason', 'has_members');
    end if;
    select * into v_replacement from public.company_roles r
     where r.id = p_replacement_role_id and r.company_id = v_company and r.id <> p_role_id;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
    if not public.role_within_caller_ceiling(p_replacement_role_id) then
      return jsonb_build_object('ok', false, 'reason', 'above_ceiling');
    end if;
    update public.company_members set role_id = p_replacement_role_id where role_id = p_role_id;
  end if;
  -- Closed invites keep their history; their role goes (on delete set null).
  update public.company_invites set role_id = p_replacement_role_id
   where role_id = p_role_id and accepted_at is null and revoked_at is null;

  v_before := public.role_snapshot(p_role_id);
  delete from public.company_roles where id = p_role_id;

  perform public.write_company_audit(v_company, 'role.deleted', 'role', p_role_id::text, v_role.name,
    v_before,
    case when v_replacement.id is null then null
         else jsonb_build_object('replacement', jsonb_build_object('id', v_replacement.id, 'name', v_replacement.name),
                                 'moved', v_holders) end,
    public.audit_actor_kind(p_actor_kind));
  return jsonb_build_object('ok', true, 'moved', v_holders);
end $$;

create or replace function public.set_default_company_role(p_role_id uuid, p_actor_kind text default 'user')
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_role public.company_roles;
  v_old uuid;
begin
  if v_company is null or not public.has_company_permission(v_company, 'roles.manage') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_role from public.company_roles r where r.id = p_role_id and r.company_id = v_company;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.role_within_caller_ceiling(p_role_id) then
    return jsonb_build_object('ok', false, 'reason', 'above_ceiling');
  end if;
  select default_role_id into v_old from public.company_info where id = v_company for update;
  if v_old = p_role_id then
    return jsonb_build_object('ok', true);
  end if;
  update public.company_info set default_role_id = p_role_id where id = v_company;
  perform public.write_company_audit(v_company, 'role.default_changed', 'role', p_role_id::text, v_role.name,
    case when v_old is null then null
         else jsonb_build_object('id', v_old, 'name', (select name from public.company_roles where id = v_old)) end,
    jsonb_build_object('id', v_role.id, 'name', v_role.name),
    public.audit_actor_kind(p_actor_kind));
  return jsonb_build_object('ok', true);
end $$;

-- Members (RP-REQ-007, rules 3–5).
create or replace function public.set_company_member_role(
  p_user_id uuid, p_role_id uuid, p_actor_kind text default 'user'
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_target public.company_members;
  v_role public.company_roles;
  v_old_name text;
begin
  if v_company is null or not public.has_company_permission(v_company, 'team.assign_roles') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_target from public.company_members m
   where m.company_id = v_company and m.user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if p_user_id = (select auth.uid()) then
    return jsonb_build_object('ok', false, 'reason', 'own_role');
  end if;
  if v_target.is_owner then
    return jsonb_build_object('ok', false, 'reason', 'owner');
  end if;
  if not public.role_within_caller_ceiling(v_target.role_id) then
    return jsonb_build_object('ok', false, 'reason', 'above_ceiling');
  end if;
  select * into v_role from public.company_roles r where r.id = p_role_id and r.company_id = v_company;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_role');
  end if;
  if not public.role_within_caller_ceiling(p_role_id) then
    return jsonb_build_object('ok', false, 'reason', 'above_ceiling');
  end if;
  if v_target.role_id = p_role_id then
    return jsonb_build_object('ok', true);
  end if;

  select name into v_old_name from public.company_roles where id = v_target.role_id;
  update public.company_members set role_id = p_role_id where company_id = v_company and user_id = p_user_id;
  perform public.write_company_audit(v_company, 'member.role_changed', 'member', p_user_id::text,
    public.member_display_name(p_user_id),
    jsonb_build_object('role', jsonb_build_object('id', v_target.role_id, 'name', v_old_name)),
    jsonb_build_object('role', jsonb_build_object('id', v_role.id, 'name', v_role.name)),
    public.audit_actor_kind(p_actor_kind));
  return jsonb_build_object('ok', true);
end $$;

-- Leaving is always allowed except for the primary owner (RP-REQ-006).
-- Removing someone else needs team.remove; only owners remove an owner, and
-- nobody removes the primary owner.
create or replace function public.remove_company_member(p_user_id uuid, p_actor_kind text default 'user')
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid := public.my_company_id();
  v_target public.company_members;
  v_primary uuid;
  v_name text;
  v_role_name text;
begin
  if v_company is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_target from public.company_members m
   where m.company_id = v_company and m.user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select user_id into v_primary from public.company_info where id = v_company;
  if p_user_id = v_primary then
    return jsonb_build_object('ok', false, 'reason', 'primary_owner');
  end if;

  if p_user_id is distinct from v_uid then
    if not public.has_company_permission(v_company, 'team.remove') then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    if v_target.is_owner and not public.caller_is_owner(v_company) then
      return jsonb_build_object('ok', false, 'reason', 'owner');
    end if;
    if not v_target.is_owner and not public.role_within_caller_ceiling(v_target.role_id) then
      return jsonb_build_object('ok', false, 'reason', 'above_ceiling');
    end if;
  end if;

  v_name := public.member_display_name(p_user_id);
  select name into v_role_name from public.company_roles where id = v_target.role_id;
  delete from public.company_job_assignments where company_id = v_company and user_id = p_user_id;
  delete from public.company_members where company_id = v_company and user_id = p_user_id;

  perform public.write_company_audit(v_company,
    case when p_user_id = v_uid then 'member.left' else 'member.removed' end,
    'member', p_user_id::text, v_name,
    jsonb_build_object('is_owner', v_target.is_owner,
                       'role', case when v_target.role_id is null then null
                                    else jsonb_build_object('id', v_target.role_id, 'name', v_role_name) end),
    null, public.audit_actor_kind(p_actor_kind));
  return jsonb_build_object('ok', true);
end $$;

-- Owners (RP-REQ-006): only owners call these.
create or replace function public.set_company_owner(
  p_user_id uuid, p_is_owner boolean, p_role_id uuid default null, p_actor_kind text default 'user'
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_target public.company_members;
  v_role public.company_roles;
  v_primary uuid;
begin
  if v_company is null or not public.caller_is_owner(v_company) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_target from public.company_members m
   where m.company_id = v_company and m.user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if coalesce(p_is_owner, false) then
    if v_target.is_owner then
      return jsonb_build_object('ok', true);
    end if;
    select * into v_role from public.company_roles where id = v_target.role_id;
    update public.company_members set is_owner = true, role_id = null
     where company_id = v_company and user_id = p_user_id;
    perform public.write_company_audit(v_company, 'owner.added', 'member', p_user_id::text,
      public.member_display_name(p_user_id),
      jsonb_build_object('role', jsonb_build_object('id', v_role.id, 'name', v_role.name)),
      jsonb_build_object('is_owner', true), public.audit_actor_kind(p_actor_kind));
    return jsonb_build_object('ok', true);
  end if;

  if not v_target.is_owner then
    return jsonb_build_object('ok', false, 'reason', 'not_owner');
  end if;
  select user_id into v_primary from public.company_info where id = v_company;
  if p_user_id = v_primary then
    return jsonb_build_object('ok', false, 'reason', 'primary_owner');
  end if;
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company and m.is_owner and m.user_id <> p_user_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'last_owner');
  end if;
  select * into v_role from public.company_roles r where r.id = p_role_id and r.company_id = v_company;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_role');
  end if;

  update public.company_members set is_owner = false, role_id = p_role_id
   where company_id = v_company and user_id = p_user_id;
  perform public.write_company_audit(v_company, 'owner.removed', 'member', p_user_id::text,
    public.member_display_name(p_user_id),
    jsonb_build_object('is_owner', true),
    jsonb_build_object('role', jsonb_build_object('id', v_role.id, 'name', v_role.name)),
    public.audit_actor_kind(p_actor_kind));
  return jsonb_build_object('ok', true);
end $$;

-- The primary owner is the billing contact (RP-DEC-002); the target must
-- already be an owner. company_info.user_id follows (TM-CON-001).
create or replace function public.make_primary_owner(p_user_id uuid, p_actor_kind text default 'user')
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_old uuid;
begin
  if v_company is null or not public.caller_is_owner(v_company) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company and m.user_id = p_user_id and m.is_owner
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_owner');
  end if;
  select user_id into v_old from public.company_info where id = v_company for update;
  if v_old = p_user_id then
    return jsonb_build_object('ok', true);
  end if;
  update public.company_info set user_id = p_user_id, updated_at = now() where id = v_company;
  perform public.write_company_audit(v_company, 'owner.primary_changed', 'member', p_user_id::text,
    public.member_display_name(p_user_id),
    jsonb_build_object('user_id', v_old, 'name', public.member_display_name(v_old)),
    jsonb_build_object('user_id', p_user_id, 'name', public.member_display_name(p_user_id)),
    public.audit_actor_kind(p_actor_kind));
  return jsonb_build_object('ok', true);
end $$;

-- Invites carry a role (RP-REQ-007); null means the default role. Pending
-- invites take a seat (TM-REQ-005).
create or replace function public.create_company_invite(
  p_email text, p_role_id uuid default null, p_actor_kind text default 'user'
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid := public.my_company_id();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role public.company_roles;
  v_token text;
  v_id uuid;
begin
  if v_company is null or not public.has_company_permission(v_company, 'team.invite') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_role from public.company_roles r
   where r.company_id = v_company
     and r.id = coalesce(p_role_id, (select ci.default_role_id from public.company_info ci where ci.id = v_company));
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_role');
  end if;
  if not public.role_within_caller_ceiling(v_role.id) then
    return jsonb_build_object('ok', false, 'reason', 'above_ceiling');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 320 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_email');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('company_invites:' || v_company::text, 0));

  if exists (
    select 1 from public.company_members m join auth.users u on u.id = m.user_id
     where m.company_id = v_company and lower(u.email) = v_email
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_member');
  end if;

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

  insert into public.company_invites (company_id, email, role_id, token_hash, invited_by)
  values (v_company, v_email, v_role.id, public.team_invite_hash(v_token), v_uid)
  returning id into v_id;

  perform public.write_company_audit(v_company, 'invite.created', 'invite', v_id::text, v_email,
    null, jsonb_build_object('role', jsonb_build_object('id', v_role.id, 'name', v_role.name)),
    public.audit_actor_kind(p_actor_kind));
  return jsonb_build_object('ok', true, 'id', v_id, 'token', v_token,
                            'role', jsonb_build_object('id', v_role.id, 'name', v_role.name));
end $$;

create or replace function public.revoke_company_invite(p_invite_id uuid, p_actor_kind text default 'user')
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_email text;
begin
  if v_company is null or not public.has_company_permission(v_company, 'team.invite') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  update public.company_invites set revoked_at = now()
   where id = p_invite_id and company_id = v_company
     and accepted_at is null and revoked_at is null
  returning email into v_email;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  perform public.write_company_audit(v_company, 'invite.revoked', 'invite', p_invite_id::text, v_email,
    null, null, public.audit_actor_kind(p_actor_kind));
  return jsonb_build_object('ok', true);
end $$;

-- TM-SEC-002 / TM-REQ-003, now with the invite's role, or the default role
-- when that role was deleted (RP-REQ-007; the join page says so).
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
  v_role public.company_roles;
  v_fell_back boolean := false;
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

  v_limit := (public.check_entitlement(v_invite.company_id, 'seats', 1) ->> 'amount')::int;
  if v_limit is not null and public.billing_limit_used(v_invite.company_id, 'seats') > v_limit then
    return jsonb_build_object('ok', false, 'reason', 'seat_limit');
  end if;

  select * into v_role from public.company_roles r
   where r.id = v_invite.role_id and r.company_id = v_invite.company_id;
  if not found then
    v_fell_back := true;
    select r.* into v_role from public.company_roles r
      join public.company_info ci on ci.default_role_id = r.id
     where ci.id = v_invite.company_id;
  end if;

  v_name := left(coalesce(nullif(btrim(p_display_name), ''), nullif(btrim(v_full_name), '')), 80);

  insert into public.company_members (company_id, user_id, role_id, display_name)
  values (v_invite.company_id, v_uid, v_role.id, v_name);

  update public.company_invites set accepted_at = now(), accepted_by = v_uid
   where id = v_invite.id;

  perform public.write_company_audit(v_invite.company_id, 'invite.accepted', 'invite', v_invite.id::text,
    v_invite.email, null,
    jsonb_build_object('role', jsonb_build_object('id', v_role.id, 'name', v_role.name), 'fell_back', v_fell_back),
    'user', v_uid);

  return jsonb_build_object('ok', true, 'company_id', v_invite.company_id,
    'role', jsonb_build_object('id', v_role.id, 'name', v_role.name), 'fell_back', v_fell_back);
end $$;

-- Job assignments (RP-REQ-011, rule 6): jobs.assign on the job; the target
-- must be a non-owner member whose role has a job-scopable permission, and
-- within the caller's ceiling (rule 4).
create or replace function public.assign_job(p_job_post_id uuid, p_user_id uuid, p_actor_kind text default 'user')
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_job public.job_postings;
  v_target public.company_members;
begin
  if v_company is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_job from public.job_postings jp where jp.id = p_job_post_id and jp.company_id = v_company;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.has_company_permission(v_company, 'jobs.assign', p_job_post_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_target from public.company_members m where m.company_id = v_company and m.user_id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_target.is_owner or not exists (
    select 1 from public.company_role_permissions rp
      join public.company_permissions p on p.key = rp.permission_key
     where rp.role_id = v_target.role_id and p.scopable
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_target');
  end if;
  if not public.role_within_caller_ceiling(v_target.role_id) then
    return jsonb_build_object('ok', false, 'reason', 'above_ceiling');
  end if;

  insert into public.company_job_assignments (company_id, job_post_id, user_id, assigned_by)
  values (v_company, p_job_post_id, p_user_id, (select auth.uid()))
  on conflict do nothing;
  if not found then
    return jsonb_build_object('ok', true);
  end if;
  perform public.write_company_audit(v_company, 'job.assigned', 'job', p_job_post_id::text, v_job.title,
    null, jsonb_build_object('user_id', p_user_id, 'name', public.member_display_name(p_user_id)),
    public.audit_actor_kind(p_actor_kind));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.unassign_job(p_job_post_id uuid, p_user_id uuid, p_actor_kind text default 'user')
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_job public.job_postings;
  v_target public.company_members;
begin
  if v_company is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_job from public.job_postings jp where jp.id = p_job_post_id and jp.company_id = v_company;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.has_company_permission(v_company, 'jobs.assign', p_job_post_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_target from public.company_members m where m.company_id = v_company and m.user_id = p_user_id;
  if found and not v_target.is_owner and not public.role_within_caller_ceiling(v_target.role_id) then
    return jsonb_build_object('ok', false, 'reason', 'above_ceiling');
  end if;

  delete from public.company_job_assignments where job_post_id = p_job_post_id and user_id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  perform public.write_company_audit(v_company, 'job.unassigned', 'job', p_job_post_id::text, v_job.title,
    jsonb_build_object('user_id', p_user_id, 'name', public.member_display_name(p_user_id)), null,
    public.audit_actor_kind(p_actor_kind));
  return jsonb_build_object('ok', true);
end $$;

-- RP-REQ-011: the creator of a job is assigned to it. Direct inserts (the
-- user's client) through the trigger; the app's service-role insert calls
-- assign_job_creator with the session user right after.
create or replace function public.assign_job_creator(p_job_post_id uuid, p_user_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_job public.job_postings;
begin
  select * into v_job from public.job_postings where id = p_job_post_id;
  if not found or p_user_id is null then
    return;
  end if;
  if exists (
    select 1 from public.company_members m
     where m.company_id = v_job.company_id and m.user_id = p_user_id and not m.is_owner
  ) then
    insert into public.company_job_assignments (company_id, job_post_id, user_id, assigned_by)
    values (v_job.company_id, p_job_post_id, p_user_id, p_user_id)
    on conflict do nothing;
    if found then
      perform public.write_company_audit(v_job.company_id, 'job.assigned', 'job', p_job_post_id::text, v_job.title,
        null, jsonb_build_object('user_id', p_user_id, 'name', public.member_display_name(p_user_id), 'creator', true),
        'system', p_user_id);
    end if;
  end if;
end $$;

create or replace function public.assign_job_creator_trigger()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    perform public.assign_job_creator(new.id, (select auth.uid()));
  end if;
  return new;
end $$;

drop trigger if exists job_postings_assign_creator on public.job_postings;
create trigger job_postings_assign_creator
  after insert on public.job_postings
  for each row execute function public.assign_job_creator_trigger();

-- ---------------------------------------------------------------------------
-- 8. Reads
-- ---------------------------------------------------------------------------

-- RP-SEC-004: what getMyCompany loads per request, in one round trip.
create or replace function public.my_company_access()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'company', jsonb_build_object('id', ci.id, 'name', ci.name, 'email', ci.email, 'user_id', ci.user_id),
    'display_name', m.display_name,
    'is_owner', m.is_owner,
    'is_primary_owner', ci.user_id = m.user_id,
    'role', case when r.id is null then null
                 else jsonb_build_object('id', r.id, 'name', r.name, 'color', r.color) end,
    'grants', case when m.is_owner then '[]'::jsonb else public.role_grants_json(m.role_id) end,
    'assigned_job_ids', coalesce((
      select jsonb_agg(ja.job_post_id) from public.company_job_assignments ja
       where ja.user_id = m.user_id and ja.company_id = m.company_id
    ), '[]'::jsonb),
    'limits', case when m.is_owner then '{}'::jsonb else public.role_limits_json(m.role_id) end
  )
  from public.company_members m
  join public.company_info ci on ci.id = m.company_id
  left join public.company_roles r on r.id = m.role_id
  where m.user_id = (select auth.uid())
$$;

-- TM-REQ-006, RP-REQ-013: members and open invites, for team.view.
create or replace function public.list_company_team()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case when not public.has_company_permission(public.my_company_id(), 'team.view') then null
  else jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', m.user_id,
               'email', u.email,
               'display_name', m.display_name,
               'is_owner', m.is_owner,
               'is_primary_owner', ci.user_id = m.user_id,
               'role', case when r.id is null then null
                            else jsonb_build_object('id', r.id, 'name', r.name, 'color', r.color) end,
               'assigned_job_ids', coalesce((
                 select jsonb_agg(ja.job_post_id) from public.company_job_assignments ja
                  where ja.user_id = m.user_id and ja.company_id = m.company_id
               ), '[]'::jsonb),
               'joined_at', m.created_at,
               'last_active_at', m.last_active_at
             ) order by (ci.user_id = m.user_id) desc, m.is_owner desc, r.name nulls first, m.created_at)
        from public.company_members m
        join auth.users u on u.id = m.user_id
        join public.company_info ci on ci.id = m.company_id
        left join public.company_roles r on r.id = m.role_id
       where m.company_id = public.my_company_id()
    ), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id,
               'email', i.email,
               'role', case when r.id is null then null
                            else jsonb_build_object('id', r.id, 'name', r.name, 'color', r.color) end,
               'invited_by', public.member_display_name(i.invited_by),
               'created_at', i.created_at,
               'expires_at', i.expires_at
             ) order by i.created_at desc)
        from public.company_invites i
        left join public.company_roles r on r.id = i.role_id
       where i.company_id = public.my_company_id()
         and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    ), '[]'::jsonb)
  ) end
$$;

-- RP-REQ-014: roles with member counts, grants and limits, for roles.view.
create or replace function public.list_company_roles()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case when not public.has_company_permission(public.my_company_id(), 'roles.view') then null
  else coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id,
             'name', r.name,
             'description', r.description,
             'color', r.color,
             'template_key', r.template_key,
             'is_default', ci.default_role_id = r.id,
             'member_count', (select count(*) from public.company_members m where m.role_id = r.id),
             'invite_count', (
               select count(*) from public.company_invites i
                where i.role_id = r.id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
             ),
             'members', coalesce((
               select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', public.member_display_name(m.user_id))
                                order by m.created_at)
                 from public.company_members m where m.role_id = r.id
             ), '[]'::jsonb),
             'grants', public.role_grants_json(r.id),
             'limits', public.role_limits_json(r.id),
             'updated_at', r.updated_at
           ) order by lower(r.name))
      from public.company_roles r
      join public.company_info ci on ci.id = r.company_id
     where r.company_id = public.my_company_id()
  ), '[]'::jsonb) end
$$;

-- RP-REQ-015: newest first, keyset by id; filters by actor, action and date.
create or replace function public.list_company_audit(
  p_before bigint default null, p_limit int default 50, p_actor uuid default null,
  p_action text default null, p_since timestamptz default null, p_until timestamptz default null
)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case when not public.has_company_permission(public.my_company_id(), 'audit.view') then null
  else coalesce((
    select jsonb_agg(to_jsonb(x) order by x.id desc)
      from (
        select a.id, a.actor_user_id, a.actor_name, a.actor_kind, a.action, a.target_type, a.target_id,
               a.target_label, a.before, a.after, a.created_at
          from public.company_audit_log a
         where a.company_id = public.my_company_id()
           and (p_before is null or a.id < p_before)
           and (p_actor is null or a.actor_user_id = p_actor)
           and (p_action is null or a.action = p_action or a.action like p_action || '.%')
           and (p_since is null or a.created_at >= p_since)
           and (p_until is null or a.created_at < p_until)
         order by a.id desc
         limit least(greatest(coalesce(p_limit, 50), 1), 100)
      ) x
  ), '[]'::jsonb) end
$$;

-- ---------------------------------------------------------------------------
-- 9. Drop the enum era
-- ---------------------------------------------------------------------------

drop function if exists public.transfer_company_ownership(uuid);
drop function if exists public.backfill_company_owners();
drop function if exists public.set_company_member_role(uuid, public.company_role);
drop function if exists public.create_company_invite(text, public.company_role);
drop function if exists public.remove_company_member(uuid);
drop function if exists public.revoke_company_invite(uuid);
drop function if exists public.is_company_admin(uuid);
drop function if exists public.company_role(uuid);
drop index if exists public.company_members_one_owner;

alter table public.company_members drop column if exists role;
alter table public.company_invites drop column if exists role;
drop type if exists public.company_role;

-- ---------------------------------------------------------------------------
-- 10. Privileges
-- ---------------------------------------------------------------------------

-- RP-SEC-002: select only; every write is an RPC.
revoke all on public.company_permissions, public.company_roles, public.company_role_permissions,
  public.company_role_limits, public.company_job_assignments, public.company_audit_log
  from anon, authenticated;
grant select on public.company_permissions, public.company_roles, public.company_role_permissions,
  public.company_role_limits, public.company_job_assignments, public.company_audit_log
  to authenticated;
grant select (role_id) on public.company_invites to authenticated;

do $$
declare f text;
begin
  -- Called by users (each checks the caller itself).
  foreach f in array array[
    'has_company_permission(uuid, text, uuid)',
    'company_permission_scope(uuid, text)',
    'my_job_ids_with(text)',
    'my_company_access()',
    'list_company_team()',
    'list_company_roles()',
    'list_company_audit(bigint, integer, uuid, text, timestamptz, timestamptz)',
    'create_company_role(text, text, text, jsonb, jsonb, text, text)',
    'update_company_role(uuid, text, text, text, jsonb, jsonb, text)',
    'delete_company_role(uuid, uuid, text)',
    'set_default_company_role(uuid, text)',
    'set_company_member_role(uuid, uuid, text)',
    'remove_company_member(uuid, text)',
    'set_company_owner(uuid, boolean, uuid, text)',
    'make_primary_owner(uuid, text)',
    'create_company_invite(text, uuid, text)',
    'revoke_company_invite(uuid, text)',
    'accept_company_invite(text, text)',
    'assign_job(uuid, uuid, text)',
    'unassign_job(uuid, uuid, text)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;

  -- Used inside policies (must be executable by authenticated) but harmless.
  foreach f in array array[
    'application_job_id(uuid)', 'try_uuid(text)', 'caller_is_owner(uuid)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;

  -- Internal only.
  foreach f in array array[
    'seed_company_roles(uuid)', 'backfill_company_roles()', 'seed_company_roles_trigger()',
    'seed_owner_membership()', 'guard_role_permission()', 'check_role_dependencies()',
    'guard_member_role_company()', 'check_company_owners()', 'guard_job_posting_update()',
    'audit_actor_kind(text)', 'write_company_audit(uuid, text, text, text, text, jsonb, jsonb, text, uuid)',
    'role_snapshot(uuid)', 'expand_role_grants(jsonb)', 'within_caller_ceiling(uuid, jsonb, jsonb)',
    'role_grants_json(uuid)', 'role_limits_json(uuid)', 'role_within_caller_ceiling(uuid)',
    'valid_role_limits(jsonb)', 'write_role_grants(uuid, jsonb, jsonb)', 'expanded_grants_json(jsonb)',
    'assign_job_creator(uuid, uuid)', 'assign_job_creator_trigger()'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
