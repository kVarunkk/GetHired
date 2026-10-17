-- OR-TEST-001 (ORT-010, ORT-041, ORT-050, ORT-060, ORT-071): recruiter
-- outreach, contact gating, profile views, shared signals and draft limits.
-- Runs in a transaction that always rolls back:
--   npx supabase db query --linked -f supabase/tests/recruiter_outreach.sql
-- It needs the 20261016*_*.sql outreach migrations applied first. Any failed
-- check raises an exception; success prints 'recruiter_outreach: ok'.
-- Ids match test/utils/recruiter.ts where they overlap.

begin;

-- Seed: two companies (A, B) and six applicants:
--   1 public                       4 public, doesn't accept outreach
--   2 private, applied to A        5 public, will block A
--   3 private, never applied       6 public, for the 90-day cap
insert into auth.users (id, email, aud, role) values
  ('c1000000-0000-4000-8000-000000000001', 'hr@acme.test', 'authenticated', 'authenticated'),
  ('c1000000-0000-4000-8000-000000000002', 'hr@globex.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000001', 'public@applicant.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000002', 'applied@applicant.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000003', 'private@applicant.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000004', 'quiet@applicant.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000005', 'blocker@applicant.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000006', 'capped@applicant.test', 'authenticated', 'authenticated');

insert into public.company_info (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Acme', 'hr@acme.test'),
  ('c0000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'Globex', 'hr@globex.test');

insert into public.user_info (user_id, email, full_name, is_public, filled, accepts_outreach, linkedin_url) values
  ('a0000000-0000-4000-8000-000000000001', 'public@applicant.test', 'Public', true, true, true, 'https://linkedin.com/in/public'),
  ('a0000000-0000-4000-8000-000000000002', 'applied@applicant.test', 'Applied', false, true, true, null),
  ('a0000000-0000-4000-8000-000000000003', 'private@applicant.test', 'Private', false, true, true, null),
  ('a0000000-0000-4000-8000-000000000004', 'quiet@applicant.test', 'Quiet', true, true, false, null),
  ('a0000000-0000-4000-8000-000000000005', 'blocker@applicant.test', 'Blocker', true, true, true, null),
  ('a0000000-0000-4000-8000-000000000006', 'capped@applicant.test', 'Capped', true, true, true, null);

insert into public.all_jobs (id, job_name, job_url, company_name, platform) values
  ('d0000000-0000-4000-8000-000000000001', 'A job', 'https://acme.test/jobs/1', 'Acme', 'gethired'),
  ('d0000000-0000-4000-8000-000000000002', 'B job', 'https://globex.test/jobs/1', 'Globex', 'gethired'),
  ('d0000000-0000-4000-8000-000000000003', 'A job 2', 'https://acme.test/jobs/2', 'Acme', 'gethired'),
  ('d0000000-0000-4000-8000-000000000004', 'A job 3', 'https://acme.test/jobs/3', 'Acme', 'gethired'),
  ('d0000000-0000-4000-8000-000000000005', 'A job 4', 'https://acme.test/jobs/4', 'Acme', 'gethired');

insert into public.job_postings (id, company_id, title, job_id) values
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'A job', 'd0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'B job', 'd0000000-0000-4000-8000-000000000002'),
  ('b0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'A job 2', 'd0000000-0000-4000-8000-000000000003'),
  ('b0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'A job 3', 'd0000000-0000-4000-8000-000000000004'),
  ('b0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001', 'A job 4', 'd0000000-0000-4000-8000-000000000005');

insert into public.applications (applicant_user_id, job_post_id, all_jobs_id) values
  ('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001');

-- Runs `p_sql` and returns the P0001 message it raised, or 'ok'.
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when sqlstate 'P0001' then
  return sqlerrm;
end $$;

grant execute on function pg_temp.err(text) to authenticated;

-- ------------------------------------------------------- block 1: checks
do $$
declare
  long_subject text := repeat('s', 121);
  long_message text := repeat('m', 2001);
begin
  begin
    insert into public.candidate_outreach (company_id, candidate_user_id, subject, message)
    values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', long_subject, 'Hi');
    raise exception 'a 121-char subject was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.candidate_outreach (company_id, candidate_user_id, subject, message)
    values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Hi', '');
    raise exception 'an empty message was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.candidate_outreach (company_id, candidate_user_id, subject, message)
    values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Hi', long_message);
    raise exception 'a 2,001-char message was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.candidate_outreach (company_id, candidate_user_id, subject, message, candidate_note)
    values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Hi', 'Hi', repeat('n', 501));
    raise exception 'a 501-char note was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.candidate_outreach (company_id, candidate_user_id, subject, message, decline_reason)
    values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Hi', 'Hi', 'other_thing');
    raise exception 'an unknown decline reason was accepted';
  exception when check_violation then null;
  end;
end $$;

-- Candidate 5 blocks A (as themselves, through RLS).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
set local role authenticated;
insert into public.candidate_company_blocks (candidate_user_id, company_id)
values ('a0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001');
do $$
begin
  begin
    insert into public.candidate_company_blocks (candidate_user_id, company_id)
    values ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002');
    raise exception 'a candidate blocked a company for someone else';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ------------------------------------------------- block 1: send as company A
reset role;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  o public.candidate_outreach;
  e record;
  r text;
begin
  o := public.send_candidate_outreach(
    'f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001', 'Frontend role', 'Hi Public, interested?', 'manual');
  assert o.id = 'f0000000-0000-4000-8000-000000000001', 'p_id was not used as the id';
  assert o.status = 'sent' and o.source = 'manual', format('sent row: %s %s', o.status, o.source);
  assert o.sender_user_id = 'c1000000-0000-4000-8000-000000000001', 'sender is not auth.uid()';
  assert abs(extract(epoch from (o.expires_at - (now() + interval '30 days')))) < 5, 'expires_at is not ~30 days';

  select count(*) as n, min(application_id::text) as app, min(candidate_user_id::text) as cand,
         bool_and(payload ? 'outreach_id' and not payload ? 'message') as clean
    into e
    from public.application_events where type = 'outreach_sent' and payload->>'outreach_id' = o.id::text;
  assert e.n = 1 and e.app is null and e.cand = 'a0000000-0000-4000-8000-000000000001' and e.clean,
    format('outreach_sent event: %s', row_to_json(e));

  r := pg_temp.err($q$select public.send_candidate_outreach(null, 'a0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000002', 'Hi', 'Hi', 'manual')$q$);
  assert r = 'JOB_NOT_FOUND', format('another company''s job: %s', r);

  r := pg_temp.err($q$select public.send_candidate_outreach(null, 'a0000000-0000-4000-8000-000000000004',
    null, 'Hi', 'Hi', 'manual')$q$);
  assert r = 'NOT_ACCEPTING', format('accepts_outreach = false: %s', r);

  r := pg_temp.err($q$select public.send_candidate_outreach(null, 'a0000000-0000-4000-8000-000000000003',
    null, 'Hi', 'Hi', 'manual')$q$);
  assert r = 'NOT_FOUND', format('private non-applicant: %s', r);

  r := pg_temp.err($q$select public.send_candidate_outreach(null, 'a0000000-0000-4000-8000-000000000005',
    null, 'Hi', 'Hi', 'manual')$q$);
  assert r = 'NOT_FOUND', format('blocked: %s', r);

  r := pg_temp.err($q$select public.send_candidate_outreach(null, 'a0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001', 'Again', 'Again', 'manual')$q$);
  assert r = 'ALREADY_OPEN', format('second open send for the same job: %s', r);

  r := pg_temp.err($q$select public.send_candidate_outreach(null, 'a0000000-0000-4000-8000-000000000001',
    null, 'No job', 'No job', 'agent')$q$);
  assert r = 'ok', format('a no-job send next to a job send: %s', r);
  r := pg_temp.err($q$select public.send_candidate_outreach(null, 'a0000000-0000-4000-8000-000000000001',
    null, 'No job 2', 'No job 2', 'manual')$q$);
  assert r = 'ALREADY_OPEN', format('second open no-job send: %s', r);

  r := pg_temp.err($q$select public.send_candidate_outreach(null, 'a0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000003', 'Job 2', 'Job 2', 'manual')$q$);
  assert r = 'ok', format('a different job: %s', r);

  r := pg_temp.err($q$select public.send_candidate_outreach(null, 'a0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000004', 'Job 3', 'Job 3', 'manual')$q$);
  assert r = 'CANDIDATE_LIMIT', format('4th send in 90 days: %s', r);

  r := pg_temp.err($q$select public.send_candidate_outreach(null, 'a0000000-0000-4000-8000-000000000001',
    null, 'Hi', 'Hi', 'nope')$q$);
  assert r = 'INVALID_INPUT', format('unknown source: %s', r);

  -- The private applicant to A can be contacted.
  r := pg_temp.err($q$select public.send_candidate_outreach('f0000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000002', null, 'Hi', 'Hi', 'manual')$q$);
  assert r = 'ok', format('private applicant to A: %s', r);

  -- Direct writes.
  begin
    insert into public.candidate_outreach (company_id, candidate_user_id, subject, message)
    values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000006', 'Hi', 'Hi');
    raise exception 'company A inserted outreach directly';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.candidate_outreach set status = 'interested'
     where id = 'f0000000-0000-4000-8000-000000000002';
    raise exception 'company A set an outreach to interested';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.candidate_outreach set message = 'Edited'
     where id = 'f0000000-0000-4000-8000-000000000002';
    raise exception 'company A edited a message';
  exception when insufficient_privilege then null;
  end;

  update public.candidate_outreach set status = 'withdrawn'
   where id = 'f0000000-0000-4000-8000-000000000002';
  assert (select status from public.candidate_outreach where id = 'f0000000-0000-4000-8000-000000000002')
    = 'withdrawn', 'company A could not withdraw its own open outreach';

  -- A withdrawn row can't go back to sent (or anywhere).
  begin
    update public.candidate_outreach set status = 'sent'
     where id = 'f0000000-0000-4000-8000-000000000002';
    assert (select status from public.candidate_outreach where id = 'f0000000-0000-4000-8000-000000000002')
      = 'withdrawn', 'company A reopened a withdrawn outreach';
  exception when insufficient_privilege then null;
  end;

  assert (select count(*) from public.candidate_outreach) = 4,
    format('company A sees %s outreach rows', (select count(*) from public.candidate_outreach));
  assert (select count(*) from public.candidate_company_blocks) = 0, 'company A can read blocks';
end $$;

-- Company B: sees none of A's rows, can't withdraw them, and can't be blocked-probed.
reset role;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  assert (select count(*) from public.candidate_outreach) = 0, 'company B sees company A''s outreach';
  update public.candidate_outreach set status = 'withdrawn' where id = 'f0000000-0000-4000-8000-000000000001';
  -- Company B can send to the candidate who blocked A.
  perform public.send_candidate_outreach('f0000000-0000-4000-8000-000000000003',
    'a0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000002', 'Hi', 'Hi', 'manual');
end $$;

reset role;
do $$
begin
  assert (select status from public.candidate_outreach where id = 'f0000000-0000-4000-8000-000000000001') = 'sent',
    'company B withdrew company A''s outreach';
end $$;

-- A non-member (an applicant) can't send.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r text;
begin
  r := pg_temp.err($q$select public.send_candidate_outreach(null, 'a0000000-0000-4000-8000-000000000001',
    null, 'Hi', 'Hi', 'manual')$q$);
  assert r = 'NOT_MEMBER', format('applicant send: %s', r);
  assert (select count(*) from public.candidate_outreach) = 0, 'an unrelated applicant sees outreach';
end $$;

-- ------------------------------------------------ block 1: respond as the candidate
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  o public.candidate_outreach;
  r text;
  n int;
begin
  assert (select count(*) from public.candidate_outreach) = 3,
    format('candidate sees %s outreach rows', (select count(*) from public.candidate_outreach));

  -- No direct update.
  update public.candidate_outreach set status = 'interested' where id = 'f0000000-0000-4000-8000-000000000001';
  -- (no rows: there's no update policy for candidates; the grant only covers status)

  r := pg_temp.err($q$select public.respond_to_outreach('f0000000-0000-4000-8000-000000000001', 'sent')$q$);
  assert r = 'INVALID_INPUT', format('p_status sent: %s', r);

  o := public.respond_to_outreach('f0000000-0000-4000-8000-000000000001', 'interested',
    'location', 'Happy to chat', '+91 98765 43210', true);
  assert o.status = 'interested' and o.responded_at is not null, 'response not recorded';
  assert o.candidate_note = 'Happy to chat' and o.candidate_contact = '+91 98765 43210', 'note/contact not kept';
  assert o.decline_reason is null, 'a decline reason was kept on interested';

  r := pg_temp.err($q$select public.respond_to_outreach('f0000000-0000-4000-8000-000000000001', 'not_interested')$q$);
  assert r = 'ALREADY_ANSWERED', format('second response: %s', r);

  assert (select count(*) from public.candidate_company_blocks
           where company_id = 'c0000000-0000-4000-8000-000000000001') = 1, 'p_block did not insert a block';
  delete from public.candidate_company_blocks where company_id = 'c0000000-0000-4000-8000-000000000001';
end $$;

-- Someone else can't respond.
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r text;
begin
  r := pg_temp.err($q$select public.respond_to_outreach('f0000000-0000-4000-8000-000000000003', 'interested')$q$);
  assert r = 'NOT_FOUND', format('another candidate responded: %s', r);
end $$;

reset role;
do $$
declare e record;
begin
  assert (select status from public.candidate_outreach where id = 'f0000000-0000-4000-8000-000000000001')
    = 'interested', 'the candidate''s direct update changed something';
  select count(*) as n, min(payload->>'status') as status, bool_and(application_id is null) as no_app
    into e from public.application_events
   where type = 'outreach_replied' and payload->>'outreach_id' = 'f0000000-0000-4000-8000-000000000001';
  assert e.n = 1 and e.status = 'interested' and e.no_app, format('outreach_replied event: %s', row_to_json(e));
end $$;

-- An interested candidate applying to A gets source = 'outreach'; applying to B doesn't.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into public.applications (applicant_user_id, job_post_id, all_jobs_id, source) values
  ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000005', 'applied'),
  ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'outreach');
reset role;
do $$
begin
  assert (select source from public.applications where applicant_user_id = 'a0000000-0000-4000-8000-000000000001'
           and job_post_id = 'b0000000-0000-4000-8000-000000000005') = 'outreach',
    'an application after an interested answer is not source = outreach';
  assert (select source from public.applications where applicant_user_id = 'a0000000-0000-4000-8000-000000000001'
           and job_post_id = 'b0000000-0000-4000-8000-000000000002') = 'applied',
    'an applicant forged source = outreach';
end $$;

-- ------------------------------------------------------------ block 1: cap
-- Three sends to candidate 6 inside 90 days, one older: the 4th inside the window fails.
insert into public.candidate_outreach (company_id, candidate_user_id, subject, message, status, sent_at, expires_at) values
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000006', 'Old', 'Old', 'expired', now() - interval '100 days', now() - interval '70 days'),
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000006', 'One', 'One', 'expired', now() - interval '60 days', now() - interval '30 days'),
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000006', 'Two', 'Two', 'not_interested', now() - interval '20 days', now() + interval '10 days');

select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r text;
begin
  r := pg_temp.err($q$select public.send_candidate_outreach(null, 'a0000000-0000-4000-8000-000000000006',
    null, 'Three', 'Three', 'manual')$q$);
  assert r = 'ok', format('3rd send in 90 days: %s', r);
  r := pg_temp.err($q$select public.send_candidate_outreach(null, 'a0000000-0000-4000-8000-000000000006',
    'b0000000-0000-4000-8000-000000000001', 'Four', 'Four', 'manual')$q$);
  assert r = 'CANDIDATE_LIMIT', format('4th send in 90 days: %s', r);
end $$;

-- ---------------------------------------------------------- block 1: expire
reset role;
do $$
declare n int;
begin
  insert into public.candidate_outreach (company_id, candidate_user_id, subject, message, sent_at, expires_at) values
    ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000006', 'Stale', 'Stale',
     now() - interval '31 days', now() - interval '1 day');
  -- An answered row past its expiry stays answered.
  update public.candidate_outreach set expires_at = now() - interval '1 day'
   where id = 'f0000000-0000-4000-8000-000000000001';

  -- On the linked project, real overdue rows may be expired too (rolled back
  -- with the rest), so only the test row's change is asserted exactly.
  n := public.expire_outreach();
  assert n >= 1, format('expire_outreach expired %s rows', n);
  assert (select status from public.candidate_outreach where subject = 'Stale') = 'expired', 'stale row not expired';
  assert (select status from public.candidate_outreach where id = 'f0000000-0000-4000-8000-000000000001')
    = 'interested', 'expire touched an answered row';
  n := public.expire_outreach();
  assert n = 0, format('second expire run expired %s rows', n);
end $$;

-- authenticated can't run the expire job.
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  begin
    perform public.expire_outreach();
    raise exception 'authenticated ran expire_outreach';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ======================================================= block 2: contact gating
-- After block 1: candidate 1 answered Interested to A (and applied to A and B),
-- candidate 2 applied to A, candidate 5 blocks A, candidate 6 got outreach from A.
insert into public.resumes (user_id, name, resume_path, is_primary, content)
select user_id, 'cv', 'resumes/' || user_id || '/cv.pdf', true,
  '{"sections":[
     {"type":"contact","items":[{"heading":"Name","bullets":[{"text":"Email: x@example.com"}]}]},
     {"type":"experience","items":[{"heading":"Engineer","subheading":"Finch Labs","bullets":[
        {"text":"Cut load time by 60%"},
        {"text":"Reach me at priya.r@mailbox.org or +1 (415) 555-0134"},
        {"text":"Call +91 98765 43210 or 9876543210"},
        {"text":"Portfolio https://priya.dev/portfolio"}]}]},
     {"type":"skills","items":[{"bullets":[{"text":"React, Node.js, v2.3.1"}]}]},
     {"type":"summary","items":[{"bullets":[{"text":"Summary text"}]}]},
     {"type":"projects","items":["junk",{"heading":"DS","bullets":[{"text":"See github.com/priya"},{"nope":1}]}]},
     {"type":"education","items":[{"heading":"IIT"}]},
     {"type":"achievements","items":[{"heading":"Award"}]}
   ]}'::jsonb
from public.user_info where user_id::text like 'a0000000-0000-4000-8000-00000000000_';

insert into storage.objects (bucket_id, name)
select 'resumes', 'resumes/' || user_id || '/cv.pdf' from public.user_info
where user_id::text like 'a0000000-0000-4000-8000-00000000000_';

do $$
declare
  secs jsonb;
  cols text[];
begin
  secs := public.resume_sections_public((select content from public.resumes
    where user_id = 'a0000000-0000-4000-8000-000000000001'));
  assert (select array_agg(s->>'type' order by o) from jsonb_array_elements(secs) with ordinality x(s, o))
    = array['experience','skills','projects','education'], format('sections kept: %s', secs);
  assert secs->0->'items'->0->>'heading' = 'Engineer' and secs->0->'items'->0->>'subheading' = 'Finch Labs',
    'headings were dropped';
  assert secs::text not like '%mailbox.org%' and secs::text not like '%555-0134%'
     and secs::text not like '%98765%' and secs::text not like '%9876543210%'
     and secs::text not like '%priya.dev%' and secs::text not like '%github.com%'
     and secs::text not like '%example.com%', format('PII left in sections: %s', secs);
  assert strpos(secs::text, 'Cut load time by 60%') > 0 and strpos(secs::text, 'Node.js, v2.3.1') > 0,
    format('ordinary text was redacted: %s', secs);
  assert jsonb_array_length(secs->2->'items') = 1, 'a junk item was kept';
  assert public.resume_sections_public(null) = '[]'::jsonb, 'null content';
  assert public.resume_sections_public('"text"'::jsonb) = '[]'::jsonb, 'string content';
  assert public.resume_sections_public('{"sections":{"type":"skills"}}'::jsonb) = '[]'::jsonb, 'object sections';

  -- The trigger stores the same sections, refreshes them, and never fails a save.
  assert (select ps.sections from public.resume_public_sections ps join public.resumes r on r.id = ps.resume_id
           where r.user_id = 'a0000000-0000-4000-8000-000000000001') = secs, 'stored sections differ';
  update public.resumes set content = '"broken"'::jsonb where user_id = 'a0000000-0000-4000-8000-000000000003';
  assert (select ps.sections from public.resume_public_sections ps join public.resumes r on r.id = ps.resume_id
           where r.user_id = 'a0000000-0000-4000-8000-000000000003') = '[]'::jsonb, 'sections not refreshed';

  select array_agg(column_name::text order by ordinal_position) into cols
    from information_schema.columns where table_schema = 'public' and table_name = 'candidate_directory';
  assert cols = array['user_id','full_name','desired_roles','preferred_locations','job_type','min_salary',
    'max_salary','salary_currency','experience_years','industry_preferences','visa_sponsorship_required',
    'top_skills','work_style_preferences','career_goals_short_term','career_goals_long_term',
    'company_size_preference','filled','is_public','accepts_outreach','created_at','updated_at',
    'resume_sections','desired_roles_search','top_skills_search','work_style_preferences_search',
    'industry_preferences_search'], format('candidate_directory columns: %s', cols);
end $$;

-- ---------------------------------------------------------------- company A
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare seen text[];
begin
  select array_agg(full_name order by full_name) into seen from public.candidate_directory
   where user_id::text like 'a0000000-0000-4000-8000-00000000000_';
  assert seen = array['Capped','Public','Quiet'], format('company A directory: %s', seen);

  select array_agg(full_name order by full_name) into seen from public.user_info
   where user_id::text like 'a0000000-0000-4000-8000-00000000000_';
  assert seen = array['Applied','Public'], format('company A user_info: %s', seen);

  select array_agg(r.user_id::text order by r.user_id) into seen from public.resumes r
   where r.user_id::text like 'a0000000-0000-4000-8000-00000000000_';
  assert seen = array['a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002'],
    format('company A resumes: %s', seen);

  select array_agg(name order by name) into seen from storage.objects
   where bucket_id = 'resumes' and name like 'resumes/a0000000-0000-4000-8000-00000000000_/cv.pdf';
  assert seen = array['resumes/a0000000-0000-4000-8000-000000000001/cv.pdf',
                      'resumes/a0000000-0000-4000-8000-000000000002/cv.pdf'],
    format('company A resume files: %s', seen);

  assert public.company_has_candidate_access('a0000000-0000-4000-8000-000000000001'), 'access: interested';
  assert public.company_has_candidate_access('a0000000-0000-4000-8000-000000000002'), 'access: applied';
  assert not public.company_has_candidate_access('a0000000-0000-4000-8000-000000000004'), 'access: talent pool';
  assert not public.company_has_candidate_access('a0000000-0000-4000-8000-000000000006'), 'access: sent, unanswered';

  assert public.company_can_view_candidate('a0000000-0000-4000-8000-000000000004'), 'view: public';
  assert public.company_can_view_candidate('a0000000-0000-4000-8000-000000000002'), 'view: private applicant';
  assert not public.company_can_view_candidate('a0000000-0000-4000-8000-000000000003'), 'view: private';
  assert not public.company_can_view_candidate('a0000000-0000-4000-8000-000000000005'), 'view: blocked';
end $$;

-- Candidate 6 applies to A: their row, resume and file open to A.
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000006","role":"authenticated"}', true);
set local role authenticated;
insert into public.applications (applicant_user_id, job_post_id, all_jobs_id) values
  ('a0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001');
do $$
begin
  assert (select count(*) from public.candidate_directory) = 0, 'an applicant can read the directory';
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  assert exists (select 1 from public.user_info where user_id = 'a0000000-0000-4000-8000-000000000006'),
    'company A cannot read a candidate who applied';
  assert exists (select 1 from public.resumes where user_id = 'a0000000-0000-4000-8000-000000000006'),
    'company A cannot read the resume of a candidate who applied';
  assert exists (select 1 from storage.objects where name = 'resumes/a0000000-0000-4000-8000-000000000006/cv.pdf'),
    'company A cannot read the file of a candidate who applied';
end $$;

-- ---------------------------------------------------------------- company B
reset role;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
declare seen text[];
begin
  select array_agg(full_name order by full_name) into seen from public.candidate_directory
   where user_id::text like 'a0000000-0000-4000-8000-00000000000_';
  assert seen = array['Blocker','Capped','Public','Quiet'], format('company B directory: %s', seen);
  assert not exists (select 1 from public.user_info where user_id = 'a0000000-0000-4000-8000-000000000004'),
    'company B can read a talent-pool candidate''s user_info';
  assert not exists (select 1 from public.user_info where user_id = 'a0000000-0000-4000-8000-000000000006'),
    'company B can read a candidate who applied to A';
  assert not exists (select 1 from public.resumes where user_id = 'a0000000-0000-4000-8000-000000000004'),
    'company B can read a talent-pool resume';
  assert not exists (select 1 from storage.objects where name = 'resumes/a0000000-0000-4000-8000-000000000004/cv.pdf'),
    'company B can read a talent-pool resume file';
end $$;
reset role;

-- A company can't unlock a talent-pool candidate by creating an application
-- for them (20261016150000); it can add a candidate it already has access to.
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  begin
    insert into public.applications (applicant_user_id, job_post_id, all_jobs_id) values
      ('a0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003');
    raise exception 'company A created an application for a talent-pool candidate';
  exception when insufficient_privilege then null;
  end;
  assert not public.company_has_candidate_access('a0000000-0000-4000-8000-000000000004'),
    'a company-created application unlocked access';

  -- Candidate 1 answered Interested, but since 20261017150000 companies never
  -- create applications: the candidate applies themselves.
  begin
    insert into public.applications (applicant_user_id, job_post_id, all_jobs_id) values
      ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000004');
    raise exception 'company A created an application for a candidate who answered Interested';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ========================================================= block 3: profile views
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  perform public.record_profile_view('a0000000-0000-4000-8000-000000000004');
  perform public.record_profile_view('a0000000-0000-4000-8000-000000000004');
  -- Can't see these: private non-applicant, and the candidate who blocked A.
  perform public.record_profile_view('a0000000-0000-4000-8000-000000000003');
  perform public.record_profile_view('a0000000-0000-4000-8000-000000000005');
  begin
    perform 1 from public.candidate_profile_views;
    raise exception 'company A can read candidate_profile_views';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select public.record_profile_view('a0000000-0000-4000-8000-000000000004');

reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
-- An applicant caller records nothing.
select public.record_profile_view('a0000000-0000-4000-8000-000000000004');

reset role;
do $$
declare r record;
begin
  -- An old view outside the window.
  insert into public.candidate_profile_views (company_id, candidate_user_id, viewed_on)
  values ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000006', current_date - 40);

  select views into r from public.candidate_profile_views
   where company_id = 'c0000000-0000-4000-8000-000000000001'
     and candidate_user_id = 'a0000000-0000-4000-8000-000000000004' and viewed_on = current_date;
  assert r.views = 2, format('company A views of candidate 4: %s', r.views);
  assert (select count(*) from public.candidate_profile_views
           where candidate_user_id in ('a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000005')) = 0,
    'a view was recorded for a candidate the company can''t see';
  assert (select count(*) from public.candidate_profile_views
           where candidate_user_id = 'a0000000-0000-4000-8000-000000000004') = 2,
    'expected one row per company for candidate 4';
end $$;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  assert public.get_my_profile_view_count(30) = 2, format('candidate 4 count: %s', public.get_my_profile_view_count(30));
  begin
    perform 1 from public.candidate_profile_views;
    raise exception 'the candidate can read candidate_profile_views';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000006","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  assert public.get_my_profile_view_count(30) = 0, 'an old view was counted';
  assert public.get_my_profile_view_count(60) = 1, 'the old view is missing from a 60-day window';
end $$;
reset role;

-- ====================================================== block 4: shared signals
-- Candidate 2 applied to A (block 0). Sessions: 1 completed (theirs), 2 draft
-- (theirs), 3 completed (candidate 3's). Reviews: 1 completed (theirs).
insert into public.interviews (id, user_id, name) values
  ('1e000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'Mock'),
  ('1e000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003', 'Mock');
insert into public.interview_sessions (id, interview_id, voice_session_id, status, turns) values
  ('15000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000001', 'v1', 'completed', '[{"user":"secret transcript"}]'),
  ('15000000-0000-4000-8000-000000000002', '1e000000-0000-4000-8000-000000000001', 'v2', 'active', '[]'),
  ('15000000-0000-4000-8000-000000000003', '1e000000-0000-4000-8000-000000000003', 'v3', 'completed', '[]');
insert into public.interview_analyses (interview_session_id, perspective, status) values
  ('15000000-0000-4000-8000-000000000001', 'candidate', 'completed');
insert into public.resume_reviews (id, user_id, status, score) values
  ('2e000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'completed', 82);

select set_config('test.app2', (select id::text from public.applications
  where applicant_user_id = 'a0000000-0000-4000-8000-000000000002'
    and job_post_id = 'b0000000-0000-4000-8000-000000000001'), true);
select set_config('test.app1b', (select id::text from public.applications
  where applicant_user_id = 'a0000000-0000-4000-8000-000000000001'
    and job_post_id = 'b0000000-0000-4000-8000-000000000002'), true);

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  app uuid := current_setting('test.app2')::uuid;
  r text;
  res jsonb;
begin
  r := pg_temp.err(format($q$insert into public.application_attachments (application_id, kind, interview_session_id)
    values (%L, 'interview_session', '15000000-0000-4000-8000-000000000003')$q$, app));
  assert r = 'SESSION_NOT_FOUND', format('another user''s session: %s', r);
  r := pg_temp.err(format($q$insert into public.application_attachments (application_id, kind, interview_session_id)
    values (%L, 'interview_session', '15000000-0000-4000-8000-000000000002')$q$, app));
  assert r = 'SESSION_NOT_FOUND', format('an unfinished session: %s', r);

  begin
    insert into public.application_attachments (application_id, kind, resume_review_id)
    values (current_setting('test.app1b')::uuid, 'resume_review', '2e000000-0000-4000-8000-000000000001');
    raise exception 'attached to someone else''s application';
  exception when insufficient_privilege or sqlstate 'P0001' then null;
  end;

  insert into public.application_attachments (application_id, kind, interview_session_id, first_viewed_at)
  values (app, 'interview_session', '15000000-0000-4000-8000-000000000001', now());
  assert (select first_viewed_at from public.application_attachments where application_id = app
           and kind = 'interview_session') is null, 'the applicant set first_viewed_at';
  insert into public.application_attachments (application_id, kind, resume_review_id)
  values (app, 'resume_review', '2e000000-0000-4000-8000-000000000001');

  begin
    insert into public.application_attachments (application_id, kind, interview_session_id)
    values (app, 'interview_session', '15000000-0000-4000-8000-000000000001');
    raise exception 'a second interview attachment was accepted';
  exception when unique_violation then null;
  end;

  res := public.enqueue_company_interview_analysis('15000000-0000-4000-8000-000000000001');
  assert (res->>'queued')::boolean, format('first enqueue: %s', res);
  res := public.enqueue_company_interview_analysis('15000000-0000-4000-8000-000000000001');
  assert not (res->>'queued')::boolean, format('second enqueue: %s', res);
  r := pg_temp.err($q$select public.enqueue_company_interview_analysis('15000000-0000-4000-8000-000000000003')$q$);
  assert r = 'NOT_FOUND', format('enqueue for another user''s session: %s', r);

  -- The candidate never reads the company report about them.
  assert (select array_agg(perspective) from public.interview_analyses) = array['candidate'],
    format('candidate sees analyses: %s', (select array_agg(perspective) from public.interview_analyses));

  -- No direct update of first_viewed_at.
  begin
    update public.application_attachments set first_viewed_at = null where application_id = app;
    raise exception 'the applicant updated an attachment';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$
begin
  assert (select count(*) from public.interview_analyses
           where interview_session_id = '15000000-0000-4000-8000-000000000001' and perspective = 'company'
             and status = 'queued') = 1, 'the company analysis was not queued once';
  update public.interview_analyses set status = 'completed', result = '{"summary":"ok"}'
   where interview_session_id = '15000000-0000-4000-8000-000000000001' and perspective = 'company';
end $$;

-- Company A sees its attachments and the company report only.
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  assert (select count(*) from public.application_attachments) = 2, 'company A attachments';
  assert (select array_agg(perspective) from public.interview_analyses) = array['company'],
    format('company A analyses: %s', (select array_agg(perspective) from public.interview_analyses));
  assert (select count(*) from public.interview_sessions) = 0, 'company A can read interview sessions';
  begin
    update public.application_attachments set first_viewed_at = now();
    raise exception 'company A updated an attachment';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
begin
  assert (select count(*) from public.application_attachments where first_viewed_at is not null) = 0,
    'company A set first_viewed_at directly';
end $$;

select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  assert (select count(*) from public.application_attachments) = 0, 'company B sees A''s attachments';
  assert (select count(*) from public.interview_analyses) = 0, 'company B sees analyses';
end $$;
reset role;

-- Delete only while the company hasn't opened it.
update public.application_attachments set first_viewed_at = now()
 where application_id = current_setting('test.app2')::uuid and kind = 'interview_session';
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
declare n int;
begin
  delete from public.application_attachments where application_id = current_setting('test.app2')::uuid;
  get diagnostics n = row_count;
  assert n = 1, format('deleted %s attachments (only the unopened review may go)', n);
end $$;
reset role;

-- ===================================================== block 5: draft usage
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
declare n int; r text;
begin
  for i in 1..20 loop n := public.increment_outreach_drafts(); end loop;
  assert n = 20, format('20th draft: %s', n);
  n := public.increment_outreach_drafts();
  assert n = 21, format('21st draft: %s', n);
  begin
    perform 1 from public.outreach_draft_usage;
    raise exception 'company A can read outreach_draft_usage';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert public.increment_outreach_drafts() = 1, 'company B shares company A''s counter';
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r text;
begin
  r := pg_temp.err('select public.increment_outreach_drafts()');
  assert r = 'NOT_MEMBER', format('applicant draft: %s', r);
end $$;
reset role;


select 'recruiter_outreach: ok' as result;

rollback;
