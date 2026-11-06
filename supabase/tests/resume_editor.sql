-- RET-010: the resume editor migration (plan/resume-editor/feature-resume-editor-tasks.md).
-- Runs in a transaction that always rolls back, so it's safe against the linked
-- project once the migration is applied:
--   npx supabase db query --linked -f supabase/tests/resume_editor.sql
-- Any failed check raises an exception; success prints 'resume_editor: ok'.

begin;

create function pg_temp.act(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true)
$$;
grant execute on function pg_temp.act(uuid) to authenticated, anon;

-- Ada and Bob are applicants. Acme's owner has Ada's application, so Acme has
-- access to her; it has none to Bob. Dan owns Other Co, with no access to anyone.
insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-000000000001', 'ada@applicant.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000002', 'bob@applicant.test', 'authenticated', 'authenticated'),
  ('c1000000-0000-4000-8000-000000000001', 'hr@acme.test', 'authenticated', 'authenticated'),
  ('c1000000-0000-4000-8000-000000000002', 'dan@other.test', 'authenticated', 'authenticated');

insert into public.user_info (user_id, email, full_name, is_public, filled, invitations_count, referral_code) values
  ('a0000000-0000-4000-8000-000000000001', 'ada@applicant.test', 'Ada', false, true, 3, 'ada-code'),
  ('a0000000-0000-4000-8000-000000000002', 'bob@applicant.test', 'Bob', false, true, 3, 'bob-code');

insert into public.company_info (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Acme', 'hr@acme.test'),
  ('c0000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'Other Co', 'dan@other.test');

insert into public.all_jobs (id, job_name, job_url, company_name, platform, is_platform_job) values
  ('d0000000-0000-4000-8000-000000000001', 'A job', 'https://acme.test/jobs/1', 'Acme', 'gethired', true);

insert into public.job_postings (id, company_id, title, job_id) values
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'A job', 'd0000000-0000-4000-8000-000000000001');

-- ---------------------------------------------- columns, defaults, old inserts
do $$
declare
  v public.resumes%rowtype;
begin
  -- An insert with only the old columns, as the deployed code makes.
  insert into public.resumes (id, user_id, name, resume_path, content)
  values ('e1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'cv.pdf', 'resumes/a/cv.pdf', null)
  returning * into v;
  if v.revision <> 1 or v.schema_version <> 1 or v.template <> 'classic' then
    raise exception 'resumes defaults: %', to_jsonb(v);
  end if;
  if v.contact is not null or v.source_resume_id is not null or v.parse_notes is not null then
    raise exception 'resumes nullable columns: %', to_jsonb(v);
  end if;
end $$;

insert into public.resumes (id, user_id, name, content, contact, schema_version) values
  ('e1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'Bob CV',
   '{"version":2,"sections":[]}', '{"fullName":"Bob","links":[]}', 2);

insert into public.resume_reviews (id, user_id, resume_id, name) values
  ('e2000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'Ada review'),
  ('e2000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 'Bob review');

do $$
begin
  if exists (select 1 from public.resume_reviews where resume_revision is not null or applied_copy_id is not null) then
    raise exception 'resume_reviews new columns should start null';
  end if;
end $$;

-- One relationship between resume_reviews and resumes, so the deployed
-- `resumes(...)` embed stays unambiguous (PGRST201).
do $$
declare
  n int;
begin
  select count(*) into n from pg_constraint
  where contype = 'f' and conrelid = 'public.resume_reviews'::regclass and confrelid = 'public.resumes'::regclass;
  if n <> 1 then raise exception 'expected one resume_reviews to resumes foreign key, found %', n; end if;

  -- And resume_review_applied isn't a join table: its primary key holds neither.
  select count(*) into n from pg_constraint
  where contype = 'p' and conrelid = 'public.resume_review_applied'::regclass and array_length(conkey, 1) <> 1;
  if n <> 0 then raise exception 'resume_review_applied must keep a surrogate primary key'; end if;
end $$;

-- ----------------------------------------------------------------- size checks
do $$
begin
  begin
    update public.resumes set content = jsonb_build_object('x', repeat('a', 1000001))
    where id = 'e1000000-0000-4000-8000-000000000001';
    raise exception 'oversized content was accepted';
  exception when check_violation then null;
  end;

  begin
    update public.resumes set contact = jsonb_build_object('x', repeat('a', 20001))
    where id = 'e1000000-0000-4000-8000-000000000001';
    raise exception 'oversized contact was accepted';
  exception when check_violation then null;
  end;

  -- Just under the cap passes.
  update public.resumes set contact = jsonb_build_object('x', repeat('a', 19000))
  where id = 'e1000000-0000-4000-8000-000000000001';
  update public.resumes set contact = '{"fullName":"Ada","links":[]}'
  where id = 'e1000000-0000-4000-8000-000000000001';
end $$;

-- ---------------------------------------------------------------- foreign keys
do $$
declare
  v_copy uuid := 'e1000000-0000-4000-8000-000000000003';
  v_source uuid := 'e1000000-0000-4000-8000-000000000004';
begin
  insert into public.resumes (id, user_id, name) values (v_source, 'a0000000-0000-4000-8000-000000000001', 'Source');
  insert into public.resumes (id, user_id, name, source_resume_id)
  values (v_copy, 'a0000000-0000-4000-8000-000000000001', 'Copy', v_source);
  update public.resume_reviews set applied_copy_id = v_copy where id = 'e2000000-0000-4000-8000-000000000001';

  -- A deleted source leaves the copy, with no source.
  delete from public.resumes where id = v_source;
  if (select source_resume_id from public.resumes where id = v_copy) is not null then
    raise exception 'source_resume_id should go null';
  end if;

  -- A deleted copy leaves the review, with no copy.
  delete from public.resumes where id = v_copy;
  if (select applied_copy_id from public.resume_reviews where id = 'e2000000-0000-4000-8000-000000000001') is not null then
    raise exception 'applied_copy_id should go null';
  end if;

  -- A deleted resume still takes its reviews.
  insert into public.resumes (id, user_id, name) values (v_source, 'a0000000-0000-4000-8000-000000000001', 'Source');
  insert into public.resume_reviews (id, user_id, resume_id)
  values ('e2000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', v_source);
  delete from public.resumes where id = v_source;
  if exists (select 1 from public.resume_reviews where id = 'e2000000-0000-4000-8000-000000000003') then
    raise exception 'resume_reviews should cascade from resume_id';
  end if;
end $$;

-- A deleted resume keeps its migration item, because its file must still go.
do $$
declare
  v_resume uuid := 'e1000000-0000-4000-8000-000000000005';
begin
  insert into public.resumes (id, user_id, name, resume_path)
  values (v_resume, 'a0000000-0000-4000-8000-000000000001', 'Old', 'resumes/a/old.pdf');
  insert into public.resume_migration_items (resume_id, user_id, file_path)
  values (v_resume, 'a0000000-0000-4000-8000-000000000001', 'resumes/a/old.pdf');
  delete from public.resumes where id = v_resume;
  if not exists (select 1 from public.resume_migration_items where file_path = 'resumes/a/old.pdf' and resume_id is null) then
    raise exception 'the migration item should outlive the resume';
  end if;
end $$;

-- A row for each of the reviews, written as the system.
insert into public.resume_review_applied (review_id, bullet_id, target_resume_id, previous_text, applied_text) values
  ('e2000000-0000-4000-8000-000000000001', 'b1', 'e1000000-0000-4000-8000-000000000001', 'old', 'new'),
  ('e2000000-0000-4000-8000-000000000002', 'b1', 'e1000000-0000-4000-8000-000000000002', 'old', 'new');

insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id, resume_id, resume_snapshot, resume_contact_snapshot) values
  ('e3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'e1000000-0000-4000-8000-000000000001', '{"name":"cv"}', '{"fullName":"Ada"}');

set local role authenticated;

-- --------------------------------------------- resume_review_applied (Ada acts)
select pg_temp.act('a0000000-0000-4000-8000-000000000001');

do $$
declare
  n int;
begin
  select count(*) into n from public.resume_review_applied;
  if n <> 1 then raise exception 'Ada should see only her applied row, saw %', n; end if;

  -- Her own review and resume.
  insert into public.resume_review_applied (review_id, bullet_id, target_resume_id, previous_text, applied_text)
  values ('e2000000-0000-4000-8000-000000000001', 'b2', 'e1000000-0000-4000-8000-000000000001', 'old', 'new');

  -- Bob's review.
  begin
    insert into public.resume_review_applied (review_id, bullet_id, target_resume_id, previous_text, applied_text)
    values ('e2000000-0000-4000-8000-000000000002', 'b3', 'e1000000-0000-4000-8000-000000000001', 'old', 'new');
    raise exception 'Ada wrote to Bob''s review';
  exception when insufficient_privilege then null;
  end;

  -- Her review, but Bob's resume.
  begin
    insert into public.resume_review_applied (review_id, bullet_id, target_resume_id, previous_text, applied_text)
    values ('e2000000-0000-4000-8000-000000000001', 'b4', 'e1000000-0000-4000-8000-000000000002', 'old', 'new');
    raise exception 'Ada targeted Bob''s resume';
  exception when insufficient_privilege then null;
  end;

  update public.resume_review_applied set applied_text = 'hacked' where review_id = 'e2000000-0000-4000-8000-000000000002';
  delete from public.resume_review_applied where review_id = 'e2000000-0000-4000-8000-000000000002';
end $$;

reset role;
do $$
begin
  if not exists (
    select 1 from public.resume_review_applied
    where review_id = 'e2000000-0000-4000-8000-000000000002' and applied_text = 'new'
  ) then
    raise exception 'Ada changed Bob''s applied row';
  end if;
end $$;

-- ---------------------------------------------------- resume_migration_items
set local role authenticated;
do $$
begin
  perform 1 from public.resume_migration_items;
  raise exception 'authenticated read resume_migration_items';
exception when insufficient_privilege then null;
end $$;

reset role;
set local role anon;
select pg_temp.act(null);
do $$
begin
  perform 1 from public.resume_migration_items;
  raise exception 'anon read resume_migration_items';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform 1 from public.resume_review_applied;
  raise exception 'anon read resume_review_applied';
exception when insufficient_privilege then null;
end $$;

-- -------------------------------------------- resumes.contact (companies)
reset role;
set local role authenticated;

-- Acme has Ada's application.
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
begin
  if not exists (select 1 from public.resumes where id = 'e1000000-0000-4000-8000-000000000001' and contact is not null) then
    raise exception 'Acme should read the contact of an applicant to its job';
  end if;
  if exists (select 1 from public.resumes where id = 'e1000000-0000-4000-8000-000000000002') then
    raise exception 'Acme read a candidate it has no access to';
  end if;
end $$;

-- Other Co has no candidate access at all.
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$
begin
  if exists (select 1 from public.resumes) then
    raise exception 'a company without candidate access read resumes';
  end if;
end $$;

-- ---------------------------------------------------- the snapshot write guards
-- The applicant can't rewrite what was sent.
select pg_temp.act('a0000000-0000-4000-8000-000000000001');
do $$
begin
  begin
    update public.applications set resume_snapshot = '{"name":"edited"}'
    where id = 'e3000000-0000-4000-8000-000000000001';
    raise exception 'the applicant changed resume_snapshot';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.applications set resume_contact_snapshot = '{"fullName":"Eve"}'
    where id = 'e3000000-0000-4000-8000-000000000001';
    raise exception 'the applicant changed resume_contact_snapshot';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Nor can the company.
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
begin
  update public.applications set resume_contact_snapshot = '{"fullName":"Eve"}'
  where id = 'e3000000-0000-4000-8000-000000000001';
  if found then raise exception 'the company changed resume_contact_snapshot'; end if;
exception when insufficient_privilege then null;
end $$;

reset role;

-- The service role can, for the backfill (RE-REQ-097).
set local role service_role;
update public.applications set resume_snapshot = '{"name":"filled"}'
where id = 'e3000000-0000-4000-8000-000000000001';
reset role;

select 'resume_editor: ok';

-- ------------------------------------------------------------ the re-parse queue
do $$
begin
  if has_table_privilege('authenticated', 'pgmq.q_resume_reparse_queue', 'select')
     or has_table_privilege('anon', 'pgmq.q_resume_reparse_queue', 'select') then
    raise exception 'browser roles can read resume_reparse_queue';
  end if;
end $$;

rollback;
