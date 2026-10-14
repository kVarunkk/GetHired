-- RS-TEST-005: recruiter access control. Runs in a transaction that always
-- rolls back, so it's safe to run against the linked project:
--   npx supabase db query --linked -f supabase/tests/recruiter_access.sql
-- Any failed check raises an exception; success prints 'recruiter_access: ok'.
-- Ids match test/utils/recruiter.ts.

begin;

-- Seed: two companies (A, B) and three applicants.
insert into auth.users (id, email, aud, role) values
  ('c1000000-0000-4000-8000-000000000001', 'hr@acme.test', 'authenticated', 'authenticated'),
  ('c1000000-0000-4000-8000-000000000002', 'hr@globex.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000001', 'public@applicant.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000002', 'applied@applicant.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000003', 'private@applicant.test', 'authenticated', 'authenticated');

insert into public.company_info (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Acme', 'hr@acme.test'),
  ('c0000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'Globex', 'hr@globex.test');

insert into public.user_info (user_id, email, full_name, is_public, filled, ai_credits) values
  ('a0000000-0000-4000-8000-000000000001', 'public@applicant.test', 'Public', true, true, 100),
  ('a0000000-0000-4000-8000-000000000002', 'applied@applicant.test', 'Applied', false, true, 100),
  ('a0000000-0000-4000-8000-000000000003', 'private@applicant.test', 'Private', false, true, 100);

insert into public.resumes (user_id, name, resume_path, is_primary)
select user_id, 'cv', 'resumes/' || user_id || '/cv.pdf', true from public.user_info
where user_id::text like 'a0000000-0000-4000-8000-00000000000_';

insert into storage.objects (bucket_id, name) values
  ('resumes', 'resumes/a0000000-0000-4000-8000-000000000001/cv.pdf'),
  ('resumes', 'resumes/a0000000-0000-4000-8000-000000000003/cv.pdf');

insert into public.all_jobs (id, job_name, job_url, company_name, platform) values
  ('d0000000-0000-4000-8000-000000000001', 'A job', 'https://acme.test/jobs/1', 'Acme', 'gethired'),
  ('d0000000-0000-4000-8000-000000000002', 'B job', 'https://globex.test/jobs/1', 'Globex', 'gethired');

insert into public.job_postings (id, company_id, title, job_id) values
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'A job', 'd0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'B job', 'd0000000-0000-4000-8000-000000000002');

insert into public.applications (applicant_user_id, job_post_id, all_jobs_id) values
  ('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------- company A
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare seen text[];
begin
  select array_agg(full_name order by full_name) into seen from public.user_info
   where user_id::text like 'a0000000-0000-4000-8000-00000000000_';
  assert seen = array['Applied', 'Public'], format('company A user_info: %s', seen);

  select array_agg(r.user_id::text order by r.user_id) into seen from public.resumes r
   where r.user_id::text like 'a0000000-0000-4000-8000-00000000000_';
  assert seen = array['a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'],
    format('company A resumes: %s', seen);

  assert not exists (select 1 from storage.objects
    where bucket_id = 'resumes' and name = 'resumes/a0000000-0000-4000-8000-000000000003/cv.pdf'),
    'company A can see a private non-applicant''s resume file';
  assert exists (select 1 from storage.objects
    where bucket_id = 'resumes' and name = 'resumes/a0000000-0000-4000-8000-000000000001/cv.pdf'),
    'company A cannot see a public applicant''s resume file';

  -- Billing columns can't be raised; ordinary columns can change.
  update public.company_info
     set tier_id = (select id from public.company_tiers where name = 'paid-2'),
         ai_credits = 9999, job_posts_created = -5, name = 'Acme 2'
   where id = 'c0000000-0000-4000-8000-000000000001';
  assert (select (t.slug, c.ai_credits, c.job_posts_created, c.name)
            = ('free'::text, 50::smallint, 0::bigint, 'Acme 2'::text)
          from public.company_info c join public.company_tiers t on t.id = c.tier_id
          where c.id = 'c0000000-0000-4000-8000-000000000001'),
    'company A changed its own billing columns';

  -- Inserting a company for someone else fails.
  begin
    insert into public.company_info (user_id, name) values ('a0000000-0000-4000-8000-000000000003', 'Fake');
    raise exception 'company A inserted company_info for another user';
  exception when insufficient_privilege then null;
  end;

  -- Credits of another user can't be deducted.
  begin
    perform public.deduct_user_credits('a0000000-0000-4000-8000-000000000001', 1);
    raise exception 'company A deducted another user''s credits';
  exception when raise_exception then
    if sqlerrm like 'company A deducted%' then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------- company B
reset role;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

do $$
declare seen text[];
begin
  select array_agg(full_name order by full_name) into seen from public.user_info
   where user_id::text like 'a0000000-0000-4000-8000-00000000000_';
  assert seen = array['Public'], format('company B user_info: %s', seen);
end $$;

-- ------------------------------------------- applicant (RS-CON-003: own rows)
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  assert (select count(*) from public.user_info) = 1, 'applicant should see exactly their own user_info';
  update public.user_info set full_name = 'Private 2' where user_id = 'a0000000-0000-4000-8000-000000000003';
  assert (select full_name from public.user_info) = 'Private 2', 'applicant could not update their user_info';

  assert (select count(*) from public.resumes) = 1, 'applicant should see exactly their own resume';
  insert into public.resumes (user_id, name) values ('a0000000-0000-4000-8000-000000000003', 'cv 2');

  insert into public.applications (applicant_user_id, job_post_id, all_jobs_id)
  values ('a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002');
  assert (select count(*) from public.applications) = 1, 'applicant should see their own application';

  assert exists (select 1 from storage.objects
    where bucket_id = 'resumes' and name = 'resumes/a0000000-0000-4000-8000-000000000003/cv.pdf'),
    'applicant cannot see their own resume file';

  -- Own credits: deducting works, a negative amount (adding) doesn't.
  perform public.deduct_user_credits('a0000000-0000-4000-8000-000000000003', 1);
  assert (select ai_credits from public.user_info) = 99, 'applicant could not deduct their own credits';
  begin
    perform public.deduct_user_credits('a0000000-0000-4000-8000-000000000003', -100);
    raise exception 'negative deduction allowed';
  exception when raise_exception then
    if sqlerrm = 'negative deduction allowed' then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------- anon
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

do $$
begin
  begin
    insert into public.company_info (user_id, name) values ('a0000000-0000-4000-8000-000000000001', 'Anon Co');
    raise exception 'anon inserted company_info';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select 'recruiter_access: ok' as result;

rollback;
