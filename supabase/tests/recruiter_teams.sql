-- TM-TEST-001: recruiter teams. Runs in a transaction that always rolls back,
-- so it's safe to run against the linked project:
--   npx supabase db query --linked -f supabase/tests/recruiter_teams.sql
-- Any failed check raises an exception; success prints 'recruiter_teams: ok'.
-- Ids match test/utils/recruiter.ts and test/utils/team.ts.
--
-- Written for the owner/admin/member model and ported to the roles model
-- (20261017160000_recruiter_roles.sql): owners are `is_owner`, everyone else
-- holds a role (the seeded Admin and Member here), and a company can have
-- several owners. The role rules themselves are in recruiter_roles.sql.

begin;

-- Seed: company A (owner), company B (owner), one applicant.
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('c1000000-0000-4000-8000-000000000001', 'hr@acme.test', 'authenticated', 'authenticated', now()),
  ('c1000000-0000-4000-8000-000000000002', 'hr@globex.test', 'authenticated', 'authenticated', now()),
  ('a0000000-0000-4000-8000-000000000001', 'public@applicant.test', 'authenticated', 'authenticated', now()),
  -- test/utils/team.ts: ADMIN_A, MEMBER_A, MEMBER_B, and an invitee with no account type yet.
  ('c2000000-0000-4000-8000-000000000001', 'admin@acme.test', 'authenticated', 'authenticated', now()),
  ('c3000000-0000-4000-8000-000000000001', 'member@acme.test', 'authenticated', 'authenticated', now()),
  ('c3000000-0000-4000-8000-000000000002', 'member@globex.test', 'authenticated', 'authenticated', now()),
  ('c4000000-0000-4000-8000-000000000001', 'Invitee@Gmail.test', 'authenticated', 'authenticated', now()),
  ('c4000000-0000-4000-8000-000000000002', 'unconfirmed@gmail.test', 'authenticated', 'authenticated', null);

insert into public.company_info (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Acme', 'hr@acme.test'),
  ('c0000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'Globex', 'hr@globex.test');

insert into public.user_info (user_id, email, full_name, is_public, filled) values
  ('a0000000-0000-4000-8000-000000000001', 'public@applicant.test', 'Public', true, true);

-- The seeded roles' ids, readable inside blocks that run as `authenticated`.
create temporary table ids (name text primary key, id uuid);
insert into ids
select 'a_' || template_key, id from public.company_roles
 where company_id = 'c0000000-0000-4000-8000-000000000001' and template_key in ('admin', 'member')
union all
select 'b_' || template_key, id from public.company_roles
 where company_id = 'c0000000-0000-4000-8000-000000000002' and template_key = 'member';
grant select on ids to authenticated;

-- ===================================================== block 0: TM-SEC-007
-- Only the service role creates companies.

-- ---------------------------------------------------------------- applicant
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  begin
    insert into public.company_info (user_id, email)
    values ((select auth.uid()), 'public@applicant.test');
    raise exception 'an applicant inserted a company_info row';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- ---------------------------------------------------------------- owner of A
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare n int;
begin
  begin
    insert into public.company_info (user_id, email)
    values ((select auth.uid()), 'second@acme.test');
    raise exception 'a company owner inserted a second company_info row';
  exception when insufficient_privilege then null;
  end;

  update public.company_info set name = 'Acme Inc'
   where id = 'c0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 1, 'the owner could not update their own company_info row';

  update public.company_info set name = 'Hijacked'
   where id = 'c0000000-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  assert n = 0, 'the owner of A updated company B';
end $$;

reset role;

-- ---------------------------------------------------------------- service role
do $$
begin
  insert into auth.users (id, email, aud, role) values
    ('c1000000-0000-4000-8000-000000000009', 'hr@initech.test', 'authenticated', 'authenticated');
  insert into public.company_info (id, user_id, name, email) values
    ('c0000000-0000-4000-8000-000000000009', 'c1000000-0000-4000-8000-000000000009', 'Initech', 'hr@initech.test');
end $$;


-- Initech's owner row came from the seed_owner_membership trigger.
do $$
begin
  assert exists (
    select 1 from public.company_members
     where company_id = 'c0000000-0000-4000-8000-000000000009'
       and user_id = 'c1000000-0000-4000-8000-000000000009' and is_owner
  ), 'seed_owner_membership did not create the owner row';
end $$;

-- ===================================================== block 1: membership
-- TMT-012. Seed the members (as postgres), one job, application and favorite each.

insert into public.company_members (company_id, user_id, role_id, display_name) values
  ('c0000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', (select id from ids where name = 'a_admin'), 'Ada Admin'),
  ('c0000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', (select id from ids where name = 'a_member'), 'Max Member'),
  ('c0000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000002', (select id from ids where name = 'b_member'), null);

insert into public.all_jobs (id, job_name, job_url, company_name, platform) values
  ('d0000000-0000-4000-8000-000000000001', 'A job', 'https://acme.test/jobs/1', 'Acme', 'gethired'),
  ('d0000000-0000-4000-8000-000000000002', 'B job', 'https://globex.test/jobs/1', 'Globex', 'gethired');

insert into public.job_postings (id, company_id, title, job_id) values
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'A job', 'd0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'B job', 'd0000000-0000-4000-8000-000000000002');

insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002');

insert into public.company_favorites (company_id, user_id) values
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001');

-- Backfill: idempotent; every company's user_id (the primary owner) is an
-- owner. (TM-SEC-003's single-owner index is gone: several owners are allowed.)
do $$
declare n int;
begin
  n := public.backfill_company_roles();
  assert n = 0, format('backfill changed %s members on a rerun', n);
  assert not exists (
    select ci.id from public.company_info ci
     where ci.user_id is not null
       and not exists (select 1 from public.company_members m
                        where m.company_id = ci.id and m.user_id = ci.user_id and m.is_owner)
  ), 'a primary owner is not an owner';
end $$;

-- Seats: members plus open invites; expired and revoked invites don't count.
do $$
begin
  assert public.billing_limit_used('c0000000-0000-4000-8000-000000000001', 'seats') = 3,
    'seats used should be 3 members';
  insert into public.company_invites (company_id, email, role_id, token_hash, expires_at, revoked_at)
  select 'c0000000-0000-4000-8000-000000000001', v.email, (select id from ids where name = 'a_member'),
         v.hash, v.expires, v.revoked
    from (values
      ('open@x.test', 'seat-open', now() + interval '1 day', null::timestamptz),
      ('expired@x.test', 'seat-expired', now() - interval '1 day', null),
      ('revoked@x.test', 'seat-revoked', now() + interval '1 day', now())
    ) v(email, hash, expires, revoked);
  assert public.billing_limit_used('c0000000-0000-4000-8000-000000000001', 'seats') = 4,
    'seats used should be 3 members plus 1 open invite';
  delete from public.company_invites where token_hash like 'seat-%';
end $$;

-- ---------------------------------------------------------------- admin and member of A
-- Both read A's data and none of B's. (One block per user: `set local role`
-- can't run inside a do block.)
create or replace function pg_temp.check_member_reads(who uuid, is_admin boolean)
returns void language plpgsql as $$
declare seen int;
begin
  assert public.my_company_id() = 'c0000000-0000-4000-8000-000000000001', format('%s: my_company_id', who);
  assert public.is_company_member('c0000000-0000-4000-8000-000000000001'), format('%s: member of A', who);
  assert not public.is_company_member('c0000000-0000-4000-8000-000000000002'), format('%s: member of B', who);
  assert public.has_company_permission('c0000000-0000-4000-8000-000000000001', 'jobs.edit') = is_admin,
    format('%s: jobs.edit', who);

  select count(*) into seen from public.applications;
  assert seen = 1, format('%s: sees %s applications', who, seen);
  -- Every authenticated user reads every posting ("Job seekers can view job
  -- postings"), so there's no check that B's are hidden.
  select count(*) into seen from public.job_postings where company_id = 'c0000000-0000-4000-8000-000000000001';
  assert seen = 1, format('%s: does not see A''s job posting', who);
  select count(*) into seen from public.pipeline_stages where company_id = 'c0000000-0000-4000-8000-000000000001';
  assert seen > 0, format('%s: does not see A''s stages', who);
  select count(*) into seen from public.pipeline_stages where company_id = 'c0000000-0000-4000-8000-000000000002';
  assert seen = 0, format('%s: sees B''s stages', who);
  select count(*) into seen from public.company_favorites;
  assert seen = 1, format('%s: sees %s favorites', who, seen);
  assert public.company_can_view_candidate('a0000000-0000-4000-8000-000000000001'),
    format('%s: company_can_view_candidate', who);
  select count(*) into seen from public.company_members;
  assert seen = 3, format('%s: sees %s company_members rows', who, seen);

  -- Every member moves stages and writes notes.
  update public.applications set status = 'reviewed' where id = 'e0000000-0000-4000-8000-000000000001';
  get diagnostics seen = row_count;
  assert seen = 1, format('%s: could not update A''s application', who);
  insert into public.candidate_notes (company_id, candidate_user_id, application_id, author_user_id, body)
  values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
          'e0000000-0000-4000-8000-000000000001', who, 'Strong portfolio.');

  -- TM-SEC-006: no direct writes to the membership tables.
  begin
    insert into public.company_members (company_id, user_id, is_owner)
    values ('c0000000-0000-4000-8000-000000000002', who, true);
    raise exception '%: inserted into company_members', who;
  exception when insufficient_privilege then null;
  end;
  begin
    update public.company_members set is_owner = true where user_id = who;
    raise exception '%: updated company_members', who;
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.company_invites (company_id, email, token_hash)
    values ('c0000000-0000-4000-8000-000000000001', 'x@x.test', 'x');
    raise exception '%: inserted into company_invites', who;
  exception when insufficient_privilege then null;
  end;
  begin
    perform token_hash from public.company_invites;
    raise exception '%: read company_invites.token_hash', who;
  exception when insufficient_privilege then null;
  end;

  -- company_info is owner-only.
  update public.company_info set name = 'Renamed' where id = 'c0000000-0000-4000-8000-000000000001';
  get diagnostics seen = row_count;
  assert seen = 0, format('%s: updated company_info', who);
end $$;
grant execute on function pg_temp.check_member_reads(uuid, boolean) to authenticated;

select set_config('request.jwt.claims', '{"sub":"c2000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.check_member_reads('c2000000-0000-4000-8000-000000000001', true);
reset role;

select set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.check_member_reads('c3000000-0000-4000-8000-000000000001', false);
reset role;

-- ---------------------------------------------------------------- member of A: role writes
select set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare n int;
begin
  begin
    insert into public.job_postings (company_id, title) values ('c0000000-0000-4000-8000-000000000001', 'Nope');
    raise exception 'a member created a job posting';
  exception when insufficient_privilege then null;
  end;

  update public.job_postings set title = 'Edited' where id = 'b0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'a member edited a job posting';

  delete from public.job_postings where id = 'b0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'a member deleted a job posting';

  update public.all_jobs set job_name = 'Edited' where id = 'd0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'a member edited all_jobs';

  begin
    insert into public.pipeline_stages (company_id, name, kind, position)
    values ('c0000000-0000-4000-8000-000000000001', 'Take-home', 'interview', 99);
    raise exception 'a member created a stage';
  exception when insufficient_privilege then null;
  end;

  update public.pipeline_stages set name = 'Edited' where company_id = 'c0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'a member renamed a stage';

  update public.company_email_templates set name = 'Edited' where company_id = 'c0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'a member edited a template';

  assert (public.update_company_settings('{"notify_weekly_matches": false}') ->> 'ok')::boolean = false,
    'a member changed company settings';
end $$;

reset role;

-- ---------------------------------------------------------------- admin of A: role writes
select set_config('request.jwt.claims', '{"sub":"c2000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  n int;
  r jsonb;
begin
  update public.job_postings set title = 'Edited' where id = 'b0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 1, 'an admin could not edit a job posting';

  update public.all_jobs set job_name = 'Edited' where id = 'd0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 1, 'an admin could not edit all_jobs';

  insert into public.pipeline_stages (company_id, name, kind, position)
  values ('c0000000-0000-4000-8000-000000000001', 'Take-home', 'interview', 99);

  update public.company_email_templates set name = 'Edited' where company_id = 'c0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n > 0, 'an admin could not edit a template';

  -- Difference 3: only the three settings columns, for owner and admin.
  r := public.update_company_settings(
    '{"scheduling_url": "https://cal.test/acme", "notify_new_applicants": "instant", "notify_weekly_matches": false}');
  assert (r ->> 'ok')::boolean, format('an admin could not change settings: %s', r);
  r := public.update_company_settings('{"name": "Hijacked"}');
  assert r ->> 'reason' = 'invalid_input', format('update_company_settings accepted another column: %s', r);
  r := public.update_company_settings('{"scheduling_url": "http://insecure.test"}');
  assert r ->> 'reason' = 'invalid_input', format('update_company_settings accepted an http link: %s', r);
end $$;

reset role;

do $$
begin
  assert (select scheduling_url = 'https://cal.test/acme' and notify_new_applicants = 'instant'
                 and not notify_weekly_matches and name = 'Acme Inc'
            from public.company_info where id = 'c0000000-0000-4000-8000-000000000001'),
    'update_company_settings changed the wrong columns';
end $$;

-- ---------------------------------------------------------------- outreach sender_name
update public.user_info set accepts_outreach = true where user_id = 'a0000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare o public.candidate_outreach;
begin
  o := public.send_candidate_outreach(null, 'a0000000-0000-4000-8000-000000000001', null, 'Hello', 'We like your work.');
  assert o.sender_name = 'Max Member', format('sender_name: %s', o.sender_name);
end $$;

reset role;

-- ---------------------------------------------------------------- removal
-- After the row is deleted, the member sees nothing, in the same transaction.
delete from public.company_members where user_id = 'c3000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare n int;
begin
  assert public.my_company_id() is null, 'a removed member still has a company';
  select count(*) into n from public.applications;
  assert n = 0, 'a removed member still sees applications';
  select count(*) into n from public.candidate_notes;
  assert n = 0, 'a removed member still sees notes';
  select count(*) into n from public.company_favorites;
  assert n = 0, 'a removed member still sees favorites';
  select count(*) into n from public.candidate_outreach;
  assert n = 0, 'a removed member still sees outreach';
end $$;

reset role;

-- The removed member's note keeps its author (TM-REQ-007).
do $$
begin
  assert exists (
    select 1 from public.candidate_notes where author_user_id = 'c3000000-0000-4000-8000-000000000001'
  ), 'the removed member''s note was deleted';
end $$;

-- Back in for block 2.
insert into public.company_members (company_id, user_id, role_id, display_name) values
  ('c0000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', (select id from ids where name = 'a_member'), 'Max Member');

-- ---------------------------------------------------------------- applicant
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  assert public.my_company_id() is null, 'applicant: my_company_id';
  assert not public.is_company_member('c0000000-0000-4000-8000-000000000001'), 'applicant: is_company_member';
  assert not public.has_company_permission('c0000000-0000-4000-8000-000000000001', 'applicants.view'),
    'applicant: has_company_permission';
  assert not exists (select 1 from public.company_members), 'applicant sees company_members';
  assert public.list_company_team() is null, 'applicant: list_company_team';
end $$;

reset role;

-- ===================================================== block 2: team management
-- TMT-014, on the roles model's RPCs.

-- ---------------------------------------------------------------- admin of A
select set_config('request.jwt.claims', '{"sub":"c2000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare r jsonb;
begin
  r := public.set_company_member_role('c1000000-0000-4000-8000-000000000001', (select id from ids where name = 'a_member'));
  assert r ->> 'reason' = 'owner', format('an admin demoted the owner: %s', r);
  r := public.set_company_member_role('c3000000-0000-4000-8000-000000000001', (select id from ids where name = 'b_member'));
  assert r ->> 'reason' = 'invalid_role', format('an admin gave a role of company B: %s', r);
  r := public.set_company_member_role('c3000000-0000-4000-8000-000000000002', (select id from ids where name = 'a_admin'));
  assert r ->> 'reason' = 'not_found', format('an admin changed a member of B: %s', r);
  r := public.set_company_member_role('c3000000-0000-4000-8000-000000000001', (select id from ids where name = 'a_admin'));
  assert (r ->> 'ok')::boolean, format('an admin could not promote a member: %s', r);
  r := public.set_company_member_role('c3000000-0000-4000-8000-000000000001', (select id from ids where name = 'a_member'));
  assert (r ->> 'ok')::boolean, format('an admin could not demote an admin: %s', r);

  r := public.remove_company_member('c1000000-0000-4000-8000-000000000001');
  assert r ->> 'reason' = 'primary_owner', format('an admin removed the owner: %s', r);
  r := public.remove_company_member('c3000000-0000-4000-8000-000000000002');
  assert r ->> 'reason' = 'not_found', format('an admin removed a member of B: %s', r);
  r := public.set_company_owner('c2000000-0000-4000-8000-000000000001', true);
  assert r ->> 'reason' = 'forbidden', format('an admin made themselves an owner: %s', r);
  r := public.make_primary_owner('c2000000-0000-4000-8000-000000000001');
  assert r ->> 'reason' = 'forbidden', format('an admin transferred ownership: %s', r);

  r := public.list_company_team();
  assert jsonb_array_length(r -> 'members') = 3, format('list_company_team members: %s', r);
  assert (r -> 'members' -> 0 ->> 'is_primary_owner')::boolean, 'list_company_team: owner first';
  assert r -> 'members' -> 0 ->> 'email' = 'hr@acme.test', 'list_company_team: owner email';
  assert not (r::text like '%globex%'), 'list_company_team leaked company B';
end $$;

reset role;

-- ---------------------------------------------------------------- member of A
select set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare r jsonb;
begin
  r := public.set_company_member_role('c2000000-0000-4000-8000-000000000001', (select id from ids where name = 'a_member'));
  assert r ->> 'reason' = 'forbidden', format('a member changed a role: %s', r);
  r := public.remove_company_member('c2000000-0000-4000-8000-000000000001');
  assert r ->> 'reason' = 'forbidden', format('a member removed an admin: %s', r);
  r := public.set_my_display_name('');
  assert r ->> 'reason' = 'invalid_name', format('set_my_display_name accepted an empty name: %s', r);
  r := public.set_my_display_name('  Maxine  ');
  assert (r ->> 'ok')::boolean, format('set_my_display_name: %s', r);
  perform public.touch_company_membership();
end $$;

reset role;

do $$
begin
  assert (select display_name = 'Maxine' and last_active_at is not null
            from public.company_members where user_id = 'c3000000-0000-4000-8000-000000000001'),
    'set_my_display_name / touch_company_membership did not write the caller''s row';
end $$;

-- ---------------------------------------------------------------- owner of A
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare r jsonb;
begin
  r := public.remove_company_member('c1000000-0000-4000-8000-000000000001');
  assert r ->> 'reason' = 'primary_owner', format('the owner removed themselves: %s', r);
  r := public.set_company_member_role('c1000000-0000-4000-8000-000000000001', (select id from ids where name = 'a_admin'));
  assert r ->> 'reason' = 'own_role', format('the owner changed their own role: %s', r);
  r := public.set_company_owner('c3000000-0000-4000-8000-000000000002', true);
  assert r ->> 'reason' = 'not_found', format('ownership went to a member of B: %s', r);
  r := public.make_primary_owner('c2000000-0000-4000-8000-000000000001');
  assert r ->> 'reason' = 'not_owner', format('primary ownership went to a non-owner: %s', r);
  -- The transfer: make the admin an owner, then the primary owner.
  r := public.set_company_owner('c2000000-0000-4000-8000-000000000001', true);
  assert (r ->> 'ok')::boolean, format('set_company_owner: %s', r);
  r := public.make_primary_owner('c2000000-0000-4000-8000-000000000001');
  assert (r ->> 'ok')::boolean, format('make_primary_owner: %s', r);
end $$;

reset role;

do $$
begin
  assert (select user_id = 'c2000000-0000-4000-8000-000000000001'
            from public.company_info where id = 'c0000000-0000-4000-8000-000000000001'),
    'company_info.user_id did not follow the new primary owner';
  assert (select is_owner from public.company_members where user_id = 'c1000000-0000-4000-8000-000000000001'),
    'the old primary owner is no longer an owner';
  assert (select is_owner and role_id is null
            from public.company_members where user_id = 'c2000000-0000-4000-8000-000000000001'),
    'the new primary owner is not an owner';
end $$;

-- A member leaves; then put things back for block 3.
select set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare r jsonb;
begin
  r := public.remove_company_member('c3000000-0000-4000-8000-000000000001');
  assert (r ->> 'ok')::boolean, format('a member could not leave: %s', r);
end $$;

reset role;

update public.company_info set user_id = 'c1000000-0000-4000-8000-000000000001'
 where id = 'c0000000-0000-4000-8000-000000000001';
update public.company_members set is_owner = false, role_id = (select id from ids where name = 'a_admin')
 where user_id = 'c2000000-0000-4000-8000-000000000001';

-- ===================================================== block 3: invites
-- TMT-030. A has owner + admin; give the free plan 4 seats for this block.
update public.tier_entitlements set amount = 4
 where key = 'seats' and tier_id = public.billing_free_tier_id();

create temporary table invite_tokens (name text primary key, token text);
grant all on invite_tokens to authenticated;

-- ---------------------------------------------------------------- admin of A
select set_config('request.jwt.claims', '{"sub":"c2000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare r jsonb;
begin
  r := public.create_company_invite('invitee@gmail.test', (select id from ids where name = 'b_member'));
  assert r ->> 'reason' = 'invalid_role', format('invited with a role of company B: %s', r);
  r := public.create_company_invite('not-an-email', (select id from ids where name = 'a_member'));
  assert r ->> 'reason' = 'invalid_email', format('invalid email accepted: %s', r);
  r := public.create_company_invite('HR@acme.test', (select id from ids where name = 'a_member'));
  assert r ->> 'reason' = 'already_member', format('invited an existing member: %s', r);

  r := public.create_company_invite('  INVITEE@gmail.test ', (select id from ids where name = 'a_member'));
  assert (r ->> 'ok')::boolean and char_length(r ->> 'token') >= 40, format('create_company_invite: %s', r);
  insert into invite_tokens values ('invitee', r ->> 'token');

  r := public.create_company_invite('invitee@GMAIL.test', (select id from ids where name = 'a_admin'));
  assert r ->> 'reason' = 'already_invited', format('second open invite to the same email: %s', r);

  r := public.create_company_invite('unconfirmed@gmail.test', (select id from ids where name = 'a_member'));
  assert (r ->> 'ok')::boolean, format('create_company_invite (unconfirmed): %s', r);
  insert into invite_tokens values ('unconfirmed', r ->> 'token');

  -- 2 members + 2 open invites = 4 seats: full.
  r := public.create_company_invite('one-more@gmail.test', (select id from ids where name = 'a_member'));
  assert r ->> 'reason' = 'seat_limit', format('invited past the seat limit: %s', r);
end $$;

reset role;

-- Only the hash is stored.
do $$
begin
  assert (select i.token_hash = public.team_invite_hash(t.token)
            from public.company_invites i, invite_tokens t
           where t.name = 'invitee' and i.email = 'invitee@gmail.test'),
    'the stored hash is not sha256(token)';
  assert not exists (
    select 1 from public.company_invites i join invite_tokens t on i.token_hash = t.token
  ), 'a raw token was stored';
end $$;

-- ---------------------------------------------------------------- member of B
select set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

do $$
declare r jsonb;
begin
  r := public.create_company_invite('someone@gmail.test');
  assert r ->> 'reason' = 'forbidden', format('a member created an invite: %s', r);
  assert not exists (select 1 from public.company_invites where company_id = 'c0000000-0000-4000-8000-000000000001'),
    'a member of B sees A''s invites';
end $$;

reset role;

do $$
declare
  v_invite uuid := (select id from public.company_invites where email = 'invitee@gmail.test');
  r jsonb;
begin
  perform set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  r := public.revoke_company_invite(v_invite);
  assert r ->> 'reason' = 'forbidden', format('a member of B revoked A''s invite: %s', r);
end $$;

-- ---------------------------------------------------------------- acceptance failures
-- Wrong email.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare r jsonb;
begin
  r := public.accept_company_invite((select token from invite_tokens where name = 'invitee'));
  assert r ->> 'reason' = 'wrong_email', format('accepted with a different email: %s', r);
  r := public.accept_company_invite('x' || repeat('a', 42));
  assert r ->> 'reason' = 'invalid', format('accepted an unknown token: %s', r);
end $$;

reset role;

-- Unconfirmed email.
select set_config('request.jwt.claims', '{"sub":"c4000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

do $$
declare r jsonb;
begin
  r := public.accept_company_invite((select token from invite_tokens where name = 'unconfirmed'));
  assert r ->> 'reason' = 'unconfirmed', format('accepted with an unconfirmed email: %s', r);
end $$;

reset role;

-- An applicant with the invited email (TM-REQ-003).
insert into public.user_info (user_id, email, full_name) values
  ('c4000000-0000-4000-8000-000000000001', 'invitee@gmail.test', 'Invitee');

select set_config('request.jwt.claims', '{"sub":"c4000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare r jsonb;
begin
  r := public.accept_company_invite((select token from invite_tokens where name = 'invitee'));
  assert r ->> 'reason' = 'applicant', format('an applicant accepted: %s', r);
end $$;

reset role;
delete from public.user_info where user_id = 'c4000000-0000-4000-8000-000000000001';

-- Over the seat limit at acceptance (a downgrade after the invite).
update public.tier_entitlements set amount = 2
 where key = 'seats' and tier_id = public.billing_free_tier_id();

select set_config('request.jwt.claims', '{"sub":"c4000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare r jsonb;
begin
  r := public.accept_company_invite((select token from invite_tokens where name = 'invitee'));
  assert r ->> 'reason' = 'seat_limit', format('accepted over the seat limit: %s', r);
end $$;

reset role;

update public.tier_entitlements set amount = 4
 where key = 'seats' and tier_id = public.billing_free_tier_id();

-- ---------------------------------------------------------------- acceptance
select set_config('request.jwt.claims', '{"sub":"c4000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare r jsonb;
begin
  r := public.accept_company_invite((select token from invite_tokens where name = 'invitee'), '  Ivy Invitee ');
  assert (r ->> 'ok')::boolean and r -> 'role' ->> 'name' = 'Member', format('accept_company_invite: %s', r);
  assert public.my_company_id() = 'c0000000-0000-4000-8000-000000000001', 'the invitee is not in company A';

  r := public.accept_company_invite((select token from invite_tokens where name = 'invitee'));
  assert r ->> 'reason' = 'used', format('an invite was reused: %s', r);
end $$;

reset role;

do $$
begin
  assert (select display_name = 'Ivy Invitee' and role_id = (select id from ids where name = 'a_member')
            from public.company_members where user_id = 'c4000000-0000-4000-8000-000000000001'),
    'the membership has the wrong name or role';
end $$;

-- Revoked.
select set_config('request.jwt.claims', '{"sub":"c2000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare r jsonb;
begin
  r := public.revoke_company_invite((select id from public.company_invites where email = 'unconfirmed@gmail.test'));
  assert (r ->> 'ok')::boolean, format('revoke_company_invite: %s', r);
end $$;

reset role;

update auth.users set email_confirmed_at = now() where id = 'c4000000-0000-4000-8000-000000000002';

select set_config('request.jwt.claims', '{"sub":"c4000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

do $$
declare r jsonb;
begin
  r := public.accept_company_invite((select token from invite_tokens where name = 'unconfirmed'));
  assert r ->> 'reason' = 'revoked', format('accepted a revoked invite: %s', r);
end $$;

reset role;

-- Expired: invite again, then age it.
select set_config('request.jwt.claims', '{"sub":"c2000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare r jsonb;
begin
  r := public.create_company_invite('unconfirmed@gmail.test', (select id from ids where name = 'a_admin'));
  assert (r ->> 'ok')::boolean, format('re-invite after revoke: %s', r);
  update invite_tokens set token = r ->> 'token' where name = 'unconfirmed';
end $$;

reset role;

update public.company_invites set expires_at = now() - interval '1 minute'
 where email = 'unconfirmed@gmail.test' and revoked_at is null;

select set_config('request.jwt.claims', '{"sub":"c4000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

do $$
declare r jsonb;
begin
  r := public.accept_company_invite((select token from invite_tokens where name = 'unconfirmed'));
  assert r ->> 'reason' = 'expired', format('accepted an expired invite: %s', r);
end $$;

reset role;

-- A member of another company can't accept (one company per account). The
-- expired invite above freed its seat.
select set_config('request.jwt.claims', '{"sub":"c2000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare r jsonb;
begin
  r := public.create_company_invite('member@globex.test');
  assert (r ->> 'ok')::boolean, format('invite a member of B: %s', r);
  insert into invite_tokens values ('globex', r ->> 'token');
end $$;

reset role;

select set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

do $$
declare r jsonb;
begin
  r := public.accept_company_invite((select token from invite_tokens where name = 'globex'));
  assert r ->> 'reason' = 'already_member', format('a member of B joined A: %s', r);
end $$;

reset role;

select 'recruiter_teams: ok' as result;

rollback;
