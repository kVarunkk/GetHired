-- Candidate pool (plan/candidate-pool/feature-candidate-pool-tasks.md):
-- block 1 (CPT-010) imports with or without a job and into a list; block 2
-- (CPT-032) candidate embeddings and search_text; block 3 (CPT-050) the match
-- RPCs. Runs in a
-- transaction that always rolls back, so it's safe against the linked project
-- once the migrations are applied:
--   npx supabase db query --linked -f supabase/tests/candidate_pool.sql
-- Any failed check raises an exception; success prints 'candidate_pool: ok'.
-- Ids match supabase/tests/bulk_import.sql where they overlap.

begin;

create function pg_temp.act(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true)
$$;
create function pg_temp.role_of(p_company uuid, p_template text) returns uuid language sql as $$
  select id from public.company_roles where company_id = p_company and template_key = p_template
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
create function pg_temp.emails_queued() returns int language sql security definer as $$
  select count(*)::int from pgmq.q_pipeline_email_queue
$$;
create function pg_temp.invites_queued() returns int language sql security definer as $$
  select count(*)::int from pgmq.q_screening_invite_email_queue
$$;
-- A parsed resume batch as the worker leaves it, for p_user, with one row per
-- (name, email) pair. Returns the batch id.
create function pg_temp.parsed_batch(p_user uuid, p_job uuid, p_rows jsonb) returns uuid language plpgsql security definer as $$
declare
  v_batch uuid := gen_random_uuid();
  a uuid := 'c0000000-0000-4000-8000-000000000001';
begin
  insert into public.candidate_import_batches (id, company_id, kind, job_post_id, opened_from, file_name, status, created_by)
  values (v_batch, a, 'resumes', p_job, case when p_job is null then 'candidates' else 'job' end,
          jsonb_array_length(p_rows) || ' resumes', 'ready', p_user);
  insert into public.candidate_import_rows (id, batch_id, company_id, file_path, file_name, status, extracted, created_at)
  select x.id, v_batch, a, a || '/' || v_batch || '/' || x.id || '.pdf', 'cv' || x.o || '.pdf', 'parsed',
         jsonb_build_object('fields', r - 'x', 'resume', jsonb_build_object('sections', '[]'::jsonb)),
         now() + (x.o || ' seconds')::interval
    from jsonb_array_elements(p_rows) with ordinality as e(r, o)
    cross join lateral (select gen_random_uuid() as id, e.o) x;
  return v_batch;
end $$;

grant execute on function pg_temp.act(uuid), pg_temp.expect(jsonb, text, text), pg_temp.emails_queued(),
  pg_temp.invites_queued() to authenticated;

-- Seed. Company A: owner, Importer (applicants.import on every job, no
-- talent_lists.manage), Scoped (applicants.import on A2 only). Company B:
-- owner. Applicant 1 applied to A1.
insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data) values
  ('c1000000-0000-4000-8000-000000000001', 'hr@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c1000000-0000-4000-8000-000000000002', 'hr@globex.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c6000000-0000-4000-8000-000000000001', 'importer@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c5000000-0000-4000-8000-000000000001', 'scoped@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('a0000000-0000-4000-8000-000000000001', 'one@applicant.test', 'authenticated', 'authenticated', now(), '{}');

insert into public.company_info (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Acme', 'hr@acme.test'),
  ('c0000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'Globex', 'hr@globex.test');

insert into public.user_info (user_id, email, full_name, is_public, filled) values
  ('a0000000-0000-4000-8000-000000000001', 'one@applicant.test', 'one', true, true);

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
  v_importer uuid;
  v_scoped uuid;
begin
  insert into public.company_roles (company_id, name) values (a, 'Importer') returning id into v_importer;
  insert into public.company_role_permissions (role_id, permission_key, scope) values
    (v_importer, 'jobs.view', 'all'), (v_importer, 'applicants.view', 'all'), (v_importer, 'talent.view', 'all'),
    (v_importer, 'applicants.import', 'all');
  insert into public.company_roles (company_id, name) values (a, 'Scoped') returning id into v_scoped;
  insert into public.company_role_permissions (role_id, permission_key, scope) values
    (v_scoped, 'jobs.view', 'assigned'), (v_scoped, 'applicants.view', 'assigned'),
    (v_scoped, 'applicants.import', 'assigned');
  insert into public.company_members (company_id, user_id, role_id, display_name) values
    (a, 'c6000000-0000-4000-8000-000000000001', v_importer, 'Ivy Importer'),
    (a, 'c5000000-0000-4000-8000-000000000001', v_scoped, 'Sam Scoped');
  insert into public.company_job_assignments (company_id, job_post_id, user_id) values
    (a, 'b0000000-0000-4000-8000-000000000003', 'c5000000-0000-4000-8000-000000000001')
  on conflict do nothing;
end $$;

insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001');

insert into public.talent_lists (id, company_id, name, slug) values
  ('70000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Shortlist', 'shortlist'),
  ('70000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'Globex list', 'globex-list');

-- Fay is already one of A's candidates.
insert into public.company_candidates (id, company_id, full_name, email) values
  ('cc000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'Fay', 'fay@mail.test');

-- ================================================ block 1: imports with or without a job
-- CPT-010 (migration 20261026120000_candidate_pool_imports.sql).

set local role authenticated;

-- start_resume_import with no job (CP-REQ-002/004).
select pg_temp.act('c5000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.start_resume_import(null, '[{"name": "a.pdf"}]'), 'forbidden',
    'a member scoped to one job starts a pool import');
  perform pg_temp.expect(public.start_resume_import('b0000000-0000-4000-8000-000000000003', '[{"name": "a.pdf"}]'),
    null, 'a member scoped to A2 imports into A2');
end $$;

select pg_temp.act('c6000000-0000-4000-8000-000000000001');
do $$
declare
  v_res jsonb;
  v_pool uuid;
  v_job uuid;
begin
  v_res := pg_temp.expect(public.start_resume_import(null, '[{"name": "a.pdf"}]'), null, 'a pool import');
  v_pool := (v_res ->> 'batch_id')::uuid;
  assert (select job_post_id is null and opened_from = 'candidates' and status = 'draft'
            from public.candidate_import_batches where id = v_pool), 'the pool batch wasn''t created';
  v_res := pg_temp.expect(public.start_resume_import('b0000000-0000-4000-8000-000000000001', '[{"name": "b.pdf"}]'),
    null, 'a job import');
  v_job := (v_res ->> 'batch_id')::uuid;
  assert (select job_post_id = 'b0000000-0000-4000-8000-000000000001' and opened_from = 'job'
            from public.candidate_import_batches where id = v_job), 'the job batch wasn''t created as before';

  -- The open-batch read tells the two places apart (CP-REQ-011).
  assert (select array_agg(id) from public.candidate_import_batches
           where created_by = 'c6000000-0000-4000-8000-000000000001' and opened_from = 'candidates') = array[v_pool],
    'the Candidates page''s open batch isn''t the pool batch';
  assert (select array_agg(id) from public.candidate_import_batches
           where created_by = 'c6000000-0000-4000-8000-000000000001' and opened_from = 'job'
             and job_post_id = 'b0000000-0000-4000-8000-000000000001') = array[v_job],
    'the job page''s open batch isn''t the job batch';

  -- submit_resume_batch's destination.
  perform pg_temp.expect(public.submit_resume_batch(v_pool,
    array(select id from public.candidate_import_rows where batch_id = v_pool), '{"talent_list_id": "70000000-0000-4000-8000-000000000001"}'),
    'forbidden', 'a list without talent_lists.manage');
  perform pg_temp.expect(public.submit_resume_batch(v_pool,
    array(select id from public.candidate_import_rows where batch_id = v_pool), '{"auto_invite": true}'),
    'invite_needs_job', 'auto-invite without a job');
  perform pg_temp.expect(public.submit_resume_batch(v_pool,
    array(select id from public.candidate_import_rows where batch_id = v_pool),
    '{"stage_id": "00000000-0000-4000-8000-000000000000"}'), 'invalid_stage', 'a stage without a job');
  perform pg_temp.expect(public.submit_resume_batch(v_pool,
    array(select id from public.candidate_import_rows where batch_id = v_pool),
    '{"job_post_id": "b0000000-0000-4000-8000-000000000002"}'), 'not_found', 'another company''s job');
  perform pg_temp.expect(public.submit_resume_batch(v_job,
    array(select id from public.candidate_import_rows where batch_id = v_job),
    '{"job_post_id": "b0000000-0000-4000-8000-000000000003"}'), 'invalid', 'a job page''s batch moved to another job');
  -- A pool batch can be given a job here.
  perform pg_temp.expect(public.submit_resume_batch(v_pool,
    array(select id from public.candidate_import_rows where batch_id = v_pool),
    '{"job_post_id": "b0000000-0000-4000-8000-000000000003"}'), null, 'a pool batch given a job');
  assert (select job_post_id = 'b0000000-0000-4000-8000-000000000003' and opened_from = 'candidates'
            from public.candidate_import_batches where id = v_pool), 'the job wasn''t stored';
end $$;

-- The owner: lists, and stages from another company. B's stage is read
-- before acting as A's owner, whose RLS hides it.
reset role;
select set_config('test.b_stage',
  (select id::text from public.pipeline_stages where company_id = 'c0000000-0000-4000-8000-000000000002' limit 1), true);
set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare
  v_pool uuid := (pg_temp.expect(public.start_resume_import(null, '[{"name": "c.pdf"}]'), null, 'start') ->> 'batch_id')::uuid;
  v_rows uuid[] := array(select id from public.candidate_import_rows where batch_id = v_pool);
  v_b_stage uuid := current_setting('test.b_stage')::uuid;
begin
  perform pg_temp.expect(public.submit_resume_batch(v_pool, v_rows,
    '{"talent_list_id": "70000000-0000-4000-8000-000000000002"}'), 'forbidden', 'another company''s list');
  perform pg_temp.expect(public.submit_resume_batch(v_pool, v_rows,
    jsonb_build_object('job_post_id', 'b0000000-0000-4000-8000-000000000001', 'stage_id', v_b_stage)),
    'invalid_stage', 'another company''s stage');
  perform pg_temp.expect(public.submit_resume_batch(v_pool, v_rows,
    '{"talent_list_id": "70000000-0000-4000-8000-000000000001"}'), null, 'a list');
  assert (select job_post_id is null and talent_list_id = '70000000-0000-4000-8000-000000000001'
            from public.candidate_import_batches where id = v_pool), 'the list wasn''t stored';
end $$;

reset role;

-- confirm_resume_import with no job (CP-REQ-002/005).
create temporary table pool_batches (name text primary key, id uuid);
grant select on pool_batches to authenticated;
insert into pool_batches values
  ('importer_pool', pg_temp.parsed_batch('c6000000-0000-4000-8000-000000000001', null, '[
     {"full_name": "Nia", "email": "nia@mail.test", "current_title": "Designer"},
     {"full_name": "Oli"},
     {"full_name": "Fay F", "email": "Fay@mail.test", "current_title": "PM"},
     {"full_name": "One", "email": "one@applicant.test"}
   ]')),
  ('owner_list', pg_temp.parsed_batch('c1000000-0000-4000-8000-000000000001', null, '[
     {"full_name": "Pia", "email": "pia@mail.test"},
     {"full_name": "Fay", "email": "fay@mail.test"},
     {"full_name": "Quin"},
     {"full_name": "One", "email": "one@applicant.test"}
   ]')),
  ('owner_job_list', pg_temp.parsed_batch('c1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', '[
     {"full_name": "Ray", "email": "ray@mail.test"}
   ]')),
  ('owner_job', pg_temp.parsed_batch('c1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', '[
     {"full_name": "Sol", "email": "sol@mail.test"},
     {"full_name": "Tam"}
   ]'));

set local role authenticated;

select pg_temp.act('c5000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.confirm_candidate_import((select id from pool_batches where name = 'importer_pool'),
    null, '{"attested": true}'), 'forbidden', 'a pool batch, by a member scoped to one job');
end $$;

select pg_temp.act('c6000000-0000-4000-8000-000000000001');
do $$
declare
  b uuid := (select id from pool_batches where name = 'importer_pool');
  v_res jsonb;
  v_emails int := pg_temp.emails_queued();
  v_invites int := pg_temp.invites_queued();
  v_screenings int := (select count(*) from public.application_screenings);
  v_apps int := (select count(*) from public.applications);
begin
  perform pg_temp.expect(public.confirm_candidate_import(b, null,
    '{"attested": true, "talent_list_id": "70000000-0000-4000-8000-000000000001"}'),
    'forbidden', 'a list without talent_lists.manage');
  perform pg_temp.expect(public.confirm_candidate_import(b, null,
    '{"attested": true, "stage_id": "00000000-0000-4000-8000-000000000000"}'), 'invalid_stage', 'a stage without a job');

  v_res := pg_temp.expect(public.confirm_candidate_import(b,
    null, '{"attested": true, "duplicate_action": "fill"}'), null, 'a pool confirm, Oli without an email');
  assert v_res -> 'counts' @> '{"created": 2, "updated": 1, "known": 1, "added_to_job": 0, "added_to_list": 0}'::jsonb,
    format('wrong counts: %s', v_res);
  assert exists (select 1 from public.company_candidates where full_name = 'Oli' and email is null
                  and company_id = 'c0000000-0000-4000-8000-000000000001'), 'Oli wasn''t created without an email';
  assert (select current_title from public.company_candidates where id = 'cc000000-0000-4000-8000-000000000004') = 'PM',
    'Fay wasn''t matched by email and filled';
  assert not exists (select 1 from public.company_candidates where email = 'one@applicant.test'),
    'a known GetHired user became a candidate';
  assert (select count(*) from public.applications) = v_apps, 'a pool import created applications';
  assert (select count(*) from public.application_screenings) = v_screenings, 'a pool import queued screenings';
  assert pg_temp.emails_queued() = v_emails, 'a pool import queued a stage email';
  assert pg_temp.invites_queued() = v_invites, 'a pool import queued an invite';
  assert (select status = 'confirmed' and job_post_id is null and stage_id is null and not auto_invite
            from public.candidate_import_batches where id = b), 'the batch wasn''t confirmed as a pool import';
end $$;

-- A list, with no job and with one (CP-REQ-003).
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare
  l uuid := '70000000-0000-4000-8000-000000000001';
  v_res jsonb;
  v_emails int := pg_temp.emails_queued();
begin
  v_res := pg_temp.expect(public.confirm_candidate_import((select id from pool_batches where name = 'owner_list'),
    null, jsonb_build_object('attested', true, 'talent_list_id', l)), null, 'a list, no job');
  assert v_res -> 'counts' @> '{"created": 2, "skipped": 1, "known": 1, "added_to_list": 4}'::jsonb,
    format('wrong counts: %s', v_res);
  assert (select count(*) from public.talent_list_members m join public.company_candidates c on c.id = m.company_candidate_id
           where m.list_id = l and c.full_name in ('Pia', 'Fay', 'Quin')) = 3, 'the candidates aren''t in the list';
  assert (select count(*) from public.talent_list_members
           where list_id = l and candidate_user_id = 'a0000000-0000-4000-8000-000000000001') = 1,
    'the known user isn''t in the list';

  v_res := pg_temp.expect(public.confirm_candidate_import((select id from pool_batches where name = 'owner_job_list'),
    null, jsonb_build_object('attested', true, 'talent_list_id', l)), null, 'a list and a job');
  assert v_res -> 'counts' @> '{"created": 1, "added_to_job": 1, "added_to_list": 1}'::jsonb,
    format('wrong counts: %s', v_res);
  assert (select count(*) from public.talent_list_members m join public.company_candidates c on c.id = m.company_candidate_id
           where m.list_id = l and c.full_name = 'Ray') = 1, 'Ray isn''t in the list once';
  assert exists (select 1 from public.applications a join public.company_candidates c on c.id = a.company_candidate_id
                  where c.full_name = 'Ray' and a.job_post_id = 'b0000000-0000-4000-8000-000000000001'),
    'Ray wasn''t added to the job';

  -- With a job: unchanged, everyone needs an email (BIT-047).
  v_res := pg_temp.expect(public.confirm_candidate_import((select id from pool_batches where name = 'owner_job'),
    null, '{"attested": true}'), 'missing_email', 'Tam has no email');
  assert jsonb_array_length(v_res -> 'row_ids') = 1, format('wrong rows: %s', v_res);
  assert pg_temp.emails_queued() = v_emails, 'a list import queued a stage email';
end $$;

-- The form's one-row batch takes a list, with and without a job.
do $$
declare
  l uuid := '70000000-0000-4000-8000-000000000001';
  v_batch uuid;
  v_res jsonb;
begin
  v_batch := (public.start_candidate_import('spreadsheet') ->> 'batch_id')::uuid;
  v_res := pg_temp.expect(public.confirm_candidate_import(v_batch, '[{"full_name": "Uma"}]',
    jsonb_build_object('attested', true, 'talent_list_id', l)), null, 'the form, a list');
  assert exists (select 1 from public.talent_list_members m join public.company_candidates c on c.id = m.company_candidate_id
                  where m.list_id = l and c.full_name = 'Uma'), 'Uma isn''t in the list';

  v_batch := (public.start_candidate_import('spreadsheet') ->> 'batch_id')::uuid;
  v_res := pg_temp.expect(public.confirm_candidate_import(v_batch, '[{"full_name": "Vic", "email": "vic@mail.test"}]',
    jsonb_build_object('attested', true, 'talent_list_id', l, 'job_post_id', 'b0000000-0000-4000-8000-000000000001')),
    null, 'the form, a list and a job');
  assert v_res -> 'counts' @> '{"added_to_job": 1, "added_to_list": 1}'::jsonb, format('wrong counts: %s', v_res);
end $$;

reset role;

-- ================================================ block 2: embeddings and search
-- CPT-032 (migration 20261026130000_candidate_pool_matching.sql).

-- Messages for one candidate in candidate_embedding_queue.
create function pg_temp.embeds_queued(p_id uuid) returns int language sql security definer as $$
  select count(*)::int from pgmq.q_candidate_embedding_queue q where q.message ->> 'candidate_id' = p_id::text
$$;
grant execute on function pg_temp.embeds_queued(uuid) to authenticated;

-- Columns, indexes, the backfill (CP-REQ-040/043).
do $$
declare
  v_missing text;
begin
  select string_agg(c, ', ') into v_missing
    from unnest(array['embedding', 'embedding_updated_at', 'embedding_stale', 'search_text']) c
   where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'company_candidates' and column_name = c);
  assert v_missing is null, format('missing columns: %s', v_missing);
  assert (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
           where a.attrelid = 'public.company_candidates'::regclass and a.attname = 'embedding') = 'vector(768)',
    'the embedding isn''t vector(768)';
  assert (select column_default from information_schema.columns
           where table_schema = 'public' and table_name = 'company_candidates' and column_name = 'embedding_stale') = 'true',
    'embedding_stale doesn''t default to true';
  assert exists (select 1 from pg_indexes where indexname = 'company_candidates_embedding_idx' and indexdef ilike '%hnsw%'),
    'no HNSW index';
  assert exists (select 1 from pg_indexes where indexname = 'company_candidates_search_text_idx' and indexdef ilike '%gin_trgm_ops%'),
    'no trigram index';
  -- Every candidate from before this test is embedded, waiting, or was given up on.
  assert not exists (
    select 1 from public.company_candidates c
     where c.created_at < now() and c.embedding_updated_at is null
       and not exists (select 1 from pgmq.q_candidate_embedding_queue q where q.message ->> 'candidate_id' = c.id::text)
       and not exists (select 1 from pgmq.a_candidate_embedding_queue q where q.message ->> 'candidate_id' = c.id::text)
  ), 'a candidate from before the migration wasn''t enqueued';
end $$;

-- The trigger (CP-REQ-042) and search_text (CP-REQ-070).
do $$
declare
  a uuid := 'c0000000-0000-4000-8000-000000000001';
  v_id uuid;
  v_row public.company_candidates%rowtype;
  v_col text;
begin
  insert into public.company_candidates (company_id, full_name, email, current_title, current_company, skills)
  values (a, 'Gil Grant', 'gil@mail.test', 'Data Engineer', 'Initech', '{Spark,Airflow}')
  returning id into v_id;
  select * into v_row from public.company_candidates where id = v_id;
  assert pg_temp.embeds_queued(v_id) = 1, 'insert didn''t enqueue once';
  assert v_row.embedding_stale, 'a new candidate isn''t stale';
  assert v_row.search_text = 'gil grant gil@mail.test data engineer initech spark airflow',
    format('wrong search_text: %s', v_row.search_text);

  -- The worker's write: no new message, and it sticks.
  update public.company_candidates
     set embedding = array_fill(0.1, array[768])::public.vector, embedding_updated_at = now(), embedding_stale = false
   where id = v_id;
  assert pg_temp.embeds_queued(v_id) = 1, 'writing the embedding enqueued';
  assert not (select embedding_stale from public.company_candidates where id = v_id), 'the worker''s write didn''t stick';

  -- Columns that aren't embedded.
  update public.company_candidates
     set tags = '{senior}', notes = 'Met at a meetup', full_name = 'Gil G', email = 'gil.g@mail.test',
         email_opted_out_at = now()
   where id = v_id;
  select * into v_row from public.company_candidates where id = v_id;
  assert pg_temp.embeds_queued(v_id) = 1, 'a change to tags, notes, name or email enqueued';
  assert not v_row.embedding_stale, 'a change to tags, notes, name or email made it stale';
  assert v_row.search_text = 'gil g gil.g@mail.test data engineer initech spark airflow',
    format('search_text didn''t follow: %s', v_row.search_text);
  update public.company_candidates set search_text = 'forged' where id = v_id;
  assert (select search_text from public.company_candidates where id = v_id) <> 'forged', 'search_text was written';

  -- Each embedded column.
  foreach v_col in array array['current_title', 'current_company', 'experience_years', 'location', 'skills', 'resume_content'] loop
    update public.company_candidates set embedding_stale = false where id = v_id;
    execute format('update public.company_candidates set %I = %s where id = $1', v_col,
      case v_col when 'experience_years' then '7' when 'skills' then '''{Spark,dbt}''::text[]'
                 when 'resume_content' then '''{"sections": []}''::jsonb' else quote_literal('changed ' || v_col) end)
      using v_id;
    assert (select embedding_stale from public.company_candidates where id = v_id), format('%s didn''t make it stale', v_col);
  end loop;
  assert pg_temp.embeds_queued(v_id) = 7, format('expected 7 messages, got %s', pg_temp.embeds_queued(v_id));

  -- Setting an embedded column to its own value isn't a change.
  update public.company_candidates set location = location where id = v_id;
  assert pg_temp.embeds_queued(v_id) = 7, 'an unchanged value enqueued';
end $$;

-- Users can't write the derived columns or use the queue, and the RPC doesn't
-- write them either (CP-SEC-002).
set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare
  v_id uuid := 'cc000000-0000-4000-8000-000000000004';
  v_before public.company_candidates%rowtype;
  v_after public.company_candidates%rowtype;
begin
  begin
    update public.company_candidates set embedding_stale = false, search_text = 'x' where id = v_id;
    raise exception 'authenticated updated the derived columns';
  exception when insufficient_privilege then null;
  end;
  begin
    perform pgmq.send('candidate_embedding_queue', '{}'::jsonb);
    raise exception 'authenticated sent to the embedding queue';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from pgmq.q_candidate_embedding_queue;
    raise exception 'authenticated read the embedding queue';
  exception when insufficient_privilege then null;
  end;

  select * into v_before from public.company_candidates where id = v_id;
  perform pg_temp.expect(public.update_company_candidate(v_id,
    '{"embedding": [0.2], "embedding_stale": false, "search_text": "x"}'), 'invalid', 'the RPC takes derived columns');
  perform pg_temp.expect(public.update_company_candidate(v_id, '{"notes": "Strong SQL"}'), null, 'a notes edit');
  select * into v_after from public.company_candidates where id = v_id;
  assert v_after.embedding_stale = v_before.embedding_stale
     and v_after.embedding_updated_at is not distinct from v_before.embedding_updated_at,
    'a notes edit changed the embedding columns';
  perform pg_temp.expect(public.update_company_candidate(v_id, '{"current_title": "Analyst"}'), null, 'a title edit');
  select * into v_after from public.company_candidates where id = v_id;
  assert v_after.embedding_stale, 'a title edit through the RPC didn''t make it stale';
  assert v_after.search_text like '%analyst%', 'a title edit through the RPC didn''t update search_text';
end $$;

reset role;

-- The service role can send and read.
set local role service_role;
do $$ begin
  perform pgmq.send('candidate_embedding_queue', jsonb_build_object('candidate_id', gen_random_uuid()));
  perform count(*) from pgmq.q_candidate_embedding_queue;
end $$;

reset role;

-- ================================================ block 3: matching
-- CPT-050 (migration 20261026130000_candidate_pool_matching.sql, part 6).

-- A 768-dimension vector pointing at (x, y) in its first two dimensions.
create function pg_temp.vec(x real, y real) returns public.vector language sql as $$
  select (array[x, y] || array_fill(0::real, array[766]))::public.vector
$$;
-- The ids in a match result, in order.
create function pg_temp.ids(p_res jsonb, p_key text default 'company_candidate_id') returns uuid[] language sql as $$
  select coalesce(array_agg((x.e ->> p_key)::uuid order by x.o), '{}')
    from jsonb_array_elements(p_res -> 'matches') with ordinality as x(e, o)
$$;
grant execute on function pg_temp.ids(jsonb, text) to authenticated;

-- Seed. A1 points at (1, 0), A2 at (0.8, 0.6), A3 (closed) at (1, 0), B1 at
-- (1, 0). Candidates of A: p1 (1, 0); p2 (0.8, 0.6); p3 (0, 1), below the
-- threshold; p4 no embedding; p5 (1, 0) claimed by applicant 1, who applied
-- to A1 with their own account (and another email); p6 (1, 0) but already
-- applied to A1; p7 (0.9, 0.44) with an A1 application merged into another;
-- p8 (1, 0) claimed by applicant 2, who applied nowhere (BIT-104).
-- q1 (1, 0) is B's. Pool Viewer: talent.view, jobs.view on A2 only.
insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data) values
  ('c7000000-0000-4000-8000-000000000001', 'viewer@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('a0000000-0000-4000-8000-000000000002', 'two@applicant.test', 'authenticated', 'authenticated', now(), '{}');

insert into public.all_jobs (id, job_name, job_url, company_name, platform) values
  ('d0000000-0000-4000-8000-000000000004', 'A3', 'https://acme.test/jobs/3', 'Acme', 'gethired');
insert into public.job_postings (id, company_id, title, job_id, status) values
  ('b0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'A3', 'd0000000-0000-4000-8000-000000000004', 'inactive');

update public.job_postings set embedding_new = pg_temp.vec(1, 0)
 where id in ('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000004');
update public.job_postings set embedding_new = null where id = 'b0000000-0000-4000-8000-000000000003';

insert into public.company_candidates (id, company_id, full_name) values
  ('cd000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'P1'),
  ('cd000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'P2'),
  ('cd000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'P3'),
  ('cd000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'P4'),
  ('cd000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000001', 'P6'),
  ('cd000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000001', 'P7'),
  ('cd000000-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000001', 'P8'),
  ('cd000000-0000-4000-8000-0000000000b1', 'c0000000-0000-4000-8000-000000000002', 'Q1');
insert into public.company_candidates (id, company_id, full_name, email) values
  ('cd000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001', 'P5', 'p5@elsewhere.test');
update public.company_candidates c set embedding = v.e, embedding_stale = false, embedding_updated_at = now()
  from (values
    ('cd000000-0000-4000-8000-000000000001'::uuid, pg_temp.vec(1, 0)),
    ('cd000000-0000-4000-8000-000000000002', pg_temp.vec(0.8, 0.6)),
    ('cd000000-0000-4000-8000-000000000003', pg_temp.vec(0, 1)),
    ('cd000000-0000-4000-8000-000000000005', pg_temp.vec(1, 0)),
    ('cd000000-0000-4000-8000-000000000006', pg_temp.vec(1, 0)),
    ('cd000000-0000-4000-8000-000000000007', pg_temp.vec(0.9, 0.44)),
    ('cd000000-0000-4000-8000-000000000008', pg_temp.vec(1, 0)),
    ('cd000000-0000-4000-8000-0000000000b1', pg_temp.vec(1, 0))) as v(id, e)
 where c.id = v.id;
update public.company_candidates set claimed_user_id = 'a0000000-0000-4000-8000-000000000001', claimed_at = now()
 where id = 'cd000000-0000-4000-8000-000000000005';
update public.company_candidates set claimed_user_id = 'a0000000-0000-4000-8000-000000000002', claimed_at = now()
 where id = 'cd000000-0000-4000-8000-000000000008';

insert into public.applications (id, company_candidate_id, job_post_id, all_jobs_id) values
  ('ed000000-0000-4000-8000-000000000006', 'cd000000-0000-4000-8000-000000000006',
   'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
  ('ed000000-0000-4000-8000-000000000007', 'cd000000-0000-4000-8000-000000000007',
   'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001');
update public.applications set merged_into_application_id = 'e0000000-0000-4000-8000-000000000001'
 where id = 'ed000000-0000-4000-8000-000000000007';

do $$
declare
  a uuid := 'c0000000-0000-4000-8000-000000000001';
  v_viewer uuid;
begin
  insert into public.company_roles (company_id, name) values (a, 'Pool Viewer') returning id into v_viewer;
  insert into public.company_role_permissions (role_id, permission_key, scope) values
    (v_viewer, 'talent.view', 'all'), (v_viewer, 'jobs.view', 'assigned');
  insert into public.company_members (company_id, user_id, role_id, display_name) values
    (a, 'c7000000-0000-4000-8000-000000000001', v_viewer, 'Vera Viewer');
  insert into public.company_job_assignments (company_id, job_post_id, user_id) values
    (a, 'b0000000-0000-4000-8000-000000000003', 'c7000000-0000-4000-8000-000000000001')
  on conflict do nothing;
end $$;

set local role authenticated;

-- match_company_candidates (CP-REQ-050).
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare
  a1 uuid := 'b0000000-0000-4000-8000-000000000001';
  v_res jsonb;
begin
  v_res := pg_temp.expect(public.match_company_candidates(a1), null, 'the owner matches A1');
  -- p8 is claimed and still matches; p5's account already applied (BIT-104).
  assert pg_temp.ids(v_res) = array['cd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000008',
                                    'cd000000-0000-4000-8000-000000000007', 'cd000000-0000-4000-8000-000000000002']::uuid[],
    format('wrong matches for A1: %s', v_res);
  assert (v_res ->> 'job_embedded')::boolean, 'A1 has an embedding';
  -- p1, p2, p3, p5, p6, p7, p8 and Gil from block 2; not p4 or B's q1.
  assert (v_res ->> 'pool_size')::int = (select count(*) from public.company_candidates
                                          where company_id = 'c0000000-0000-4000-8000-000000000001' and embedding is not null),
    format('wrong pool_size: %s', v_res);
  assert (v_res ->> 'pool_size')::int >= 6, format('pool_size too small: %s', v_res);
  assert ((v_res -> 'matches' -> 0 ->> 'similarity')::real) > 0.99, format('wrong similarity: %s', v_res);
  assert not exists (select 1 from jsonb_array_elements(v_res -> 'matches') e
                      where e ? 'embedding' or e ? 'full_name' or e ? 'email'), 'a match carries contact details';
  assert (v_res -> 'matches' -> 0) ?& array['has_email', 'has_resume'], format('no badges: %s', v_res);
  assert not (v_res -> 'matches' -> 0 ->> 'has_email')::boolean, 'P1 has no email';

  v_res := public.match_company_candidates(a1, 1);
  assert pg_temp.ids(v_res) = array['cd000000-0000-4000-8000-000000000001']::uuid[], format('p_limit: %s', v_res);
  v_res := public.match_company_candidates(a1, 50, 0.85);
  assert pg_temp.ids(v_res) = array['cd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000008',
                                    'cd000000-0000-4000-8000-000000000007']::uuid[],
    format('p_min_similarity: %s', v_res);
  v_res := public.match_company_candidates(a1, 100000, 0);
  assert jsonb_array_length(v_res -> 'matches') <= 200, 'p_limit isn''t capped';
  assert 'cd000000-0000-4000-8000-000000000003'::uuid = any(pg_temp.ids(v_res)), 'a zero threshold drops someone';

  v_res := pg_temp.expect(public.match_company_candidates('b0000000-0000-4000-8000-000000000003'), null, 'A2, not embedded');
  assert not (v_res ->> 'job_embedded')::boolean and jsonb_array_length(v_res -> 'matches') = 0,
    format('a job with no embedding matched: %s', v_res);
  perform pg_temp.expect(public.match_company_candidates('b0000000-0000-4000-8000-000000000002'), 'not_found',
    'another company''s job');
  perform pg_temp.expect(public.match_company_candidates(gen_random_uuid()), 'not_found', 'no such job');
end $$;

-- Without talent.view, and without jobs.view for the job.
select pg_temp.act('c5000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.match_company_candidates('b0000000-0000-4000-8000-000000000003'), 'forbidden',
    'a member without talent.view');
end $$;
select pg_temp.act('c7000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.match_company_candidates('b0000000-0000-4000-8000-000000000001'), 'forbidden',
    'a member without jobs.view for A1');
  perform pg_temp.expect(public.match_company_candidates('b0000000-0000-4000-8000-000000000003'), null,
    'a member with jobs.view for A2');
end $$;

-- match_jobs_for_company_candidate (CP-REQ-062). A2 isn't embedded yet: give
-- it (0.8, 0.6) as the owner of the data would.
reset role;
update public.job_postings set embedding_new = pg_temp.vec(0.8, 0.6) where id = 'b0000000-0000-4000-8000-000000000003';
set local role authenticated;

select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare
  a1 uuid := 'b0000000-0000-4000-8000-000000000001';
  a2 uuid := 'b0000000-0000-4000-8000-000000000003';
  v_res jsonb;
begin
  v_res := pg_temp.expect(public.match_jobs_for_company_candidate('cd000000-0000-4000-8000-000000000001'), null, 'P1''s jobs');
  -- A3 is closed and B1 is another company's.
  assert pg_temp.ids(v_res, 'job_post_id') = array[a1, a2], format('wrong jobs for P1: %s', v_res);
  assert not exists (select 1 from jsonb_array_elements(v_res -> 'matches') e where e ? 'embedding'),
    'a job match carries the embedding';

  v_res := public.match_jobs_for_company_candidate('cd000000-0000-4000-8000-000000000006');
  assert pg_temp.ids(v_res, 'job_post_id') = array[a2], format('P6 already applied to A1: %s', v_res);
  v_res := public.match_jobs_for_company_candidate('cd000000-0000-4000-8000-000000000007');
  assert a1 = any(pg_temp.ids(v_res, 'job_post_id')), format('P7''s merged application hid A1: %s', v_res);
  -- BIT-104: claimed candidates match; the account's own application counts.
  v_res := public.match_jobs_for_company_candidate('cd000000-0000-4000-8000-000000000008');
  assert pg_temp.ids(v_res, 'job_post_id') = array[a1, a2], format('wrong jobs for claimed P8: %s', v_res);
  v_res := public.match_jobs_for_company_candidate('cd000000-0000-4000-8000-000000000005');
  assert pg_temp.ids(v_res, 'job_post_id') = array[a2], format('P5''s account already applied to A1: %s', v_res);

  -- Adding P5 to A1 from a match: their account's application already counts,
  -- though its email isn't P5's.
  v_res := pg_temp.expect(public.add_candidates_to_job(a1, array['cd000000-0000-4000-8000-000000000005'::uuid]), null,
    'add claimed P5 to A1');
  assert (v_res -> 'counts' ->> 'already_in_job')::int = 1 and (v_res -> 'counts' ->> 'added_to_job')::int = 0,
    format('P5 got a second A1 application: %s', v_res);
  v_res := pg_temp.expect(public.add_candidates_to_job(a2, array['cd000000-0000-4000-8000-000000000005'::uuid]), null,
    'add claimed P5 to A2');
  assert (v_res -> 'counts' ->> 'added_to_job')::int = 1, format('claimed P5 wasn''t added to A2: %s', v_res);

  v_res := pg_temp.expect(public.match_jobs_for_company_candidate('cd000000-0000-4000-8000-000000000004'), null, 'P4');
  assert not (v_res ->> 'candidate_embedded')::boolean and jsonb_array_length(v_res -> 'matches') = 0,
    format('a candidate with no embedding matched: %s', v_res);
  perform pg_temp.expect(public.match_jobs_for_company_candidate('cd000000-0000-4000-8000-0000000000b1'), 'not_found',
    'another company''s candidate');
end $$;

select pg_temp.act('c7000000-0000-4000-8000-000000000001');
do $$
declare
  v_res jsonb;
begin
  v_res := pg_temp.expect(public.match_jobs_for_company_candidate('cd000000-0000-4000-8000-000000000001'), null,
    'the viewer');
  assert pg_temp.ids(v_res, 'job_post_id') = array['b0000000-0000-4000-8000-000000000003']::uuid[],
    format('the viewer sees a job without jobs.view: %s', v_res);
end $$;
select pg_temp.act('c5000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.match_jobs_for_company_candidate('cd000000-0000-4000-8000-000000000001'), 'forbidden',
    'a member without talent.view');
end $$;

reset role;

-- anon can't call either.
set local role anon;
do $$ begin
  begin
    perform public.match_company_candidates('b0000000-0000-4000-8000-000000000001');
    raise exception 'anon ran match_company_candidates';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.match_jobs_for_company_candidate('cd000000-0000-4000-8000-000000000001');
    raise exception 'anon ran match_jobs_for_company_candidate';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

select 'candidate_pool: ok';

rollback;
