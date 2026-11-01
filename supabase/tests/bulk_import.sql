-- Bulk candidate import (plan/bulk-import/feature-bulk-import-tasks.md):
-- block 1 (BIT-010) schema and access, block 2 (BIT-012) the RPCs, blocks 3
-- and 4 resume imports, block 5 claims, merges and deletes. Runs in a
-- transaction that always rolls back, so it's safe against the linked project
-- once the migration is applied:
--   npx supabase db query --linked -f supabase/tests/bulk_import.sql
-- Any failed check raises an exception; success prints 'bulk_import: ok'.
-- Ids match test/utils/recruiter.ts and test/utils/team.ts where they overlap.

begin;

create function pg_temp.act(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true)
$$;
create function pg_temp.role_of(p_company uuid, p_template text) returns uuid language sql as $$
  select id from public.company_roles where company_id = p_company and template_key = p_template
$$;
-- Checks a { ok, reason } result: ok when p_reason is null, else that reason.
create function pg_temp.expect(p_res jsonb, p_reason text, p_label text) returns jsonb language plpgsql as $$
begin
  if p_reason is null and not coalesce((p_res ->> 'ok')::boolean, false) then
    raise exception '%: expected ok, got %', p_label, p_res;
  end if;
  if p_reason is not null and p_res ->> 'reason' is distinct from p_reason then
    raise exception '%: expected %, got %', p_label, p_reason, p_res;
  end if;
  return p_res;
end $$;
-- A fresh draft batch for the current user.
create function pg_temp.batch() returns uuid language plpgsql as $$
begin
  return (pg_temp.expect(public.start_candidate_import('spreadsheet', 'people.csv'), null, 'start') ->> 'batch_id')::uuid;
end $$;
create function pg_temp.fk_action(p_table regclass, p_column text) returns "char" language sql as $$
  select c.confdeltype from pg_constraint c
   where c.conrelid = p_table and c.contype = 'f'
     and c.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = p_table and a.attname = p_column)]
$$;
create function pg_temp.emails_queued() returns int language sql security definer as $$
  select count(*)::int from pgmq.q_pipeline_email_queue
$$;

grant execute on function pg_temp.act(uuid), pg_temp.expect(jsonb, text, text), pg_temp.batch(),
  pg_temp.emails_queued() to authenticated;

-- Seed. Company A: owner, Admin, Member (applicants.import on A2 only, through
-- its assignment), a Viewer role (applicants.view on all jobs, no talent.view,
-- no applicants.import) and a Scoped role (applicants.view + applicants.import
-- on A2 only, no talent.view). Company B: owner. Applicants 1–4.
-- Applicant 1 applied to A1, applicant 2 applied to B1 only, applicant 3 said
-- "interested" to A's outreach, applicant 4 is private and never applied.
insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data) values
  ('c1000000-0000-4000-8000-000000000001', 'hr@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c1000000-0000-4000-8000-000000000002', 'hr@globex.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c2000000-0000-4000-8000-000000000001', 'admin@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c3000000-0000-4000-8000-000000000001', 'member@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c4000000-0000-4000-8000-000000000001', 'viewer@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c5000000-0000-4000-8000-000000000001', 'scoped@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('a0000000-0000-4000-8000-000000000001', 'One@Applicant.test', 'authenticated', 'authenticated', now(), '{}'),
  ('a0000000-0000-4000-8000-000000000002', 'two@applicant.test', 'authenticated', 'authenticated', now(), '{}'),
  ('a0000000-0000-4000-8000-000000000003', 'three@applicant.test', 'authenticated', 'authenticated', now(), '{}'),
  ('a0000000-0000-4000-8000-000000000004', 'four@applicant.test', 'authenticated', 'authenticated', now(), '{}');

insert into public.company_info (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Acme', 'hr@acme.test'),
  ('c0000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'Globex', 'hr@globex.test');

insert into public.user_info (user_id, email, full_name, is_public, filled)
select u.id, lower(u.email), split_part(lower(u.email), '@', 1), u.email <> 'four@applicant.test', true
  from auth.users u where lower(u.email) like '%@applicant.test';

insert into public.all_jobs (id, job_name, job_url, company_name, platform) values
  ('d0000000-0000-4000-8000-000000000001', 'A1', 'https://acme.test/jobs/1', 'Acme', 'gethired'),
  ('d0000000-0000-4000-8000-000000000002', 'B1', 'https://globex.test/jobs/1', 'Globex', 'gethired'),
  ('d0000000-0000-4000-8000-000000000003', 'A2', 'https://acme.test/jobs/2', 'Acme', 'gethired');

insert into public.job_postings (id, company_id, title, job_id, status) values
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'A1', 'd0000000-0000-4000-8000-000000000001', 'active'),
  ('b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'B1', 'd0000000-0000-4000-8000-000000000002', 'active'),
  ('b0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'A2', 'd0000000-0000-4000-8000-000000000003', 'active');

do $$
declare
  a uuid := 'c0000000-0000-4000-8000-000000000001';
  v_viewer uuid;
  v_scoped uuid;
begin
  insert into public.company_roles (company_id, name) values (a, 'Viewer') returning id into v_viewer;
  insert into public.company_role_permissions (role_id, permission_key, scope) values
    (v_viewer, 'jobs.view', 'all'), (v_viewer, 'applicants.view', 'all');
  insert into public.company_roles (company_id, name) values (a, 'Scoped') returning id into v_scoped;
  insert into public.company_role_permissions (role_id, permission_key, scope) values
    (v_scoped, 'jobs.view', 'assigned'), (v_scoped, 'applicants.view', 'assigned'),
    (v_scoped, 'applicants.import', 'assigned');

  insert into public.company_members (company_id, user_id, role_id, display_name) values
    (a, 'c2000000-0000-4000-8000-000000000001', pg_temp.role_of(a, 'admin'), 'Ada Admin'),
    (a, 'c3000000-0000-4000-8000-000000000001', pg_temp.role_of(a, 'member'), 'Max Member'),
    (a, 'c4000000-0000-4000-8000-000000000001', v_viewer, 'Vic Viewer'),
    (a, 'c5000000-0000-4000-8000-000000000001', v_scoped, 'Sam Scoped');
  insert into public.company_job_assignments (company_id, job_post_id, user_id) values
    (a, 'b0000000-0000-4000-8000-000000000003', 'c3000000-0000-4000-8000-000000000001'),
    (a, 'b0000000-0000-4000-8000-000000000003', 'c5000000-0000-4000-8000-000000000001')
  on conflict do nothing;
end $$;

insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002');

insert into public.candidate_outreach (company_id, candidate_user_id, sender_user_id, subject, message, status, expires_at)
values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003',
        'c1000000-0000-4000-8000-000000000001', 'Hi', 'Come work with us', 'interested', now() + interval '7 days');

insert into public.talent_lists (id, company_id, name, slug) values
  ('70000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Shortlist', 'shortlist'),
  ('70000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'Globex list', 'globex-list');
insert into public.talent_list_members (list_id, candidate_user_id) values
  ('70000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001');

-- Candidates seeded as the service role: Ana (A, in A1), Ben (A, no job, no
-- email), Cid (A, in A2), Gus (B).
insert into public.company_candidates (id, company_id, full_name, email, current_title, tags) values
  ('cc000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Ana', 'ana@mail.test', 'Engineer', '{referral}'),
  ('cc000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'Ben', null, null, '{}'),
  ('cc000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'Cid', 'cid@mail.test', null, '{}'),
  ('cc000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000002', 'Gus', 'gus@mail.test', null, '{}');
insert into public.applications (id, job_post_id, all_jobs_id, source, company_candidate_id) values
  ('ea000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'imported', 'cc000000-0000-4000-8000-000000000001'),
  ('ea000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003', 'imported', 'cc000000-0000-4000-8000-000000000003');

-- ================================================ block 1: schema and access
-- BIT-010.

do $$
declare
  a uuid := 'c0000000-0000-4000-8000-000000000001';
  t text;
begin
  -- The tables and their checks (spec §2).
  foreach t in array array['company_candidates', 'candidate_import_batches', 'candidate_import_rows', 'candidate_import_mappings'] loop
    assert to_regclass('public.' || t) is not null, t || ' is missing';
    assert (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), t || ' has no RLS';
    assert not has_table_privilege('authenticated', 'public.' || t, 'insert'), t || ': authenticated can insert';
    assert not has_table_privilege('authenticated', 'public.' || t, 'update'), t || ': authenticated can update';
    assert not has_table_privilege('authenticated', 'public.' || t, 'delete'), t || ': authenticated can delete';
    assert not has_table_privilege('anon', 'public.' || t, 'select'), t || ': anon can read';
  end loop;

  begin
    insert into public.company_candidates (company_id, full_name) values (a, '');
    raise exception 'an empty name was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.company_candidates (company_id, full_name, experience_years) values (a, 'X', 61);
    raise exception '61 years of experience was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.company_candidates (company_id, full_name, email) values (a, 'X', 'Upper@Mail.test');
    raise exception 'an email that isn''t lower-cased was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.company_candidates (company_id, full_name, tags)
    values (a, 'X', (select array_agg('t' || g) from generate_series(1, 21) g));
    raise exception '21 tags were accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.candidate_import_batches (company_id, kind) values (a, 'zip');
    raise exception 'an unknown batch kind was accepted';
  exception when check_violation then null;
  end;

  -- The email key is case-insensitive and ignores null emails.
  begin
    insert into public.company_candidates (company_id, full_name, email) values (a, 'Ana again', 'ana@mail.test');
    raise exception 'a duplicate email was accepted';
  exception when unique_violation then null;
  end;
  insert into public.company_candidates (company_id, full_name) values (a, 'No email 1'), (a, 'No email 2');
  -- The same email in another company is fine.
  insert into public.company_candidates (company_id, full_name, email)
  values ('c0000000-0000-4000-8000-000000000002', 'Ana at B', 'ana@mail.test');

  -- applications: the columns, keys and checks (BI-DEC-002).
  assert pg_temp.fk_action('public.applications', 'company_candidate_id') = 'c', 'candidate fk doesn''t cascade';
  assert pg_temp.fk_action('public.applications', 'merged_into_application_id') = 'n', 'merged fk isn''t set null';
  -- BI-REQ-003: "candidates" is a tab, not a list slug.
  begin
    insert into public.talent_lists (company_id, name, slug)
    values ('c0000000-0000-4000-8000-000000000001', 'Candidates', 'candidates');
    raise exception 'a list took the candidates slug';
  exception when check_violation then null;
  end;
  assert pg_temp.fk_action('public.applications', 'import_batch_id') = 'n', 'batch fk isn''t set null';
  begin
    insert into public.applications (job_post_id, all_jobs_id, source)
    values ('b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'imported');
    raise exception 'an imported application without a candidate was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.applications (job_post_id, all_jobs_id, source, company_candidate_id) values
      ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'imported', 'cc000000-0000-4000-8000-000000000001');
    raise exception 'a second application for the same candidate and job was accepted';
  exception when unique_violation then null;
  end;

  -- Statuses, event types, audit actions.
  begin
    insert into public.application_screenings (application_id, job_post_id, company_id, status)
    values ('ea000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000003', a, 'insufficient_info')
    on conflict (application_id) do update set status = 'insufficient_info';
  end;
  insert into public.application_events (company_id, application_id, type) values
    (a, 'ea000000-0000-4000-8000-000000000001', 'imported'),
    (a, 'ea000000-0000-4000-8000-000000000001', 'claimed'),
    (a, 'ea000000-0000-4000-8000-000000000001', 'merged');
  perform public.write_company_audit(a, 'candidates.imported', 'import_batch', null, null, null, '{}', 'system', null);
  perform public.write_company_audit(a, 'candidates.deleted', 'candidates', null, null, null, '{}', 'system', null);

  -- talent_list_members (BI-DEC-003): existing rows kept, exactly one id, no duplicates.
  assert exists (select 1 from public.talent_list_members
                  where candidate_user_id = 'a0000000-0000-4000-8000-000000000001' and id is not null),
    'the existing list member was lost';
  insert into public.talent_list_members (list_id, company_candidate_id)
  values ('70000000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000001');
  begin
    insert into public.talent_list_members (list_id, company_candidate_id)
    values ('70000000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000001');
    raise exception 'a company candidate was listed twice';
  exception when unique_violation then null;
  end;
  begin
    insert into public.talent_list_members (list_id, candidate_user_id)
    values ('70000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001');
    raise exception 'a user was listed twice';
  exception when unique_violation then null;
  end;
  begin
    insert into public.talent_list_members (list_id, candidate_user_id, company_candidate_id)
    values ('70000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 'cc000000-0000-4000-8000-000000000003');
    raise exception 'a member with both ids was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.talent_list_members (list_id) values ('70000000-0000-4000-8000-000000000001');
    raise exception 'a member with neither id was accepted';
  exception when check_violation then null;
  end;

  -- The catalog and the templates (BIT-003).
  assert exists (select 1 from public.company_permissions
                  where key = 'applicants.import' and scopable and requires = '{applicants.view}'),
    'applicants.import missing or wrong';
  assert not exists (
    select 1 from public.company_roles r where r.template_key = 'admin'
       and not exists (select 1 from public.company_role_permissions p
                        where p.role_id = r.id and p.permission_key = 'applicants.import' and p.scope = 'all')
  ), 'an Admin role lacks applicants.import';
  assert not exists (
    select 1 from public.company_roles r where r.template_key = 'member'
       and not exists (select 1 from public.company_role_permissions p
                        where p.role_id = r.id and p.permission_key = 'applicants.import' and p.scope = 'assigned')
  ), 'a Member role lacks applicants.import for assigned jobs';

  -- tier_entitlements (BI-DEC-008).
  assert (select e.amount from public.tier_entitlements e join public.company_tiers t on t.id = e.tier_id
           where t.slug = 'free' and e.key = 'resume_imports') = 25, 'Free resume_imports isn''t 25';
  assert (select e.amount from public.tier_entitlements e join public.company_tiers t on t.id = e.tier_id
           where t.slug = 'startup' and e.key = 'resume_imports') = 500, 'Startup resume_imports isn''t 500';
  perform public.billing_assert_key('resume_imports');

  -- Deleting a candidate deletes its applications.
  insert into public.company_candidates (id, company_id, full_name, email)
  values ('cc000000-0000-4000-8000-0000000000dd', a, 'Del', 'del@mail.test');
  insert into public.applications (id, job_post_id, all_jobs_id, source, company_candidate_id) values
    ('ea000000-0000-4000-8000-0000000000dd', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'imported', 'cc000000-0000-4000-8000-0000000000dd');
  delete from public.company_candidates where id = 'cc000000-0000-4000-8000-0000000000dd';
  assert not exists (select 1 from public.applications where id = 'ea000000-0000-4000-8000-0000000000dd'),
    'the application outlived its candidate';
end $$;

-- RLS, as each user.
set local role authenticated;

-- Owner of A: A's candidates only.
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
begin
  assert (select count(*) from public.company_candidates where id = 'cc000000-0000-4000-8000-000000000009') = 0,
    'A sees B''s candidate';
  assert (select count(*) from public.company_candidates where id = 'cc000000-0000-4000-8000-000000000001') = 1,
    'A''s owner can''t see A''s candidate';
  -- Can't point an application at another candidate from the browser.
  begin
    update public.applications set company_candidate_id = 'cc000000-0000-4000-8000-000000000002'
     where id = 'ea000000-0000-4000-8000-000000000001';
    raise exception 'a browser update changed the candidate';
  exception when insufficient_privilege then null;
  end;
  -- A note on an imported application has no candidate user (BI-REQ-030)...
  insert into public.candidate_notes (company_id, candidate_user_id, application_id, author_user_id, body)
  values ('c0000000-0000-4000-8000-000000000001', null, 'ea000000-0000-4000-8000-000000000001',
          'c1000000-0000-4000-8000-000000000001', 'Strong portfolio');
  -- ...but a talent-pool note still needs one.
  begin
    insert into public.candidate_notes (company_id, candidate_user_id, application_id, author_user_id, body)
    values ('c0000000-0000-4000-8000-000000000001', null, null, 'c1000000-0000-4000-8000-000000000001', 'x');
    raise exception 'a note with no subject was saved';
  -- RLS refuses it before the check constraint runs; either is a refusal.
  exception when check_violation or insufficient_privilege then null;
  end;
end $$;

-- The funnel counts imports by source and leaves merged ones out (BI-REQ-030/042).
do $$
begin
  assert public.get_job_funnel('b0000000-0000-4000-8000-000000000001') -> 'sources'
           = '{"applied": 1, "imported": 1}'::jsonb,
    format('funnel sources: %s', public.get_job_funnel('b0000000-0000-4000-8000-000000000001') -> 'sources');
end $$;
reset role;
update public.applications set merged_into_application_id = 'e0000000-0000-4000-8000-000000000001'
 where id = 'ea000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
begin
  assert (public.get_job_funnel('b0000000-0000-4000-8000-000000000001') ->> 'total')::int = 1,
    'the funnel counts a merged import';
end $$;
reset role;
update public.applications set merged_into_application_id = null
 where id = 'ea000000-0000-4000-8000-000000000001';
set local role authenticated;

-- Viewer (applicants.view on all jobs, no talent.view): only candidates in a job.
select pg_temp.act('c4000000-0000-4000-8000-000000000001');
do $$
begin
  assert (select count(*) from public.company_candidates where id in (
    'cc000000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000003')) = 2,
    'the viewer can''t see candidates in their jobs';
  assert (select count(*) from public.company_candidates where id = 'cc000000-0000-4000-8000-000000000002') = 0,
    'the viewer sees a candidate who isn''t in a job';
end $$;

-- Scoped (applicants.view on A2 only): Cid only.
select pg_temp.act('c5000000-0000-4000-8000-000000000001');
do $$
begin
  assert (select array_agg(full_name order by full_name) from public.company_candidates) = array['Cid'],
    format('the scoped member sees %s', (select array_agg(full_name) from public.company_candidates));
end $$;

-- An applicant sees no candidate and none of the imported applications (BI-CON-001).
select pg_temp.act('a0000000-0000-4000-8000-000000000001');
do $$
begin
  assert (select count(*) from public.company_candidates) = 0, 'an applicant sees company candidates';
  assert (select count(*) from public.candidate_import_batches) = 0, 'an applicant sees import batches';
  assert (select count(*) from public.applications where source = 'imported') = 0, 'an applicant sees imported applications';
  assert (select count(*) from public.applications where applicant_user_id = (select auth.uid())) = 1,
    'the applicant''s own application is missing';
end $$;

select pg_temp.act(null);
reset role;
set local role anon;
do $$
begin
  perform 1 from public.company_candidates;
  raise exception 'anon read company_candidates';
exception when insufficient_privilege then null;
end $$;
reset role;

-- ================================================ block 2: the RPCs
-- BIT-012.

set local role authenticated;

-- match_known_applicants (BI-REQ-019).
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare
  v_found text[];
begin
  select array_agg(email order by email) into v_found
    from public.match_known_applicants(array['ONE@applicant.test', 'two@applicant.test', 'three@applicant.test',
                                             'four@applicant.test', 'nobody@x.test']);
  -- 1 applied to A1, 3 is interested; 2 applied only to B; 4 never applied.
  assert v_found = array['one@applicant.test', 'three@applicant.test'], format('owner matched %s', v_found);

  begin
    perform public.match_known_applicants((select array_agg('x' || g || '@x.test') from generate_series(1, 5001) g));
    raise exception 'more than 5,000 emails were accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- A scoped member never matches someone who only applied outside their jobs.
select pg_temp.act('c5000000-0000-4000-8000-000000000001');
do $$
begin
  assert not exists (select 1 from public.match_known_applicants(array['one@applicant.test'])),
    'the scoped member matched an applicant to a job outside their scope';
end $$;

reset role;
set local role anon;
do $$
begin
  perform public.match_known_applicants(array['one@applicant.test']);
  raise exception 'anon called match_known_applicants';
exception when insufficient_privilege then null;
end $$;
reset role;

set local role authenticated;

-- confirm_candidate_import: permissions and refusals.
select pg_temp.act('c4000000-0000-4000-8000-000000000001');
do $$
begin
  perform pg_temp.expect(public.start_candidate_import('spreadsheet', 'x.csv'), 'forbidden', 'viewer start');
end $$;

select pg_temp.act('c5000000-0000-4000-8000-000000000001');
do $$
declare
  v_batch uuid := pg_temp.batch();
  v_rows jsonb := '[{"full_name": "Zed", "email": "zed@mail.test"}]';
begin
  -- Scoped to A2: no job (unscoped) and A1 are refused, A2 works.
  perform pg_temp.expect(public.confirm_candidate_import(v_batch, v_rows, '{"attested": true}'), 'forbidden', 'scoped, no job');
  perform pg_temp.expect(public.confirm_candidate_import(v_batch, v_rows,
    '{"attested": true, "job_post_id": "b0000000-0000-4000-8000-000000000001"}'), 'forbidden', 'scoped, A1');
  perform pg_temp.expect(public.confirm_candidate_import(v_batch, v_rows,
    '{"job_post_id": "b0000000-0000-4000-8000-000000000003"}'), 'not_attested', 'scoped, no attestation');
  perform pg_temp.expect(public.confirm_candidate_import(v_batch, v_rows,
    '{"attested": true, "job_post_id": "b0000000-0000-4000-8000-000000000003"}'), null, 'scoped, A2');
  perform pg_temp.expect(public.confirm_candidate_import(v_batch, v_rows,
    '{"attested": true, "job_post_id": "b0000000-0000-4000-8000-000000000003"}'), 'already_confirmed', 'second confirm');
end $$;

-- Another company's batch is not found.
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$
declare
  v_batch uuid := (select id from public.candidate_import_batches limit 1);
begin
  assert v_batch is null, 'B can see A''s batches';
end $$;
reset role;
do $$
declare
  v_batch uuid;
begin
  insert into public.candidate_import_batches (company_id, kind, created_by)
  values ('c0000000-0000-4000-8000-000000000001', 'spreadsheet', 'c1000000-0000-4000-8000-000000000001')
  returning id into v_batch;
  perform set_config('bulk_import.a_batch', v_batch::text, true);
end $$;
set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$
begin
  perform pg_temp.expect(public.confirm_candidate_import(current_setting('bulk_import.a_batch')::uuid,
    '[{"full_name": "X"}]', '{"attested": true}'), 'not_found', 'B confirms A''s batch');
end $$;

-- The owner: a full import into A1 at a mapped stage, plus a list.
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare
  a uuid := 'c0000000-0000-4000-8000-000000000001';
  a1 uuid := 'b0000000-0000-4000-8000-000000000001';
  v_batch uuid := pg_temp.batch();
  v_interview uuid := (select id from public.pipeline_stages where company_id = a and kind = 'interview' and not archived order by position limit 1);
  v_applied uuid := (select id from public.pipeline_stages where company_id = a and kind = 'applied' and not archived order by position limit 1);
  v_emails_before int := pg_temp.emails_queued();
  v_screenings_before int := (select count(*) from public.application_screenings);
  v_res jsonb;
  v_counts jsonb;
  v_app public.applications%rowtype;
begin
  v_res := pg_temp.expect(public.confirm_candidate_import(v_batch, jsonb_build_array(
    -- New, mapped to Interview by a differently-cased value.
    jsonb_build_object('full_name', 'Dee', 'email', 'Dee@Mail.test', 'stage', 'onsite', 'skills', jsonb_build_array('Go', 'go', 'Rust')),
    -- New, unmapped stage value → the destination stage.
    jsonb_build_object('full_name', 'Eve', 'email', 'eve@mail.test', 'stage', 'Unknown'),
    -- No email: a candidate, but not added to the job.
    jsonb_build_object('full_name', 'Fay'),
    -- Existing (Ana, already in A1), fill: only blanks, tags merged.
    jsonb_build_object('full_name', 'Ana Other', 'email', 'ANA@mail.test', 'current_title', 'CTO',
                       'location', 'Pune', 'tags', jsonb_build_array('Referral', 'senior'), 'duplicate_action', 'fill'),
    -- Existing (Cid), overwrite.
    jsonb_build_object('full_name', 'Cid Two', 'email', 'cid@mail.test', 'current_title', 'Lead', 'duplicate_action', 'overwrite'),
    -- A known user who applied to A1: already in job, no candidate.
    jsonb_build_object('full_name', 'One', 'email', 'one@applicant.test'),
    -- A known user (interested outreach) who didn't apply: needs outreach, listed.
    -- (Ana and One are already on the list, so 6 are added to it.)
    jsonb_build_object('full_name', 'Three', 'email', 'three@applicant.test'),
    -- A private user who never applied: not known, so a plain candidate (BI-SEC-002).
    jsonb_build_object('full_name', 'Four', 'email', 'four@applicant.test')
  ), jsonb_build_object(
    'attested', true, 'lawful_basis_note', 'referral', 'job_post_id', a1, 'stage_id', v_applied,
    'talent_list_id', '70000000-0000-4000-8000-000000000001',
    'stage_map', jsonb_build_object('Onsite', v_interview), 'duplicate_action', 'skip'
  )), null, 'owner import');
  v_counts := v_res -> 'counts';
  assert v_counts = jsonb_build_object(
    'created', 4, 'updated', 2, 'skipped', 0, 'known', 2, 'added_to_job', 4, 'already_in_job', 2,
    'needs_outreach', 1, 'no_email', 1, 'added_to_list', 6
  ), format('wrong counts: %s', v_counts);

  -- Known users never become candidates.
  assert not exists (select 1 from public.company_candidates where email in ('one@applicant.test', 'three@applicant.test')),
    'a known user became a company candidate';
  assert exists (select 1 from public.talent_list_members where list_id = '70000000-0000-4000-8000-000000000001'
                  and candidate_user_id = 'a0000000-0000-4000-8000-000000000003'), 'the known user wasn''t listed';

  -- Fill and overwrite.
  assert (select row(full_name, current_title, location, tags) from public.company_candidates
           where id = 'cc000000-0000-4000-8000-000000000001')
       = row('Ana'::text, 'Engineer'::text, 'Pune'::text, array['referral', 'senior']::text[]),
    format('fill went wrong: %s', (select to_jsonb(c) from public.company_candidates c where id = 'cc000000-0000-4000-8000-000000000001'));
  assert (select row(full_name, current_title) from public.company_candidates where id = 'cc000000-0000-4000-8000-000000000003')
       = row('Cid Two'::text, 'Lead'::text), 'overwrite went wrong';
  assert (select skills from public.company_candidates where email = 'dee@mail.test') = array['Go', 'Rust'],
    'skills weren''t deduplicated';

  -- The applications.
  select * into v_app from public.applications a
   join public.company_candidates c on c.id = a.company_candidate_id
   where c.email = 'dee@mail.test';
  assert v_app.source = 'imported' and v_app.applicant_user_id is null and v_app.stage_id = v_interview
     and v_app.all_jobs_id = 'd0000000-0000-4000-8000-000000000001' and v_app.import_batch_id = v_batch
     and v_app.stage_entered_at is not null, format('Dee''s application is wrong: %s', to_jsonb(v_app));
  assert (select a.stage_id from public.applications a join public.company_candidates c on c.id = a.company_candidate_id
           where c.email = 'eve@mail.test') = v_applied, 'Eve isn''t in the destination stage';
  assert not exists (select 1 from public.applications a join public.company_candidates c on c.id = a.company_candidate_id
                      where c.full_name = 'Fay'), 'a candidate without an email was added to the job';
  assert (select count(*) from public.application_events e join public.applications a on a.id = e.application_id
           where a.import_batch_id = v_batch and e.type = 'imported') = 4, 'missing imported events';
  assert not exists (select 1 from public.application_events e join public.applications a on a.id = e.application_id
                      where a.import_batch_id = v_batch and e.type = 'applied'), 'an import logged an applied event';

  -- One audit row, with counts and no names or emails.
  assert (select count(*) from public.company_audit_log
           where action = 'candidates.imported' and target_id = v_batch::text) = 1, 'missing audit row';
  assert not exists (select 1 from public.company_audit_log
                      where action = 'candidates.imported' and target_id = v_batch::text
                        and (after::text ilike '%dee%' or after::text ilike '%@%')), 'the audit row has names or emails';

  -- The batch, the screenings and no email (BI-REQ-015c).
  assert (select status = 'confirmed' and lawful_basis_attested_at is not null and lawful_basis_note = 'referral'
            and stage_map is not null and job_post_id = a1 from public.candidate_import_batches where id = v_batch),
    'the batch wasn''t confirmed with its attestation';
  assert (select count(*) from public.application_screenings) = v_screenings_before + 4,
    'the screening trigger didn''t queue every new application';
  assert pg_temp.emails_queued() = v_emails_before, 'an import queued a stage email';
end $$;

-- An invalid stage and a failure roll everything back.
do $$
declare
  v_batch uuid := pg_temp.batch();
  v_before int := (select count(*) from public.company_candidates);
begin
  perform pg_temp.expect(public.confirm_candidate_import(v_batch, '[{"full_name": "Gil", "email": "gil@mail.test"}]',
    '{"attested": true, "job_post_id": "b0000000-0000-4000-8000-000000000001", "stage_map": {"x": "00000000-0000-4000-8000-000000000000"}}'),
    'invalid_stage', 'a stage from nowhere');
  begin
    perform public.confirm_candidate_import(v_batch, jsonb_build_array(
      jsonb_build_object('full_name', 'Hal', 'email', 'hal@mail.test'),
      jsonb_build_object('full_name', repeat('x', 121), 'email', 'ivy@mail.test')
    ), '{"attested": true}');
    raise exception 'a too-long name was accepted';
  exception when check_violation then null;
  end;
  assert (select count(*) from public.company_candidates) = v_before, 'a failed import left candidates behind';
  assert (select status from public.candidate_import_batches where id = v_batch) = 'draft', 'a failed import confirmed the batch';
end $$;

-- add_candidates_to_job (BI-REQ-005).
do $$
declare
  a2 uuid := 'b0000000-0000-4000-8000-000000000003';
  v_res jsonb;
begin
  v_res := pg_temp.expect(public.add_candidates_to_job(a2, array[
    'cc000000-0000-4000-8000-000000000001',   -- Ana: added
    'cc000000-0000-4000-8000-000000000002',   -- Ben: no email
    'cc000000-0000-4000-8000-000000000003',   -- Cid: already in A2
    'cc000000-0000-4000-8000-000000000009'    -- Gus: another company's
  ]::uuid[]), null, 'add to job');
  assert v_res -> 'counts' = '{"added_to_job": 1, "already_in_job": 1, "no_email": 1, "not_found": 1}'::jsonb,
    format('wrong counts: %s', v_res);
  perform pg_temp.expect(public.add_candidates_to_job(a2,
    (select array_agg(gen_random_uuid()) from generate_series(1, 201))), 'too_many', '201 candidates');
end $$;

select pg_temp.act('c5000000-0000-4000-8000-000000000001');
do $$
begin
  perform pg_temp.expect(public.add_candidates_to_job('b0000000-0000-4000-8000-000000000001',
    array['cc000000-0000-4000-8000-000000000003']::uuid[]), 'forbidden', 'scoped add to A1');
  -- Deleting needs applicants.import on all jobs.
  perform pg_temp.expect(public.delete_company_candidates(array['cc000000-0000-4000-8000-000000000003']::uuid[]),
    'forbidden', 'scoped delete');
end $$;

-- update_company_candidate and delete_company_candidates.
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
begin
  perform pg_temp.expect(public.update_company_candidate('cc000000-0000-4000-8000-000000000002',
    '{"email_opted_out_at": "2026-01-01"}'), 'invalid', 'opt-out can''t be set');
  perform pg_temp.expect(public.update_company_candidate('cc000000-0000-4000-8000-000000000002',
    '{"email": "ana@mail.test"}'), 'duplicate_email', 'a taken email');
  perform pg_temp.expect(public.update_company_candidate('cc000000-0000-4000-8000-000000000002',
    '{"email": "Ben@Mail.test", "linkedin_url": "https://linkedin.com/in/ben"}'), null, 'an edit');
  assert (select email = 'ben@mail.test' and links ->> 'linkedin' = 'https://linkedin.com/in/ben'
            from public.company_candidates where id = 'cc000000-0000-4000-8000-000000000002'), 'the edit wasn''t saved';
  perform pg_temp.expect(public.update_company_candidate('cc000000-0000-4000-8000-000000000009', '{}'),
    'not_found', 'another company''s candidate');

  perform pg_temp.expect(public.delete_company_candidates(array['cc000000-0000-4000-8000-000000000002']::uuid[]), null, 'delete');
  assert not exists (select 1 from public.company_candidates where id = 'cc000000-0000-4000-8000-000000000002'),
    'the candidate wasn''t deleted';
  assert exists (select 1 from public.company_audit_log where action = 'candidates.deleted' and after ->> 'count' = '1'),
    'no audit row for the delete';
end $$;

-- ================================================ block 2b: spreadsheet imports
-- BIT-034 (BI-SEC-008): at most 5 file imports an hour and 20 a day per
-- company. Hand-added candidates (no file name) have their own limit.
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare
  v_res jsonb;
  i int;
begin
  for i in 1..10 loop
    v_res := public.start_candidate_import('spreadsheet', 'more.csv');
    exit when not (v_res ->> 'ok')::boolean;
  end loop;
  perform pg_temp.expect(v_res, 'import_limit_hour', 'a 6th import in an hour');
  assert (select count(*) from public.candidate_import_batches
           where company_id = 'c0000000-0000-4000-8000-000000000001' and file_name is not null) = 5,
    'more than 5 imports started in an hour';
  perform pg_temp.expect(public.start_candidate_import('spreadsheet'), null, 'a hand-added candidate still works');
end $$;

reset role;
-- Move them back two hours: the hourly limit lifts, the daily one counts them.
update public.candidate_import_batches set created_at = now() - interval '2 hours'
 where company_id = 'c0000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare
  v_res jsonb;
  i int;
begin
  for i in 1..5 loop
    perform pg_temp.expect(public.start_candidate_import('spreadsheet', 'more.csv'), null, 'an import after an hour');
  end loop;
end $$;
reset role;
update public.candidate_import_batches set created_at = now() - interval '2 hours'
 where company_id = 'c0000000-0000-4000-8000-000000000001';
insert into public.candidate_import_batches (company_id, kind, file_name, created_by, created_at)
select 'c0000000-0000-4000-8000-000000000001', 'spreadsheet', 'old.csv', 'c1000000-0000-4000-8000-000000000001',
       now() - interval '3 hours'
  from generate_series(1, 10);
set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
begin
  perform pg_temp.expect(public.start_candidate_import('spreadsheet', 'more.csv'), 'import_limit_day', 'a 21st import in a day');
end $$;

reset role;

-- ================================================ block 3: resume storage, queue and rows
-- BIT-040, BIT-043 to BIT-046 (migration 20261025130000_bulk_import_resumes.sql).

-- Block 2b used up today's file imports.
update public.candidate_import_batches set created_at = now() - interval '2 days'
 where company_id = 'c0000000-0000-4000-8000-000000000001';

create function pg_temp.imports_queued() returns int language sql security definer as $$
  select count(*)::int from pgmq.q_candidate_import_queue
$$;
grant execute on function pg_temp.imports_queued() to authenticated;

do $$
begin
  assert (select not public and file_size_limit = 10485760
            and allowed_mime_types @> array['application/pdf',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
            from storage.buckets where id = 'company-candidate-files'),
    'the company-candidate-files bucket is missing or public';
  assert not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                      and (coalesce(qual, '') || coalesce(with_check, '')) like '%company-candidate-files%'),
    'a storage policy opens company-candidate-files to browsers';
  assert exists (select 1 from pgmq.list_queues() where queue_name = 'candidate_import_queue'),
    'candidate_import_queue is missing';
end $$;

insert into storage.objects (bucket_id, name)
values ('company-candidate-files', 'c0000000-0000-4000-8000-000000000001/x/seen.pdf');

set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
begin
  assert (select count(*) from storage.objects where bucket_id = 'company-candidate-files') = 0,
    'an owner can read the candidate files bucket directly';
  begin
    perform 1 from pgmq.q_candidate_import_queue;
    raise exception 'authenticated can read candidate_import_queue';
  exception when insufficient_privilege then null;
  end;
  begin
    perform pgmq_public.send('candidate_import_queue', '{"row_id": "x"}'::jsonb, 0);
    raise exception 'authenticated can send to candidate_import_queue';
  exception when insufficient_privilege or undefined_function or invalid_schema_name then null;
  end;
end $$;

-- start_resume_import (BI-REQ-020).
select pg_temp.act('c5000000-0000-4000-8000-000000000001');
do $$
begin
  perform pg_temp.expect(public.start_resume_import('b0000000-0000-4000-8000-000000000001', '[{"name": "a.pdf"}]'),
    'forbidden', 'scoped member, a job they aren''t on');
end $$;

select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare
  a uuid := 'c0000000-0000-4000-8000-000000000001';
  a2 uuid := 'b0000000-0000-4000-8000-000000000003';
  v_res jsonb;
  v_batch uuid;
begin
  perform pg_temp.expect(public.start_resume_import(a2, '[{"name": "old.doc"}]'), 'invalid', 'a .doc file');
  perform pg_temp.expect(public.start_resume_import(a2, '[]'), 'no_rows', 'no files');
  perform pg_temp.expect(public.start_resume_import(a2,
    (select jsonb_agg(jsonb_build_object('name', i || '.pdf')) from generate_series(1, 101) i)), 'too_many', '101 files');
  perform pg_temp.expect(public.start_resume_import('b0000000-0000-4000-8000-000000000002', '[{"name": "a.pdf"}]'),
    'not_found', 'another company''s job');

  v_res := pg_temp.expect(public.start_resume_import(a2, '[{"name": "Ada Lovelace.PDF"}, {"name": "bo.docx"}]'), null, 'start');
  v_batch := (v_res ->> 'batch_id')::uuid;
  assert jsonb_array_length(v_res -> 'rows') = 2, format('expected 2 rows: %s', v_res);
  assert v_res -> 'rows' -> 0 ->> 'file_name' = 'Ada Lovelace.PDF', 'the rows aren''t in file order';
  assert (v_res -> 'rows' -> 0 ->> 'file_path') = a || '/' || v_batch || '/' || (v_res -> 'rows' -> 0 ->> 'id') || '.pdf',
    format('wrong path: %s', v_res -> 'rows' -> 0);
  assert (v_res -> 'rows' -> 1 ->> 'file_path') like '%.docx', 'the docx path lost its extension';
  assert (select kind = 'resumes' and status = 'draft' and job_post_id = a2 and file_name = '2 resumes'
            from public.candidate_import_batches where id = v_batch), 'the batch wasn''t created as a draft';
  assert (select count(*) from public.candidate_import_rows where batch_id = v_batch and status = 'queued') = 2,
    'the rows weren''t created';

  -- Browsers read rows but never write them.
  begin
    update public.candidate_import_rows set status = 'parsed' where batch_id = v_batch;
    raise exception 'authenticated updated an import row';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Rows: other companies, applicants and anon see none.
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$ begin
  assert (select count(*) from public.candidate_import_rows) = 0, 'company B sees company A''s import rows';
end $$;
select pg_temp.act('a0000000-0000-4000-8000-000000000001');
do $$ begin
  assert (select count(*) from public.candidate_import_rows) = 0, 'an applicant sees import rows';
end $$;
select pg_temp.act('c5000000-0000-4000-8000-000000000001');
do $$ begin
  assert (select count(*) from public.candidate_import_rows) = 2, 'a member scoped to the job doesn''t see its rows';
end $$;

-- submit_resume_batch (BI-REQ-021/022, BI-SEC-008).
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare
  a2 uuid := 'b0000000-0000-4000-8000-000000000003';
  v_batch uuid := (select id from public.candidate_import_batches where file_name = '2 resumes');
  v_ada uuid := (select id from public.candidate_import_rows where batch_id = v_batch and file_name like 'Ada%');
  v_bo uuid := (select id from public.candidate_import_rows where batch_id = v_batch and file_name = 'bo.docx');
  v_before int := pg_temp.imports_queued();
  v_second uuid;
  v_third uuid;
begin
  perform pg_temp.expect(public.submit_resume_batch(v_batch, array[]::uuid[]), 'no_rows', 'nothing uploaded');
  perform pg_temp.expect(public.submit_resume_batch(v_batch, array[v_ada], '{"stage_id": "00000000-0000-4000-8000-000000000000"}'),
    'invalid_stage', 'a stage from nowhere');
  -- Only Ada's file reached Storage.
  perform pg_temp.expect(public.submit_resume_batch(v_batch, array[v_ada], '{"auto_invite": true}'), null, 'submit');
  assert pg_temp.imports_queued() = v_before + 1, 'the uploaded file wasn''t queued';
  assert (select status = 'failed' and error_code = 'unreadable' from public.candidate_import_rows where id = v_bo),
    'a file that never arrived wasn''t failed';
  assert (select status = 'parsing' and auto_invite from public.candidate_import_batches where id = v_batch),
    'the batch isn''t parsing';
  perform pg_temp.expect(public.submit_resume_batch(v_batch, array[v_ada]), 'already_submitted', 'a second submit');

  -- At most 2 batches parsing at once.
  v_second := (public.start_resume_import(a2, '[{"name": "b.pdf"}]') ->> 'batch_id')::uuid;
  perform pg_temp.expect(public.submit_resume_batch(v_second,
    array(select id from public.candidate_import_rows where batch_id = v_second)), null, 'a second batch');
  v_third := (public.start_resume_import(a2, '[{"name": "c.pdf"}]') ->> 'batch_id')::uuid;
  perform pg_temp.expect(public.submit_resume_batch(v_third,
    array(select id from public.candidate_import_rows where batch_id = v_third)), 'parsing_limit', 'a third batch');

  -- Grid changes (BI-REQ-023/024).
  perform pg_temp.expect(public.update_import_row(v_ada, '{"email": "ada@mail.test"}'), 'not_parsed', 'edit while parsing');
  perform pg_temp.expect(public.retry_import_row(v_ada), 'not_failed', 'retry a queued row');
  v_before := pg_temp.imports_queued();
  perform pg_temp.expect(public.retry_import_row(v_bo), null, 'retry');
  assert (select status = 'queued' and error_code is null from public.candidate_import_rows where id = v_bo),
    'the retried row isn''t queued';
  assert pg_temp.imports_queued() = v_before + 1, 'the retry wasn''t queued';
  perform pg_temp.expect(public.remove_import_row(v_bo), null, 'remove');
  assert (select status from public.candidate_import_rows where id = v_bo) = 'removed', 'the row wasn''t removed';
end $$;

-- Another company and a member without applicants.import can't touch the rows.
select pg_temp.act('c4000000-0000-4000-8000-000000000001');
do $$
declare
  v_row uuid := (select id from public.candidate_import_rows where file_name like 'Ada%');
begin
  perform pg_temp.expect(public.update_import_row(v_row, '{}'), 'forbidden', 'viewer edits a row');
  perform pg_temp.expect(public.remove_import_row(v_row), 'forbidden', 'viewer removes a row');
end $$;
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$
declare
  v_row uuid := (select id from public.candidate_import_rows where file_name like 'Ada%');
begin
  perform pg_temp.expect(public.remove_import_row(v_row), 'not_found', 'company B removes A''s row');
end $$;

reset role;

-- ================================================ block 4: confirming a resume batch
-- BIT-047 (BI-REQ-019/024/025/015c). Rows set up as the worker leaves them.
insert into public.company_candidates (id, company_id, full_name, email, resume_path) values
  ('cc000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'Fay', 'fay@mail.test',
   'c0000000-0000-4000-8000-000000000001/old/fay.pdf');
insert into public.candidate_import_batches (id, company_id, kind, job_post_id, file_name, status, created_by) values
  ('cb000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'resumes',
   'b0000000-0000-4000-8000-000000000003', '6 resumes', 'parsing', 'c1000000-0000-4000-8000-000000000001');
insert into public.candidate_import_rows (id, batch_id, company_id, file_path, file_name, status, extracted, created_at)
select r.id::uuid, 'cb000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001',
       'c0000000-0000-4000-8000-000000000001/cb000000-0000-4000-8000-000000000004/' || r.id || '.pdf',
       r.name || '.pdf', r.status, r.extracted::jsonb, now() + (r.n || ' seconds')::interval
  from (values
    (1, 'f1000000-0000-4000-8000-000000000001', 'nia', 'parsed',
     '{"fields": {"full_name": "Nia", "email": "Nia@Mail.test", "current_title": "Designer", "skills": ["Figma"]},
       "resume": {"sections": [{"type": "experience", "items": []}]}}'),
    (2, 'f1000000-0000-4000-8000-000000000002', 'fay', 'parsed',
     '{"fields": {"full_name": "Fay F", "email": "fay@mail.test", "current_title": "PM"}, "resume": {"sections": []}}'),
    (3, 'f1000000-0000-4000-8000-000000000003', 'one', 'parsed',
     '{"fields": {"full_name": "One", "email": "one@applicant.test"}, "resume": {"sections": []}}'),
    (4, 'f1000000-0000-4000-8000-000000000004', 'cid', 'parsed',
     '{"fields": {"full_name": "Cid", "email": "cid@mail.test"}, "resume": {"sections": []}}'),
    (5, 'f1000000-0000-4000-8000-000000000005', 'scan', 'failed', null),
    (6, 'f1000000-0000-4000-8000-000000000006', 'oli', 'parsed',
     '{"fields": {"full_name": "Oli"}, "resume": {"sections": []}}'),
    (7, 'f1000000-0000-4000-8000-000000000007', 'late', 'parsing', null)
  ) as r(n, id, name, status, extracted);

set local role authenticated;
select pg_temp.act('c4000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.confirm_candidate_import('cb000000-0000-4000-8000-000000000004', null, '{"attested": true}'),
    'forbidden', 'a member without applicants.import');
end $$;

select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare
  b uuid := 'cb000000-0000-4000-8000-000000000004';
  a2 uuid := 'b0000000-0000-4000-8000-000000000003';
  v_res jsonb;
  v_emails_before int := pg_temp.emails_queued();
  v_screenings_before int := (select count(*) from public.application_screenings);
  v_nia public.company_candidates%rowtype;
begin
  perform pg_temp.expect(public.confirm_candidate_import(b, null, '{}'), 'not_attested', 'no attestation');
  v_res := pg_temp.expect(public.confirm_candidate_import(b, null, '{"attested": true}'), 'missing_email', 'Oli has no email');
  assert v_res -> 'row_ids' = '["f1000000-0000-4000-8000-000000000006"]'::jsonb, format('wrong rows: %s', v_res);
  assert not exists (select 1 from public.company_candidates where lower(email) = 'nia@mail.test'),
    'a refused confirm created candidates';

  perform pg_temp.expect(public.update_import_row('f1000000-0000-4000-8000-000000000006', '{"email": "oli@mail.test"}'),
    null, 'add Oli''s email');
  perform pg_temp.expect(public.update_import_row('f1000000-0000-4000-8000-000000000006', '{"nope": 1}'),
    'invalid', 'an unknown field');

  v_res := pg_temp.expect(public.confirm_candidate_import(b,
    '[{"row_id": "f1000000-0000-4000-8000-000000000002", "duplicate_action": "fill"}]',
    '{"attested": true, "lawful_basis_note": "applied by email"}'), null, 'confirm');
  assert v_res -> 'counts' @> '{"created": 2, "updated": 1, "skipped": 1, "known": 1, "added_to_job": 3,
                                "already_in_job": 1, "needs_outreach": 1}'::jsonb, format('wrong counts: %s', v_res);
  assert v_res -> 'delete_paths' @> jsonb_build_array(
      'c0000000-0000-4000-8000-000000000001/cb000000-0000-4000-8000-000000000004/f1000000-0000-4000-8000-000000000003.pdf',
      'c0000000-0000-4000-8000-000000000001/cb000000-0000-4000-8000-000000000004/f1000000-0000-4000-8000-000000000004.pdf',
      'c0000000-0000-4000-8000-000000000001/old/fay.pdf')
    and jsonb_array_length(v_res -> 'delete_paths') = 3, format('wrong files to delete: %s', v_res -> 'delete_paths');

  select * into v_nia from public.company_candidates where email = 'nia@mail.test';
  assert v_nia.resume_path like '%/f1000000-0000-4000-8000-000000000001.pdf'
     and v_nia.resume_content -> 'sections' -> 0 ->> 'type' = 'experience'
     and v_nia.skills = '{Figma}' and v_nia.source_batch_id = b, 'Nia wasn''t created with the resume';
  assert (select full_name = 'Fay' and current_title = 'PM' and resume_path like '%/f1000000-0000-4000-8000-000000000002.pdf'
            from public.company_candidates where id = 'cc000000-0000-4000-8000-000000000004'),
    '"fill" didn''t keep Fay''s name, fill the title and replace the resume';
  assert (select count(*) from public.applications
           where import_batch_id = b and source = 'imported' and job_post_id = a2
             and stage_id = (select s.id from public.pipeline_stages s where s.company_id = 'c0000000-0000-4000-8000-000000000001'
                                and s.kind = 'applied' and not s.archived order by s.position limit 1)) = 3,
    'the applications weren''t created at the first stage';
  assert (select status from public.candidate_import_rows where id = 'f1000000-0000-4000-8000-000000000005') = 'failed'
     and (select status from public.candidate_import_rows where id = 'f1000000-0000-4000-8000-000000000007') = 'parsing',
    'failed or parsing rows were confirmed';
  assert (select count(*) from public.candidate_import_rows where batch_id = b and status = 'confirmed') = 3
     and (select count(*) from public.candidate_import_rows where batch_id = b and status = 'removed') = 2,
    'the rows weren''t marked';
  assert (select status = 'confirmed' and lawful_basis_note = 'applied by email'
            from public.candidate_import_batches where id = b), 'the batch wasn''t confirmed';
  assert exists (select 1 from public.company_audit_log where action = 'candidates.imported' and target_id = b::text),
    'no audit row';
  assert (select count(*) from public.application_screenings) = v_screenings_before + 3,
    'the screening trigger didn''t queue the applications';
  assert pg_temp.emails_queued() = v_emails_before, 'a resume import queued a stage email';

  perform pg_temp.expect(public.confirm_candidate_import(b, null, '{"attested": true}'), 'already_confirmed', 'twice');
end $$;

-- set_company_candidate_resume (BI-REQ-008).
do $$
declare
  a text := 'c0000000-0000-4000-8000-000000000001';
  v_res jsonb;
begin
  perform pg_temp.expect(public.set_company_candidate_resume('cc000000-0000-4000-8000-000000000004',
    'c0000000-0000-4000-8000-000000000002/x/fay.pdf', '{"sections": []}'), 'invalid', 'another company''s folder');
  perform pg_temp.expect(public.set_company_candidate_resume('cc000000-0000-4000-8000-000000000009',
    'c0000000-0000-4000-8000-000000000002/x/gus.pdf', '{"sections": []}'), 'not_found', 'another company''s candidate');

  v_res := pg_temp.expect(public.set_company_candidate_resume('cc000000-0000-4000-8000-000000000004',
    a || '/candidates/new.pdf', '{"sections": [{"type": "skills", "items": []}]}',
    '{"current_title": "CEO", "current_company": "Acme", "full_name": "Not Fay"}'), null, 'upload a resume');
  assert v_res ->> 'replaced_path' like '%/f1000000-0000-4000-8000-000000000002.pdf', format('wrong replaced path: %s', v_res);
  assert jsonb_array_length(v_res -> 'application_ids') = 1, format('Fay''s open application: %s', v_res);
  assert (select full_name = 'Fay' and current_title = 'PM' and current_company = 'Acme'
            and resume_path = a || '/candidates/new.pdf' and resume_content -> 'sections' -> 0 ->> 'type' = 'skills'
            from public.company_candidates where id = 'cc000000-0000-4000-8000-000000000004'),
    'the resume upload overwrote a field or wasn''t saved';
end $$;

select pg_temp.act('c4000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.set_company_candidate_resume('cc000000-0000-4000-8000-000000000004',
    'c0000000-0000-4000-8000-000000000001/candidates/x.pdf', '{"sections": []}'), 'forbidden', 'viewer uploads a resume');
end $$;

reset role;

-- ================================================ block 5: invites, claims and merges
-- BIT-062 (migration 20261025140000_bulk_import_claims.sql). Fresh people, so
-- the earlier blocks don't matter: Lia (A1), Mo (A2), Nox (A2, no email), Hal
-- (A1 and A2, applicant 2's email). Company A is on the free plan: 30
-- interview minutes; each interview here holds 10.
create function pg_temp.hold(p_id uuid) returns int language sql as $$
  select qty from public.company_entitlement_holds
   where ref_type = 'application_interview' and ref_id = p_id::text and key = 'interview_minutes'
$$;
create function pg_temp.claim_link(p_token text, p_candidate uuid, p_interview uuid, p_expires timestamptz)
returns void language sql as $$
  insert into public.company_candidate_claims (token_hash, company_id, candidate_id, application_interview_id, expires_at)
  values (encode(sha256(convert_to(p_token, 'UTF8')), 'hex'), 'c0000000-0000-4000-8000-000000000001',
          p_candidate, p_interview, p_expires)
$$;

insert into public.job_interview_configs (job_post_id, company_id, enabled, invite_rule, competencies, duration_minutes)
select j, 'c0000000-0000-4000-8000-000000000001', true, 'manual', '[{"name": "Craft", "description": "Builds well"}]', 10
  from unnest(array['b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003']::uuid[]) j
on conflict (job_post_id) do update set enabled = true, invite_rule = 'manual', competencies = excluded.competencies,
  duration_minutes = 10;

insert into public.company_candidates (id, company_id, full_name, email) values
  ('cc000000-0000-4000-8000-000000000051', 'c0000000-0000-4000-8000-000000000001', 'Lia', 'lia@mail.test'),
  ('cc000000-0000-4000-8000-000000000052', 'c0000000-0000-4000-8000-000000000001', 'Mo', 'mo@mail.test'),
  ('cc000000-0000-4000-8000-000000000053', 'c0000000-0000-4000-8000-000000000001', 'Nox', null),
  ('cc000000-0000-4000-8000-000000000054', 'c0000000-0000-4000-8000-000000000001', 'Hal', 'two@applicant.test');
insert into public.applications (id, job_post_id, all_jobs_id, source, company_candidate_id) values
  ('ea000000-0000-4000-8000-000000000051', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'imported', 'cc000000-0000-4000-8000-000000000051'),
  ('ea000000-0000-4000-8000-000000000052', 'b0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003', 'imported', 'cc000000-0000-4000-8000-000000000052'),
  ('ea000000-0000-4000-8000-000000000053', 'b0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003', 'imported', 'cc000000-0000-4000-8000-000000000053'),
  ('ea000000-0000-4000-8000-000000000054', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'imported', 'cc000000-0000-4000-8000-000000000054'),
  ('ea000000-0000-4000-8000-000000000055', 'b0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003', 'imported', 'cc000000-0000-4000-8000-000000000054');

-- Schema: no user until the claim, and the claims table is the service role's.
do $$ begin
  assert (select is_nullable = 'YES' from information_schema.columns
           where table_schema = 'public' and table_name = 'application_interviews' and column_name = 'applicant_user_id'),
    'application_interviews.applicant_user_id is still not null';
  assert not has_table_privilege('authenticated', 'public.company_candidate_claims', 'select')
     and not has_table_privilege('anon', 'public.company_candidate_claims', 'select'),
    'browsers can read the claims';
  assert not has_function_privilege('anon', 'public.claim_company_candidate(text)', 'execute')
     and has_function_privilege('authenticated', 'public.claim_company_candidate(text)', 'execute'),
    'claim_company_candidate grants';
  assert not has_function_privilege('authenticated', 'public.merge_imported_application(uuid, uuid)', 'execute'),
    'merge_imported_application is callable from the browser';
end $$;

-- create_screening_invite for imported applications (BI-REQ-040), as the service role.
do $$
declare
  v_res jsonb;
  v_lia public.application_interviews%rowtype;
  v_queued int := (select count(*) from pgmq.q_screening_invite_email_queue);
begin
  perform pg_temp.expect(public.create_screening_invite('ea000000-0000-4000-8000-000000000053', 'manual', null),
    'no_email', 'Nox has no email');
  update public.company_candidates set email_opted_out_at = now() where id = 'cc000000-0000-4000-8000-000000000052';
  perform pg_temp.expect(public.create_screening_invite('ea000000-0000-4000-8000-000000000052', 'manual', null),
    'unsubscribed', 'Mo unsubscribed');
  update public.company_candidates set email_opted_out_at = null where id = 'cc000000-0000-4000-8000-000000000052';

  v_res := pg_temp.expect(public.create_screening_invite('ea000000-0000-4000-8000-000000000051', 'manual', null), null, 'invite Lia');
  assert v_res -> 'interview_id' = 'null'::jsonb, format('Lia got an interviews row before claiming: %s', v_res);
  select * into v_lia from public.application_interviews where application_id = 'ea000000-0000-4000-8000-000000000051';
  assert v_lia.applicant_user_id is null and v_lia.company_candidate_id = 'cc000000-0000-4000-8000-000000000051'
     and v_lia.interview_id is null and v_lia.status = 'invited', 'Lia''s interview row';
  assert pg_temp.hold(v_lia.id) = 10, 'Lia''s minutes aren''t held';
  assert (select count(*) from pgmq.q_screening_invite_email_queue) = v_queued + 1, 'no invite email queued';
  assert exists (select 1 from public.application_events where application_id = v_lia.application_id
                   and type = 'interview_invited' and candidate_user_id is null), 'no invite event';

  perform pg_temp.expect(public.create_screening_invite('ea000000-0000-4000-8000-000000000052', 'manual', null), null, 'invite Mo');

  perform pg_temp.claim_link('expired-token-0000000000', 'cc000000-0000-4000-8000-000000000051', v_lia.id, now() - interval '1 minute');
  perform pg_temp.claim_link('lia-token-000000000000000', 'cc000000-0000-4000-8000-000000000051', v_lia.id, v_lia.deadline_at);
  perform pg_temp.claim_link('company-token-00000000000', 'cc000000-0000-4000-8000-000000000051', v_lia.id, v_lia.deadline_at);
  perform pg_temp.claim_link('mo-token-0000000000000000', 'cc000000-0000-4000-8000-000000000052',
    (select id from public.application_interviews where application_id = 'ea000000-0000-4000-8000-000000000052'),
    now() + interval '5 days');
end $$;

-- Applicant 3 applied to A2 directly, with another email: Mo's claim merges.
insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id) values
  ('e0000000-0000-4000-8000-000000000053', 'a0000000-0000-4000-8000-000000000003',
   'b0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003');

set local role authenticated;

select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.claim_company_candidate('company-token-00000000000'), 'company_account', 'a company member claims');
end $$;

-- claim_company_candidate (BI-REQ-041/043): applicant 4 claims Lia.
select pg_temp.act('a0000000-0000-4000-8000-000000000004');
do $$
declare
  v_res jsonb;
  v_id uuid := (select id from public.my_screening_interviews() limit 1);
begin
  assert v_id is null, 'applicant 4 sees an interview before claiming';
  perform pg_temp.expect(public.claim_company_candidate('nope-nope-nope-nope-nope'), 'invalid', 'an unknown token');
  perform pg_temp.expect(public.claim_company_candidate('expired-token-0000000000'), 'expired', 'an expired token');

  v_res := pg_temp.expect(public.claim_company_candidate('lia-token-000000000000000'), null, 'claim Lia');
  select m.id into v_id from public.my_screening_interviews() m where m.interview_id is not null;
  assert v_id is not null and (v_res ->> 'application_interview_id')::uuid = v_id,
    format('the claimed interview isn''t the landing, or isn''t the applicant''s: %s', v_res);

  -- A second click lands on the same interview.
  v_res := pg_temp.expect(public.claim_company_candidate('lia-token-000000000000000'), null, 'claim Lia again');
  assert (v_res ->> 'application_interview_id')::uuid = v_id, format('wrong landing on a second click: %s', v_res);
end $$;

reset role;
do $$
declare
  v_lia public.application_interviews%rowtype;
begin
  select * into v_lia from public.application_interviews where application_id = 'ea000000-0000-4000-8000-000000000051';
  assert v_lia.applicant_user_id = 'a0000000-0000-4000-8000-000000000004', 'the interview wasn''t linked';
  assert (select user_id = 'a0000000-0000-4000-8000-000000000004' and kind = 'screening'
            from public.interviews where id = v_lia.interview_id), 'no screening interviews row for the claimant';
  assert (select applicant_user_id = 'a0000000-0000-4000-8000-000000000004'
             and company_candidate_id = 'cc000000-0000-4000-8000-000000000051' and merged_into_application_id is null
            from public.applications where id = 'ea000000-0000-4000-8000-000000000051'),
    'the application wasn''t linked, or lost its candidate';
  assert (select claimed_user_id = 'a0000000-0000-4000-8000-000000000004' and claimed_at is not null
            from public.company_candidates where id = 'cc000000-0000-4000-8000-000000000051'), 'the candidate wasn''t claimed';
  assert (select count(*) from public.application_events
           where application_id = 'ea000000-0000-4000-8000-000000000051' and type = 'claimed') = 1, 'one claimed event';
  assert (select used_by = 'a0000000-0000-4000-8000-000000000004' from public.company_candidate_claims
           where token_hash = encode(sha256(convert_to('lia-token-000000000000000', 'UTF8')), 'hex')), 'the link wasn''t used';
  -- BI-REQ-043: the account is untouched.
  assert (select email = 'four@applicant.test' and full_name = 'four' and not is_public
            from public.user_info where user_id = 'a0000000-0000-4000-8000-000000000004'), 'the claim changed user_info';
  assert (select email = 'four@applicant.test' from auth.users where id = 'a0000000-0000-4000-8000-000000000004'),
    'the claim changed the account email';
  assert (select count(*) from public.applications where applicant_user_id = 'a0000000-0000-4000-8000-000000000004') = 1,
    'other applications were linked';
end $$;

set local role authenticated;
select pg_temp.act('a0000000-0000-4000-8000-000000000003');
do $$ begin
  perform pg_temp.expect(public.claim_company_candidate('lia-token-000000000000000'), 'used', 'someone else uses Lia''s link');
end $$;

-- BI-REQ-042: applicant 3 claims Mo, whose A2 application merges into theirs.
do $$
declare
  v_res jsonb;
  v_new uuid;
begin
  v_res := pg_temp.expect(public.claim_company_candidate('mo-token-0000000000000000'), null, 'claim Mo');
  select m.id into v_new from public.my_screening_interviews() m
   where m.application_id = 'e0000000-0000-4000-8000-000000000053' and m.status = 'invited' and m.interview_id is not null;
  assert v_new is not null and (v_res ->> 'application_interview_id')::uuid = v_new,
    format('the direct application wasn''t invited, or the landing is wrong: %s', v_res);
end $$;

reset role;
do $$
declare
  v_old public.application_interviews%rowtype;
begin
  select * into v_old from public.application_interviews where application_id = 'ea000000-0000-4000-8000-000000000052';
  assert v_old.status = 'cancelled' and v_old.applicant_user_id is null, 'the imported interview wasn''t cancelled';
  assert pg_temp.hold(v_old.id) is null, 'the imported interview''s minutes weren''t released';
  assert (select merged_into_application_id = 'e0000000-0000-4000-8000-000000000053' and applicant_user_id is null
            from public.applications where id = 'ea000000-0000-4000-8000-000000000052'), 'Mo''s application wasn''t merged';
  assert (select count(*) from public.application_events where type = 'merged' and application_id in
           ('ea000000-0000-4000-8000-000000000052', 'e0000000-0000-4000-8000-000000000053')) = 2, 'merged events';
end $$;

-- BI-REQ-044: applicant 2 applies to A1, where Hal (their email) was imported.
insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id) values
  ('e0000000-0000-4000-8000-000000000054', 'a0000000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001');
do $$ begin
  assert (select merged_into_application_id = 'e0000000-0000-4000-8000-000000000054'
            from public.applications where id = 'ea000000-0000-4000-8000-000000000054'), 'Hal''s A1 application wasn''t merged';
  assert (select merged_into_application_id is null and applicant_user_id is null
            from public.applications where id = 'ea000000-0000-4000-8000-000000000055'), 'Hal''s A2 application was touched';
  assert (select claimed_user_id is null from public.company_candidates where id = 'cc000000-0000-4000-8000-000000000054'),
    'merging on apply claimed the candidate';
  assert (select merged_into_application_id is null from public.applications
           where id = 'ea000000-0000-4000-8000-000000000053'), 'a candidate without that email was merged';
end $$;

-- BIT-100 (migration 20261026140000_keep_claimed_applications.sql): deleting
-- a claimed candidate keeps the person's applications and interviews. Lia is
-- claimed, Mo is claimed but his import merged (no user), Nox isn't claimed.
set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$ begin
  assert (pg_temp.expect(public.delete_company_candidates(array[
    'cc000000-0000-4000-8000-000000000051', 'cc000000-0000-4000-8000-000000000052',
    'cc000000-0000-4000-8000-000000000053']::uuid[]), null, 'delete Lia, Mo and Nox') ->> 'deleted')::int = 3,
    'three candidates deleted';
end $$;

reset role;
do $$ begin
  assert (select applicant_user_id = 'a0000000-0000-4000-8000-000000000004' and company_candidate_id is null
            from public.applications where id = 'ea000000-0000-4000-8000-000000000051'),
    'Lia''s claimed application was deleted, or kept its candidate';
  assert (select applicant_user_id = 'a0000000-0000-4000-8000-000000000004' and company_candidate_id is null
            from public.application_interviews where application_id = 'ea000000-0000-4000-8000-000000000051'),
    'Lia''s interview was deleted, or kept its candidate';
  assert not exists (select 1 from public.applications where id in
           ('ea000000-0000-4000-8000-000000000052', 'ea000000-0000-4000-8000-000000000053')),
    'the merged import or the unclaimed one survived';
  assert not exists (select 1 from public.application_interviews where application_id = 'ea000000-0000-4000-8000-000000000052'),
    'the merged import''s interview survived';
  assert exists (select 1 from public.applications where id = 'e0000000-0000-4000-8000-000000000053'),
    'Mo''s direct application was deleted';
end $$;

select 'bulk_import: ok' as result;

rollback;
