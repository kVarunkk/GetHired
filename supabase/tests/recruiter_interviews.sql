-- Human interviews (plan/recruiter-interviews/feature-recruiter-interviews-tasks.md).
-- Phase 1 blocks: 1 schema and permissions (IVT-011), 2 plans (IVT-012),
-- 3 blind review and the note-rating lockdown (IVT-014), 4 manual interviews
-- and the lifecycle (IVT-016), 5 scorecards (IVT-017), 6 the kit and "My
-- interviews" (IVT-019, IVT-021), 7 merges (IVT-023).
-- Runs in a transaction that always rolls back, so it's safe against the
-- linked project once the migrations are applied:
--   npx supabase db query --linked -f supabase/tests/recruiter_interviews.sql
-- Any failed check raises an exception; success prints 'recruiter_interviews: ok'.

begin;

create function pg_temp.act(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true)
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
-- Whether p_sql raises insufficient_privilege for the current role.
create function pg_temp.denied(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when insufficient_privilege then
  return true;
end $$;
grant execute on function pg_temp.act(uuid), pg_temp.expect(jsonb, text, text), pg_temp.denied(text) to authenticated, anon;

-- Seed. Company A: Owen (owner), Rita (schedules on every job), Ian (no
-- permissions: an Interviewer-template role), Ivo (no permissions), Pat
-- (edits plans on A1 only), Vera (sees all feedback), Nora (notes only).
-- Company B: Bea (owner). Applicants One and Two applied to A1.
insert into auth.users (id, email, aud, role) values
  ('c1000000-0000-4000-8000-000000000001', 'owen@acme.test', 'authenticated', 'authenticated'),
  ('c1000000-0000-4000-8000-000000000002', 'bea@globex.test', 'authenticated', 'authenticated'),
  ('c2000000-0000-4000-8000-000000000001', 'rita@acme.test', 'authenticated', 'authenticated'),
  ('c3000000-0000-4000-8000-000000000001', 'ian@acme.test', 'authenticated', 'authenticated'),
  ('c3000000-0000-4000-8000-000000000002', 'ivo@acme.test', 'authenticated', 'authenticated'),
  ('c4000000-0000-4000-8000-000000000001', 'pat@acme.test', 'authenticated', 'authenticated'),
  ('c7000000-0000-4000-8000-000000000001', 'vera@acme.test', 'authenticated', 'authenticated'),
  ('c8000000-0000-4000-8000-000000000001', 'nora@acme.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000001', 'one@applicant.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000002', 'two@applicant.test', 'authenticated', 'authenticated');

insert into public.company_info (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Acme', 'owen@acme.test'),
  ('c0000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'Globex', 'bea@globex.test');

insert into public.user_info (user_id, email, full_name, is_public, filled) values
  ('a0000000-0000-4000-8000-000000000001', 'one@applicant.test', 'One', true, true),
  ('a0000000-0000-4000-8000-000000000002', 'two@applicant.test', 'Two', true, true);

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
  v_rita uuid;
  v_none uuid;
  v_pat uuid;
  v_vera uuid;
  v_nora uuid;
begin
  insert into public.company_roles (company_id, name) values (a, 'Scheduler') returning id into v_rita;
  insert into public.company_role_permissions (role_id, permission_key, scope) values
    (v_rita, 'jobs.view', 'all'), (v_rita, 'applicants.view', 'all'), (v_rita, 'scheduling.view', 'all'),
    (v_rita, 'scheduling.manage', 'all'), (v_rita, 'notes.view', 'all'), (v_rita, 'notes.write', 'all');
  -- What the Interviewer template now makes: nothing.
  insert into public.company_roles (company_id, name, template_key) values (a, 'Interviewer', 'interviewer')
    returning id into v_none;
  insert into public.company_roles (company_id, name) values (a, 'Planner') returning id into v_pat;
  insert into public.company_role_permissions (role_id, permission_key, scope) values
    (v_pat, 'jobs.view', 'assigned'), (v_pat, 'interview_plans.manage', 'assigned');
  insert into public.company_roles (company_id, name) values (a, 'Lead') returning id into v_vera;
  insert into public.company_role_permissions (role_id, permission_key, scope) values
    (v_vera, 'jobs.view', 'all'), (v_vera, 'applicants.view', 'all'), (v_vera, 'scheduling.view', 'all'),
    (v_vera, 'scorecards.view_all', 'all'), (v_vera, 'notes.view', 'all'), (v_vera, 'notes.write', 'all');
  insert into public.company_roles (company_id, name) values (a, 'Notes') returning id into v_nora;
  insert into public.company_role_permissions (role_id, permission_key, scope) values
    (v_nora, 'jobs.view', 'all'), (v_nora, 'applicants.view', 'all'), (v_nora, 'notes.view', 'all'),
    (v_nora, 'notes.write', 'all');
  insert into public.company_members (company_id, user_id, role_id, display_name) values
    (a, 'c2000000-0000-4000-8000-000000000001', v_rita, 'Rita'),
    (a, 'c3000000-0000-4000-8000-000000000001', v_none, 'Ian'),
    (a, 'c3000000-0000-4000-8000-000000000002', v_none, 'Ivo'),
    (a, 'c4000000-0000-4000-8000-000000000001', v_pat, 'Pat'),
    (a, 'c7000000-0000-4000-8000-000000000001', v_vera, 'Vera'),
    (a, 'c8000000-0000-4000-8000-000000000001', v_nora, 'Nora');
  insert into public.company_job_assignments (company_id, job_post_id, user_id) values
    (a, 'b0000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001')
  on conflict do nothing;
end $$;

insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002');

-- Handy ids.
select set_config('test.a', 'c0000000-0000-4000-8000-000000000001', true),
       set_config('test.screen', (select id::text from public.pipeline_stages
                                   where company_id = 'c0000000-0000-4000-8000-000000000001' and kind = 'screening'), true),
       set_config('test.interview', (select id::text from public.pipeline_stages
                                   where company_id = 'c0000000-0000-4000-8000-000000000001' and kind = 'interview'), true),
       set_config('test.rejected', (select id::text from public.pipeline_stages
                                   where company_id = 'c0000000-0000-4000-8000-000000000001' and kind = 'rejected'), true),
       set_config('test.b_screen', (select id::text from public.pipeline_stages
                                   where company_id = 'c0000000-0000-4000-8000-000000000002' and kind = 'screening'), true);

-- ================================================ block 1: schema and permissions (IVT-011)

do $$
begin
  assert (select count(*) from public.company_permissions
           where key in ('scheduling.view', 'scheduling.manage', 'interview_plans.manage', 'scorecards.view_all')
             and scopable) = 4, 'the four interview keys are missing or not scopable';
  assert (select requires from public.company_permissions where key = 'scheduling.view') = '{applicants.view}',
    'scheduling.view requires applicants.view';
  assert (select requires from public.company_permissions where key = 'scheduling.manage') = '{scheduling.view}',
    'scheduling.manage requires scheduling.view';
  assert (select requires from public.company_permissions where key = 'interview_plans.manage') = '{jobs.view}',
    'interview_plans.manage requires jobs.view';
  assert (select requires from public.company_permissions where key = 'scorecards.view_all') = '{scheduling.view}',
    'scorecards.view_all requires scheduling.view';
  assert exists (select 1 from public.company_permissions where key = 'interviews.view')
     and exists (select 1 from public.company_permissions where key = 'interviews.manage'),
    'the AI interview keys must stay';

  -- A new company's seeded roles.
  assert (select count(*) from public.company_role_permissions rp
            join public.company_roles r on r.id = rp.role_id
           where r.company_id = current_setting('test.a')::uuid and r.template_key = 'admin'
             and rp.permission_key in ('scheduling.view', 'scheduling.manage', 'interview_plans.manage',
                                       'scorecards.view_all')) = 4, 'Admin lacks the interview keys';
  assert (select array_agg(rp.permission_key::text order by rp.permission_key::text) from public.company_role_permissions rp
            join public.company_roles r on r.id = rp.role_id
           where r.company_id = current_setting('test.a')::uuid and r.template_key = 'member'
             and rp.permission_key like 'sch%' or (r.company_id = current_setting('test.a')::uuid
             and r.template_key = 'member' and rp.permission_key in ('interview_plans.manage', 'scorecards.view_all')))
       = array['scheduling.manage', 'scheduling.view'], 'Member gets the scheduling keys only';

  -- company_info.time_zone (D21).
  update public.company_info set time_zone = 'Asia/Kolkata' where id = current_setting('test.a')::uuid;
  begin
    update public.company_info set time_zone = 'Mars/Olympus' where id = current_setting('test.a')::uuid;
    raise exception 'an unknown time zone was accepted';
  exception when check_violation then null;
  end;
  -- The calendar tables come in the phase 2 migration (block 8).
end $$;

-- No direct writes for authenticated; anon reads nothing.
set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
begin
  assert pg_temp.denied(format(
    'insert into public.job_interview_plan_items (company_id, job_post_id, stage_id, position, name)
     values (%L, %L, %L, 0, %L)', current_setting('test.a'), 'b0000000-0000-4000-8000-000000000001',
     current_setting('test.screen'), 'x')), 'an owner inserted a plan item directly';
  assert pg_temp.denied(format(
    'insert into public.scheduled_interviews (company_id, job_post_id, application_id, name, duration_minutes, status, source, starts_at, ends_at)
     values (%L, %L, %L, %L, 30, %L, %L, now(), now() + interval %L)', current_setting('test.a'),
     'b0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'x', 'scheduled', 'manual', '30 minutes')),
    'an owner inserted an interview directly';
  assert pg_temp.denied('update public.interview_scorecards set overall = ''strong_yes'''),
    'an owner updated scorecards directly';
  assert pg_temp.denied('delete from public.scheduled_interview_panel'), 'an owner deleted panel rows directly';
end $$;
reset role;

set local role anon;
select pg_temp.act(null);
do $$
begin
  assert pg_temp.denied('select 1 from public.scheduled_interviews'), 'anon read scheduled_interviews';
  assert pg_temp.denied('select 1 from public.interview_scorecards'), 'anon read scorecards';
  assert pg_temp.denied('select 1 from public.job_interview_plan_items'), 'anon read plans';
end $$;
reset role;

-- ================================================ block 2: interview plans (IVT-012)

set local role authenticated;

select pg_temp.act('c4000000-0000-4000-8000-000000000001');
do $$
declare
  v_plan jsonb := jsonb_build_array(jsonb_build_object(
    'stage_id', current_setting('test.screen'), 'name', 'Technical screen', 'duration_minutes', 60,
    'instructions', 'Go deep on one project.',
    'default_interviewer_ids', jsonb_build_array('c3000000-0000-4000-8000-000000000001'),
    'competencies', jsonb_build_array(
      jsonb_build_object('name', 'System design', 'description', 'Trade-offs', 'questions', jsonb_build_array('Design a URL shortener', ' ')),
      jsonb_build_object('name', 'Communication', 'questions', '[]'::jsonb)
    )
  ));
  v_item uuid;
  v_comp uuid;
begin
  -- Pat may edit A1's plan only.
  perform pg_temp.expect(public.save_interview_plan('b0000000-0000-4000-8000-000000000003', v_plan), 'forbidden',
    'a planner scoped to A1 saves A2');
  perform pg_temp.expect(public.save_interview_plan('b0000000-0000-4000-8000-000000000002', v_plan), 'not_found',
    'another company''s job');
  perform pg_temp.expect(public.save_interview_plan('b0000000-0000-4000-8000-000000000001', v_plan), null, 'save A1');

  select id into v_item from public.job_interview_plan_items where job_post_id = 'b0000000-0000-4000-8000-000000000001';
  assert (select duration_minutes = 60 and position = 0 and default_interviewer_ids = '{c3000000-0000-4000-8000-000000000001}'
            from public.job_interview_plan_items where id = v_item), 'the item wasn''t saved';
  assert (select array_agg(name order by position) from public.job_interview_competencies where plan_item_id = v_item)
       = array['System design', 'Communication'], 'competencies weren''t saved in order';
  assert (select questions from public.job_interview_competencies where plan_item_id = v_item and position = 0)
       = array['Design a URL shortener'], 'blank questions weren''t dropped';

  -- Ids sent back are kept (IV-REQ-003).
  select id into v_comp from public.job_interview_competencies where plan_item_id = v_item and position = 0;
  perform pg_temp.expect(public.save_interview_plan('b0000000-0000-4000-8000-000000000001', jsonb_build_array(
    jsonb_build_object('id', v_item, 'stage_id', current_setting('test.screen'), 'name', 'Tech screen',
      'default_interviewer_ids', jsonb_build_array('c3000000-0000-4000-8000-000000000001'),
      'competencies', jsonb_build_array(jsonb_build_object('id', v_comp, 'name', 'Design'))))), null, 'resave');
  assert (select name from public.job_interview_competencies where id = v_comp) = 'Design', 'the competency id changed';
  assert (select count(*) from public.job_interview_competencies where plan_item_id = v_item) = 1,
    'the dropped competency is still there';

  -- Refusals.
  perform pg_temp.expect(public.save_interview_plan('b0000000-0000-4000-8000-000000000001', jsonb_build_array(
    jsonb_build_object('stage_id', current_setting('test.rejected'), 'name', 'x',
      'competencies', jsonb_build_array(jsonb_build_object('name', 'y'))))), 'invalid_stage', 'a Rejected stage');
  perform pg_temp.expect(public.save_interview_plan('b0000000-0000-4000-8000-000000000001', jsonb_build_array(
    jsonb_build_object('stage_id', current_setting('test.b_screen'), 'name', 'x',
      'competencies', jsonb_build_array(jsonb_build_object('name', 'y'))))), 'invalid_stage', 'another company''s stage');
  perform pg_temp.expect(public.save_interview_plan('b0000000-0000-4000-8000-000000000001', jsonb_build_array(
    jsonb_build_object('stage_id', current_setting('test.screen'), 'name', 'x',
      'default_interviewer_ids', jsonb_build_array('c1000000-0000-4000-8000-000000000002'),
      'competencies', jsonb_build_array(jsonb_build_object('name', 'y'))))), 'invalid_interviewers', 'a non-member');
  perform pg_temp.expect(public.save_interview_plan('b0000000-0000-4000-8000-000000000001', jsonb_build_array(
    jsonb_build_object('stage_id', current_setting('test.screen'), 'name', 'x', 'duration_minutes', 10,
      'competencies', jsonb_build_array(jsonb_build_object('name', 'y'))))), 'invalid_plan', 'a 10-minute interview');
  perform pg_temp.expect(public.save_interview_plan('b0000000-0000-4000-8000-000000000001', jsonb_build_array(
    jsonb_build_object('stage_id', current_setting('test.screen'), 'name', 'x', 'competencies', '[]'::jsonb))),
    'invalid_plan', 'no competencies');
  assert (select count(*) from public.job_interview_plan_items where job_post_id = 'b0000000-0000-4000-8000-000000000001') = 1,
    'a refused save changed the plan';
end $$;

-- Copying: Pat can't edit A2. The owner copies A1 → A2; Ian (a member who
-- can't see A2 through a role) is dropped as a default interviewer.
do $$ begin
  perform pg_temp.expect(public.copy_interview_plan('b0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000003'), 'forbidden', 'a planner copies into A2');
end $$;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare
  v_res jsonb;
begin
  v_res := pg_temp.expect(public.copy_interview_plan('b0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000003'), null, 'copy A1 → A2');
  assert (v_res ->> 'items')::int = 1, 'one item copied';
  assert v_res -> 'dropped_interviewer_ids' = '["c3000000-0000-4000-8000-000000000001"]'::jsonb,
    'Ian should be dropped: ' || v_res::text;
  assert (select count(*) from public.job_interview_competencies c join public.job_interview_plan_items i on i.id = c.plan_item_id
           where i.job_post_id = 'b0000000-0000-4000-8000-000000000003') = 1, 'the competency wasn''t copied';
  perform pg_temp.expect(public.copy_interview_plan('b0000000-0000-4000-8000-000000000002',
    'b0000000-0000-4000-8000-000000000003'), 'not_found', 'copy from another company');
end $$;

-- Reads: scheduling.view or interview_plans.manage for the job.
select pg_temp.act('c3000000-0000-4000-8000-000000000001');
do $$ begin
  assert (select count(*) from public.job_interview_plan_items) = 0, 'an interviewer reads plans';
end $$;
select pg_temp.act('c2000000-0000-4000-8000-000000000001');
do $$ begin
  assert (select count(*) from public.job_interview_plan_items) = 2, 'a scheduler reads both plans';
  assert (select count(*) from public.job_interview_competencies) = 2, 'a scheduler reads the competencies';
end $$;
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$ begin
  assert (select count(*) from public.job_interview_plan_items) = 0, 'another company reads A''s plans';
end $$;
reset role;

-- ================================================ block 3: blind review and the rating lockdown (IVT-014)

-- Interviews written directly (as the owner of the tables) to set times.
-- App 1: I1 completed 2 days ago, panel Ian + Ivo. App 2: I2 completed 8
-- days ago, panel Ian.
do $$
declare
  v_item uuid := (select id from public.job_interview_plan_items where job_post_id = 'b0000000-0000-4000-8000-000000000001');
  a uuid := current_setting('test.a')::uuid;
begin
  insert into public.scheduled_interviews (id, company_id, job_post_id, application_id, plan_item_id, stage_id, name,
    duration_minutes, plan_snapshot, status, source, starts_at, ends_at)
  values
    ('f1000000-0000-4000-8000-000000000001', a, 'b0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000001', v_item, current_setting('test.screen')::uuid, 'Tech screen', 60,
     public.plan_item_snapshot(v_item), 'completed', 'manual', now() - interval '2 days 1 hour', now() - interval '2 days'),
    ('f1000000-0000-4000-8000-000000000002', a, 'b0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000002', v_item, current_setting('test.screen')::uuid, 'Tech screen', 60,
     public.plan_item_snapshot(v_item), 'completed', 'manual', now() - interval '8 days 1 hour', now() - interval '8 days');
  insert into public.scheduled_interview_panel (interview_id, user_id, company_id) values
    ('f1000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', a),
    ('f1000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', a),
    ('f1000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000001', a);

  -- Notes with ratings by Nora and by Ian on app 1.
  insert into public.candidate_notes (id, company_id, candidate_user_id, application_id, author_user_id, author_name, body, rating)
  values
    ('99000000-0000-4000-8000-000000000001', a, 'a0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000001', 'Nora', 'Strong', 'strong_yes'),
    ('99000000-0000-4000-8000-000000000002', a, 'a0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'Ian', 'Mine', 'no'),
    ('99000000-0000-4000-8000-000000000003', a, 'a0000000-0000-4000-8000-000000000002',
     'e0000000-0000-4000-8000-000000000002', 'c8000000-0000-4000-8000-000000000001', 'Nora', 'Okay', 'yes');

  -- The cases of IV-REQ-032.
  assert not public.is_scorecard_blind('e0000000-0000-4000-8000-000000000003', 'c3000000-0000-4000-8000-000000000001'),
    'no interviews: not blind';
  assert public.is_scorecard_blind('e0000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001'),
    'on the panel of one completed 2 days ago, no scorecard row: blind';
  assert not public.is_scorecard_blind('e0000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000001'),
    'completed 8 days ago: not blind';
  assert not public.is_scorecard_blind('e0000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000001'),
    'not on the panel: not blind';

  -- A draft row still counts as unsubmitted.
  insert into public.interview_scorecards (interview_id, application_id, company_id, author_user_id, overall)
  values ('f1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', a,
          'c3000000-0000-4000-8000-000000000002', 'yes');
  assert public.is_scorecard_blind('e0000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002'),
    'a draft keeps its author blind';

  -- awaiting_candidate, cancelled and no_show never blind.
  update public.scheduled_interviews set status = 'no_show' where id = 'f1000000-0000-4000-8000-000000000001';
  assert not public.is_scorecard_blind('e0000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001'),
    'no_show: not blind';
  update public.scheduled_interviews set status = 'cancelled' where id = 'f1000000-0000-4000-8000-000000000001';
  assert not public.is_scorecard_blind('e0000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001'),
    'cancelled: not blind';
  update public.scheduled_interviews set status = 'awaiting_candidate', starts_at = null, ends_at = null
   where id = 'f1000000-0000-4000-8000-000000000001';
  assert not public.is_scorecard_blind('e0000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001'),
    'awaiting_candidate: not blind';
  update public.scheduled_interviews set status = 'scheduled', starts_at = now() + interval '1 day',
         ends_at = now() + interval '1 day 1 hour'
   where id = 'f1000000-0000-4000-8000-000000000001';
  assert public.is_scorecard_blind('e0000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001'),
    'scheduled: blind';
  update public.scheduled_interviews set status = 'completed', starts_at = now() - interval '2 days 1 hour',
         ends_at = now() - interval '2 days'
   where id = 'f1000000-0000-4000-8000-000000000001';
end $$;

-- The lockdown: Rita (notes.view) can't select the rating column.
set local role authenticated;
select pg_temp.act('c2000000-0000-4000-8000-000000000001');
do $$
begin
  assert pg_temp.denied('select rating from public.candidate_notes'), 'authenticated selected candidate_notes.rating';
  assert pg_temp.denied('select * from public.candidate_notes'), 'select * reads the rating';
  assert (select count(*) from (select id, body, author_user_id from public.candidate_notes) x) = 3,
    'the other columns stay readable';
end $$;

-- Ian is blind on app 1: Nora's rating is masked, his own isn't.
select pg_temp.act('c3000000-0000-4000-8000-000000000001');
do $$
begin
  assert (select count(*) from public.list_application_notes('e0000000-0000-4000-8000-000000000001')) = 0,
    'without notes.view the RPC returns nothing';
end $$;
reset role;
-- Give the Interviewer role notes.view for this check.
insert into public.company_role_permissions (role_id, permission_key, scope)
select id, 'notes.view', 'all' from public.company_roles
 where company_id = current_setting('test.a')::uuid and template_key = 'interviewer';
set local role authenticated;
select pg_temp.act('c3000000-0000-4000-8000-000000000001');
do $$
begin
  assert (select rating is null and rating_hidden from public.list_application_notes('e0000000-0000-4000-8000-000000000001')
           where id = '99000000-0000-4000-8000-000000000001'), 'a blind reader saw a colleague''s rating';
  assert (select rating = 'no' and not rating_hidden from public.list_application_notes('e0000000-0000-4000-8000-000000000001')
           where id = '99000000-0000-4000-8000-000000000002'), 'the author lost their own rating';
  assert (select body from public.list_application_notes('e0000000-0000-4000-8000-000000000001')
           where id = '99000000-0000-4000-8000-000000000001') = 'Strong', 'note text must stay visible';
  -- App 2's interview ended 8 days ago: ratings visible.
  assert (select rating from public.list_candidate_notes(null, 'a0000000-0000-4000-8000-000000000002')
           where id = '99000000-0000-4000-8000-000000000003') = 'yes', 'an old interview still hides ratings';
  -- One note by id (the MCP preview's read).
  assert (select rating is null and rating_hidden from public.list_candidate_notes(p_note_id => '99000000-0000-4000-8000-000000000001')),
    'by id, a blind reader saw a colleague''s rating';
  assert (select rating from public.list_candidate_notes(p_note_id => '99000000-0000-4000-8000-000000000002')) = 'no',
    'by id, the author lost their rating';
  -- The board's ratings follow the same rule.
  assert (select count(*) filter (where rating_hidden) from public.list_job_note_ratings('b0000000-0000-4000-8000-000000000001')) = 1,
    'the board leaked a blind rating';
  assert (select count(*) from public.list_job_note_ratings('b0000000-0000-4000-8000-000000000001')) = 3,
    'the board lost notes';
end $$;

-- Nora isn't on a panel: she sees every rating. Company B sees none.
select pg_temp.act('c8000000-0000-4000-8000-000000000001');
do $$ begin
  assert (select count(*) filter (where rating is not null) from public.list_application_notes('e0000000-0000-4000-8000-000000000001')) = 2,
    'a non-panel reader lost ratings';
end $$;
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$ begin
  assert (select count(*) from public.list_application_notes('e0000000-0000-4000-8000-000000000001')) = 0,
    'another company read the notes';
  assert (select count(*) from public.list_job_note_ratings('b0000000-0000-4000-8000-000000000001')) = 0,
    'another company read the board ratings';
end $$;
reset role;

-- ================================================ block 4: manual interviews and the lifecycle (IVT-016)

set local role authenticated;
select pg_temp.act('c2000000-0000-4000-8000-000000000001');
do $$
declare
  v_item uuid := (select id from public.job_interview_plan_items where job_post_id = 'b0000000-0000-4000-8000-000000000001');
  v_res jsonb;
  v_id uuid;
  v_snapshot jsonb;
begin
  -- Refusals.
  perform pg_temp.expect(public.record_interview('e0000000-0000-4000-8000-000000000003', array['c3000000-0000-4000-8000-000000000001']::uuid[], now() + interval '1 day', p_plan_item_id => null, p_name => 'Chat', p_duration_minutes => 30), 'not_found', 'another company''s application');
  perform pg_temp.expect(public.record_interview('e0000000-0000-4000-8000-000000000002', array['c1000000-0000-4000-8000-000000000002']::uuid[], now() + interval '1 day', p_plan_item_id => null, p_name => 'Chat', p_duration_minutes => 30), 'invalid_panel', 'a non-member on the panel');
  perform pg_temp.expect(public.record_interview('e0000000-0000-4000-8000-000000000002', '{}'::uuid[], now() + interval '1 day', p_plan_item_id => null, p_name => 'Chat', p_duration_minutes => 30), 'invalid_panel', 'an empty panel');
  perform pg_temp.expect(public.record_interview('e0000000-0000-4000-8000-000000000002', array['c3000000-0000-4000-8000-000000000001']::uuid[], now() + interval '1 day', p_plan_item_id => null, p_name => '', p_duration_minutes => 30), 'invalid_name', 'no name');
  perform pg_temp.expect(public.record_interview('e0000000-0000-4000-8000-000000000002', array['c3000000-0000-4000-8000-000000000001']::uuid[], now() + interval '1 day', p_plan_item_id => null, p_name => 'Chat', p_duration_minutes => 300), 'invalid_duration', '300 minutes');
  perform pg_temp.expect(public.record_interview('e0000000-0000-4000-8000-000000000002', array['c3000000-0000-4000-8000-000000000001']::uuid[], now() + interval '1 day', p_plan_item_id => null, p_name => 'Chat', p_duration_minutes => 30, p_meeting_url => 'javascript:alert(1)'),
    'invalid_url', 'a javascript: link');

  -- A plan interview: the snapshot holds the competencies by id.
  v_res := pg_temp.expect(public.record_interview('e0000000-0000-4000-8000-000000000002', array['c3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002']::uuid[], now() + interval '1 day', p_plan_item_id => v_item, p_name => null, p_duration_minutes => null, p_meeting_url => 'https://meet.example/abc'), null, 'record a plan interview');
  v_id := (v_res ->> 'id')::uuid;
  assert v_res ->> 'status' = 'scheduled', 'a future interview is scheduled';
  select plan_snapshot into v_snapshot from public.scheduled_interviews where id = v_id;
  assert v_snapshot -> 'competencies' -> 0 ->> 'id' = (select id::text from public.job_interview_competencies where plan_item_id = v_item),
    'the snapshot lost the competency id';
  assert (select source = 'manual' and organizer_user_id is null and duration_minutes = 45 and ends_at = starts_at + interval '45 minutes'
            from public.scheduled_interviews where id = v_id), 'the manual interview''s fields';
  assert (select count(*) from public.scheduled_interview_panel where interview_id = v_id) = 2, 'the panel';
  assert exists (select 1 from public.application_events where type = 'meeting_scheduled'
                  and payload ->> 'scheduled_interview_id' = v_id::text), 'no meeting_scheduled event';
  perform set_config('test.i3', v_id::text, true);

  -- A past interview is recorded as completed.
  v_res := pg_temp.expect(public.record_interview('e0000000-0000-4000-8000-000000000002', array['c3000000-0000-4000-8000-000000000001']::uuid[], now() - interval '3 hours', p_plan_item_id => null, p_name => 'Coffee chat', p_duration_minutes => 30), null, 'record a past one');
  assert v_res ->> 'status' = 'completed', 'a past interview is completed';
  assert (select plan_snapshot -> 'competencies' from public.scheduled_interviews where id = (v_res ->> 'id')::uuid) = '[]'::jsonb,
    'an ad-hoc interview has no competencies';
  perform set_config('test.i4', v_res ->> 'id', true);
end $$;

-- Editing the plan afterwards doesn't change the snapshot (IV-REQ-003).
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare
  v_item uuid := (select id from public.job_interview_plan_items where job_post_id = 'b0000000-0000-4000-8000-000000000001');
begin
  perform pg_temp.expect(public.save_interview_plan('b0000000-0000-4000-8000-000000000001', jsonb_build_array(
    jsonb_build_object('id', v_item, 'stage_id', current_setting('test.screen'), 'name', 'Renamed',
      'competencies', jsonb_build_array(jsonb_build_object('name', 'New one'))))), null, 'edit the plan');
  assert (select plan_snapshot ->> 'name' from public.scheduled_interviews where id = current_setting('test.i3')::uuid) = 'Tech screen',
    'the snapshot followed the plan';
end $$;

-- Interviewers can't manage; Rita can.
select pg_temp.act('c3000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.cancel_interview(current_setting('test.i3')::uuid), 'forbidden', 'an interviewer cancels');
  perform pg_temp.expect(public.record_interview('e0000000-0000-4000-8000-000000000002', array['c3000000-0000-4000-8000-000000000001']::uuid[], now(), p_plan_item_id => null, p_name => 'x', p_duration_minutes => 30), 'forbidden', 'an interviewer records');
end $$;

reset role;
insert into public.interview_scorecards (interview_id, application_id, company_id, author_user_id)
values (current_setting('test.i3')::uuid, 'e0000000-0000-4000-8000-000000000002', current_setting('test.a')::uuid,
        'c3000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.act('c2000000-0000-4000-8000-000000000001');
do $$
declare
  v_res jsonb;
begin
  -- No-show only after the start.
  perform pg_temp.expect(public.mark_interview(current_setting('test.i3')::uuid, 'no_show'), 'not_started', 'a no-show before the start');
  perform pg_temp.expect(public.mark_interview(current_setting('test.i3')::uuid, 'completed'), 'not_started', 'completed before the start');

  -- Reschedule and change the panel: Ivo's draft goes (seeded below).
  v_res := pg_temp.expect(public.update_interview(current_setting('test.i3')::uuid, now() + interval '2 days',
    array['c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001']::uuid[]), null, 'reschedule');
  assert not exists (select 1 from public.interview_scorecards where interview_id = current_setting('test.i3')::uuid
                      and author_user_id = 'c3000000-0000-4000-8000-000000000002'), 'the removed member''s draft stayed';
  assert (select array_agg(user_id order by user_id) from public.scheduled_interview_panel
           where interview_id = current_setting('test.i3')::uuid)
       = array['c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001']::uuid[], 'the new panel';
  assert exists (select 1 from public.application_events where type = 'meeting_rescheduled'
                  and payload ->> 'scheduled_interview_id' = current_setting('test.i3')), 'no meeting_rescheduled event';
  assert exists (select 1 from public.application_events where type = 'meeting_panel_changed'
                  and payload ->> 'scheduled_interview_id' = current_setting('test.i3')), 'no meeting_panel_changed event';

  -- Completed → no_show within 7 days; not after.
  perform pg_temp.expect(public.mark_interview(current_setting('test.i4')::uuid, 'no_show'), null, 'no-show a completed one');
  perform pg_temp.expect(public.mark_interview(current_setting('test.i4')::uuid, 'completed'), 'invalid_status', 'no_show → completed');
  perform pg_temp.expect(public.mark_interview('f1000000-0000-4000-8000-000000000002', 'no_show'), 'too_late',
    'a no-show 8 days after the end');

  -- Cancel, then nothing more.
  v_res := pg_temp.expect(public.cancel_interview(current_setting('test.i3')::uuid), null, 'cancel');
  perform pg_temp.expect(public.cancel_interview(current_setting('test.i3')::uuid), 'invalid_status', 'cancel twice');
  perform pg_temp.expect(public.update_interview(current_setting('test.i3')::uuid, now() + interval '3 days'),
    'invalid_status', 'move a cancelled one');
  assert exists (select 1 from public.application_events where type = 'meeting_cancelled'
                  and payload ->> 'scheduled_interview_id' = current_setting('test.i3')), 'no meeting_cancelled event';
end $$;
reset role;

-- A closed application refuses new interviews.
update public.applications set stage_id = current_setting('test.rejected')::uuid
 where id = 'e0000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.act('c2000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.record_interview('e0000000-0000-4000-8000-000000000002', array['c3000000-0000-4000-8000-000000000001']::uuid[], now() + interval '1 day', p_plan_item_id => null, p_name => 'x', p_duration_minutes => 30), 'closed', 'a rejected application');
end $$;
reset role;
update public.applications set stage_id = current_setting('test.screen')::uuid
 where id = 'e0000000-0000-4000-8000-000000000002';

-- Auto-complete (service role).
do $$
declare
  v_done uuid[];
begin
  update public.scheduled_interviews set status = 'scheduled' where id = current_setting('test.i4')::uuid;
  update public.scheduled_interviews set starts_at = now() - interval '2 hours', ends_at = now() - interval '20 minutes'
   where id = current_setting('test.i4')::uuid;
  select array_agg(x) into v_done from public.complete_due_interviews() x;
  assert current_setting('test.i4')::uuid = any (v_done), 'complete_due_interviews skipped a due interview';
  assert (select status from public.scheduled_interviews where id = current_setting('test.i4')::uuid) = 'completed',
    'not completed';
end $$;

-- ================================================ block 5: scorecards (IVT-017)

-- I1 (app 1, completed 2 days ago, panel Ian + Ivo; Ivo has a draft).
select set_config('test.comp', (select plan_snapshot -> 'competencies' -> 0 ->> 'id' from public.scheduled_interviews
                                 where id = 'f1000000-0000-4000-8000-000000000001'), true);
set local role authenticated;
select pg_temp.act('c3000000-0000-4000-8000-000000000001');
do $$
declare
  v_comp text := current_setting('test.comp');
  v_res jsonb;
begin
  -- Refusals.
  perform pg_temp.expect(public.save_scorecard_draft('f1000000-0000-4000-8000-000000000001',
    jsonb_build_object(gen_random_uuid()::text, jsonb_build_object('rating', 'yes'))), 'invalid_ratings', 'an unknown competency');
  perform pg_temp.expect(public.save_scorecard_draft('f1000000-0000-4000-8000-000000000001',
    jsonb_build_object(v_comp, jsonb_build_object('rating', 'maybe'))), 'invalid_ratings', 'a rating outside the scale');
  perform pg_temp.expect(public.save_scorecard_draft('f1000000-0000-4000-8000-000000000001', '{}'::jsonb, null, repeat('x', 5001)),
    'invalid_note', 'a 5,001-char note');
  perform pg_temp.expect(public.submit_scorecard('f1000000-0000-4000-8000-000000000001'), 'missing_overall', 'submit without a card');

  -- Draft, then submit.
  v_res := pg_temp.expect(public.save_scorecard_draft('f1000000-0000-4000-8000-000000000001',
    jsonb_build_object(v_comp, jsonb_build_object('rating', 'strong_yes', 'note', 'Clear trade-offs')), 'yes', 'Good'),
    null, 'the first save');
  assert (select status = 'draft' and overall = 'yes' from public.interview_scorecards where id = (v_res ->> 'id')::uuid),
    'the draft wasn''t created';
  -- Another member's scorecard is invisible while blind (Ivo's draft).
  assert (select count(*) from public.interview_scorecards) = 1, 'a blind member read another scorecard';
  perform pg_temp.expect(public.submit_scorecard('f1000000-0000-4000-8000-000000000001'), null, 'submit');
  perform pg_temp.expect(public.submit_scorecard('f1000000-0000-4000-8000-000000000001'), 'already_submitted', 'submit twice');

  -- Locked: ratings and the overall; the notes change and are recorded.
  perform pg_temp.expect(public.save_scorecard_draft('f1000000-0000-4000-8000-000000000001',
    jsonb_build_object(v_comp, jsonb_build_object('rating', 'no', 'note', 'Clear trade-offs')), 'yes', 'Good'),
    'ratings_locked', 'change a rating after submitting');
  perform pg_temp.expect(public.save_scorecard_draft('f1000000-0000-4000-8000-000000000001',
    jsonb_build_object(v_comp, jsonb_build_object('rating', 'strong_yes', 'note', 'Clear trade-offs')), 'strong_yes', 'Good'),
    'ratings_locked', 'change the overall after submitting');
  perform pg_temp.expect(public.save_scorecard_draft('f1000000-0000-4000-8000-000000000001',
    jsonb_build_object(v_comp, jsonb_build_object('rating', 'strong_yes', 'note', 'Very clear trade-offs')), 'yes', 'Good, hire'),
    null, 'edit the notes');
  assert (select count(*) from public.interview_scorecard_edits) = 2, 'both note edits should be recorded';
end $$;
reset role;

do $$ begin
  assert exists (select 1 from public.application_events where type = 'scorecard_submitted'
                  and application_id = 'e0000000-0000-4000-8000-000000000001' and not (payload ? 'overall')),
    'the event must not carry the recommendation';
end $$;

-- After 24 h nothing changes.
update public.interview_scorecards set locked_at = now() - interval '1 minute'
 where interview_id = 'f1000000-0000-4000-8000-000000000001' and author_user_id = 'c3000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.act('c3000000-0000-4000-8000-000000000001');
do $$
declare
  v_comp text := current_setting('test.comp');
begin
  perform pg_temp.expect(public.save_scorecard_draft('f1000000-0000-4000-8000-000000000001',
    jsonb_build_object(v_comp, jsonb_build_object('rating', 'strong_yes', 'note', 'x')), 'yes', 'Good, hire'),
    'locked', 'edit after 24 h');
  -- Ian submitted: not blind any more, but has no scheduling.view, so he
  -- still can't read Ivo's (unsubmitted) card or anyone else's.
  assert (select count(*) from public.interview_scorecards) = 1, 'only his own card';
end $$;

-- Ivo: blind (his draft isn't submitted). Can't submit on a no-show.
select pg_temp.act('c3000000-0000-4000-8000-000000000002');
do $$ begin
  assert (select count(*) from public.interview_scorecards where author_user_id = 'c3000000-0000-4000-8000-000000000001') = 0,
    'a blind member read a submitted scorecard';
  perform pg_temp.expect(public.save_scorecard_draft('f1000000-0000-4000-8000-000000000002', '{}'::jsonb, 'yes'),
    'not_found', 'not on that panel');
end $$;

-- Rita (scheduling.view, not on I1's panel): not blind, reads submitted
-- cards only; list_interview_scorecards shows both seats.
select pg_temp.act('c2000000-0000-4000-8000-000000000001');
do $$
begin
  assert (select count(*) from public.interview_scorecards where application_id = 'e0000000-0000-4000-8000-000000000001') = 1,
    'a scheduler should read only the submitted card';
  assert (select count(*) from public.list_interview_scorecards('e0000000-0000-4000-8000-000000000001')) = 2, 'two seats';
  assert (select overall = 'yes' and content_visible from public.list_interview_scorecards('e0000000-0000-4000-8000-000000000001')
           where author_user_id = 'c3000000-0000-4000-8000-000000000001'), 'the submitted card''s content';
  assert (select status = 'draft' and not content_visible and overall is null
            from public.list_interview_scorecards('e0000000-0000-4000-8000-000000000001')
           where author_user_id = 'c3000000-0000-4000-8000-000000000002'), 'a draft must stay hidden';
end $$;
reset role;

-- Rita joins a scheduled interview on app 1: she's blind again.
insert into public.scheduled_interviews (id, company_id, job_post_id, application_id, name, duration_minutes, plan_snapshot,
  status, source, starts_at, ends_at)
values ('f1000000-0000-4000-8000-000000000005', current_setting('test.a')::uuid, 'b0000000-0000-4000-8000-000000000001',
        'e0000000-0000-4000-8000-000000000001', 'Onsite', 60, '{"competencies": []}', 'scheduled', 'manual',
        now() + interval '1 day', now() + interval '1 day 1 hour');
insert into public.scheduled_interview_panel (interview_id, user_id, company_id)
values ('f1000000-0000-4000-8000-000000000005', 'c2000000-0000-4000-8000-000000000001', current_setting('test.a')::uuid);
set local role authenticated;
select pg_temp.act('c2000000-0000-4000-8000-000000000001');
do $$ begin
  assert (select count(*) from public.interview_scorecards where application_id = 'e0000000-0000-4000-8000-000000000001') = 0,
    'a re-blinded member read a scorecard';
  assert (select not content_visible and status = 'submitted' from public.list_interview_scorecards('e0000000-0000-4000-8000-000000000001')
           where author_user_id = 'c3000000-0000-4000-8000-000000000001'), 'a blind member sees only who submitted';
  perform pg_temp.expect(public.submit_scorecard('f1000000-0000-4000-8000-000000000005'), 'not_started', 'submit before the start');
end $$;

-- Vera (scorecards.view_all) always reads submitted cards.
select pg_temp.act('c7000000-0000-4000-8000-000000000001');
do $$ begin
  assert (select count(*) from public.interview_scorecards where application_id = 'e0000000-0000-4000-8000-000000000001') = 1,
    'everyone''s feedback should read the submitted card';
  assert (select count(*) from public.interview_scorecard_edits) = 2, 'everyone''s feedback reads the edits';
end $$;

-- Company B reads nothing.
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$ begin
  assert (select count(*) from public.interview_scorecards) = 0, 'another company read scorecards';
  assert (select count(*) from public.list_interview_scorecards('e0000000-0000-4000-8000-000000000001')) = 0,
    'another company listed scorecards';
  assert (select count(*) from public.scheduled_interviews) = 0, 'another company read interviews';
end $$;
reset role;

-- ================================================ company time zone (IVT-024)
set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.update_company_settings('{"time_zone": "Asia/Kolkata"}'), null, 'owner sets the zone');
  perform pg_temp.expect(public.update_company_settings('{"time_zone": "Mars/Olympus"}'), 'invalid_input', 'unknown zone');
end $$;
select pg_temp.act('c3000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.update_company_settings('{"time_zone": "Europe/London"}'), 'forbidden', 'needs settings.scheduling');
end $$;
reset role;
do $$ begin
  assert (select time_zone from public.company_info where id = current_setting('test.a')::uuid) = 'Asia/Kolkata',
    'the zone wasn''t saved, or was overwritten';
end $$;

-- ================================================ block 6: the kit and "My interviews" (IVT-019, IVT-021)

set local role authenticated;
-- Ivo (no permissions, on I1's panel, 2 days after the end): kit access.
select pg_temp.act('c3000000-0000-4000-8000-000000000002');
do $$
declare
  v_kit jsonb := public.get_interview_kit('f1000000-0000-4000-8000-000000000001');
begin
  perform pg_temp.expect(v_kit, null, 'the kit');
  assert v_kit ->> 'access' = 'kit', 'full kit access';
  assert v_kit -> 'candidate' ->> 'name' = 'One', 'the candidate''s name';
  assert v_kit::text not like '%one@applicant.test%', 'the kit leaked an email';
  assert v_kit -> 'scorecard' ->> 'status' = 'draft', 'his own draft';
  assert jsonb_array_length(v_kit -> 'interview' -> 'competencies') = 1, 'the competencies';
  assert public.can_open_interview_kit('f1000000-0000-4000-8000-000000000001'), 'can open';
  perform pg_temp.expect(public.get_interview_kit('f1000000-0000-4000-8000-000000000002'), 'not_found', 'not on that panel');
  assert (select count(*) from public.list_my_interviews()) = 1, 'Ivo is on one interview';
  -- He can't read the tables, or the resume's storage path.
  assert (select count(*) from public.scheduled_interviews) = 0, 'a panel-only member read the table';
  assert pg_temp.denied($q$select public.interview_resume_source('f1000000-0000-4000-8000-000000000001')$q$),
    'interview_resume_source is for the service role';
end $$;

-- The interviewer picker: Pat (plans on A1) and Rita (schedules) list every
-- member; Ivo and Nora (neither) list nobody.
do $$ begin
  assert (select count(*) from public.list_interviewer_options()) = 0, 'Ivo listed interviewers';
end $$;
select pg_temp.act('c8000000-0000-4000-8000-000000000001');
do $$ begin
  assert (select count(*) from public.list_interviewer_options()) = 0, 'Nora listed interviewers';
end $$;
select pg_temp.act('c4000000-0000-4000-8000-000000000001');
do $$ begin
  assert (select count(*) from public.list_interviewer_options()) = 7, 'Pat lists the 7 members';
  assert exists (select 1 from public.list_interviewer_options() where name = 'Ivo'), 'by display name';
end $$;
select pg_temp.act('c2000000-0000-4000-8000-000000000001');
do $$ begin
  assert (select count(*) from public.list_interviewer_options()) = 7, 'Rita lists the 7 members';
end $$;

-- Ian: I2 ended 8 days ago, nothing submitted → expired.
select pg_temp.act('c3000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.get_interview_kit('f1000000-0000-4000-8000-000000000002'), 'expired', '8 days after the end');
end $$;
reset role;

-- After the window, only his own submitted scorecard (I1 moved to 8 days ago).
update public.scheduled_interviews set starts_at = now() - interval '9 days', ends_at = now() - interval '8 days 23 hours'
 where id = 'f1000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.act('c3000000-0000-4000-8000-000000000001');
do $$
declare
  v_kit jsonb := public.get_interview_kit('f1000000-0000-4000-8000-000000000001');
begin
  assert v_kit ->> 'access' = 'scorecard_only', 'expected scorecard_only, got ' || v_kit::text;
  assert not (v_kit ? 'candidate') and not (v_kit ? 'application'), 'the expired kit leaked the application';
end $$;
reset role;

-- Removed from the panel: access ends at once.
delete from public.scheduled_interview_panel
 where interview_id = 'f1000000-0000-4000-8000-000000000005' and user_id = 'c2000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.act('c2000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.get_interview_kit('f1000000-0000-4000-8000-000000000005'), 'not_found', 'removed from the panel');
end $$;
reset role;

-- Cancelled: access ends.
insert into public.scheduled_interview_panel (interview_id, user_id, company_id)
values ('f1000000-0000-4000-8000-000000000005', 'c3000000-0000-4000-8000-000000000002', current_setting('test.a')::uuid);
update public.scheduled_interviews set status = 'cancelled' where id = 'f1000000-0000-4000-8000-000000000005';
set local role authenticated;
select pg_temp.act('c3000000-0000-4000-8000-000000000002');
do $$ begin
  perform pg_temp.expect(public.get_interview_kit('f1000000-0000-4000-8000-000000000005'), 'expired', 'a cancelled interview');
end $$;
reset role;

-- Leaving the company: access ends.
update public.scheduled_interviews set status = 'scheduled' where id = 'f1000000-0000-4000-8000-000000000005';
delete from public.company_members where user_id = 'c3000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.act('c3000000-0000-4000-8000-000000000002');
do $$ begin
  assert not public.can_open_interview_kit('f1000000-0000-4000-8000-000000000005'), 'a former member opened the kit';
  assert (select count(*) from public.list_my_interviews()) = 0, 'a former member lists interviews';
end $$;
reset role;

-- ================================================ block 7: merges (IVT-023)

-- An imported application of Two's to A2 with an interview and a submitted
-- scorecard; Two then applies to A2 directly.
do $$
declare
  a uuid := current_setting('test.a')::uuid;
begin
  insert into public.company_candidates (id, company_id, full_name, email) values
    ('cc000000-0000-4000-8000-000000000001', a, 'Two', 'two@applicant.test');
  insert into public.applications (id, company_candidate_id, job_post_id, all_jobs_id, source) values
    ('e0000000-0000-4000-8000-000000000010', 'cc000000-0000-4000-8000-000000000001',
     'b0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003', 'imported');
  insert into public.scheduled_interviews (id, company_id, job_post_id, application_id, name, duration_minutes, plan_snapshot,
    status, source, starts_at, ends_at)
  values ('f1000000-0000-4000-8000-000000000010', a, 'b0000000-0000-4000-8000-000000000003',
          'e0000000-0000-4000-8000-000000000010', 'Imported chat', 30, '{"competencies": []}', 'completed', 'manual',
          now() - interval '1 day', now() - interval '23 hours');
  insert into public.scheduled_interview_panel (interview_id, user_id, company_id)
  values ('f1000000-0000-4000-8000-000000000010', 'c3000000-0000-4000-8000-000000000001', a);
  insert into public.interview_scorecards (interview_id, application_id, company_id, author_user_id, status, overall,
    submitted_at, locked_at)
  values ('f1000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000010', a,
          'c3000000-0000-4000-8000-000000000001', 'submitted', 'strong_yes', now(), now() + interval '1 day');

end $$;

do $$
declare
  a uuid := current_setting('test.a')::uuid;
begin
  insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id) values
    ('e0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000002',
     'b0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003');
  -- The apply trigger may already have merged them (it matches by email).
  if (select merged_into_application_id from public.applications where id = 'e0000000-0000-4000-8000-000000000010') is null then
    perform public.merge_imported_application('e0000000-0000-4000-8000-000000000010',
      'e0000000-0000-4000-8000-000000000011');
  end if;
  assert (select application_id from public.scheduled_interviews where id = 'f1000000-0000-4000-8000-000000000010')
       = 'e0000000-0000-4000-8000-000000000011', 'the interview didn''t follow the merge';
  assert (select application_id from public.interview_scorecards where interview_id = 'f1000000-0000-4000-8000-000000000010')
       = 'e0000000-0000-4000-8000-000000000011', 'the scorecard didn''t follow the merge';
end $$;

set local role authenticated;
select pg_temp.act('c7000000-0000-4000-8000-000000000001');
do $$ begin
  assert (select count(*) from public.list_interview_scorecards('e0000000-0000-4000-8000-000000000011')) = 1,
    'the survivor lists the moved scorecard';
  assert (select count(*) from public.list_interview_scorecards('e0000000-0000-4000-8000-000000000010')) = 0,
    'the merged application keeps nothing';
end $$;
reset role;

-- The claim path: an imported A1 application with an interview, claimed by
-- One, who already applied to A1 directly. claim_company_candidate merges it
-- and the interview follows.
do $$
declare
  a uuid := current_setting('test.a')::uuid;
begin
  insert into public.company_candidates (id, company_id, full_name, email) values
    ('cc000000-0000-4000-8000-000000000002', a, 'One (imported)', 'one-elsewhere@example.test');
  insert into public.applications (id, company_candidate_id, job_post_id, all_jobs_id, source) values
    ('e0000000-0000-4000-8000-000000000020', 'cc000000-0000-4000-8000-000000000002',
     'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'imported');
  insert into public.scheduled_interviews (id, company_id, job_post_id, application_id, name, duration_minutes, plan_snapshot,
    status, source, starts_at, ends_at)
  values ('f1000000-0000-4000-8000-000000000020', a, 'b0000000-0000-4000-8000-000000000001',
          'e0000000-0000-4000-8000-000000000020', 'Imported screen', 30, '{"competencies": []}', 'scheduled', 'manual',
          now() + interval '1 day', now() + interval '1 day 30 minutes');
  insert into public.company_candidate_claims (token_hash, company_id, candidate_id, expires_at)
  values (encode(sha256(convert_to('claim-token-for-recruiter-interviews', 'UTF8')), 'hex'), a,
          'cc000000-0000-4000-8000-000000000002', now() + interval '1 day');
end $$;

set local role authenticated;
select pg_temp.act('a0000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.claim_company_candidate('claim-token-for-recruiter-interviews'), null, 'the claim');
end $$;
reset role;
do $$ begin
  assert (select merged_into_application_id from public.applications where id = 'e0000000-0000-4000-8000-000000000020')
       = 'e0000000-0000-4000-8000-000000000001', 'the claim didn''t merge';
  assert (select application_id from public.scheduled_interviews where id = 'f1000000-0000-4000-8000-000000000020')
       = 'e0000000-0000-4000-8000-000000000001', 'the interview didn''t follow the claim';
end $$;

-- ================================================ block 8: calendar schema (IVT-032)

-- Rita (connected), Ian (connection in error). Owen never connected.
insert into public.calendar_connections (id, user_id, company_id, provider, account_email, scopes, status) values
  ('ca000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000001', 'google', 'rita@acme.test', '{calendar.events,calendar.freebusy}', 'active'),
  ('ca000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000001', 'google', 'ian@acme.test', '{calendar.events,calendar.freebusy}', 'error');
insert into public.calendar_tokens (connection_id, refresh_token_enc, access_token_enc, access_token_expires_at, key_version) values
  ('ca000000-0000-4000-8000-000000000001', 'v1:aXY=:cmVmcmVzaA==', 'v1:aXY=:YWNjZXNz', now() + interval '1 hour', 1),
  ('ca000000-0000-4000-8000-000000000002', 'v1:aXY=:aWFuLXJlZnJlc2g=', null, null, 1);

do $$
begin
  assert not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'calendar_connections' and column_name ~ 'token'
  ), 'calendar_connections must not hold tokens';
  begin
    insert into public.calendar_connections (user_id, company_id, provider, account_email, status)
    values ('c2000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'google', 'x@acme.test', 'active');
    raise exception 'a second google connection for Rita was allowed';
  exception when unique_violation then null;
  end;
end $$;

set local role authenticated;
select pg_temp.act('c2000000-0000-4000-8000-000000000001');
do $$ begin
  assert (select count(*) from public.calendar_connections) = 1, 'Rita reads only her own connection';
  assert (select account_email from public.calendar_connections) = 'rita@acme.test', 'Rita''s own row';
  assert pg_temp.denied('select * from public.calendar_tokens'), 'authenticated must not read calendar_tokens';
  assert pg_temp.denied($q$insert into public.calendar_connections (user_id, company_id, provider, account_email, status)
    values ('c2000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'google', 'y@acme.test', 'active')$q$),
    'members can''t write connections';
  assert pg_temp.denied($q$update public.calendar_connections set status = 'active'$q$), 'members can''t update connections';
end $$;

-- Availability: own row only, zone and hours checked.
select pg_temp.act('c3000000-0000-4000-8000-000000000001');
do $$ begin
  insert into public.member_availability (user_id, company_id, time_zone, working_hours) values
    ('c3000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Europe/London',
     '{"mon": {"start": "09:00", "end": "17:00"}, "fri": {"start": "09:30", "end": "12:00"}}');
  update public.member_availability set time_zone = 'Asia/Kolkata' where user_id = 'c3000000-0000-4000-8000-000000000001';
  assert (select time_zone from public.member_availability) = 'Asia/Kolkata', 'Ian edits his own row';
  assert pg_temp.denied($q$insert into public.member_availability (user_id, company_id, time_zone, working_hours)
    values ('c2000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'UTC', '{}')$q$),
    'Ian can''t write Rita''s availability';
  assert pg_temp.denied($q$insert into public.member_availability (user_id, company_id, time_zone, working_hours)
    values ('c3000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'UTC', '{}')$q$),
    'Ian can''t write availability for a company he isn''t in';
  begin
    update public.member_availability set time_zone = 'Mars/Olympus' where user_id = 'c3000000-0000-4000-8000-000000000001';
    raise exception 'an unknown time zone was allowed';
  exception when check_violation then null;
  end;
  begin
    update public.member_availability set working_hours = '{"mon": {"start": "18:00", "end": "10:00"}}'
     where user_id = 'c3000000-0000-4000-8000-000000000001';
    raise exception 'an end before the start was allowed';
  exception when check_violation then null;
  end;
  begin
    update public.member_availability set working_hours = '{"someday": {"start": "09:00", "end": "10:00"}}'
     where user_id = 'c3000000-0000-4000-8000-000000000001';
    raise exception 'an unknown weekday was allowed';
  exception when check_violation then null;
  end;
  begin
    update public.member_availability set working_hours = '{"tue": {"start": "9am", "end": "10:00"}}'
     where user_id = 'c3000000-0000-4000-8000-000000000001';
    raise exception 'a malformed time was allowed';
  exception when check_violation then null;
  end;
end $$;
select pg_temp.act('c2000000-0000-4000-8000-000000000001');
do $$ begin
  assert (select count(*) from public.member_availability) = 0, 'Rita can''t read Ian''s availability';
end $$;

-- The scheduler's badges: connected | error | unknown, members of the job's company only.
do $$
declare
  v jsonb;
begin
  select jsonb_object_agg(user_id, status) into v
    from public.panel_calendar_status('b0000000-0000-4000-8000-000000000001', array[
      'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001',
      'c1000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002',
      'c1000000-0000-4000-8000-000000000002']::uuid[]);
  -- Owen never connected; Ivo left the company in block 6 and Bea is in another.
  assert v = jsonb_build_object(
    'c2000000-0000-4000-8000-000000000001', 'connected',
    'c3000000-0000-4000-8000-000000000001', 'error',
    'c1000000-0000-4000-8000-000000000001', 'unknown'), format('panel_calendar_status: %s', v);
  assert (select count(*) from public.panel_calendar_status('b0000000-0000-4000-8000-000000000002',
    array['c1000000-0000-4000-8000-000000000002']::uuid[])) = 0, 'another company''s job answers nothing';
end $$;
select pg_temp.act('c3000000-0000-4000-8000-000000000001');
do $$ begin
  assert (select count(*) from public.panel_calendar_status('b0000000-0000-4000-8000-000000000001',
    array['c2000000-0000-4000-8000-000000000001']::uuid[])) = 0, 'panel_calendar_status needs scheduling.manage';
end $$;
reset role;

set local role anon;
select pg_temp.act(null);
do $$ begin
  assert pg_temp.denied('select * from public.calendar_connections'), 'anon reads no connections';
  assert pg_temp.denied('select * from public.member_availability'), 'anon reads no availability';
  assert pg_temp.denied('select * from public.calendar_tokens'), 'anon reads no tokens';
end $$;
reset role;

-- Leaving the company deletes the member's connection and availability, and
-- keeps the encrypted refresh token only until it's revoked at Google.
delete from public.company_members where user_id = 'c3000000-0000-4000-8000-000000000001';
do $$ begin
  assert not exists (select 1 from public.calendar_connections where user_id = 'c3000000-0000-4000-8000-000000000001'),
    'Ian''s connection survived his leaving';
  assert not exists (select 1 from public.calendar_tokens where connection_id = 'ca000000-0000-4000-8000-000000000002'),
    'Ian''s tokens survived his leaving';
  assert not exists (select 1 from public.member_availability where user_id = 'c3000000-0000-4000-8000-000000000001'),
    'Ian''s availability survived his leaving';
  assert (select refresh_token_enc from public.calendar_pending_revocations
           where connection_id = 'ca000000-0000-4000-8000-000000000002'
             and user_id = 'c3000000-0000-4000-8000-000000000001') = 'v1:aXY=:aWFuLXJlZnJlc2g=',
    'Ian''s refresh token wasn''t queued for revocation';
end $$;
-- A connection deleted after its tokens (a disconnect that already revoked) queues nothing.
delete from public.calendar_tokens where connection_id = 'ca000000-0000-4000-8000-000000000001';
delete from public.calendar_connections where id = 'ca000000-0000-4000-8000-000000000001';
do $$ begin
  assert not exists (select 1 from public.calendar_pending_revocations
                      where connection_id = 'ca000000-0000-4000-8000-000000000001'),
    'a revoked disconnect queued a revocation';
end $$;
set local role authenticated;
select pg_temp.act('c2000000-0000-4000-8000-000000000001');
do $$ begin
  assert pg_temp.denied('select * from public.calendar_pending_revocations'), 'members can''t read pending revocations';
end $$;
reset role;

-- ================================================ block 9: booking (IVT-043)

-- Rita reconnects (block 8 disconnected her). Two imported candidates on A1:
-- one opted out of email, one with no email (D20).
insert into public.calendar_connections (id, user_id, company_id, provider, account_email, status) values
  ('ca000000-0000-4000-8000-000000000011', 'c2000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000001', 'google', 'rita@acme.test', 'active');
insert into public.company_candidates (id, company_id, full_name, email, email_opted_out_at) values
  ('cc000000-0000-4000-8000-000000000031', 'c0000000-0000-4000-8000-000000000001', 'Opted Out', 'out@example.test', now()),
  ('cc000000-0000-4000-8000-000000000032', 'c0000000-0000-4000-8000-000000000001', 'No Email', null, null);
insert into public.applications (id, company_candidate_id, job_post_id, all_jobs_id, source) values
  ('e0000000-0000-4000-8000-000000000031', 'cc000000-0000-4000-8000-000000000031',
   'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'imported'),
  ('e0000000-0000-4000-8000-000000000032', 'cc000000-0000-4000-8000-000000000032',
   'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'imported');

set local role authenticated;
select pg_temp.act('c2000000-0000-4000-8000-000000000001');
do $$
declare
  v jsonb;
  v_row public.scheduled_interviews%rowtype;
begin
  v := pg_temp.expect(public.book_interview(
    p_application_id => 'e0000000-0000-4000-8000-000000000001',
    p_panel => array['c2000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001']::uuid[],
    p_starts_at => date_trunc('hour', now()) + interval '3 days',
    p_name => 'Booked screen', p_duration_minutes => 45, p_time_zone => 'Europe/London'), null, 'book');
  assert (v ->> 'candidate_is_attendee')::boolean, 'an applicant with an email is an attendee';
  perform set_config('test.booked', v ->> 'id', true);
  select * into v_row from public.scheduled_interviews where id = (v ->> 'id')::uuid;
  assert v_row.status = 'scheduled' and v_row.source = 'booked', format('booked row: %s %s', v_row.status, v_row.source);
  assert v_row.organizer_user_id = 'c2000000-0000-4000-8000-000000000001', 'the booking member organizes';
  assert v_row.time_zone = 'Europe/London', 'the time zone is stored';
  assert v_row.provider_event_id is null, 'no event until Google answers';
  assert (select payload ->> 'source' from public.application_events
           where type = 'meeting_scheduled' and payload ->> 'scheduled_interview_id' = v_row.id::text) = 'booked',
    'the timeline says booked';

  v := pg_temp.expect(public.book_interview(
    p_application_id => 'e0000000-0000-4000-8000-000000000031',
    p_panel => array['c2000000-0000-4000-8000-000000000001']::uuid[],
    p_starts_at => date_trunc('hour', now()) + interval '3 days', p_name => 'x', p_duration_minutes => 30), null,
    'book opted out');
  assert not (v ->> 'candidate_is_attendee')::boolean, 'an opted-out candidate is never an attendee (D20)';
  v := pg_temp.expect(public.book_interview(
    p_application_id => 'e0000000-0000-4000-8000-000000000032',
    p_panel => array['c2000000-0000-4000-8000-000000000001']::uuid[],
    p_starts_at => date_trunc('hour', now()) + interval '3 days', p_name => 'x', p_duration_minutes => 30), null,
    'book no email');
  assert not (v ->> 'candidate_is_attendee')::boolean, 'a candidate without an email is never an attendee (D20)';

  perform pg_temp.expect(public.book_interview(
    p_application_id => 'e0000000-0000-4000-8000-000000000001',
    p_panel => array['c2000000-0000-4000-8000-000000000001']::uuid[],
    p_starts_at => now() - interval '1 hour', p_name => 'x', p_duration_minutes => 30), 'invalid_time', 'book in the past');
  perform pg_temp.expect(public.book_interview(
    p_application_id => 'e0000000-0000-4000-8000-000000000001',
    p_panel => array['c2000000-0000-4000-8000-000000000001']::uuid[],
    p_starts_at => now() + interval '3 days', p_name => 'x', p_duration_minutes => 30, p_time_zone => 'Mars/Olympus'),
    'invalid_time_zone', 'book with an unknown zone');
  assert pg_temp.denied($q$select public.interview_event_details('00000000-0000-4000-8000-000000000000')$q$),
    'members can''t read event details (panel emails)';
  assert public.interview_candidate_invitable('e0000000-0000-4000-8000-000000000001'), 'an applicant is invitable';
  assert not public.interview_candidate_invitable('e0000000-0000-4000-8000-000000000031'), 'opted out: not invitable';
  assert not public.interview_candidate_invitable('e0000000-0000-4000-8000-000000000032'), 'no email: not invitable';
end $$;

-- An organizer without a connection can't book. Owen never connected.
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.book_interview(
    p_application_id => 'e0000000-0000-4000-8000-000000000001',
    p_panel => array['c1000000-0000-4000-8000-000000000001']::uuid[],
    p_starts_at => now() + interval '3 days', p_name => 'x', p_duration_minutes => 30), 'not_connected', 'book unconnected');
end $$;
-- Vera can see interviews but not schedule them.
select pg_temp.act('c7000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.book_interview(
    p_application_id => 'e0000000-0000-4000-8000-000000000001',
    p_panel => array['c7000000-0000-4000-8000-000000000001']::uuid[],
    p_starts_at => now() + interval '3 days', p_name => 'x', p_duration_minutes => 30), 'forbidden', 'book without scheduling.manage');
  assert public.interview_candidate_invitable('e0000000-0000-4000-8000-000000000001') is null,
    'interview_candidate_invitable needs scheduling.manage';
end $$;
reset role;

-- Recording manually still works the same way after the refactor.
set local role authenticated;
select pg_temp.act('c2000000-0000-4000-8000-000000000001');
do $$
declare
  v jsonb;
begin
  v := pg_temp.expect(public.record_interview(
    p_application_id => 'e0000000-0000-4000-8000-000000000032',
    p_panel => array['c2000000-0000-4000-8000-000000000001']::uuid[],
    p_starts_at => now() + interval '2 days', p_name => 'Phone call', p_duration_minutes => 30), null, 'record');
  assert (select source from public.scheduled_interviews where id = (v ->> 'id')::uuid) = 'manual', 'recorded is manual';
  assert (select organizer_user_id from public.scheduled_interviews where id = (v ->> 'id')::uuid) is null,
    'nothing is on anyone''s calendar for a manual interview';
end $$;
reset role;

-- The event details (service role): the panel's addresses, and the
-- candidate's only when they're an attendee.
do $$
declare
  v jsonb := public.interview_event_details(current_setting('test.booked')::uuid);
begin
  assert v ->> 'candidate_email' = 'one@applicant.test', format('candidate email: %s', v);
  assert v ->> 'job_title' = 'A1' and v ->> 'company_name' = 'Acme', format('job and company: %s', v);
  assert v ->> 'organizer_user_id' = 'c2000000-0000-4000-8000-000000000001', 'organizer';
  assert (v ->> 'organizer_connection_id') = 'ca000000-0000-4000-8000-000000000011', 'organizer connection';
  assert (select array_agg(p ->> 'email' order by p ->> 'email') from jsonb_array_elements(v -> 'panel') p)
       = array['rita@acme.test', 'vera@acme.test'], format('panel: %s', v -> 'panel');
  v := public.interview_event_details((select id from public.scheduled_interviews
                                         where application_id = 'e0000000-0000-4000-8000-000000000031' limit 1));
  assert v ->> 'candidate_email' is null, 'an opted-out candidate''s address isn''t handed out';
end $$;

-- ================================================ block 10: sync and the calendar ops queue (IVT-046/047)

set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$ begin
  assert pg_temp.denied(format('select public.cancel_interview_as_system(%L, %L)', current_setting('test.booked'), 'calendar')),
    'members can''t call the system cancel';
  assert pg_temp.denied(format('select public.move_interview_from_calendar(%L, now(), now() + interval ''1 hour'')',
    current_setting('test.booked'))), 'members can''t call the calendar move';
  assert pg_temp.denied('select public.expire_interview_links()'), 'members can''t expire links';
  assert pg_temp.denied('select * from pgmq.q_interview_calendar_ops'), 'members can''t read the calendar ops queue';
end $$;
reset role;

do $$
declare
  v jsonb;
  v_id uuid := current_setting('test.booked')::uuid;
  v_start timestamptz := date_trunc('hour', now()) + interval '4 days';
begin
  -- Moved in Google Calendar: GetHired follows and says so.
  v := public.move_interview_from_calendar(v_id, v_start, v_start + interval '45 minutes');
  assert (v ->> 'applied')::boolean, format('move: %s', v);
  assert (select starts_at from public.scheduled_interviews where id = v_id) = v_start, 'the time followed Google';
  assert (select payload ->> 'source' from public.application_events
           where type = 'meeting_rescheduled' and payload ->> 'scheduled_interview_id' = v_id::text) = 'calendar',
    'the timeline says it moved in the calendar';
  -- The same time again changes nothing.
  assert not (public.move_interview_from_calendar(v_id, v_start, v_start + interval '45 minutes') ->> 'applied')::boolean,
    'an unchanged time isn''t a move';

  -- Deleted in Google Calendar: cancelled once.
  v := public.cancel_interview_as_system(v_id, 'calendar');
  assert (v ->> 'applied')::boolean and v ->> 'application_id' = 'e0000000-0000-4000-8000-000000000001', format('cancel: %s', v);
  assert (select status from public.scheduled_interviews where id = v_id) = 'cancelled', 'cancelled';
  assert (select payload ->> 'reason' from public.application_events
           where type = 'meeting_cancelled' and payload ->> 'scheduled_interview_id' = v_id::text) = 'calendar',
    'the timeline says why';
  assert not (public.cancel_interview_as_system(v_id, 'calendar') ->> 'applied')::boolean, 'a second cancel is a no-op';
  assert not (public.move_interview_from_calendar(v_id, v_start, v_start + interval '1 hour') ->> 'applied')::boolean,
    'a cancelled interview doesn''t move';

  -- Self-scheduling links past their expiry are cancelled (phase 3 rows).
  insert into public.scheduled_interviews (id, company_id, job_post_id, application_id, name, duration_minutes,
    status, source, booking_token_hash, booking_token_expires_at) values
    ('f1000000-0000-4000-8000-000000000040', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000002', 'Link', 30, 'awaiting_candidate', 'link', repeat('a', 64), now() - interval '1 minute'),
    ('f1000000-0000-4000-8000-000000000041', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000002', 'Link', 30, 'awaiting_candidate', 'link', repeat('b', 64), now() + interval '1 day');
  assert (select array_agg(x) from public.expire_interview_links() x) = array['f1000000-0000-4000-8000-000000000040'::uuid],
    'only the expired link is cancelled';
  assert (select status from public.scheduled_interviews where id = 'f1000000-0000-4000-8000-000000000041') = 'awaiting_candidate',
    'a live link stays';

  -- The ops queue takes a delete for an event whose organizer can act later;
  -- an interview without an event queues nothing.
  perform public.queue_interview_calendar_op('f1000000-0000-4000-8000-000000000041', 'delete');
  assert (select count(*) from pgmq.q_interview_calendar_ops) = 0, 'no event, nothing queued';
  update public.scheduled_interviews set provider_event_id = 'evt_booked' where id = v_id;
  perform public.queue_interview_calendar_op(v_id, 'delete');
  assert (select count(*) from pgmq.q_interview_calendar_ops
           where message ->> 'interview_id' = v_id::text and message ->> 'op' = 'delete') = 1, 'the delete was queued';
end $$;

-- ================================================ block 11: self-scheduling links (IVT-060)

select set_config('test.tok', 'link-token-' || repeat('a', 32), true),
       set_config('test.tok2', 'link-token-' || repeat('b', 32), true);
-- Vera's connection is in error; Nora never connected.
insert into public.calendar_connections (user_id, company_id, provider, account_email, status) values
  ('c7000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'google', 'vera@acme.test', 'error');

set local role authenticated;
select pg_temp.act('c2000000-0000-4000-8000-000000000001');
do $$
declare
  v jsonb;
  v_row public.scheduled_interviews%rowtype;
  h text := encode(sha256(convert_to(current_setting('test.tok'), 'UTF8')), 'hex');
begin
  -- IV-REQ-012: every panel member must be connected.
  perform pg_temp.expect(public.create_scheduling_link(
    p_application_id => 'e0000000-0000-4000-8000-000000000002',
    p_panel => array['c2000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001']::uuid[],
    p_token_hash => h, p_name => 'Intro call', p_duration_minutes => 30), 'panel_not_connected', 'link with Vera (error)');
  perform pg_temp.expect(public.create_scheduling_link(
    p_application_id => 'e0000000-0000-4000-8000-000000000002',
    p_panel => array['c8000000-0000-4000-8000-000000000001']::uuid[],
    p_token_hash => h, p_name => 'Intro call', p_duration_minutes => 30), 'panel_not_connected', 'link with Nora (never)');
  -- D20: no link for a candidate who can't be emailed.
  perform pg_temp.expect(public.create_scheduling_link(
    p_application_id => 'e0000000-0000-4000-8000-000000000031',
    p_panel => array['c2000000-0000-4000-8000-000000000001']::uuid[],
    p_token_hash => h, p_name => 'x', p_duration_minutes => 30), 'no_candidate_email', 'link opted out');
  perform pg_temp.expect(public.create_scheduling_link(
    p_application_id => 'e0000000-0000-4000-8000-000000000032',
    p_panel => array['c2000000-0000-4000-8000-000000000001']::uuid[],
    p_token_hash => h, p_name => 'x', p_duration_minutes => 30), 'no_candidate_email', 'link no email');
  perform pg_temp.expect(public.create_scheduling_link(
    p_application_id => 'e0000000-0000-4000-8000-000000000002',
    p_panel => array['c2000000-0000-4000-8000-000000000001']::uuid[],
    p_token_hash => 'not-a-hash', p_name => 'x', p_duration_minutes => 30), 'invalid_token', 'link bad hash');

  v := pg_temp.expect(public.create_scheduling_link(
    p_application_id => 'e0000000-0000-4000-8000-000000000002',
    p_panel => array['c2000000-0000-4000-8000-000000000001']::uuid[],
    p_token_hash => h, p_name => 'Intro call', p_duration_minutes => 30, p_time_zone => 'Europe/Paris'), null, 'link');
  perform set_config('test.link', v ->> 'id', true);
  select * into v_row from public.scheduled_interviews where id = (v ->> 'id')::uuid;
  assert v_row.status = 'awaiting_candidate' and v_row.source = 'link', format('link row: %s %s', v_row.status, v_row.source);
  assert v_row.starts_at is null and v_row.provider_event_id is null, 'no time and no event yet';
  assert v_row.organizer_user_id = 'c2000000-0000-4000-8000-000000000001', 'the sender organizes (D15)';
  assert v_row.candidate_is_attendee, 'the candidate will be invited';
  assert v_row.booking_token_hash = h, 'only the hash is stored';
  assert v_row.booking_token_expires_at between now() + interval '7 days' - interval '1 minute'
                                            and now() + interval '7 days' + interval '1 minute', 'the link lives 7 days';
  assert v_row.booking_link_sent_at is not null, 'sent_at';
  assert (select payload ->> 'status' from public.application_events
           where type = 'meeting_scheduled' and payload ->> 'scheduled_interview_id' = v_row.id::text) = 'awaiting_candidate',
    'the timeline says a link went out';
end $$;

-- Vera can't send links; Owen (owner) isn't connected.
select pg_temp.act('c7000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.create_scheduling_link(
    p_application_id => 'e0000000-0000-4000-8000-000000000002',
    p_panel => array['c2000000-0000-4000-8000-000000000001']::uuid[],
    p_token_hash => repeat('c', 64), p_name => 'x', p_duration_minutes => 30), 'forbidden', 'link without scheduling.manage');
  perform pg_temp.expect(public.renew_scheduling_link(current_setting('test.link')::uuid, repeat('c', 64)),
    'forbidden', 'renew without scheduling.manage');
end $$;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.create_scheduling_link(
    p_application_id => 'e0000000-0000-4000-8000-000000000002',
    p_panel => array['c2000000-0000-4000-8000-000000000001']::uuid[],
    p_token_hash => repeat('c', 64), p_name => 'x', p_duration_minutes => 30), 'not_connected', 'link from an unconnected sender');
  -- The candidate's changes, the slots context, the cache and the rate
  -- limit are the server's; members can't call them either.
  assert pg_temp.denied(format('select public.book_by_token(%L, now() + interval ''3 days'')', current_setting('test.tok'))),
    'members can''t book by token';
  assert pg_temp.denied(format('select public.scheduling_link_context(%L)', current_setting('test.tok'))),
    'members can''t read the link context';
end $$;
reset role;

-- The public page (anon): what it shows, and nothing else.
set local role anon;
select pg_temp.act(null);
do $$
declare
  v jsonb := public.resolve_scheduling_token(current_setting('test.tok'));
  v_count int;
begin
  assert (v ->> 'ok')::boolean, format('resolve: %s', v);
  assert v ->> 'status' = 'awaiting_candidate' and v ->> 'interview_name' = 'Intro call', format('resolve: %s', v);
  assert v ->> 'job_title' = 'A1' and v ->> 'company_name' = 'Acme', format('job and company: %s', v);
  assert (v ->> 'duration_minutes')::int = 30, 'duration';
  assert v -> 'interviewers' = '["Rita"]'::jsonb, format('interviewers by display name: %s', v -> 'interviewers');
  assert v::text !~ '@', format('no address on the public page: %s', v);
  assert v::text !~ 'c2000000', 'no member ids on the public page';
  assert not (v ->> 'can_change')::boolean, 'nothing to change before booking';
  assert public.resolve_scheduling_token('link-token-' || repeat('z', 32)) ->> 'reason' = 'not_found', 'unknown token';
  assert public.resolve_scheduling_token('short') ->> 'reason' = 'not_found', 'short token';
  assert public.resolve_scheduling_token(null) ->> 'reason' = 'not_found', 'null token';

  assert pg_temp.denied(format('select public.book_by_token(%L, now() + interval ''3 days'')', current_setting('test.tok'))),
    'anon can''t book directly (the route checks free/busy first)';
  assert pg_temp.denied(format('select public.reschedule_by_token(%L, now() + interval ''3 days'')', current_setting('test.tok'))),
    'anon can''t reschedule directly';
  assert pg_temp.denied(format('select public.cancel_by_token(%L)', current_setting('test.tok'))), 'anon can''t cancel directly';
  assert pg_temp.denied(format('select public.scheduling_link_context(%L)', current_setting('test.tok'))),
    'anon can''t read the link context';
  assert pg_temp.denied(format('select public.save_scheduling_slots(%L, ''[]'')', current_setting('test.link'))),
    'anon can''t write the slots cache';
  assert pg_temp.denied($q$select public.take_scheduling_link_hit('ip:x', 10, 60)$q$), 'anon can''t touch the rate limit';
  assert pg_temp.denied(format('select public.return_interview_to_link(%L, ''x'')', current_setting('test.link'))),
    'anon can''t unbook';
  assert pg_temp.denied($q$select public.scheduling_token_hash('x')$q$), 'anon can''t call the hash helper';
  assert pg_temp.denied('select * from public.scheduling_link_hits'), 'anon can''t read the hits';
  begin
    select count(*) into v_count from public.scheduled_interviews;
    assert v_count = 0, 'anon reads no interviews';
  exception when insufficient_privilege then null;
  end;
  begin
    select count(*) into v_count from public.scheduled_interview_panel;
    assert v_count = 0, 'anon reads no panels';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- The server's side (service role).
do $$
declare
  v jsonb;
  v_id uuid := current_setting('test.link')::uuid;
  v_tok text := current_setting('test.tok');
  v_start timestamptz := date_trunc('hour', now()) + interval '3 days';
  v_row public.scheduled_interviews%rowtype;
begin
  -- The slots context and the 2-minute cache.
  v := public.scheduling_link_context(v_tok);
  assert v ->> 'id' = v_id::text and v -> 'panel' = '["c2000000-0000-4000-8000-000000000001"]'::jsonb, format('context: %s', v);
  assert (v ->> 'duration_minutes')::int = 30 and v -> 'cached_slots' = 'null'::jsonb, format('no cache yet: %s', v);
  perform public.save_scheduling_slots(v_id, '[{"start":"2030-01-01T10:00:00Z","end":"2030-01-01T10:30:00Z"}]');
  assert jsonb_array_length(public.scheduling_link_context(v_tok) -> 'cached_slots') = 1, 'fresh slots come from the cache';
  update public.scheduled_interviews set slots_cached_at = now() - interval '3 minutes' where id = v_id;
  assert public.scheduling_link_context(v_tok) -> 'cached_slots' = 'null'::jsonb, 'slots older than 2 minutes aren''t used';
  assert public.scheduling_link_context('link-token-' || repeat('z', 32)) is null, 'no context for an unknown token';
  perform public.save_scheduling_slots(v_id, '[]');

  -- Booking: a time past the 4-hour cutoff and within the horizon.
  perform pg_temp.expect(public.book_by_token(v_tok, now() + interval '1 hour'), 'invalid_time', 'book too soon');
  perform pg_temp.expect(public.book_by_token(v_tok, now() + interval '20 days'), 'invalid_time', 'book too far');
  perform pg_temp.expect(public.book_by_token('link-token-' || repeat('z', 32), v_start), 'not_found', 'book unknown');
  v := pg_temp.expect(public.book_by_token(v_tok, v_start, 'America/New_York'), null, 'book');
  assert v ->> 'application_id' = 'e0000000-0000-4000-8000-000000000002', format('book: %s', v);
  select * into v_row from public.scheduled_interviews where id = v_id;
  assert v_row.status = 'scheduled' and v_row.starts_at = v_start and v_row.ends_at = v_start + interval '30 minutes',
    format('booked: %s %s', v_row.status, v_row.starts_at);
  assert v_row.time_zone = 'America/New_York', 'the candidate''s zone';
  assert v_row.booking_token_expires_at = v_row.ends_at, 'a booked link lives until the interview ends';
  assert v_row.slots_cache is null, 'booking clears the cached slots';
  assert (select count(*) from public.application_events
           where type = 'meeting_scheduled' and payload ->> 'scheduled_interview_id' = v_id::text
             and payload ->> 'by' = 'candidate' and actor_user_id is null) = 1, 'the timeline says the candidate booked';
  perform pg_temp.expect(public.book_by_token(v_tok, v_start + interval '1 day'), 'already_booked', 'book twice');
  v := public.resolve_scheduling_token(v_tok);
  assert v ->> 'status' = 'scheduled' and (v ->> 'can_change')::boolean, format('resolve booked: %s', v);
  assert (v ->> 'starts_at')::timestamptz = v_start, 'the current slot';

  -- Rescheduling moves the time and the link's life with it.
  perform pg_temp.expect(public.reschedule_by_token(v_tok, v_start), 'same_time', 'reschedule to the same time');
  perform pg_temp.expect(public.reschedule_by_token(v_tok, now() + interval '2 hours'), 'invalid_time', 'reschedule too soon');
  v := pg_temp.expect(public.reschedule_by_token(v_tok, v_start + interval '1 day'), null, 'reschedule');
  assert (v ->> 'previous_starts_at')::timestamptz = v_start, format('reschedule: %s', v);
  select * into v_row from public.scheduled_interviews where id = v_id;
  assert v_row.starts_at = v_start + interval '1 day' and v_row.booking_token_expires_at = v_row.ends_at, 'moved';
  assert (select payload ->> 'by' from public.application_events
           where type = 'meeting_rescheduled' and payload ->> 'scheduled_interview_id' = v_id::text) = 'candidate',
    'the timeline says the candidate moved it';
  -- A recruiter's move keeps the link alive until the new end too.
  update public.scheduled_interviews set starts_at = v_start + interval '2 days', ends_at = v_start + interval '2 days 30 minutes'
   where id = v_id;
  assert (select booking_token_expires_at from public.scheduled_interviews where id = v_id) = v_start + interval '2 days 30 minutes',
    'any move keeps the expiry at the end';

  -- Cancelling returns it to the candidate: the link works again.
  update public.scheduled_interviews set provider_event_id = 'evt_link', meeting_url = 'https://meet.google.com/abc-defg-hij'
   where id = v_id;
  update public.scheduled_interview_panel set response = 'accepted' where interview_id = v_id;
  v := pg_temp.expect(public.cancel_by_token(v_tok), null, 'cancel');
  assert v ->> 'provider_event_id' = 'evt_link', format('the event to delete: %s', v);
  select * into v_row from public.scheduled_interviews where id = v_id;
  assert v_row.status = 'awaiting_candidate' and v_row.starts_at is null and v_row.provider_event_id is null
     and v_row.meeting_url is null, format('back to awaiting: %s', v_row.status);
  assert v_row.booking_token_expires_at >= now() + interval '2 days' - interval '1 minute', 'open to rebook';
  assert (select response from public.scheduled_interview_panel where interview_id = v_id) = 'needs_action', 'responses reset';
  assert (select payload ->> 'reason' from public.application_events
           where type = 'meeting_cancelled' and payload ->> 'scheduled_interview_id' = v_id::text) = 'candidate',
    'the timeline says the candidate cancelled';
  assert public.resolve_scheduling_token(v_tok) ->> 'status' = 'awaiting_candidate', 'the link works again';
  perform pg_temp.expect(public.cancel_by_token(v_tok), 'not_booked', 'cancel unbooked');
  perform pg_temp.expect(public.reschedule_by_token(v_tok, v_start), 'not_booked', 'reschedule unbooked');

  -- The 4-hour cutoff.
  perform pg_temp.expect(public.book_by_token(v_tok, v_start), null, 'rebook');
  update public.scheduled_interviews set starts_at = now() + interval '3 hours', ends_at = now() + interval '3 hours 30 minutes'
   where id = v_id;
  perform pg_temp.expect(public.reschedule_by_token(v_tok, v_start), 'too_late', 'reschedule inside 4 h');
  perform pg_temp.expect(public.cancel_by_token(v_tok), 'too_late', 'cancel inside 4 h');
  assert not (public.resolve_scheduling_token(v_tok) ->> 'can_change')::boolean, 'can_change is off inside 4 h';
  -- Unbooking after a refused Google booking works whatever the time.
  assert (public.return_interview_to_link(v_id, 'calendar_failed') ->> 'applied')::boolean, 'unbook after Google refused';
  assert not (public.return_interview_to_link(v_id, 'calendar_failed') ->> 'applied')::boolean, 'unbook twice is a no-op';

  -- An expired link opens nothing.
  update public.scheduled_interviews set booking_token_expires_at = now() - interval '1 minute' where id = v_id;
  assert public.resolve_scheduling_token(v_tok) ->> 'reason' = 'not_found', 'an expired link';
  perform pg_temp.expect(public.book_by_token(v_tok, v_start), 'not_found', 'book an expired link');
  update public.scheduled_interviews set booking_token_expires_at = now() + interval '1 day' where id = v_id;

  -- The ops queue takes the event id a row no longer holds.
  perform public.queue_interview_calendar_op(v_id, 'delete', 'evt_link');
  assert (select count(*) from pgmq.q_interview_calendar_ops
           where message ->> 'interview_id' = v_id::text and message ->> 'provider_event_id' = 'evt_link') = 1,
    'a delete for the old event';
  begin
    perform public.queue_interview_calendar_op(v_id, 'update', 'evt_link');
    raise exception 'an update with an explicit event id should be refused';
  exception when invalid_parameter_value then null;
  end;

  -- The rate limit counts per key and doesn't record refused hits.
  assert public.take_scheduling_link_hit('ip:test', 2, 60) and public.take_scheduling_link_hit('ip:test', 2, 60), 'within';
  assert not public.take_scheduling_link_hit('ip:test', 2, 60), 'over the limit';
  assert (select count(*) from public.scheduling_link_hits where key = 'ip:test') = 2, 'a refused hit isn''t recorded';
  assert public.take_scheduling_link_hit('ip:other', 2, 60), 'other keys are separate';
  update public.scheduling_link_hits set at = now() - interval '2 minutes' where key = 'ip:test';
  assert public.take_scheduling_link_hit('ip:test', 2, 60), 'old hits drop out of the window';
end $$;

-- Renewing: a new token replaces the old one; a recruiter's cancel ends it.
set local role authenticated;
select pg_temp.act('c2000000-0000-4000-8000-000000000001');
do $$
declare
  v jsonb;
  h2 text := encode(sha256(convert_to(current_setting('test.tok2'), 'UTF8')), 'hex');
begin
  v := pg_temp.expect(public.renew_scheduling_link(current_setting('test.link')::uuid, h2), null, 'renew');
  assert (v ->> 'expires_at')::timestamptz > now() + interval '6 days', format('renewed for 7 days: %s', v);
  assert public.resolve_scheduling_token(current_setting('test.tok')) ->> 'reason' = 'not_found', 'the old token stopped';
  assert (public.resolve_scheduling_token(current_setting('test.tok2')) ->> 'ok')::boolean, 'the new token works';
  perform pg_temp.expect(public.renew_scheduling_link(current_setting('test.booked')::uuid, h2), 'invalid_status',
    'renew a cancelled booked interview');
  perform pg_temp.expect(public.cancel_interview(current_setting('test.link')::uuid), null, 'recruiter cancels the link');
  perform pg_temp.expect(public.renew_scheduling_link(current_setting('test.link')::uuid, h2), 'invalid_status',
    'renew a cancelled link');
end $$;
reset role;
do $$ begin
  assert public.resolve_scheduling_token(current_setting('test.tok2')) ->> 'reason' = 'not_found',
    'a cancelled interview''s link opens nothing';
end $$;

-- ================================================ block 12: the applicant's view (IVT-064)

select set_config('test.tok3', 'link-token-' || repeat('c', 32), true),
       set_config('test.tok4', 'link-token-' || repeat('d', 32), true);
set local role authenticated;
select pg_temp.act('c2000000-0000-4000-8000-000000000001');
do $$
declare
  v jsonb;
begin
  v := pg_temp.expect(public.create_scheduling_link(
    p_application_id => 'e0000000-0000-4000-8000-000000000002',
    p_panel => array['c2000000-0000-4000-8000-000000000001']::uuid[],
    p_token_hash => encode(sha256(convert_to(current_setting('test.tok3'), 'UTF8')), 'hex'),
    p_name => 'Second call', p_duration_minutes => 30), null, 'link for the applicant view');
  perform set_config('test.link2', v ->> 'id', true);
  v := pg_temp.expect(public.record_interview(
    p_application_id => 'e0000000-0000-4000-8000-000000000002',
    p_panel => array['c2000000-0000-4000-8000-000000000001']::uuid[],
    p_starts_at => now() + interval '5 days', p_name => 'Onsite', p_duration_minutes => 60,
    p_meeting_url => 'https://meet.example.test/onsite'), null, 'manual for the applicant view');
  perform set_config('test.manual2', v ->> 'id', true);
end $$;

-- Two (the applicant) sees their link and their recorded interview.
select pg_temp.act('a0000000-0000-4000-8000-000000000002');
do $$
declare
  v_rows jsonb;
  v_link jsonb;
  v_manual jsonb;
  v_count int;
begin
  select jsonb_agg(to_jsonb(m)) into v_rows from public.my_scheduled_interviews() m;
  select r into v_link from jsonb_array_elements(v_rows) r where r ->> 'id' = current_setting('test.link2');
  select r into v_manual from jsonb_array_elements(v_rows) r where r ->> 'id' = current_setting('test.manual2');
  assert v_link is not null and v_manual is not null, format('both interviews: %s', v_rows);
  assert (select array_agg(k order by k) from jsonb_object_keys(v_link) k) = array[
    'application_id', 'can_reschedule', 'company_name', 'duration_minutes', 'ends_at', 'id', 'interview_name',
    'job_title', 'meeting_url', 'starts_at', 'status'
  ], format('only these columns: %s', v_link);
  assert v_link ->> 'status' = 'awaiting_candidate' and (v_link ->> 'can_reschedule')::boolean, format('link: %s', v_link);
  assert v_link ->> 'job_title' = 'A1' and v_link ->> 'company_name' = 'Acme', 'job and company';
  assert v_manual ->> 'meeting_url' = 'https://meet.example.test/onsite', 'the meeting link of a booked interview';
  assert not (v_manual ->> 'can_reschedule')::boolean, 'a recorded interview has no link to reschedule with';
  assert not exists (select 1 from jsonb_array_elements(v_rows) r where r ->> 'id' = current_setting('test.link')),
    'cancelled interviews aren''t listed';
  assert v_rows::text !~ 'c2000000', 'no panel ids';

  -- Applicants never read the tables.
  begin
    select count(*) into v_count from public.scheduled_interviews;
    assert v_count = 0, format('an applicant read %s interviews', v_count);
  exception when insufficient_privilege then null;
  end;
  begin
    select count(*) into v_count from public.scheduled_interview_panel;
    assert v_count = 0, 'an applicant read a panel';
  exception when insufficient_privilege then null;
  end;

  -- Opening the link from GetHired replaces the emailed token.
  perform pg_temp.expect(public.rotate_my_scheduling_link(current_setting('test.manual2')::uuid,
    encode(sha256(convert_to(current_setting('test.tok4'), 'UTF8')), 'hex')), 'not_found', 'rotate a recorded interview');
  perform pg_temp.expect(public.rotate_my_scheduling_link(current_setting('test.link2')::uuid, 'nope'), 'invalid_token',
    'rotate with a bad hash');
  perform pg_temp.expect(public.rotate_my_scheduling_link(current_setting('test.link2')::uuid,
    encode(sha256(convert_to(current_setting('test.tok4'), 'UTF8')), 'hex')), null, 'rotate');
  assert public.resolve_scheduling_token(current_setting('test.tok3')) ->> 'reason' = 'not_found', 'the emailed token stopped';
  assert (public.resolve_scheduling_token(current_setting('test.tok4')) ->> 'ok')::boolean, 'the new token opens it';
end $$;

-- One sees none of Two's interviews and can't rotate them.
select pg_temp.act('a0000000-0000-4000-8000-000000000001');
do $$ begin
  assert not exists (select 1 from public.my_scheduled_interviews() m where m.application_id = 'e0000000-0000-4000-8000-000000000002'),
    'another applicant''s interviews';
  perform pg_temp.expect(public.rotate_my_scheduling_link(current_setting('test.link2')::uuid, repeat('e', 64)), 'not_found',
    'rotate someone else''s link');
end $$;
reset role;

-- Booked, the link shows its Meet link; inside 4 hours it can't be moved.
do $$ begin
  perform pg_temp.expect(public.book_by_token(current_setting('test.tok4'), date_trunc('hour', now()) + interval '3 days'),
    null, 'book for the applicant view');
  update public.scheduled_interviews set meeting_url = 'https://meet.google.com/abc-defg-hij'
   where id = current_setting('test.link2')::uuid;
end $$;
set local role authenticated;
select pg_temp.act('a0000000-0000-4000-8000-000000000002');
do $$
declare
  v record;
begin
  select * into v from public.my_scheduled_interviews() m where m.id = current_setting('test.link2')::uuid;
  assert v.status = 'scheduled' and v.meeting_url = 'https://meet.google.com/abc-defg-hij' and v.can_reschedule,
    format('booked: %s', to_jsonb(v));
end $$;
reset role;
update public.scheduled_interviews set starts_at = now() + interval '2 hours', ends_at = now() + interval '150 minutes'
 where id = current_setting('test.link2')::uuid;
set local role authenticated;
select pg_temp.act('a0000000-0000-4000-8000-000000000002');
do $$ begin
  assert not (select can_reschedule from public.my_scheduled_interviews() m where m.id = current_setting('test.link2')::uuid),
    'no rescheduling inside 4 hours';
end $$;
reset role;

-- ================================================ block 13: feedback emails (IVT-070)
-- FB1: completed an hour ago on app 1, panel Vera, Nora and Rita (Rita has
-- submitted). FB2: a no-show, panel Vera. FB3: completed 10 days ago, panel Vera.
do $$
declare
  a uuid := current_setting('test.a')::uuid;
begin
  insert into public.scheduled_interviews (id, company_id, job_post_id, application_id, stage_id, name,
    duration_minutes, status, source, starts_at, ends_at)
  values
    ('f1300000-0000-4000-8000-000000000001', a, 'b0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000001', current_setting('test.screen')::uuid, 'Feedback one', 60,
     'completed', 'manual', now() - interval '2 hours', now() - interval '1 hour'),
    ('f1300000-0000-4000-8000-000000000002', a, 'b0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000001', current_setting('test.screen')::uuid, 'Feedback two', 60,
     'no_show', 'manual', now() - interval '2 hours', now() - interval '1 hour'),
    ('f1300000-0000-4000-8000-000000000003', a, 'b0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000001', current_setting('test.screen')::uuid, 'Feedback three', 60,
     'completed', 'manual', now() - interval '10 days 1 hour', now() - interval '10 days');
  insert into public.scheduled_interview_panel (interview_id, user_id, company_id) values
    ('f1300000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', a),
    ('f1300000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000001', a),
    ('f1300000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', a),
    ('f1300000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000001', a),
    ('f1300000-0000-4000-8000-000000000003', 'c7000000-0000-4000-8000-000000000001', a);
  insert into public.interview_scorecards (interview_id, application_id, company_id, author_user_id, overall, status,
    submitted_at, locked_at)
  values ('f1300000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', a,
          'c2000000-0000-4000-8000-000000000001', 'yes', 'submitted', now(), now() + interval '1 day');
end $$;

create function pg_temp.fb_due() returns text language sql as $$
  select coalesce(string_agg(d.kind || ':' || d.user_id::text || ':' || d.interview_name, ',' order by d.kind, d.user_id), '')
    from public.interview_feedback_due(500) d
   where d.interview_id::text like 'f1300000-%'
$$;

do $$
declare
  vera uuid := 'c7000000-0000-4000-8000-000000000001';
  nora uuid := 'c8000000-0000-4000-8000-000000000001';
  fb1 uuid := 'f1300000-0000-4000-8000-000000000001';
  v_at timestamptz;
  v_row record;
begin
  -- Only FB1's members without a submitted scorecard; not the no-show or the old one.
  assert pg_temp.fb_due() = format('request:%s:Feedback one,request:%s:Feedback one', vera, nora),
    format('due: %s', pg_temp.fb_due());
  select * into v_row from public.interview_feedback_due(500) d where d.interview_id = fb1 and d.user_id = vera;
  assert v_row.job_title = 'A1' and v_row.candidate_name = 'One', format('details: %s', to_jsonb(v_row));

  -- Claimed once; a second claim (a repeated run) gets nothing.
  v_at := public.claim_interview_feedback_email(fb1, vera, 'request');
  assert v_at is not null, 'claim the request';
  assert public.claim_interview_feedback_email(fb1, vera, 'request') is null, 'no second request';
  -- A failed send releases it, and the next run claims it again.
  assert public.release_interview_feedback_email(fb1, vera, 'request', v_at), 'release';
  assert not public.release_interview_feedback_email(fb1, vera, 'request', v_at), 'release only once';
  assert public.claim_interview_feedback_email(fb1, vera, 'request') is not null, 'reclaim after release';
  assert public.claim_interview_feedback_email(fb1, nora, 'request') is not null, 'claim Nora';
  -- The reminder waits 24 hours.
  assert pg_temp.fb_due() = '', format('nothing before 24 h: %s', pg_temp.fb_due());
  assert public.claim_interview_feedback_email(fb1, vera, 'reminder') is null, 'no early reminder';
  update public.scheduled_interview_panel set feedback_requested_at = now() - interval '25 hours' where interview_id = fb1;
  assert pg_temp.fb_due() = format('reminder:%s:Feedback one,reminder:%s:Feedback one', vera, nora),
    format('reminders: %s', pg_temp.fb_due());

  -- Nora submits: no reminder for her.
  insert into public.interview_scorecards (interview_id, application_id, company_id, author_user_id, overall, status,
    submitted_at, locked_at)
  values (fb1, 'e0000000-0000-4000-8000-000000000001', current_setting('test.a')::uuid, nora, 'no', 'submitted',
          now(), now() + interval '1 day');
  assert public.claim_interview_feedback_email(fb1, nora, 'reminder') is null, 'submitted: no reminder';
  assert public.claim_interview_feedback_email(fb1, vera, 'reminder') is not null, 'Vera''s reminder';
  -- Two emails, and that's all.
  assert pg_temp.fb_due() = '', format('done: %s', pg_temp.fb_due());
  assert public.claim_interview_feedback_email(fb1, vera, 'reminder') is null, 'no second reminder';
  assert public.claim_interview_feedback_email(fb1, vera, 'request') is null, 'no third email';
  assert public.claim_interview_feedback_email('f1300000-0000-4000-8000-000000000002', vera, 'request') is null,
    'no email for a no-show';
end $$;

-- Only the service role reads or claims.
set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$ begin
  assert pg_temp.denied('select * from public.interview_feedback_due(10)'), 'members can''t list';
  assert pg_temp.denied($q$select public.claim_interview_feedback_email('f1300000-0000-4000-8000-000000000001',
    'c7000000-0000-4000-8000-000000000001', 'request')$q$), 'members can''t claim';
end $$;
reset role;

-- ================================================ block 14: closing cancels interviews (IVT-071)
-- Three's application to A1, in Screening, with: K1 a link waiting for the candidate, K2 booked
-- for tomorrow with a Google event, K3 started an hour ago, K4 completed.
insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-000000000003', 'three@applicant.test', 'authenticated', 'authenticated');
insert into public.user_info (user_id, email, full_name, is_public, filled) values
  ('a0000000-0000-4000-8000-000000000003', 'three@applicant.test', 'Three', true, true);
insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id) values
  ('e1400000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003',
   'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001');
update public.applications set stage_id = current_setting('test.screen')::uuid
 where id = 'e1400000-0000-4000-8000-000000000001';
do $$
declare
  a uuid := current_setting('test.a')::uuid;
begin
  delete from pgmq.q_interview_calendar_ops;
  insert into public.scheduled_interviews (id, company_id, job_post_id, application_id, stage_id, name,
    duration_minutes, status, source, starts_at, ends_at, provider_event_id, booking_token_hash, booking_token_expires_at)
  values
    ('f1400000-0000-4000-8000-000000000001', a, 'b0000000-0000-4000-8000-000000000001',
     'e1400000-0000-4000-8000-000000000001', current_setting('test.screen')::uuid, 'Close one', 30,
     'awaiting_candidate', 'link', null, null, null, repeat('d', 64), now() + interval '5 days'),
    ('f1400000-0000-4000-8000-000000000002', a, 'b0000000-0000-4000-8000-000000000001',
     'e1400000-0000-4000-8000-000000000001', current_setting('test.screen')::uuid, 'Close two', 30,
     'scheduled', 'booked', now() + interval '1 day', now() + interval '1 day 30 minutes', 'evt-k2', null, null),
    ('f1400000-0000-4000-8000-000000000003', a, 'b0000000-0000-4000-8000-000000000001',
     'e1400000-0000-4000-8000-000000000001', current_setting('test.screen')::uuid, 'Close three', 120,
     'scheduled', 'manual', now() - interval '1 hour', now() + interval '1 hour', null, null, null),
    ('f1400000-0000-4000-8000-000000000004', a, 'b0000000-0000-4000-8000-000000000001',
     'e1400000-0000-4000-8000-000000000001', current_setting('test.screen')::uuid, 'Close four', 30,
     'completed', 'manual', now() - interval '2 days', now() - interval '2 days' + interval '30 minutes', null, null, null);
end $$;

-- The dialog's count: the owner sees 2; Ivo (can't move) sees none.
set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$ begin
  assert public.upcoming_interview_count(array['e1400000-0000-4000-8000-000000000001'::uuid]) = 2,
    format('count: %s', public.upcoming_interview_count(array['e1400000-0000-4000-8000-000000000001'::uuid]));
end $$;
select pg_temp.act('c3000000-0000-4000-8000-000000000002');
do $$ begin
  assert public.upcoming_interview_count(array['e1400000-0000-4000-8000-000000000001'::uuid]) = 0, 'Ivo can''t move';
end $$;

-- Unchecked: the move to Rejected keeps them.
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
select set_config('request.headers', '{"x-keep-interviews":"1"}', true);
update public.applications set stage_id = current_setting('test.rejected')::uuid
 where id = 'e1400000-0000-4000-8000-000000000001';
select set_config('request.headers', '', true);
reset role;
do $$ begin
  assert (select count(*) from public.scheduled_interviews
           where id::text like 'f1400000-%' and status in ('awaiting_candidate', 'scheduled')) = 3, 'kept';
  assert (select count(*) from pgmq.q_interview_calendar_ops) = 0, 'nothing queued when kept';
end $$;

-- Back to Screening, then Rejected with the default: K1 and K2 cancelled in
-- the move's transaction, K2's event queued for deletion, K3 and K4 untouched.
update public.applications set stage_id = current_setting('test.screen')::uuid
 where id = 'e1400000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
update public.applications set stage_id = current_setting('test.rejected')::uuid
 where id = 'e1400000-0000-4000-8000-000000000001';
reset role;
do $$ begin
  assert (select string_agg(name || ':' || status, ',' order by name) from public.scheduled_interviews
           where id::text like 'f1400000-%') = 'Close four:completed,Close one:cancelled,Close three:scheduled,Close two:cancelled',
    format('statuses: %s', (select string_agg(name || ':' || status, ',' order by name) from public.scheduled_interviews
           where id::text like 'f1400000-%'));
  assert (select booking_token_expires_at <= now() from public.scheduled_interviews
           where id = 'f1400000-0000-4000-8000-000000000001'), 'the link stops working';
  assert (select count(*) from public.application_events
           where application_id = 'e1400000-0000-4000-8000-000000000001' and type = 'meeting_cancelled'
             and payload ->> 'reason' = 'stage' and actor_user_id = 'c1000000-0000-4000-8000-000000000001') = 2,
    'two cancellations logged by the mover';
  assert (select count(*) from pgmq.q_interview_calendar_ops) = 1, 'one op';
  assert (select message ->> 'provider_event_id' from pgmq.q_interview_calendar_ops) = 'evt-k2', 'K2''s event';
end $$;

-- ================================================ block 15: board badges (IVT-073)
-- Four's application to A1: G1 tomorrow, G2 in three days, G3 completed an
-- hour ago (panel Vera, Nora and Rita; Rita submitted), G4 completed 10 days
-- ago (outside the window), G5 cancelled. Five's: G6 completed, all submitted.
insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-000000000004', 'four@applicant.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000005', 'five@applicant.test', 'authenticated', 'authenticated');
insert into public.user_info (user_id, email, full_name, is_public, filled) values
  ('a0000000-0000-4000-8000-000000000004', 'four@applicant.test', 'Four', true, true),
  ('a0000000-0000-4000-8000-000000000005', 'five@applicant.test', 'Five', true, true);
insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id) values
  ('e1500000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004',
   'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
  ('e1500000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000005',
   'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001');
do $$
declare
  a uuid := current_setting('test.a')::uuid;
  job uuid := 'b0000000-0000-4000-8000-000000000001';
  four uuid := 'e1500000-0000-4000-8000-000000000001';
  five uuid := 'e1500000-0000-4000-8000-000000000002';
  st uuid := current_setting('test.screen')::uuid;
begin
  insert into public.scheduled_interviews (id, company_id, job_post_id, application_id, stage_id, name,
    duration_minutes, status, source, starts_at, ends_at)
  values
    ('f1500000-0000-4000-8000-000000000001', a, job, four, st, 'Badge one', 30, 'scheduled', 'manual',
     now() + interval '1 day', now() + interval '1 day 30 minutes'),
    ('f1500000-0000-4000-8000-000000000002', a, job, four, st, 'Badge two', 30, 'scheduled', 'manual',
     now() + interval '3 days', now() + interval '3 days 30 minutes'),
    ('f1500000-0000-4000-8000-000000000003', a, job, four, st, 'Badge three', 60, 'completed', 'manual',
     now() - interval '2 hours', now() - interval '1 hour'),
    ('f1500000-0000-4000-8000-000000000004', a, job, four, st, 'Badge four', 30, 'completed', 'manual',
     now() - interval '10 days 1 hour', now() - interval '10 days'),
    ('f1500000-0000-4000-8000-000000000005', a, job, four, st, 'Badge five', 30, 'cancelled', 'manual',
     now() + interval '2 hours', now() + interval '3 hours'),
    ('f1500000-0000-4000-8000-000000000006', a, job, five, st, 'Badge six', 30, 'completed', 'manual',
     now() - interval '2 hours', now() - interval '1 hour');
  insert into public.scheduled_interview_panel (interview_id, user_id, company_id) values
    ('f1500000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', a),
    ('f1500000-0000-4000-8000-000000000003', 'c7000000-0000-4000-8000-000000000001', a),
    ('f1500000-0000-4000-8000-000000000003', 'c8000000-0000-4000-8000-000000000001', a),
    ('f1500000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000001', a),
    ('f1500000-0000-4000-8000-000000000004', 'c7000000-0000-4000-8000-000000000001', a),
    ('f1500000-0000-4000-8000-000000000006', 'c2000000-0000-4000-8000-000000000001', a);
  insert into public.interview_scorecards (interview_id, application_id, company_id, author_user_id, overall, status,
    submitted_at, locked_at)
  values
    ('f1500000-0000-4000-8000-000000000003', four, a, 'c2000000-0000-4000-8000-000000000001', 'strong_yes',
     'submitted', now(), now() + interval '1 day'),
    ('f1500000-0000-4000-8000-000000000006', five, a, 'c2000000-0000-4000-8000-000000000001', 'no',
     'submitted', now(), now() + interval '1 day');
end $$;

-- Times and counts only: no rating column a blind reader could see.
do $$ begin
  assert pg_get_function_result('public.job_interview_badges(uuid)'::regprocedure)
    = 'TABLE(application_id uuid, next_starts_at timestamp with time zone, feedback_submitted integer, feedback_total integer)',
    format('shape: %s', pg_get_function_result('public.job_interview_badges(uuid)'::regprocedure));
end $$;

-- "<app>:<next is G1>:<submitted>/<total>" for block 15's applications.
create function pg_temp.badges() returns text language sql as $$
  select coalesce(string_agg(
           right(b.application_id::text, 1) || ':'
             || coalesce((b.next_starts_at = (select starts_at from public.scheduled_interviews
                                               where id = 'f1500000-0000-4000-8000-000000000001'))::text, '-')
             || ':' || b.feedback_submitted || '/' || b.feedback_total,
           ',' order by b.application_id), '')
    from public.job_interview_badges('b0000000-0000-4000-8000-000000000001') b
   where b.application_id::text like 'e1500000-%'
$$;
grant execute on function pg_temp.badges() to authenticated;

set local role authenticated;
-- The owner: Four's next interview is G1 (tomorrow), with G3's feedback at 1/3;
-- Five has nothing pending, so no row.
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$ begin
  assert pg_temp.badges() = '1:true:1/3', format('owner: %s', pg_temp.badges());
end $$;
-- Vera is blind on Four (on G3's panel, not submitted): the same times and counts.
select pg_temp.act('c7000000-0000-4000-8000-000000000001');
do $$ begin
  assert public.is_scorecard_blind('e1500000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001'),
    'Vera is blind';
  assert pg_temp.badges() = '1:true:1/3', format('vera: %s', pg_temp.badges());
end $$;
-- Without scheduling.view on the job (Nora, Pat, Ian), or in another company (Bea): nothing.
do $$
declare
  u uuid;
begin
  foreach u in array array['c8000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
                           'c3000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002']::uuid[] loop
    perform pg_temp.act(u);
    assert pg_temp.badges() = '', format('%s sees %s', u, pg_temp.badges());
  end loop;
end $$;
select pg_temp.act(null);
reset role;
set local role anon;
do $$ begin
  assert pg_temp.denied('select * from public.job_interview_badges(''b0000000-0000-4000-8000-000000000001'')'),
    'anon can''t run it';
end $$;
reset role;

-- ================================================ block 16: the dashboard's interview follow-ups (IVT-074)
-- On Four's application to A1: H1 completed 2 days ago (panel Vera and Rita;
-- Rita submitted), H2 a link sent 4 days ago, H3 a link sent yesterday, H4
-- completed 30 hours ago with everyone submitted, H5 completed 2 days ago
-- with Nora alone on the panel (2 hours before H1), H6 completed 20 hours ago (panel Vera).
do $$
declare
  a uuid := current_setting('test.a')::uuid;
  job uuid := 'b0000000-0000-4000-8000-000000000001';
  four uuid := 'e1500000-0000-4000-8000-000000000001';
  st uuid := current_setting('test.screen')::uuid;
begin
  insert into public.scheduled_interviews (id, company_id, job_post_id, application_id, stage_id, name,
    duration_minutes, status, source, starts_at, ends_at, booking_token_hash, booking_token_expires_at,
    booking_link_sent_at)
  values
    ('f1600000-0000-4000-8000-000000000001', a, job, four, st, 'Follow one', 60, 'completed', 'manual',
     now() - interval '2 days 1 hour', now() - interval '2 days', null, null, null),
    ('f1600000-0000-4000-8000-000000000002', a, job, four, st, 'Follow two', 30, 'awaiting_candidate', 'link',
     null, null, repeat('1', 64), now() + interval '3 days', now() - interval '4 days'),
    ('f1600000-0000-4000-8000-000000000003', a, job, four, st, 'Follow three', 30, 'awaiting_candidate', 'link',
     null, null, repeat('2', 64), now() + interval '6 days', now() - interval '1 day'),
    ('f1600000-0000-4000-8000-000000000004', a, job, four, st, 'Follow four', 30, 'completed', 'manual',
     now() - interval '31 hours', now() - interval '30 hours', null, null, null),
    ('f1600000-0000-4000-8000-000000000005', a, job, four, st, 'Follow five', 30, 'completed', 'manual',
     now() - interval '2 days 3 hours', now() - interval '2 days 2 hours', null, null, null),
    ('f1600000-0000-4000-8000-000000000006', a, job, four, st, 'Follow six', 30, 'completed', 'manual',
     now() - interval '21 hours', now() - interval '20 hours', null, null, null);
  insert into public.scheduled_interview_panel (interview_id, user_id, company_id) values
    ('f1600000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', a),
    ('f1600000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', a),
    ('f1600000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000001', a),
    ('f1600000-0000-4000-8000-000000000005', 'c8000000-0000-4000-8000-000000000001', a),
    ('f1600000-0000-4000-8000-000000000006', 'c7000000-0000-4000-8000-000000000001', a);
  insert into public.interview_scorecards (interview_id, application_id, company_id, author_user_id, overall, status,
    submitted_at, locked_at)
  values
    ('f1600000-0000-4000-8000-000000000001', four, a, 'c2000000-0000-4000-8000-000000000001', 'yes',
     'submitted', now(), now() + interval '1 day'),
    ('f1600000-0000-4000-8000-000000000004', four, a, 'c2000000-0000-4000-8000-000000000001', 'no',
     'submitted', now(), now() + interval '1 day');
end $$;

-- "<kind>:<interview name>:<owed>:<mine>" in the order the dashboard shows them.
create function pg_temp.follow_ups() returns text language sql as $$
  select coalesce(string_agg(f.kind || ':' || f.interview_name || ':' || f.owed || ':' || f.mine, ',' order by f.ord), '')
    from (select x.*, row_number() over () as ord from public.interviews_needing_attention(50) x) f
   where f.interview_id::text like 'f1600000-%'
$$;
grant execute on function pg_temp.follow_ups() to authenticated;

set local role authenticated;
-- Vera (scheduling.view, owes H1): her own scorecard first, then the rest.
select pg_temp.act('c7000000-0000-4000-8000-000000000001');
do $$ begin
  assert pg_temp.follow_ups()
    = 'feedback_overdue:Follow one:1:true,feedback_overdue:Follow five:1:false,awaiting_candidate:Follow two:0:false',
    format('vera: %s', pg_temp.follow_ups());
  assert (select candidate_name || '/' || job_title from public.interviews_needing_attention(50)
           where interview_id = 'f1600000-0000-4000-8000-000000000002') = 'Four/A1', 'names';
end $$;
-- The owner: everything on the jobs, none of it theirs; overdue feedback first, oldest first.
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$ begin
  assert pg_temp.follow_ups()
    = 'feedback_overdue:Follow five:1:false,feedback_overdue:Follow one:1:false,awaiting_candidate:Follow two:0:false',
    format('owner: %s', pg_temp.follow_ups());
end $$;
-- Nora (no scheduling.view): only the scorecard she owes.
select pg_temp.act('c8000000-0000-4000-8000-000000000001');
do $$ begin
  assert pg_temp.follow_ups() = 'feedback_overdue:Follow five:1:true', format('nora: %s', pg_temp.follow_ups());
end $$;
-- Pat (no scheduling.view, on no panel) and Bea (another company): nothing.
select pg_temp.act('c4000000-0000-4000-8000-000000000001');
do $$ begin
  assert pg_temp.follow_ups() = '', format('pat: %s', pg_temp.follow_ups());
end $$;
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$ begin
  assert pg_temp.follow_ups() = '', format('bea: %s', pg_temp.follow_ups());
end $$;
select pg_temp.act(null);
reset role;
set local role anon;
do $$ begin
  assert pg_temp.denied('select * from public.interviews_needing_attention(10)'), 'anon can''t run it';
end $$;
reset role;

-- ================================================ block 17: the feedback summary (IVT-081)
-- Six's application to A1: S1 completed yesterday (panel Rita, Ian and Ivo;
-- Rita and Ian submitted, Ivo has a draft).
insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-000000000006', 'six@applicant.test', 'authenticated', 'authenticated');
insert into public.user_info (user_id, email, full_name, is_public, filled) values
  ('a0000000-0000-4000-8000-000000000006', 'six@applicant.test', 'Six', true, true);
insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id) values
  ('e1700000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000006',
   'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001');
do $$
declare
  a uuid := current_setting('test.a')::uuid;
  job uuid := 'b0000000-0000-4000-8000-000000000001';
  six uuid := 'e1700000-0000-4000-8000-000000000001';
  st uuid := current_setting('test.interview')::uuid;
  snap jsonb := jsonb_build_object('name', 'Systems', 'competencies', jsonb_build_array(
    jsonb_build_object('id', '17c00000-0000-4000-8000-000000000001', 'name', 'APIs', 'description', 'Designs APIs',
                       'questions', jsonb_build_array('Design one.'))));
begin
  insert into public.scheduled_interviews (id, company_id, job_post_id, application_id, stage_id, name,
    duration_minutes, plan_snapshot, status, source, starts_at, ends_at)
  values
    ('f1700000-0000-4000-8000-000000000001', a, job, six, st, 'Systems', 60, snap, 'completed', 'manual',
     now() - interval '1 day 1 hour', now() - interval '1 day');
  insert into public.scheduled_interview_panel (interview_id, user_id, company_id) values
    ('f1700000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', a),
    ('f1700000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', a),
    ('f1700000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', a);
  insert into public.interview_scorecards (id, interview_id, application_id, company_id, author_user_id, overall,
    overall_note, ratings, status, submitted_at, locked_at)
  values
    ('17500000-0000-4000-8000-000000000001', 'f1700000-0000-4000-8000-000000000001', six, a,
     'c2000000-0000-4000-8000-000000000001', 'yes', 'Clear about trade-offs.',
     '{"17c00000-0000-4000-8000-000000000001": {"rating": "yes", "note": "Good pagination answer."}}',
     'submitted', now(), now() + interval '1 day'),
    ('17500000-0000-4000-8000-000000000002', 'f1700000-0000-4000-8000-000000000001', six, a,
     'c3000000-0000-4000-8000-000000000001', 'no', 'Vague on failure modes.',
     '{"17c00000-0000-4000-8000-000000000001": {"rating": "no", "note": ""}}',
     'submitted', now(), now() + interval '1 day'),
    ('17500000-0000-4000-8000-000000000003', 'f1700000-0000-4000-8000-000000000001', six, a,
     'c3000000-0000-4000-8000-000000000002', null, 'Draft thoughts.', '{}', 'draft', null, null);
end $$;

create function pg_temp.summary_ids() returns uuid[] language sql as $$
  select array['17500000-0000-4000-8000-000000000001', '17500000-0000-4000-8000-000000000002']::uuid[]
$$;
grant execute on function pg_temp.summary_ids() to authenticated;

set local role authenticated;
-- Vera (scorecards.view_all): the submitted scorecards, never the draft, with
-- each interview's name and competencies and the latest change.
select pg_temp.act('c7000000-0000-4000-8000-000000000001');
do $$
declare
  v_res jsonb := pg_temp.expect(public.feedback_summary_source('e1700000-0000-4000-8000-000000000001'), null, 'source');
begin
  assert jsonb_array_length(v_res -> 'scorecards') = 2, format('two submitted cards: %s', v_res);
  assert not (v_res::text like '%Draft thoughts%'), 'no draft';
  assert (v_res -> 'scorecards' -> 0 ->> 'interview_name') = 'Systems', format('interview name: %s', v_res);
  assert (v_res -> 'scorecards' -> 0 -> 'competencies' -> 0 ->> 'name') = 'APIs', format('competencies: %s', v_res);
  assert (v_res -> 'scorecards' -> 0 ->> 'author_name') in ('Rita', 'Ian'), format('author: %s', v_res);
  assert v_res ->> 'version' is not null, 'a version';
  assert not (v_res::text like '%@acme.test%'), 'no email addresses';
  -- Nothing to read yet.
  v_res := pg_temp.expect(public.get_feedback_summary('e1700000-0000-4000-8000-000000000001'), null, 'get before');
  assert v_res -> 'summary' = 'null'::jsonb and (v_res ->> 'submitted')::int = 2, format('none yet: %s', v_res);
end $$;

-- Saving checks the set it read is still the current one.
do $$
declare
  v_version timestamptz := (public.feedback_summary_source('e1700000-0000-4000-8000-000000000001') ->> 'version')::timestamptz;
  v_res jsonb;
begin
  perform pg_temp.expect(public.save_feedback_summary('e1700000-0000-4000-8000-000000000001',
    array['17500000-0000-4000-8000-000000000001']::uuid[], v_version, '{"agreements": []}'), 'changed', 'a subset');
  perform pg_temp.expect(public.save_feedback_summary('e1700000-0000-4000-8000-000000000001',
    pg_temp.summary_ids(), v_version - interval '1 second', '{"agreements": []}'), 'changed', 'an older version');
  perform pg_temp.expect(public.save_feedback_summary('e1700000-0000-4000-8000-000000000001',
    pg_temp.summary_ids(), v_version, '[]'), 'invalid_input', 'not an object');
  v_res := pg_temp.expect(public.save_feedback_summary('e1700000-0000-4000-8000-000000000001',
    pg_temp.summary_ids(), v_version, '{"agreements": [{"text": "Both liked the API design."}]}'), null, 'save');
  assert v_res ->> 'id' is not null, 'returns the id';
  v_res := pg_temp.expect(public.get_feedback_summary('e1700000-0000-4000-8000-000000000001'), null, 'get');
  assert v_res -> 'summary' -> 'agreements' -> 0 ->> 'text' = 'Both liked the API design.', format('summary: %s', v_res);
  assert not (v_res ->> 'stale')::boolean, format('fresh: %s', v_res);
  assert (select count(*) from public.interview_feedback_summaries
           where application_id = 'e1700000-0000-4000-8000-000000000001') = 1, 'Vera reads it through RLS';
end $$;

-- Rita (scheduling.view, no scorecards.view_all) gets nothing.
select pg_temp.act('c2000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.feedback_summary_source('e1700000-0000-4000-8000-000000000001'), 'forbidden', 'rita source');
  perform pg_temp.expect(public.get_feedback_summary('e1700000-0000-4000-8000-000000000001'), 'forbidden', 'rita get');
  perform pg_temp.expect(public.save_feedback_summary('e1700000-0000-4000-8000-000000000001',
    pg_temp.summary_ids(), now(), '{}'), 'forbidden', 'rita save');
  assert (select count(*) from public.interview_feedback_summaries
           where application_id = 'e1700000-0000-4000-8000-000000000001') = 0, 'rita reads no rows';
  assert pg_temp.denied($q$insert into public.interview_feedback_summaries (company_id, application_id)
    values ('c0000000-0000-4000-8000-000000000001', 'e1700000-0000-4000-8000-000000000001')$q$), 'no direct insert';
end $$;
-- Bea (another company): not found.
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$ begin
  perform pg_temp.expect(public.feedback_summary_source('e1700000-0000-4000-8000-000000000001'), 'not_found', 'bea source');
  perform pg_temp.expect(public.get_feedback_summary('e1700000-0000-4000-8000-000000000001'), 'not_found', 'bea get');
end $$;
select pg_temp.act(null);
reset role;

-- A note edited after the summary makes it stale; so does a new scorecard.
update public.interview_scorecards set overall_note = 'Clear about trade-offs, and caching.',
  updated_at = now() + interval '1 minute' where id = '17500000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.act('c7000000-0000-4000-8000-000000000001');
do $$ begin
  assert (public.get_feedback_summary('e1700000-0000-4000-8000-000000000001') ->> 'stale')::boolean, 'stale after an edit';
end $$;
select pg_temp.act(null);
reset role;
update public.interview_scorecards set updated_at = now() where id = '17500000-0000-4000-8000-000000000001';
update public.interview_scorecards set status = 'submitted', overall = 'yes', submitted_at = now(),
  locked_at = now() + interval '1 day' where id = '17500000-0000-4000-8000-000000000003';
set local role authenticated;
select pg_temp.act('c7000000-0000-4000-8000-000000000001');
do $$
declare v_res jsonb := public.get_feedback_summary('e1700000-0000-4000-8000-000000000001');
begin
  assert (v_res ->> 'stale')::boolean and (v_res ->> 'submitted')::int = 3, format('stale with a new card: %s', v_res);
end $$;
select pg_temp.act(null);
reset role;
-- Fewer than two submitted: nothing to summarize.
update public.interview_scorecards set status = 'draft', overall = null, submitted_at = null, locked_at = null
 where id in ('17500000-0000-4000-8000-000000000002', '17500000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.act('c7000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.save_feedback_summary('e1700000-0000-4000-8000-000000000001',
    array['17500000-0000-4000-8000-000000000001']::uuid[], now(), '{}'), 'too_few', 'one card');
end $$;
select pg_temp.act(null);
reset role;
set local role anon;
do $$ begin
  assert pg_temp.denied($q$select public.get_feedback_summary('e1700000-0000-4000-8000-000000000001')$q$), 'anon get';
  assert pg_temp.denied($q$select public.feedback_summary_source('e1700000-0000-4000-8000-000000000001')$q$), 'anon source';
end $$;
reset role;

-- ================================================ block 18: reminding interviewers (IVT-084)
-- R1: started 30 minutes ago on app 2, panel Vera, Pat and Nora (Nora has
-- submitted). R2: tomorrow. R3: completed 8 days ago. FB2 (block 13) is a no-show.
do $$
declare
  a uuid := current_setting('test.a')::uuid;
begin
  insert into public.scheduled_interviews (id, company_id, job_post_id, application_id, stage_id, name,
    duration_minutes, status, source, starts_at, ends_at)
  values
    ('f1800000-0000-4000-8000-000000000001', a, 'b0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000002', current_setting('test.screen')::uuid, 'Remind one', 60,
     'scheduled', 'manual', now() - interval '30 minutes', now() + interval '30 minutes'),
    ('f1800000-0000-4000-8000-000000000002', a, 'b0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000002', current_setting('test.screen')::uuid, 'Remind two', 60,
     'scheduled', 'manual', now() + interval '1 day', now() + interval '1 day 1 hour'),
    ('f1800000-0000-4000-8000-000000000003', a, 'b0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000002', current_setting('test.screen')::uuid, 'Remind three', 60,
     'completed', 'manual', now() - interval '8 days 1 hour', now() - interval '8 days');
  insert into public.scheduled_interview_panel (interview_id, user_id, company_id) values
    ('f1800000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', a),
    ('f1800000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', a),
    ('f1800000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000001', a),
    ('f1800000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000001', a),
    ('f1800000-0000-4000-8000-000000000003', 'c7000000-0000-4000-8000-000000000001', a);
  insert into public.interview_scorecards (interview_id, application_id, company_id, author_user_id, overall, status,
    submitted_at, locked_at)
  values ('f1800000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', a,
          'c8000000-0000-4000-8000-000000000001', 'yes', 'submitted', now(), now() + interval '1 day');
end $$;

create function pg_temp.states(p_res jsonb) returns text language sql as $$
  select coalesce(string_agg((m ->> 'name') || ':' || (m ->> 'state'), ',' order by m ->> 'name'), '')
    from jsonb_array_elements(p_res -> 'members') m
$$;
grant execute on function pg_temp.states(jsonb) to authenticated;

set local role authenticated;
select pg_temp.act('c2000000-0000-4000-8000-000000000001');
do $$
declare
  r1 uuid := 'f1800000-0000-4000-8000-000000000001';
  v_res jsonb;
begin
  -- The preview changes nothing.
  v_res := pg_temp.expect(public.interviewer_reminders(r1), null, 'preview');
  assert pg_temp.states(v_res) = 'Nora:submitted,Pat:due,Vera:due', format('preview: %s', v_res);
  assert v_res ->> 'claimed_at' is null and v_res ->> 'candidate_name' = 'Two' and v_res ->> 'job_title' = 'A1'
     and v_res ->> 'interview_name' = 'Remind one'
     and v_res ->> 'application_id' = 'e0000000-0000-4000-8000-000000000002', format('details: %s', v_res);
  assert pg_temp.states(public.interviewer_reminders(r1)) = 'Nora:submitted,Pat:due,Vera:due', 'preview again';
  -- The claim stamps the due ones; a second one within 24 h gets nobody.
  v_res := pg_temp.expect(public.interviewer_reminders(r1, true), null, 'claim');
  assert pg_temp.states(v_res) = 'Nora:submitted,Pat:claimed,Vera:claimed', format('claim: %s', v_res);
  assert v_res ->> 'claimed_at' is not null, 'claimed_at';
  v_res := public.interviewer_reminders(r1, true);
  assert pg_temp.states(v_res) = 'Nora:submitted,Pat:recent,Vera:recent', format('second claim: %s', v_res);
  -- Not before it starts, not on a no-show, not after the kit closed.
  perform pg_temp.expect(public.interviewer_reminders('f1800000-0000-4000-8000-000000000002', true), 'not_started', 'tomorrow');
  perform pg_temp.expect(public.interviewer_reminders('f1300000-0000-4000-8000-000000000002', true), 'no_feedback', 'no-show');
  perform pg_temp.expect(public.interviewer_reminders('f1800000-0000-4000-8000-000000000003', true), 'feedback_closed', 'old');
  perform pg_temp.expect(public.interviewer_reminders(gen_random_uuid()), 'not_found', 'unknown');
  -- Members can't release a claim.
  assert pg_temp.denied(format('select public.release_interviewer_reminder(%L, %L, now())', r1,
    'c7000000-0000-4000-8000-000000000001')), 'members can''t release';
end $$;

-- Without scheduling.manage: Vera views but can't remind. Another company sees nothing.
select pg_temp.act('c7000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.interviewer_reminders('f1800000-0000-4000-8000-000000000001'), 'forbidden', 'Vera');
end $$;
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$ begin
  perform pg_temp.expect(public.interviewer_reminders('f1800000-0000-4000-8000-000000000001'), 'not_found', 'Globex');
end $$;
select pg_temp.act(null);
reset role;

-- 24 hours later, and a failed send released: due again.
do $$
declare
  r1 uuid := 'f1800000-0000-4000-8000-000000000001';
  vera uuid := 'c7000000-0000-4000-8000-000000000001';
  v_at timestamptz;
begin
  update public.scheduled_interview_panel set reminded_at = now() - interval '25 hours'
   where interview_id = r1 and user_id = 'c4000000-0000-4000-8000-000000000001';
  select reminded_at into v_at from public.scheduled_interview_panel where interview_id = r1 and user_id = vera;
  assert public.release_interviewer_reminder(r1, vera, v_at), 'release';
  assert not public.release_interviewer_reminder(r1, vera, v_at), 'release once';
end $$;
set local role authenticated;
select pg_temp.act('c2000000-0000-4000-8000-000000000001');
do $$ begin
  assert pg_temp.states(public.interviewer_reminders('f1800000-0000-4000-8000-000000000001'))
    = 'Nora:submitted,Pat:due,Vera:due', 'due again';
end $$;
select pg_temp.act(null);
reset role;
-- A member who left the company isn't reminded.
delete from public.company_members where user_id = 'c4000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.act('c2000000-0000-4000-8000-000000000001');
do $$
declare v_res jsonb := public.interviewer_reminders('f1800000-0000-4000-8000-000000000001', true);
begin
  assert pg_temp.states(v_res) = 'Nora:submitted,Vera:claimed', format('former member dropped: %s', v_res);
end $$;
select pg_temp.act(null);
reset role;
set local role anon;
do $$ begin
  assert pg_temp.denied($q$select public.interviewer_reminders('f1800000-0000-4000-8000-000000000001')$q$), 'anon';
end $$;
reset role;

select 'recruiter_interviews: ok' as result;
rollback;
