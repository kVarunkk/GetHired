-- MT-TEST-007 and MTT-013: recruiter matching and screening. Runs in a
-- transaction that always rolls back:
--   npx supabase db query --linked -f supabase/tests/recruiter_matching.sql
-- It needs 20261015120000_recruiter_matching.sql and (block 2)
-- 20261015140000_recruiter_matching_screening.sql applied first. Any failed
-- check raises an exception; success prints 'recruiter_matching: ok'.
-- Ids match test/utils/recruiter.ts.

begin;

-- Seed: two companies (A, B), two applicants, one job each.
insert into auth.users (id, email, aud, role) values
  ('c1000000-0000-4000-8000-000000000001', 'hr@acme.test', 'authenticated', 'authenticated'),
  ('c1000000-0000-4000-8000-000000000002', 'hr@globex.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000001', 'public@applicant.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000003', 'private@applicant.test', 'authenticated', 'authenticated');

insert into public.company_info (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Acme', 'hr@acme.test'),
  ('c0000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'Globex', 'hr@globex.test');

insert into public.user_info (user_id, email, full_name, is_public, filled) values
  ('a0000000-0000-4000-8000-000000000001', 'public@applicant.test', 'Public', true, true),
  ('a0000000-0000-4000-8000-000000000003', 'private@applicant.test', 'Private', false, true);

insert into public.all_jobs (id, job_name, job_url, company_name, platform) values
  ('d0000000-0000-4000-8000-000000000001', 'A job', 'https://acme.test/jobs/1', 'Acme', 'gethired'),
  ('d0000000-0000-4000-8000-000000000002', 'B job', 'https://globex.test/jobs/1', 'Globex', 'gethired');

insert into public.job_postings (id, company_id, title, job_id) values
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'A job', 'd0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'B job', 'd0000000-0000-4000-8000-000000000002');

insert into public.job_relevant_profiles
  (job_posting_id, user_id, relevance_rank, match_score, skills_score, experience_score,
   preference_conflict, explanation, explanation_status) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 1, 82, 3.20, 3.00, 0.10,
   '{"summary":"A summary"}', 'completed'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 1, 70, 3.00, 2.50, 0.20,
   null, 'none');

-- ------------------------------------------------- block 1: §3.1 columns
do $$
begin
  begin
    update public.job_relevant_profiles set match_score = 101
     where job_posting_id = 'b0000000-0000-4000-8000-000000000001';
    raise exception 'match_score 101 was accepted';
  exception when check_violation then null;
  end;

  begin
    update public.job_relevant_profiles set skills_score = 4.5
     where job_posting_id = 'b0000000-0000-4000-8000-000000000001';
    raise exception 'skills_score 4.5 was accepted';
  exception when check_violation then null;
  end;

  begin
    update public.job_relevant_profiles set explanation_status = 'bogus'
     where job_posting_id = 'b0000000-0000-4000-8000-000000000001';
    raise exception 'explanation_status bogus was accepted';
  exception when check_violation then null;
  end;

  update public.job_relevant_profiles set explanation_status = 'skipped_quota'
   where job_posting_id = 'b0000000-0000-4000-8000-000000000002';
  update public.job_relevant_profiles set explanation_status = 'none'
   where job_posting_id = 'b0000000-0000-4000-8000-000000000002';

  begin
    insert into public.job_relevant_profiles (job_posting_id, user_id, relevance_rank)
      values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 2);
    raise exception 'a duplicate (job_posting_id, user_id) was accepted';
  exception when unique_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------- company A
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  n int;
  score smallint;
begin
  -- Its own job's rows, with the score columns.
  select match_score into score from public.job_relevant_profiles
   where job_posting_id = 'b0000000-0000-4000-8000-000000000001';
  assert score = 82, format('company A reads its own match_score: %s', score);

  -- Not company B's.
  select count(*) into n from public.job_relevant_profiles
   where job_posting_id = 'b0000000-0000-4000-8000-000000000002';
  assert n = 0, 'company A can see company B''s matches';

  -- Scores and explanations can't be changed (no UPDATE policy).
  update public.job_relevant_profiles
     set match_score = 100, explanation = '{"summary":"forged"}', explanation_status = 'completed'
   where job_posting_id = 'b0000000-0000-4000-8000-000000000001';
  assert (select (match_score, explanation->>'summary')
            = (82::smallint, 'A summary'::text)
          from public.job_relevant_profiles
          where job_posting_id = 'b0000000-0000-4000-8000-000000000001'),
    'company A changed its own match_score or explanation';

  -- No inserts: a row would vouch for a candidate the company can't see.
  begin
    insert into public.job_relevant_profiles (job_posting_id, user_id, relevance_rank)
      values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 2);
    raise exception 'company A inserted a match for a private candidate';
  exception when insufficient_privilege then null;
  end;

  -- No deletes either.
  delete from public.job_relevant_profiles
   where job_posting_id = 'b0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'company A deleted its matches';
end $$;

reset role;

-- ------------------------------------------- block 2: §3.2 and §3.4 (MTT-050)
-- Applications: one to each platform job, and one with no job post.
insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id, answers) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', '{}'),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', '{}'),
  ('e0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003',
   null, 'd0000000-0000-4000-8000-000000000001', '{}');

do $$
declare
  n int;
  s record;
begin
  -- A platform job's application gets one queued screening and one message.
  select * into s from public.application_screenings
   where application_id = 'e0000000-0000-4000-8000-000000000001';
  assert s.id is not null, 'no screening for a platform job application';
  assert s.status = 'queued', format('screening status is %s', s.status);
  assert s.company_id = 'c0000000-0000-4000-8000-000000000001',
    'screening company_id isn''t the job''s company';
  assert s.job_post_id = 'b0000000-0000-4000-8000-000000000001', 'screening job_post_id is wrong';
  assert s.previous_result is null, 'previous_result should start empty';

  select count(*) into n from pgmq.q_application_screening_queue
   where message->>'application_id' = 'e0000000-0000-4000-8000-000000000001';
  assert n = 1, format('expected one queue message, got %s', n);

  -- No job post: neither a screening nor a message.
  select count(*) into n from public.application_screenings
   where application_id = 'e0000000-0000-4000-8000-000000000003';
  assert n = 0, 'an application without a job post was screened';
  select count(*) into n from pgmq.q_application_screening_queue
   where message->>'application_id' = 'e0000000-0000-4000-8000-000000000003';
  assert n = 0, 'an application without a job post was queued';

  -- Re-inserting the same application (on conflict) doesn't duplicate.
  insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id, answers)
    values ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
            'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', '{}')
    on conflict (id) do nothing;
  select count(*) into n from public.application_screenings
   where application_id = 'e0000000-0000-4000-8000-000000000001';
  assert n = 1, format('expected one screening after a re-insert, got %s', n);
  select count(*) into n from pgmq.q_application_screening_queue
   where message->>'application_id' = 'e0000000-0000-4000-8000-000000000001';
  assert n = 1, format('expected one message after a re-insert, got %s', n);

  begin
    insert into public.application_screenings (application_id, job_post_id, company_id)
      values ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
              'c0000000-0000-4000-8000-000000000001');
    raise exception 'a second screening for one application was accepted';
  exception when unique_violation then null;
  end;

  -- Status values.
  update public.application_screenings set status = 'skipped_quota'
   where application_id = 'e0000000-0000-4000-8000-000000000002';
  begin
    update public.application_screenings set status = 'bogus'
     where application_id = 'e0000000-0000-4000-8000-000000000002';
    raise exception 'screening status bogus was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.application_screenings set fit_score = 101
     where application_id = 'e0000000-0000-4000-8000-000000000002';
    raise exception 'fit_score 101 was accepted';
  exception when check_violation then null;
  end;

  update public.application_screenings
     set status = 'completed', fit_score = 81, recommendation = 'yes',
         result = '{"summary":"A screening"}', previous_result = '{"summary":"older"}'
   where application_id = 'e0000000-0000-4000-8000-000000000001';
end $$;

-- Company A: its own screenings, not company B's, and no writes (MT-SEC-004).
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  n int;
  score smallint;
begin
  select fit_score into score from public.application_screenings
   where application_id = 'e0000000-0000-4000-8000-000000000001';
  assert score = 81, format('company A reads its own screening: %s', score);

  select count(*) into n from public.application_screenings
   where application_id = 'e0000000-0000-4000-8000-000000000002';
  assert n = 0, 'company A can see company B''s screening';

  begin
    insert into public.application_screenings (application_id, job_post_id, company_id)
      values ('e0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001',
              'c0000000-0000-4000-8000-000000000001');
    raise exception 'company A inserted a screening';
  exception when insufficient_privilege then null;
  end;

  update public.application_screenings set fit_score = 100, recommendation = 'strong_yes'
   where application_id = 'e0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'company A updated its screening';

  delete from public.application_screenings
   where application_id = 'e0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'company A deleted its screening';
end $$;

reset role;

-- The applicant can't read their own screening (MT-REQ-009).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  n int;
begin
  select count(*) into n from public.application_screenings;
  assert n = 0, format('the applicant can read %s screenings', n);
end $$;

reset role;

select 'recruiter_matching: ok';

rollback;
