-- RP-TEST-001: recruiter roles and permissions. Runs in a transaction that
-- always rolls back, so it's safe to run against the linked project once
-- 20261017160000_recruiter_roles.sql and 20261017170000_recruiter_role_limits.sql
-- are applied (or with them prepended inside the same transaction):
--   npx supabase db query --linked -f supabase/tests/recruiter_roles.sql
-- Any failed check raises an exception; success prints 'recruiter_roles: ok'.
-- Ids match test/utils/recruiter.ts and test/utils/team.ts.

begin;

-- Act as a user for definer RPCs (auth.uid() reads the claims). RLS checks
-- also `set local role authenticated` at the top level.
create function pg_temp.act(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true)
$$;
create function pg_temp.ok(j jsonb) returns boolean language sql as $$
  select coalesce((j ->> 'ok')::boolean, false)
$$;
create function pg_temp.role_of(p_company uuid, p_template text) returns uuid language sql as $$
  select id from public.company_roles where company_id = p_company and template_key = p_template
$$;
create function pg_temp.expect(j jsonb, p_reason text, p_what text) returns void language plpgsql as $$
begin
  if p_reason is null then
    if not pg_temp.ok(j) then raise exception '%: expected ok, got %', p_what, j; end if;
  elsif pg_temp.ok(j) or j ->> 'reason' is distinct from p_reason then
    raise exception '%: expected %, got %', p_what, p_reason, j;
  end if;
end $$;

-- Seed. Company A: owner, Admin, Member, a Hiring manager (job A1 only), a
-- role manager, a second owner and two capped members; company B: owner, member.
insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data) values
  ('c1000000-0000-4000-8000-000000000001', 'hr@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c1000000-0000-4000-8000-000000000002', 'hr@globex.test', 'authenticated', 'authenticated', now(), '{}'),
  ('a0000000-0000-4000-8000-000000000001', 'public@applicant.test', 'authenticated', 'authenticated', now(), '{}'),
  ('a0000000-0000-4000-8000-000000000002', 'second@applicant.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c2000000-0000-4000-8000-000000000001', 'admin@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c3000000-0000-4000-8000-000000000001', 'member@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c3000000-0000-4000-8000-000000000002', 'member@globex.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c5000000-0000-4000-8000-000000000001', 'hm@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c6000000-0000-4000-8000-000000000001', 'rolemgr@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c7000000-0000-4000-8000-000000000001', 'coowner@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c8000000-0000-4000-8000-000000000001', 'x@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c8000000-0000-4000-8000-000000000002', 'y@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c4000000-0000-4000-8000-000000000001', 'invitee@gmail.test', 'authenticated', 'authenticated', now(), '{}');

insert into public.company_info (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Acme', 'hr@acme.test'),
  ('c0000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'Globex', 'hr@globex.test');

-- Enterprise for A: no seat or allowance limits, so only the rules under test refuse.
update public.company_subscriptions
   set tier_id = (select id from public.company_tiers where slug = 'enterprise'), status = 'active', manual_until = null
 where company_id = 'c0000000-0000-4000-8000-000000000001';

insert into public.user_info (user_id, email, full_name, is_public, filled) values
  ('a0000000-0000-4000-8000-000000000001', 'public@applicant.test', 'Public', true, true),
  ('a0000000-0000-4000-8000-000000000002', 'second@applicant.test', 'Second', false, true);

-- ===================================================== block 1: foundation
-- RPT-010.

-- New companies: the triggers seeded Admin, Member, the default role and the owner.
do $$
declare
  a uuid := 'c0000000-0000-4000-8000-000000000001';
  v_admin uuid := pg_temp.role_of(a, 'admin');
  v_member uuid := pg_temp.role_of(a, 'member');
begin
  assert v_admin is not null and v_member is not null, 'the seed trigger did not create Admin and Member';
  assert (select default_role_id from public.company_info where id = a) = v_member, 'Member is not the default role';
  assert exists (
    select 1 from public.company_members
     where company_id = a and user_id = 'c1000000-0000-4000-8000-000000000001' and is_owner and role_id is null
  ), 'the owner row was not seeded as an owner';
  -- RP-REQ-004: Admin = every key but company.profile; Member = the 16.
  assert (select array_agg(permission_key order by permission_key) from public.company_role_permissions where role_id = v_admin)
       = (select array_agg(key order by key) from public.company_permissions where key <> 'company.profile'),
    'Admin grants differ from RP-REQ-004';
  assert (select array_agg(permission_key order by permission_key collate "C") from public.company_role_permissions where role_id = v_member)
       = array['agent.use', 'applicants.screen', 'applicants.view', 'billing.view', 'jobs.view', 'matching.run',
               'notes.view', 'notes.write', 'outreach.send', 'outreach.view', 'pipeline.move', 'roles.view',
               'talent.save', 'talent.view', 'talent_lists.manage', 'team.view'],
    'Member grants differ from RP-REQ-004';
  assert not exists (
    select 1 from public.company_role_permissions where role_id in (v_admin, v_member) and scope <> 'all'
  ), 'a default role grant is not scope all';
end $$;

-- Backfill (the live companies, RP-REQ-004): every company has both roles and
-- an owner; the primary owner is an owner; every other member has a role.
do $$
declare n int;
begin
  assert not exists (
    select 1 from public.company_info ci
     where pg_temp.role_of(ci.id, 'admin') is null or pg_temp.role_of(ci.id, 'member') is null
        or ci.default_role_id is null
  ), 'a company is missing its seeded roles or default role';
  assert not exists (
    select 1 from public.company_info ci
     where ci.user_id is not null and not exists (
       select 1 from public.company_members m where m.company_id = ci.id and m.user_id = ci.user_id and m.is_owner
     )
  ), 'a primary owner is not an owner';
  assert not exists (select 1 from public.company_members where not is_owner and role_id is null),
    'a member has no role';
  assert not exists (select 1 from public.company_invites where role_id is null and accepted_at is null and revoked_at is null),
    'an open invite has no role';
  -- A second run changes nothing.
  n := (select count(*) from public.company_roles);
  assert public.backfill_company_roles() = 0, 'a backfill rerun changed members';
  assert (select count(*) from public.company_roles) = n, 'a backfill rerun added roles';
end $$;

-- Members of A (as postgres): Admin, Member, plus the fixtures for later blocks.
insert into public.company_members (company_id, user_id, role_id, display_name) values
  ('c0000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001',
     pg_temp.role_of('c0000000-0000-4000-8000-000000000001', 'admin'), 'Ada Admin'),
  ('c0000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001',
     pg_temp.role_of('c0000000-0000-4000-8000-000000000001', 'member'), 'Max Member'),
  ('c0000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000002',
     pg_temp.role_of('c0000000-0000-4000-8000-000000000002', 'member'), null);

insert into public.all_jobs (id, job_name, job_url, company_name, platform) values
  ('d0000000-0000-4000-8000-000000000001', 'A1', 'https://acme.test/jobs/1', 'Acme', 'gethired'),
  ('d0000000-0000-4000-8000-000000000002', 'B1', 'https://globex.test/jobs/1', 'Globex', 'gethired'),
  ('d0000000-0000-4000-8000-000000000003', 'A2', 'https://acme.test/jobs/2', 'Acme', 'gethired');

insert into public.job_postings (id, company_id, title, job_id) values
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'A1', 'd0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'B1', 'd0000000-0000-4000-8000-000000000002'),
  ('b0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'A2', 'd0000000-0000-4000-8000-000000000003');

insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003');

insert into public.company_favorites (company_id, user_id) values
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001');

insert into public.candidate_notes (company_id, candidate_user_id, application_id, author_user_id, body) values
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'A1 note'),
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001', 'A2 note'),
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', null, 'c1000000-0000-4000-8000-000000000001', 'Pool note');

insert into public.candidate_outreach (company_id, candidate_user_id, job_post_id, sender_user_id, subject, message) values
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'A1', 'Hi'),
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001', 'A2', 'Hi');

-- has_company_permission (RP-TEST-001).
do $$
declare
  a uuid := 'c0000000-0000-4000-8000-000000000001';
  k text;
begin
  perform pg_temp.act('c1000000-0000-4000-8000-000000000001');  -- owner
  for k in select key from public.company_permissions loop
    assert public.has_company_permission(a, k), format('owner lacks %s', k);
    assert public.has_company_permission(a, k, 'b0000000-0000-4000-8000-000000000003'), format('owner lacks %s on a job', k);
  end loop;
  assert not public.has_company_permission(a, 'billing.manage'), 'an unknown key passed for the owner';
  assert not public.has_company_permission('c0000000-0000-4000-8000-000000000002', 'jobs.view'),
    'the owner of A has permissions in B';

  perform pg_temp.act('c3000000-0000-4000-8000-000000000001');  -- Member, scope all
  assert public.has_company_permission(a, 'applicants.view'), 'scope all without a job';
  assert public.has_company_permission(a, 'applicants.view', 'b0000000-0000-4000-8000-000000000001'), 'scope all with a job';
  assert not public.has_company_permission(a, 'jobs.edit'), 'a member has jobs.edit';
  assert not public.has_company_permission(a, 'nope.nope'), 'an unknown key passed';

  perform pg_temp.act('a0000000-0000-4000-8000-000000000001');  -- no membership
  assert not public.has_company_permission(a, 'jobs.view'), 'a non-member has jobs.view';
  perform pg_temp.act(null);
end $$;

-- RLS parity with recruiter_teams.sql: owner, Admin and Member of A read A's
-- rows and none of B's.
select pg_temp.act('c3000000-0000-4000-8000-000000000001');
set local role authenticated;

do $$
declare n int;
begin
  assert (select count(*) from public.applications where job_post_id in
          ('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003')) = 2,
    'a member does not see A''s applications';
  assert not exists (select 1 from public.applications where job_post_id = 'b0000000-0000-4000-8000-000000000002'),
    'a member of A sees B''s applications';
  assert cardinality(public.my_job_ids_with('jobs.view')) = 2, 'a member does not have jobs.view on A''s jobs';
  assert (select count(*) from public.candidate_notes) = 3, 'a member does not see A''s notes';
  assert (select count(*) from public.candidate_outreach where company_id = 'c0000000-0000-4000-8000-000000000001') = 2,
    'a member does not see A''s outreach';
  assert (select count(*) from public.company_favorites) = 1, 'a member sees the wrong favorites';
  assert (select count(*) from public.pipeline_stages where company_id = 'c0000000-0000-4000-8000-000000000001') > 0,
    'a member does not see A''s stages';
  assert public.company_can_view_candidate('a0000000-0000-4000-8000-000000000001'), 'company_can_view_candidate failed';

  -- Role writes: a member can't edit jobs, stages or templates.
  update public.job_postings set title = 'x' where id = 'b0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'a member edited a job post';
  update public.pipeline_stages set name = 'x' where company_id = 'c0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'a member edited stages';
  begin
    insert into public.company_email_templates (company_id, purpose, name, subject, body_md)
    values ('c0000000-0000-4000-8000-000000000001', 'custom', 'x', 'x', 'x');
    raise exception 'a member inserted a template';
  exception when insufficient_privilege then null;
  end;
  -- … but moves applications and writes notes.
  update public.applications set status = 'reviewed' where id = 'e0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 1, 'a member could not move an application';
  insert into public.candidate_notes (company_id, candidate_user_id, application_id, author_user_id, body)
  values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
          'e0000000-0000-4000-8000-000000000001', (select auth.uid()), 'Member note');
  -- Not someone else's note (no notes.manage).
  update public.candidate_notes set body = 'edited' where body = 'A1 note';
  get diagnostics n = row_count;
  assert n = 0, 'a member edited the owner''s note';
  -- No billing.view? Member has it (RP-REQ-004), so subscriptions are readable.
  assert exists (select 1 from public.company_subscriptions where company_id = 'c0000000-0000-4000-8000-000000000001'),
    'a member cannot read the subscription';
  -- Team.view: the member list.
  assert (select count(*) from public.company_members where company_id = 'c0000000-0000-4000-8000-000000000001') >= 3,
    'a member does not see the team';
end $$;

reset role;

select pg_temp.act('c2000000-0000-4000-8000-000000000001');
set local role authenticated;

do $$
declare n int;
begin
  update public.job_postings set title = 'A1' where id = 'b0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 1, 'an Admin could not edit a job post';
  update public.candidate_notes set body = 'admin edit' where body = 'A1 note';
  get diagnostics n = row_count;
  assert n = 1, 'an Admin (notes.manage) could not edit another member''s note';
  update public.company_info set name = 'Hijack' where id = 'c0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'an Admin (no company.profile) updated the company profile';
  -- job_postings stays world-readable (the public job board), so "which jobs"
  -- is my_job_ids_with('jobs.view') in the app and the RPCs.
  assert not ('b0000000-0000-4000-8000-000000000002' = any (public.my_job_ids_with('jobs.view'))),
    'an Admin of A has B''s job in jobs.view';
end $$;

reset role;

-- Owners update the profile; the primary owner can't be changed by update.
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
set local role authenticated;
do $$
declare n int;
begin
  update public.company_info set name = 'Acme' , user_id = 'c3000000-0000-4000-8000-000000000001'
   where id = 'c0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 1, 'the owner could not update the profile';
end $$;
reset role;
do $$
begin
  assert (select user_id from public.company_info where id = 'c0000000-0000-4000-8000-000000000001')
       = 'c1000000-0000-4000-8000-000000000001', 'an update changed the primary owner';
end $$;

-- Integrity.
do $$
declare
  a uuid := 'c0000000-0000-4000-8000-000000000001';
  v_role uuid;
begin
  insert into public.company_roles (company_id, name) values (a, 'Integrity') returning id into v_role;

  begin
    insert into public.company_role_permissions (role_id, permission_key, scope) values (v_role, 'talent.view', 'assigned');
    raise exception 'assigned scope on a non-scopable key was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.company_role_permissions (role_id, permission_key) values (v_role, 'jobs.edit');
    set constraints company_role_permissions_deps immediate;
    raise exception 'a grant without its dependency was accepted';
  exception when check_violation then null;
  end;
  set constraints company_role_permissions_deps deferred;

  begin
    insert into public.company_role_permissions (role_id, permission_key, scope) values
      (v_role, 'jobs.view', 'assigned'), (v_role, 'jobs.edit', 'all');
    set constraints company_role_permissions_deps immediate;
    raise exception 'a dependency at a narrower scope was accepted';
  exception when check_violation then null;
  end;
  set constraints company_role_permissions_deps deferred;

  begin
    update public.company_members set role_id = pg_temp.role_of('c0000000-0000-4000-8000-000000000002', 'member')
     where user_id = 'c3000000-0000-4000-8000-000000000001';
    raise exception 'a member got another company''s role';
  exception when check_violation then null;
  end;

  begin
    update public.company_members set is_owner = false, role_id = pg_temp.role_of(a, 'admin')
     where user_id = 'c1000000-0000-4000-8000-000000000001';
    set constraints company_members_owners immediate;
    raise exception 'the last owner was demoted';
  exception when check_violation then null;
  end;
  set constraints company_members_owners deferred;

  begin
    update public.company_members set role_id = null where user_id = 'c3000000-0000-4000-8000-000000000001';
    raise exception 'a non-owner without a role was accepted';
  exception when check_violation then null;
  end;

  delete from public.company_roles where id = v_role;
end $$;

-- RP-SEC-002: no direct writes.
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
set local role authenticated;
do $$
begin
  begin
    insert into public.company_roles (company_id, name) values ('c0000000-0000-4000-8000-000000000001', 'Direct');
    raise exception 'authenticated inserted a role';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.company_role_permissions (role_id, permission_key)
    values ((select id from public.company_roles where company_id = 'c0000000-0000-4000-8000-000000000001'
              and template_key = 'member'), 'jobs.edit');
    raise exception 'authenticated inserted a grant';
  exception when insufficient_privilege or undefined_function then null;
  end;
  begin
    insert into public.company_role_limits (role_id, key, monthly_amount)
    values ((select id from public.company_roles limit 1), 'outreach', 1);
    raise exception 'authenticated inserted a limit';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.company_job_assignments (company_id, job_post_id, user_id)
    values ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', (select auth.uid()));
    raise exception 'authenticated inserted an assignment';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.company_audit_log (company_id, action, target_type) values
      ('c0000000-0000-4000-8000-000000000001', 'role.created', 'role');
    raise exception 'authenticated inserted an audit entry';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.company_members set is_owner = true;
    raise exception 'authenticated updated company_members';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ===================================================== block 2: roles
-- RPT-030. The role manager holds roles.manage, team.assign_roles and
-- team.invite but not billing.view or jobs.delete, and a 10-outreach cap.

do $$
declare
  a uuid := 'c0000000-0000-4000-8000-000000000001';
  r jsonb;
  v_mgr_role uuid;
  v_hm_role uuid;
  v_interviewer uuid;
  v_rich uuid;
begin
  perform pg_temp.act('c1000000-0000-4000-8000-000000000001');  -- owner
  r := public.create_company_role('Role manager', null, 'rose',
    '[{"key":"roles.manage"},{"key":"team.assign_roles"},{"key":"team.invite"},{"key":"jobs.edit"},
      {"key":"applicants.view","scope":"assigned"},{"key":"outreach.send"}]', '{"outreach": 10}', null);
  perform pg_temp.expect(r, null, 'owner creates a role');
  v_mgr_role := (r ->> 'id')::uuid;
  -- Dependencies were added server-side.
  assert exists (select 1 from public.company_role_permissions where role_id = v_mgr_role and permission_key = 'jobs.view' and scope = 'all'),
    'jobs.view was not added for jobs.edit';
  assert exists (select 1 from public.company_role_permissions where role_id = v_mgr_role and permission_key = 'talent.view'),
    'talent.view was not added for outreach.send';
  assert exists (select 1 from public.company_role_permissions where role_id = v_mgr_role and permission_key = 'roles.view'),
    'roles.view was not added for roles.manage';

  -- Name validation and case-insensitive uniqueness.
  perform pg_temp.expect(public.create_company_role('  role MANAGER ', null, 'slate', '[]', '{}', null), 'name_taken', 'duplicate name');
  perform pg_temp.expect(public.create_company_role('', null, 'slate', '[]', '{}', null), 'invalid_name', 'empty name');
  perform pg_temp.expect(public.create_company_role(repeat('x', 41), null, 'slate', '[]', '{}', null), 'invalid_name', 'long name');
  perform pg_temp.expect(public.create_company_role('Bad', null, 'slate', '[{"key":"nope.nope"}]', '{}', null), 'invalid_grant', 'unknown key');
  perform pg_temp.expect(public.create_company_role('Bad', null, 'slate', '[{"key":"talent.view","scope":"assigned"}]', '{}', null),
    'invalid_grant', 'assigned on a non-scopable key');
  perform pg_temp.expect(public.create_company_role('Bad', null, 'slate', '[]', '{"seats": 1}', null), 'invalid_limit', 'limit on a non-allowance key');
  perform pg_temp.expect(public.create_company_role('Bad', null, 'slate', '[]', '{"outreach": -1}', null), 'invalid_limit', 'negative limit');

  -- Hiring manager (applicants.view etc. on assigned jobs) and Interviewer.
  r := public.create_company_role('Hiring manager', null, 'amber',
    '[{"key":"jobs.view","scope":"assigned"},{"key":"jobs.edit","scope":"assigned"},{"key":"jobs.create"},
      {"key":"applicants.view","scope":"assigned"},{"key":"pipeline.move","scope":"assigned"},
      {"key":"applicants.screen","scope":"assigned"},{"key":"notes.view","scope":"assigned"},
      {"key":"notes.write","scope":"assigned"},{"key":"matching.run","scope":"assigned"},
      {"key":"outreach.view","scope":"assigned"},{"key":"outreach.send","scope":"assigned"},
      {"key":"jobs.assign","scope":"assigned"},{"key":"agent.use"}]', '{}', 'hiring_manager');
  perform pg_temp.expect(r, null, 'owner creates Hiring manager');
  v_hm_role := (r ->> 'id')::uuid;
  r := public.create_company_role('Interviewer', null, 'sky',
    '[{"key":"applicants.view","scope":"assigned"},{"key":"notes.write","scope":"assigned"}]', '{}', 'interviewer');
  perform pg_temp.expect(r, null, 'owner creates Interviewer');
  v_interviewer := (r ->> 'id')::uuid;
  -- A role with things the manager doesn't hold.
  r := public.create_company_role('Rich', null, 'teal', '[{"key":"billing.view"},{"key":"jobs.delete"}]', '{}', null);
  v_rich := (r ->> 'id')::uuid;

  insert into public.company_members (company_id, user_id, role_id, display_name) values
    (a, 'c6000000-0000-4000-8000-000000000001', v_mgr_role, 'Rita Roles'),
    (a, 'c5000000-0000-4000-8000-000000000001', v_hm_role, 'Hank Hiring');
  insert into public.company_members (company_id, user_id, role_id, display_name) values
    (a, 'c7000000-0000-4000-8000-000000000001', v_rich, 'Rich Person');
  -- Nora holds a role inside the role manager's ceiling.
  r := public.create_company_role('Narrow', null, 'slate', '[{"key":"talent.view"}]', '{}', null);
  insert into public.company_members (company_id, user_id, role_id, display_name) values
    (a, 'c8000000-0000-4000-8000-000000000002', (r ->> 'id')::uuid, 'Nora Narrow');

  -- ------------------------------------------------ as the role manager
  perform pg_temp.act('c6000000-0000-4000-8000-000000000001');

  -- (1) the grant ceiling, and limits above their own.
  perform pg_temp.expect(public.create_company_role('Finance', null, 'teal', '[{"key":"billing.view"}]', '{}', null),
    'above_ceiling', 'rule 1: granting billing.view');
  perform pg_temp.expect(public.create_company_role('Wide', null, 'teal', '[{"key":"applicants.view"}]', '{}', null),
    'above_ceiling', 'rule 1: widening assigned to all');
  perform pg_temp.expect(public.create_company_role('Capped', null, 'teal', '[{"key":"outreach.send"}]', '{"outreach": 11}', null),
    'above_ceiling', 'rule 1: a limit above their own');
  perform pg_temp.expect(public.create_company_role('Narrow 2', null, 'teal',
    '[{"key":"applicants.view","scope":"assigned"},{"key":"outreach.send"}]', '{"outreach": 5}', null),
    null, 'rule 1: within the ceiling');

  -- (2) editing or deleting a role above them.
  perform pg_temp.expect(public.update_company_role(v_rich, 'Richer'), 'above_ceiling', 'rule 2: rename a richer role');
  perform pg_temp.expect(public.delete_company_role(v_rich, pg_temp.role_of(a, 'member')), 'above_ceiling', 'rule 2: delete');

  -- (3) assigning it to a member or an invite.
  perform pg_temp.expect(public.set_company_member_role('c8000000-0000-4000-8000-000000000002', v_rich),
    'above_ceiling', 'rule 3: assign to a member');
  perform pg_temp.expect(public.create_company_invite('new@acme.test', v_rich), 'above_ceiling', 'rule 3: invite');

  -- (4) acting on someone who holds it, and on an owner.
  perform pg_temp.expect(public.set_company_member_role('c7000000-0000-4000-8000-000000000001', v_interviewer),
    'above_ceiling', 'rule 4: change a richer member');
  perform pg_temp.expect(public.set_company_member_role('c1000000-0000-4000-8000-000000000001', v_interviewer),
    'owner', 'rule 4: change an owner');
  perform pg_temp.expect(public.remove_company_member('c7000000-0000-4000-8000-000000000001'),
    'forbidden', 'no team.remove');

  -- (5) their own role: no grant changes, renaming works.
  perform pg_temp.expect(public.set_company_member_role('c6000000-0000-4000-8000-000000000001', v_interviewer),
    'own_role', 'rule 5: change own role');
  perform pg_temp.expect(public.update_company_role(v_mgr_role, null, null, null, '[{"key":"roles.manage"}]', null),
    'own_role', 'rule 5: change own grants');
  perform pg_temp.expect(public.update_company_role(v_mgr_role, null, null, null, null, '{"outreach": 5}'),
    'own_role', 'rule 5: change own limits');
  perform pg_temp.expect(public.update_company_role(v_mgr_role, 'Role keeper', 'Keeps roles'), null, 'rule 5: rename own role');
  assert (select name from public.company_roles where id = v_mgr_role) = 'Role keeper', 'the rename did not apply';

  -- Within the ceiling, members move; Max (Member, with billing.view) is above them.
  perform pg_temp.expect(public.set_company_member_role('c8000000-0000-4000-8000-000000000002',
    (select id from public.company_roles where company_id = a and name = 'Narrow 2')), null, 'move Nora within the ceiling');
  perform pg_temp.expect(public.set_company_member_role('c3000000-0000-4000-8000-000000000001',
    (select id from public.company_roles where company_id = a and name = 'Narrow 2')), 'above_ceiling', 'rule 4: Max is above');

  -- ------------------------------------------------ as the owner
  perform pg_temp.act('c1000000-0000-4000-8000-000000000001');

  -- delete_company_role: replacement needed while members or invites exist.
  perform pg_temp.expect(public.delete_company_role(v_rich), 'has_members', 'delete with members, no replacement');
  perform pg_temp.expect(public.delete_company_role(v_rich, pg_temp.role_of('c0000000-0000-4000-8000-000000000002', 'member')),
    'not_found', 'a replacement from another company');
  perform pg_temp.expect(public.delete_company_role(pg_temp.role_of(a, 'member'), pg_temp.role_of(a, 'admin')),
    'is_default', 'delete the default role');
  perform pg_temp.expect(public.create_company_invite('rich@acme.test', v_rich), null, 'invite with Rich');
  perform pg_temp.expect(public.delete_company_role(v_rich, v_interviewer), null, 'delete with a replacement');
  assert (select role_id from public.company_members where user_id = 'c7000000-0000-4000-8000-000000000001') = v_interviewer,
    'the member did not move to the replacement';
  assert (select role_id from public.company_invites where email = 'rich@acme.test') = v_interviewer,
    'the open invite did not move to the replacement';
  assert not exists (select 1 from public.company_roles where id = v_rich), 'the role was not deleted';

  -- set_default_company_role.
  perform pg_temp.expect(public.set_default_company_role(v_interviewer), null, 'set the default role');
  assert (select default_role_id from public.company_info where id = a) = v_interviewer, 'the default role did not change';
  perform pg_temp.expect(public.set_default_company_role(pg_temp.role_of(a, 'member')), null, 'set it back');

  -- set_company_member_role.
  perform pg_temp.expect(public.set_company_member_role('c7000000-0000-4000-8000-000000000001', pg_temp.role_of(a, 'member')),
    null, 'owner changes a member''s role');
  perform pg_temp.expect(public.set_company_member_role('c7000000-0000-4000-8000-000000000001', gen_random_uuid()),
    'invalid_role', 'an unknown role');

  -- Invites: a deleted role falls back to the default role on accept.
  r := public.create_company_invite('invitee@gmail.test', v_interviewer);
  perform pg_temp.expect(r, null, 'invite with Interviewer');
  perform pg_temp.expect(public.create_company_invite('rich@acme.test', null), 'already_invited', 'the open invite still exists');
  perform public.revoke_company_invite((select id from public.company_invites where email = 'rich@acme.test'));
  perform pg_temp.expect(public.delete_company_role(v_interviewer, pg_temp.role_of(a, 'member')), null, 'delete Interviewer');
  -- (The invite moved to Member with the delete; null it to simulate a role deleted later.)
  update public.company_invites set role_id = null where email = 'invitee@gmail.test';
  perform pg_temp.act('c4000000-0000-4000-8000-000000000001');
  r := public.accept_company_invite(r ->> 'token', 'Ivy');
  perform pg_temp.expect(r, null, 'accept an invite whose role was deleted');
  assert (r ->> 'fell_back')::boolean, 'the accept did not report the fallback';
  assert (select role_id from public.company_members where user_id = 'c4000000-0000-4000-8000-000000000001')
       = pg_temp.role_of(a, 'member'), 'the invitee did not get the default role';

  -- list_company_roles: for roles.view only.
  perform pg_temp.act('c1000000-0000-4000-8000-000000000001');
  assert jsonb_array_length(public.list_company_roles()) >= 4, 'list_company_roles returned too few roles';
  assert exists (
    select 1 from jsonb_array_elements(public.list_company_roles()) x
     where x ->> 'name' = 'Member' and (x ->> 'is_default')::boolean and (x ->> 'member_count')::int >= 2
  ), 'list_company_roles lacks the Member count or default marker';
  perform pg_temp.act('c5000000-0000-4000-8000-000000000001');  -- Hiring manager: no roles.view
  assert public.list_company_roles() is null, 'list_company_roles answered without roles.view';
  perform pg_temp.act(null);
end $$;

-- ===================================================== block 3: owners
-- RPT-040.

do $$
declare a uuid := 'c0000000-0000-4000-8000-000000000001';
begin
  perform pg_temp.act('c2000000-0000-4000-8000-000000000001');  -- Admin: not an owner
  perform pg_temp.expect(public.set_company_owner('c7000000-0000-4000-8000-000000000001', true), 'forbidden', 'an Admin promotes');
  perform pg_temp.expect(public.make_primary_owner('c2000000-0000-4000-8000-000000000001'), 'forbidden', 'an Admin takes primary');
  perform pg_temp.expect(public.remove_company_member('c1000000-0000-4000-8000-000000000001'), 'primary_owner', 'remove the primary owner');

  perform pg_temp.act('c1000000-0000-4000-8000-000000000001');  -- primary owner
  perform pg_temp.expect(public.set_company_owner('c7000000-0000-4000-8000-000000000001', true), null, 'promote a member');
  assert (select is_owner and role_id is null from public.company_members where user_id = 'c7000000-0000-4000-8000-000000000001'),
    'the promotion did not apply';
  perform pg_temp.expect(public.set_company_owner('c7000000-0000-4000-8000-000000000001', false), 'invalid_role',
    'demote without a role');
  perform pg_temp.expect(public.set_company_owner('c1000000-0000-4000-8000-000000000001', false, pg_temp.role_of(a, 'admin')),
    'primary_owner', 'demote the primary owner');
  perform pg_temp.expect(public.make_primary_owner('c3000000-0000-4000-8000-000000000001'), 'not_owner', 'primary to a non-owner');
  perform pg_temp.expect(public.remove_company_member('c1000000-0000-4000-8000-000000000001'), 'primary_owner',
    'the primary owner leaves');

  perform pg_temp.expect(public.make_primary_owner('c7000000-0000-4000-8000-000000000001'), null, 'hand over primary');
  assert (select user_id from public.company_info where id = a) = 'c7000000-0000-4000-8000-000000000001',
    'company_info.user_id did not follow';
  set constraints all immediate;
  set constraints all deferred;

  -- The old primary is still an owner and can now leave or be demoted.
  perform pg_temp.expect(public.set_company_owner('c1000000-0000-4000-8000-000000000001', false, pg_temp.role_of(a, 'admin')),
    null, 'demote the former primary owner');
  assert (select not is_owner from public.company_members where user_id = 'c1000000-0000-4000-8000-000000000001'),
    'the demotion did not apply';

  perform pg_temp.act('c7000000-0000-4000-8000-000000000001');
  perform pg_temp.expect(public.set_company_owner('c7000000-0000-4000-8000-000000000001', false, pg_temp.role_of(a, 'admin')),
    'primary_owner', 'the last (primary) owner demotes themselves');
  perform pg_temp.expect(public.set_company_owner('c1000000-0000-4000-8000-000000000001', true), null, 'promote again');
  perform pg_temp.expect(public.make_primary_owner('c1000000-0000-4000-8000-000000000001'), null, 'hand back primary');

  -- A non-primary owner can leave.
  perform pg_temp.expect(public.remove_company_member('c7000000-0000-4000-8000-000000000001'), null, 'a co-owner leaves');
  set constraints all immediate;
  set constraints all deferred;

  -- Audit: each wrote one entry.
  assert (select count(*) from public.company_audit_log where company_id = a and action = 'owner.added') = 2, 'owner.added entries';
  assert (select count(*) from public.company_audit_log where company_id = a and action = 'owner.removed') = 1, 'owner.removed entries';
  assert (select count(*) from public.company_audit_log where company_id = a and action = 'owner.primary_changed') = 2,
    'owner.primary_changed entries';
  assert (select count(*) from public.company_audit_log where company_id = a and action = 'member.left') = 1, 'member.left entries';
  perform pg_temp.act(null);
end $$;

-- ===================================================== block 4: job scope
-- RPT-050, as the Hiring manager (assigned to A1, not A2).

do $$
begin
  perform pg_temp.act('c1000000-0000-4000-8000-000000000001');
  perform pg_temp.expect(public.assign_job('b0000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001'),
    null, 'the owner assigns the Hiring manager to A1');
  perform pg_temp.expect(public.assign_job('b0000000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000001'),
    'not_found', 'assign on another company''s job');
  perform pg_temp.expect(public.assign_job('b0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001'),
    'invalid_target', 'assign an owner');
  perform pg_temp.act(null);
end $$;

select pg_temp.act('c5000000-0000-4000-8000-000000000001');
set local role authenticated;

do $$
declare n int;
begin
  assert public.my_job_ids_with('jobs.view') = array['b0000000-0000-4000-8000-000000000001'::uuid],
    'the Hiring manager has jobs.view beyond A1';
  assert (select array_agg(id) from public.applications where job_post_id <> 'b0000000-0000-4000-8000-000000000002')
       = array['e0000000-0000-4000-8000-000000000001'::uuid], 'the Hiring manager sees A2''s applications';
  assert (select count(*) from public.candidate_notes where body = 'A2 note') = 0, 'the Hiring manager reads A2''s notes';
  assert (select count(*) from public.candidate_notes where application_id = 'e0000000-0000-4000-8000-000000000001') >= 1,
    'the Hiring manager cannot read A1''s notes';
  assert (select count(*) from public.candidate_notes where application_id is null) = 0,
    'the Hiring manager reads notes without an application (needs scope all)';
  assert (select count(*) from public.candidate_outreach where company_id = 'c0000000-0000-4000-8000-000000000001') = 1,
    'the Hiring manager sees A2''s outreach';
  assert public.get_job_funnel('b0000000-0000-4000-8000-000000000003') is null, 'the funnel for A2 answered';
  assert public.get_job_funnel('b0000000-0000-4000-8000-000000000001') is not null, 'the funnel for A1 did not answer';
  assert (select count(*) from public.get_recruiter_job_summaries('c0000000-0000-4000-8000-000000000001')) = 1,
    'the job summaries list A2';

  update public.applications set status = 'reviewed' where id = 'e0000000-0000-4000-8000-000000000003';
  get diagnostics n = row_count;
  assert n = 0, 'the Hiring manager moved an A2 application';
  update public.applications set status = 'reviewed' where id = 'e0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 1, 'the Hiring manager could not move an A1 application';
  update public.job_postings set title = 'A1 edited' where id = 'b0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 1, 'the Hiring manager could not edit their own job';
  begin
    update public.job_postings set status = 'active' where id = 'b0000000-0000-4000-8000-000000000001';
    raise exception 'the Hiring manager changed a status without jobs.publish';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

do $$
begin
  -- Rule 6: jobs.assign:assigned only on their own assigned jobs.
  perform pg_temp.act('c5000000-0000-4000-8000-000000000001');
  perform pg_temp.expect(public.assign_job('b0000000-0000-4000-8000-000000000003', 'c5000000-0000-4000-8000-000000000001'),
    'forbidden', 'rule 6: assign on an unassigned job');
  -- Can't assign a member without a job-scopable permission… every role here has one; Finance doesn't.
  perform pg_temp.act('c1000000-0000-4000-8000-000000000001');
  perform public.create_company_role('Finance', null, 'teal', '[{"key":"billing.view"},{"key":"team.view"}]', '{}', 'finance');
  insert into public.company_members (company_id, user_id, role_id) values
    ('c0000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000001',
     (select id from public.company_roles where name = 'Finance' and company_id = 'c0000000-0000-4000-8000-000000000001'));
  perform pg_temp.expect(public.assign_job('b0000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000001'),
    'invalid_target', 'assign a member with no job permission');
  perform pg_temp.expect(public.unassign_job('b0000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001'),
    null, 'the owner unassigns');
  perform pg_temp.expect(public.assign_job('b0000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001'),
    null, 'the owner reassigns');

  -- list_job_hiring_team: the panel's flags match what assign_job accepts.
  declare
    team jsonb := public.list_job_hiring_team('b0000000-0000-4000-8000-000000000001');
    pick jsonb;
  begin
    select e into pick from jsonb_array_elements(team) e
     where e->>'user_id' = 'c5000000-0000-4000-8000-000000000001';
    assert (pick->>'assigned')::boolean and (pick->>'assignable')::boolean and (pick->>'removable')::boolean,
      'hiring team: the Hiring manager is not assigned, assignable and removable';
    select e into pick from jsonb_array_elements(team) e
     where e->>'user_id' = 'c8000000-0000-4000-8000-000000000001';
    assert not (pick->>'assigned')::boolean and not (pick->>'assignable')::boolean,
      'hiring team: Finance is offered';
    select e into pick from jsonb_array_elements(team) e
     where e->>'user_id' = 'c1000000-0000-4000-8000-000000000001';
    assert not (pick->>'assignable')::boolean, 'hiring team: an owner is offered';
  end;
  assert public.list_job_hiring_team('b0000000-0000-4000-8000-000000000002') is null,
    'hiring team: another company''s job answered';
  perform pg_temp.act('c5000000-0000-4000-8000-000000000001');
  assert public.list_job_hiring_team('b0000000-0000-4000-8000-000000000003') is null,
    'hiring team: rule 6, a job the Hiring manager is not on answered';
  assert public.list_job_hiring_team('b0000000-0000-4000-8000-000000000001') is not null,
    'hiring team: the Hiring manager cannot see their own job''s team';

  -- list_company_hiring_teams: the central page lists the jobs the caller can
  -- assign on (rule 6) and the same member flags as the job panel.
  declare
    teams jsonb := public.list_company_hiring_teams();
    ids text[];
    pick jsonb;
  begin
    select array_agg(j->>'id') into ids from jsonb_array_elements(teams->'jobs') j;
    assert ids = array['b0000000-0000-4000-8000-000000000001'],
      format('hiring teams: the Hiring manager sees jobs %s', ids);
    perform pg_temp.act('c1000000-0000-4000-8000-000000000001');
    teams := public.list_company_hiring_teams();
    select array_agg(j->>'id' order by j->>'id') into ids from jsonb_array_elements(teams->'jobs') j;
    assert ids = array['b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003'],
      format('hiring teams: the owner sees jobs %s', ids);
    assert exists (
      select 1 from jsonb_array_elements(teams->'jobs') j
       where j->>'id' = 'b0000000-0000-4000-8000-000000000001'
         and j->'assigned_user_ids' ? 'c5000000-0000-4000-8000-000000000001'
    ), 'hiring teams: A1 does not list the Hiring manager';
    select e into pick from jsonb_array_elements(teams->'members') e
     where e->>'user_id' = 'c8000000-0000-4000-8000-000000000001';
    assert not (pick->>'assignable')::boolean, 'hiring teams: Finance is offered';
    select e into pick from jsonb_array_elements(teams->'members') e
     where e->>'user_id' = 'c1000000-0000-4000-8000-000000000001';
    assert not (pick->>'assignable')::boolean, 'hiring teams: an owner is offered';
    assert not exists (
      select 1 from jsonb_array_elements(teams->'members') e
       where e->>'user_id' = 'c1000000-0000-4000-8000-000000000002'
    ), 'hiring teams: another company''s member listed';
    perform pg_temp.act('c8000000-0000-4000-8000-000000000001');
    assert public.list_company_hiring_teams() is null, 'hiring teams: answered without jobs.assign';
  end;

  perform pg_temp.act(null);
end $$;

-- Creator auto-assign: a job the Hiring manager inserts is theirs.
select pg_temp.act('c5000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into public.job_postings (id, company_id, title)
values ('b0000000-0000-4000-8000-0000000000f1', 'c0000000-0000-4000-8000-000000000001', 'HM job');
reset role;

do $$
begin
  assert exists (select 1 from public.company_job_assignments
                  where job_post_id = 'b0000000-0000-4000-8000-0000000000f1'
                    and user_id = 'c5000000-0000-4000-8000-000000000001'),
    'the creator was not assigned';

  -- Cleanup: removing a member deletes their assignments.
  perform pg_temp.act('c1000000-0000-4000-8000-000000000001');
  perform pg_temp.expect(public.remove_company_member('c5000000-0000-4000-8000-000000000001'), null, 'remove the Hiring manager');
  assert not exists (select 1 from public.company_job_assignments where user_id = 'c5000000-0000-4000-8000-000000000001'),
    'removing a member left their assignments';
  assert (select count(*) from public.company_audit_log where action = 'job.assigned'
           and company_id = 'c0000000-0000-4000-8000-000000000001') = 3, 'job.assigned entries';
  assert (select count(*) from public.company_audit_log where action = 'job.unassigned'
           and company_id = 'c0000000-0000-4000-8000-000000000001') = 1, 'job.unassigned entries';
  perform pg_temp.act(null);
end $$;

-- ===================================================== block 6: audit log
-- RPT-070 (block 5, usage limits, is in recruiter_role_limits below).

do $$
declare
  a uuid := 'c0000000-0000-4000-8000-000000000001';
  r jsonb;
  v_role uuid;
  v_entry public.company_audit_log;
  n int;
begin
  perform pg_temp.act('c1000000-0000-4000-8000-000000000001');
  n := (select count(*) from public.company_audit_log where company_id = a);
  r := public.create_company_role('Audited', 'Before', 'slate', '[{"key":"talent.view"}]', '{"outreach": 3}', null, 'agent');
  v_role := (r ->> 'id')::uuid;
  select * into v_entry from public.company_audit_log where company_id = a order by id desc limit 1;
  assert v_entry.action = 'role.created' and v_entry.target_type = 'role' and v_entry.target_id = v_role::text
     and v_entry.target_label = 'Audited' and v_entry.before is null
     and v_entry.after -> 'grants' = '{"talent.view": "all"}'::jsonb and v_entry.after -> 'limits' = '{"outreach": 3}'::jsonb
     and v_entry.actor_kind = 'agent' and v_entry.actor_user_id = 'c1000000-0000-4000-8000-000000000001',
    format('role.created entry shape: %s', to_jsonb(v_entry));

  perform public.update_company_role(v_role, 'Audited 2', null, null, '[{"key":"talent.save"}]', null);
  select * into v_entry from public.company_audit_log where company_id = a order by id desc limit 1;
  assert v_entry.action = 'role.updated' and v_entry.before ->> 'name' = 'Audited' and v_entry.after ->> 'name' = 'Audited 2'
     and v_entry.after -> 'grants' = '{"talent.save": "all", "talent.view": "all"}'::jsonb and v_entry.actor_kind = 'user',
    format('role.updated entry shape: %s', to_jsonb(v_entry));

  -- A failed RPC writes nothing.
  n := (select count(*) from public.company_audit_log where company_id = a);
  perform public.create_company_role('Audited 2', null, 'slate', '[]', '{}', null);
  perform public.delete_company_role(pg_temp.role_of(a, 'member'), null);
  assert (select count(*) from public.company_audit_log where company_id = a) = n, 'a failed RPC wrote an audit entry';

  perform public.delete_company_role(v_role);
  select * into v_entry from public.company_audit_log where company_id = a order by id desc limit 1;
  assert v_entry.action = 'role.deleted' and v_entry.before ->> 'name' = 'Audited 2', 'role.deleted entry shape';

  -- Invites and role changes.
  r := public.create_company_invite('audit@acme.test', null);
  select * into v_entry from public.company_audit_log where company_id = a order by id desc limit 1;
  assert v_entry.action = 'invite.created' and v_entry.target_label = 'audit@acme.test'
     and v_entry.after -> 'role' ->> 'name' = 'Member', 'invite.created entry shape';
  perform public.revoke_company_invite((r ->> 'id')::uuid);
  select * into v_entry from public.company_audit_log where company_id = a order by id desc limit 1;
  assert v_entry.action = 'invite.revoked', 'invite.revoked entry';
  perform public.set_company_member_role('c3000000-0000-4000-8000-000000000001', pg_temp.role_of(a, 'admin'));
  select * into v_entry from public.company_audit_log where company_id = a order by id desc limit 1;
  assert v_entry.action = 'member.role_changed' and v_entry.before -> 'role' ->> 'name' = 'Member'
     and v_entry.after -> 'role' ->> 'name' = 'Admin' and v_entry.target_label = 'Max Member', 'member.role_changed entry shape';
  perform public.set_company_member_role('c3000000-0000-4000-8000-000000000001', pg_temp.role_of(a, 'member'));

  -- list_company_audit: newest first, keyset and filters, audit.view only.
  assert (public.list_company_audit(null, 2) -> 0 ->> 'id')::bigint > (public.list_company_audit(null, 2) -> 1 ->> 'id')::bigint,
    'the audit list is not newest first';
  assert jsonb_array_length(public.list_company_audit(null, 100, null, 'role')) >= 3, 'the action filter (prefix) failed';
  assert not exists (
    select 1 from jsonb_array_elements(public.list_company_audit(null, 100, null, 'invite.revoked')) x
     where x ->> 'action' <> 'invite.revoked'
  ), 'the exact action filter failed';
  assert (public.list_company_audit((public.list_company_audit(null, 1) -> 0 ->> 'id')::bigint, 1) -> 0 ->> 'id')::bigint
       < (public.list_company_audit(null, 1) -> 0 ->> 'id')::bigint, 'keyset pagination failed';
  perform pg_temp.act('c3000000-0000-4000-8000-000000000001');  -- Member: no audit.view
  assert public.list_company_audit() is null, 'a member without audit.view read the audit log';
  perform pg_temp.act(null);
end $$;

-- RP-SEC-007: nobody but the service role writes or edits the log, not even an owner.
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
set local role authenticated;
do $$
declare n int;
begin
  assert (select count(*) from public.company_audit_log) > 0, 'the owner cannot read the audit log';
  begin
    update public.company_audit_log set target_label = 'x';
    raise exception 'an owner updated the audit log';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.company_audit_log;
    raise exception 'an owner deleted from the audit log';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select pg_temp.act('c3000000-0000-4000-8000-000000000001');
set local role authenticated;
do $$
begin
  assert (select count(*) from public.company_audit_log) = 0, 'a member without audit.view reads the audit log';
end $$;
reset role;

-- ===================================================== block 5: usage limits
-- RPT-060 (20261017170000_recruiter_role_limits.sql).

do $$
declare
  a uuid := 'c0000000-0000-4000-8000-000000000001';
  v_capped uuid;
  r jsonb;
begin
  perform pg_temp.act('c1000000-0000-4000-8000-000000000001');
  r := public.create_company_role('Capped', null, 'slate', '[{"key":"outreach.send"}]', '{"outreach": 2, "screenings": 0}', null);
  v_capped := (r ->> 'id')::uuid;
  -- (A is on Enterprise: unlimited outreach, so only the member cap stops them.)
  update public.company_members set role_id = v_capped
   where user_id in ('c8000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000002');
  perform pg_temp.act(null);

  -- X: two consumes pass, the third is member_limit. Y is unaffected.
  r := public.consume_entitlement(a, 'outreach', 1, 'test', 'x1', 'c8000000-0000-4000-8000-000000000001');
  perform pg_temp.expect(r, null, 'X consume 1');
  r := public.consume_entitlement(a, 'outreach', 1, 'test', 'x2', 'c8000000-0000-4000-8000-000000000001');
  perform pg_temp.expect(r, null, 'X consume 2');
  r := public.consume_entitlement(a, 'outreach', 1, 'test', 'x3', 'c8000000-0000-4000-8000-000000000001');
  perform pg_temp.expect(r, 'member_limit', 'X consume 3');
  assert (r ->> 'limit')::int = 2 and (r ->> 'used')::int = 2, format('member_limit payload: %s', r);
  perform pg_temp.expect(public.consume_entitlement(a, 'outreach', 1, 'test', 'y1', 'c8000000-0000-4000-8000-000000000002'),
    null, 'Y is unaffected');
  -- An owner is never capped; a system actor (null) isn't either.
  perform pg_temp.expect(public.consume_entitlement(a, 'outreach', 1, 'test', 'o1', 'c1000000-0000-4000-8000-000000000001'),
    null, 'the owner is not capped');
  perform pg_temp.expect(public.consume_entitlement(a, 'outreach', 1, 'test', 's1', null), null, 'the system is not capped');
  -- A zero cap blocks the key entirely.
  perform pg_temp.expect(public.hold_entitlement(a, 'screenings', 1, 'test', 'xs1', null, 'c8000000-0000-4000-8000-000000000001'),
    'member_limit', 'a zero cap blocks holds');

  -- Holds count toward the cap; releasing one frees it.
  perform pg_temp.expect(public.hold_entitlement(a, 'outreach', 1, 'test', 'yh1', null, 'c8000000-0000-4000-8000-000000000002'),
    null, 'Y holds 1 (now 2 of 2)');
  perform pg_temp.expect(public.consume_entitlement(a, 'outreach', 1, 'test', 'y2', 'c8000000-0000-4000-8000-000000000002'),
    'member_limit', 'the hold counts toward the cap');
  -- Converting the hold itself is fine (its qty doesn't count against itself).
  perform pg_temp.expect(public.consume_entitlement(a, 'outreach', 1, 'test', 'yh1', 'c8000000-0000-4000-8000-000000000002'),
    null, 'consume against the hold');
  perform pg_temp.expect(public.hold_entitlement(a, 'outreach', 1, 'test', 'yh2', null, 'c8000000-0000-4000-8000-000000000002'),
    'member_limit', 'Y is at the cap');

  -- The period boundary: usage before this period doesn't count.
  update public.company_usage_events set created_at = public.billing_period_start(a) - interval '1 day'
   where company_id = a and actor_user_id = 'c8000000-0000-4000-8000-000000000001';
  perform pg_temp.expect(public.consume_entitlement(a, 'outreach', 1, 'test', 'x4', 'c8000000-0000-4000-8000-000000000001'),
    null, 'a new period resets the cap');

  -- member_usage: per member, for billing.view.
  perform pg_temp.act('c1000000-0000-4000-8000-000000000001');
  assert exists (
    select 1 from jsonb_array_elements(public.member_usage()) x
     where x ->> 'user_id' = 'c8000000-0000-4000-8000-000000000002' and (x -> 'usage' ->> 'outreach')::int = 2
  ), format('member_usage: %s', public.member_usage());
  perform pg_temp.act('c8000000-0000-4000-8000-000000000001');  -- Capped: no billing.view
  assert public.member_usage() is null, 'member_usage answered without billing.view';
  perform pg_temp.act(null);
end $$;

select 'recruiter_roles: ok' as result;

rollback;
