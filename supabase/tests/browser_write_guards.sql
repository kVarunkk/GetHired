-- BW-T04: the guards in 20261020130000_browser_write_guards.sql. Runs in a
-- transaction that always rolls back, so it's safe to run against the linked
-- project:
--   npx supabase db query --linked -f supabase/tests/browser_write_guards.sql
-- Any failed check raises an exception; success prints 'browser_write_guards: ok'.

begin;

insert into auth.users (id, email, aud, role) values
  ('c1000000-0000-4000-8000-000000000001', 'hr@acme.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000001', 'ada@applicant.test', 'authenticated', 'authenticated');

insert into public.company_info (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Acme', 'hr@acme.test');

insert into public.user_info (user_id, email, full_name, is_public, filled, invitations_count, referral_code) values
  ('a0000000-0000-4000-8000-000000000001', 'ada@applicant.test', 'Ada', true, true, 3, 'ada-code');

insert into public.all_jobs (id, job_name, job_url, company_name, platform, is_platform_job) values
  ('d0000000-0000-4000-8000-000000000001', 'A job', 'https://acme.test/jobs/1', 'Acme', 'gethired', true),
  ('d0000000-0000-4000-8000-000000000002', 'Other job', 'https://other.test/jobs/1', 'Other', 'linkedin', false);

insert into public.job_postings (id, company_id, title, job_id) values
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'A job', 'd0000000-0000-4000-8000-000000000001');

insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id, answers_v2) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', '{"q1": "Because"}');

insert into public.invitations (id, referrer_user_id, invited_email) values
  ('f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'friend@test.dev');

insert into public.interviews (id, user_id, name, charged_session_ids) values
  ('90000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Practice', '{}');

insert into public.bookmarks (user_id, name, url, is_alert_on)
select 'a0000000-0000-4000-8000-000000000001', 'Search ' || n, '/jobs?q=' || n, n <= 5
from generate_series(1, 6) as n;

-- ------------------------------------------------------------- the applicant
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","email":"ada@applicant.test"}',
  true
);
set local role authenticated;

do $$
declare
  v_row public.user_info%rowtype;
  v_inv public.invitations%rowtype;
  v_count int;
begin
  -- 1. user_info: the guarded columns don't change; the rest do.
  update public.user_info
     set email = 'victim@elsewhere.test', invitations_count = 0, referral_code = 'stolen',
         embedding_new = null, is_public = false
   where user_id = 'a0000000-0000-4000-8000-000000000001';
  select * into v_row from public.user_info where user_id = 'a0000000-0000-4000-8000-000000000001';
  assert v_row.email = 'ada@applicant.test', format('email changed to %s', v_row.email);
  assert v_row.invitations_count = 3, 'invitations_count changed';
  assert v_row.referral_code = 'ada-code', 'referral_code changed';
  assert v_row.is_public = false, 'is_public should still be editable';

  -- 2. applications
  begin
    insert into public.applications (applicant_user_id, job_post_id, all_jobs_id) values
      ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
       'd0000000-0000-4000-8000-000000000001');
    raise exception 'inserted a platform application as the user';
  exception when insufficient_privilege then null;
  end;

  insert into public.applications (applicant_user_id, all_jobs_id) values
    ('a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002');

  delete from public.applications
   where applicant_user_id = 'a0000000-0000-4000-8000-000000000001'
     and all_jobs_id = 'd0000000-0000-4000-8000-000000000002';
  get diagnostics v_count = row_count;
  assert v_count = 1, 'could not delete an external application';

  delete from public.applications where id = 'e0000000-0000-4000-8000-000000000001';
  get diagnostics v_count = row_count;
  assert v_count = 0, 'deleted a platform application';

  begin
    update public.applications set answers_v2 = '{"q1": "Rewritten"}'
     where id = 'e0000000-0000-4000-8000-000000000001';
    raise exception 'rewrote a submitted application''s answers';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.applications set resume_url = 'https://phish.test'
     where id = 'e0000000-0000-4000-8000-000000000001';
    raise exception 'changed a submitted application''s resume_url';
  exception when insufficient_privilege then null;
  end;

  -- 3. invitations
  begin
    insert into public.invitations (referrer_user_id, invited_email)
    values ('a0000000-0000-4000-8000-000000000001', 'fake@test.dev');
    raise exception 'inserted an invitation as the user';
  exception when insufficient_privilege then null;
  end;

  update public.invitations set status = 'complete', invited_email = 'x@test.dev', "isDialogShown" = true
   where id = 'f0000000-0000-4000-8000-000000000001';
  select * into v_inv from public.invitations where id = 'f0000000-0000-4000-8000-000000000001';
  assert v_inv.status = 'pending', 'invitation status changed';
  assert v_inv.invited_email = 'friend@test.dev', 'invited_email changed';
  assert v_inv."isDialogShown", 'isDialogShown should still be editable';

  delete from public.invitations where id = 'f0000000-0000-4000-8000-000000000001';
  get diagnostics v_count = row_count;
  assert v_count = 0, 'deleted an invitation';

  -- 4. interviews
  update public.interviews set charged_session_ids = array['future-session']
   where id = '90000000-0000-4000-8000-000000000001';
  assert (select charged_session_ids from public.interviews
           where id = '90000000-0000-4000-8000-000000000001') = '{}', 'charged_session_ids changed';

  -- 5. bookmarks: a sixth alert
  begin
    update public.bookmarks set is_alert_on = true
     where user_id = 'a0000000-0000-4000-8000-000000000001' and name = 'Search 6';
    raise exception 'turned on a sixth alert';
  exception when check_violation then null;
  end;
end $$;

-- --------------------------------------------- the service role is unaffected
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
begin
  update public.applications set answers_v2 = '{"q1": "Fixed by support"}'
   where id = 'e0000000-0000-4000-8000-000000000001';
  assert (select answers_v2 ->> 'q1' from public.applications
           where id = 'e0000000-0000-4000-8000-000000000001') = 'Fixed by support', 'service role blocked on applications';

  update public.user_info set invitations_count = 4 where user_id = 'a0000000-0000-4000-8000-000000000001';
  assert (select invitations_count from public.user_info
           where user_id = 'a0000000-0000-4000-8000-000000000001') = 4, 'service role blocked on user_info';
end $$;

reset role;
select 'browser_write_guards: ok';

rollback;
