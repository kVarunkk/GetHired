-- Job pipelines (plan/job-pipelines/feature-job-pipelines-tasks.md, phase 1).
-- Blocks: 1 schema and backfill (JPT-010), 2 stage rules per pipeline
-- (JPT-011), 3 jobs and applications (JPT-012), 4 imports, funnel and plans
-- (JPT-013), 5 pipeline admin RPCs (JPT-014), 6 set_job_pipeline (JPT-015),
-- 7 fork_job_pipeline (JPT-016).
-- Runs in a transaction that always rolls back, so it's safe against the
-- linked project once 20261115130000_job_pipelines.sql is applied:
--   npx supabase db query --linked -f supabase/tests/job_pipelines.sql
-- Any failed check raises an exception; success prints 'job_pipelines: ok'.

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
-- Whether p_sql raises (any error) for the current role.
create function pg_temp.raises(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end $$;
-- Rows waiting in every pgmq queue (JP-CON-002: a switch emails nobody).
create function pg_temp.queued() returns bigint language plpgsql as $$
declare
  t text;
  n bigint := 0;
  c bigint;
begin
  for t in select tablename from pg_tables where schemaname = 'pgmq' and tablename like 'q\_%' loop
    execute format('select count(*) from pgmq.%I', t) into c;
    n := n + c;
  end loop;
  return n;
end $$;
-- A company's stage of `kind` in the pipeline named `p_pipeline`.
create function pg_temp.stage(p_company uuid, p_pipeline text, p_kind public.pipeline_stage_kind, p_name text default null)
returns uuid language sql as $$
  select s.id from public.pipeline_stages s
    join public.company_pipelines p on p.id = s.pipeline_id
   where p.company_id = p_company and p.name = p_pipeline and not p.archived
     and s.kind = p_kind and (p_name is null or s.name = p_name)
   order by s.position limit 1
$$;
grant execute on function pg_temp.act(uuid), pg_temp.expect(jsonb, text, text), pg_temp.raises(text)
  to authenticated, anon;

-- Seed. Company A: Owen (owner), Jed (edits job A1 only), Sam (settings.stages
-- and reads applicants), Vic (nothing). Company B: Bea (owner).
insert into auth.users (id, email, aud, role) values
  ('c1000000-0000-4000-8000-000000000001', 'owen@acme.test', 'authenticated', 'authenticated'),
  ('c1000000-0000-4000-8000-000000000002', 'bea@globex.test', 'authenticated', 'authenticated'),
  ('c5000000-0000-4000-8000-000000000001', 'jed@acme.test', 'authenticated', 'authenticated'),
  ('c6000000-0000-4000-8000-000000000001', 'sam@acme.test', 'authenticated', 'authenticated'),
  ('c3000000-0000-4000-8000-000000000001', 'vic@acme.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000001', 'one@applicant.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000002', 'two@applicant.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000003', 'three@applicant.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000004', 'four@applicant.test', 'authenticated', 'authenticated');

insert into public.company_info (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Acme', 'owen@acme.test'),
  ('c0000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'Globex', 'bea@globex.test');

insert into public.user_info (user_id, email, full_name, is_public, filled) values
  ('a0000000-0000-4000-8000-000000000001', 'one@applicant.test', 'One', true, true),
  ('a0000000-0000-4000-8000-000000000002', 'two@applicant.test', 'Two', true, true),
  ('a0000000-0000-4000-8000-000000000003', 'three@applicant.test', 'Three', true, true),
  ('a0000000-0000-4000-8000-000000000004', 'four@applicant.test', 'Four', true, true);

insert into public.all_jobs (id, job_name, job_url, company_name, platform) values
  ('d0000000-0000-4000-8000-000000000001', 'A1', 'https://acme.test/jobs/1', 'Acme', 'gethired'),
  ('d0000000-0000-4000-8000-000000000002', 'A2', 'https://acme.test/jobs/2', 'Acme', 'gethired'),
  ('d0000000-0000-4000-8000-000000000003', 'B1', 'https://globex.test/jobs/1', 'Globex', 'gethired');

insert into public.job_postings (id, company_id, title, job_id, status) values
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'A1', 'd0000000-0000-4000-8000-000000000001', 'active'),
  ('b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'A2', 'd0000000-0000-4000-8000-000000000002', 'active'),
  ('b0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000002', 'B1', 'd0000000-0000-4000-8000-000000000003', 'active');

do $$
declare
  a uuid := 'c0000000-0000-4000-8000-000000000001';
  v_jed uuid;
  v_sam uuid;
  v_vic uuid;
begin
  insert into public.company_roles (company_id, name) values (a, 'Job editor') returning id into v_jed;
  insert into public.company_role_permissions (role_id, permission_key, scope) values
    (v_jed, 'jobs.view', 'assigned'), (v_jed, 'jobs.edit', 'assigned'), (v_jed, 'applicants.view', 'assigned');
  insert into public.company_roles (company_id, name) values (a, 'Stages') returning id into v_sam;
  insert into public.company_role_permissions (role_id, permission_key, scope) values
    (v_sam, 'jobs.view', 'all'), (v_sam, 'applicants.view', 'all'), (v_sam, 'settings.stages', 'all');
  insert into public.company_roles (company_id, name) values (a, 'Nothing') returning id into v_vic;
  insert into public.company_members (company_id, user_id, role_id, display_name) values
    (a, 'c5000000-0000-4000-8000-000000000001', v_jed, 'Jed'),
    (a, 'c6000000-0000-4000-8000-000000000001', v_sam, 'Sam'),
    (a, 'c3000000-0000-4000-8000-000000000001', v_vic, 'Vic');
  insert into public.company_job_assignments (company_id, job_post_id, user_id) values
    (a, 'b0000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001')
  on conflict do nothing;
end $$;

-- A1: One, Two, Three (and Four, merged into One's later). A2: One. B1: Two.
insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003',
   'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000004',
   'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003');

select set_config('test.a', 'c0000000-0000-4000-8000-000000000001', true),
       set_config('test.b', 'c0000000-0000-4000-8000-000000000002', true),
       set_config('test.a_default', (select id::text from public.company_pipelines
                                      where company_id = 'c0000000-0000-4000-8000-000000000001'), true),
       set_config('test.b_default', (select id::text from public.company_pipelines
                                      where company_id = 'c0000000-0000-4000-8000-000000000002'), true);

-- ================================================ block 1: schema and backfill (JPT-010)
do $$
declare
  a uuid := current_setting('test.a')::uuid;
  b uuid := current_setting('test.b')::uuid;
  a_default uuid := current_setting('test.a_default')::uuid;
  n int;
  v_p record;
begin
  -- A new company has exactly one pipeline, "Default", holding its seven stages.
  select count(*) into n from public.company_pipelines where company_id = a;
  assert n = 1, format('company A has %s pipelines', n);
  select * into v_p from public.company_pipelines where company_id = a;
  assert v_p.name = 'Default' and v_p.is_default and not v_p.archived, format('A''s pipeline is %s', row_to_json(v_p));
  select count(*) into n from public.pipeline_stages where company_id = a and pipeline_id = a_default;
  assert n = 7, format('A''s default pipeline has %s stages', n);

  -- Company jobs point at it.
  assert (select pipeline_id from public.job_postings where id = 'b0000000-0000-4000-8000-000000000001') = a_default,
    'job A1 isn''t on the default pipeline';
  assert (select pipeline_id from public.job_postings where id = 'b0000000-0000-4000-8000-000000000003')
    = current_setting('test.b_default')::uuid, 'job B1 isn''t on B''s default pipeline';

  -- The backfill on rows from before pipelines: stages and jobs with no
  -- pipeline (and a company with no pipeline) are adopted; a rerun changes nothing.
  alter table public.pipeline_stages alter column pipeline_id drop not null;
  alter table public.job_postings disable trigger job_postings_set_pipeline;
  update public.job_postings set pipeline_id = null where company_id = b;
  alter table public.job_postings enable trigger job_postings_set_pipeline;
  alter table public.pipeline_stages disable trigger pipeline_stages_guard;
  update public.pipeline_stages set pipeline_id = null where company_id = b;
  alter table public.pipeline_stages enable trigger pipeline_stages_guard;
  delete from public.company_pipelines where company_id = b;
  perform public.backfill_job_pipelines();
  perform public.backfill_job_pipelines();
  alter table public.pipeline_stages alter column pipeline_id set not null;

  select count(*) into n from public.company_pipelines where company_id = b and is_default and name = 'Default';
  assert n = 1, format('the backfill gave B %s default pipelines', n);
  select count(*) into n from public.company_pipelines where company_id = b;
  assert n = 1, format('the backfill gave B %s pipelines', n);
  select count(*) into n from public.pipeline_stages s
    join public.company_pipelines p on p.id = s.pipeline_id and p.company_id = b and p.is_default;
  assert n = 7, format('the backfill adopted %s of B''s stages', n);
  assert (select jp.pipeline_id from public.job_postings jp where jp.id = 'b0000000-0000-4000-8000-000000000003')
    = (select id from public.company_pipelines where company_id = b), 'the backfill didn''t set B1''s pipeline';
  select count(*) into n from public.company_pipelines where company_id = a;
  assert n = 1, 'the rerun touched company A';
  -- Application stages didn't change.
  assert (select a2.stage_id from public.applications a2 where a2.id = 'e0000000-0000-4000-8000-000000000006')
    = pg_temp.stage(b, 'Default', 'applied'), 'the backfill moved an application';
  perform set_config('test.b_default', (select id::text from public.company_pipelines where company_id = b), true);

  -- Checks.
  assert pg_temp.raises(format('insert into public.company_pipelines (company_id, name) values (%L, %L)', a, '   ')),
    'a blank pipeline name was accepted';
  assert pg_temp.raises(format('insert into public.company_pipelines (company_id, name) values (%L, %L)', a, repeat('x', 41))),
    'a 41-character pipeline name was accepted';
  assert pg_temp.raises(format('insert into public.company_pipelines (company_id, name) values (%L, %L)', a, ' default ')),
    'a duplicate active name (case and spaces) was accepted';
  assert pg_temp.raises(format('insert into public.company_pipelines (company_id, name, is_default) values (%L, %L, true)', a, 'Second')),
    'a second default pipeline was accepted';

  -- The old (company, position) key is gone: two pipelines can share a position.
  assert not exists (select 1 from pg_constraint where conname = 'pipeline_stages_company_position_key'),
    'the company/position key is still there';
  assert exists (select 1 from pg_constraint where conname = 'pipeline_stages_pipeline_position_key' and condeferrable),
    'the deferrable pipeline/position key is missing';
  assert (select is_nullable from information_schema.columns
           where table_schema = 'public' and table_name = 'pipeline_stages' and column_name = 'pipeline_id') = 'NO',
    'pipeline_stages.pipeline_id is nullable';

  -- Engineering: Applied, Phone screen, Take-home, Interview, Hired, Rejected
  -- (no Offer, no On hold). Scratch: Applied, Hired, Rejected.
  insert into public.company_pipelines (company_id, name) values (a, 'Engineering'), (a, 'Scratch');
  insert into public.pipeline_stages (company_id, pipeline_id, name, kind, position)
  select a, p.id, x.name, x.kind::public.pipeline_stage_kind, x.pos
    from public.company_pipelines p,
         (values ('Applied', 'applied', 0), ('Phone screen', 'screening', 1), ('Take-home', 'screening', 2),
                 ('Interview', 'interview', 3), ('Hired', 'hired', 4), ('Rejected', 'rejected', 5)) x(name, kind, pos)
   where p.company_id = a and p.name = 'Engineering';
  insert into public.pipeline_stages (company_id, pipeline_id, name, kind, position)
  select a, p.id, x.name, x.kind::public.pipeline_stage_kind, x.pos
    from public.company_pipelines p,
         (values ('Applied', 'applied', 0), ('Hired', 'hired', 1), ('Rejected', 'rejected', 2)) x(name, kind, pos)
   where p.company_id = a and p.name = 'Scratch';
  perform set_config('test.eng', (select id::text from public.company_pipelines where company_id = a and name = 'Engineering'), true);
  perform set_config('test.scratch', (select id::text from public.company_pipelines where company_id = a and name = 'Scratch'), true);

  -- A stage's company is its pipeline's.
  assert pg_temp.raises(format(
    'insert into public.pipeline_stages (company_id, pipeline_id, name, kind, position) values (%L, %L, %L, %L, 9)',
    b, current_setting('test.eng'), 'Sneaky', 'screening')), 'a stage joined another company''s pipeline';

  -- The deployed createStage sends no pipeline_id: the stage joins the default.
  insert into public.pipeline_stages (company_id, name, kind, position) values (a, 'Reference check', 'offer', 7);
  assert (select pipeline_id from public.pipeline_stages where company_id = a and name = 'Reference check') = a_default,
    'a stage with no pipeline didn''t join the default';
end $$;

-- RLS (JP-SEC-001, JP-SEC-003).
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
set local role authenticated;
do $$
declare
  n int;
begin
  select count(*) into n from public.company_pipelines;
  assert n = 3, format('owner A sees %s pipelines', n);
  assert pg_temp.raises(format('insert into public.company_pipelines (company_id, name) values (%L, %L)',
    current_setting('test.a'), 'Direct')), 'owner A inserted a pipeline directly';
  assert pg_temp.raises(format('update public.company_pipelines set name = %L where id = %L',
    'Renamed', current_setting('test.eng'))), 'owner A renamed a pipeline directly';
end $$;
reset role;

select pg_temp.act('c1000000-0000-4000-8000-000000000002');
set local role authenticated;
do $$
begin
  assert (select count(*) from public.company_pipelines) = 1, 'owner B sees another company''s pipelines';
  assert not exists (select 1 from public.company_pipelines where company_id = current_setting('test.a')::uuid),
    'owner B sees A''s pipelines';
end $$;
reset role;

select pg_temp.act('a0000000-0000-4000-8000-000000000001');
set local role authenticated;
do $$
begin
  assert (select count(*) from public.company_pipelines) = 0, 'an applicant sees pipelines';
end $$;
reset role;

select pg_temp.act(null);
set local role anon;
do $$
begin
  assert pg_temp.raises('select 1 from public.company_pipelines'), 'anon can read company_pipelines';
end $$;
reset role;

-- ================================================ block 2: stage rules per pipeline (JPT-011)
do $$
declare
  a uuid := current_setting('test.a')::uuid;
  v_new uuid := 'c0000000-0000-4000-8000-000000000003';
  n int;
  i int;
begin
  -- A new company (onboarding) gets the Default pipeline and its seven stages.
  insert into auth.users (id, email, aud, role) values
    ('c1000000-0000-4000-8000-000000000003', 'new@initech.test', 'authenticated', 'authenticated');
  insert into public.company_info (id, user_id, name, email) values
    (v_new, 'c1000000-0000-4000-8000-000000000003', 'Initech', 'new@initech.test');
  select count(*) into n from public.pipeline_stages s
    join public.company_pipelines p on p.id = s.pipeline_id and p.is_default and p.name = 'Default'
   where p.company_id = v_new;
  assert n = 7, format('a new company''s Default pipeline has %s stages', n);
  perform public.seed_default_pipeline(v_new);
  assert (select count(*) from public.company_pipelines where company_id = v_new) = 1, 'seeding twice made a second pipeline';
  assert (select count(*) from public.pipeline_stages where company_id = v_new) = 7, 'seeding twice duplicated stages';

  -- A stage can't change pipelines.
  assert pg_temp.raises(format('update public.pipeline_stages set pipeline_id = %L where id = %L',
    current_setting('test.eng'), pg_temp.stage(a, 'Scratch', 'applied'))), 'a stage moved to another pipeline';

  -- The protected kinds count per pipeline: Scratch's only Rejected can't be
  -- archived although the default pipeline has one.
  assert pg_temp.raises(format('update public.pipeline_stages set archived = true where id = %L',
    pg_temp.stage(a, 'Scratch', 'rejected'))), 'Scratch''s last Rejected stage was archived';
  insert into public.pipeline_stages (company_id, pipeline_id, name, kind, position)
  values (a, current_setting('test.scratch')::uuid, 'Rejected (late)', 'rejected', 3);
  update public.pipeline_stages set archived = true where id = pg_temp.stage(a, 'Scratch', 'rejected', 'Rejected');
  assert (select archived from public.pipeline_stages where pipeline_id = current_setting('test.scratch')::uuid and name = 'Rejected'),
    'a second Rejected stage didn''t let the first be archived';

  -- 12 active stages per pipeline: Scratch has 3 active.
  for i in 1..9 loop
    insert into public.pipeline_stages (company_id, pipeline_id, name, kind, position)
    values (a, current_setting('test.scratch')::uuid, 'Step ' || i, 'screening', 10 + i);
  end loop;
  assert pg_temp.raises(format(
    'insert into public.pipeline_stages (company_id, pipeline_id, name, kind, position) values (%L, %L, %L, %L, 30)',
    a, current_setting('test.scratch'), 'Thirteenth', 'screening')), 'a 13th active stage was accepted';
  assert pg_temp.raises(format('update public.pipeline_stages set archived = false where pipeline_id = %L and name = %L',
    current_setting('test.scratch'), 'Rejected')), 'unarchiving a 13th stage was accepted';
  -- The default pipeline's count is its own (8 active).
  insert into public.pipeline_stages (company_id, pipeline_id, name, kind, position)
  values (a, current_setting('test.a_default')::uuid, 'Final check', 'offer', 8);
  update public.pipeline_stages set archived = true
   where pipeline_id = current_setting('test.a_default')::uuid and name in ('Final check', 'Reference check');
end $$;

-- reorder_pipeline_stages: exactly one pipeline's active stages.
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
set local role authenticated;
do $$
declare
  v_ids uuid[];
  v_eng uuid := current_setting('test.eng')::uuid;
begin
  select array_agg(id order by position desc) into v_ids from public.pipeline_stages
   where pipeline_id = v_eng and not archived;
  assert pg_temp.raises(format('select public.reorder_pipeline_stages(%L::uuid[])',
    v_ids || pg_temp.stage(current_setting('test.a')::uuid, 'Default', 'offer'))),
    'a reorder mixing two pipelines was accepted';
  assert pg_temp.raises(format('select public.reorder_pipeline_stages(%L::uuid[])', v_ids[1:3])),
    'a reorder of part of a pipeline was accepted';
  perform public.reorder_pipeline_stages(v_ids);
  assert (select array_agg(id order by position) from public.pipeline_stages where pipeline_id = v_eng and not archived) = v_ids,
    'the reorder didn''t apply';
  -- Back to the original order for the later blocks.
  select array_agg(x order by o desc) into v_ids from unnest(v_ids) with ordinality t(x, o);
  perform public.reorder_pipeline_stages(v_ids);
end $$;
reset role;

-- ================================================ block 3: jobs and applications (JPT-012)
do $$
declare
  a uuid := current_setting('test.a')::uuid;
  a1 uuid := 'b0000000-0000-4000-8000-000000000001';
begin
  assert public.first_job_stage(a1, 'interview') = pg_temp.stage(a, 'Default', 'interview'),
    'first_job_stage didn''t read the job''s pipeline';
  assert public.first_job_stage('b0000000-0000-4000-8000-0000000000ff', 'applied') is null,
    'an unknown job has a first stage';
  -- The deployed code's lookup reads the default pipeline.
  assert public.first_pipeline_stage(a, 'applied') = pg_temp.stage(a, 'Default', 'applied'),
    'first_pipeline_stage doesn''t read the default pipeline';

  -- A3 starts on Engineering; a job with B's or an archived pipeline is refused.
  insert into public.all_jobs (id, job_name, job_url, company_name, platform) values
    ('d0000000-0000-4000-8000-000000000004', 'A3', 'https://acme.test/jobs/3', 'Acme', 'gethired');
  insert into public.job_postings (id, company_id, title, job_id, status, pipeline_id) values
    ('b0000000-0000-4000-8000-000000000004', a, 'A3', 'd0000000-0000-4000-8000-000000000004', 'active',
     current_setting('test.eng')::uuid);
  assert (select pipeline_id from public.job_postings where id = 'b0000000-0000-4000-8000-000000000004')
    = current_setting('test.eng')::uuid, 'a job lost the pipeline it was created with';
  assert pg_temp.raises(format('insert into public.job_postings (company_id, title, status, pipeline_id) values (%L, %L, %L, %L)',
    a, 'Cross', 'active', current_setting('test.b_default'))), 'a job took another company''s pipeline';
  update public.company_pipelines set archived = true where id = current_setting('test.scratch')::uuid;
  assert pg_temp.raises(format('insert into public.job_postings (company_id, title, status, pipeline_id) values (%L, %L, %L, %L)',
    a, 'Archived', 'active', current_setting('test.scratch'))), 'a job took an archived pipeline';
  update public.company_pipelines set archived = false where id = current_setting('test.scratch')::uuid;

  -- pipeline_id changes only through set_job_pipeline, even for the service role.
  assert pg_temp.raises(format('update public.job_postings set pipeline_id = %L where id = %L',
    current_setting('test.eng'), a1)), 'a direct pipeline_id update was accepted';

  -- JP-REQ-004: a stage of another pipeline (same company) is refused.
  assert pg_temp.raises(format('update public.applications set stage_id = %L where id = %L',
    pg_temp.stage(a, 'Engineering', 'interview'), 'e0000000-0000-4000-8000-000000000001')),
    'an application took a stage from another pipeline';

  -- New applications start in the job pipeline's Applied stage.
  assert (select stage_id from public.applications where id = 'e0000000-0000-4000-8000-000000000001')
    = pg_temp.stage(a, 'Default', 'applied'), 'a new application isn''t in the job''s Applied stage';

  -- Status-only writes (deployed code) use the job's pipeline.
  update public.applications set status = 'rejected' where id = 'e0000000-0000-4000-8000-000000000003';
  assert (select stage_id from public.applications where id = 'e0000000-0000-4000-8000-000000000003')
    = pg_temp.stage(a, 'Default', 'rejected'), 'a status-only write didn''t land in the job''s Rejected stage';
end $$;

-- An application to A3 (submitApplication inserts with the service role)
-- lands in Engineering's Applied.
insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id, answers) values
  ('e0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000004', '{}');
do $$
begin
  assert (select stage_id from public.applications where id = 'e0000000-0000-4000-8000-000000000007')
    = pg_temp.stage(current_setting('test.a')::uuid, 'Engineering', 'applied'),
    'an application to an Engineering job isn''t in Engineering''s Applied';
end $$;

-- Owner A tries to update a job's pipeline from the browser.
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
set local role authenticated;
do $$
begin
  assert pg_temp.raises(format('update public.job_postings set pipeline_id = %L where id = %L',
    current_setting('test.eng'), 'b0000000-0000-4000-8000-000000000001')), 'the owner updated pipeline_id directly';
end $$;
reset role;

-- ================================================ block 4: imports, funnel, plans (JPT-013)
do $$
declare
  a uuid := current_setting('test.a')::uuid;
  a1 uuid := 'b0000000-0000-4000-8000-000000000001';
begin
  assert public.import_job_stage(a1, null) = pg_temp.stage(a, 'Default', 'applied'),
    'import_job_stage(job, null) isn''t the job''s Applied stage';
  assert public.import_job_stage(a1, pg_temp.stage(a, 'Default', 'screening')) = pg_temp.stage(a, 'Default', 'screening'),
    'import_job_stage refused the job''s own stage';
  assert public.import_job_stage(a1, pg_temp.stage(a, 'Engineering', 'screening')) is null,
    'import_job_stage accepted another pipeline''s stage';
  assert public.import_job_stage('b0000000-0000-4000-8000-000000000004', null) = pg_temp.stage(a, 'Engineering', 'applied'),
    'import_job_stage(A3, null) isn''t Engineering''s Applied';
  -- The deployed import_stage(company, …) still works on the default pipeline.
  assert public.import_stage(a, null) = pg_temp.stage(a, 'Default', 'applied'), 'import_stage(company, null) changed';
  assert public.import_stage(a, pg_temp.stage(a, 'Engineering', 'screening')) is null,
    'import_stage(company, …) accepted a non-default pipeline''s stage';

  -- Every import RPC goes through import_job_stage.
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosrc ~ 'import_stage\(' and p.proname <> 'import_stage') = 0,
    'an RPC still calls import_stage(company, …)';
end $$;

select pg_temp.act('c1000000-0000-4000-8000-000000000001');
set local role authenticated;
do $$
declare
  a uuid := current_setting('test.a')::uuid;
  a1 uuid := 'b0000000-0000-4000-8000-000000000001';
  a3 uuid := 'b0000000-0000-4000-8000-000000000004';
  v_res jsonb;
  v_ids uuid[];
  n int;
begin
  perform pg_temp.expect(public.add_candidates_to_job(a1, array['f9000000-0000-4000-8000-000000000001'::uuid],
    pg_temp.stage(a, 'Engineering', 'screening')), 'invalid_stage', 'add_candidates_to_job with another pipeline''s stage');
  v_res := pg_temp.expect(public.add_candidates_to_job(a1, array['f9000000-0000-4000-8000-000000000001'::uuid], null),
    null, 'add_candidates_to_job with the default stage');
  assert (v_res -> 'counts' ->> 'not_found')::int = 1, format('add_candidates_to_job: %s', v_res);

  -- get_job_funnel reads only the job's pipeline, with a company on several.
  v_res := public.get_job_funnel(a1);
  select array_agg((x ->> 'stage_id')::uuid) into v_ids from jsonb_array_elements(v_res -> 'stages') x;
  assert v_ids = (select array_agg(id order by position) from public.pipeline_stages
                   where pipeline_id = current_setting('test.a_default')::uuid and not archived),
    format('A1''s funnel has stages %s', v_ids);
  assert (v_res ->> 'total')::int = 4, format('A1''s funnel total is %s', v_res ->> 'total');
  assert ((v_res -> 'stages' -> 0) ->> 'reached')::int = 4, format('A1''s Applied reached %s', v_res -> 'stages' -> 0);
  v_res := public.get_job_funnel(a3);
  select count(*) into n from jsonb_array_elements(v_res -> 'stages') x
   where (x ->> 'stage_id')::uuid in (select id from public.pipeline_stages where pipeline_id = current_setting('test.eng')::uuid);
  assert n = 6 and jsonb_array_length(v_res -> 'stages') = 6, format('A3''s funnel is %s', v_res -> 'stages');
  assert ((v_res -> 'stages' -> 0) ->> 'reached')::int = 1, 'A3''s Applied count is wrong';

  -- Plans: a stage outside the job's pipeline is refused.
  perform pg_temp.expect(public.save_interview_plan(a1, jsonb_build_array(jsonb_build_object(
    'name', 'Tech screen', 'stage_id', pg_temp.stage(a, 'Engineering', 'screening'),
    'competencies', jsonb_build_array(jsonb_build_object('name', 'Systems'))))),
    'invalid_stage', 'save_interview_plan with another pipeline''s stage');
  perform pg_temp.expect(public.save_interview_plan(a1, jsonb_build_array(
    jsonb_build_object('name', 'Tech screen', 'stage_id', pg_temp.stage(a, 'Default', 'screening'),
      'competencies', jsonb_build_array(jsonb_build_object('name', 'Systems'))),
    jsonb_build_object('name', 'Onsite', 'stage_id', pg_temp.stage(a, 'Default', 'interview'),
      'competencies', jsonb_build_array(jsonb_build_object('name', 'Design'))),
    jsonb_build_object('name', 'Offer chat', 'stage_id', pg_temp.stage(a, 'Default', 'offer'),
      'competencies', jsonb_build_array(jsonb_build_object('name', 'Fit')))
  )), null, 'save_interview_plan on A1');

  -- Copy to A3 (Engineering): Screening → the first screening stage (by kind),
  -- Interview → Interview (name and kind), Offer has no target and is skipped.
  v_res := pg_temp.expect(public.copy_interview_plan(a1, a3), null, 'copy_interview_plan across pipelines');
  assert (v_res ->> 'items')::int = 2, format('copied %s items', v_res ->> 'items');
  assert jsonb_array_length(v_res -> 'skipped_items') = 1
     and v_res -> 'skipped_items' -> 0 ->> 'name' = 'Offer chat', format('skipped %s', v_res -> 'skipped_items');
  assert (select stage_id from public.job_interview_plan_items where job_post_id = a3 and name = 'Tech screen')
    = pg_temp.stage(a, 'Engineering', 'screening', 'Phone screen'), 'Tech screen didn''t map to Phone screen';
  assert (select stage_id from public.job_interview_plan_items where job_post_id = a3 and name = 'Onsite')
    = pg_temp.stage(a, 'Engineering', 'interview', 'Interview'), 'Onsite didn''t map to Interview';
end $$;
reset role;

-- ================================================ block 5: pipeline admin RPCs (JPT-014)
select pg_temp.act('c6000000-0000-4000-8000-000000000001'); -- Sam: settings.stages
set local role authenticated;
do $$
declare
  a uuid := current_setting('test.a')::uuid;
  v_res jsonb;
  v_sales uuid;
  i int;
begin
  v_res := pg_temp.expect(public.create_pipeline('Sales'), null, 'create_pipeline from the default');
  v_sales := (v_res ->> 'pipeline_id')::uuid;
  assert (select array_agg(row(name, kind, position)::text order by position) from public.pipeline_stages where pipeline_id = v_sales)
       = (select array_agg(row(name, kind, position)::text order by position) from public.pipeline_stages
           where pipeline_id = current_setting('test.a_default')::uuid and not archived),
    'Sales isn''t a copy of the default''s active stages';
  assert not (select is_default from public.company_pipelines where id = v_sales), 'a new pipeline became the default';

  v_res := pg_temp.expect(public.create_pipeline('Eng copy', current_setting('test.eng')::uuid), null, 'create_pipeline from Engineering');
  assert (select count(*) from public.pipeline_stages where pipeline_id = (v_res ->> 'pipeline_id')::uuid) = 6,
    'Eng copy doesn''t have Engineering''s six stages';

  perform pg_temp.expect(public.create_pipeline('  sales '), 'name_taken', 'a duplicate name');
  perform pg_temp.expect(public.create_pipeline(''), 'invalid_name', 'a blank name');
  perform pg_temp.expect(public.create_pipeline('Other', current_setting('test.b_default')::uuid),
    'pipeline_not_found', 'copying another company''s pipeline');

  -- The limit: Default, Engineering, Scratch, Sales, Eng copy + 5 = 10.
  for i in 1..5 loop
    perform pg_temp.expect(public.create_pipeline('Filler ' || i), null, 'filler ' || i);
  end loop;
  perform pg_temp.expect(public.create_pipeline('Eleventh'), 'limit_reached', 'an 11th pipeline');

  -- Rename.
  perform pg_temp.expect(public.rename_pipeline(v_sales, 'Sales EMEA'), null, 'rename');
  perform pg_temp.expect(public.rename_pipeline(v_sales, 'DEFAULT'), 'name_taken', 'rename to a taken name');
  perform pg_temp.expect(public.rename_pipeline(current_setting('test.b_default')::uuid, 'Mine'),
    'pipeline_not_found', 'renaming another company''s pipeline');

  -- Make default: the old one stops being default.
  perform pg_temp.expect(public.set_default_pipeline(v_sales), null, 'make Sales default');
  assert (select array_agg(id) from public.company_pipelines where company_id = a and is_default) = array[v_sales],
    'make default left two defaults';
  perform pg_temp.expect(public.set_default_pipeline(current_setting('test.a_default')::uuid), null, 'make Default default again');

  -- Archive: never the default or one a job uses.
  perform pg_temp.expect(public.archive_pipeline(current_setting('test.a_default')::uuid), 'is_default', 'archive the default');
  perform pg_temp.expect(public.archive_pipeline(current_setting('test.eng')::uuid), 'in_use', 'archive Engineering (A3 uses it)');
  perform pg_temp.expect(public.archive_pipeline(v_sales), null, 'archive Sales');
  assert (select archived from public.company_pipelines where id = v_sales), 'Sales wasn''t archived';
  -- An archived pipeline frees its name, and room under the limit.
  perform pg_temp.expect(public.create_pipeline('Sales EMEA'), null, 'reuse an archived name');
  perform pg_temp.expect(public.archive_pipeline((select id from public.company_pipelines
    where company_id = a and name = 'Sales EMEA' and not archived)), null, 'archive the new Sales EMEA');
  for i in 1..5 loop
    perform pg_temp.expect(public.archive_pipeline((select id from public.company_pipelines
      where company_id = a and name = 'Filler ' || i)), null, 'archive filler ' || i);
  end loop;
  perform pg_temp.expect(public.archive_pipeline((select id from public.company_pipelines
    where company_id = a and name = 'Eng copy')), null, 'archive Eng copy');
end $$;
reset role;

-- Without settings.stages.
select pg_temp.act('c3000000-0000-4000-8000-000000000001'); -- Vic
set local role authenticated;
do $$
begin
  perform pg_temp.expect(public.create_pipeline('Mine'), 'forbidden', 'create without settings.stages');
  perform pg_temp.expect(public.rename_pipeline(current_setting('test.eng')::uuid, 'Mine'), 'forbidden', 'rename without settings.stages');
  perform pg_temp.expect(public.set_default_pipeline(current_setting('test.eng')::uuid), 'forbidden', 'make default without settings.stages');
  perform pg_temp.expect(public.archive_pipeline(current_setting('test.scratch')::uuid), 'forbidden', 'archive without settings.stages');
end $$;
reset role;

-- Direct writes are guarded too (service role).
do $$
begin
  assert pg_temp.raises(format('update public.company_pipelines set archived = true where id = %L', current_setting('test.eng'))),
    'a direct archive of an in-use pipeline was accepted';
  assert pg_temp.raises(format('update public.company_pipelines set archived = true where id = %L', current_setting('test.a_default'))),
    'a direct archive of the default was accepted';
end $$;

-- ================================================ block 6: set_job_pipeline (JPT-015)
-- A1 on Default: One in Interview, Two On hold, Three Rejected (with a link
-- waiting for them), Four merged into One's application.
do $$
declare
  a uuid := current_setting('test.a')::uuid;
begin
  update public.applications set stage_id = pg_temp.stage(a, 'Default', 'interview') where id = 'e0000000-0000-4000-8000-000000000001';
  update public.applications set stage_id = pg_temp.stage(a, 'Default', 'on_hold') where id = 'e0000000-0000-4000-8000-000000000002';
  update public.applications set merged_into_application_id = 'e0000000-0000-4000-8000-000000000001'
   where id = 'e0000000-0000-4000-8000-000000000004';
  insert into public.scheduled_interviews (id, company_id, job_post_id, application_id, stage_id, name, duration_minutes,
    status, source, booking_token_hash, booking_token_expires_at)
  values ('f1000000-0000-4000-8000-000000000001', a, 'b0000000-0000-4000-8000-000000000001',
          'e0000000-0000-4000-8000-000000000003', pg_temp.stage(a, 'Default', 'interview'), 'Link', 30,
          'awaiting_candidate', 'link', repeat('b', 64), now() + interval '2 days');
  perform set_config('test.queued', pg_temp.queued()::text, true);
end $$;

select pg_temp.act('c5000000-0000-4000-8000-000000000001'); -- Jed: jobs.edit on A1 only
set local role authenticated;
do $$
declare
  a uuid := current_setting('test.a')::uuid;
  a1 uuid := 'b0000000-0000-4000-8000-000000000001';
  v_eng uuid := current_setting('test.eng')::uuid;
  v_res jsonb;
begin
  -- A job-scoped grant works only for its job.
  perform pg_temp.expect(public.set_job_pipeline('b0000000-0000-4000-8000-000000000002', v_eng), 'forbidden',
    'Jed switching A2');

  -- Engineering has no On hold stage, and Two is On hold.
  v_res := pg_temp.expect(public.set_job_pipeline(a1, v_eng), 'missing_status', 'switch with Two On hold');
  assert v_res ->> 'status' = 'stand_by' and v_res -> 'stage' ->> 'name' = 'On hold', format('missing_status: %s', v_res);

  -- A mapping across candidate statuses, or into another pipeline, is refused.
  perform pg_temp.expect(public.set_job_pipeline(a1, v_eng, jsonb_build_object(
    pg_temp.stage(a, 'Default', 'interview'), pg_temp.stage(a, 'Engineering', 'applied'))),
    'status_mismatch', 'Interview → Applied');
  perform pg_temp.expect(public.set_job_pipeline(a1, v_eng, jsonb_build_object(
    pg_temp.stage(a, 'Default', 'interview'), pg_temp.stage(a, 'Default', 'screening'))),
    'invalid_mapping', 'a target outside the new pipeline');
  perform pg_temp.expect(public.set_job_pipeline(a1, current_setting('test.b_default')::uuid), 'pipeline_not_found',
    'switching to another company''s pipeline');
end $$;
reset role;

-- Two leaves On hold for Screening; then Jed switches A1, sending Screening to
-- Take-home and leaving the rest to the default mapping.
update public.applications set stage_id = pg_temp.stage(current_setting('test.a')::uuid, 'Default', 'screening')
 where id = 'e0000000-0000-4000-8000-000000000002';
create temp table before_switch as
  select id, status, stage_id from public.applications where job_post_id = 'b0000000-0000-4000-8000-000000000001';
update public.applications set stage_entered_at = '2020-01-01' where job_post_id = 'b0000000-0000-4000-8000-000000000001';
grant select on before_switch to authenticated;

select pg_temp.act('c5000000-0000-4000-8000-000000000001');
set local role authenticated;
do $$
declare
  a uuid := current_setting('test.a')::uuid;
  v_res jsonb;
begin
  v_res := pg_temp.expect(public.set_job_pipeline('b0000000-0000-4000-8000-000000000001', current_setting('test.eng')::uuid,
    jsonb_build_object(pg_temp.stage(a, 'Default', 'screening'), pg_temp.stage(a, 'Engineering', 'screening', 'Take-home'))),
    null, 'Jed switching A1 to Engineering');
  assert (v_res ->> 'moved')::int = 4 and (v_res ->> 'plan_items')::int = 3, format('switch result %s', v_res);
end $$;
reset role;

do $$
declare
  a uuid := current_setting('test.a')::uuid;
  a1 uuid := 'b0000000-0000-4000-8000-000000000001';
  n int;
begin
  assert (select pipeline_id from public.job_postings where id = a1) = current_setting('test.eng')::uuid,
    'A1 isn''t on Engineering';
  -- Every application is on an Engineering stage, with the same status.
  assert not exists (select 1 from public.applications ap join public.pipeline_stages s on s.id = ap.stage_id
                      where ap.job_post_id = a1 and s.pipeline_id <> current_setting('test.eng')::uuid),
    'an application stayed on the old pipeline';
  assert not exists (select 1 from public.applications ap join before_switch b on b.id = ap.id
                      where ap.status is distinct from b.status), 'a switch changed a candidate''s status';
  assert (select stage_id from public.applications where id = 'e0000000-0000-4000-8000-000000000001')
    = pg_temp.stage(a, 'Engineering', 'interview'), 'One isn''t in Engineering''s Interview';
  assert (select stage_id from public.applications where id = 'e0000000-0000-4000-8000-000000000002')
    = pg_temp.stage(a, 'Engineering', 'screening', 'Take-home'), 'the custom mapping wasn''t used';
  assert (select stage_id from public.applications where id = 'e0000000-0000-4000-8000-000000000003')
    = pg_temp.stage(a, 'Engineering', 'rejected'), 'Three isn''t in Engineering''s Rejected';
  assert (select stage_id from public.applications where id = 'e0000000-0000-4000-8000-000000000004')
    = pg_temp.stage(a, 'Engineering', 'applied'), 'the merged application didn''t move';
  assert not exists (select 1 from public.applications where job_post_id = a1 and stage_entered_at < now()),
    'stage_entered_at wasn''t reset';

  -- One event per moved, unmerged application, by Jed, marked as a pipeline change.
  select count(*) into n from public.application_events e
   where e.type = 'stage_changed' and e.payload ->> 'reason' = 'pipeline_changed'
     and e.application_id in (select id from public.applications where job_post_id = a1);
  assert n = 3, format('expected 3 pipeline_changed events, got %s', n);
  assert not exists (select 1 from public.application_events
                      where application_id = 'e0000000-0000-4000-8000-000000000004' and type = 'stage_changed'),
    'the merged application got an event';
  assert (select actor_user_id from public.application_events
           where application_id = 'e0000000-0000-4000-8000-000000000001' and type = 'stage_changed')
    = 'c5000000-0000-4000-8000-000000000001', 'the event''s actor isn''t Jed';
  assert (select payload ->> 'to_stage_id' from public.application_events
           where application_id = 'e0000000-0000-4000-8000-000000000002' and type = 'stage_changed')
    = pg_temp.stage(a, 'Engineering', 'screening', 'Take-home')::text, 'the event''s to_stage_id is wrong';

  -- Nothing queued, the link still open, its stage kept; plan items remapped.
  assert pg_temp.queued() = current_setting('test.queued')::bigint, 'a switch queued a message';
  assert (select status from public.scheduled_interviews where id = 'f1000000-0000-4000-8000-000000000001') = 'awaiting_candidate',
    'a switch closed an interview';
  assert (select stage_id from public.scheduled_interviews where id = 'f1000000-0000-4000-8000-000000000001')
    = pg_temp.stage(a, 'Default', 'interview'), 'a switch changed scheduled_interviews.stage_id';
  assert (select stage_id from public.job_interview_plan_items where job_post_id = a1 and name = 'Tech screen')
    = pg_temp.stage(a, 'Engineering', 'screening', 'Take-home'), 'Tech screen wasn''t remapped with the mapping';
  assert (select stage_id from public.job_interview_plan_items where job_post_id = a1 and name = 'Onsite')
    = pg_temp.stage(a, 'Engineering', 'interview'), 'Onsite wasn''t remapped';
  -- Offer chat sat on Default's Offer; Engineering has no Offer, but the same
  -- status (reviewed) takes the first screening stage.
  assert (select stage_id from public.job_interview_plan_items where job_post_id = a1 and name = 'Offer chat')
    = pg_temp.stage(a, 'Engineering', 'screening', 'Phone screen'), 'Offer chat wasn''t remapped by status';

  -- After the switch, status-only writes use the new pipeline.
  update public.applications set status = 'selected' where id = 'e0000000-0000-4000-8000-000000000002';
  assert (select stage_id from public.applications where id = 'e0000000-0000-4000-8000-000000000002')
    = pg_temp.stage(a, 'Engineering', 'hired'), 'a status-only write didn''t use the new pipeline';
  update public.applications set status = 'reviewed' where id = 'e0000000-0000-4000-8000-000000000002';
end $$;

-- A closed job switches too (JP-Q-002); the same pipeline again is a no-op.
update public.job_postings set status = 'inactive' where id = 'b0000000-0000-4000-8000-000000000002';
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
set local role authenticated;
do $$
declare
  v_res jsonb;
begin
  perform pg_temp.expect(public.set_job_pipeline('b0000000-0000-4000-8000-000000000002', current_setting('test.eng')::uuid),
    null, 'switching a closed job');
  v_res := pg_temp.expect(public.set_job_pipeline('b0000000-0000-4000-8000-000000000002', current_setting('test.eng')::uuid),
    null, 'switching to the same pipeline');
  assert not (v_res ->> 'changed')::boolean, 'the same pipeline counted as a change';
end $$;
reset role;

-- ================================================ block 7: fork_job_pipeline (JPT-016)
select pg_temp.act('c5000000-0000-4000-8000-000000000001'); -- Jed: no settings.stages
set local role authenticated;
do $$
begin
  perform pg_temp.expect(public.fork_job_pipeline('b0000000-0000-4000-8000-000000000001'), 'forbidden', 'Jed forking A1');
end $$;
reset role;

insert into public.job_postings (id, company_id, title, status) values
  ('b0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001',
   '  Principal Platform Engineer, Developer Experience  ', 'active');

select pg_temp.act('c6000000-0000-4000-8000-000000000001'); -- Sam: settings.stages
set local role authenticated;
do $$
declare
  a uuid := current_setting('test.a')::uuid;
  a1 uuid := 'b0000000-0000-4000-8000-000000000001';
  v_res jsonb;
  v_fork uuid;
  i int;
begin
  v_res := pg_temp.expect(public.fork_job_pipeline(a1), null, 'fork A1');
  v_fork := (v_res ->> 'pipeline_id')::uuid;
  assert v_res ->> 'name' = 'A1' and (select name from public.company_pipelines where id = v_fork) = 'A1',
    format('the fork is named %s', v_res ->> 'name');
  assert (select pipeline_id from public.job_postings where id = a1) = v_fork, 'A1 isn''t on its fork';
  assert (select array_agg(row(name, kind, position)::text order by position) from public.pipeline_stages where pipeline_id = v_fork)
       = (select array_agg(row(name, kind, position)::text order by position) from public.pipeline_stages
           where pipeline_id = current_setting('test.eng')::uuid and not archived), 'the fork isn''t a copy of Engineering';
  -- Stage for stage: Two stays in Phone screen (where block 6 left them).
  assert (select s.name from public.applications ap join public.pipeline_stages s on s.id = ap.stage_id
           where ap.id = 'e0000000-0000-4000-8000-000000000002') = 'Phone screen', format('the fork didn''t map stage for stage: Two is in %s', (select s.name || '@' || s.pipeline_id from public.applications ap join public.pipeline_stages s on s.id = ap.stage_id where ap.id = 'e0000000-0000-4000-8000-000000000002'));
  assert (select s.pipeline_id from public.applications ap join public.pipeline_stages s on s.id = ap.stage_id
           where ap.id = 'e0000000-0000-4000-8000-000000000001') = v_fork, 'One isn''t on the fork';
  -- Other jobs on Engineering are untouched.
  assert (select pipeline_id from public.job_postings where id = 'b0000000-0000-4000-8000-000000000004')
    = current_setting('test.eng')::uuid, 'A3 left Engineering';
  assert (select stage_id from public.applications where id = 'e0000000-0000-4000-8000-000000000007')
    = pg_temp.stage(a, 'Engineering', 'applied'), 'A3''s application moved';

  -- A second fork of A1 takes " (2)"; a long title is cut to 40.
  v_res := pg_temp.expect(public.fork_job_pipeline(a1), null, 'fork A1 again');
  assert v_res ->> 'name' = 'A1 (2)', format('the second fork is named %s', v_res ->> 'name');
  v_res := pg_temp.expect(public.fork_job_pipeline('b0000000-0000-4000-8000-000000000005'), null, 'fork the long title');
  assert v_res ->> 'name' = left('Principal Platform Engineer, Developer Experience', 40),
    format('the long fork is named %s', v_res ->> 'name');
  v_res := pg_temp.expect(public.fork_job_pipeline('b0000000-0000-4000-8000-000000000005'), null, 'fork the long title again');
  assert char_length(v_res ->> 'name') <= 40 and v_res ->> 'name' like '% (2)', format('the long second fork is %s', v_res ->> 'name');

  -- The limit: Default, Engineering, Scratch, A1, A1 (2), long, long (2) + 3 = 10.
  for i in 1..3 loop
    perform pg_temp.expect(public.create_pipeline('More ' || i), null, 'more ' || i);
  end loop;
  perform pg_temp.expect(public.fork_job_pipeline(a1), 'limit_reached', 'a fork past the limit');
end $$;
reset role;

select 'job_pipelines: ok' as result;
rollback;
