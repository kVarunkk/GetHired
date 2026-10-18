-- CPT-010 / CPT-040: application forms, knockouts, question sets and the
-- careers page. Runs in a transaction that always rolls back, so it's safe to
-- run against the linked project once the migrations are applied:
--   npx supabase db query --linked -f supabase/tests/careers_page.sql
-- Any failed check raises an exception; success prints 'careers_page: ok'.
-- Ids match test/utils/recruiter.ts and test/utils/team.ts.

begin;

create function pg_temp.act(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true)
$$;
create function pg_temp.role_of(p_company uuid, p_template text) returns uuid language sql as $$
  select id from public.company_roles where company_id = p_company and template_key = p_template
$$;

-- Seed: company A (owner, Member), company B (owner), an applicant.
insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data) values
  ('c1000000-0000-4000-8000-000000000001', 'hr@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c1000000-0000-4000-8000-000000000002', 'hr@globex.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c3000000-0000-4000-8000-000000000001', 'member@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('a0000000-0000-4000-8000-000000000001', 'public@applicant.test', 'authenticated', 'authenticated', now(), '{}');

insert into public.company_info (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Acme', 'hr@acme.test'),
  ('c0000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'Globex', 'hr@globex.test');

insert into public.company_members (company_id, user_id, role_id, display_name) values
  ('c0000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001',
     pg_temp.role_of('c0000000-0000-4000-8000-000000000001', 'member'), 'Max Member');

insert into public.user_info (user_id, email, full_name, is_public, filled) values
  ('a0000000-0000-4000-8000-000000000001', 'public@applicant.test', 'Public', true, true);

insert into public.all_jobs (id, job_name, job_url, company_name, platform) values
  ('d0000000-0000-4000-8000-000000000001', 'A1', 'https://acme.test/jobs/1', 'Acme', 'gethired'),
  ('d0000000-0000-4000-8000-000000000002', 'B1', 'https://globex.test/jobs/1', 'Globex', 'gethired');

insert into public.job_postings (id, company_id, title, job_id, questions) values
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'A1', 'd0000000-0000-4000-8000-000000000001', '{"Why us?"}'),
  ('b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'B1', 'd0000000-0000-4000-8000-000000000002', '{}');

insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002');

insert into public.application_knockouts (application_id, company_id, job_post_id, failed, reasons, action_taken) values
  ('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
   true, '[{"question_id":"x","label":"Authorised?"}]', 'flagged'),
  ('e0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002',
   false, '[]', 'none');

insert into public.job_posting_form_rules (job_post_id, company_id, rules) values
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   '{"questions":{"x":{"fail_if":{"kind":"equals","value":false},"action":"flag"}},"standard":{}}');

-- ===================================================== block 1: forms
-- CPT-010.

do $$
declare
  a uuid := 'c0000000-0000-4000-8000-000000000001';
begin
  -- Columns and defaults.
  assert (select application_form from public.job_postings where id = 'b0000000-0000-4000-8000-000000000002')
       = '{"version":1,"questions":[],"standard_fields":{}}'::jsonb, 'the default application_form is not the empty form';
  begin
    update public.job_postings set department = repeat('x', 61) where id = 'b0000000-0000-4000-8000-000000000001';
    raise exception 'a 61-character department was accepted';
  exception when check_violation then null;
  end;
  update public.job_postings set workplace_type = 'hybrid' where id = 'b0000000-0000-4000-8000-000000000001';

  -- The legacy ids match helpers/jobs/application-form-schema.ts (legacyQuestionId).
  assert public.legacy_question_id(0) = '00000000-0000-4000-8000-000000000001', 'legacy_question_id(0) differs from the TS helper';
  assert public.legacy_question_id(11) = '00000000-0000-4000-8000-000000000012', 'legacy_question_id(11) differs from the TS helper';

  -- Applications: the new columns and the careers_page source.
  update public.applications set answers_v2 = '{"q":"a"}', form_snapshot = '{}', source = 'careers_page', source_detail = 'linkedin'
   where id = 'e0000000-0000-4000-8000-000000000001';
  begin
    update public.applications set source = 'billboard' where id = 'e0000000-0000-4000-8000-000000000001';
    raise exception 'an unknown source was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.applications set source_detail = repeat('x', 41) where id = 'e0000000-0000-4000-8000-000000000001';
    raise exception 'a 41-character source_detail was accepted';
  exception when check_violation then null;
  end;

  -- The catalog and the Admin role.
  assert exists (select 1 from public.company_permissions where key = 'careers.edit' and not scopable), 'careers.edit missing';
  assert exists (select 1 from public.company_permissions where key = 'question_sets.manage' and requires = '{jobs.view}'),
    'question_sets.manage missing or with the wrong dependencies';
  assert not exists (
    select 1 from public.company_roles r
     where r.template_key = 'admin'
       and (select count(*) from public.company_role_permissions p
             where p.role_id = r.id and p.permission_key in ('careers.edit', 'question_sets.manage')) <> 2
  ), 'an Admin role lacks careers.edit or question_sets.manage';
  assert not exists (
    select 1 from public.company_role_permissions
     where role_id = pg_temp.role_of(a, 'member') and permission_key in ('careers.edit', 'question_sets.manage')
  ), 'the Member role got a careers permission';
end $$;

-- RLS: knockouts and form rules are the company's only (AF-SEC-003).
set local role authenticated;
select pg_temp.act('c3000000-0000-4000-8000-000000000001');
do $$
begin
  assert (select count(*) from public.application_knockouts) = 1, 'a member of A should see exactly A''s knockout';
  assert (select count(*) from public.job_posting_form_rules) = 1, 'a member of A should see A''s form rules';
  begin
    insert into public.application_knockouts (application_id, company_id, job_post_id, failed, action_taken)
    values ('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
            'b0000000-0000-4000-8000-000000000001', false, 'none');
    raise exception 'authenticated inserted a knockout';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.job_posting_form_rules set rules = '{}' where job_post_id = 'b0000000-0000-4000-8000-000000000001';
    raise exception 'authenticated updated form rules';
  exception when insufficient_privilege then null;
  end;
end $$;

select pg_temp.act('a0000000-0000-4000-8000-000000000001');
do $$
begin
  assert (select count(*) from public.application_knockouts) = 0, 'the applicant can read their knockout results';
  assert (select count(*) from public.job_posting_form_rules) = 0, 'the applicant can read knockout rules';
end $$;

-- Question sets: members read, question_sets.manage writes, 25 per company.
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare
  i int;
begin
  insert into public.company_question_sets (company_id, name, form)
  values ('c0000000-0000-4000-8000-000000000001', 'Engineering', '{"version":1,"questions":[],"standard_fields":{}}');
  begin
    insert into public.company_question_sets (company_id, name, form)
    values ('c0000000-0000-4000-8000-000000000001', ' engineering ', '{}');
    raise exception 'a duplicate set name (case and spaces) was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.company_question_sets (company_id, name, form)
    values ('c0000000-0000-4000-8000-000000000002', 'Theirs', '{}');
    raise exception 'an owner of A created a set for B';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Checked below the cap: the cap trigger runs before RLS's with check.
select pg_temp.act('c3000000-0000-4000-8000-000000000001');
do $$
begin
  begin
    insert into public.company_question_sets (company_id, name, form)
    values ('c0000000-0000-4000-8000-000000000001', 'Member set', '{}');
    raise exception 'a member without question_sets.manage created a set';
  exception when insufficient_privilege then null;
  end;
end $$;

select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare
  i int;
begin
  for i in 2..25 loop
    insert into public.company_question_sets (company_id, name, form)
    values ('c0000000-0000-4000-8000-000000000001', 'Set ' || i, '{}');
  end loop;
  begin
    insert into public.company_question_sets (company_id, name, form)
    values ('c0000000-0000-4000-8000-000000000001', 'Set 26', '{}');
    raise exception 'a 26th question set was accepted';
  exception when raise_exception then
    if sqlerrm <> 'QUESTION_SET_LIMIT' then raise; end if;
  end;
end $$;

select pg_temp.act('c3000000-0000-4000-8000-000000000001');
do $$
begin
  assert (select count(*) from public.company_question_sets) = 25, 'a member should read the company''s sets';
  delete from public.company_question_sets;
  assert (select count(*) from public.company_question_sets) = 25, 'a member without question_sets.manage deleted sets';
end $$;

select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$
begin
  assert (select count(*) from public.company_question_sets) = 0, 'company B can read A''s question sets';
  assert (select count(*) from public.application_knockouts) = 1, 'company B should see only its own knockout';
end $$;
reset role;

-- ===================================================== block 2: careers page
-- CPT-040.

do $$
declare
  a uuid := 'c0000000-0000-4000-8000-000000000001';
  b uuid := 'c0000000-0000-4000-8000-000000000002';
  page jsonb;
begin
  -- Slugs: rules and generation (CP-REQ-001, CP-DEC-002).
  assert public.careers_slug_valid('acme'), 'acme should be valid';
  assert not public.careers_slug_valid('ab'), 'a 2-character slug was valid';
  assert not public.careers_slug_valid('Acme'), 'an uppercase slug was valid';
  assert not public.careers_slug_valid('-acme'), 'a leading dash was valid';
  assert not public.careers_slug_valid('jobs'), 'a reserved slug was valid';
  assert public.slugify_company_name('Acme, Inc.') = 'acme-inc', 'slugify differs';
  assert public.slugify_company_name('X') = 'x-jobs', 'a short name was not padded';
  assert (select careers_slug from public.company_info where id = a) = 'acme', 'Acme did not get the acme slug';
  assert (select careers_slug from public.company_info where id = b) = 'globex', 'Globex did not get the globex slug';
  assert not (select careers_published from public.company_info where id = a), 'a new page is published';

  -- A second company with the same name gets a suffix.
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values ('c1000000-0000-4000-8000-000000000003', 'x@acme2.test', 'authenticated', 'authenticated', now(), '{}');
  insert into public.company_info (id, user_id, name, email)
  values ('c0000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000003', 'Acme', 'x@acme2.test');
  assert (select careers_slug from public.company_info where id = 'c0000000-0000-4000-8000-000000000003') = 'acme-2',
    'a duplicate name did not get acme-2';
  delete from public.company_info where id = 'c0000000-0000-4000-8000-000000000003';

  -- Unpublished pages and unknown slugs return null (CP-REQ-008).
  assert public.get_careers_page('acme') is null, 'an unpublished page is public';
  assert public.get_careers_page('nope') is null, 'an unknown slug returned a page';
end $$;

-- Writes need careers.edit.
set local role authenticated;
select pg_temp.act('c3000000-0000-4000-8000-000000000001');
do $$
begin
  assert (public.claim_careers_slug('acme-careers') ->> 'reason') = 'forbidden', 'a Member claimed a slug';
  assert (public.set_careers_published(true) ->> 'reason') = 'forbidden', 'a Member published the page';
  -- A direct update can't touch the careers columns.
  update public.company_info set careers_published = true, careers_slug = 'hacked'
   where id = 'c0000000-0000-4000-8000-000000000001';
end $$;
reset role;
do $$
begin
  assert (select careers_slug from public.company_info where id = 'c0000000-0000-4000-8000-000000000001') = 'acme',
    'a direct update changed the slug';
  assert not (select careers_published from public.company_info where id = 'c0000000-0000-4000-8000-000000000001'),
    'a direct update published the page';
end $$;

set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare page jsonb;
begin
  assert (public.claim_careers_slug('Bad Slug') ->> 'reason') = 'invalid', 'an invalid slug was claimed';
  assert (public.claim_careers_slug('globex') ->> 'reason') = 'taken', 'another company''s slug was claimed';
  assert (public.save_careers_page('#ZZZZZZ', null, '[]', '{}') ->> 'reason') = 'invalid', 'a bad colour was saved';
  assert (public.save_careers_page(null, 'http://x.test/a.png', '[]', '{}') ->> 'reason') = 'invalid', 'an http cover was saved';
  assert (public.save_careers_page('#4f46e5', null, '[{"id":"s1","kind":"about","hidden":false}]', '{"linkedin":"https://linkedin.com/company/acme"}') ->> 'ok')::boolean,
    'an owner could not save the page';
  assert (public.set_careers_published(true) ->> 'ok')::boolean, 'an owner could not publish';

  -- CP-REQ-002: renaming keeps the old slug as a redirect.
  assert (public.claim_careers_slug('acme-careers') ->> 'ok')::boolean, 'an owner could not change the slug';
  assert public.get_careers_page('acme') = jsonb_build_object('redirect', 'acme-careers'), 'the old slug does not redirect';
  -- …and nobody else can take it for 90 days.
  perform pg_temp.act('c1000000-0000-4000-8000-000000000002');
  assert (public.claim_careers_slug('acme') ->> 'reason') = 'taken', 'another company took a retired slug';
end $$;

-- CP-SEC-001: the public read has public columns only, for anon too.
set local role anon;
select pg_temp.act(null);
do $$
declare page jsonb := public.get_careers_page('acme-careers');
begin
  assert page ->> 'name' = 'Acme', 'anon could not read the published page';
  assert page ->> 'accent_color' = '#4f46e5', 'the accent colour is missing';
  assert not (page ? 'email') and not (page ? 'ai_credits') and not (page ? 'tier_id') and not (page ? 'user_id'),
    'the public page exposes private columns';
end $$;
reset role;

-- Jobs: only active platform postings of a published page (CP-REQ-006).
update public.job_postings set status = 'active' where id = 'b0000000-0000-4000-8000-000000000001';
update public.job_postings set status = 'active' where id = 'b0000000-0000-4000-8000-000000000002';
set local role anon;
do $$
declare jobs jsonb := public.get_careers_jobs('acme-careers');
begin
  assert jsonb_array_length(jobs) = 1 and jobs -> 0 ->> 'title' = 'A1', 'the careers jobs are wrong';
  assert not ((jobs -> 0) ? 'company_id') and not ((jobs -> 0) ? 'embedding'), 'a job exposes private columns';
  assert jsonb_array_length(public.get_careers_jobs('globex')) = 0, 'an unpublished page listed jobs';
end $$;
reset role;


select 'careers_page: ok' as result;

rollback;
