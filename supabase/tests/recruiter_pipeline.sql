-- PL-TEST-008 and PLT-010: the recruiter pipeline. Runs in a transaction that
-- always rolls back:
--   npx supabase db query --linked -f supabase/tests/recruiter_pipeline.sql
-- It needs the 20261015*_recruiter_pipeline*.sql migrations applied first. Any failed
-- check raises an exception; success prints 'recruiter_pipeline: ok'.
-- Ids match test/utils/recruiter.ts.

begin;

-- Seed: two companies (A, B), two applicants, one job each.
insert into auth.users (id, email, aud, role) values
  ('c1000000-0000-4000-8000-000000000001', 'hr@acme.test', 'authenticated', 'authenticated'),
  ('c1000000-0000-4000-8000-000000000002', 'hr@globex.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000001', 'public@applicant.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000002', 'applied@applicant.test', 'authenticated', 'authenticated');

insert into public.company_info (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Acme', 'hr@acme.test'),
  ('c0000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'Globex', 'hr@globex.test');

insert into public.user_info (user_id, email, full_name, is_public, filled) values
  ('a0000000-0000-4000-8000-000000000001', 'public@applicant.test', 'Public', true, true),
  ('a0000000-0000-4000-8000-000000000002', 'applied@applicant.test', 'Applied', false, true);

insert into public.all_jobs (id, job_name, job_url, company_name, platform) values
  ('d0000000-0000-4000-8000-000000000001', 'A job', 'https://acme.test/jobs/1', 'Acme', 'gethired'),
  ('d0000000-0000-4000-8000-000000000002', 'B job', 'https://globex.test/jobs/1', 'Globex', 'gethired'),
  ('d0000000-0000-4000-8000-000000000003', 'Elsewhere', 'https://elsewhere.test/1', 'Elsewhere', 'linkedin');

insert into public.job_postings (id, company_id, title, job_id) values
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'A job', 'd0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'B job', 'd0000000-0000-4000-8000-000000000002');

-- The stage ids, for the blocks that run as a user (who can't read them all).
create or replace function pg_temp.stage(p_company text, p_kind public.pipeline_stage_kind)
returns uuid language sql as $$
  select id from public.pipeline_stages
  where company_id = ('c0000000-0000-4000-8000-00000000000' || p_company)::uuid and kind = p_kind
$$;

-- ------------------------------------------------------------ block 1: seed
do $$
declare
  n int;
  names text[];
begin
  select count(*), array_agg(name order by position) into n, names
    from public.pipeline_stages where company_id = 'c0000000-0000-4000-8000-000000000001';
  assert n = 7, format('a new company got %s stages', n);
  assert names = array['Applied','Screening','Interview','Offer','Hired','Rejected','On hold'],
    format('default stages are %s', names);

  perform public.seed_default_pipeline('c0000000-0000-4000-8000-000000000001');
  perform public.seed_default_pipeline('c0000000-0000-4000-8000-000000000001');
  select count(*) into n from public.pipeline_stages
   where company_id = 'c0000000-0000-4000-8000-000000000001';
  assert n = 7, format('seeding twice left %s stages', n);

  perform set_config('test.a_applied', pg_temp.stage('1', 'applied')::text, true);
  perform set_config('test.a_screening', pg_temp.stage('1', 'screening')::text, true);
  perform set_config('test.a_interview', pg_temp.stage('1', 'interview')::text, true);
  perform set_config('test.a_offer', pg_temp.stage('1', 'offer')::text, true);
  perform set_config('test.a_hired', pg_temp.stage('1', 'hired')::text, true);
  perform set_config('test.a_rejected', pg_temp.stage('1', 'rejected')::text, true);
  perform set_config('test.a_on_hold', pg_temp.stage('1', 'on_hold')::text, true);
  perform set_config('test.b_interview', pg_temp.stage('2', 'interview')::text, true);
end $$;

-- ----------------------------------------- block 1: new application (applicant)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  -- Tries to pick its own stage, status and source.
  insert into public.applications
    (id, applicant_user_id, job_post_id, all_jobs_id, answers, status, stage_id, source)
  values
    ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
     'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', '{}',
     'selected', current_setting('test.a_hired')::uuid, 'outreach');

  -- An off-platform tracker row.
  insert into public.applications (id, applicant_user_id, all_jobs_id, answers, status)
  values
    ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001',
     'd0000000-0000-4000-8000-000000000003', '{}', 'submitted');
end $$;

reset role;

do $$
declare
  a record;
  n int;
begin
  select * into a from public.applications where id = 'e0000000-0000-4000-8000-000000000001';
  assert a.stage_id = current_setting('test.a_applied')::uuid, 'a new application isn''t in Applied';
  assert a.status = 'submitted', format('a new application has status %s', a.status);
  assert a.source = 'applied', format('a new application has source %s', a.source);

  select count(*) into n from public.application_events
   where application_id = a.id and type = 'applied'
     and company_id = 'c0000000-0000-4000-8000-000000000001'
     and candidate_user_id = 'a0000000-0000-4000-8000-000000000001';
  assert n = 1, format('expected one applied event, got %s', n);

  select * into a from public.applications where id = 'e0000000-0000-4000-8000-000000000002';
  assert a.stage_id is null, 'an off-platform application got a stage';
  select count(*) into n from public.application_events where application_id = a.id;
  assert n = 0, 'an off-platform application got an event';
end $$;

-- Company B's application, for the RLS and backfill checks.
insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id, answers) values
  ('e0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', '{}');

-- ------------------------------------------------------- block 1: sync (company A)
update public.applications set stage_entered_at = '2020-01-01'
 where id = 'e0000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  a record;
  n int;
  app constant uuid := 'e0000000-0000-4000-8000-000000000001';
begin
  update public.applications set stage_id = current_setting('test.a_interview')::uuid where id = app;
  select * into a from public.applications where id = app;
  assert a.status = 'reviewed', format('Interview set status %s', a.status);
  assert a.stage_entered_at = now(), 'moving didn''t reset stage_entered_at';

  update public.applications set stage_id = current_setting('test.a_hired')::uuid where id = app;
  assert (select status from public.applications where id = app) = 'selected', 'Hired isn''t selected';

  update public.applications set stage_id = current_setting('test.a_on_hold')::uuid where id = app;
  assert (select status from public.applications where id = app) = 'stand_by', 'On hold isn''t stand_by';

  -- Difference 4: a direct status write moves the stage.
  update public.applications set status = 'rejected' where id = app;
  select * into a from public.applications where id = app;
  assert a.stage_id = current_setting('test.a_rejected')::uuid,
    'a direct status = rejected didn''t move to Rejected';

  -- Guards (difference 3): another company's stage, an archived stage.
  begin
    update public.applications set stage_id = current_setting('test.b_interview')::uuid where id = app;
    raise exception 'company A moved an application to company B''s stage';
  exception when check_violation then null;
  end;

  update public.pipeline_stages set archived = true where id = current_setting('test.a_offer')::uuid;
  begin
    update public.applications set stage_id = current_setting('test.a_offer')::uuid where id = app;
    raise exception 'company A moved an application to an archived stage';
  exception when check_violation then null;
  end;

  begin
    update public.pipeline_stages set archived = true where id = current_setting('test.a_hired')::uuid;
    raise exception 'company A archived the Hired stage';
  exception when check_violation then null;
  end;

  begin
    update public.pipeline_stages set kind = 'hired' where id = current_setting('test.a_screening')::uuid;
    raise exception 'company A changed a stage''s kind';
  exception when check_violation then null;
  end;

  -- RLS (PL-SEC-001): its own stages and events, not company B's.
  select count(*) into n from public.pipeline_stages;
  assert n = 7, format('company A sees %s stages', n);
  select count(*) into n from public.pipeline_stages
   where company_id = 'c0000000-0000-4000-8000-000000000002';
  assert n = 0, 'company A sees company B''s stages';

  select count(*) into n from public.application_events where application_id = app;
  assert n = 1, format('company A sees %s events on its application', n);
  select count(*) into n from public.application_events
   where company_id = 'c0000000-0000-4000-8000-000000000002';
  assert n = 0, 'company A sees company B''s events';

  -- Events are append-only.
  update public.application_events set payload = '{"forged":true}' where application_id = app;
  get diagnostics n = row_count;
  assert n = 0, 'company A updated an event';
  delete from public.application_events where application_id = app;
  get diagnostics n = row_count;
  assert n = 0, 'company A deleted an event';

  insert into public.application_events (company_id, application_id, type)
    values ('c0000000-0000-4000-8000-000000000001', app, 'stage_changed');

  begin
    insert into public.application_events (company_id, type)
      values ('c0000000-0000-4000-8000-000000000002', 'note_added');
    raise exception 'company A inserted an event for company B';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.application_events (company_id, application_id, type)
      values ('c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000003',
              'stage_changed');
    raise exception 'company A logged an event on company B''s application';
  exception when insufficient_privilege then null;
  end;

  -- Reorder: one call, exactly the active stages.
  perform public.reorder_pipeline_stages(array[
    current_setting('test.a_screening')::uuid, current_setting('test.a_applied')::uuid,
    current_setting('test.a_interview')::uuid, current_setting('test.a_hired')::uuid,
    current_setting('test.a_rejected')::uuid, current_setting('test.a_on_hold')::uuid]);
  assert (select position from public.pipeline_stages where id = current_setting('test.a_screening')::uuid) = 0,
    'reorder didn''t move Screening first';
  assert (select position from public.pipeline_stages where id = current_setting('test.a_offer')::uuid) = 6,
    'reorder didn''t put the archived stage last';

  begin
    perform public.reorder_pipeline_stages(array[current_setting('test.a_applied')::uuid]);
    raise exception 'reorder accepted a partial list';
  exception when check_violation then null;
  end;

  begin
    perform public.reorder_pipeline_stages(array[current_setting('test.b_interview')::uuid]);
    raise exception 'company A reordered company B''s stages';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- --------------------------------------------- block 1: guards (applicant)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  n int;
  app constant uuid := 'e0000000-0000-4000-8000-000000000001';
begin
  begin
    update public.applications set status = 'selected' where id = app;
    raise exception 'the applicant set the status of a platform application';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.applications set stage_id = current_setting('test.a_hired')::uuid where id = app;
    raise exception 'the applicant set the stage of a platform application';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.applications set source = 'outreach' where id = app;
    raise exception 'the applicant set the source of a platform application';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.applications set job_post_id = null where id = app;
    raise exception 'the applicant detached a platform application from its job';
  exception when insufficient_privilege then null;
  end;

  -- Other columns of their own application still work.
  update public.applications set answers = '{"hello"}' where id = app;

  -- The off-platform tracker still works.
  update public.applications set status = 'selected'
   where id = 'e0000000-0000-4000-8000-000000000002';
  assert (select status from public.applications where id = 'e0000000-0000-4000-8000-000000000002')
    = 'selected', 'the applicant can''t update their off-platform status';

  -- PL-SEC-004: no events or stages for candidates.
  select count(*) into n from public.application_events;
  assert n = 0, format('the applicant sees %s events', n);
  select count(*) into n from public.pipeline_stages;
  assert n = 0, format('the applicant sees %s stages', n);
end $$;

reset role;

-- ------------------------------------------------------- block 1: backfill
-- Simulate rows from before the migration: no stage, no applied event.
update public.applications set status = 'reviewed', updated_at = '2025-06-01'
 where id = 'e0000000-0000-4000-8000-000000000003';
update public.applications set stage_id = null
 where id = 'e0000000-0000-4000-8000-000000000003';
delete from public.application_events where application_id = 'e0000000-0000-4000-8000-000000000003';
update public.applications set created_at = '2025-05-01'
 where id = 'e0000000-0000-4000-8000-000000000003';

do $$
declare
  a record;
  n int;
  before_count int;
  app constant uuid := 'e0000000-0000-4000-8000-000000000003';
begin
  assert (select stage_id from public.applications where id = app) is null, 'setup: stage not cleared';

  perform public.backfill_recruiter_pipeline();

  select * into a from public.applications where id = app;
  assert a.stage_id = pg_temp.stage('2', 'screening'), 'backfill didn''t map reviewed to Screening';
  assert a.status = 'reviewed', format('backfill changed the status to %s', a.status);
  assert a.stage_entered_at = '2025-06-01'::timestamptz, 'stage_entered_at isn''t updated_at';

  select count(*) into n from public.application_events
   where application_id = app and type = 'applied' and created_at = '2025-05-01'::timestamptz;
  assert n = 1, format('expected one backfilled applied event at created_at, got %s', n);

  -- Every status maps per the inverse table.
  assert public.pipeline_kind_for_status('submitted') = 'applied', 'submitted';
  assert public.pipeline_kind_for_status('reviewed') = 'screening', 'reviewed';
  assert public.pipeline_kind_for_status('selected') = 'hired', 'selected';
  assert public.pipeline_kind_for_status('rejected') = 'rejected', 'rejected';
  assert public.pipeline_kind_for_status('stand_by') = 'on_hold', 'stand_by';

  -- A second run changes nothing.
  select count(*) into before_count from public.application_events;
  perform public.backfill_recruiter_pipeline();
  select count(*) into n from public.application_events;
  assert n = before_count, 'a second backfill added events';
  assert (select stage_entered_at from public.applications where id = app) = '2025-06-01'::timestamptz,
    'a second backfill touched the application';
  select count(*) into n from public.pipeline_stages
   where company_id in ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002');
  assert n = 14, format('a second backfill left %s stages', n);
end $$;

-- ------------------------------------------- block 2: notes (PLT-050, company A)
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  n int;
  me constant uuid := 'c1000000-0000-4000-8000-000000000001';
  a_co constant uuid := 'c0000000-0000-4000-8000-000000000001';
  b_co constant uuid := 'c0000000-0000-4000-8000-000000000002';
  applicant constant uuid := 'a0000000-0000-4000-8000-000000000001';
  a_app constant uuid := 'e0000000-0000-4000-8000-000000000001';
begin
  -- On its own applicant's application, with a rating.
  insert into public.candidate_notes (id, company_id, candidate_user_id, application_id, author_user_id, author_name, body, rating)
  values ('f0000000-0000-4000-8000-000000000001', a_co, applicant, a_app, me, 'Asha', 'Strong systems answers.', 'yes');
  -- On a public talent-pool candidate, without an application.
  insert into public.candidate_notes (company_id, candidate_user_id, author_user_id, body)
  values (a_co, applicant, me, 'Saw their OSS work.');

  begin
    insert into public.candidate_notes (company_id, candidate_user_id, author_user_id, body)
    values (a_co, applicant, me, '');
    raise exception 'an empty note was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.candidate_notes (company_id, candidate_user_id, author_user_id, body)
    values (a_co, applicant, me, repeat('x', 5001));
    raise exception 'a 5,001-char note was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.candidate_notes (company_id, candidate_user_id, author_user_id, body, rating)
    values (a_co, applicant, me, 'Hmm', 'maybe');
    raise exception 'rating maybe was accepted';
  exception when invalid_text_representation then null;
  end;

  -- Company B's company_id, another author, or a private candidate who only
  -- applied to company B: all refused.
  begin
    insert into public.candidate_notes (company_id, candidate_user_id, author_user_id, body)
    values (b_co, applicant, me, 'Not mine');
    raise exception 'a note with company B''s company_id was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.candidate_notes (company_id, candidate_user_id, author_user_id, body)
    values (a_co, applicant, 'c1000000-0000-4000-8000-000000000002', 'Forged author');
    raise exception 'a note by another author was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.candidate_notes (company_id, candidate_user_id, author_user_id, body)
    values (a_co, 'a0000000-0000-4000-8000-000000000002', me, 'Not visible');
    raise exception 'a note on a candidate company A can''t view was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.candidate_notes (company_id, candidate_user_id, application_id, author_user_id, body)
    values (a_co, applicant, 'e0000000-0000-4000-8000-000000000003', me, 'B''s application');
    raise exception 'a note on company B''s application was accepted';
  exception when insufficient_privilege then null;
  end;

  -- The author edits; the note can't move to another candidate.
  update public.candidate_notes set body = 'Edited', rating = 'strong_yes'
   where id = 'f0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 1, 'the author couldn''t edit their note';
  begin
    update public.candidate_notes set candidate_user_id = 'a0000000-0000-4000-8000-000000000002'
     where id = 'f0000000-0000-4000-8000-000000000001';
    raise exception 'a note moved to another candidate';
  exception when check_violation then null;
  end;

  select count(*) into n from public.candidate_notes where company_id = a_co;
  assert n = 2, format('company A sees %s notes', n);
end $$;

reset role;

-- A note by company B on its own applicant, for the isolation checks.
insert into public.candidate_notes (company_id, candidate_user_id, application_id, author_user_id, body)
values ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
        'e0000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000002', 'B only');

do $$
declare
  n int;
begin
  -- Without a teams table, a second member can't be simulated: check that
  -- update and delete are limited to the author.
  select count(*) into n from pg_policies
   where tablename = 'candidate_notes' and cmd in ('UPDATE', 'DELETE')
     and qual like '%author_user_id = ( SELECT auth.uid()%';
  assert n = 2, format('expected author-only update and delete policies, got %s', n);
  select count(*) into n from pg_policies
   where tablename = 'candidate_notes' and cmd = 'SELECT' and qual not like '%author_user_id%';
  assert n = 1, 'members should read every note of their company';
end $$;

select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  n int;
begin
  select count(*) into n from public.candidate_notes
   where company_id = 'c0000000-0000-4000-8000-000000000002';
  assert n = 0, 'company A reads company B''s notes';
  update public.candidate_notes set body = 'x' where company_id = 'c0000000-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  assert n = 0, 'company A updated company B''s note';
end $$;
reset role;

-- The candidate sees none of the notes about them (PL-SEC-004).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  n int;
begin
  select count(*) into n from public.candidate_notes;
  assert n = 0, format('the candidate sees %s notes', n);
end $$;
reset role;

-- -------------------------------------- block 3: templates and settings (PLT-061)
do $$
declare
  n int;
  purposes text[];
begin
  -- The test's new companies were seeded by the trigger: one default per purpose.
  select count(*), array_agg(purpose order by purpose) into n, purposes
    from public.company_email_templates
   where company_id = 'c0000000-0000-4000-8000-000000000001' and is_default;
  assert n = 5, format('company A got %s default templates', n);
  assert purposes = array['advance','custom','interview_invite','offer','rejection'],
    format('default purposes are %s', purposes);

  perform public.seed_default_templates('c0000000-0000-4000-8000-000000000001');
  select count(*) into n from public.company_email_templates
   where company_id = 'c0000000-0000-4000-8000-000000000001';
  assert n = 5, format('seeding twice left %s templates', n);

  -- Every existing company has its defaults (the migration's backfill).
  select count(*) into n from public.company_info ci
   where (select count(*) from public.company_email_templates t
           where t.company_id = ci.id and t.is_default) <> 5;
  assert n = 0, format('%s companies lack the default templates', n);

  -- Checks.
  begin
    insert into public.company_email_templates (company_id, purpose, name, subject, body_md)
    values ('c0000000-0000-4000-8000-000000000001', 'spam', 'x', 'x', 'x');
    raise exception 'purpose spam was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.company_email_templates (company_id, purpose, name, subject, body_md)
    values ('c0000000-0000-4000-8000-000000000001', 'custom', 'x', repeat('x', 151), 'x');
    raise exception 'a 151-char subject was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.company_email_templates (company_id, purpose, name, subject, body_md)
    values ('c0000000-0000-4000-8000-000000000001', 'custom', 'x', 'x', repeat('x', 5001));
    raise exception 'a 5,001-char body was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.company_email_templates (company_id, purpose, name, subject, body_md, is_default)
    values ('c0000000-0000-4000-8000-000000000001', 'rejection', 'Second', 'x', 'x', true);
    raise exception 'a second default rejection was accepted';
  exception when unique_violation then null;
  end;

  -- scheduling_url is https only.
  begin
    update public.company_info set scheduling_url = 'http://cal.com/acme'
     where id = 'c0000000-0000-4000-8000-000000000001';
    raise exception 'an http scheduling_url was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.company_info set scheduling_url = 'javascript:alert(1)'
     where id = 'c0000000-0000-4000-8000-000000000001';
    raise exception 'a javascript: scheduling_url was accepted';
  exception when check_violation then null;
  end;
  update public.company_info set scheduling_url = 'https://cal.com/acme/intro'
   where id = 'c0000000-0000-4000-8000-000000000001';

  assert (select notify_new_applicants from public.company_info
           where id = 'c0000000-0000-4000-8000-000000000001') = 'daily', 'notify_new_applicants isn''t daily';
  assert (select notify_weekly_matches from public.company_info
           where id = 'c0000000-0000-4000-8000-000000000001'), 'notify_weekly_matches isn''t on';
end $$;

select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  n int;
begin
  select count(*) into n from public.company_email_templates
   where company_id = 'c0000000-0000-4000-8000-000000000002';
  assert n = 0, 'company A reads company B''s templates';
  select count(*) into n from public.company_email_templates
   where company_id = 'c0000000-0000-4000-8000-000000000001';
  assert n = 5, format('company A sees %s of its templates', n);

  update public.company_email_templates set subject = 'Hijacked'
   where company_id = 'c0000000-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  assert n = 0, 'company A updated company B''s template';

  begin
    insert into public.company_email_templates (company_id, purpose, name, subject, body_md)
    values ('c0000000-0000-4000-8000-000000000002', 'custom', 'x', 'x', 'x');
    raise exception 'company A inserted a template for company B';
  exception when insufficient_privilege then null;
  end;

  -- The owner sets their notification settings, but not the digest watermark.
  update public.company_info
     set notify_new_applicants = 'instant', last_applicant_digest_at = now()
   where id = 'c0000000-0000-4000-8000-000000000001';
end $$;
reset role;

do $$
begin
  assert (select notify_new_applicants from public.company_info
           where id = 'c0000000-0000-4000-8000-000000000001') = 'instant',
    'the owner couldn''t change notify_new_applicants';
  assert (select last_applicant_digest_at from public.company_info
           where id = 'c0000000-0000-4000-8000-000000000001') is null,
    'the owner moved the digest watermark';
end $$;

-- The candidate sees no templates.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  assert (select count(*) from public.company_email_templates) = 0, 'the candidate sees templates';
end $$;
reset role;

-- ------------------------------------- block 4: instant notifications (PLT-070)
-- Company A was set to instant in block 3; company B is on the daily default.
do $$
declare
  before_count bigint;
  n bigint;
  msg jsonb;
  screenings int;
begin
  select count(*) into before_count from pgmq.q_company_notification_queue;

  insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id, answers) values
    ('e0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000002',
     'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', '{}');

  select count(*) into n from pgmq.q_company_notification_queue;
  assert n = before_count + 1, format('instant: expected one message, got %s', n - before_count);
  select message into msg from pgmq.q_company_notification_queue order by msg_id desc limit 1;
  assert msg = jsonb_build_object(
      'type', 'new_applicant',
      'applicationId', 'e0000000-0000-4000-8000-000000000010',
      'jobPostId', 'b0000000-0000-4000-8000-000000000001'),
    format('unexpected message %s', msg);

  -- The screening trigger still fires (difference 7).
  select count(*) into screenings from public.application_screenings
   where application_id = 'e0000000-0000-4000-8000-000000000010';
  assert screenings = 1, 'the screening trigger didn''t fire';

  -- Daily (company B) and off send nothing.
  insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id, answers) values
    ('e0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000001',
     'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', '{}');
  update public.company_info set notify_new_applicants = 'off'
   where id = 'c0000000-0000-4000-8000-000000000001';
  delete from public.applications where id = 'e0000000-0000-4000-8000-000000000010';
  insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id, answers) values
    ('e0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000002',
     'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', '{}');
  select count(*) into n from pgmq.q_company_notification_queue;
  assert n = before_count + 1, format('daily or off sent %s messages', n - before_count - 1);

  -- A failure never blocks the insert: the queue is gone for this block.
  update public.company_info set notify_new_applicants = 'instant'
   where id = 'c0000000-0000-4000-8000-000000000001';
  insert into public.all_jobs (id, job_name, job_url, company_name, platform) values
    ('d0000000-0000-4000-8000-000000000004', 'A job 2', 'https://acme.test/jobs/2', 'Acme', 'gethired');
  alter table pgmq.q_company_notification_queue rename to q_company_notification_queue_away;
  insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id, answers) values
    ('e0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000001',
     'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', '{}');
  alter table pgmq.q_company_notification_queue_away rename to q_company_notification_queue;
  assert exists (select 1 from public.applications where id = 'e0000000-0000-4000-8000-000000000012'),
    'a queue failure blocked the application';

  -- The cron jobs exist and are off until the routes are deployed.
  select count(*) into n from cron.job
   where jobname in ('company-notifications-worker', 'applicant-digest-enqueue', 'applicant-digest-worker',
                     'weekly-matches-enqueue', 'weekly-matches-worker')
     and not active;
  assert n = 5, format('expected 5 inactive cron jobs, got %s', n);
end $$;

-- ------------------------------------------------ block 5: the funnel (PLT-080)
-- A fresh job for company A: 5 applied, 3 moved to Screening, 1 on to
-- Interview, then hired 10 days after applying. One came through the agent.
insert into public.all_jobs (id, job_name, job_url, company_name, platform) values
  ('d0000000-0000-4000-8000-000000000005', 'Funnel job', 'https://acme.test/jobs/5', 'Acme', 'gethired');
insert into public.job_postings (id, company_id, title, job_id) values
  ('b0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001', 'Funnel job',
   'd0000000-0000-4000-8000-000000000005');
insert into auth.users (id, email, aud, role)
select ('f5000000-0000-4000-8000-00000000000' || n)::uuid, 'funnel' || n || '@applicant.test',
       'authenticated', 'authenticated'
  from generate_series(1, 5) n;
insert into public.user_info (user_id, email, full_name, is_public, filled)
select ('f5000000-0000-4000-8000-00000000000' || n)::uuid, 'funnel' || n || '@applicant.test',
       'Funnel ' || n, false, true
  from generate_series(1, 5) n;
insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id, answers, created_at)
select ('e5000000-0000-4000-8000-00000000000' || n)::uuid, ('f5000000-0000-4000-8000-00000000000' || n)::uuid,
       'b0000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000005', '{}',
       '2026-01-01T00:00:00Z'
  from generate_series(1, 5) n;
update public.applications set source = 'agent' where id = 'e5000000-0000-4000-8000-000000000005';

-- The moves, and the stage_changed events moveApplications would have written.
update public.applications set stage_id = pg_temp.stage('1', 'hired')
 where id = 'e5000000-0000-4000-8000-000000000001';
update public.applications set stage_id = pg_temp.stage('1', 'screening')
 where id in ('e5000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000003');
insert into public.application_events (company_id, application_id, type, payload, created_at)
select 'c0000000-0000-4000-8000-000000000001', app::uuid, 'stage_changed',
       jsonb_build_object('to_stage_id', pg_temp.stage('1', kind::public.pipeline_stage_kind)), at::timestamptz
  from (values
    ('e5000000-0000-4000-8000-000000000001', 'screening', '2026-01-03T00:00:00Z'),
    ('e5000000-0000-4000-8000-000000000001', 'interview', '2026-01-06T00:00:00Z'),
    ('e5000000-0000-4000-8000-000000000001', 'hired', '2026-01-11T00:00:00Z'),
    ('e5000000-0000-4000-8000-000000000002', 'screening', '2026-01-05T00:00:00Z'),
    ('e5000000-0000-4000-8000-000000000003', 'screening', '2026-01-07T00:00:00Z')
  ) v(app, kind, at);

select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  f jsonb;
  s jsonb;
begin
  f := public.get_job_funnel('b0000000-0000-4000-8000-000000000005');
  assert f is not null, 'company A got no funnel for its own job';
  assert (f->>'total')::int = 5, format('total is %s', f->>'total');
  -- One per active stage, in order (block 1 archived one of company A's).
  assert jsonb_array_length(f->'stages') = (select count(*) from public.pipeline_stages
      where company_id = 'c0000000-0000-4000-8000-000000000001' and not archived),
    format('%s stages', jsonb_array_length(f->'stages'));
  assert (select array_agg((x->>'stage_id')::uuid order by i) from jsonb_array_elements(f->'stages') with ordinality t(x, i))
       = (select array_agg(id order by position) from public.pipeline_stages
           where company_id = 'c0000000-0000-4000-8000-000000000001' and not archived),
    'the stages aren''t in position order';

  -- applied: 2 still there, all 5 reached it, left after 2, 4 and 6 days.
  s := (select x from jsonb_array_elements(f->'stages') x where x->>'kind' = 'applied');
  assert (s->>'count')::int = 2 and (s->>'reached')::int = 5
         and (s->>'median_days')::numeric = 4, format('applied: %s', s);
  -- screening: 2 there, 3 reached, 1 left after 3 days.
  s := (select x from jsonb_array_elements(f->'stages') x where x->>'kind' = 'screening');
  assert (s->>'count')::int = 2 and (s->>'reached')::int = 3
         and (s->>'median_days')::numeric = 3, format('screening: %s', s);
  -- interview: none there now, 1 reached, 5 days.
  s := (select x from jsonb_array_elements(f->'stages') x where x->>'kind' = 'interview');
  assert (s->>'count')::int = 0 and (s->>'reached')::int = 1 and (s->>'median_days')::numeric = 5,
    format('interview: %s', s);
  -- rejected: no events, so no median.
  s := (select x from jsonb_array_elements(f->'stages') x where x->>'kind' = 'rejected');
  assert (s->>'reached')::int = 0 and s->'median_days' = 'null'::jsonb, format('rejected: %s', s);
  -- hired: 1, nobody has left it.
  s := (select x from jsonb_array_elements(f->'stages') x where x->>'kind' = 'hired');
  assert (s->>'count')::int = 1 and s->'median_days' = 'null'::jsonb, format('hired: %s', s);

  assert f->'sources' = '{"applied": 4, "agent": 1}'::jsonb, format('sources: %s', f->'sources');
  assert (f->>'time_to_hire_days')::numeric = 10, format('time to hire: %s', f->>'time_to_hire_days');
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  assert public.get_job_funnel('b0000000-0000-4000-8000-000000000005') is null,
    'company B got company A''s funnel';
end $$;
reset role;

-- ------------------------------------------------- block 6: talent lists (PLT-090)
-- A private candidate with no applications: company A can't view them.
insert into auth.users (id, email, aud, role)
values ('f6000000-0000-4000-8000-000000000001', 'hidden@applicant.test', 'authenticated', 'authenticated');
insert into public.user_info (user_id, email, full_name, is_public, filled)
values ('f6000000-0000-4000-8000-000000000001', 'hidden@applicant.test', 'Hidden', false, true);
insert into public.talent_lists (id, company_id, name) values
  ('a1000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-000000000002', 'B shortlist');

select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  n int;
  a_list constant uuid := 'a1000000-0000-4000-8000-00000000000a';
  b_list constant uuid := 'a1000000-0000-4000-8000-00000000000b';
begin
  insert into public.talent_lists (id, company_id, name)
  values (a_list, 'c0000000-0000-4000-8000-000000000001', 'Backend shortlist');
  begin
    insert into public.talent_lists (company_id, name) values ('c0000000-0000-4000-8000-000000000001', '');
    raise exception 'an empty list name was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.talent_lists (company_id, name) values ('c0000000-0000-4000-8000-000000000002', 'Theirs');
    raise exception 'company A created a list for company B';
  exception when insufficient_privilege then null;
  end;

  -- A public candidate can be added; a private one with no application to company A can't.
  insert into public.talent_list_members (list_id, candidate_user_id)
  values (a_list, 'a0000000-0000-4000-8000-000000000001');
  begin
    insert into public.talent_list_members (list_id, candidate_user_id)
    values (a_list, 'f5000000-0000-4000-8000-000000000001');
    -- f5…01 applied to company A's funnel job (block 5), so this one is allowed.
  end;
  begin
    insert into public.talent_list_members (list_id, candidate_user_id)
    values (a_list, 'f6000000-0000-4000-8000-000000000001');
    raise exception 'a candidate company A can''t view was added';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.talent_list_members (list_id, candidate_user_id)
    values (b_list, 'a0000000-0000-4000-8000-000000000001');
    raise exception 'company A added to company B''s list';
  exception when insufficient_privilege then null;
  end;

  select count(*) into n from public.talent_lists;
  assert n = 1, format('company A sees %s lists', n);
  select count(*) into n from public.talent_list_members where list_id = b_list;
  assert n = 0, 'company A sees company B''s list members';

  update public.talent_lists set name = 'Hijacked' where id = b_list;
  get diagnostics n = row_count;
  assert n = 0, 'company A renamed company B''s list';

  update public.talent_lists set name = 'Backend, shortlist' where id = a_list;
  get diagnostics n = row_count;
  assert n = 1, 'company A couldn''t rename its list';
  delete from public.talent_list_members
   where list_id = a_list and candidate_user_id = 'f5000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 1, 'company A couldn''t remove a member';
end $$;
reset role;

-- Deleting a list removes its members; the candidate sees nothing.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  assert (select count(*) from public.talent_lists) = 0, 'the candidate sees lists';
  assert (select count(*) from public.talent_list_members) = 0, 'the candidate sees list members';
end $$;
reset role;

delete from public.talent_lists where id = 'a1000000-0000-4000-8000-00000000000a';
do $$
begin
  assert not exists (select 1 from public.talent_list_members where list_id = 'a1000000-0000-4000-8000-00000000000a'),
    'deleting a list left its members';
end $$;

select 'recruiter_pipeline: ok';

rollback;
