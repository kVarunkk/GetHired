-- Bulk candidate import, phase 1 (plan/bulk-import/feature-bulk-import-spec.md,
-- tasks BIT-011 and BIT-013 in plan/bulk-import/feature-bulk-import-tasks.md):
-- company candidates, the import tables, the applications columns, talent
-- lists that hold company candidates, the permission, the resume_imports
-- allowance, and the RPCs that write candidates.
--
-- Tests: supabase/tests/bulk_import.sql (blocks 1 and 2).
--
--  1. Permission applicants.import (BI-PERM-001)
--  2. Allowance resume_imports (BI-REQ-021, BI-DEC-008)
--  3. Tables: candidate_import_batches, company_candidates, candidate_import_rows,
--     candidate_import_mappings
--  4. applications: company_candidate_id, merged_into_application_id, import_batch_id
--  5. Statuses, event types and audit actions
--  6. talent_list_members holds company candidates (BI-DEC-003); notes on
--     imported applications
--  7. RLS and grants
--  8. Triggers on applications that skip imported rows
--  9. RPCs: match_known_applicants, start_candidate_import, confirm_candidate_import,
--     add_candidates_to_job, update_company_candidate, delete_company_candidates
-- 10. The funnel leaves merged applications out (BI-REQ-042)

-- ---------------------------------------------------------------------------
-- 1. Permission (BI-PERM-001)
-- ---------------------------------------------------------------------------

insert into public.company_permissions (key, scopable, requires) values
  ('applicants.import', true, '{applicants.view}')
on conflict (key) do update set scopable = excluded.scopable, requires = excluded.requires;

-- Admin: every permission but company.profile (RP-REQ-004).
insert into public.company_role_permissions (role_id, permission_key, scope)
select r.id, 'applicants.import', 'all'
  from public.company_roles r
 where r.template_key = 'admin'
on conflict do nothing;

-- Member: for their assigned jobs only. Hiring manager: off.
insert into public.company_role_permissions (role_id, permission_key, scope)
select r.id, 'applicants.import', 'assigned'
  from public.company_roles r
 where r.template_key = 'member'
on conflict do nothing;

-- New companies get the same keys (helpers/companies/role-templates.ts).
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
                'interviews.view', 'notes.view', 'notes.write', 'talent.view', 'talent.save',
                'talent_lists.manage', 'matching.run', 'outreach.view', 'outreach.send',
                'agent.use', 'team.view', 'roles.view', 'billing.view']
        ) k;
      insert into public.company_role_permissions (role_id, permission_key, scope)
      select v_member, k, 'assigned'
        from unnest(
          -- @member-assigned-keys (helpers/companies/role-templates.ts MEMBER_ASSIGNED_KEYS)
          array['applicants.import']
        ) k;
    end if;
  end if;

  update public.company_info set default_role_id = v_member
   where id = p_company_id and default_role_id is null and v_member is not null;
end $$;

revoke all on function public.seed_company_roles(uuid) from public, anon, authenticated;
grant execute on function public.seed_company_roles(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Allowance resume_imports (BI-DEC-008): Free 25/month (hard stop), every
--    paid tier 500/month with overage credits, Enterprise unlimited like its
--    other keys. Keep in sync with helpers/billing/keys.ts.
-- ---------------------------------------------------------------------------

alter table public.tier_entitlements drop constraint if exists tier_entitlements_key_check;
alter table public.tier_entitlements add constraint tier_entitlements_key_check check (key in (
  'active_job_posts', 'seats', 'profiles_per_search',
  'screenings', 'outreach', 'interview_minutes', 'agent_messages', 'match_explanations', 'resume_imports'
));

insert into public.tier_entitlements (tier_id, key, kind, amount, overage_credits)
select t.id, 'resume_imports', 'allowance', v.amount, v.overage
  from (values
    ('free', 25, null::int),
    ('startup', 500, 1),
    ('founding', 500, 1),
    ('paid-1', 500, 1),
    ('growth', 500, 1),
    ('paid-2', 500, 1),
    ('enterprise', null::int, null::int)
  ) as v(slug, amount, overage)
  join public.company_tiers t on t.slug = v.slug
on conflict (tier_id, key) do nothing;

create or replace function public.billing_assert_key(p_key text)
returns void
language plpgsql immutable
set search_path = public, pg_temp
as $$
begin
  if p_key is null or p_key not in ('active_job_posts', 'seats', 'profiles_per_search',
      'screenings', 'outreach', 'interview_minutes', 'agent_messages', 'match_explanations',
      'resume_imports') then
    raise exception 'unknown entitlement key: %', p_key using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

-- Same as 20261014150000_company_billing.sql, with resume_imports.
create or replace function public.get_company_entitlements(p_company_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.company_subscriptions%rowtype;
  v_tier public.company_tiers%rowtype;
  v_entitlements jsonb := '{}'::jsonb;
  v_check jsonb;
  k text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_company_member(p_company_id) then
    raise exception 'not a member of company %', p_company_id using errcode = 'insufficient_privilege';
  end if;

  select * into v_sub from public.company_subscriptions where company_id = p_company_id;
  if not found then
    raise exception 'company % has no subscription', p_company_id;
  end if;
  select * into v_tier from public.company_tiers where id = public.company_effective_tier(p_company_id);

  foreach k in array array['active_job_posts', 'seats', 'profiles_per_search', 'screenings',
                           'outreach', 'interview_minutes', 'agent_messages', 'match_explanations',
                           'resume_imports']
  loop
    v_check := public.check_entitlement(p_company_id, k, 1);
    v_entitlements := v_entitlements || jsonb_build_object(k, jsonb_build_object(
      'kind', v_check->'kind',
      'amount', v_check->'amount',
      'used', v_check->'used',
      'held', v_check->'held',
      'remaining', v_check->'remaining',
      'overage_credits', v_check->'overage_credits'
    ));
  end loop;

  return jsonb_build_object(
    'tier_id', v_tier.id,
    'tier_slug', v_tier.slug,
    'tier_name', v_tier.name,
    'subscribed_tier_slug', (select slug from public.company_tiers where id = v_sub.tier_id),
    'status', v_sub.status,
    'billing_interval', v_sub.billing_interval,
    'currency', v_sub.currency,
    'period_start', public.billing_period_start(p_company_id),
    'period_end', public.billing_period_start(p_company_id) + interval '1 month',
    'renews_at', v_sub.current_period_end,
    'cancel_at_period_end', v_sub.cancel_at_period_end,
    'scheduled_tier_slug', (select slug from public.company_tiers where id = v_sub.scheduled_tier_id),
    'grace_until', v_sub.grace_until,
    'manual_until', v_sub.manual_until,
    'has_paid_subscription', v_sub.dodo_subscription_id is not null,
    'has_billing_portal', v_sub.dodo_customer_id is not null,
    'entitlements', v_entitlements,
    'credit_balance', public.billing_credit_balance(p_company_id),
    'credit_lots', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'remaining', l.remaining,
               'expires_at', l.expires_at, 'reason', l.reason, 'created_at', l.created_at)
             order by l.expires_at nulls last, l.created_at)
        from public.company_credit_ledger l
       where l.company_id = p_company_id and l.remaining > 0
         and (l.expires_at is null or l.expires_at > now())
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Tables (spec §2)
-- ---------------------------------------------------------------------------

create table if not exists public.candidate_import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_info(id) on delete cascade,
  kind text not null check (kind in ('spreadsheet', 'resumes')),
  job_post_id uuid references public.job_postings(id) on delete cascade,
  stage_id uuid references public.pipeline_stages(id) on delete set null,
  talent_list_id uuid references public.talent_lists(id) on delete set null,
  stage_map jsonb check (stage_map is null or jsonb_typeof(stage_map) = 'object'),  -- {"<their value>": "<stage id>"}
  auto_invite boolean not null default false,                                       -- BI-REQ-015b
  status text not null default 'draft'
    check (status in ('draft', 'parsing', 'ready', 'confirmed', 'expired')),
  file_name text check (char_length(file_name) <= 255),  -- null: a candidate added by hand
  duplicate_action text not null default 'skip' check (duplicate_action in ('skip', 'fill', 'overwrite')),
  lawful_basis_attested_by uuid references auth.users(id) on delete set null,
  lawful_basis_attested_at timestamptz,
  lawful_basis_note text check (char_length(lawful_basis_note) <= 200),
  counts jsonb not null default '{}'::jsonb,              -- filled on confirm
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  expires_at timestamptz not null default now() + interval '7 days',
  check (status <> 'confirmed' or (confirmed_at is not null and lawful_basis_attested_at is not null))
);
create index if not exists candidate_import_batches_company_idx
  on public.candidate_import_batches (company_id, created_at desc);

create table if not exists public.company_candidates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_info(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  -- Stored lower-cased and trimmed (no citext).
  email text check (email is null or (char_length(email) <= 254 and email = lower(btrim(email)) and email like '%_@_%')),
  phone text check (char_length(phone) <= 30),
  location text check (char_length(location) <= 120),
  current_title text check (char_length(current_title) <= 120),
  current_company text check (char_length(current_company) <= 120),
  experience_years numeric(4,1) check (experience_years between 0 and 60),
  links jsonb not null default '{}'::jsonb check (jsonb_typeof(links) = 'object'),  -- {linkedin, github, portfolio, resume_url}
  skills text[] not null default '{}' check (cardinality(skills) <= 50),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  notes text check (char_length(notes) <= 2000),
  resume_path text,                                   -- phase 3
  resume_content jsonb,                               -- same shape as resumes.content
  source_batch_id uuid references public.candidate_import_batches(id) on delete set null,
  email_opted_out_at timestamptz,                     -- phase 4 (BI-REQ-034)
  claimed_user_id uuid references auth.users(id) on delete set null,  -- phase 4 (BI-REQ-041)
  claimed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists company_candidates_email_key
  on public.company_candidates (company_id, lower(email)) where email is not null;
create index if not exists company_candidates_company_idx
  on public.company_candidates (company_id, created_at desc);
create index if not exists company_candidates_tags_idx on public.company_candidates using gin (tags);
create index if not exists company_candidates_batch_idx on public.company_candidates (source_batch_id);

-- Resume batches only: spreadsheet rows stay in the browser until confirm
-- (BI-DEC-004). Used from phase 3.
create table if not exists public.candidate_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.candidate_import_batches(id) on delete cascade,
  company_id uuid not null references public.company_info(id) on delete cascade,
  file_path text not null,
  file_name text not null check (char_length(file_name) <= 255),
  status text not null default 'queued'
    check (status in ('queued', 'parsing', 'parsed', 'failed', 'removed', 'confirmed')),
  attempts int not null default 0,
  error_code text check (error_code in ('no_text', 'unreadable', 'parse_failed')),
  extracted jsonb,
  edited jsonb,
  warnings jsonb not null default '[]'::jsonb,
  duplicate_of uuid references public.company_candidates(id) on delete set null,
  duplicate_action text check (duplicate_action in ('skip', 'fill', 'overwrite')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists candidate_import_rows_batch_idx on public.candidate_import_rows (batch_id, status);

create table if not exists public.candidate_import_mappings (
  company_id uuid not null references public.company_info(id) on delete cascade,
  header_hash text not null check (header_hash ~ '^[0-9a-f]{64}$'),
  mapping jsonb not null check (jsonb_typeof(mapping) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (company_id, header_hash)
);

-- ---------------------------------------------------------------------------
-- 4. applications (BI-DEC-002)
-- ---------------------------------------------------------------------------

alter table public.applications
  add column if not exists company_candidate_id uuid references public.company_candidates(id) on delete cascade,
  add column if not exists merged_into_application_id uuid references public.applications(id) on delete set null,
  add column if not exists import_batch_id uuid references public.candidate_import_batches(id) on delete set null;

create unique index if not exists applications_candidate_job_post_key
  on public.applications (company_candidate_id, job_post_id)
  where company_candidate_id is not null and job_post_id is not null;
create index if not exists applications_import_batch_idx
  on public.applications (import_batch_id) where import_batch_id is not null;

alter table public.applications drop constraint if exists applications_imported_has_candidate;
alter table public.applications add constraint applications_imported_has_candidate
  check (source <> 'imported' or company_candidate_id is not null) not valid;

-- Only the import RPCs (and the service role) set these. A company member's
-- browser update can't point an application at another candidate, and an
-- applicant's insert can't set them at all.
create or replace function public.protect_application_import_columns()
returns trigger
language plpgsql security invoker
set search_path = ''
as $$
begin
  if current_role <> 'authenticated' then return new; end if;

  if tg_op = 'INSERT' then
    new.company_candidate_id := null;
    new.merged_into_application_id := null;
    new.import_batch_id := null;
    return new;
  end if;

  if new.company_candidate_id is distinct from old.company_candidate_id
     or new.merged_into_application_id is distinct from old.merged_into_application_id
     or new.import_batch_id is distinct from old.import_batch_id then
    raise exception 'Only an import can change this application''s candidate.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists applications_protect_import_columns on public.applications;
create trigger applications_protect_import_columns
  before insert or update on public.applications
  for each row execute function public.protect_application_import_columns();

-- ---------------------------------------------------------------------------
-- 5. Statuses, event types and audit actions
-- ---------------------------------------------------------------------------

-- BI-REQ-036: not scored because the candidate has too little detail.
alter table public.application_screenings drop constraint if exists application_screenings_status_check;
alter table public.application_screenings add constraint application_screenings_status_check check (status in (
  'queued', 'processing', 'completed', 'failed', 'stale', 'skipped_quota', 'insufficient_info'
));

alter table public.application_events drop constraint if exists application_events_type_check;
alter table public.application_events add constraint application_events_type_check check (type in (
  'applied', 'stage_changed', 'email_sent', 'note_added', 'screened', 'outreach_sent', 'outreach_replied',
  'interview_invited', 'interview_started', 'interview_completed', 'interview_expired',
  'interview_declined', 'interview_cancelled', 'interview_accommodation_requested',
  'interview_extended', 'interview_attempt_granted', 'interview_reopened',
  'imported', 'claimed', 'merged'
));

alter table public.company_audit_log drop constraint if exists company_audit_log_action_check;
alter table public.company_audit_log add constraint company_audit_log_action_check check (action in (
  'role.created', 'role.updated', 'role.deleted', 'role.default_changed',
  'member.role_changed', 'member.removed', 'member.left',
  'owner.added', 'owner.removed', 'owner.primary_changed',
  'invite.created', 'invite.revoked', 'invite.accepted',
  'job.assigned', 'job.unassigned',
  'candidates.imported', 'candidates.deleted'
));
alter table public.company_audit_log drop constraint if exists company_audit_log_target_type_check;
alter table public.company_audit_log add constraint company_audit_log_target_type_check check (target_type in (
  'role', 'member', 'invite', 'job', 'company', 'import_batch', 'candidates'
));

-- ---------------------------------------------------------------------------
-- 6. talent_list_members holds company candidates (BI-DEC-003)
-- ---------------------------------------------------------------------------

alter table public.talent_list_members add column if not exists id uuid not null default gen_random_uuid();
alter table public.talent_list_members
  add column if not exists company_candidate_id uuid references public.company_candidates(id) on delete cascade;
alter table public.talent_list_members drop constraint if exists talent_list_members_pkey;
alter table public.talent_list_members alter column candidate_user_id drop not null;
alter table public.talent_list_members add constraint talent_list_members_pkey primary key (id);
alter table public.talent_list_members drop constraint if exists talent_list_members_one_person;
alter table public.talent_list_members add constraint talent_list_members_one_person
  check ((candidate_user_id is null) <> (company_candidate_id is null));
create unique index if not exists talent_list_members_user_key
  on public.talent_list_members (list_id, candidate_user_id) where candidate_user_id is not null;
create unique index if not exists talent_list_members_candidate_key
  on public.talent_list_members (list_id, company_candidate_id) where company_candidate_id is not null;
create index if not exists talent_list_members_company_candidate_idx
  on public.talent_list_members (company_candidate_id) where company_candidate_id is not null;

-- BI-REQ-003: "candidates" is the profiles page's "Your candidates" tab, so no
-- list can have it as its slug (utils/talent-list-tabs.ts).
update public.talent_lists t set slug = 'candidates-list'
 where t.slug = 'candidates'
   and not exists (select 1 from public.talent_lists o
                    where o.company_id = t.company_id and o.slug = 'candidates-list');
update public.talent_lists t set slug = 'candidates-list-' || left(t.id::text, 8)
 where t.slug = 'candidates';
alter table public.talent_lists drop constraint if exists talent_lists_slug_check;
alter table public.talent_lists add constraint talent_lists_slug_check
  check (char_length(slug) between 1 and 60 and slug not in ('all', 'saved', 'candidates'));

-- The candidate's company, without the company_candidates RLS (for the list policy).
create or replace function public.company_candidate_company(p_candidate_id uuid)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select company_id from public.company_candidates where id = p_candidate_id
$$;
revoke all on function public.company_candidate_company(uuid) from public, anon;
grant execute on function public.company_candidate_company(uuid) to authenticated, service_role;

drop policy if exists "talent_list_members_insert_company" on public.talent_list_members;
create policy "talent_list_members_insert_company" on public.talent_list_members
  for insert to authenticated with check (
    public.has_company_permission(public.talent_list_company(list_id), 'talent_lists.manage')
    and (candidate_user_id is null or public.company_can_view_candidate(candidate_user_id))
    and (company_candidate_id is null
         or public.company_candidate_company(company_candidate_id) = public.talent_list_company(list_id))
  );

-- 6b. Notes on imported applications (BI-REQ-030): a note on an application
--     from a company candidate has no candidate user. Talent-pool notes
--     (no application) still need one.
alter table public.candidate_notes alter column candidate_user_id drop not null;
alter table public.candidate_notes drop constraint if exists candidate_notes_has_subject;
alter table public.candidate_notes add constraint candidate_notes_has_subject
  check (candidate_user_id is not null or application_id is not null);

-- Same as 20261017160000_recruiter_roles.sql, except that the note's user
-- matches the application's applicant when both are null (an imported one).
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
            and a.applicant_user_id is not distinct from candidate_notes.candidate_user_id
            and jp.company_id = candidate_notes.company_id
        ))
    )
  );

-- ---------------------------------------------------------------------------
-- 7. RLS and grants (BI-SEC-001): reads only; writes go through the RPCs.
-- ---------------------------------------------------------------------------

alter table public.company_candidates enable row level security;
alter table public.candidate_import_batches enable row level security;
alter table public.candidate_import_rows enable row level security;
alter table public.candidate_import_mappings enable row level security;

-- BI-PERM-002: talent.view, or applicants.view on a job the candidate is in.
drop policy if exists "company_candidates_select" on public.company_candidates;
create policy "company_candidates_select" on public.company_candidates
  for select to authenticated using (
    public.has_company_permission(company_id, 'talent.view')
    or exists (
      select 1 from public.applications a
       where a.company_candidate_id = company_candidates.id
         and a.job_post_id = any ((select public.my_job_ids_with('applicants.view'))::uuid[])
    )
  );

drop policy if exists "candidate_import_batches_select" on public.candidate_import_batches;
create policy "candidate_import_batches_select" on public.candidate_import_batches
  for select to authenticated using (
    public.has_company_permission(company_id, 'talent.view')
    or public.has_company_permission(company_id, 'applicants.view', job_post_id)
  );

drop policy if exists "candidate_import_rows_select" on public.candidate_import_rows;
create policy "candidate_import_rows_select" on public.candidate_import_rows
  for select to authenticated using (
    exists (
      select 1 from public.candidate_import_batches b
       where b.id = candidate_import_rows.batch_id
         and public.has_company_permission(b.company_id, 'applicants.view', b.job_post_id)
    )
  );

drop policy if exists "candidate_import_mappings_select" on public.candidate_import_mappings;
create policy "candidate_import_mappings_select" on public.candidate_import_mappings
  for select to authenticated using (public.company_permission_scope(company_id, 'applicants.import') is not null);

revoke all on public.company_candidates, public.candidate_import_batches,
  public.candidate_import_rows, public.candidate_import_mappings from anon, authenticated;
grant select on public.company_candidates, public.candidate_import_batches,
  public.candidate_import_rows, public.candidate_import_mappings to authenticated;
grant all on public.company_candidates, public.candidate_import_batches,
  public.candidate_import_rows, public.candidate_import_mappings to service_role;

-- ---------------------------------------------------------------------------
-- 8. Triggers on applications: an import isn't an application
-- ---------------------------------------------------------------------------

-- Same as 20261015190000_recruiter_pipeline.sql, except that an imported
-- application gets an `imported` event from the import RPC instead.
create or replace function public.log_application_applied()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
begin
  if new.job_post_id is null or new.source = 'imported' then return new; end if;

  begin
    select company_id into v_company from public.job_postings where id = new.job_post_id;
    if v_company is null then return new; end if;

    insert into public.application_events
      (company_id, application_id, candidate_user_id, type, payload, created_at)
    values
      (v_company, new.id, new.applicant_user_id, 'applied',
       jsonb_build_object('stage_id', new.stage_id, 'source', new.source), new.created_at)
    on conflict (application_id) where type = 'applied' do nothing;
  exception when others then
    raise warning 'log_application_applied(%): %', new.id, sqlerrm;
  end;

  return new;
end $$;

revoke all on function public.log_application_applied() from public, anon, authenticated;

-- Same as 20261015220000_recruiter_pipeline_notifications.sql, except that an
-- import doesn't send a "new applicant" email per person.
create or replace function public.notify_company_of_application()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
  v_setting text;
begin
  if new.job_post_id is null or new.source = 'imported' then return new; end if;

  begin
    select jp.company_id, ci.notify_new_applicants into v_company, v_setting
      from public.job_postings jp
      join public.company_info ci on ci.id = jp.company_id
     where jp.id = new.job_post_id;

    if v_setting = 'instant' then
      perform pgmq.send('company_notification_queue', jsonb_build_object(
        'type', 'new_applicant',
        'applicationId', new.id,
        'jobPostId', new.job_post_id
      ));
    end if;
  exception when others then
    raise warning 'notify_company_of_application(%): %', new.id, sqlerrm;
  end;

  return new;
end $$;

revoke all on function public.notify_company_of_application() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. RPCs (security definer, { ok, reason, ... })
-- ---------------------------------------------------------------------------

-- BI-REQ-019: the emails that belong to GetHired users the caller can already
-- see (applied to a job they can view, or said "interested" to the company's
-- outreach). Nobody else is ever matched (BI-SEC-002).
create or replace function public.match_known_applicants(p_emails text[])
returns table (email text, user_id uuid, full_name text)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if public.my_company_id() is null then
    raise exception 'Not a company member.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(cardinality(p_emails), 0) > 5000 then
    raise exception 'At most 5,000 emails.' using errcode = 'invalid_parameter_value';
  end if;

  return query
    select lower(u.email)::text, u.id, ui.full_name::text
      from auth.users u
      left join public.user_info ui on ui.user_id = u.id
     where lower(u.email) in (select lower(btrim(e)) from unnest(coalesce(p_emails, '{}')) e)
       and public.company_has_candidate_access(u.id);
end $$;

revoke all on function public.match_known_applicants(text[]) from public, anon;
grant execute on function public.match_known_applicants(text[]) to authenticated;

-- A draft batch. A hand-added candidate is a one-row batch with no file name
-- (BI-REQ-009). Needs applicants.import at any scope; the destination is
-- checked on confirm.
create or replace function public.start_candidate_import(p_kind text, p_file_name text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_id uuid;
begin
  if v_company is null or public.company_permission_scope(v_company, 'applicants.import') is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_kind is distinct from 'spreadsheet' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  -- BI-SEC-008: hand-added candidates at most 60 an hour per company.
  if p_file_name is null and (
    select count(*) from public.candidate_import_batches b
     where b.company_id = v_company and b.file_name is null and b.created_at > now() - interval '1 hour'
  ) >= 60 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;
  -- BI-SEC-008: file imports at most 5 an hour and 20 a day per company.
  if p_file_name is not null then
    if (select count(*) from public.candidate_import_batches b
         where b.company_id = v_company and b.file_name is not null and b.created_at > now() - interval '1 hour') >= 5 then
      return jsonb_build_object('ok', false, 'reason', 'import_limit_hour');
    end if;
    if (select count(*) from public.candidate_import_batches b
         where b.company_id = v_company and b.file_name is not null and b.created_at > now() - interval '1 day') >= 20 then
      return jsonb_build_object('ok', false, 'reason', 'import_limit_day');
    end if;
  end if;

  insert into public.candidate_import_batches (company_id, kind, file_name, created_by)
  values (v_company, p_kind, nullif(btrim(p_file_name), ''), (select auth.uid()))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'batch_id', v_id);
end $$;

revoke all on function public.start_candidate_import(text, text) from public, anon;
grant execute on function public.start_candidate_import(text, text) to authenticated;

-- One row's text value: trimmed, null when blank.
create or replace function public.import_text(p_row jsonb, p_key text)
returns text
language sql immutable
set search_path = ''
as $$
  select nullif(btrim(p_row ->> p_key), '')
$$;

-- One row's list (skills, tags): a JSON array of strings, trimmed, deduplicated.
create or replace function public.import_list(p_row jsonb, p_key text)
returns text[]
language sql immutable
set search_path = ''
as $$
  select coalesce(array_agg(v order by o), '{}')
    from (
      select distinct on (lower(btrim(x.v))) btrim(x.v) as v, x.o
        from jsonb_array_elements_text(
               case when jsonb_typeof(p_row -> p_key) = 'array' then p_row -> p_key else '[]'::jsonb end
             ) with ordinality as x(v, o)
       where btrim(x.v) <> ''
       order by lower(btrim(x.v)), x.o
    ) d
$$;

-- The row's links object: only the four known keys, http(s) only.
create or replace function public.import_links(p_row jsonb)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(k.out_key, public.import_text(p_row, k.in_key)), '{}'::jsonb)
    from (values ('linkedin_url', 'linkedin'), ('github_url', 'github'),
                 ('portfolio_url', 'portfolio'), ('resume_url', 'resume_url')) as k(in_key, out_key)
   where public.import_text(p_row, k.in_key) ~* '^https?://'
$$;

revoke all on function public.import_text(jsonb, text), public.import_list(jsonb, text),
  public.import_links(jsonb) from public, anon, authenticated;

-- Creates an imported application, or says why not. The caller has checked
-- the permission for the job.
create or replace function public.create_imported_application(
  p_candidate_id uuid, p_job_id uuid, p_stage_id uuid, p_batch_id uuid
)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_all_jobs uuid;
  v_email text;
  v_app uuid;
begin
  select jp.company_id, jp.job_id into v_company, v_all_jobs from public.job_postings jp where jp.id = p_job_id;
  select c.email into v_email from public.company_candidates c where c.id = p_candidate_id;
  if v_email is null then return 'no_email'; end if;

  if exists (select 1 from public.applications a
              where a.company_candidate_id = p_candidate_id and a.job_post_id = p_job_id) then
    return 'already_in_job';
  end if;
  -- BI-REQ-019: a GetHired user with this email who already applied to the job.
  if exists (select 1 from public.applications a join auth.users u on u.id = a.applicant_user_id
              where a.job_post_id = p_job_id and lower(u.email) = v_email) then
    return 'already_in_job';
  end if;

  insert into public.applications
    (applicant_user_id, job_post_id, all_jobs_id, source, stage_id, stage_entered_at,
     company_candidate_id, import_batch_id)
  values
    (null, p_job_id, v_all_jobs, 'imported', p_stage_id, now(), p_candidate_id, p_batch_id)
  returning id into v_app;

  insert into public.application_events
    (company_id, application_id, candidate_user_id, actor_user_id, actor_name, type, payload)
  values
    (v_company, v_app, null, (select auth.uid()), public.member_display_name((select auth.uid())), 'imported',
     jsonb_build_object('stage_id', p_stage_id, 'batch_id', p_batch_id, 'company_candidate_id', p_candidate_id));
  return 'added';
end $$;

revoke all on function public.create_imported_application(uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- The stage an import lands in: p_stage_id when it's one of the company's
-- active stages, else the first Applied stage. Null when p_stage_id is
-- given but isn't the company's.
create or replace function public.import_stage(p_company uuid, p_stage_id uuid)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select case
    when p_stage_id is null then public.first_pipeline_stage(p_company, 'applied')
    else (select s.id from public.pipeline_stages s
           where s.id = p_stage_id and s.company_id = p_company and not s.archived)
  end
$$;

revoke all on function public.import_stage(uuid, uuid) from public, anon, authenticated;

-- BI-REQ-017: confirms a spreadsheet batch (or a hand-added candidate) in one
-- transaction. p_rows: the validated rows, at most 5,000, each with the
-- candidate fields, an optional `stage` (their value, mapped by stage_map)
-- and an optional per-row `duplicate_action`. p_options: job_post_id,
-- stage_id, talent_list_id, stage_map, duplicate_action, auto_invite,
-- attested, lawful_basis_note. Never queues a stage email (BI-REQ-015c).
create or replace function public.confirm_candidate_import(p_batch_id uuid, p_rows jsonb, p_options jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_batch public.candidate_import_batches%rowtype;
  v_job uuid := public.try_uuid(p_options ->> 'job_post_id');
  v_list uuid := public.try_uuid(p_options ->> 'talent_list_id');
  v_stage uuid;
  v_stage_map jsonb := case when jsonb_typeof(p_options -> 'stage_map') = 'object' then p_options -> 'stage_map' end;
  v_action text := coalesce(p_options ->> 'duplicate_action', 'skip');
  v_known jsonb := '{}'::jsonb;
  v_row jsonb;
  v_email text;
  v_row_action text;
  v_row_stage uuid;
  v_candidate public.company_candidates%rowtype;
  v_id uuid;
  v_result text;
  v_created int := 0; v_updated int := 0; v_skipped int := 0; v_known_n int := 0;
  v_added int := 0; v_in_job int := 0; v_outreach int := 0; v_no_email int := 0; v_listed int := 0;
  v_counts jsonb;
  k text;
begin
  select * into v_batch from public.candidate_import_batches where id = p_batch_id for update;
  if v_batch.id is null or v_batch.company_id is distinct from v_company then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_batch.status = 'confirmed' then
    return jsonb_build_object('ok', false, 'reason', 'already_confirmed');
  end if;
  if v_batch.kind <> 'spreadsheet' or v_batch.status <> 'draft' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- BI-PERM-001: for the job, or unscoped without one; lists also need talent_lists.manage.
  if not public.has_company_permission(v_company, 'applicants.import', v_job) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_job is not null and not exists (
    select 1 from public.job_postings jp where jp.id = v_job and jp.company_id = v_company
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_list is not null and (
    not public.has_company_permission(v_company, 'talent_lists.manage')
    or not exists (select 1 from public.talent_lists l where l.id = v_list and l.company_id = v_company)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if coalesce((p_options ->> 'attested')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'reason', 'not_attested');
  end if;
  if v_action not in ('skip', 'fill', 'overwrite') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_rows');
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;

  if v_job is not null then
    v_stage := public.import_stage(v_company, public.try_uuid(p_options ->> 'stage_id'));
    if v_stage is null then
      return jsonb_build_object('ok', false, 'reason', 'invalid_stage');
    end if;
    -- BI-REQ-015a: every mapped value is one of the company's active stages.
    if v_stage_map is not null then
      for k in select jsonb_object_keys(v_stage_map) loop
        if public.import_stage(v_company, public.try_uuid(v_stage_map ->> k)) is null
           or v_stage_map ->> k is null then
          return jsonb_build_object('ok', false, 'reason', 'invalid_stage');
        end if;
      end loop;
    end if;
  end if;

  -- BI-REQ-019, repeated here: GetHired users the caller can already see.
  select coalesce(jsonb_object_agg(m.email, m.user_id), '{}'::jsonb) into v_known
    from public.match_known_applicants(array(
      select lower(btrim(r ->> 'email')) from jsonb_array_elements(p_rows) r
       where nullif(btrim(r ->> 'email'), '') is not null
    )) m;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then
      raise exception 'Each row must be an object.' using errcode = 'invalid_parameter_value';
    end if;
    v_email := lower(public.import_text(v_row, 'email'));
    v_row_action := coalesce(v_row ->> 'duplicate_action', v_action);
    if v_row_action not in ('skip', 'fill', 'overwrite') then v_row_action := v_action; end if;

    -- A known GetHired user never becomes a company candidate.
    if v_email is not null and v_known ? v_email then
      v_known_n := v_known_n + 1;
      if v_list is not null then
        insert into public.talent_list_members (list_id, candidate_user_id)
        values (v_list, (v_known ->> v_email)::uuid)
        on conflict do nothing;
        if found then v_listed := v_listed + 1; end if;
      end if;
      if v_job is not null then
        if exists (select 1 from public.applications a
                    where a.job_post_id = v_job and a.applicant_user_id = (v_known ->> v_email)::uuid) then
          v_in_job := v_in_job + 1;
        else
          v_outreach := v_outreach + 1;
        end if;
      end if;
      continue;
    end if;

    v_candidate := null;
    if v_email is not null then
      select * into v_candidate from public.company_candidates c
       where c.company_id = v_company and lower(c.email) = v_email for update;
    end if;

    if v_candidate.id is null then
      insert into public.company_candidates
        (company_id, full_name, email, phone, location, current_title, current_company, experience_years,
         links, skills, tags, notes, source_batch_id, created_by)
      values
        (v_company, public.import_text(v_row, 'full_name'), v_email, public.import_text(v_row, 'phone'),
         public.import_text(v_row, 'location'), public.import_text(v_row, 'current_title'),
         public.import_text(v_row, 'current_company'), (public.import_text(v_row, 'experience_years'))::numeric,
         public.import_links(v_row), public.import_list(v_row, 'skills'), public.import_list(v_row, 'tags'),
         public.import_text(v_row, 'notes'), p_batch_id, (select auth.uid()))
      returning id into v_id;
      v_created := v_created + 1;
    else
      v_id := v_candidate.id;
      if v_row_action = 'skip' then
        v_skipped := v_skipped + 1;
      elsif v_row_action = 'fill' then
        -- BI-REQ-014: only blank fields; tags are merged.
        update public.company_candidates c set
          phone = coalesce(c.phone, public.import_text(v_row, 'phone')),
          location = coalesce(c.location, public.import_text(v_row, 'location')),
          current_title = coalesce(c.current_title, public.import_text(v_row, 'current_title')),
          current_company = coalesce(c.current_company, public.import_text(v_row, 'current_company')),
          experience_years = coalesce(c.experience_years, (public.import_text(v_row, 'experience_years'))::numeric),
          links = public.import_links(v_row) || c.links,
          skills = case when cardinality(c.skills) = 0 then public.import_list(v_row, 'skills') else c.skills end,
          tags = (select coalesce(array_agg(t order by o), '{}') from (
                    select distinct on (lower(t)) t, o
                      from unnest(c.tags || public.import_list(v_row, 'tags')) with ordinality as x(t, o)
                     order by lower(t), o
                  ) d)[1:20],
          notes = coalesce(c.notes, public.import_text(v_row, 'notes')),
          updated_at = now()
         where c.id = v_id;
        v_updated := v_updated + 1;
      else
        -- overwrite: every field the row carries replaces the stored one.
        update public.company_candidates c set
          full_name = coalesce(public.import_text(v_row, 'full_name'), c.full_name),
          phone = case when v_row ? 'phone' then public.import_text(v_row, 'phone') else c.phone end,
          location = case when v_row ? 'location' then public.import_text(v_row, 'location') else c.location end,
          current_title = case when v_row ? 'current_title' then public.import_text(v_row, 'current_title') else c.current_title end,
          current_company = case when v_row ? 'current_company' then public.import_text(v_row, 'current_company') else c.current_company end,
          experience_years = case when v_row ? 'experience_years'
                                  then (public.import_text(v_row, 'experience_years'))::numeric else c.experience_years end,
          links = c.links || public.import_links(v_row),
          skills = case when v_row ? 'skills' then public.import_list(v_row, 'skills') else c.skills end,
          tags = case when v_row ? 'tags' then public.import_list(v_row, 'tags') else c.tags end,
          notes = case when v_row ? 'notes' then public.import_text(v_row, 'notes') else c.notes end,
          updated_at = now()
         where c.id = v_id;
        v_updated := v_updated + 1;
      end if;
    end if;

    if v_list is not null then
      insert into public.talent_list_members (list_id, company_candidate_id)
      values (v_list, v_id)
      on conflict do nothing;
      if found then v_listed := v_listed + 1; end if;
    end if;

    if v_job is not null then
      v_row_stage := v_stage;
      if v_stage_map is not null and public.import_text(v_row, 'stage') is not null then
        v_row_stage := coalesce(
          public.try_uuid(v_stage_map ->> public.import_text(v_row, 'stage')),
          (select public.try_uuid(e.value) from jsonb_each_text(v_stage_map) e
            where lower(btrim(e.key)) = lower(public.import_text(v_row, 'stage')) limit 1),
          v_stage
        );
      end if;
      v_result := public.create_imported_application(v_id, v_job, v_row_stage, p_batch_id);
      case v_result
        when 'added' then v_added := v_added + 1;
        when 'already_in_job' then v_in_job := v_in_job + 1;
        when 'no_email' then v_no_email := v_no_email + 1;
      end case;
    end if;
  end loop;

  v_counts := jsonb_build_object(
    'created', v_created, 'updated', v_updated, 'skipped', v_skipped, 'known', v_known_n,
    'added_to_job', v_added, 'already_in_job', v_in_job, 'needs_outreach', v_outreach,
    'no_email', v_no_email, 'added_to_list', v_listed
  );

  update public.candidate_import_batches set
    status = 'confirmed',
    confirmed_at = now(),
    job_post_id = v_job,
    stage_id = v_stage,
    talent_list_id = v_list,
    stage_map = v_stage_map,
    duplicate_action = v_action,
    auto_invite = v_job is not null and coalesce((p_options ->> 'auto_invite')::boolean, false),
    lawful_basis_attested_by = (select auth.uid()),
    lawful_basis_attested_at = now(),
    lawful_basis_note = left(nullif(btrim(p_options ->> 'lawful_basis_note'), ''), 200),
    counts = v_counts
   where id = p_batch_id;

  -- Counts only: never names or emails.
  perform public.write_company_audit(v_company, 'candidates.imported', 'import_batch', p_batch_id::text,
    v_batch.file_name, null, v_counts || jsonb_build_object('job_post_id', v_job, 'talent_list_id', v_list));

  return jsonb_build_object('ok', true, 'batch_id', p_batch_id, 'counts', v_counts,
    'candidate_ids', (select coalesce(jsonb_agg(c.id), '[]'::jsonb)
                        from public.company_candidates c where c.source_batch_id = p_batch_id));
end $$;

revoke all on function public.confirm_candidate_import(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.confirm_candidate_import(uuid, jsonb, jsonb) to authenticated;

-- BI-REQ-005: adds existing company candidates to a job, with the same
-- checks and counts as the confirm RPC. At most 200 at a time.
create or replace function public.add_candidates_to_job(p_job_id uuid, p_candidate_ids uuid[], p_stage_id uuid default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_stage uuid;
  v_id uuid;
  v_result text;
  v_added int := 0; v_in_job int := 0; v_no_email int := 0; v_missing int := 0;
begin
  if v_company is null or not exists (
    select 1 from public.job_postings jp where jp.id = p_job_id and jp.company_id = v_company
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.has_company_permission(v_company, 'applicants.import', p_job_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if coalesce(cardinality(p_candidate_ids), 0) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_rows');
  end if;
  if cardinality(p_candidate_ids) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  v_stage := public.import_stage(v_company, p_stage_id);
  if v_stage is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_stage');
  end if;

  foreach v_id in array (select array_agg(distinct x) from unnest(p_candidate_ids) x) loop
    if not exists (select 1 from public.company_candidates c where c.id = v_id and c.company_id = v_company) then
      v_missing := v_missing + 1;
      continue;
    end if;
    v_result := public.create_imported_application(v_id, p_job_id, v_stage, null);
    case v_result
      when 'added' then v_added := v_added + 1;
      when 'already_in_job' then v_in_job := v_in_job + 1;
      when 'no_email' then v_no_email := v_no_email + 1;
    end case;
  end loop;

  return jsonb_build_object('ok', true, 'counts', jsonb_build_object(
    'added_to_job', v_added, 'already_in_job', v_in_job, 'no_email', v_no_email, 'not_found', v_missing));
end $$;

revoke all on function public.add_candidates_to_job(uuid, uuid[], uuid) from public, anon;
grant execute on function public.add_candidates_to_job(uuid, uuid[], uuid) to authenticated;

-- BI-REQ-004: edits a candidate's fields. p_fields carries only the fields
-- to change (validated by the action's schema); email_opted_out_at and the
-- claim columns can't be changed here. Needs applicants.import unscoped or
-- for one of the candidate's jobs.
create or replace function public.update_company_candidate(p_candidate_id uuid, p_fields jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_candidate public.company_candidates%rowtype;
  v_email text;
begin
  select * into v_candidate from public.company_candidates c
   where c.id = p_candidate_id and c.company_id = v_company for update;
  if v_candidate.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not (
    public.has_company_permission(v_company, 'applicants.import')
    or exists (select 1 from public.applications a
                where a.company_candidate_id = p_candidate_id
                  and public.has_company_permission(v_company, 'applicants.import', a.job_post_id))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if jsonb_typeof(p_fields) <> 'object' or exists (
    select 1 from jsonb_object_keys(p_fields) k
     where k not in ('full_name', 'email', 'phone', 'location', 'current_title', 'current_company',
                     'experience_years', 'linkedin_url', 'github_url', 'portfolio_url', 'resume_url',
                     'skills', 'tags', 'notes')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  if p_fields ? 'email' then
    v_email := lower(public.import_text(p_fields, 'email'));
    if v_email is not null and exists (
      select 1 from public.company_candidates c
       where c.company_id = v_company and lower(c.email) = v_email and c.id <> p_candidate_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'duplicate_email');
    end if;
  end if;

  update public.company_candidates c set
    full_name = coalesce(public.import_text(p_fields, 'full_name'), c.full_name),
    email = case when p_fields ? 'email' then v_email else c.email end,
    phone = case when p_fields ? 'phone' then public.import_text(p_fields, 'phone') else c.phone end,
    location = case when p_fields ? 'location' then public.import_text(p_fields, 'location') else c.location end,
    current_title = case when p_fields ? 'current_title' then public.import_text(p_fields, 'current_title') else c.current_title end,
    current_company = case when p_fields ? 'current_company' then public.import_text(p_fields, 'current_company') else c.current_company end,
    experience_years = case when p_fields ? 'experience_years'
                            then (public.import_text(p_fields, 'experience_years'))::numeric else c.experience_years end,
    links = (c.links - (select coalesce(array_agg(o), '{}') from (values
               ('linkedin_url', 'linkedin'), ('github_url', 'github'),
               ('portfolio_url', 'portfolio'), ('resume_url', 'resume_url')) as k(i, o) where p_fields ? k.i))
            || public.import_links(p_fields),
    skills = case when p_fields ? 'skills' then public.import_list(p_fields, 'skills') else c.skills end,
    tags = case when p_fields ? 'tags' then public.import_list(p_fields, 'tags') else c.tags end,
    notes = case when p_fields ? 'notes' then public.import_text(p_fields, 'notes') else c.notes end,
    updated_at = now()
   where c.id = p_candidate_id;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.update_company_candidate(uuid, jsonb) from public, anon;
grant execute on function public.update_company_candidate(uuid, jsonb) to authenticated;

-- BI-REQ-007: deletes candidates (their applications, list memberships and,
-- from phase 3, files with them). applicants.import unscoped; at most 200.
-- Returns the resume paths so the action can delete the files.
create or replace function public.delete_company_candidates(p_candidate_ids uuid[])
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_paths jsonb;
  v_deleted int;
begin
  if v_company is null or not public.has_company_permission(v_company, 'applicants.import') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if coalesce(cardinality(p_candidate_ids), 0) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_rows');
  end if;
  if cardinality(p_candidate_ids) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;

  select coalesce(jsonb_agg(c.resume_path) filter (where c.resume_path is not null), '[]'::jsonb)
    into v_paths
    from public.company_candidates c
   where c.company_id = v_company and c.id = any (p_candidate_ids);

  with gone as (
    delete from public.company_candidates c
     where c.company_id = v_company and c.id = any (p_candidate_ids)
    returning 1
  )
  select count(*)::int into v_deleted from gone;

  if v_deleted > 0 then
    -- No names or emails (BI-REQ-007).
    perform public.write_company_audit(v_company, 'candidates.deleted', 'candidates', null, null,
      null, jsonb_build_object('count', v_deleted));
  end if;
  return jsonb_build_object('ok', true, 'deleted', v_deleted, 'resume_paths', v_paths);
end $$;

revoke all on function public.delete_company_candidates(uuid[]) from public, anon;
grant execute on function public.delete_company_candidates(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. The funnel leaves merged applications out (BI-REQ-042)
-- ---------------------------------------------------------------------------

-- Same as 20261017160000_recruiter_roles.sql, except for the merged filter.
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
       and a.merged_into_application_id is null
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
