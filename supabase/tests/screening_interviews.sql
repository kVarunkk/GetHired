-- SIT-020 / SIT-021: recruiter screening interviews. Schema and access
-- (block 1) and the lifecycle functions (block 2). Runs in a transaction that
-- always rolls back, so it's safe to run against the linked project once the
-- migration is applied:
--   npx supabase db query --linked -f supabase/tests/screening_interviews.sql
-- Any failed check raises an exception; success prints 'screening_interviews: ok'.
-- Ids match test/utils/recruiter.ts and test/utils/team.ts where they overlap.

begin;

create function pg_temp.act(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true)
$$;
create function pg_temp.role_of(p_company uuid, p_template text) returns uuid language sql as $$
  select id from public.company_roles where company_id = p_company and template_key = p_template
$$;
-- Runs p_sql and returns the P0001 message it raised, or 'ok'.
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when sqlstate 'P0001' then
  return sqlerrm;
end $$;
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
-- A transcript with p_answers candidate answers and p_questions interviewer turns.
create function pg_temp.turns(p_answers int, p_questions int default 3) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'turn_id', g, 'timestamp', g, 'interrupted', false,
    'assistant', case when g <= p_questions then 'Question ' || g else '' end,
    'user', case when g <= p_answers then 'Answer ' || g else '' end
  ) order by g), '[]'::jsonb)
  from generate_series(1, greatest(p_answers, p_questions)) g
$$;
-- As the applicant: consent if needed, reserve and start. Returns the session id.
create function pg_temp.start_attempt(p_id uuid, p_voice text) returns uuid language plpgsql as $$
declare
  res jsonb;
begin
  perform pg_temp.expect(public.record_screening_consent(p_id, 'v1'), null, 'consent for ' || p_voice);
  perform pg_temp.expect(public.reserve_screening_attempt(p_id, 'r-' || p_voice), null, 'reserve for ' || p_voice);
  res := pg_temp.expect(public.start_screening_attempt(p_id, 'r-' || p_voice, p_voice), null, 'start for ' || p_voice);
  return (res ->> 'session_id')::uuid;
end $$;
create function pg_temp.fk_action(p_table regclass, p_column text) returns "char" language sql as $$
  select c.confdeltype from pg_constraint c
   where c.conrelid = p_table and c.contype = 'f'
     and c.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = p_table and a.attname = p_column)]
$$;
create function pg_temp.hold(p_id uuid) returns int language sql as $$
  select qty from public.company_entitlement_holds
   where ref_type = 'application_interview' and ref_id = p_id::text and key = 'interview_minutes'
$$;
create function pg_temp.charged(p_id uuid) returns int language sql as $$
  select count(*)::int from public.company_usage_events
   where ref_type = 'application_interview' and ref_id = p_id::text and key = 'interview_minutes'
$$;
create function pg_temp.queued(p_analysis uuid) returns int language sql as $$
  select count(*)::int from pgmq.q_interview_analysis_queue where message ->> 'analysisId' = p_analysis::text
$$;
create function pg_temp.events(p_id uuid, p_type text) returns int language sql as $$
  select count(*)::int from public.application_events
   where type = p_type and payload ->> 'application_interview_id' = p_id::text
$$;

grant execute on function pg_temp.act(uuid), pg_temp.err(text), pg_temp.expect(jsonb, text, text),
  pg_temp.turns(int, int), pg_temp.start_attempt(uuid, text) to authenticated;

-- Seed. Company A: owner, Admin, Member, a Viewer role without interviews.view,
-- and a Scoped role assigned to A2 only. Company B: owner. Applicants 1–9.
-- Jobs A1 and A2 (A), B1 (B), all active.
insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data) values
  ('c1000000-0000-4000-8000-000000000001', 'hr@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c1000000-0000-4000-8000-000000000002', 'hr@globex.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c2000000-0000-4000-8000-000000000001', 'admin@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c3000000-0000-4000-8000-000000000001', 'member@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c4000000-0000-4000-8000-000000000001', 'viewer@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c5000000-0000-4000-8000-000000000001', 'scoped@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('a0000000-0000-4000-8000-000000000001', 'one@applicant.test', 'authenticated', 'authenticated', now(), '{}'),
  ('a0000000-0000-4000-8000-000000000002', 'two@applicant.test', 'authenticated', 'authenticated', now(), '{}'),
  ('a0000000-0000-4000-8000-000000000003', 'three@applicant.test', 'authenticated', 'authenticated', now(), '{}'),
  ('a0000000-0000-4000-8000-000000000004', 'four@applicant.test', 'authenticated', 'authenticated', now(), '{}'),
  ('a0000000-0000-4000-8000-000000000005', 'five@applicant.test', 'authenticated', 'authenticated', now(), '{}'),
  ('a0000000-0000-4000-8000-000000000006', 'six@applicant.test', 'authenticated', 'authenticated', now(), '{}'),
  ('a0000000-0000-4000-8000-000000000007', 'seven@applicant.test', 'authenticated', 'authenticated', now(), '{}'),
  ('a0000000-0000-4000-8000-000000000008', 'eight@applicant.test', 'authenticated', 'authenticated', now(), '{}'),
  ('a0000000-0000-4000-8000-000000000009', 'nine@applicant.test', 'authenticated', 'authenticated', now(), '{}');

insert into public.company_info (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Acme', 'hr@acme.test'),
  ('c0000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'Globex', 'hr@globex.test');

insert into public.user_info (user_id, email, full_name, is_public, filled)
select u.id, u.email, split_part(u.email, '@', 1), true, true
  from auth.users u where u.email like '%@applicant.test';

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
  v_viewer uuid;
  v_scoped uuid;
begin
  insert into public.company_roles (company_id, name) values (a, 'Viewer') returning id into v_viewer;
  insert into public.company_role_permissions (role_id, permission_key, scope) values
    (v_viewer, 'jobs.view', 'all'), (v_viewer, 'applicants.view', 'all');
  insert into public.company_roles (company_id, name) values (a, 'Scoped') returning id into v_scoped;
  insert into public.company_role_permissions (role_id, permission_key, scope) values
    (v_scoped, 'jobs.view', 'assigned'), (v_scoped, 'jobs.edit', 'assigned'),
    (v_scoped, 'applicants.view', 'assigned'), (v_scoped, 'interviews.view', 'assigned'),
    (v_scoped, 'interviews.manage', 'assigned');

  insert into public.company_members (company_id, user_id, role_id, display_name) values
    (a, 'c2000000-0000-4000-8000-000000000001', pg_temp.role_of(a, 'admin'), 'Ada Admin'),
    (a, 'c3000000-0000-4000-8000-000000000001', pg_temp.role_of(a, 'member'), 'Max Member'),
    (a, 'c4000000-0000-4000-8000-000000000001', v_viewer, 'Vic Viewer'),
    (a, 'c5000000-0000-4000-8000-000000000001', v_scoped, 'Sam Scoped');
  insert into public.company_job_assignments (company_id, job_post_id, user_id) values
    (a, 'b0000000-0000-4000-8000-000000000003', 'c5000000-0000-4000-8000-000000000001')
  on conflict do nothing;
end $$;

-- Applications: applicants 1–8 to A1, applicant 1 and 2 to A2, applicant 1 to B1.
insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id)
select ('e0000000-0000-4000-8000-00000000000' || n)::uuid, ('a0000000-0000-4000-8000-00000000000' || n)::uuid,
       'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'
  from generate_series(1, 8) n;
insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id) values
  ('e0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003'),
  ('e0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003'),
  ('e0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002');

-- ================================================ block 1: schema and access
-- SIT-020.

do $$
declare
  a uuid := 'c0000000-0000-4000-8000-000000000001';
  b1 uuid := 'b0000000-0000-4000-8000-000000000002';
  nine jsonb := (select jsonb_agg(jsonb_build_object('text', 'Q' || g)) from generate_series(1, 9) g);
  six jsonb := (select jsonb_agg(jsonb_build_object('name', 'C' || g, 'description', 'd')) from generate_series(1, 6) g);
  cfg public.job_interview_configs%rowtype;
begin
  -- job_interview_configs checks.
  begin
    insert into public.job_interview_configs (job_post_id, company_id, invite_rule) values (b1, a, 'all');
    raise exception 'invite_rule ''all'' was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.job_interview_configs (job_post_id, company_id, questions) values (b1, a, nine);
    raise exception '9 questions were accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.job_interview_configs (job_post_id, company_id, competencies) values (b1, a, six);
    raise exception '6 competencies were accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.job_interview_configs (job_post_id, company_id, enabled) values (b1, a, true);
    raise exception 'an enabled config with no competencies was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.job_interview_configs (job_post_id, company_id, fit_threshold) values (b1, a, null);
    raise exception 'fit_threshold with no threshold was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.job_interview_configs (job_post_id, company_id, fit_threshold) values (b1, a, 101);
    raise exception 'a threshold of 101 was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.job_interview_configs (job_post_id, company_id, duration_minutes) values (b1, a, 25);
    raise exception 'a 25-minute interview was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.job_interview_configs (job_post_id, company_id, deadline_days) values (b1, a, 2);
    raise exception 'a 2-day deadline was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.job_interview_configs (job_post_id, company_id, invite_rule, fit_threshold)
    values (b1, a, 'manual', null);
    raise exception using errcode = 'P0001', message = 'ROLLBACK';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'ROLLBACK' then raise; end if;
  end;

  -- Defaults, and company_id comes from the job whatever was sent.
  begin
    insert into public.job_interview_configs (job_post_id, company_id) values (b1, a) returning * into cfg;
    assert cfg.company_id = 'c0000000-0000-4000-8000-000000000002', 'company_id wasn''t taken from the job';
    assert cfg.invite_rule = 'fit_threshold' and cfg.fit_threshold = 70 and cfg.duration_minutes = 15
       and cfg.deadline_days = 5 and not cfg.enabled and cfg.language = 'en', format('wrong defaults: %s', to_jsonb(cfg));
    raise exception using errcode = 'P0001', message = 'ROLLBACK';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'ROLLBACK' then raise; end if;
  end;

  -- The catalog and the templates (SIT-004).
  assert exists (select 1 from public.company_permissions where key = 'interviews.view' and scopable and requires = '{applicants.view}'),
    'interviews.view missing or wrong';
  assert exists (select 1 from public.company_permissions where key = 'interviews.manage' and scopable and requires = '{interviews.view}'),
    'interviews.manage missing or wrong';
  assert not exists (
    select 1 from public.company_roles r
     where r.template_key = 'admin'
       and (select count(*) from public.company_role_permissions p
             where p.role_id = r.id and p.permission_key in ('interviews.view', 'interviews.manage')) <> 2
  ), 'an Admin role lacks an interviews permission';
  assert not exists (
    select 1 from public.company_roles r
     where r.template_key = 'member'
       and (not exists (select 1 from public.company_role_permissions p
                         where p.role_id = r.id and p.permission_key = 'interviews.view')
            or exists (select 1 from public.company_role_permissions p
                        where p.role_id = r.id and p.permission_key = 'interviews.manage'))
  ), 'a Member role has the wrong interviews permissions';

  -- Account deletion removes screening data; the job and the application too.
  assert pg_temp.fk_action('public.application_interviews', 'applicant_user_id') = 'c', 'applicant fk doesn''t cascade';
  assert pg_temp.fk_action('public.application_interviews', 'application_id') = 'c', 'application fk doesn''t cascade';
  assert pg_temp.fk_action('public.interviews', 'application_interview_id') = 'c', 'interview link doesn''t cascade';

  -- The new event types.
  begin
    insert into public.application_events (company_id, application_id, type)
    values (a, 'e0000000-0000-4000-8000-000000000001', 'interview_bogus');
    raise exception 'an unknown event type was accepted';
  exception when check_violation then null;
  end;
end $$;

-- A screening interview for applicant 8 (A1), seeded directly, plus a practice
-- interview of theirs. The RPCs are tested in block 2.
insert into public.application_interviews
  (id, application_id, job_post_id, company_id, applicant_user_id, config_snapshot, invited_via, deadline_at, credits_cost)
values
  ('fa000000-0000-4000-8000-000000000008', 'e0000000-0000-4000-8000-000000000008',
   'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000008',
   '{"questions":[{"text":"Secret question"}],"competencies":[{"name":"System design","description":"Secret rubric"}],
     "duration_minutes":15,"deadline_days":5,"language":"en","company_name":"Acme","job_title":"A1"}',
   'manual', now() + interval '5 days', 15);
insert into public.interviews (id, user_id, job_id, name, kind, application_interview_id) values
  ('1e000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000008',
   'd0000000-0000-4000-8000-000000000001', 'A1', 'screening', 'fa000000-0000-4000-8000-000000000008');
update public.application_interviews set interview_id = '1e000000-0000-4000-8000-000000000008'
 where id = 'fa000000-0000-4000-8000-000000000008';
insert into public.interviews (id, user_id, name) values
  ('1e000000-0000-4000-8000-000000000018', 'a0000000-0000-4000-8000-000000000008', 'Practice');
insert into public.interview_sessions (id, interview_id, voice_session_id, status, turns, transcript_source) values
  ('15000000-0000-4000-8000-000000000008', '1e000000-0000-4000-8000-000000000008', 'vs8', 'completed', pg_temp.turns(3), 'server'),
  ('15000000-0000-4000-8000-000000000018', '1e000000-0000-4000-8000-000000000018', 'vp8', 'completed', pg_temp.turns(3), 'client');
insert into public.interview_analyses (interview_session_id, perspective, status) values
  ('15000000-0000-4000-8000-000000000008', 'company', 'completed'),
  ('15000000-0000-4000-8000-000000000018', 'candidate', 'completed');

do $$
begin
  -- application_interviews checks.
  begin
    update public.application_interviews set invited_via = 'all' where id = 'fa000000-0000-4000-8000-000000000008';
    raise exception 'invited_via ''all'' was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.application_interviews set attempts_used = 3 where id = 'fa000000-0000-4000-8000-000000000008';
    raise exception 'attempts_used above max_attempts was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.application_interviews set max_attempts = 4 where id = 'fa000000-0000-4000-8000-000000000008';
    raise exception 'max_attempts 4 was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.application_interviews set deadline_extensions = 3 where id = 'fa000000-0000-4000-8000-000000000008';
    raise exception 'a third extension was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.application_interviews set status = 'paused' where id = 'fa000000-0000-4000-8000-000000000008';
    raise exception 'paused without paused_at was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.application_interviews set accommodation_request = repeat('x', 501)
     where id = 'fa000000-0000-4000-8000-000000000008';
    raise exception 'a 501-character accommodation request was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.application_interviews
      (application_id, job_post_id, company_id, applicant_user_id, config_snapshot, invited_via, deadline_at, credits_cost)
    values ('e0000000-0000-4000-8000-000000000008', 'b0000000-0000-4000-8000-000000000001',
            'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000008', '{}', 'manual', now(), 15);
    raise exception 'a second interview for one application was accepted';
  exception when unique_violation then null;
  end;

  -- interviews: kind and its link go together.
  begin
    insert into public.interviews (user_id, name, kind) values ('a0000000-0000-4000-8000-000000000008', 'x', 'screening');
    raise exception 'a screening interview with no link was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.interviews (user_id, name, kind) values ('a0000000-0000-4000-8000-000000000008', 'x', 'other');
    raise exception 'an unknown kind was accepted';
  exception when check_violation then null;
  end;
  assert (select kind from public.interviews where id = '1e000000-0000-4000-8000-000000000018') = 'practice',
    'interviews don''t default to practice';

  -- interview_sessions columns.
  assert (select transcript_source from public.interview_sessions where id = '15000000-0000-4000-8000-000000000018') = 'client',
    'transcript_source doesn''t default to client';
  begin
    update public.interview_sessions set end_reason = 'boom' where id = '15000000-0000-4000-8000-000000000008';
    raise exception 'an unknown end reason was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.interview_sessions set transcript_source = 'browser' where id = '15000000-0000-4000-8000-000000000008';
    raise exception 'an unknown transcript source was accepted';
  exception when check_violation then null;
  end;
end $$;

-- Configs: interviews.manage and jobs.edit on the job (owner A).
set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare
  cfg public.job_interview_configs%rowtype;
begin
  insert into public.job_interview_configs
    (job_post_id, company_id, enabled, questions, competencies, duration_minutes)
  values ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', true,
          '[{"text":"Why this role?"}]',
          '[{"name":"System design","description":"Reasons about trade-offs at 10k rps"},
            {"name":"Communication","description":"Explains trade-offs clearly"}]', 20)
  returning * into cfg;
  assert cfg.company_id = 'c0000000-0000-4000-8000-000000000001', 'the config took the company from the input';
  assert cfg.updated_by = 'c1000000-0000-4000-8000-000000000001', 'updated_by isn''t the caller';

  begin
    insert into public.job_interview_configs (job_post_id, company_id)
    values ('b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001');
    raise exception 'owner A wrote a config for B''s job';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Member: interviews.view, no manage, no jobs.edit.
select pg_temp.act('c3000000-0000-4000-8000-000000000001');
do $$
declare
  n int;
begin
  assert (select count(*) from public.job_interview_configs) = 1, 'the Member can''t read A1''s config';
  update public.job_interview_configs set fit_threshold = 10;
  get diagnostics n = row_count;
  assert n = 0, 'the Member updated a config';
  begin
    insert into public.job_interview_configs (job_post_id, company_id)
    values ('b0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001');
    raise exception 'the Member created a config';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Viewer: applicants.view only.
select pg_temp.act('c4000000-0000-4000-8000-000000000001');
do $$
begin
  assert (select count(*) from public.job_interview_configs) = 0, 'a role without interviews.view reads configs';
end $$;

-- Scoped to A2: writes A2's config, nothing on A1, can't move it to B's job.
select pg_temp.act('c5000000-0000-4000-8000-000000000001');
do $$
declare
  n int;
begin
  assert (select count(*) from public.job_interview_configs) = 0, 'the scoped member reads A1''s config';
  insert into public.job_interview_configs (job_post_id, company_id, enabled, invite_rule, competencies, duration_minutes)
  values ('b0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', true, 'manual',
          '[{"name":"Communication","description":"Explains trade-offs clearly"}]', 10);
  update public.job_interview_configs set fit_threshold = 10 where job_post_id = 'b0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'the scoped member updated A1''s config';
  begin
    update public.job_interview_configs set job_post_id = 'b0000000-0000-4000-8000-000000000002'
     where job_post_id = 'b0000000-0000-4000-8000-000000000003';
    raise exception 'a config was moved to another company''s job';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Admin: both keys and jobs.edit.
select pg_temp.act('c2000000-0000-4000-8000-000000000001');
do $$
declare
  n int;
begin
  update public.job_interview_configs set deadline_days = 5 where job_post_id = 'b0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 1, 'the Admin couldn''t update a config';
end $$;

select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$
declare
  n int;
begin
  assert (select count(*) from public.job_interview_configs) = 0, 'company B reads A''s configs';
  delete from public.job_interview_configs;
  get diagnostics n = row_count;
  assert n = 0, 'company B deleted A''s configs';
end $$;

-- The candidate (applicant 8).
select pg_temp.act('a0000000-0000-4000-8000-000000000008');
do $$
declare
  n int;
  r text;
  mine record;
begin
  assert (select count(*) from public.interviews) = 2, 'the candidate doesn''t see both their interviews';
  assert (select count(*) from public.application_interviews) = 0, 'the candidate reads application_interviews directly';
  assert (select count(*) from public.job_interview_configs) = 0, 'the candidate reads configs';
  assert (select count(*) from public.interview_sessions) = 2, 'the candidate can''t read their own transcripts';
  assert (select array_agg(perspective) from public.interview_analyses) = array['candidate'],
    format('the candidate reads analyses: %s', (select array_agg(perspective) from public.interview_analyses));

  select * into mine from public.my_screening_interviews();
  assert mine.id = 'fa000000-0000-4000-8000-000000000008' and mine.status = 'invited'
     and mine.company_name = 'Acme' and mine.job_title = 'A1' and mine.duration_minutes = 15
     and mine.competency_names = array['System design'], format('my_screening_interviews: %s', to_jsonb(mine));
  assert (select count(*) from public.my_screening_interviews()) = 1, 'my_screening_interviews has other rows';

  -- No screening interview of their own making.
  begin
    insert into public.interviews (user_id, name, kind, application_interview_id)
    values ('a0000000-0000-4000-8000-000000000008', 'x', 'screening', 'fa000000-0000-4000-8000-000000000008');
    raise exception 'the candidate created a screening interview';
  exception when insufficient_privilege or sqlstate 'P0001' or unique_violation then null;
  end;

  -- The screening interview is read-only: every column, and no delete.
  update public.interviews set active_session_id = 'x', active_session_updated_at = now()
   where id = '1e000000-0000-4000-8000-000000000008';
  get diagnostics n = row_count;
  assert n = 0, 'the candidate set active_session_id on a screening interview';
  update public.interviews set charged_session_ids = '{vs8}', turns = '[]' where id = '1e000000-0000-4000-8000-000000000008';
  get diagnostics n = row_count;
  assert n = 0, 'the candidate wrote charged_session_ids or turns on a screening interview';
  update public.interviews set kind = 'practice', application_interview_id = null
   where id = '1e000000-0000-4000-8000-000000000008';
  get diagnostics n = row_count;
  assert n = 0, 'the candidate turned a screening interview into a practice one';
  delete from public.interviews where id = '1e000000-0000-4000-8000-000000000008';
  get diagnostics n = row_count;
  assert n = 0, 'the candidate deleted a screening interview';

  -- A practice interview can't become a screening one.
  begin
    update public.interviews set kind = 'screening', application_interview_id = 'fa000000-0000-4000-8000-000000000008'
     where id = '1e000000-0000-4000-8000-000000000018';
    raise exception 'the candidate turned a practice interview into a screening one';
  exception when insufficient_privilege or sqlstate 'P0001' or unique_violation or check_violation then null;
  end;

  -- Screening sessions: no insert, no update.
  begin
    insert into public.interview_sessions (interview_id, voice_session_id, turns)
    values ('1e000000-0000-4000-8000-000000000008', 'forged', pg_temp.turns(5));
    raise exception 'the candidate inserted a screening session';
  exception when insufficient_privilege then null;
  end;
  update public.interview_sessions set turns = '[]' where id = '15000000-0000-4000-8000-000000000008';
  get diagnostics n = row_count;
  assert n = 0, 'the candidate rewrote a screening transcript';
  begin
    insert into public.interview_sessions (interview_id, voice_session_id, transcript_source)
    values ('1e000000-0000-4000-8000-000000000018', 'fake-server', 'server');
    raise exception 'the candidate inserted a server-recorded session';
  exception when insufficient_privilege then null;
  end;

  -- A screening session can't be shared as a practice interview.
  r := pg_temp.err($q$insert into public.application_attachments (application_id, kind, interview_session_id)
    values ('e0000000-0000-4000-8000-000000000008', 'interview_session', '15000000-0000-4000-8000-000000000008')$q$);
  assert r = 'SESSION_NOT_FOUND', format('attaching a screening session: %s', r);

  -- Practice works as today: insert, update, attach, delete.
  update public.interviews set name = 'Renamed', active_session_id = null where id = '1e000000-0000-4000-8000-000000000018';
  get diagnostics n = row_count;
  assert n = 1, 'the candidate can''t update a practice interview';
  insert into public.interview_sessions (interview_id, voice_session_id, turns)
  values ('1e000000-0000-4000-8000-000000000018', 'vp8b', '[]');
  update public.interview_sessions set turns = pg_temp.turns(1), updated_at = now()
   where interview_id = '1e000000-0000-4000-8000-000000000018' and voice_session_id = 'vp8b';
  get diagnostics n = row_count;
  assert n = 1, 'the candidate can''t save a practice transcript';
  insert into public.application_attachments (application_id, kind, interview_session_id)
  values ('e0000000-0000-4000-8000-000000000008', 'interview_session', '15000000-0000-4000-8000-000000000018');
  delete from public.application_attachments where application_id = 'e0000000-0000-4000-8000-000000000008';
  insert into public.interviews (id, user_id, name)
  values ('1e000000-0000-4000-8000-000000000028', 'a0000000-0000-4000-8000-000000000008', 'Throwaway');
  delete from public.interviews where id = '1e000000-0000-4000-8000-000000000028';
  get diagnostics n = row_count;
  assert n = 1, 'the candidate can''t delete a practice interview';

  -- No direct writes to application_interviews, and no service-role functions.
  begin
    update public.application_interviews set status = 'completed';
    raise exception 'the candidate updated application_interviews';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_screening_invite('e0000000-0000-4000-8000-000000000001', 'manual', null);
    raise exception 'the candidate called create_screening_invite';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.finish_screening_session('15000000-0000-4000-8000-000000000008', '[]', 'completed', 1);
    raise exception 'the candidate called finish_screening_session';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.expire_screening_interviews();
    raise exception 'the candidate called expire_screening_interviews';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$
begin
  assert (select active_session_id is null and charged_session_ids = '{}' and kind = 'screening'
            from public.interviews where id = '1e000000-0000-4000-8000-000000000008'),
    'the screening interview changed';
  assert (select jsonb_array_length(turns) from public.interview_sessions
           where id = '15000000-0000-4000-8000-000000000008') = 3, 'the screening transcript changed';
end $$;

-- Companies: A's members with interviews.view read the screening rows only.
set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare
  n int;
begin
  assert (select count(*) from public.application_interviews) = 1, 'owner A can''t read its interview';
  assert (select count(*) from public.interviews) = 1, 'owner A should read the screening interview only';
  assert (select array_agg(id) from public.interview_sessions) = array['15000000-0000-4000-8000-000000000008'::uuid],
    'owner A should read the screening session only';
  assert (select array_agg(perspective) from public.interview_analyses) = array['company'],
    'owner A should read the company analysis only';
  update public.interview_sessions set turns = '[]';
  get diagnostics n = row_count;
  assert n = 0, 'owner A rewrote a transcript';
  begin
    insert into public.application_interviews
      (application_id, job_post_id, company_id, applicant_user_id, config_snapshot, invited_via, deadline_at, credits_cost)
    values ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
            'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '{}', 'manual', now(), 15);
    raise exception 'owner A inserted an application interview';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.application_interviews;
    raise exception 'owner A deleted application interviews';
  exception when insufficient_privilege then null;
  end;
end $$;

select pg_temp.act('c3000000-0000-4000-8000-000000000001');
do $$
begin
  assert (select count(*) from public.application_interviews) = 1, 'the Member can''t read interviews';
  assert (select count(*) from public.interview_sessions) = 1, 'the Member can''t read the transcript';
  assert (select count(*) from public.interview_analyses) = 1, 'the Member can''t read the report';
end $$;

select pg_temp.act('c4000000-0000-4000-8000-000000000001');
do $$
begin
  assert (select count(*) from public.application_interviews) = 0, 'a role without interviews.view reads interviews';
  assert (select count(*) from public.interviews) = 0, 'a role without interviews.view reads the interview';
  assert (select count(*) from public.interview_sessions) = 0, 'a role without interviews.view reads transcripts';
  assert (select count(*) from public.interview_analyses) = 0, 'a role without interviews.view reads reports';
end $$;

select pg_temp.act('c5000000-0000-4000-8000-000000000001');
do $$
begin
  assert (select count(*) from public.application_interviews) = 0, 'a member scoped to A2 reads A1''s interviews';
  assert (select count(*) from public.interview_sessions) = 0, 'a member scoped to A2 reads A1''s transcripts';
  assert (select count(*) from public.interview_analyses) = 0, 'a member scoped to A2 reads A1''s reports';
end $$;

select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$
begin
  assert (select count(*) from public.application_interviews) = 0, 'company B reads A''s interviews';
  assert (select count(*) from public.interviews) = 0, 'company B reads A''s interview';
  assert (select count(*) from public.interview_sessions) = 0, 'company B reads A''s transcripts';
  assert (select count(*) from public.interview_analyses) = 0, 'company B reads A''s reports';
end $$;
reset role;

-- ================================================ block 2: lifecycle
-- SIT-021.

-- New applications are still screened by applications_enqueue_screening, and
-- applying never invites by itself.
insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id) values
  ('e0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000009',
   'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001');
do $$
begin
  assert exists (select 1 from public.application_screenings
                  where application_id = 'e0000000-0000-4000-8000-000000000009' and status = 'queued'),
    'a new application to an interview-enabled job wasn''t queued for screening';
  assert not exists (select 1 from public.application_interviews
                      where application_id = 'e0000000-0000-4000-8000-000000000009'),
    'applying created an interview';
end $$;

-- Invites (as the service role would call it). Company A is on the free plan:
-- 30 interview minutes, no credits.
do $$
declare
  res jsonb;
  ai uuid;
  r_ai public.application_interviews%rowtype;
  iv public.interviews%rowtype;
begin
  res := pg_temp.expect(public.create_screening_invite('e0000000-0000-4000-8000-000000000001', 'manual',
           'c1000000-0000-4000-8000-000000000001'), null, 'first invite');
  ai := (res ->> 'id')::uuid;
  perform set_config('test.ai1', ai::text, true);
  select * into r_ai from public.application_interviews where id = ai;
  assert r_ai.status = 'invited' and r_ai.invited_via = 'manual' and r_ai.credits_cost = 20
     and r_ai.applicant_user_id = 'a0000000-0000-4000-8000-000000000001'
     and r_ai.deadline_at = now() + interval '5 days' and r_ai.max_attempts = 2 and r_ai.attempts_used = 0,
    format('invite row: %s', to_jsonb(r_ai));
  assert r_ai.config_snapshot ->> 'company_name' = 'Acme' and r_ai.config_snapshot ->> 'job_title' = 'A1'
     and jsonb_array_length(r_ai.config_snapshot -> 'competencies') = 2
     and r_ai.config_snapshot -> 'questions' = '[{"text":"Why this role?"}]'
     and (r_ai.config_snapshot ->> 'duration_minutes')::int = 20,
    format('snapshot: %s', r_ai.config_snapshot);
  select * into iv from public.interviews where id = r_ai.interview_id;
  assert iv.kind = 'screening' and iv.application_interview_id = ai
     and iv.user_id = 'a0000000-0000-4000-8000-000000000001'
     and iv.job_id = 'd0000000-0000-4000-8000-000000000001', format('linked interview: %s', to_jsonb(iv));
  assert pg_temp.hold(ai) = 20, 'no 20-minute hold';
  assert (select actor_user_id from public.company_entitlement_holds
           where ref_type = 'application_interview' and ref_id = ai::text) = 'c1000000-0000-4000-8000-000000000001',
    'the hold isn''t charged to the inviter';
  assert (select count(*) from public.application_events
           where type = 'interview_invited' and payload ->> 'application_interview_id' = ai::text
             and actor_user_id = 'c1000000-0000-4000-8000-000000000001') = 1, 'no interview_invited event';

  perform pg_temp.expect(public.create_screening_invite('e0000000-0000-4000-8000-000000000001', 'manual', null),
    'exists', 'second invite for one application');

  -- 10 minutes left and no credits.
  res := pg_temp.expect(public.create_screening_invite('e0000000-0000-4000-8000-000000000002', 'fit_threshold', null),
    'insufficient_credits', 'invite past the allowance');
  assert (res ->> 'credits_needed')::int = 10, format('credits_needed: %s', res);
  assert not exists (select 1 from public.application_interviews where application_id = 'e0000000-0000-4000-8000-000000000002'),
    'a failed invite left a row';
  assert (select count(*) from public.company_entitlement_holds where ref_type = 'application_interview') = 1,
    'a failed invite left a hold';

  perform public.set_company_plan('c0000000-0000-4000-8000-000000000001', 'growth', now() + interval '30 days');

  res := pg_temp.expect(public.create_screening_invite('e0000000-0000-4000-8000-000000000002', 'fit_threshold', null),
    null, 'fit-threshold invite');
  perform set_config('test.ai2', res ->> 'id', true);
  assert (select invited_via from public.application_interviews where id = (res ->> 'id')::uuid) = 'fit_threshold',
    'invited_via isn''t fit_threshold';
  for i in 3..7 loop
    res := pg_temp.expect(public.create_screening_invite(('e0000000-0000-4000-8000-00000000000' || i)::uuid,
             'agent', 'c2000000-0000-4000-8000-000000000001'), null, 'invite ' || i);
    perform set_config('test.ai' || i, res ->> 'id', true);
  end loop;

  -- A2's config is manual.
  perform pg_temp.expect(public.create_screening_invite('e0000000-0000-4000-8000-000000000011', 'fit_threshold', null),
    'manual_only', 'fit-threshold invite on a manual job');
  res := pg_temp.expect(public.create_screening_invite('e0000000-0000-4000-8000-000000000011', 'manual',
           'c5000000-0000-4000-8000-000000000001'), null, 'manual invite on A2');
  perform set_config('test.ai11', res ->> 'id', true);
  assert pg_temp.hold((res ->> 'id')::uuid) = 10, 'A2''s hold isn''t 10 minutes';

  -- Refusals.
  perform pg_temp.expect(public.create_screening_invite('e0000000-0000-4000-8000-000000000021', 'manual', null),
    'disabled', 'invite on a job without a config');
  perform pg_temp.expect(public.create_screening_invite('e0000000-0000-4000-8000-0000000000ff', 'manual', null),
    'not_applicant', 'invite for no application');
  update public.job_postings set status = 'inactive' where id = 'b0000000-0000-4000-8000-000000000003';
  perform pg_temp.expect(public.create_screening_invite('e0000000-0000-4000-8000-000000000012', 'manual', null),
    'job_inactive', 'invite on an inactive job');
  update public.job_postings set status = 'active' where id = 'b0000000-0000-4000-8000-000000000003';
  update public.job_interview_configs set enabled = false where job_post_id = 'b0000000-0000-4000-8000-000000000003';
  perform pg_temp.expect(public.create_screening_invite('e0000000-0000-4000-8000-000000000012', 'manual', null),
    'disabled', 'invite on a disabled config');
  update public.job_interview_configs set enabled = true where job_post_id = 'b0000000-0000-4000-8000-000000000003';
  begin
    perform public.create_screening_invite('e0000000-0000-4000-8000-000000000012', 'manual',
      'c1000000-0000-4000-8000-000000000002');
    raise exception 'an invite by another company''s member was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_screening_invite('e0000000-0000-4000-8000-000000000012', 'all', null);
    raise exception 'invite source ''all'' was accepted';
  exception when invalid_parameter_value then null;
  end;
  res := pg_temp.expect(public.create_screening_invite('e0000000-0000-4000-8000-000000000012', 'manual', null),
    null, 'invite for applicant 2 on A2');
  perform set_config('test.ai12', res ->> 'id', true);

  -- Editing the config doesn't change interviews already sent (SI-REQ-003).
  update public.job_interview_configs set questions = '[]' where job_post_id = 'b0000000-0000-4000-8000-000000000001';
  assert (select config_snapshot -> 'questions' from public.application_interviews where id = ai)
       = '[{"text":"Why this role?"}]', 'a config edit changed a sent invite';
end $$;

-- Applicant 1: consent, reserve and start, and every refusal on the way.
set local role authenticated;
select pg_temp.act('a0000000-0000-4000-8000-000000000002');
do $$
declare
  ai uuid := current_setting('test.ai1')::uuid;
begin
  perform pg_temp.expect(public.record_screening_consent(ai, 'v1'), 'not_found', 'consent by another user');
  perform pg_temp.expect(public.reserve_screening_attempt(ai, 'r0'), 'not_found', 'reserve by another user');
  assert (select count(*) from public.my_screening_interviews()) = 2, 'applicant 2 should see their two interviews';
end $$;

select pg_temp.act('a0000000-0000-4000-8000-000000000001');
do $$
declare
  ai uuid := current_setting('test.ai1')::uuid;
  iv uuid := (select interview_id from public.my_screening_interviews() where id = current_setting('test.ai1')::uuid);
  res jsonb;
  session uuid;
begin
  perform pg_temp.expect(public.reserve_screening_attempt(ai, 'r1'), 'no_consent', 'reserve before consent');
  perform pg_temp.expect(public.record_screening_consent(ai, 'v1'), null, 'consent');
  perform pg_temp.expect(public.reserve_screening_attempt(ai, 'r1'), null, 'reserve');
  perform pg_temp.expect(public.reserve_screening_attempt(ai, 'r2'), 'active_session', 'second reserve');
  perform pg_temp.expect(public.start_screening_attempt(ai, 'wrong', 'vs1'), 'reservation_expired', 'start with another reservation');
  res := pg_temp.expect(public.start_screening_attempt(ai, 'r1', 'vs1'), null, 'start');
  session := (res ->> 'session_id')::uuid;
  perform set_config('test.s1', session::text, true);

  -- One session: the interview is in progress now.
  perform pg_temp.expect(public.reserve_screening_attempt(ai, 'r3'), 'not_invited', 'reserve while in progress');
  perform pg_temp.expect(public.start_screening_attempt(ai, 'r1', 'vs1b'), 'not_invited', 'second start');
  perform pg_temp.expect(public.record_screening_consent(ai, 'v2'), 'not_invited', 'consent while in progress');
  assert (select status = 'in_progress' and attempts_used = 1 and consent_version = 'v1'
            from public.my_screening_interviews() where id = ai), 'start didn''t use an attempt';
  assert (select transcript_source = 'server' and status = 'active' and voice_session_id = 'vs1'
            from public.interview_sessions where id = session), 'the session isn''t a server one';

  -- Heartbeat works for screening; the practice functions refuse it.
  assert public.heartbeat_interview_session(iv, 'vs1'), 'heartbeat failed on a screening interview';
  begin
    perform public.reserve_interview_session(iv, 'p1');
    raise exception 'reserve_interview_session accepted a screening interview';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'Interview not found%' then raise; end if;
  end;
  assert not public.activate_interview_session(iv, 'vs1', 'vs-forged'), 'activate_interview_session accepted screening';
  begin
    perform public.deduct_interview_session_credits(iv, 'vs1');
    raise exception 'deduct_interview_session_credits accepted a screening interview';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'Interview not found%' then raise; end if;
  end;
  begin
    perform public.finalize_interview_analysis_session(session);
    raise exception 'finalize_interview_analysis_session accepted a screening session';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'Interview session not found%' then raise; end if;
  end;
end $$;

-- Applicants 2–5 start their first attempts.
select pg_temp.act('a0000000-0000-4000-8000-000000000002');
select set_config('test.s2a', pg_temp.start_attempt(current_setting('test.ai2')::uuid, 'vs2a')::text, true);
select pg_temp.act('a0000000-0000-4000-8000-000000000003');
select set_config('test.s3', pg_temp.start_attempt(current_setting('test.ai3')::uuid, 'vs3')::text, true);
select pg_temp.act('a0000000-0000-4000-8000-000000000004');
select set_config('test.s4', pg_temp.start_attempt(current_setting('test.ai4')::uuid, 'vs4')::text, true);
select pg_temp.act('a0000000-0000-4000-8000-000000000005');
select set_config('test.s5', pg_temp.start_attempt(current_setting('test.ai5')::uuid, 'vs5')::text, true);
reset role;

-- finish_screening_session, one case per SI-REQ-024 row.
do $$
declare
  ai1 uuid := current_setting('test.ai1')::uuid;
  ai3 uuid := current_setting('test.ai3')::uuid;
  ai4 uuid := current_setting('test.ai4')::uuid;
  ai5 uuid := current_setting('test.ai5')::uuid;
  res jsonb;
  analysis uuid;
  r_ai public.application_interviews%rowtype;
begin
  -- The AI concluded after 3 answers: completed, charged once, one report queued.
  res := pg_temp.expect(public.finish_screening_session(current_setting('test.s1')::uuid,
           pg_temp.turns(3), 'completed', 610), null, 'finish completed');
  assert res ->> 'status' = 'recorded' and res ->> 'session_status' = 'completed'
     and res ->> 'interview_status' = 'completed' and not (res ->> 'retry')::boolean, format('completed: %s', res);
  analysis := (res ->> 'analysis_id')::uuid;
  assert (select status = 'completed' and end_reason = 'completed' and duration_seconds = 610
             and jsonb_array_length(turns) = 3 and ended_at is not null
            from public.interview_sessions where id = current_setting('test.s1')::uuid), 'the session wasn''t recorded';
  assert (select perspective = 'company' and status = 'queued' from public.interview_analyses where id = analysis),
    'no queued company analysis';
  assert pg_temp.queued(analysis) = 1, 'the analysis wasn''t sent to the queue';
  assert pg_temp.hold(ai1) is null and pg_temp.charged(ai1) = 1, 'the hold wasn''t consumed';
  assert (select actor_user_id from public.company_usage_events
           where ref_type = 'application_interview' and ref_id = ai1::text) = 'c1000000-0000-4000-8000-000000000001',
    'the charge isn''t on the inviter';
  select * into r_ai from public.application_interviews where id = ai1;
  assert r_ai.status = 'completed' and r_ai.credits_charged and r_ai.completed_at is not null and r_ai.attempts_used = 1,
    format('interview after completion: %s', to_jsonb(r_ai));
  assert (select active_session_id is null from public.interviews where id = r_ai.interview_id), 'the lock wasn''t released';
  assert pg_temp.events(ai1, 'interview_completed') = 1 and pg_temp.events(ai1, 'interview_started') = 1,
    'missing started/completed events';

  -- A repeat callback returns the stored outcome, with no second charge or message.
  res := pg_temp.expect(public.finish_screening_session(current_setting('test.s1')::uuid,
           pg_temp.turns(0), 'error', 1), null, 'repeat finish');
  assert res ->> 'status' = 'already_recorded' and res ->> 'session_status' = 'completed'
     and (res ->> 'analysis_id')::uuid = analysis, format('repeat: %s', res);
  assert pg_temp.charged(ai1) = 1 and pg_temp.queued(analysis) = 1
     and (select count(*) from public.interview_analyses where interview_session_id = current_setting('test.s1')::uuid) = 1
     and pg_temp.events(ai1, 'interview_completed') = 1, 'a repeat callback charged or queued again';
  assert (select jsonb_array_length(turns) from public.interview_sessions
           where id = current_setting('test.s1')::uuid) = 3, 'a repeat callback overwrote the transcript';

  -- The AI concluded after 2 answers: completed with no score, never charged.
  res := pg_temp.expect(public.finish_screening_session(current_setting('test.s3')::uuid,
           pg_temp.turns(2), 'completed', 300), null, 'finish with 2 answers');
  assert res ->> 'session_status' = 'ineligible' and res ->> 'interview_status' = 'completed'
     and res ->> 'analysis_id' is null, format('2 answers: %s', res);
  assert pg_temp.hold(ai3) is null and pg_temp.charged(ai3) = 0, '2 answers: the hold wasn''t released';
  assert not (select credits_charged from public.application_interviews where id = ai3), '2 answers: charged';

  -- Inactivity after 3 answers: completed and scored.
  res := pg_temp.expect(public.finish_screening_session(current_setting('test.s5')::uuid,
           pg_temp.turns(3, 4), 'inactivity', 500), null, 'finish inactivity');
  assert res ->> 'session_status' = 'completed' and res ->> 'interview_status' = 'completed'
     and res ->> 'analysis_id' is not null, format('inactivity: %s', res);
  assert pg_temp.charged(ai5) = 1, 'inactivity: not charged';

  -- A disconnect after 4 answers with an attempt left: the transcript is kept,
  -- the candidate can retry, nothing is charged yet.
  res := pg_temp.expect(public.finish_screening_session(current_setting('test.s4')::uuid,
           pg_temp.turns(4), 'client_disconnect', 200), null, 'finish disconnect with answers');
  assert res ->> 'session_status' = 'completed' and res ->> 'interview_status' = 'invited'
     and (res ->> 'retry')::boolean and res ->> 'analysis_id' is null, format('disconnect with answers: %s', res);
  assert (select attempts_used from public.application_interviews where id = ai4) = 1, 'disconnect: attempt not counted';
  assert pg_temp.hold(ai4) = 20 and pg_temp.charged(ai4) = 0, 'disconnect: the hold changed';

  begin
    perform public.finish_screening_session(current_setting('test.s4')::uuid, '[]', 'crashed', 1);
    raise exception 'an unknown end reason was accepted';
  exception when invalid_parameter_value then null;
  end;
  assert pg_temp.expect(public.finish_screening_session('15000000-0000-4000-8000-000000000018', '[]', 'completed', 1),
    null, 'finish on practice') ->> 'status' = 'ignored', 'a practice session wasn''t ignored';
  perform pg_temp.expect(public.finish_screening_session(gen_random_uuid(), '[]', 'completed', 1),
    'not_found', 'finish on an unknown session');
end $$;

-- Applicant 2: technical failures. Zero answers don't count; the last allowed
-- attempt ends the interview incomplete; the company grants one more.
do $$
declare
  ai2 uuid := current_setting('test.ai2')::uuid;
  res jsonb;
begin
  res := pg_temp.expect(public.finish_screening_session(current_setting('test.s2a')::uuid,
           pg_temp.turns(0, 1), 'client_disconnect', 5), null, 'zero-answer disconnect');
  assert res ->> 'session_status' = 'ineligible' and res ->> 'interview_status' = 'invited'
     and (res ->> 'retry')::boolean, format('zero answers: %s', res);
  assert (select attempts_used from public.application_interviews where id = ai2) = 0,
    'a zero-answer disconnect used an attempt';
end $$;

set local role authenticated;
select pg_temp.act('a0000000-0000-4000-8000-000000000002');
select set_config('test.s2b', pg_temp.start_attempt(current_setting('test.ai2')::uuid, 'vs2b')::text, true);
reset role;
select pg_temp.expect(public.finish_screening_session(current_setting('test.s2b')::uuid,
  pg_temp.turns(2), 'error', 90), null, 'error with 2 answers');
set local role authenticated;
select pg_temp.act('a0000000-0000-4000-8000-000000000002');
select set_config('test.s2c', pg_temp.start_attempt(current_setting('test.ai2')::uuid, 'vs2c')::text, true);
reset role;

do $$
declare
  ai2 uuid := current_setting('test.ai2')::uuid;
  res jsonb;
begin
  assert (select attempts_used from public.application_interviews where id = ai2) = 2, 'attempts after two starts';
  res := pg_temp.expect(public.finish_screening_session(current_setting('test.s2c')::uuid,
           pg_temp.turns(1), 'no_callback', null), null, 'last attempt fails');
  assert res ->> 'session_status' = 'ineligible' and res ->> 'interview_status' = 'completed'
     and not (res ->> 'retry')::boolean and res ->> 'analysis_id' is null, format('last attempt: %s', res);
  assert (select duration_seconds is null from public.interview_sessions where id = current_setting('test.s2c')::uuid),
    'a missing duration wasn''t stored as null';
  assert pg_temp.hold(ai2) is null and pg_temp.charged(ai2) = 0, 'last attempt: the hold wasn''t released';
end $$;

set local role authenticated;
select pg_temp.act('a0000000-0000-4000-8000-000000000002');
select pg_temp.expect(public.reserve_screening_attempt(current_setting('test.ai2')::uuid, 'r9'),
  'not_invited', 'reserve after the last attempt');

-- grant_attempt and the other company actions need interviews.manage.
select pg_temp.act('c3000000-0000-4000-8000-000000000001');
select pg_temp.expect(public.manage_screening_interview(current_setting('test.ai2')::uuid, 'grant_attempt'),
  'forbidden', 'grant by the Member');
select pg_temp.act('c5000000-0000-4000-8000-000000000001');
select pg_temp.expect(public.manage_screening_interview(current_setting('test.ai2')::uuid, 'grant_attempt'),
  'forbidden', 'grant by a member scoped to another job');
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
select pg_temp.expect(public.manage_screening_interview(current_setting('test.ai2')::uuid, 'grant_attempt'),
  'not_found', 'grant by company B');
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
select pg_temp.expect(public.manage_screening_interview(current_setting('test.ai1')::uuid, 'grant_attempt'),
  'invalid_status', 'grant on a scored interview');
select pg_temp.expect(public.manage_screening_interview(current_setting('test.ai2')::uuid, 'grant_attempt'),
  null, 'grant');
select pg_temp.expect(public.manage_screening_interview(current_setting('test.ai2')::uuid, 'grant_attempt'),
  'limit_reached', 'second grant');
select pg_temp.act('a0000000-0000-4000-8000-000000000002');
select set_config('test.s2d', pg_temp.start_attempt(current_setting('test.ai2')::uuid, 'vs2d')::text, true);
reset role;

do $$
declare
  ai2 uuid := current_setting('test.ai2')::uuid;
  res jsonb;
begin
  assert pg_temp.events(ai2, 'interview_attempt_granted') = 1, 'no attempt_granted event';
  assert (select max_attempts = 3 and attempts_used = 3 and attempt_granted from public.application_interviews where id = ai2),
    'the granted attempt wasn''t recorded';
  res := pg_temp.expect(public.finish_screening_session(current_setting('test.s2d')::uuid,
           pg_temp.turns(3), 'time_limit', 1200), null, 'granted attempt completes');
  assert res ->> 'session_status' = 'completed' and res ->> 'interview_status' = 'completed', format('granted: %s', res);
  assert pg_temp.charged(ai2) = 1, 'the granted attempt wasn''t charged';
end $$;

-- Applicant 6: accommodation, extend (twice at most), waive.
set local role authenticated;
select pg_temp.act('a0000000-0000-4000-8000-000000000006');
do $$
declare
  ai6 uuid := current_setting('test.ai6')::uuid;
begin
  perform pg_temp.expect(public.request_screening_accommodation(ai6, repeat('x', 501)), 'invalid_text', 'long request');
  perform pg_temp.expect(public.request_screening_accommodation(ai6, '  '), 'invalid_text', 'empty request');
  perform pg_temp.expect(public.request_screening_accommodation(ai6, 'I have a hearing impairment.'), null, 'accommodation');
  perform pg_temp.expect(public.decline_screening_interview(ai6), 'not_invited', 'decline while paused');
  perform pg_temp.expect(public.reserve_screening_attempt(ai6, 'r6'), 'not_invited', 'reserve while paused');
end $$;

select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare
  ai6 uuid := current_setting('test.ai6')::uuid;
  before timestamptz := (select deadline_at from public.application_interviews where id = current_setting('test.ai6')::uuid);
begin
  assert (select status = 'paused' and paused_at is not null and accommodation_request = 'I have a hearing impairment.'
            from public.application_interviews where id = ai6), 'the interview isn''t paused';
  perform pg_temp.expect(public.manage_screening_interview(ai6, 'extend', 0), 'invalid_days', 'extend by 0');
  perform pg_temp.expect(public.manage_screening_interview(ai6, 'extend', 15), 'invalid_days', 'extend by 15');
  perform pg_temp.expect(public.manage_screening_interview(ai6, 'extend', 3), null, 'extend from paused');
  assert (select status = 'invited' and paused_at is null and deadline_extensions = 1
                 and deadline_at = before + interval '3 days'
            from public.application_interviews where id = ai6), 'extend didn''t resume with 3 more days';
  perform pg_temp.expect(public.manage_screening_interview(ai6, 'extend', 1), null, 'second extend');
  perform pg_temp.expect(public.manage_screening_interview(ai6, 'extend', 1), 'limit_reached', 'third extend');
  perform pg_temp.expect(public.manage_screening_interview(ai6, 'waive'), 'invalid_status', 'waive while invited');
  assert pg_temp.events(ai6, 'interview_extended') = 2, 'extend events';
  begin
    perform public.manage_screening_interview(ai6, 'delete');
    raise exception 'an unknown action was accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

select pg_temp.act('a0000000-0000-4000-8000-000000000006');
select pg_temp.expect(public.request_screening_accommodation(current_setting('test.ai6')::uuid, 'No quiet place.'),
  null, 'second accommodation');
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
select pg_temp.expect(public.manage_screening_interview(current_setting('test.ai6')::uuid, 'waive'), null, 'waive');

-- Applicant 7 declines; the scoped member cancels applicant 2's A2 invite.
select pg_temp.act('a0000000-0000-4000-8000-000000000007');
select pg_temp.expect(public.decline_screening_interview(current_setting('test.ai7')::uuid), null, 'decline');
select pg_temp.expect(public.decline_screening_interview(current_setting('test.ai7')::uuid), 'not_invited', 'second decline');
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
select pg_temp.expect(public.manage_screening_interview(current_setting('test.ai7')::uuid, 'cancel'),
  'invalid_status', 'cancel a declined interview');
select pg_temp.act('c5000000-0000-4000-8000-000000000001');
select pg_temp.expect(public.manage_screening_interview(current_setting('test.ai12')::uuid, 'cancel'), null, 'cancel on A2');
reset role;

do $$
declare
  ai6 uuid := current_setting('test.ai6')::uuid;
  ai7 uuid := current_setting('test.ai7')::uuid;
  ai12 uuid := current_setting('test.ai12')::uuid;
begin
  assert (select status from public.application_interviews where id = ai6) = 'cancelled', 'waive didn''t cancel';
  assert (select count(*) from public.application_events
           where type = 'interview_cancelled' and payload ->> 'application_interview_id' = ai6::text
             and (payload ->> 'waived')::boolean) = 1, 'no waived event';
  assert pg_temp.events(ai6, 'interview_accommodation_requested') = 2, 'accommodation events';
  assert pg_temp.hold(ai6) is null and pg_temp.charged(ai6) = 0, 'waive: the hold wasn''t released';
  assert (select status from public.application_interviews where id = ai7) = 'declined', 'decline didn''t stick';
  assert pg_temp.events(ai7, 'interview_declined') = 1 and pg_temp.hold(ai7) is null, 'decline: event or hold';
  assert (select status from public.application_interviews where id = ai12) = 'cancelled', 'cancel didn''t stick';
  assert (select actor_user_id from public.application_events
           where type = 'interview_cancelled' and payload ->> 'application_interview_id' = ai12::text)
       = 'c5000000-0000-4000-8000-000000000001', 'the cancel event has the wrong actor';
  assert pg_temp.hold(ai12) is null, 'cancel: the hold wasn''t released';
end $$;

-- Expiry: only invited interviews past their deadline. Applicant 9 (A1) asks
-- for an accommodation, so theirs is paused and doesn't expire.
select pg_temp.expect(public.create_screening_invite('e0000000-0000-4000-8000-000000000009', 'manual', null),
  null, 'invite applicant 9');
set local role authenticated;
select pg_temp.act('a0000000-0000-4000-8000-000000000009');
select pg_temp.expect(public.request_screening_accommodation(
  (select id from public.my_screening_interviews()), 'Speech difference.'), null, 'accommodation for 9');
reset role;

do $$
declare
  ai11 uuid := current_setting('test.ai11')::uuid;
  ai4 uuid := current_setting('test.ai4')::uuid;
  expired uuid[];
begin
  update public.application_interviews set deadline_at = now() - interval '1 minute'
   where id = ai11 or application_id = 'e0000000-0000-4000-8000-000000000009';
  expired := public.expire_screening_interviews();
  assert expired = array[ai11], format('expired: %s', expired);
  assert (select status from public.application_interviews where id = ai11) = 'expired', 'not expired';
  assert (select status from public.application_interviews where application_id = 'e0000000-0000-4000-8000-000000000009')
       = 'paused', 'a paused interview expired';
  assert (select status from public.application_interviews where id = ai4) = 'invited', 'a future deadline expired';
  assert pg_temp.hold(ai11) is null and pg_temp.events(ai11, 'interview_expired') = 1, 'expiry: hold or event';
  assert public.expire_screening_interviews() = '{}', 'a second run expired again';
end $$;

-- Practice, end to end as today: reserve → activate → deduct → save → finalize
-- → candidate analysis queued.
insert into public.interviews (id, user_id, name) values
  ('1e000000-0000-4000-8000-000000000019', 'a0000000-0000-4000-8000-000000000009', 'Practice');
update public.user_info set ai_credits = 20 where user_id = 'a0000000-0000-4000-8000-000000000009';
set local role authenticated;
select pg_temp.act('a0000000-0000-4000-8000-000000000009');
do $$
declare
  iv uuid := '1e000000-0000-4000-8000-000000000019';
  session uuid;
  res jsonb;
begin
  assert public.reserve_interview_session(iv, 'pr1') = 'reserved', 'practice reserve';
  assert public.activate_interview_session(iv, 'pr1', 'pv1'), 'practice activate';
  assert public.heartbeat_interview_session(iv, 'pv1'), 'practice heartbeat';
  insert into public.interview_sessions (interview_id, voice_session_id, turns)
  values (iv, 'pv1', '[]') returning id into session;
  assert public.deduct_interview_session_credits(iv, 'pv1') = 'charged', 'practice deduct';
  update public.interview_sessions set turns = pg_temp.turns(3), updated_at = now() where id = session;
  res := public.finalize_interview_analysis_session(session);
  assert res ->> 'status' = 'completed' and res ->> 'analysis_id' is not null, format('practice finalize: %s', res);
  assert public.release_interview_session(iv, 'pv1'), 'practice release';
  assert (select array_agg(perspective) from public.interview_analyses where interview_session_id = session)
       = array['candidate'], 'the practice analysis isn''t the candidate''s';
end $$;
reset role;

do $$
begin
  assert (select ai_credits from public.user_info where user_id = 'a0000000-0000-4000-8000-000000000009') = 10,
    'practice didn''t charge 10 credits';
end $$;

-- ================================================ block 3: invite emails and bulk invites
-- 20261020120000. Messages sent in this transaction have enqueued_at = now(),
-- which keeps the linked project's own queued messages out of the counts.

create function pg_temp.queued(p_ai uuid) returns bigint language sql as $$
  select count(*) from pgmq.q_screening_invite_email_queue
   where enqueued_at = now() and message ->> 'application_interview_id' = p_ai::text
$$;
create function pg_temp.queued_total() returns bigint language sql as $$
  select count(*) from pgmq.q_screening_invite_email_queue where enqueued_at = now()
$$;

-- Every invite above queued exactly one email, and no refusal queued one.
do $$
declare
  r record;
begin
  for r in select id from public.application_interviews where application_id::text like 'e0000000-0000-4000-8000-%' loop
    assert pg_temp.queued(r.id) = 1, format('interview %s queued %s emails', r.id, pg_temp.queued(r.id));
  end loop;
  assert pg_temp.queued_total() = (select count(*) from public.application_interviews
                                     where application_id::text like 'e0000000-0000-4000-8000-%'),
    'a refused invite queued an email';
end $$;

-- Bulk invites on A2 (manual, 10 minutes).
insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id) values
  ('e0000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000003',
   'b0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003');
do $$
declare
  ids uuid[] := array[
    'e0000000-0000-4000-8000-000000000013', -- new: invited
    'e0000000-0000-4000-8000-000000000011', -- already has an interview
    'e0000000-0000-4000-8000-000000000001', -- on A1, not this job
    'e0000000-0000-4000-8000-0000000000ff'  -- no such application
  ]::uuid[];
  before bigint := pg_temp.queued_total();
  res jsonb;
  ai uuid;
begin
  begin
    perform public.create_screening_invites('b0000000-0000-4000-8000-000000000003', ids, 'manual',
      'c1000000-0000-4000-8000-000000000002');
    raise exception 'a bulk invite by another company''s member was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_screening_invites('b0000000-0000-4000-8000-000000000003', ids, 'all', null);
    raise exception 'bulk invite source ''all'' was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_screening_invites('b0000000-0000-4000-8000-000000000003',
      (select array_agg(gen_random_uuid()) from generate_series(1, 51)), 'manual', null);
    raise exception '51 bulk invites were accepted';
  exception when invalid_parameter_value then null;
  end;
  assert not exists (select 1 from public.application_interviews
                      where application_id = 'e0000000-0000-4000-8000-000000000013'),
    'a refused bulk call left an interview';
  assert pg_temp.queued_total() = before, 'a refused bulk call queued an email';

  res := public.create_screening_invites('b0000000-0000-4000-8000-000000000003', ids, 'manual',
           'c5000000-0000-4000-8000-000000000001');
  assert jsonb_array_length(res) = 4, format('bulk results: %s', res);
  assert (select array_agg(r ->> 'application_id' order by n) from jsonb_array_elements(res) with ordinality t(r, n))
       = (select array_agg(i::text) from unnest(ids) i), format('bulk results out of order: %s', res);
  perform pg_temp.expect(res -> 0, null, 'bulk invite of a new application');
  perform pg_temp.expect(res -> 1, 'exists', 'bulk invite of an invited application');
  perform pg_temp.expect(res -> 2, 'not_found', 'bulk invite of another job''s application');
  perform pg_temp.expect(res -> 3, 'not_found', 'bulk invite of no application');

  ai := (res -> 0 ->> 'id')::uuid;
  perform set_config('test.ai13', ai::text, true);
  assert (select invited_via = 'manual' and invited_by = 'c5000000-0000-4000-8000-000000000001'
            from public.application_interviews where id = ai), 'bulk invite row';
  assert pg_temp.hold(ai) = 10, 'the bulk invite has no 10-minute hold';
  assert pg_temp.queued(ai) = 1 and pg_temp.queued_total() = before + 1,
    'the bulk call didn''t queue exactly one email';
end $$;

-- A reopen queues the invite email again (A2's expired interview).
set local role authenticated;
select pg_temp.act('c5000000-0000-4000-8000-000000000001');
select pg_temp.expect(public.manage_screening_interview(current_setting('test.ai11')::uuid, 'reopen'),
  null, 'reopen the expired interview');
reset role;
do $$
begin
  assert pg_temp.queued(current_setting('test.ai11')::uuid) = 2, 'a reopen didn''t queue the email again';
end $$;

select 'screening_interviews: ok' as result;

rollback;
