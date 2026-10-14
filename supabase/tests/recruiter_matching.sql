-- MT-TEST-007 and MTT-013: recruiter matching and screening. Runs in a
-- transaction that always rolls back:
--   npx supabase db query --linked -f supabase/tests/recruiter_matching.sql
-- It needs 20261015120000_recruiter_matching.sql applied first. Any failed
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

select 'recruiter_matching: ok';

rollback;
