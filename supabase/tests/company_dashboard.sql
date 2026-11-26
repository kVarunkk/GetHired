-- Company dashboard (plan/company-dashboard, CD-MIG-1, CD-MIG-2):
-- company_dashboard_summary() and get_company_funnel() count only the caller's
-- scoped jobs, leave out merged applications, and return nothing for a
-- non-member. Runs in a transaction that always rolls back, so it's safe
-- against the linked project once the migrations are applied:
--   npx supabase db query --linked -f supabase/tests/company_dashboard.sql
-- Any failed check raises an exception; success prints 'company_dashboard: ok'.

begin;

create function pg_temp.act(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true)
$$;
grant execute on function pg_temp.act(uuid) to authenticated, anon;

do $$ begin
  assert not has_function_privilege('anon', 'public.company_dashboard_summary()', 'execute'),
    'anon can run company_dashboard_summary';
  assert not has_function_privilege('anon', 'public.get_company_funnel()', 'execute'),
    'anon can run get_company_funnel';
end $$;

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

-- Everyone has waited 5 days with nothing logged. C applied 10 days ago.
delete from public.application_events where application_id::text like 'fe000000-%';
update public.applications set stage_entered_at = now() - interval '5 days' where id::text like 'fe000000-%';
update public.applications set created_at = now() - interval '10 days'
 where id = 'fe000000-0000-4000-8000-000000000002';

set local role authenticated;

-- Company A's owner: both jobs, three live applications, not the merged one.
select pg_temp.act('f1000000-0000-4000-8000-000000000001');
do $$
declare
  s jsonb := public.company_dashboard_summary();
  f jsonb := public.get_company_funnel();
begin
  assert s = '{"open_jobs": 2, "new_today": 2, "new_7d": 2, "waiting": 3}'::jsonb, 'owner summary: ' || s;
  assert jsonb_array_length(f -> 'jobs') = 2, 'owner funnel jobs: ' || (f -> 'jobs');
  assert (select sum((x ->> 'count')::int) from jsonb_array_elements(f -> 'stages') x) = 3,
    'owner funnel stages: ' || (f -> 'stages');
  assert (select array_agg(x ->> 'application_id' order by x ->> 'application_id')
            from jsonb_array_elements(f -> 'needs_attention') x)
         = array['fe000000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000002',
                 'fe000000-0000-4000-8000-000000000003'],
    'owner waiting list: ' || (f -> 'needs_attention');
  -- applicationPerson's rule: the company's own record wins.
  assert (select array_agg(x ->> 'name' order by x ->> 'application_id')
            from jsonb_array_elements(f -> 'needs_attention') x)
         = array['Uma User', 'Cara Imported', 'Old Name'],
    'waiting names: ' || (f -> 'needs_attention');
end $$;

-- The member scoped to A2: only A2.
select pg_temp.act('f5000000-0000-4000-8000-000000000001');
do $$
declare
  s jsonb := public.company_dashboard_summary();
  f jsonb := public.get_company_funnel();
begin
  assert s = '{"open_jobs": 1, "new_today": 1, "new_7d": 1, "waiting": 1}'::jsonb, 'scoped summary: ' || s;
  assert jsonb_array_length(f -> 'jobs') = 1 and f #>> '{jobs,0,job_post_id}' = 'fb000000-0000-4000-8000-000000000002',
    'scoped funnel jobs: ' || (f -> 'jobs');
  assert jsonb_array_length(f -> 'needs_attention') = 1
         and f #>> '{needs_attention,0,application_id}' = 'fe000000-0000-4000-8000-000000000003',
    'scoped waiting list: ' || (f -> 'needs_attention');
end $$;

-- Company B's owner: only B's.
select pg_temp.act('f1000000-0000-4000-8000-000000000002');
do $$
declare
  s jsonb := public.company_dashboard_summary();
begin
  assert s = '{"open_jobs": 1, "new_today": 1, "new_7d": 1, "waiting": 1}'::jsonb, 'company B summary: ' || s;
end $$;

-- A non-member gets nothing.
select pg_temp.act('fa000000-0000-4000-8000-000000000003');
do $$ begin
  assert public.company_dashboard_summary() is null, 'a non-member got a summary';
  assert public.get_company_funnel() is null, 'a non-member got a funnel';
end $$;

reset role;

select 'company_dashboard: ok' as result;

rollback;
