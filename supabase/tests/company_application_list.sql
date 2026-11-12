-- ATS quick fixes, part C (QFT-021): the company_application_list view.
-- Runs in a transaction that always rolls back, so it's safe against the
-- linked project once the migration is applied:
--   npx supabase db query --linked -f supabase/tests/company_application_list.sql
-- Any failed check raises an exception; success prints 'company_application_list: ok'.

begin;

create function pg_temp.act(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true)
$$;
grant execute on function pg_temp.act(uuid) to authenticated, anon;

-- The view must run as the caller (QF-REQ-020).
do $$ begin
  assert (select coalesce('security_invoker=true' = any (c.reloptions), false)
            from pg_class c where c.oid = 'public.company_application_list'::regclass),
    'company_application_list isn''t security_invoker';
  assert not has_table_privilege('anon', 'public.company_application_list', 'select'),
    'anon can select from company_application_list';
end $$;

-- Seed. Company A (owner, a member scoped to A2) and company B (owner).
-- Applicant U applied to A1; imported candidate C is on A1; claimed person
-- (user V + candidate D) is on A2; an imported duplicate on A1 is merged into
-- U's application; W applied to B1.
insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data) values
  ('f1000000-0000-4000-8000-000000000001', 'hr@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('f1000000-0000-4000-8000-000000000002', 'hr@globex.test', 'authenticated', 'authenticated', now(), '{}'),
  ('f5000000-0000-4000-8000-000000000001', 'scoped@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('fa000000-0000-4000-8000-000000000001', 'u@applicant.test', 'authenticated', 'authenticated', now(), '{}'),
  ('fa000000-0000-4000-8000-000000000002', 'v@applicant.test', 'authenticated', 'authenticated', now(), '{}'),
  ('fa000000-0000-4000-8000-000000000003', 'w@applicant.test', 'authenticated', 'authenticated', now(), '{}');

insert into public.company_info (id, user_id, name, email) values
  ('f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Acme', 'hr@acme.test'),
  ('f0000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', 'Globex', 'hr@globex.test');

insert into public.user_info (user_id, email, full_name, is_public, filled) values
  ('fa000000-0000-4000-8000-000000000001', 'u@applicant.test', 'Uma User', true, true),
  ('fa000000-0000-4000-8000-000000000002', 'v@applicant.test', 'Vik Claimed', true, true),
  ('fa000000-0000-4000-8000-000000000003', 'w@applicant.test', 'Wen Other', true, true);

insert into public.all_jobs (id, job_name, job_url, company_name, platform) values
  ('fd000000-0000-4000-8000-000000000001', 'A1', 'https://acme.test/jobs/q1', 'Acme', 'gethired'),
  ('fd000000-0000-4000-8000-000000000002', 'A2', 'https://acme.test/jobs/q2', 'Acme', 'gethired'),
  ('fd000000-0000-4000-8000-000000000003', 'B1', 'https://globex.test/jobs/q1', 'Globex', 'gethired');

insert into public.job_postings (id, company_id, title, job_id, status) values
  ('fb000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'Backend A1', 'fd000000-0000-4000-8000-000000000001', 'active'),
  ('fb000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'Frontend A2', 'fd000000-0000-4000-8000-000000000002', 'active'),
  ('fb000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000002', 'Globex B1', 'fd000000-0000-4000-8000-000000000003', 'active');

do $$
declare
  a uuid := 'f0000000-0000-4000-8000-000000000001';
  v_scoped uuid;
begin
  insert into public.company_roles (company_id, name) values (a, 'Scoped QF') returning id into v_scoped;
  insert into public.company_role_permissions (role_id, permission_key, scope) values
    (v_scoped, 'jobs.view', 'assigned'), (v_scoped, 'applicants.view', 'assigned');
  insert into public.company_members (company_id, user_id, role_id, display_name) values
    (a, 'f5000000-0000-4000-8000-000000000001', v_scoped, 'Sam Scoped');
  insert into public.company_job_assignments (company_id, job_post_id, user_id) values
    (a, 'fb000000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000001')
  on conflict do nothing;
end $$;

insert into public.company_candidates (id, company_id, full_name, email) values
  ('fc000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'Cara Imported', 'cara@mail.test'),
  ('fc000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'Old Name', 'vik@mail.test'),
  ('fc000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000001', 'Uma Duplicate', 'uma@mail.test');

update public.company_candidates set resume_path = 'f0000000-0000-4000-8000-000000000001/vik.pdf'
 where id = 'fc000000-0000-4000-8000-000000000002';

insert into public.applications (id, applicant_user_id, company_candidate_id, job_post_id, all_jobs_id) values
  -- U on A1.
  ('fe000000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001', null,
   'fb000000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001'),
  -- Imported C on A1.
  ('fe000000-0000-4000-8000-000000000002', null, 'fc000000-0000-4000-8000-000000000001',
   'fb000000-0000-4000-8000-000000000001', null),
  -- Claimed (V + D) on A2.
  ('fe000000-0000-4000-8000-000000000003', 'fa000000-0000-4000-8000-000000000002', 'fc000000-0000-4000-8000-000000000002',
   'fb000000-0000-4000-8000-000000000002', 'fd000000-0000-4000-8000-000000000002'),
  -- W on B1.
  ('fe000000-0000-4000-8000-000000000005', 'fa000000-0000-4000-8000-000000000003', null,
   'fb000000-0000-4000-8000-000000000003', 'fd000000-0000-4000-8000-000000000003');

-- An imported duplicate on A2, merged into the claimed application.
insert into public.applications (id, company_candidate_id, job_post_id, merged_into_application_id) values
  ('fe000000-0000-4000-8000-000000000004', 'fc000000-0000-4000-8000-000000000003',
   'fb000000-0000-4000-8000-000000000002', 'fe000000-0000-4000-8000-000000000003');

-- Screenings: U completed; nobody else has one (a trigger may have queued some).
delete from public.application_screenings where application_id::text like 'fe000000-%';
insert into public.application_screenings (application_id, job_post_id, company_id, status, fit_score, recommendation) values
  ('fe000000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000001',
   'f0000000-0000-4000-8000-000000000001', 'completed', 82, 'yes');

-- Knockouts: U passed, C failed, the claimed one has none.
delete from public.application_knockouts where application_id::text like 'fe000000-%';
insert into public.application_knockouts (application_id, company_id, job_post_id, failed, action_taken) values
  ('fe000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001',
   'fb000000-0000-4000-8000-000000000001', false, 'none'),
  ('fe000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001',
   'fb000000-0000-4000-8000-000000000001', true, 'flagged');
update public.application_knockouts set reasons = '[{"label": "Has a visa"}]'
 where application_id = 'fe000000-0000-4000-8000-000000000002';

set local role authenticated;

-- Company A's owner: A's three live applications, not B's, not the merged one.
select pg_temp.act('f1000000-0000-4000-8000-000000000001');
do $$
declare
  r record;
begin
  assert (select array_agg(id::text order by id) from public.company_application_list where id::text like 'fe000000-%')
         = array['fe000000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000002',
                 'fe000000-0000-4000-8000-000000000003'],
    'company A''s owner doesn''t see exactly A''s live applications';

  select * into r from public.company_application_list where id = 'fe000000-0000-4000-8000-000000000001';
  assert r.person_name = 'Uma User', 'an applicant''s name isn''t the user''s';
  assert r.candidate_has_resume = false, 'an applicant has a candidate resume';
  assert r.job_title = 'Backend A1' and r.company_id = 'f0000000-0000-4000-8000-000000000001', 'job columns';
  assert r.fit_score = 82 and r.screening_status = 'completed' and r.recommendation = 'yes', 'screening columns';
  assert r.knockout_failed = false, 'a passed knockout isn''t false';

  select * into r from public.company_application_list where id = 'fe000000-0000-4000-8000-000000000002';
  assert r.person_name = 'Cara Imported', 'an imported application''s name isn''t the candidate''s';
  assert r.applicant_user_id is null and r.company_candidate_id = 'fc000000-0000-4000-8000-000000000001', 'person ids';
  assert r.fit_score is null and r.screening_status is null and r.recommendation is null,
    'an application with no screening has screening values';
  assert r.knockout_failed = true, 'a failed knockout isn''t true';

  assert r.knockout_reasons = '[{"label": "Has a visa"}]'::jsonb, 'knockout_reasons';
  assert r.candidate_has_resume = false, 'a candidate with no resume has one';

  -- applicationPerson (BI-REQ-043): the company's record wins for a claimed application.
  select * into r from public.company_application_list where id = 'fe000000-0000-4000-8000-000000000003';
  assert r.person_name = 'Old Name', 'a claimed application doesn''t read as the company candidate';
  assert r.knockout_failed is null and r.knockout_reasons is null, 'no knockout row isn''t null';
  assert r.candidate_has_resume = true, 'a candidate with a resume has none';
end $$;

-- A member scoped to A2 sees only A2's.
select pg_temp.act('f5000000-0000-4000-8000-000000000001');
do $$ begin
  assert (select array_agg(id::text) from public.company_application_list where id::text like 'fe000000-%')
         = array['fe000000-0000-4000-8000-000000000003'],
    'a member scoped to A2 doesn''t see exactly A2''s application';
end $$;

-- Company B sees only B's.
select pg_temp.act('f1000000-0000-4000-8000-000000000002');
do $$ begin
  assert (select array_agg(id::text) from public.company_application_list where id::text like 'fe000000-%')
         = array['fe000000-0000-4000-8000-000000000005'],
    'company B doesn''t see exactly its application';
end $$;

-- An applicant sees nothing, not even their own application.
select pg_temp.act('fa000000-0000-4000-8000-000000000001');
do $$ begin
  assert not exists (select 1 from public.company_application_list), 'an applicant sees rows';
end $$;

reset role;

select 'company_application_list: ok';

rollback;
